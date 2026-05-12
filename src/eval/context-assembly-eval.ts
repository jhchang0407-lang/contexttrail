#!/usr/bin/env node
/**
 * Real-corpus context assembly eval.
 *
 * This is deliberately one layer above source recall and one layer below
 * "agent completed the coding task." It asks whether the context we would
 * hand to an implementation agent contains the required sources at small,
 * fixed pack sizes.
 *
 * Scoring rules:
 *   - primary coverage: top-K contains at least one acceptable top source
 *   - support coverage: top-K contains every must_include_source
 *   - full coverage: both primary coverage and support coverage
 *
 * Signal-empty cases are excluded because they have no gold source to include.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { loadConfig } from "../config/load.js";
import { presentContextPack } from "../mcp/presenter.js";
import { retrieve, type RetrievalRequest } from "../retrieve/retrieve.js";
import { closeDb, openDb } from "../store/db.js";
import { listSourcesCanonical } from "../store/read-model.js";
import {
  classifyRealCorpusOutcome,
  createRealCorpusLab,
  loadRealCorpusEvalSet,
  realCorpusRoot,
  sourceFromContextTrail,
  type RealCorpusEvalCase,
} from "./real-corpus-fixture.js";

export type ContextAssemblyMode = {
  name: "top3_full" | "top5_full" | "top10_full";
  chunkLimit: number;
};

export const CONTEXT_ASSEMBLY_MODES: ContextAssemblyMode[] = [
  { name: "top3_full", chunkLimit: 3 },
  { name: "top5_full", chunkLimit: 5 },
  { name: "top10_full", chunkLimit: 10 },
];

export type ContextRankedChunk = {
  id: string;
  source: string;
  contexttrail: string;
  tokens: number;
  score: number;
};

export type ContextAssemblyRow = {
  repo: string;
  id: string;
  task: string;
  query_intent: string;
  assembly_need: string;
  mode: ContextAssemblyMode["name"];
  selectedChunks: number;
  selectedTokens: number;
  selectedSources: string[];
  acceptableSources: string[];
  mustIncludeSources: string[];
  primaryCovered: boolean;
  supportCoverage: number;
  supportCovered: boolean;
  fullCoverage: boolean;
  extraSources: string[];
  rank1Source: string;
};

export type ContextAssemblySummaryRow = {
  mode: ContextAssemblyMode["name"];
  cases: number;
  primaryCovered: number;
  supportCovered: number;
  fullCoverage: number;
  avgChunks: number;
  avgSources: number;
  avgTokens: number;
  p50Tokens: number;
  p90Tokens: number;
  maxTokens: number;
  avgExtraSources: number;
};

export type ContextAssemblyReport = {
  totalAnswerBearing: number;
  repos: string[];
  cohort?: string;
  rows: ContextAssemblyRow[];
  summary: ContextAssemblySummaryRow[];
};

export type ContextAssemblyCohortEntry = {
  repo: string;
  id: string;
  miss: "primary" | "support" | "primary_support";
  notes: string;
};

export type ContextAssemblyEvalOptions = {
  cohort?: string;
};

function pct(n: number, total: number): string {
  return total === 0 ? "—" : `${((n / total) * 100).toFixed(1)}%`;
}

function round(n: number): string {
  return String(Math.round(n));
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index] ?? 0;
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((row) => row[i]!.length)));
  return rows.map((row) => row.map((cell, i) => cell.padEnd(widths[i]!)).join("  ")).join("\n");
}

export function evaluateContextSelection(args: {
  repo: string;
  entry: Pick<
    RealCorpusEvalCase,
    "id" | "task" | "query_intent" | "assembly_need" | "expected_top_source" | "acceptable_top_sources" | "must_include_sources"
  >;
  mode: ContextAssemblyMode;
  rankedChunks: ContextRankedChunk[];
}): ContextAssemblyRow {
  const selected = args.rankedChunks.slice(0, args.mode.chunkLimit);
  const selectedSources = unique(selected.map((chunk) => chunk.source));
  const selectedSourceSet = new Set(selectedSources);
  const acceptableSources = args.entry.acceptable_top_sources ?? [args.entry.expected_top_source];
  const mustIncludeSources = args.entry.must_include_sources;
  const primaryCovered = acceptableSources.some((source) => selectedSourceSet.has(source));
  const mustHits = mustIncludeSources.filter((source) => selectedSourceSet.has(source));
  const supportCoverage =
    mustIncludeSources.length === 0 ? 1 : mustHits.length / mustIncludeSources.length;
  const supportCovered = supportCoverage === 1;
  const allowedSources = new Set([...acceptableSources, ...mustIncludeSources]);
  const extraSources = selectedSources.filter((source) => !allowedSources.has(source));

  return {
    repo: args.repo,
    id: args.entry.id,
    task: args.entry.task,
    query_intent: args.entry.query_intent,
    assembly_need: args.entry.assembly_need,
    mode: args.mode.name,
    selectedChunks: selected.length,
    selectedTokens: selected.reduce((sum, chunk) => sum + chunk.tokens, 0),
    selectedSources,
    acceptableSources,
    mustIncludeSources,
    primaryCovered,
    supportCoverage,
    supportCovered,
    fullCoverage: primaryCovered && supportCovered,
    extraSources,
    rank1Source: args.rankedChunks[0]?.source ?? "(none)",
  };
}

export function summarizeContextAssembly(rows: ContextAssemblyRow[]): ContextAssemblySummaryRow[] {
  return CONTEXT_ASSEMBLY_MODES.map((mode) => {
    const modeRows = rows.filter((row) => row.mode === mode.name);
    const cases = modeRows.length;
    const tokenValues = modeRows.map((row) => row.selectedTokens).sort((a, b) => a - b);
    return {
      mode: mode.name,
      cases,
      primaryCovered: modeRows.filter((row) => row.primaryCovered).length,
      supportCovered: modeRows.filter((row) => row.supportCovered).length,
      fullCoverage: modeRows.filter((row) => row.fullCoverage).length,
      avgChunks: cases === 0 ? 0 : modeRows.reduce((sum, row) => sum + row.selectedChunks, 0) / cases,
      avgSources: cases === 0 ? 0 : modeRows.reduce((sum, row) => sum + row.selectedSources.length, 0) / cases,
      avgTokens: cases === 0 ? 0 : modeRows.reduce((sum, row) => sum + row.selectedTokens, 0) / cases,
      p50Tokens: percentile(tokenValues, 0.5),
      p90Tokens: percentile(tokenValues, 0.9),
      maxTokens: tokenValues[tokenValues.length - 1] ?? 0,
      avgExtraSources: cases === 0 ? 0 : modeRows.reduce((sum, row) => sum + row.extraSources.length, 0) / cases,
    };
  });
}

export function renderContextAssemblyReport(report: ContextAssemblyReport): string {
  const lines: string[] = [];
  lines.push("Real-corpus context assembly eval");
  lines.push("");
  if (report.cohort !== undefined) lines.push(`Cohort: ${report.cohort}`);
  lines.push(`Repos: ${report.repos.length}`);
  lines.push(`Answer-bearing cases: ${report.totalAnswerBearing}`);
  lines.push("");
  lines.push(
    table([
      [
        "Mode",
        "Full coverage",
        "Primary",
        "Support",
        "Avg chunks",
        "Avg sources",
        "Avg tokens",
        "P90 tokens",
        "Max tokens",
        "Avg extras",
      ],
      ...report.summary.map((row) => [
        row.mode,
        `${row.fullCoverage}/${row.cases} (${pct(row.fullCoverage, row.cases)})`,
        `${row.primaryCovered}/${row.cases} (${pct(row.primaryCovered, row.cases)})`,
        `${row.supportCovered}/${row.cases} (${pct(row.supportCovered, row.cases)})`,
        row.avgChunks.toFixed(1),
        row.avgSources.toFixed(1),
        round(row.avgTokens),
        round(row.p90Tokens),
        round(row.maxTokens),
        row.avgExtraSources.toFixed(1),
      ]),
    ]),
  );

  const byMode = new Map(report.summary.map((row) => [row.mode, row]));
  const top3 = byMode.get("top3_full");
  const top5 = byMode.get("top5_full");
  const top10 = byMode.get("top10_full");
  if (top3 && top5 && top10) {
    const top3Rows = new Map(
      report.rows
        .filter((row) => row.mode === "top3_full")
        .map((row) => [`${row.repo}/${row.id}`, row]),
    );
    const top5Rows = report.rows.filter((row) => row.mode === "top5_full");
    const top10Rows = new Map(
      report.rows
        .filter((row) => row.mode === "top10_full")
        .map((row) => [`${row.repo}/${row.id}`, row]),
    );
    const newVsTop3 = top5Rows.filter((row) => {
      const key = `${row.repo}/${row.id}`;
      return row.fullCoverage && top3Rows.get(key)?.fullCoverage === false;
    });
    const newVsTop5At10 = [...top10Rows.entries()].filter(([key, row]) => {
      return row.fullCoverage && top5Rows.find((r) => `${r.repo}/${r.id}` === key)?.fullCoverage === false;
    });
    lines.push("");
    lines.push("Top-5 read");
    lines.push(`- top-5 adds ${newVsTop3.length} full-coverage wins over top-3`);
    lines.push(`- top-10 adds ${newVsTop5At10.length} full-coverage wins over top-5`);
    lines.push(
      `- top-5 token mass: avg ${round(top5.avgTokens)}, p90 ${round(top5.p90Tokens)}, max ${round(top5.maxTokens)}`,
    );
  }

  const top5Misses = report.rows
    .filter((row) => row.mode === "top5_full" && !row.fullCoverage)
    .sort((a, b) => `${a.repo}/${a.id}`.localeCompare(`${b.repo}/${b.id}`));
  lines.push("");
  lines.push(`Top-5 full-coverage misses: ${top5Misses.length}`);
  for (const row of top5Misses) {
    const missingPrimary = row.primaryCovered ? "" : "primary";
    const missingSupport = row.supportCovered ? "" : "support";
    const missing = [missingPrimary, missingSupport].filter(Boolean).join("+") || "unknown";
    lines.push(`  ${row.repo}/${row.id}  miss=${missing}  intent=${row.query_intent}  need=${row.assembly_need}`);
    lines.push(`    rank-1:    ${row.rank1Source}`);
    lines.push(`    expected:  ${row.acceptableSources.join(" | ")}`);
    if (row.mustIncludeSources.length > 0) {
      lines.push(`    must:      ${row.mustIncludeSources.join(" | ")}`);
    }
    lines.push(`    selected:  ${row.selectedSources.join(" | ") || "(none)"}`);
  }

  return lines.join("\n") + "\n";
}

function discoverRealCorpusRepos(): string[] {
  const root = realCorpusRoot();
  const repos: string[] = [];
  for (const name of readdirSync(root)) {
    if (!name.endsWith(".yaml") || name.endsWith(".config.yaml")) continue;
    const repo = name.replace(/\.yaml$/, "");
    try {
      if (statSync(join(root, repo)).isDirectory()) repos.push(repo);
    } catch {
      // Ignore config-only YAMLs or stale entries without a corpus folder.
    }
  }
  return repos.sort();
}

function cohortPath(name: string): string {
  return join(realCorpusRoot(), "cohorts", `${name}.yaml`);
}

export function loadContextAssemblyCohort(name: string): ContextAssemblyCohortEntry[] {
  const parsed = YAML.parse(readFileSync(cohortPath(name), "utf8")) as ContextAssemblyCohortEntry[];
  if (!Array.isArray(parsed)) {
    throw new Error(`Context assembly cohort '${name}' must be a YAML array`);
  }
  for (const entry of parsed) {
    if (!entry.repo || !entry.id) {
      throw new Error(`Context assembly cohort '${name}' contains an entry without repo/id`);
    }
    if (!["primary", "support", "primary_support"].includes(entry.miss)) {
      throw new Error(
        `Context assembly cohort '${name}' entry '${entry.repo}/${entry.id}' has unknown miss '${entry.miss}'`,
      );
    }
  }
  return parsed;
}

export async function runContextAssemblyEval(
  opts: ContextAssemblyEvalOptions = {},
): Promise<ContextAssemblyReport> {
  const cohort = opts.cohort ? loadContextAssemblyCohort(opts.cohort) : undefined;
  const cohortIdsByRepo = new Map<string, Set<string>>();
  if (cohort !== undefined) {
    for (const entry of cohort) {
      const ids = cohortIdsByRepo.get(entry.repo) ?? new Set<string>();
      ids.add(entry.id);
      cohortIdsByRepo.set(entry.repo, ids);
    }
  }
  const repos = cohort === undefined ? discoverRealCorpusRepos() : [...cohortIdsByRepo.keys()].sort();
  const rows: ContextAssemblyRow[] = [];
  let totalAnswerBearing = 0;

  for (const repo of repos) {
    const cases = loadRealCorpusEvalSet(repo).filter((entry) => {
      const cohortIds = cohortIdsByRepo.get(repo);
      return cohortIds === undefined || cohortIds.has(entry.id);
    });
    const observedIds = new Set(cases.map((entry) => entry.id));
    const expectedIds = cohortIdsByRepo.get(repo);
    if (expectedIds !== undefined) {
      const missing = [...expectedIds].filter((id) => !observedIds.has(id));
      if (missing.length > 0) {
        throw new Error(`Context assembly cohort '${opts.cohort}' references missing cases for ${repo}: ${missing.join(", ")}`);
      }
    }
    const lab = createRealCorpusLab(repo);
    try {
      lab.importCorpus();
      const db = openDb(join(lab.cwd, ".contexttrail", "cache", "contexttrail.db"));
      try {
        const config = loadConfig(lab.cwd);
        const importedSources = new Set(listSourcesCanonical(db).map((source) => source.source_path));
        const budgets = config.retrieval.budgets;
        for (const entry of cases) {
          const request: RetrievalRequest = {
            task: entry.task,
            query_anchors: { files: entry.files ?? [], symbols: entry.symbols ?? [], routes: entry.routes ?? [] },
            budget: entry.budget ?? "default",
            expected_locked: [],
            explain: false,
          };
          const result = retrieve(db, request, config);
          const response = presentContextPack({
            query: entry.task,
            result,
            requested_budget: budgets[entry.budget ?? "default"],
            has_sources: importedSources.size > 0,
            explain: false,
            min_final_score: config.retrieval.min_final_score,
          });
          const acceptableTopSources = entry.acceptable_top_sources ?? [entry.expected_top_source];
          const classification = classifyRealCorpusOutcome({
            expectation_kind: entry.expectation_kind,
            expected_query_mode: entry.expected_query_mode,
            expected_signal_empty_warning: entry.expected_signal_empty_warning,
            expected_top_source: entry.expected_top_source,
            acceptableTopSources,
            mustIncludeSources: entry.must_include_sources,
            actual_query_mode: response.query_mode,
            coverage_confidence: response.coverage_confidence,
            ranked: response.ranked.map((ranked) => ({ kind: ranked.kind, contexttrail: ranked.contexttrail })),
          });
          if (!classification.isAnswerBearing) continue;
          totalAnswerBearing += 1;

          const rankedChunks: ContextRankedChunk[] = response.ranked
            .filter((ranked) => ranked.kind === "chunk")
            .map((ranked) => ({
              id: ranked.id,
              source: sourceFromContextTrail(ranked.contexttrail),
              contexttrail: ranked.contexttrail,
              tokens: ranked.tokens,
              score: ranked.score,
            }));
          for (const mode of CONTEXT_ASSEMBLY_MODES) {
            rows.push(evaluateContextSelection({ repo, entry, mode, rankedChunks }));
          }
        }
      } finally {
        closeDb(db);
      }
    } finally {
      lab.cleanup();
    }
  }

  return {
    totalAnswerBearing,
    repos,
    ...(opts.cohort !== undefined ? { cohort: opts.cohort } : {}),
    rows,
    summary: summarizeContextAssembly(rows),
  };
}

async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  const cohort = valueAfter("--cohort");
  const report = await runContextAssemblyEval({ cohort });
  process.stdout.write(
    json
      ? `${JSON.stringify(report, null, 2)}\n`
      : renderContextAssemblyReport(report),
  );
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
