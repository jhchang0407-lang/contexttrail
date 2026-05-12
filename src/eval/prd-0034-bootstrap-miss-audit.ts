#!/usr/bin/env node
/**
 * PRD-0034 / slice 34.1 — Bootstrap miss audit (falsification gate).
 *
 * Pure measurement. Runs the existing regex bootstrap on twenty
 * hand-authored chunks (`tests/fixtures/bootstrap-miss-audit.yaml`),
 * classifies each result against a ground-truth label, and writes
 * `docs/evals/prd-0034-bootstrap-miss-audit.md`.
 *
 * Boundary: no LLM, no production code change. The audit is the
 * falsification gate for the rest of PRD-0034. If <8 of 20 chunks show
 * a miss, or the misses don't span ≥3 chunk shapes, PRD-0034 closes in
 * terminal state A.
 *
 * Empty-anchor assumption: the audit assumes no confident symbol
 * anchors are available yet — modelling the first-bootstrap-on-a-fresh-
 * import case that PRD-0034 targets. This assumption is documented in
 * the rendered report.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { generateBootstrapProposals } from "../bootstrap/proposals.js";

// ─────────────────────────────────────────────────────────────────────
// Types + pure classification
// ─────────────────────────────────────────────────────────────────────

export type ChunkShape =
  | "operational_procedure"
  | "architectural_narrative"
  | "decision_rationale"
  | "parameter_documentation"
  | "mixed_content";

export type GroundTruth = "candidate" | "clarification" | "nothing";

export type RegexProducedShape = "nothing" | "candidate" | "clarification";

export type MissClassification =
  | "hit"
  | "missed_candidate"
  | "missed_clarification"
  | "hedged"
  | "spurious";

export type AuditRow = {
  chunk_id: string;
  chunk_shape: ChunkShape;
  ground_truth: GroundTruth;
  regex: { candidates: number; clarifications: number };
  regex_produced: RegexProducedShape;
  classification: MissClassification;
  rationale?: string;
};

export type ClassifyInput = Omit<AuditRow, "classification" | "regex_produced" | "rationale"> & {
  rationale?: string;
};

function regexProducedShape(regex: ClassifyInput["regex"]): RegexProducedShape {
  if (regex.candidates > 0) return "candidate";
  if (regex.clarifications > 0) return "clarification";
  return "nothing";
}

export function classifyChunkMiss(input: ClassifyInput): AuditRow {
  const produced = regexProducedShape(input.regex);
  let classification: MissClassification;
  switch (input.ground_truth) {
    case "candidate":
      classification =
        produced === "candidate"
          ? "hit"
          : produced === "clarification"
            ? "hedged"
            : "missed_candidate";
      break;
    case "clarification":
      // If regex produced a candidate when ground truth said clarification,
      // that's still useful output — the human reviewer can decide. Count it
      // as a hit, not a spurious; the audit's mission is to find chunks
      // where regex produced *nothing*, not chunks where regex was bolder
      // than the human reviewer would have been.
      classification =
        produced === "nothing" ? "missed_clarification" : "hit";
      break;
    case "nothing":
      classification = produced === "nothing" ? "hit" : "spurious";
      break;
  }
  return {
    chunk_id: input.chunk_id,
    chunk_shape: input.chunk_shape,
    ground_truth: input.ground_truth,
    regex: input.regex,
    regex_produced: produced,
    classification,
    ...(input.rationale ? { rationale: input.rationale } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Summary + proceed gate
// ─────────────────────────────────────────────────────────────────────

export type AuditSummary = {
  total: number;
  counts: Record<MissClassification, number>;
  miss_set_size: number;
  miss_set_shapes: ReadonlySet<ChunkShape>;
  proceed_condition_met: boolean;
  proceed_reason: string;
};

const PROCEED_MIN_MISSES = 8;
const PROCEED_MIN_SHAPES = 3;

const MISS_CLASSIFICATIONS: ReadonlySet<MissClassification> = new Set([
  "missed_candidate",
  "missed_clarification",
  "hedged",
]);

export function summarizeMissAudit(rows: readonly AuditRow[]): AuditSummary {
  const counts: Record<MissClassification, number> = {
    hit: 0,
    missed_candidate: 0,
    missed_clarification: 0,
    hedged: 0,
    spurious: 0,
  };
  const missShapes = new Set<ChunkShape>();
  let missSetSize = 0;
  for (const row of rows) {
    counts[row.classification] += 1;
    if (MISS_CLASSIFICATIONS.has(row.classification)) {
      missSetSize += 1;
      missShapes.add(row.chunk_shape);
    }
  }
  const proceed = missSetSize >= PROCEED_MIN_MISSES && missShapes.size >= PROCEED_MIN_SHAPES;
  const reason = proceed
    ? `proceed: ${missSetSize} miss(es) across ${missShapes.size} chunk shape(s) — gate is ≥${PROCEED_MIN_MISSES} / ≥${PROCEED_MIN_SHAPES}`
    : `falsified: ${missSetSize} miss(es) across ${missShapes.size} chunk shape(s) — gate requires ≥${PROCEED_MIN_MISSES} misses spanning ≥${PROCEED_MIN_SHAPES} shapes (insufficient)`;
  return {
    total: rows.length,
    counts,
    miss_set_size: missSetSize,
    miss_set_shapes: missShapes,
    proceed_condition_met: proceed,
    proceed_reason: reason,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Fixture loading
// ─────────────────────────────────────────────────────────────────────

type FixtureChunk = {
  id: string;
  chunk_shape: ChunkShape;
  ground_truth: GroundTruth;
  body: string;
  rationale?: string;
};

type FixtureFile = {
  chunks: FixtureChunk[];
};

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "tests",
  "fixtures",
  "bootstrap-miss-audit.yaml",
);

const REPO_ROOT_FIXTURE_PATH = join(
  process.cwd(),
  "tests",
  "fixtures",
  "bootstrap-miss-audit.yaml",
);

function readFixture(): FixtureFile {
  // The first path resolves correctly when running via tsx (source). The
  // second one is the fallback when running from compiled dist/ which is
  // one directory deeper.
  const tryPaths = [FIXTURE_PATH, REPO_ROOT_FIXTURE_PATH];
  let lastError: unknown;
  for (const p of tryPaths) {
    try {
      const text = readFileSync(p, "utf8");
      return parseYaml(text) as FixtureFile;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `bootstrap-miss-audit.yaml not found; tried: ${tryPaths.join(", ")} (${lastError})`,
  );
}

function runRegexOnChunk(chunk: FixtureChunk): { candidates: number; clarifications: number } {
  const proposals = generateBootstrapProposals({
    listCanonicalChunks: () => [
      {
        stable_key: chunk.id,
        source_path: `audit/${chunk.id}.md`,
        heading_path: ["Audit"],
        version_id: chunk.id,
        body: chunk.body,
        scope: { layer: "project", project: "contexttrail" },
      },
    ],
    // Empty-anchor assumption: PRD-0034 § slice 34.1 models the
    // first-bootstrap-on-a-fresh-import scenario where no cards have
    // been accepted yet and no confident symbol anchors exist.
    getConfidentSymbolAnchors: () => [],
  });
  return {
    candidates: proposals.candidates.length,
    clarifications: proposals.clarifications.length,
  };
}

export function loadMissAuditFixture(): AuditRow[] {
  const fixture = readFixture();
  return fixture.chunks.map((chunk) =>
    classifyChunkMiss({
      chunk_id: chunk.id,
      chunk_shape: chunk.chunk_shape,
      ground_truth: chunk.ground_truth,
      regex: runRegexOnChunk(chunk),
      ...(chunk.rationale ? { rationale: chunk.rationale } : {}),
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────

export function renderMissAuditTable(rows: readonly AuditRow[]): string {
  const headers = [
    "chunk_id",
    "chunk_shape",
    "ground_truth",
    "regex_produced",
    "classification",
  ];
  const lines: string[] = [];
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) {
    lines.push(
      `| ${row.chunk_id} | ${row.chunk_shape} | ${row.ground_truth} | ${row.regex_produced} | ${row.classification} |`,
    );
  }
  return lines.join("\n");
}

function renderRationale(rows: readonly AuditRow[]): string {
  const lines: string[] = [];
  for (const row of rows) {
    if (!row.rationale) continue;
    lines.push(`- **${row.chunk_id}** (${row.classification}) — ${row.rationale.trim()}`);
  }
  return lines.join("\n");
}

export function renderMissAuditDocument(
  rows: readonly AuditRow[],
  summary: AuditSummary,
): string {
  const lines: string[] = [];
  lines.push("# PRD-0034 / slice 34.1 — Bootstrap Miss Audit");
  lines.push("");
  lines.push(
    "Pure measurement output. Runs the regex bootstrap (`src/bootstrap/proposals.ts`)",
  );
  lines.push(
    "against twenty hand-authored chunks in `tests/fixtures/bootstrap-miss-audit.yaml`",
  );
  lines.push(
    "and classifies each result against a ground-truth label. Generated by",
  );
  lines.push("`src/eval/prd-0034-bootstrap-miss-audit.ts`.");
  lines.push("");
  lines.push("## Methodology");
  lines.push("");
  lines.push("Each chunk in the fixture carries a `ground_truth` field — what a human");
  lines.push("reviewer would mark as the ideal bootstrap output:");
  lines.push("");
  lines.push("- `candidate` — a candidate card is worth authoring");
  lines.push("- `clarification` — the rule is ambiguous; a clarification need is the right shape");
  lines.push("- `nothing` — no card or clarification is worth surfacing");
  lines.push("");
  lines.push("The audit runs `generateBootstrapProposals` on the chunk in isolation and");
  lines.push("compares the regex output to the ground truth. Classifications:");
  lines.push("");
  lines.push("- `hit` — regex output matched (or exceeded) the ground truth");
  lines.push("- `missed_candidate` — ground truth = candidate, regex produced nothing");
  lines.push("- `missed_clarification` — ground truth = clarification, regex produced nothing");
  lines.push("- `hedged` — ground truth = candidate, regex produced only a clarification");
  lines.push("- `spurious` — ground truth = nothing, regex produced output anyway");
  lines.push("");
  lines.push("**Empty-anchor assumption.** The audit calls `getConfidentSymbolAnchors`");
  lines.push("with an empty list, modelling the first-bootstrap-on-a-fresh-import case");
  lines.push("where no cards have been accepted yet and no confident symbol anchors");
  lines.push("exist. This is the scenario PRD-0034's hypothesis targets — the high-");
  lines.push("friction onboarding moment when the setup arc loses momentum.");
  lines.push("");
  lines.push("## Audit rows");
  lines.push("");
  lines.push(renderMissAuditTable(rows));
  lines.push("");
  lines.push("## Per-chunk rationale");
  lines.push("");
  lines.push(renderRationale(rows));
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Total chunks audited: ${summary.total}`);
  lines.push(`- Hits: ${summary.counts.hit}`);
  lines.push(`- Missed candidates: ${summary.counts.missed_candidate}`);
  lines.push(`- Missed clarifications: ${summary.counts.missed_clarification}`);
  lines.push(`- Hedged (candidate → clarification): ${summary.counts.hedged}`);
  lines.push(`- Spurious: ${summary.counts.spurious}`);
  lines.push(
    `- **Miss-set size:** ${summary.miss_set_size} (missed_candidate + missed_clarification + hedged)`,
  );
  lines.push(
    `- **Miss-set chunk shapes:** ${[...summary.miss_set_shapes].sort().join(", ") || "(none)"}`,
  );
  lines.push("");
  lines.push("## Verdict");
  lines.push("");
  if (summary.proceed_condition_met) {
    lines.push("**PRD-0034 proceeds to slice 34.2.**");
    lines.push("");
    lines.push(`Proceed gate: ${summary.proceed_reason}`);
    lines.push("");
    lines.push(
      "The miss set is large enough and structurally varied enough that an LLM",
    );
    lines.push(
      "augmentation lever is worth building. Slice 34.2 (THO-254) implements the",
    );
    lines.push(
      "augmentation module behind a default-off `--llm` flag; slice 34.3 (THO-255)",
    );
    lines.push(
      "wires it into `contexttrail card bootstrap` with cost guardrails. ADR-0014's",
    );
    lines.push(
      "authority boundary holds: every LLM output goes through the same human-",
    );
    lines.push("review gate as regex output.");
  } else {
    lines.push("**PRD-0034 closes in terminal state A (audit-only falsified).**");
    lines.push("");
    lines.push(`Proceed gate: ${summary.proceed_reason}`);
    lines.push("");
    lines.push(
      "The regex bootstrap catches enough of the high-leverage candidates and",
    );
    lines.push(
      "clarifications across the audited chunk shapes that an LLM augmentation",
    );
    lines.push(
      "is not motivated. No LLM code ships. OPEN.md item 4 should be updated to",
    );
    lines.push("name the next setup-engine lever instead of LLM augmentation.");
  }
  lines.push("");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────

const OUTPUT_PATH =
  process.env.PRD_0034_OUTPUT ??
  join(process.cwd(), "docs", "evals", "prd-0034-bootstrap-miss-audit.md");

export async function runMissAudit(outputPath = OUTPUT_PATH): Promise<{
  rows: AuditRow[];
  summary: AuditSummary;
  outputPath: string;
}> {
  const rows = loadMissAuditFixture();
  const summary = summarizeMissAudit(rows);
  const md = renderMissAuditDocument(rows, summary);
  const resolved = resolve(outputPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, md);
  return { rows, summary, outputPath: resolved };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runMissAudit().then(({ rows, summary, outputPath }) => {
    process.stdout.write(
      `Wrote ${rows.length} audit row(s) to ${outputPath}\n` +
        `Miss-set: ${summary.miss_set_size} across ${summary.miss_set_shapes.size} shape(s); ` +
        `proceed=${summary.proceed_condition_met}\n`,
    );
  }).catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
