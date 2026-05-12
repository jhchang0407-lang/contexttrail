#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import type { Root } from "mdast";
import { parse } from "../parse/markdown.js";
import { closeDb, openDb } from "../store/db.js";
import { listSourceProfiles } from "../store/source-profiles.js";
import type { SourceProfile } from "../types/source-profile.js";
import { createHandlers } from "../mcp/handlers.js";
import {
  createRealCorpusLab,
  loadRealCorpusEvalSet,
  realCorpusRoot,
} from "./real-corpus-fixture.js";

export type LinkAssemblyMode =
  | "top1_link_out"
  | "top3_link_out"
  | "top1_link_bidir"
  | "top3_link_bidir";

export type SourceLinkGraph = {
  outbound: Map<string, string[]>;
  inbound: Map<string, string[]>;
};

export type LinkAssemblySelection = {
  mode: LinkAssemblyMode;
  selectedSources: string[];
  selectedTokens: number;
  expansionReasons: Record<string, string[]>;
};

export type LinkAssemblyShadowRow = {
  repo: string;
  id: string;
  requiredSources: string[];
  top1Sources: string[];
  top3Sources: string[];
  modes: Record<LinkAssemblyMode, LinkAssemblySelection>;
};

export type LinkAssemblyModeSummary = {
  mode: LinkAssemblyMode;
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

export type LinkAssemblyShadowReport = {
  generated_at: string;
  repos: string[];
  cases: number;
  summaries: LinkAssemblyModeSummary[];
  rows: LinkAssemblyShadowRow[];
};

const MODES: LinkAssemblyMode[] = [
  "top1_link_out",
  "top3_link_out",
  "top1_link_bidir",
  "top3_link_bidir",
];

const MAX_SOURCES = 5;

export function buildSourceLinkGraph(args: {
  cwd: string;
  profiles: SourceProfile[];
}): SourceLinkGraph {
  const sourceSet = new Set(args.profiles.map((p) => p.source_path));
  const outbound = new Map<string, string[]>();
  const inbound = new Map<string, string[]>();

  for (const profile of args.profiles) {
    const abs = join(args.cwd, profile.source_path);
    if (!existsSync(abs)) continue;
    const raw = readFileSync(abs, "utf8");
    const parsed = parse(raw);
    const urls = extractMarkdownLinkUrls(parsed.ast);
    const targets = unique(
      urls
        .map((url) => resolveMarkdownLink({
          fromSource: profile.source_path,
          url,
          sourceSet,
        }))
        .filter((target): target is string => target !== undefined)
        .filter((target) => target !== profile.source_path),
    );
    outbound.set(profile.source_path, targets);
    for (const target of targets) {
      const incoming = inbound.get(target) ?? [];
      incoming.push(profile.source_path);
      inbound.set(target, incoming);
    }
  }

  for (const [source, targets] of outbound) outbound.set(source, targets.sort());
  for (const [source, targets] of inbound) inbound.set(source, unique(targets).sort());
  return { outbound, inbound };
}

export function expandLinkAssemblySources(args: {
  mode: LinkAssemblyMode;
  seedSources: string[];
  profiles: SourceProfile[];
  linkGraph: SourceLinkGraph;
  maxSources?: number;
}): LinkAssemblySelection {
  const maxSources = args.maxSources ?? MAX_SOURCES;
  const byPath = new Map(args.profiles.map((p) => [p.source_path, p]));
  const selected: string[] = [];
  const selectedSet = new Set<string>();
  const reasons = new Map<string, string[]>();
  const bidirectional = args.mode.endsWith("_bidir");

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
    for (const target of args.linkGraph.outbound.get(seed) ?? []) {
      add(target, `outbound:${seed}`);
    }
    if (bidirectional) {
      for (const source of args.linkGraph.inbound.get(seed) ?? []) {
        add(source, `inbound:${seed}`);
      }
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

export async function runLinkAssemblyShadowEval(
  repos = discoverRealCorpusRepos(),
): Promise<LinkAssemblyShadowReport> {
  const rows: LinkAssemblyShadowRow[] = [];
  for (const repo of repos) {
    const cases = loadRealCorpusEvalSet(repo);
    const lab = createRealCorpusLab(repo);
    try {
      lab.importCorpus();
      const handlers = createHandlers({ cwd: lab.cwd });
      const db = openDb(join(lab.cwd, ".contexttrail/cache/contexttrail.db"));
      try {
        const profiles = listSourceProfiles(db);
        const linkGraph = buildSourceLinkGraph({ cwd: lab.cwd, profiles });
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
              expandLinkAssemblySources({
                mode,
                seedSources: mode.startsWith("top1") ? top1Sources : top3Sources,
                profiles,
                linkGraph,
              }),
            ]),
          ) as Record<LinkAssemblyMode, LinkAssemblySelection>;
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
  mode: LinkAssemblyMode,
  rows: LinkAssemblyShadowRow[],
): LinkAssemblyModeSummary {
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

export function renderLinkAssemblyShadowReport(report: LinkAssemblyShadowReport): string {
  const lines: string[] = [];
  lines.push("Link assembly shadow eval");
  lines.push(`Repos: ${report.repos.join(", ")}`);
  lines.push(`Cases with required sources: ${report.cases}`);
  lines.push("");
  lines.push(
    table([
      [
        "Mode",
        "Seed full",
        "Link full",
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

export function extractMarkdownLinkUrls(root: Root): string[] {
  const urls: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const typed = node as { type?: string; url?: unknown; children?: unknown[] };
    if ((typed.type === "link" || typed.type === "definition") && typeof typed.url === "string") {
      urls.push(typed.url);
    }
    for (const child of typed.children ?? []) visit(child);
  };
  visit(root);
  return urls;
}

export function resolveMarkdownLink(args: {
  fromSource: string;
  url: string;
  sourceSet: Set<string>;
}): string | undefined {
  const raw = args.url.trim();
  if (!raw) return undefined;
  if (/^(?:https?:|mailto:|tel:|javascript:)/i.test(raw)) return undefined;
  if (raw.startsWith("#")) return undefined;
  const stripped = raw.replace(/[?#].*$/, "");
  if (!stripped) return undefined;
  const decoded = safeDecodeUri(stripped).replace(/\\/g, "/");
  const fromDir = dirname(args.fromSource).replace(/\\/g, "/");
  const candidates: string[] = [];

  if (decoded.startsWith("/")) {
    const absolute = decoded.replace(/^\/+/, "");
    candidates.push(absolute);
    const root = importRootPrefix(args.fromSource);
    if (root && !absolute.startsWith(`${root}/`)) candidates.push(`${root}/${absolute}`);
  } else {
    candidates.push(posix.normalize(posix.join(fromDir, decoded)));
  }

  for (const candidate of expandPathCandidates(candidates)) {
    if (args.sourceSet.has(candidate)) return candidate;
  }
  return undefined;
}

function expandPathCandidates(paths: string[]): string[] {
  const out: string[] = [];
  for (const path of paths) {
    const clean = path.replace(/^\.\//, "").replace(/\/+$/, "");
    if (!clean || clean.startsWith("../")) continue;
    out.push(clean);
    if (!/\.(md|mdx|markdown)$/i.test(clean)) {
      out.push(`${clean}.md`, `${clean}.mdx`, `${clean}.markdown`);
      out.push(`${clean}/index.md`, `${clean}/README.md`, `${clean}/_index.md`);
    }
  }
  return unique(out);
}

function importRootPrefix(sourcePath: string): string | undefined {
  const first = sourcePath.split("/").filter(Boolean)[0];
  if (!first) return undefined;
  return first;
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
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
  const report = await runLinkAssemblyShadowEval(repos);
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(renderLinkAssemblyShadowReport(report));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
