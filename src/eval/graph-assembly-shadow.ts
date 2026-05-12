#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, openDb } from "../store/db.js";
import { listSourceProfiles } from "../store/source-profiles.js";
import type { SourceProfile } from "../types/source-profile.js";
import { createHandlers } from "../mcp/handlers.js";
import {
  createRealCorpusLab,
  loadRealCorpusEvalSet,
  realCorpusRoot,
} from "./real-corpus-fixture.js";

export type GraphAssemblyMode =
  | "top1_nav_explicit"
  | "top3_nav_explicit"
  | "top1_nav_all"
  | "top3_nav_all";

export type GraphAssemblySelection = {
  mode: GraphAssemblyMode;
  selectedSources: string[];
  selectedTokens: number;
  expansionReasons: Record<string, string[]>;
};

export type GraphAssemblyShadowRow = {
  repo: string;
  id: string;
  requiredSources: string[];
  top1Sources: string[];
  top3Sources: string[];
  modes: Record<GraphAssemblyMode, GraphAssemblySelection>;
};

export type GraphAssemblyModeSummary = {
  mode: GraphAssemblyMode;
  cases: number;
  seedFullCoverageCases: number;
  fullCoverageCases: number;
  newlyCoveredVsSeed: number;
  newlyCoveredVsTop3: number;
  avgRequiredCoverage: number;
  avgSelectedSources: number;
  avgSelectedTokens: number;
  avgExtraSources: number;
};

export type GraphAssemblyShadowReport = {
  generated_at: string;
  repos: string[];
  cases: number;
  summaries: GraphAssemblyModeSummary[];
  rows: GraphAssemblyShadowRow[];
};

const MODES: GraphAssemblyMode[] = [
  "top1_nav_explicit",
  "top3_nav_explicit",
  "top1_nav_all",
  "top3_nav_all",
];

const MAX_SOURCES = 5;

export function expandGraphAssemblySources(args: {
  mode: GraphAssemblyMode;
  seedSources: string[];
  profiles: SourceProfile[];
  maxSources?: number;
}): GraphAssemblySelection {
  const maxSources = args.maxSources ?? MAX_SOURCES;
  const byPath = new Map(args.profiles.map((p) => [p.source_path, p]));
  const selected: string[] = [];
  const selectedSet = new Set<string>();
  const reasons = new Map<string, string[]>();

  const allowStructural = args.mode.endsWith("_all");
  const add = (source: string, reason: string) => {
    if (!source || !byPath.has(source)) return;
    const arr = reasons.get(source) ?? [];
    arr.push(reason);
    reasons.set(source, arr);
    if (selectedSet.has(source)) return;
    if (selected.length >= maxSources) return;
    selected.push(source);
    selectedSet.add(source);
  };

  for (const seed of args.seedSources) add(seed, "seed");

  for (const seed of args.seedSources) {
    const profile = byPath.get(seed);
    if (!profile?.nav_section_id) continue;
    if (!isAllowedProfile(profile, allowStructural)) continue;

    const section = args.profiles
      .filter((p) => p.nav_section_id === profile.nav_section_id)
      .filter((p) => isAllowedProfile(p, allowStructural))
      .sort(compareNavOrder);

    const landing =
      section.find((p) => p.is_nav_landing === true && p.nav_provenance === "explicit_config") ??
      (allowStructural ? section[0] : undefined);
    if (landing) add(landing.source_path, `nav_landing:${profile.nav_section_id}`);

    const idx = section.findIndex((p) => p.source_path === seed);
    if (idx >= 0) {
      const previous = section[idx - 1];
      const next = section[idx + 1];
      if (previous) add(previous.source_path, `nav_previous:${profile.nav_section_id}`);
      if (next) add(next.source_path, `nav_next:${profile.nav_section_id}`);
    }
  }

  const selectedTokens = selected.reduce(
    (sum, source) => sum + (byPath.get(source)?.token_count ?? 0),
    0,
  );
  return {
    mode: args.mode,
    selectedSources: selected,
    selectedTokens,
    expansionReasons: Object.fromEntries(reasons),
  };
}

export async function runGraphAssemblyShadowEval(
  repos = discoverRealCorpusRepos(),
): Promise<GraphAssemblyShadowReport> {
  const rows: GraphAssemblyShadowRow[] = [];
  for (const repo of repos) {
    const cases = loadRealCorpusEvalSet(repo);
    const lab = createRealCorpusLab(repo);
    try {
      lab.importCorpus();
      const handlers = createHandlers({ cwd: lab.cwd });
      const db = openDb(join(lab.cwd, ".contexttrail/cache/contexttrail.db"));
      try {
        const profiles = listSourceProfiles(db);
        for (const entry of cases) {
          if (entry.must_include_sources.length === 0) continue;
          const response = await handlers.retrieve_context_pack({
            task: entry.task,
            files: entry.files,
            symbols: entry.symbols,
            routes: entry.routes,
            budget: entry.budget,
            expected_locked: [],
            explain: false,
          });
          const topSources = unique(
            response.ranked
              .filter((r) => r.kind === "chunk")
              .map((r) => sourceFromContextTrail(r.contexttrail))
              .filter((source): source is string => source !== undefined),
          );
          const top1Sources = topSources.slice(0, 1);
          const top3Sources = topSources.slice(0, 3);
          const modes = Object.fromEntries(
            MODES.map((mode) => [
              mode,
              expandGraphAssemblySources({
                mode,
                seedSources: mode.startsWith("top1") ? top1Sources : top3Sources,
                profiles,
              }),
            ]),
          ) as Record<GraphAssemblyMode, GraphAssemblySelection>;
          rows.push({
            repo,
            id: entry.id,
            requiredSources: entry.must_include_sources,
            top1Sources,
            top3Sources,
            modes,
          });
        }
      } finally {
        closeDb(db);
      }
    } finally {
      lab.cleanup();
    }
  }

  return {
    generated_at: new Date().toISOString(),
    repos,
    cases: rows.length,
    summaries: MODES.map((mode) => summarizeMode(mode, rows)),
    rows,
  };
}

export function summarizeMode(
  mode: GraphAssemblyMode,
  rows: GraphAssemblyShadowRow[],
): GraphAssemblyModeSummary {
  const cases = rows.length || 1;
  let seedFullCoverageCases = 0;
  let fullCoverageCases = 0;
  let newlyCoveredVsSeed = 0;
  let newlyCoveredVsTop3 = 0;
  let coverageSum = 0;
  let selectedSourceSum = 0;
  let selectedTokenSum = 0;
  let extraSourceSum = 0;

  for (const row of rows) {
    const selected = row.modes[mode].selectedSources;
    const seedSources = mode.startsWith("top1") ? row.top1Sources : row.top3Sources;
    const selectedCoverage = requiredCoverage(selected, row.requiredSources);
    const seedCoverage = requiredCoverage(seedSources, row.requiredSources);
    const top3Coverage = requiredCoverage(row.top3Sources, row.requiredSources);
    if (seedCoverage === 1) seedFullCoverageCases += 1;
    if (selectedCoverage === 1) fullCoverageCases += 1;
    if (seedCoverage < 1 && selectedCoverage === 1) newlyCoveredVsSeed += 1;
    if (top3Coverage < 1 && selectedCoverage === 1) newlyCoveredVsTop3 += 1;
    coverageSum += selectedCoverage;
    selectedSourceSum += selected.length;
    selectedTokenSum += row.modes[mode].selectedTokens;
    extraSourceSum += selected.filter((source) => !row.requiredSources.includes(source)).length;
  }

  return {
    mode,
    cases: rows.length,
    seedFullCoverageCases,
    fullCoverageCases,
    newlyCoveredVsSeed,
    newlyCoveredVsTop3,
    avgRequiredCoverage: coverageSum / cases,
    avgSelectedSources: selectedSourceSum / cases,
    avgSelectedTokens: selectedTokenSum / cases,
    avgExtraSources: extraSourceSum / cases,
  };
}

export function renderGraphAssemblyShadowReport(report: GraphAssemblyShadowReport): string {
  const lines: string[] = [];
  lines.push("Graph assembly shadow eval");
  lines.push(`Repos: ${report.repos.join(", ")}`);
  lines.push(`Cases with required sources: ${report.cases}`);
  lines.push("");
  lines.push(
    table([
      [
        "Mode",
        "Seed full",
        "Graph full",
        "New vs seed",
        "New vs top3",
        "Avg req cov",
        "Avg sources",
        "Avg tokens",
        "Avg extras",
      ],
      ...report.summaries.map((s) => [
        s.mode,
        `${s.seedFullCoverageCases}/${s.cases}`,
        `${s.fullCoverageCases}/${s.cases}`,
        String(s.newlyCoveredVsSeed),
        String(s.newlyCoveredVsTop3),
        pct(s.avgRequiredCoverage),
        oneDecimal(s.avgSelectedSources),
        String(Math.round(s.avgSelectedTokens)),
        oneDecimal(s.avgExtraSources),
      ]),
    ]),
  );

  const improved = report.rows.filter((row) =>
    MODES.some((mode) =>
      requiredCoverage(row.top3Sources, row.requiredSources) < 1 &&
      requiredCoverage(row.modes[mode].selectedSources, row.requiredSources) === 1,
    ),
  );
  lines.push("");
  lines.push("Cases newly fully covered vs top3:");
  if (improved.length === 0) {
    lines.push("  none");
  } else {
    for (const row of improved.slice(0, 20)) {
      const modes = MODES.filter(
        (mode) => requiredCoverage(row.modes[mode].selectedSources, row.requiredSources) === 1,
      );
      lines.push(`  ${row.repo}/${row.id}: ${modes.join(", ")}`);
    }
  }

  return lines.join("\n") + "\n";
}

function isAllowedProfile(profile: SourceProfile, allowStructural: boolean): boolean {
  if (profile.nav_provenance === "explicit_config") return true;
  if (allowStructural && (profile.nav_provenance === "frontmatter" || profile.nav_provenance === "structural")) {
    return true;
  }
  return false;
}

function compareNavOrder(a: SourceProfile, b: SourceProfile): number {
  return (
    (a.nav_position ?? Number.MAX_SAFE_INTEGER) - (b.nav_position ?? Number.MAX_SAFE_INTEGER) ||
    a.source_path.localeCompare(b.source_path)
  );
}

function sourceFromContextTrail(contexttrail: string): string | undefined {
  const match = /^Source:\s*(.*?) > Section:/.exec(contexttrail);
  return match?.[1];
}

function requiredCoverage(selected: string[], required: string[]): number {
  if (required.length === 0) return 1;
  const selectedSet = new Set(selected);
  const hits = required.filter((source) => selectedSet.has(source)).length;
  return hits / required.length;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function discoverRealCorpusRepos(): string[] {
  const root = realCorpusRoot();
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((repo) => existsSync(join(root, `${repo}.yaml`)))
    .sort();
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((row) => row[i]!.length)));
  return rows.map((row) => row.map((cell, i) => cell.padEnd(widths[i]!)).join("  ")).join("\n");
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function oneDecimal(value: number): string {
  return value.toFixed(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const repoArg = args.find((arg) => arg.startsWith("--repo="));
  const repos = repoArg ? repoArg.slice("--repo=".length).split(",").filter(Boolean) : undefined;
  const report = await runGraphAssemblyShadowEval(repos);
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(renderGraphAssemblyShadowReport(report));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
