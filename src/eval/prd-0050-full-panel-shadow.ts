#!/usr/bin/env node
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runImport } from "../cli/import.js";
import { init } from "../config/init.js";
import { closeDb, openDb } from "../store/db.js";
import {
  AGENT_COMPLETION_CASES,
  type AgentCompletionCase,
} from "./agent-completion-probe.js";
import {
  createPrd0050FullPanelShadowAdapters,
  renderPrd0050FullPanelVerdict,
  renderPrd0050PromotionVerdict,
  runCodeContextShadowComparison,
  type CodeContextShadowAdapterResult,
  type CodeContextShadowCase,
  type CodeContextShadowCandidate,
  type CodeContextShadowComparisonReport,
  type CodeContextShadowMetric,
  type Prd0050PromotionMetrics,
} from "./code-context-shadow.js";
import { COMMIT_GROUNDED_EVAL_IMPORT_GLOBS, prepareCommitGroundedEvalWorkspace } from "./import-globs.js";
import type { CodeLaneResidualFamily } from "./code-lane-comparison.js";

const REPO_ROOT = process.env.AGENT_COMPLETION_REPO_ROOT ?? process.cwd();

function changedSrcFiles(commitSha: string, repoRoot: string): string[] {
  try {
    const out = execSync(`git show --pretty=format: --name-only ${commitSha}`, {
      cwd: repoRoot,
    }).toString();
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("src/"))
      .filter((line) => !line.includes(".test."))
      .filter((line) => !line.endsWith(".test.ts"));
  } catch {
    return [];
  }
}

export function shadowCasesForPanel(
  panel: readonly AgentCompletionCase[],
  repoRoot: string,
): CodeContextShadowCase[] {
  const out: CodeContextShadowCase[] = [];
  for (const item of panel) {
    const srcFiles = changedSrcFiles(item.commit_sha, repoRoot);
    if (srcFiles.length === 0) continue;
    for (let i = 0; i < item.queries.length; i++) {
      out.push({
        id: `${item.ticket}:${i + 1}`,
        query: item.queries[i]!,
        expectedOwnerFiles: srcFiles,
        expectedSupportFiles: srcFiles,
        expectedOwnerMatch: "any",
        expectedSupportMatch: "any",
        residualFamily: classifyResidualFamily(srcFiles),
      });
    }
  }
  return out;
}

function classifyResidualFamily(files: readonly string[]): CodeLaneResidualFamily {
  const tokens = new Set(files.flatMap((file) => fileTokens(file)));
  if (tokens.has("sourceprofile") || (tokens.has("source") && tokens.has("profile"))) {
    return "source_profile_storage";
  }
  if (
    hasAny(tokens, ["cli", "command", "import", "parse", "parser", "reindex", "chunker"])
  ) {
    return "import_workflow";
  }
  if (
    hasAny(tokens, [
      "chunk",
      "database",
      "db",
      "persist",
      "persistence",
      "schema",
      "store",
      "storage",
      "table",
    ])
  ) {
    return "persistence_substrate";
  }
  if (hasAny(tokens, ["index", "rank", "ranking", "rerank", "retrieval", "score"])) {
    return "retrieval_index";
  }
  if (hasAny(tokens, ["cli", "command", "manifest", "runner", "state", "validate"])) {
    return "cli_workflow";
  }
  return "other";
}

function fileTokens(file: string): string[] {
  return file
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .flatMap((token) => {
      if (token === "sourceprofile" || token === "sourceprofiles") {
        return ["sourceprofile", "source", "profile"];
      }
      return [token.endsWith("s") && token.length > 3 ? token.slice(0, -1) : token];
    });
}

function hasAny(tokens: ReadonlySet<string>, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => tokens.has(candidate));
}

function limitFromArgs(argv: readonly string[]): number | undefined {
  const raw = argv.find((arg) => arg.startsWith("--limit="))?.replace("--limit=", "");
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function buildPrd0050PromotionVerdict(
  report: CodeContextShadowComparisonReport,
  cases: readonly CodeContextShadowCase[],
): string | null {
  const baseline = report.methods.find(
    (method) => method.method.id === "prd-0048-baseline",
  );
  const candidate = report.methods.find(
    (method) => method.method.id === "combined-bundle",
  );
  if (!baseline || !candidate) return null;

  const baselineMetrics = promotionMetricsForMethod(baseline, cases);
  const candidateMetrics = promotionMetricsForMethod(candidate, cases);
  const noRegression =
    candidateMetrics.codeTop1Acceptable.hits >=
      baselineMetrics.codeTop1Acceptable.hits &&
    candidateMetrics.codeRankedUseful.hits >=
      baselineMetrics.codeRankedUseful.hits &&
    candidateMetrics.supportClusterUseful.hits >=
      baselineMetrics.supportClusterUseful.hits;

  return renderPrd0050PromotionVerdict({
    baselineName: baseline.method.name,
    candidateName: candidate.method.id,
    evidenceScope: report.evidenceScope,
    baselineMetrics,
    candidateMetrics,
    guardrails: {
      noRegression,
      details: [
        `code top-1 acceptable ${metricInline(candidateMetrics.codeTop1Acceptable)} vs baseline ${metricInline(baselineMetrics.codeTop1Acceptable)}`,
        `code ranked useful ${metricInline(candidateMetrics.codeRankedUseful)} vs baseline ${metricInline(baselineMetrics.codeRankedUseful)}`,
        `support-cluster useful ${metricInline(candidateMetrics.supportClusterUseful)} vs baseline ${metricInline(baselineMetrics.supportClusterUseful)}`,
      ],
    },
  });
}

function promotionMetricsForMethod(
  method: CodeContextShadowComparisonReport["methods"][number],
  cases: readonly CodeContextShadowCase[],
): Prd0050PromotionMetrics {
  const rowsByCaseId = new Map(
    method.rows.map((row) => [row.caseId, row]),
  );
  const ticketGroups = groupCasesByTicket(cases);
  const supportGroups = [...ticketGroups.values()].filter((group) =>
    group.some((testCase) => testCase.expectedSupportFiles.length > 0),
  );

  return {
    promptVariantTop3: method.topKUsefulness,
    ticketsTop3Robust: {
      hits: [...ticketGroups.values()].filter((group) =>
        group.every((testCase) =>
          containsExpectedOwners(
            rowsByCaseId.get(testCase.id)?.topCandidates ?? [],
            testCase,
          ),
        ),
      ).length,
      total: ticketGroups.size,
    },
    supportFileHits: supportFileHitMetric(ticketGroups, rowsByCaseId),
    codeTop1Acceptable: {
      hits: [...ticketGroups.values()].filter((group) =>
        group.some((testCase) => {
          const first = rowsByCaseId.get(testCase.id)?.topCandidates[0];
          return first ? containsExpectedOwners([first], testCase) : false;
        }),
      ).length,
      total: ticketGroups.size,
    },
    codeRankedUseful: {
      hits: [...ticketGroups.values()].filter((group) =>
        group.some((testCase) =>
          containsExpectedOwners(
            rowsByCaseId.get(testCase.id)?.initialCandidates ?? [],
            testCase,
          ),
        ),
      ).length,
      total: ticketGroups.size,
    },
    supportClusterUseful: {
      hits: supportGroups.filter((group) =>
        group.some((testCase) =>
          containsExpectedSupport(
            rowsByCaseId.get(testCase.id)?.topCandidates ?? [],
            testCase,
          ),
        ),
      ).length,
      total: supportGroups.length,
    },
    payloadTokens: method.payloadTokens,
  };
}

function groupCasesByTicket(
  cases: readonly CodeContextShadowCase[],
): Map<string, CodeContextShadowCase[]> {
  const out = new Map<string, CodeContextShadowCase[]>();
  for (const testCase of cases) {
    const ticket = testCase.id.split(":")[0] ?? testCase.id;
    const group = out.get(ticket) ?? [];
    group.push(testCase);
    out.set(ticket, group);
  }
  return out;
}

function supportFileHitMetric(
  ticketGroups: ReadonlyMap<string, readonly CodeContextShadowCase[]>,
  rowsByCaseId: ReadonlyMap<string, CodeContextShadowAdapterResult>,
): CodeContextShadowMetric {
  let hits = 0;
  let total = 0;
  for (const group of ticketGroups.values()) {
    const expectedFiles = new Set(
      group.flatMap((testCase) => testCase.expectedSupportFiles),
    );
    total += expectedFiles.size;
    const hitFiles = new Set<string>();
    for (const testCase of group) {
      const row = rowsByCaseId.get(testCase.id);
      if (!row) continue;
      for (const candidate of row.initialCandidates) {
        if (!candidate.support_candidate) continue;
        if (expectedFiles.has(candidate.source_path)) {
          hitFiles.add(candidate.source_path);
        }
      }
    }
    hits += hitFiles.size;
  }
  return { hits, total };
}

function containsExpectedOwners(
  candidates: readonly CodeContextShadowCandidate[],
  testCase: CodeContextShadowCase,
): boolean {
  return containsExpectedFiles(
    candidates,
    testCase.expectedOwnerFiles,
    testCase.expectedOwnerMatch,
  );
}

function containsExpectedSupport(
  candidates: readonly CodeContextShadowCandidate[],
  testCase: CodeContextShadowCase,
): boolean {
  return containsExpectedFiles(
    candidates,
    testCase.expectedSupportFiles,
    testCase.expectedSupportMatch,
  );
}

function containsExpectedFiles(
  candidates: readonly CodeContextShadowCandidate[],
  expectedFiles: readonly string[],
  match: "all" | "any" | undefined,
): boolean {
  const paths = new Set(candidates.map((candidate) => candidate.source_path));
  if (expectedFiles.length === 0) return true;
  if (match === "any") {
    return expectedFiles.some((file) => paths.has(file));
  }
  return expectedFiles.every((file) => paths.has(file));
}

function metricInline(metric: CodeContextShadowMetric): string {
  return `${metric.hits}/${metric.total}`;
}

async function main(): Promise<void> {
  const limit = limitFromArgs(process.argv.slice(2));
  const cwd = mkdtempSync(join(tmpdir(), "contexttrail-prd-0050-"));
  try {
    init(cwd);
    prepareCommitGroundedEvalWorkspace({ repoRoot: REPO_ROOT, cwd });
    runImport(cwd, [...COMMIT_GROUNDED_EVAL_IMPORT_GLOBS]);
    const db = openDb(join(cwd, ".contexttrail", "cache", "contexttrail.db"));
    try {
      const cases = shadowCasesForPanel(AGENT_COMPLETION_CASES, REPO_ROOT).slice(
        0,
        limit,
      );
      if (cases.length === 0) {
        throw new Error("PRD-0050 full-panel shadow eval found no code-lane cases");
      }
      const report = runCodeContextShadowComparison({
        db,
        cases,
        adapters: createPrd0050FullPanelShadowAdapters(),
        candidateLimit: 30,
        topK: 3,
        evidenceScope: "full_panel_shadow",
      });
      process.stdout.write(
        renderPrd0050FullPanelVerdict(report, {
          baselineName: "PRD-0048 final",
        }),
      );
      const promotionVerdict = buildPrd0050PromotionVerdict(report, cases);
      if (promotionVerdict) {
        process.stdout.write("\n");
        process.stdout.write(promotionVerdict);
      }
    } finally {
      closeDb(db);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

if (
  process.argv[1]?.endsWith("prd-0050-full-panel-shadow.js") ||
  process.argv[1]?.endsWith("prd-0050-full-panel-shadow.ts")
) {
  void main().catch((err) => {
    process.stderr.write(
      `${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
