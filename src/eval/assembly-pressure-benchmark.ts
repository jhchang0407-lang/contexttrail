#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { createHandlers } from "../mcp/handlers.js";
import { EVAL_SET, validateEvalSet } from "./corpus.js";
import { createEvalFixtureLab } from "./lab.js";

type RankedEntry = {
  id: string;
  kind: "chunk" | "card" | "code";
  contexttrail: string;
  tokens: number;
};

export type PressureScenario = {
  name: string;
  targetBudget: number;
  expansionFactor: number;
};

export type PressureRow = {
  cohort: "all" | "neighbor_heavy";
  name: string;
  targetBudget: number;
  expansionFactor: number;
  top1Retained: number;
  mustIncludeCoverage: number;
  top3Balance: number;
  avgRetainedEntries: number;
  avgRetainedTokens: number;
};

export const PRESSURE_SCENARIOS: PressureScenario[] = [
  { name: "5k_x2", targetBudget: 5000, expansionFactor: 2 },
  { name: "5k_x4", targetBudget: 5000, expansionFactor: 4 },
  { name: "5k_x6", targetBudget: 5000, expansionFactor: 6 },
  { name: "8k_x4", targetBudget: 8000, expansionFactor: 4 },
  { name: "8k_x6", targetBudget: 8000, expansionFactor: 6 },
  { name: "12k_x6", targetBudget: 12000, expansionFactor: 6 },
];

function pct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function round(value: number): string {
  return String(Math.round(value));
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((row) => row[i]!.length)));
  return rows.map((row) => row.map((cell, i) => cell.padEnd(widths[i]!)).join("  ")).join("\n");
}

function sourceFromContextTrail(contexttrail: string): string | undefined {
  const match = contexttrail.match(/^Source: (.+?) > Section:/);
  return match?.[1];
}

export function syntheticRetainedRanked(
  ranked: RankedEntry[],
  lockedTokens: number,
  scenario: PressureScenario,
): RankedEntry[] {
  const available = Math.max(0, scenario.targetBudget - lockedTokens);
  const kept: RankedEntry[] = [];
  let used = 0;
  for (const entry of ranked) {
    const expandedTokens = Math.max(entry.tokens, Math.round(entry.tokens * scenario.expansionFactor));
    if (used + expandedTokens > available) continue;
    kept.push(entry);
    used += expandedTokens;
  }
  return kept;
}

function mustIncludeCoverage(
  retained: RankedEntry[],
  mustIncludeSources: string[],
): number {
  if (mustIncludeSources.length === 0) return 1;
  const hits = mustIncludeSources.filter((source) =>
    retained.some((entry) => entry.kind === "chunk" && entry.contexttrail.includes(source)),
  );
  return hits.length / mustIncludeSources.length;
}

function top3Balance(retained: RankedEntry[]): number {
  const top3Sources = retained
    .slice(0, 3)
    .filter((entry) => entry.kind === "chunk")
    .map((entry) => sourceFromContextTrail(entry.contexttrail))
    .filter((source): source is string => source !== undefined);
  if (top3Sources.length <= 1) return 1;
  return new Set(top3Sources).size / top3Sources.length;
}

export function summarizePressureScenario(
  cohort: "all" | "neighbor_heavy",
  name: string,
  targetBudget: number,
  expansionFactor: number,
  rows: Array<{
    originalTop1?: string;
    retained: RankedEntry[];
    mustIncludeSources: string[];
  }>,
): PressureRow {
  const cases = rows.length || 1;
  return {
    cohort,
    name,
    targetBudget,
    expansionFactor,
    top1Retained:
      rows.filter((row) => row.originalTop1 !== undefined && row.retained[0]?.id === row.originalTop1).length /
      cases,
    mustIncludeCoverage:
      rows.reduce((sum, row) => sum + mustIncludeCoverage(row.retained, row.mustIncludeSources), 0) / cases,
    top3Balance: rows.reduce((sum, row) => sum + top3Balance(row.retained), 0) / cases,
    avgRetainedEntries: rows.reduce((sum, row) => sum + row.retained.length, 0) / cases,
    avgRetainedTokens:
      rows.reduce(
        (sum, row) =>
          sum +
          row.retained.reduce(
            (entrySum, entry) => entrySum + Math.max(entry.tokens, Math.round(entry.tokens * expansionFactor)),
            0,
          ),
        0,
      ) / cases,
  };
}

export function renderAssemblyPressureBenchmark(rows: PressureRow[]): string {
  const lines: string[] = [];
  lines.push("Assembly pressure benchmark");
  lines.push("");
  for (const cohort of ["all", "neighbor_heavy"] as const) {
    const cohortRows = rows.filter((row) => row.cohort === cohort);
    if (cohortRows.length === 0) continue;
    lines.push(cohort === "all" ? "All cases" : "Neighbor-heavy cases");
    lines.push("");
    lines.push(
      table([
        ["Scenario", "Budget", "Factor", "Top1 retained", "Must coverage", "Top3 balance", "Avg retained", "Avg synthetic tokens"],
        ...cohortRows.map((row) => [
          row.name,
          round(row.targetBudget),
          `${row.expansionFactor}x`,
          pct(row.top1Retained),
          pct(row.mustIncludeCoverage),
          pct(row.top3Balance),
          round(row.avgRetainedEntries),
          round(row.avgRetainedTokens),
        ]),
      ]),
    );
    lines.push("");
    lines.push(cohort === "all" ? "Recommended pressure target" : "Recommended heavy-case pressure target");
    const viable = cohortRows.filter(
      (row) =>
        row.top1Retained >= 0.95 &&
        row.mustIncludeCoverage >= 0.98 &&
        row.top3Balance >= 0.9,
    );
    lines.push(
      viable.length === 0
        ? "- none of the pressure scenarios stayed inside the current guardrails"
        : `- ${viable[viable.length - 1]!.name} is the strongest surrounding-context pressure that stayed inside the current guardrails`,
    );
    lines.push("");
  }
  lines.pop();
  return lines.join("\n");
}

export async function runAssemblyPressureBenchmark(
  scenarios: PressureScenario[] = PRESSURE_SCENARIOS,
): Promise<PressureRow[]> {
  validateEvalSet(EVAL_SET);
  const lab = createEvalFixtureLab();
  try {
    lab.importCorpus();
    const handlers = createHandlers({ cwd: lab.cwd });
    const scenarioRows = new Map<string, Array<{ originalTop1?: string; retained: RankedEntry[]; mustIncludeSources: string[] }>>();
    const heavyScenarioRows = new Map<string, Array<{ originalTop1?: string; retained: RankedEntry[]; mustIncludeSources: string[] }>>();
    for (const scenario of scenarios) {
      scenarioRows.set(scenario.name, []);
      heavyScenarioRows.set(scenario.name, []);
    }

    for (const entry of EVAL_SET) {
      const response = await handlers.retrieve_context_pack({
        task: entry.task,
        files: entry.files,
        symbols: entry.symbols,
        routes: entry.routes,
        budget: entry.budget,
        expected_locked: entry.expected_locked,
        explain: false,
      });
      const ranked: RankedEntry[] = response.ranked.map((item) => ({
        id: item.id,
        kind: item.kind,
        contexttrail: item.contexttrail,
        tokens: item.tokens,
      }));
      const lockedTokens = response.locked.reduce((sum, item) => sum + item.tokens, 0);
      const originalTop1 = ranked[0]?.id;
      for (const scenario of scenarios) {
        const row = {
          originalTop1,
          retained: syntheticRetainedRanked(ranked, lockedTokens, scenario),
          mustIncludeSources: entry.must_include_sources,
        };
        scenarioRows.get(scenario.name)!.push(row);
        if (entry.must_include_sources.length >= 3) {
          heavyScenarioRows.get(scenario.name)!.push(row);
        }
      }
    }

    const rows: PressureRow[] = [];
    for (const scenario of scenarios) {
      rows.push(
        summarizePressureScenario(
          "all",
          scenario.name,
          scenario.targetBudget,
          scenario.expansionFactor,
          scenarioRows.get(scenario.name)!,
        ),
      );
      rows.push(
        summarizePressureScenario(
          "neighbor_heavy",
          scenario.name,
          scenario.targetBudget,
          scenario.expansionFactor,
          heavyScenarioRows.get(scenario.name)!,
        ),
      );
    }
    return rows;
  } finally {
    lab.cleanup();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const rows = await runAssemblyPressureBenchmark();
  if (json) {
    process.stdout.write(JSON.stringify({ generated_at: new Date().toISOString(), rows }, null, 2) + "\n");
  } else {
    process.stdout.write(renderAssemblyPressureBenchmark(rows) + "\n");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
