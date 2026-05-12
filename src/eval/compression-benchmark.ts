#!/usr/bin/env node
import { ConfigSchema, type ContextTrailConfig } from "../config/defaults.js";
import { runFixtureRetrievalEval } from "./retrieval-fixture.js";
import type { EvalReport } from "./types.js";
import { fileURLToPath } from "node:url";

export type BudgetProfile = {
  name: string;
  budgets: ContextTrailConfig["retrieval"]["budgets"];
};

export type CompressionRow = {
  name: string;
  requestedDefault: number;
  avgUsed: number;
  avgRankedTokens: number;
  overallTop1: number;
  anchoredTop1: number;
  unanchoredTop1: number;
  mustAt3: number;
  balance: number;
  rankedUseful: number;
};

export const PROFILES: BudgetProfile[] = [
  { name: "full", budgets: { small: 4000, default: 6000, large: 10000 } },
  { name: "compact_5k", budgets: { small: 3500, default: 5000, large: 8000 } },
  { name: "compact_4k", budgets: { small: 3000, default: 4000, large: 7000 } },
  { name: "compact_3k", budgets: { small: 2500, default: 3000, large: 6000 } },
  { name: "compact_2_5k", budgets: { small: 2000, default: 2500, large: 5000 } },
  { name: "compact_2k", budgets: { small: 1500, default: 2000, large: 4000 } },
  { name: "compact_1_5k", budgets: { small: 1000, default: 1500, large: 3000 } },
  { name: "compact_1k", budgets: { small: 750, default: 1000, large: 2000 } },
  { name: "compact_750", budgets: { small: 500, default: 750, large: 1500 } },
  { name: "compact_500", budgets: { small: 350, default: 500, large: 1000 } },
];

export function withBudgets(budgets: ContextTrailConfig["retrieval"]["budgets"]): ContextTrailConfig {
  const base = ConfigSchema.parse({});
  return {
    ...base,
    retrieval: {
      ...base.retrieval,
      budgets,
    },
  };
}

function pct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function round(value: number): string {
  return String(Math.round(value));
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((row) => row[i]!.length)));
  return rows
    .map((row) => row.map((cell, i) => cell.padEnd(widths[i]!)).join("  "))
    .join("\n");
}

export function summarizeCompressionRow(
  name: string,
  requestedDefault: number,
  report: EvalReport,
): CompressionRow {
  const allAssembly = requiredRow(report.assembly_summary.bucket, "all");
  const anchoredAssembly = requiredRow(report.assembly_summary.bucket, "anchored");
  const unanchoredAssembly = requiredRow(report.assembly_summary.bucket, "unanchored");
  const allTokens = requiredRow(report.token_summary.bucket, "all");
  const allRetrieval = requiredRow(report.summary.bucket, "all");
  return {
    name,
    requestedDefault,
    avgUsed: allTokens.avgPackTokensUsed,
    avgRankedTokens: allTokens.avgRankedTokens,
    overallTop1: allAssembly.top1Acceptable,
    anchoredTop1: anchoredAssembly.top1Acceptable,
    unanchoredTop1: unanchoredAssembly.top1Acceptable,
    mustAt3: allAssembly.top3MustIncludeCoverage,
    balance: allAssembly.top3SourceBalance,
    rankedUseful: allRetrieval.rankedUseful,
  };
}

function requiredRow<T>(rows: Record<string, T>, key: string): T {
  const row = rows[key];
  if (!row) throw new Error(`missing benchmark row: ${key}`);
  return row;
}

export function renderCompressionBenchmark(rows: CompressionRow[]): string {
  const baseline = rows[0]!;
  const lines: string[] = [];
  lines.push("Compression benchmark");
  lines.push("");
  lines.push(table([
    ["Profile", "Default budget", "Avg used", "Avg ranked", "Top1", "Anchored T1", "Unanchored T1", "Must@3", "Balance", "Ranked useful"],
    ...rows.map((row) => [
      row.name,
      round(row.requestedDefault),
      round(row.avgUsed),
      round(row.avgRankedTokens),
      pct(row.overallTop1),
      pct(row.anchoredTop1),
      pct(row.unanchoredTop1),
      pct(row.mustAt3),
      pct(row.balance),
      pct(row.rankedUseful),
    ]),
  ]));
  lines.push("");
  lines.push("Delta vs full");
  lines.push("");
  lines.push(table([
    ["Profile", "Avg used", "Top1", "Anchored T1", "Unanchored T1", "Must@3", "Balance", "Ranked useful"],
    ...rows.slice(1).map((row) => [
      row.name,
      `${Math.round(row.avgUsed - baseline.avgUsed)}`,
      `${Math.round((row.overallTop1 - baseline.overallTop1) * 1000) / 10} pts`,
      `${Math.round((row.anchoredTop1 - baseline.anchoredTop1) * 1000) / 10} pts`,
      `${Math.round((row.unanchoredTop1 - baseline.unanchoredTop1) * 1000) / 10} pts`,
      `${Math.round((row.mustAt3 - baseline.mustAt3) * 1000) / 10} pts`,
      `${Math.round((row.balance - baseline.balance) * 1000) / 10} pts`,
      `${Math.round((row.rankedUseful - baseline.rankedUseful) * 1000) / 10} pts`,
    ]),
  ]));

  const acceptable = rows.slice(1).filter((row) =>
    row.anchoredTop1 >= baseline.anchoredTop1 - 0.03 &&
    row.unanchoredTop1 >= baseline.unanchoredTop1 - 0.05 &&
    row.mustAt3 >= baseline.mustAt3 - 0.01 &&
    row.balance >= baseline.balance - 0.05 &&
    row.rankedUseful >= baseline.rankedUseful - 0.01,
  );
  lines.push("");
  lines.push("Recommended cutoff");
  lines.push(
    acceptable.length === 0
      ? "- none of the tighter profiles stayed within the current guardrails"
      : `- ${acceptable[acceptable.length - 1]!.name} (${acceptable[acceptable.length - 1]!.requestedDefault} default tokens) is the tightest profile that stayed within the current guardrails`,
  );
  return lines.join("\n");
}

export async function runCompressionBenchmark(profiles: BudgetProfile[] = PROFILES): Promise<CompressionRow[]> {
  const reports: { profile: BudgetProfile; report: EvalReport }[] = [];
  for (const profile of profiles) {
    const report = await runFixtureRetrievalEval({ configOverride: withBudgets(profile.budgets) });
    reports.push({ profile, report });
  }
  return reports.map(({ profile, report }) =>
    summarizeCompressionRow(profile.name, profile.budgets.default, report),
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const rows = await runCompressionBenchmark();

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          rows,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    process.stdout.write(renderCompressionBenchmark(rows) + "\n");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
