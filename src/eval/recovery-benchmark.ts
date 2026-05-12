#!/usr/bin/env node
/**
 * Recovery benchmark.
 *
 * Runs the existing real-corpus evals and asks one product question on
 * top of the raw retrieval metrics: would an agent safely answer, retry
 * with more context, ask for anchors, or abstain?
 *
 * This keeps low-signal recovery honest without building a separate
 * LLM-judge loop yet. The policy uses only the pack surface an agent can
 * see; the gold labels are used only to score whether that action was safe.
 */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { count as countTokens } from "../parse/tokens.js";
import type { PackReadinessState } from "../readiness/eval-readiness.js";
import { buildRecoveryPlan, type RecoveryAction } from "../readiness/recovery-plan.js";
import type { QueryIntent } from "./types.js";
import {
  realCorpusDocsPath,
  realCorpusRoot,
  runRealCorpusRetrievalEval,
  sourceFromContextTrail,
  type RealCorpusFailureClass,
  type RealCorpusObservation,
} from "./real-corpus-fixture.js";

export type RecoverySignal = {
  query_mode: "anchored" | "signal_empty" | "unanchored";
  coverage_confidence: "confident" | "uncertain" | "empty";
  pack_readiness: PackReadinessState;
};

export type RecoveryBenchmarkRow = {
  repo: string;
  id: string;
  query_intent: QueryIntent;
  isAnswerBearing: boolean;
  failureClass: RealCorpusFailureClass;
  top5Useful: boolean | null;
  action: RecoveryAction;
  coverage_confidence: "confident" | "uncertain" | "empty";
  pack_readiness: PackReadinessState;
  packTokensUsed: number;
  /** Oracle lower bound: token count of the gold source(s) needed to answer. */
  oracleGoldTokens: number;
  /** Pack overhead relative to the oracle lower bound, in tokens. */
  packGoldDeltaTokens: number;
  /** Pack cost divided by the oracle lower bound. 1.0 means on the floor. */
  packToGoldRatio: number;
  payloadBytes: number;
};

export type RecoveryBenchmarkSummary = {
  cases: number;
  answerBearingCases: number;
  signalEmptyCases: number;
  readyAnswers: number;
  recoveryNeeded: number;
  safeRecoveryActions: number;
  unsafeAnswers: number;
  signalEmptyHonest: number;
  avgPackTokens: number;
  avgOracleGoldTokens: number;
  avgPackGoldDeltaTokens: number;
  packToGoldRatio: number;
};

export type RecoveryBenchmarkReport = {
  repos: string[];
  rows: RecoveryBenchmarkRow[];
  summary: RecoveryBenchmarkSummary;
  byRepo: { repo: string; summary: RecoveryBenchmarkSummary }[];
};

export type RecoveryBenchmarkOptions = {
  repos?: string[];
};

export type RecoveryBenchmarkCliOptions = RecoveryBenchmarkOptions & {
  json?: boolean;
  reportOut?: string;
};

export function recommendRecoveryAction(signal: RecoverySignal): RecoveryAction {
  return buildRecoveryPlan({
    task: "",
    query_mode: signal.query_mode,
    coverage_confidence: signal.coverage_confidence,
    pack_readiness: signal.pack_readiness,
    reason_codes:
      signal.coverage_confidence === "uncertain" ? ["coverage_uncertain"] : [],
    missing_needs: [],
    warnings: [],
    ranked: signal.coverage_confidence === "empty"
      ? []
      : [{ contexttrail: "", score: 1, tokens: 1, kind: "chunk" }],
  }).action;
}

export function summarizeRecoveryRows(rows: RecoveryBenchmarkRow[]): RecoveryBenchmarkSummary {
  const cases = rows.length;
  const answerBearingCases = rows.filter((row) => row.isAnswerBearing).length;
  const signalEmptyRows = rows.filter((row) => !row.isAnswerBearing);
  const recoveryRows = rows.filter((row) => !row.isAnswerBearing || row.failureClass !== "none");
  const avgPackTokens = average(rows.map((row) => row.packTokensUsed));
  const avgOracleGoldTokens = average(rows.map((row) => row.oracleGoldTokens));
  const avgPackGoldDeltaTokens = average(rows.map((row) => row.packGoldDeltaTokens));

  return {
    cases,
    answerBearingCases,
    signalEmptyCases: signalEmptyRows.length,
    readyAnswers: rows.filter(
      (row) => row.isAnswerBearing && row.failureClass === "none" && row.action === "answer",
    ).length,
    recoveryNeeded: recoveryRows.length,
    safeRecoveryActions: recoveryRows.filter((row) => isSafeRecoveryAction(row)).length,
    unsafeAnswers: recoveryRows.filter((row) => isUnsafeAnswerAction(row)).length,
    signalEmptyHonest: signalEmptyRows.filter(
      (row) => row.coverage_confidence === "empty" || row.coverage_confidence === "uncertain",
    ).length,
    avgPackTokens,
    avgOracleGoldTokens,
    avgPackGoldDeltaTokens,
    packToGoldRatio: avgOracleGoldTokens === 0 ? 0 : avgPackTokens / avgOracleGoldTokens,
  };
}

function isAnswerAction(action: RecoveryAction): boolean {
  return action === "answer" || action === "answer_with_caveat";
}

function isSafeRecoveryAction(row: RecoveryBenchmarkRow): boolean {
  if (!isAnswerAction(row.action)) return true;
  if (!row.isAnswerBearing) return false;
  if (row.action === "answer") return row.failureClass === "none";
  return row.top5Useful === true;
}

function isUnsafeAnswerAction(row: RecoveryBenchmarkRow): boolean {
  return isAnswerAction(row.action) && !isSafeRecoveryAction(row);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function estimateOracleGoldTokens(repo: string, observation: RealCorpusObservation): number {
  if (!observation.isAnswerBearing) return 0;
  const sources = new Set(
    [observation.expectedTopSource, ...observation.mustIncludeSources]
      .map((source) => source.trim())
      .filter((source) => source.length > 0),
  );
  let total = 0;
  for (const source of sources) {
    try {
      total += countTokens(readFileSync(join(realCorpusDocsPath(repo), source), "utf8"));
    } catch {
      // Gold sources can be aliases in old fixtures. Treat missing files
      // as zero so the benchmark reports retrieval behavior instead of
      // failing on fixture housekeeping.
    }
  }
  return total;
}

export function toRecoveryBenchmarkRow(args: {
  repo: string;
  observation: RealCorpusObservation;
}): RecoveryBenchmarkRow {
  const { repo, observation } = args;
  const oracleGoldTokens = estimateOracleGoldTokens(repo, observation);
  const top5Useful = observationTop5Hit(observation);
  const action = observation.recovery_plan?.action ?? recommendRecoveryAction({
    query_mode: observation.actual_query_mode,
    coverage_confidence: observation.coverage_confidence,
    pack_readiness: observation.pack_readiness,
  });
  return {
    repo,
    id: observation.id,
    query_intent: observation.query_intent,
    isAnswerBearing: observation.isAnswerBearing,
    failureClass: observation.failureClass,
    top5Useful,
    action,
    coverage_confidence: observation.coverage_confidence,
    pack_readiness: observation.pack_readiness,
    packTokensUsed: observation.packTokensUsed,
    oracleGoldTokens,
    packGoldDeltaTokens: observation.packTokensUsed - oracleGoldTokens,
    packToGoldRatio: oracleGoldTokens === 0 ? 0 : observation.packTokensUsed / oracleGoldTokens,
    payloadBytes: observation.payloadBytes,
  };
}

function observationTop5Hit(observation: RealCorpusObservation): boolean | null {
  if (!observation.isAnswerBearing) return null;
  const accepted = new Set(observation.acceptableTopSources);
  const ranked = observation.top5 ?? observation.top3;
  return ranked.some(
    (entry) => entry.kind === "chunk" && accepted.has(sourceFromContextTrail(entry.contexttrail)),
  );
}

export function discoverRecoveryBenchmarkRepos(root = realCorpusRoot()): string[] {
  const repos: string[] = [];
  for (const name of readdirSync(root)) {
    if (!name.endsWith(".yaml") || name.endsWith(".config.yaml")) continue;
    const repo = name.replace(/\.yaml$/, "");
    try {
      if (statSync(join(root, repo)).isDirectory()) repos.push(repo);
    } catch {
      // Ignore config-only yaml files.
    }
  }
  return repos.sort();
}

export function serializeRecoveryBenchmarkReport(report: RecoveryBenchmarkReport): string {
  return JSON.stringify({ generated_at: new Date().toISOString(), ...report }, null, 2) + "\n";
}

export function renderRecoveryBenchmarkMarkdown(report: RecoveryBenchmarkReport): string {
  return renderRecoveryBenchmarkReport(report);
}

export function writeRecoveryBenchmarkReport(report: RecoveryBenchmarkReport, reportOut: string): void {
  const jsonPath = reportOut.endsWith(".json") ? reportOut : `${reportOut}.json`;
  const mdPath = reportOut.endsWith(".json") ? reportOut.replace(/\.json$/, ".md") : `${reportOut}.md`;
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, serializeRecoveryBenchmarkReport(report));
  writeFileSync(mdPath, renderRecoveryBenchmarkMarkdown(report));
}

export async function runRecoveryBenchmark(
  opts: RecoveryBenchmarkOptions = {},
): Promise<RecoveryBenchmarkReport> {
  const repos = opts.repos ?? discoverRecoveryBenchmarkRepos();
  const rows: RecoveryBenchmarkRow[] = [];
  for (const repo of repos) {
    const report = await runRealCorpusRetrievalEval({ repo });
    for (const observation of report.observations) {
      rows.push(toRecoveryBenchmarkRow({ repo, observation }));
    }
  }
  return {
    repos,
    rows,
    summary: summarizeRecoveryRows(rows),
    byRepo: repos.map((repo) => {
      const repoRows = rows.filter((row) => row.repo === repo);
      return {
        repo,
        summary: summarizeRecoveryRows(repoRows),
      };
    }),
  };
}

function pct(n: number, d: number): string {
  return d === 0 ? "-" : `${((n / d) * 100).toFixed(1)}%`;
}

function round(n: number): string {
  return String(Math.round(n));
}

function ratio(n: number): string {
  return n === 0 ? "-" : `${n.toFixed(2)}x`;
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((row) => row[i]!.length)));
  return rows.map((row) => row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ")).join("\n");
}

export function renderRecoveryBenchmarkReport(report: RecoveryBenchmarkReport): string {
  const s = report.summary;
  const lines: string[] = [];
  lines.push("Recovery benchmark");
  lines.push("");
  lines.push(`Repos: ${report.repos.join(", ") || "(none)"}`);
  lines.push(`Cases: ${s.cases}`);
  lines.push("");
  lines.push(
    table([
      ["Metric", "Result"],
      ["Answer-bearing cases", `${s.answerBearingCases}/${s.cases}`],
      ["Signal-empty cases", `${s.signalEmptyCases}/${s.cases}`],
      ["Clean ready answers", `${s.readyAnswers}/${s.answerBearingCases} (${pct(s.readyAnswers, s.answerBearingCases)})`],
      ["Recovery-needed cases", `${s.recoveryNeeded}/${s.cases} (${pct(s.recoveryNeeded, s.cases)})`],
      ["Safe recovery actions", `${s.safeRecoveryActions}/${s.recoveryNeeded} (${pct(s.safeRecoveryActions, s.recoveryNeeded)})`],
      ["Unsafe answers", `${s.unsafeAnswers}/${s.recoveryNeeded} (${pct(s.unsafeAnswers, s.recoveryNeeded)})`],
      ["Signal-empty honest", `${s.signalEmptyHonest}/${s.signalEmptyCases} (${pct(s.signalEmptyHonest, s.signalEmptyCases)})`],
      ["Avg pack tokens", round(s.avgPackTokens)],
      ["Avg oracle gold lower bound", round(s.avgOracleGoldTokens)],
      ["Avg pack - gold delta", round(s.avgPackGoldDeltaTokens)],
      ["Pack / oracle lower bound", ratio(s.packToGoldRatio)],
    ]),
  );
  lines.push("");
  lines.push("By repo");
  lines.push(
    table([
      ["Repo", "Cases", "Ready answers", "Safe recovery", "Unsafe answers", "Signal-empty honest", "Pack", "Oracle LB", "Pack/LB"],
      ...report.byRepo.map(({ repo, summary }) => [
        repo,
        String(summary.cases),
        `${summary.readyAnswers}/${summary.answerBearingCases}`,
        `${summary.safeRecoveryActions}/${summary.recoveryNeeded}`,
        `${summary.unsafeAnswers}/${summary.recoveryNeeded}`,
        `${summary.signalEmptyHonest}/${summary.signalEmptyCases}`,
        round(summary.avgPackTokens),
        round(summary.avgOracleGoldTokens),
        ratio(summary.packToGoldRatio),
      ]),
    ]),
  );

  const unsafe = report.rows.filter((row) => !row.isAnswerBearing || row.failureClass !== "none")
    .filter((row) => isUnsafeAnswerAction(row));
  lines.push("");
  lines.push(`Unsafe-answer cases: ${unsafe.length}`);
  for (const row of unsafe) {
    lines.push(
      `  ${row.repo}/${row.id}  fc=${row.failureClass}  readiness=${row.pack_readiness}  coverage=${row.coverage_confidence}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function parseRepos(argv: string[]): string[] | undefined {
  const repos: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--repo" && argv[i + 1]) {
      repos.push(...argv[i + 1]!.split(","));
      i += 1;
      continue;
    }
    if (arg.startsWith("--repo=")) {
      repos.push(...arg.slice("--repo=".length).split(","));
    }
  }
  const cleaned = repos.map((repo) => repo.trim()).filter((repo) => repo.length > 0);
  return cleaned.length === 0 ? undefined : cleaned;
}

function valueAfter(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const reportOut = valueAfter(argv, "--report-out");
  const report = await runRecoveryBenchmark({ repos: parseRepos(argv) });
  process.stdout.write(json ? serializeRecoveryBenchmarkReport(report) : renderRecoveryBenchmarkMarkdown(report));
  if (reportOut) {
    writeRecoveryBenchmarkReport(report, reportOut);
    process.stderr.write(`recovery report written: ${reportOut}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
