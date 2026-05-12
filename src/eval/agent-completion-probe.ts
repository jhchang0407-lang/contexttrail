#!/usr/bin/env node
/**
 * Agent-completion probe — does the assembled context pack point the
 * agent at the right files to actually do the work?
 *
 * For each completed Linear ticket we know:
 *   1. The natural queries an engineer would issue
 *   2. The shipping commit and the set of files it touched
 *
 * The probe assembles the pack via the engine (retrieve + link-traversal)
 * and scans all chunk bodies for mentions of the actually-touched .ts /
 * .test.ts / .md files. The metric is precision/recall of "files
 * pointed at" vs "files actually changed", not "is this doc retrieved".
 *
 * This is a more honest end-to-end test than the source-coverage probe
 * because it grounds the assembly metric in shipped engineering work.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runImport } from "../cli/import.js";
import { init } from "../config/init.js";
import { closeDb, openDb } from "../store/db.js";
import { assembleContextPackWithLinks } from "../retrieve/assemble-with-links.js";
import {
  evaluateAssemblyGates,
  renderAssemblyVerdict,
} from "./assembly-gate-bands.js";
import { budgetedRankedEntries } from "./budgeted-pack.js";

type ProbeCliIO = {
  write: (text: string) => void;
  exit: (code: number) => void;
};

type AgentCompletionCase = {
  ticket: string;
  commit_sha: string;
  queries: string[];
  /** Optional: paths to ignore (lockfiles, snapshots, etc.). */
  ignore?: string[];
};

export type AgentCompletionProbeRow = {
  ticket: string;
  commit: string;
  changedFiles: string[];
  mentionedFiles: string[];
  srcOverlap: number;
  srcTotal: number;
  docOverlap: number;
  docTotal: number;
};

export type AgentCompletionProbeSummary = {
  caseCount: number;
  rows: AgentCompletionProbeRow[];
  totalSrc: number;
  totalSrcOverlap: number;
  totalDoc: number;
  totalDocOverlap: number;
};

const REPO_ROOT = process.env.AGENT_COMPLETION_REPO_ROOT ?? process.cwd();

const CASES: AgentCompletionCase[] = [
  // ── PRD-0027 (nav + link graph) shipped slices ────────────────────
  {
    ticket: "THO-228",
    commit_sha: "493303b",
    queries: [
      "PRD-0027 SourceProfile nav-field extension import-time wiring",
      "SourceProfile nav fields buildSourceProfile",
      "NavGraph import wiring source-profile builder",
    ],
  },
  {
    ticket: "THO-227",
    commit_sha: "2ecd946",
    queries: [
      "PRD-0027 nav sidebar parser sub-parsers",
      "vitepress mkdocs docusaurus frontmatter nav parser",
      "parseNavConfig per-format extraction property tests",
    ],
  },
  {
    ticket: "THO-229",
    commit_sha: "c363aba",
    queries: [
      "PRD-0027 source-rerank wiring nav metadata flag",
      "nav-landing source-rerank scoring",
      "RETRIEVAL_NAV_METADATA flag overview-owner-score",
    ],
  },

  // ── PRD-0025 (structural contextual indexing) shipped slices ─────
  {
    ticket: "THO-225",
    commit_sha: "44e7735",
    queries: [
      "PRD-0025 BM25F field-weight extension structural context",
      "BM25F doc_title doc_purpose section_intro field weights",
      "structural chunk context flag candidate recall eval",
    ],
  },
  {
    ticket: "THO-224",
    commit_sha: "d4adc03",
    queries: [
      "PRD-0025 chunk table column extension FTS5",
      "chunk-table virtual table recreation reindex",
      "FTS5 schema migration chunk reindex",
    ],
  },
  {
    ticket: "THO-223",
    commit_sha: "5947445",
    queries: [
      "PRD-0025 chunk-structural-context extractor doc_purpose",
      "structural context extractor provenance trace",
      "chunk-level doc_purpose extractor synthetic property",
    ],
  },

  // ── PRD-0024 (import-time evidence) shipped slices ───────────────
  {
    ticket: "THO-221",
    commit_sha: "99cf920",
    queries: [
      "PRD-0024 code-fence entity consumption alias substrate",
      "code_fence_entities source-rerank wiring",
      "code-fence entity flag shadow eval",
    ],
  },
  {
    ticket: "THO-220",
    commit_sha: "fbd4300",
    queries: [
      "PRD-0024 SourceProfile code_fence_entities field import wiring",
      "code_fence_entities import-time wiring",
      "code_fence_entities SourceProfile schema field",
    ],
  },
  {
    ticket: "THO-219",
    commit_sha: "b4ca552",
    queries: [
      "PRD-0024 extractCodeFenceEntities extractor property tests",
      "code-fence entities markdown extractor",
      "extractCodeFenceEntities synthetic property gate",
    ],
  },
  {
    ticket: "THO-218",
    commit_sha: "9b62fd0",
    queries: [
      "PRD-0024 heading aliases source-rerank wiring",
      "heading_aliases SourceProfile field source-rerank evidence",
      "RETRIEVAL_HEADING_ALIASES flag flip",
    ],
  },
  {
    ticket: "THO-217",
    commit_sha: "bfe5abb",
    queries: [
      "PRD-0024 SourceProfile heading_aliases field import wiring",
      "heading_aliases SourceProfile schema field",
      "import-time wiring heading aliases extractor",
    ],
  },
  {
    ticket: "THO-216",
    commit_sha: "84a2ed3",
    queries: [
      "PRD-0024 extractHeadingAliases extractor property tests",
      "heading aliases markdown H1 H2 H3 extractor",
      "extractHeadingAliases synthetic property gate",
    ],
  },

  // ── PRD-0023 (path topology) shipped slices ──────────────────────
  {
    ticket: "THO-214",
    commit_sha: "32a46e2",
    queries: [
      "PRD-0023 path-topology source-rerank boosts flag",
      "landing index package version boost source-rerank",
      "RETRIEVAL_PATH_TOPOLOGY_BOOSTS flag",
    ],
  },
  {
    ticket: "THO-213",
    commit_sha: "6dac61a",
    queries: [
      "PRD-0023 SourceProfile path-topology fields import wiring",
      "is_index_file is_section_landing path_depth SourceProfile",
      "package_segment version_segment SourceProfile extension",
    ],
  },
];

function getFilesChangedInCommit(sha: string): string[] {
  try {
    const out = execSync(`git show --pretty=format: --name-only ${sha}`, {
      cwd: REPO_ROOT,
    }).toString();
    return out.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
  } catch (err) {
    process.stderr.write(`Failed to read commit ${sha}: ${err}\n`);
    return [];
  }
}

function copyDirSync(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const sp = join(src, name);
    const dp = join(dst, name);
    if (statSync(sp).isDirectory()) copyDirSync(sp, dp);
    else copyFileSync(sp, dp);
  }
}

/**
 * Find file-path-shaped tokens in a body of text: `src/foo/bar.ts`,
 * `docs/prd/0027-x.md`, etc. Pure regex — does not depend on
 * frontmatter or specific corpus conventions.
 */
function extractFilePathMentions(body: string): Set<string> {
  const out = new Set<string>();
  const re = /(?:^|[\s`(\[])(src\/[A-Za-z0-9_\-/.]+\.(?:ts|tsx|js|test\.ts)|docs\/[A-Za-z0-9_\-/.()]+\.(?:md|mdx)|tests\/[A-Za-z0-9_\-/.]+\.[a-z]+)/g;
  for (const m of body.matchAll(re)) {
    if (m[1]) out.add(m[1]);
  }
  return out;
}

function categorize(path: string): "src" | "test" | "doc" | "other" {
  if (path.endsWith(".md") || path.endsWith(".mdx")) return "doc";
  if (path.includes(".test.") || path.startsWith("tests/")) return "test";
  if (path.startsWith("src/")) return "src";
  return "other";
}

export function summarizeAgentCompletionRows(
  rows: AgentCompletionProbeRow[],
  caseCount = CASES.length,
): AgentCompletionProbeSummary {
  return {
    caseCount,
    rows,
    totalSrc: rows.reduce((sum, row) => sum + row.srcTotal, 0),
    totalSrcOverlap: rows.reduce((sum, row) => sum + row.srcOverlap, 0),
    totalDoc: rows.reduce((sum, row) => sum + row.docTotal, 0),
    totalDocOverlap: rows.reduce((sum, row) => sum + row.docOverlap, 0),
  };
}

export function agentCompletionVerdictFromSummary(summary: AgentCompletionProbeSummary) {
  const commitsPassing = summary.rows.filter(
    (row) => row.srcTotal > 0 && row.srcOverlap === row.srcTotal,
  ).length;
  const commitsTotal = summary.rows.filter((row) => row.srcTotal > 0).length;
  return evaluateAssemblyGates({
    agent_completion_commits: { passing: commitsPassing, total: commitsTotal },
    agent_completion_files: { mentioned: summary.totalSrcOverlap, total: summary.totalSrc },
  });
}

export function renderAgentCompletionReport(summary: AgentCompletionProbeSummary): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("========== AGENT-COMPLETION PROBE ==========");
  lines.push(`${summary.caseCount} tickets, comparing pack-mentioned files to actual commit diffs.`);
  lines.push("");
  lines.push(
    `Source files (src/**) pointed-at: ${summary.totalSrcOverlap}/${summary.totalSrc}  (${(summary.totalSrcOverlap / Math.max(summary.totalSrc, 1) * 100).toFixed(1)}%)`,
  );
  lines.push(
    `Doc files (docs/**) pointed-at:   ${summary.totalDocOverlap}/${summary.totalDoc}  (${(summary.totalDocOverlap / Math.max(summary.totalDoc, 1) * 100).toFixed(1)}%)`,
  );
  lines.push("");
  lines.push("Per-ticket detail:");
  for (const row of summary.rows) {
    lines.push("");
    lines.push(`  ${row.ticket} (${row.commit})`);
    lines.push(`    src files: ${row.srcOverlap}/${row.srcTotal} mentioned in pack`);
    lines.push(`    doc files: ${row.docOverlap}/${row.docTotal} mentioned in pack`);
    const srcChanged = row.changedFiles.filter((file) => categorize(file) === "src");
    for (const file of srcChanged) {
      const hit = row.mentionedFiles.includes(file) ? "✅" : "❌";
      lines.push(`      [${hit}] ${file}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function parseAgentCompletionBudgetArgs(
  argv: string[],
): { budget?: number; budgetSweep?: number[] } {
  const out: { budget?: number; budgetSweep?: number[] } = {};
  for (const arg of argv) {
    const single = /^--budget=(\d+)$/.exec(arg);
    if (single) {
      const n = Number.parseInt(single[1]!, 10);
      if (Number.isFinite(n) && n > 0) out.budget = n;
      continue;
    }
    const sweep = /^--budget-sweep=(.+)$/.exec(arg);
    if (sweep) {
      const parts = sweep[1]!
        .split(",")
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (parts.length > 0) out.budgetSweep = parts;
    }
  }
  return out;
}

export type AgentCompletionBudgetSweepRow = {
  budget: number;
  srcOverlap: number;
  srcTotal: number;
  commitsPassing: number;
  commitsTotal: number;
};

function pad(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((row) => row[i]!.length)));
  return rows.map((row) => row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ")).join("\n");
}

export function renderAgentCompletionBudgetSweepTable(
  rows: AgentCompletionBudgetSweepRow[],
): string {
  if (rows.length === 0) return "";
  const baseline = rows.reduce(
    (best, row) => (row.budget > best.budget ? row : best),
    rows[0]!,
  );
  const dataRows = rows.map((row) => {
    const filePct = row.srcTotal === 0 ? "-" : `${((row.srcOverlap / row.srcTotal) * 100).toFixed(1)}%`;
    const commitPct = row.commitsTotal === 0 ? "-" : `${((row.commitsPassing / row.commitsTotal) * 100).toFixed(1)}%`;
    const fileDelta = row.srcOverlap - baseline.srcOverlap;
    const fileDeltaStr = row.budget === baseline.budget
      ? " baseline"
      : `${fileDelta > 0 ? "+" : ""}${fileDelta} ${Math.abs(fileDelta) === 1 ? "file" : "files"}`;
    return [
      String(row.budget),
      `${row.srcOverlap} / ${row.srcTotal}  (${filePct})`,
      `${row.commitsPassing} / ${row.commitsTotal}  (${commitPct})`,
      fileDeltaStr,
    ];
  });
  const header = ["budget", "file_retention", "commit_retention", "delta_vs_default"];
  return pad([header, ...dataRows]);
}

export function emitAgentCompletionProbeCli(args: {
  summary: AgentCompletionProbeSummary;
  io: ProbeCliIO;
}) {
  const { summary, io } = args;
  io.write(renderAgentCompletionReport(summary));
  const verdict = agentCompletionVerdictFromSummary(summary);
  io.write("\n");
  io.write(renderAssemblyVerdict(verdict));
  if (!verdict.pass) io.exit(1);
  return verdict;
}

async function runAgentCompletionEval(
  budgetTokensOverride?: number,
): Promise<AgentCompletionProbeSummary> {
  const cwd = mkdtempSync(join(tmpdir(), "contexttrail-agent-completion-"));
  try {
    init(cwd);
    copyDirSync(join(REPO_ROOT, "docs"), join(cwd, "docs"));
    // PRD-0028: code-source index requires src/ to be present in the
    // tempdir corpus so runImport's importCodeSources call can extract
    // structural metadata. Without this the gate-1 metric measures only
    // the markdown-only baseline.
    copyDirSync(join(REPO_ROOT, "src"), join(cwd, "src"));
    runImport(cwd, ["*.md", "docs/**/*.md", "!docs/evals/prd-0030-budget-baselines.md"]);
    const db = openDb(join(cwd, ".contexttrail", "cache", "contexttrail.db"));
    try {
      const rows: AgentCompletionProbeRow[] = [];
      for (const c of CASES) {
        const changed = getFilesChangedInCommit(c.commit_sha).filter(
          (f) => !(c.ignore ?? []).some((ig) => f.startsWith(ig)),
        );
        const mentionedAcrossQueries = new Set<string>();
        for (const q of c.queries) {
          const { pack } = assembleContextPackWithLinks({
            db,
            request: {
              task: q,
              query_anchors: { files: [], symbols: [], routes: [] },
              budget: "default",
              expected_locked: [],
              explain: false,
            },
            cwd,
            maxHops: 2,
            ...(budgetTokensOverride !== undefined ? { budgetTokensOverride } : {}),
          });
          const rankedForMeasurement = budgetTokensOverride === undefined
            ? pack.ranked
            : budgetedRankedEntries(pack, budgetTokensOverride);
          for (const r of rankedForMeasurement) {
            for (const m of extractFilePathMentions(r.body)) mentionedAcrossQueries.add(m);
          }
        }
        const srcChanged = changed.filter((f) => categorize(f) === "src");
        const docChanged = changed.filter((f) => categorize(f) === "doc");
        const srcOverlap = srcChanged.filter((f) => mentionedAcrossQueries.has(f)).length;
        const docOverlap = docChanged.filter((f) => mentionedAcrossQueries.has(f)).length;
        rows.push({
          ticket: c.ticket,
          commit: c.commit_sha,
          changedFiles: changed,
          mentionedFiles: [...mentionedAcrossQueries],
          srcOverlap,
          srcTotal: srcChanged.length,
          docOverlap,
          docTotal: docChanged.length,
        });
      }
      return summarizeAgentCompletionRows(rows);
    } finally { closeDb(db); }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function runBudgetSweep(budgets: number[]): Promise<void> {
  const rows: AgentCompletionBudgetSweepRow[] = [];
  for (const budget of budgets) {
    const summary = await runAgentCompletionEval(budget);
    const commitsPassing = summary.rows.filter((r) => r.srcTotal > 0 && r.srcOverlap === r.srcTotal).length;
    const commitsTotal = summary.rows.filter((r) => r.srcTotal > 0).length;
    rows.push({
      budget,
      srcOverlap: summary.totalSrcOverlap,
      srcTotal: summary.totalSrc,
      commitsPassing,
      commitsTotal,
    });
  }
  process.stdout.write("Budget sweep (PRD-0030 / 30.2)\n\n");
  process.stdout.write(`${renderAgentCompletionBudgetSweepTable(rows)}\n`);
}

async function main() {
  const { budget, budgetSweep } = parseAgentCompletionBudgetArgs(process.argv);
  if (budgetSweep && budgetSweep.length > 0) {
    await runBudgetSweep(budgetSweep);
    return;
  }
  const summary = await runAgentCompletionEval(budget);
  if (budget !== undefined) {
    process.stdout.write(renderAgentCompletionReport(summary));
    process.stdout.write(`\n(verdict skipped: --budget=${budget} is not the gated default)\n`);
    return;
  }
  emitAgentCompletionProbeCli({
    summary,
    io: {
      write: (text) => process.stdout.write(text),
      exit: (code) => process.exit(code),
    },
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
