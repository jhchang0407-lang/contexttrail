#!/usr/bin/env node
/**
 * Real-workflow context assembly eval.
 *
 * This measures multi-retrieval assembly against Linear-ticket shaped
 * engineering work. Each ticket has natural queries plus a gold context
 * bundle. A ticket is fully served only when the assembled source set
 * contains every primary doc and satisfies every support any-of group.
 *
 * This is intentionally above single-query source recall: retrieval first
 * finds candidate sources, then markdown link traversal tests whether
 * explicit corpus relationships pull in the surrounding implementation
 * context engineers need.
 */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import {
  evaluateAssemblyGates,
  renderAssemblyVerdict,
} from "./assembly-gate-bands.js";
import { runImport } from "../cli/import.js";
import { init } from "../config/init.js";
import { loadConfig } from "../config/load.js";
import { presentContextPack } from "../mcp/presenter.js";
import { retrieve, type RetrievalRequest } from "../retrieve/retrieve.js";
import { assembleContextPackWithLinks } from "../retrieve/assemble-with-links.js";
import { expandLinksKHops } from "../retrieve/link-traversal.js";
import { expandNavSiblings } from "../retrieve/nav-graph-traversal.js";
import { closeDb, openDb } from "../store/db.js";
import { listCurrentChunksCanonical, listSourcesCanonical } from "../store/read-model.js";
import { listSourceProfiles } from "../store/source-profiles.js";
import type { PresentedContextPack } from "../mcp/presenter.js";
import { budgetedRankedEntries } from "./budgeted-pack.js";

export type RequiredWorkflowChunk = {
  source: string;
  heading_path: string[];
  rationale?: string;
};

export type RealWorkflowCase = {
  ticket: string;
  title: string;
  queries: string[];
  required_primary: string[];
  required_support: string[][];
  must_include_chunks?: RequiredWorkflowChunk[];
};

export type RealWorkflowEvalOptions = {
  repoRoot?: string;
  fixturePath?: string;
  topK?: number;
  linkHops?: number;
  /**
   * PRD-0030 / 30.1: override the token budget the probe drives the
   * MCP-handler with. Default = config.retrieval.budgets.default (6000).
   * Sweep mode supplies a series of these.
   */
  budgetTokens?: number;
};

export type RealWorkflowCaseResult = {
  ticket: string;
  title: string;
  queryCount: number;
  rawSources: string[];
  traversedSources: string[];
  linkPulledSources: string[];
  primaryTotal: number;
  primaryMissingRaw: string[];
  primaryMissingTraversed: string[];
  supportRawCovered: number;
  supportTraversedCovered: number;
  supportTotal: number;
  supportMissingTraversed: string[][];
  chunkRawCovered: number;
  chunkTraversedCovered: number;
  chunkTotal: number;
  chunkMissingTraversed: RequiredWorkflowChunk[];
};

export type RealWorkflowSummary = {
  tickets: number;
  totalQueries: number;
  topK: number;
  linkHops: number;
  importedSources: number;
  primaryRawHits: number;
  primaryTraversedHits: number;
  primaryTotal: number;
  supportRawHits: number;
  supportTraversedHits: number;
  supportTotal: number;
  chunkRawHits: number;
  chunkTraversedHits: number;
  chunkTotal: number;
  ticketsServedRaw: number;
  ticketsServedTraversed: number;
  avgRawSources: number;
  avgLinkPulledSources: number;
};

export type RealWorkflowReport = {
  repoRoot: string;
  fixturePath: string;
  summary: RealWorkflowSummary;
  cases: RealWorkflowCaseResult[];
};

type ProbeCliIO = {
  write: (text: string) => void;
  exit: (code: number) => void;
};

const IMPORT_GLOBS = [
  "*.md",
  "docs/**/*.md",
  "!docs/evals/prd-0030-budget-baselines.md",
  ".out-of-scope/**/*.md",
];
const DEFAULT_FIXTURE = "tests/fixtures/real-workflows/linear-context-assembly.yaml";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function defaultRepoRoot(): string {
  return process.env.WORKFLOW_REPO_ROOT ?? process.cwd();
}

function defaultFixturePath(repoRoot: string): string {
  return process.env.WORKFLOW_FIXTURE ?? join(repoRoot, DEFAULT_FIXTURE);
}

export function loadRealWorkflowCases(fixturePath = defaultFixturePath(defaultRepoRoot())): RealWorkflowCase[] {
  const parsed = YAML.parse(readFileSync(fixturePath, "utf8")) as RealWorkflowCase[];
  if (!Array.isArray(parsed)) {
    throw new Error(`Real-workflow fixture must be a YAML array: ${fixturePath}`);
  }
  for (const entry of parsed) validateWorkflowCase(entry, fixturePath);
  return parsed;
}

function validateWorkflowCase(entry: RealWorkflowCase, fixturePath: string): void {
  const label = entry?.ticket ?? "(missing ticket)";
  if (!entry.ticket || !entry.title) {
    throw new Error(`Real-workflow fixture ${fixturePath} has an entry without ticket/title`);
  }
  if (!Array.isArray(entry.queries) || entry.queries.length === 0) {
    throw new Error(`Real-workflow case ${label} must include at least one query`);
  }
  if (!Array.isArray(entry.required_primary) || entry.required_primary.length === 0) {
    throw new Error(`Real-workflow case ${label} must include required_primary`);
  }
  if (!Array.isArray(entry.required_support)) {
    throw new Error(`Real-workflow case ${label} must include required_support`);
  }
  for (const group of entry.required_support) {
    if (!Array.isArray(group) || group.length === 0) {
      throw new Error(`Real-workflow case ${label} has an empty required_support group`);
    }
  }
  if (entry.must_include_chunks !== undefined) {
    if (!Array.isArray(entry.must_include_chunks)) {
      throw new Error(`Real-workflow case ${label} must_include_chunks must be an array`);
    }
    for (const chunk of entry.must_include_chunks) {
      if (!chunk.source || !Array.isArray(chunk.heading_path)) {
        throw new Error(`Real-workflow case ${label} has an invalid must_include_chunks entry`);
      }
      if (!chunk.heading_path.every((part) => typeof part === "string" && part.length > 0)) {
        throw new Error(`Real-workflow case ${label} has an invalid chunk heading_path`);
      }
    }
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

function unique(values: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function sourceFromContextTrail(contexttrail: string): string {
  const sourceMatch = /^Source:\s+([^>]+?)(?:\s+>|$)/.exec(contexttrail);
  return sourceMatch?.[1]?.trim() ?? "";
}

function chunkKey(source: string, headingPath: string[]): string {
  return JSON.stringify([source, headingPath]);
}

function requiredChunkKeys(entry: RealWorkflowCase): Set<string> {
  return new Set((entry.must_include_chunks ?? []).map((chunk) => chunkKey(chunk.source, chunk.heading_path)));
}

function rankedChunkKey(
  ranked: PresentedContextPack["ranked"][number],
  chunkKeyById: ReadonlyMap<string, string>,
): string | undefined {
  if (ranked.kind !== "chunk") return undefined;
  return chunkKeyById.get(ranked.id);
}

function isTraversalAddedEntry(ranked: PresentedContextPack["ranked"][number]): boolean {
  return ranked.contexttrail.includes("(link-traversed)");
}

function missingSources(required: string[], sources: ReadonlySet<string>): string[] {
  return required.filter((source) => !sources.has(source));
}

function supportCoveredCount(groups: string[][], sources: ReadonlySet<string>): number {
  return groups.filter((group) => group.some((source) => sources.has(source))).length;
}

function supportMissing(groups: string[][], sources: ReadonlySet<string>): string[][] {
  return groups.filter((group) => !group.some((source) => sources.has(source)));
}

export function scoreRealWorkflowCase(args: {
  entry: RealWorkflowCase;
  rawSources: Iterable<string>;
  traversedSources: Iterable<string>;
  rawChunks?: Iterable<string>;
  traversedChunks?: Iterable<string>;
}): RealWorkflowCaseResult {
  const rawSources = unique(args.rawSources);
  const traversedSources = unique(args.traversedSources);
  const rawSet = new Set(rawSources);
  const traversedSet = new Set(traversedSources);
  const rawChunkSet = new Set(args.rawChunks ?? []);
  const traversedChunkSet = new Set(args.traversedChunks ?? []);
  const requiredChunks = args.entry.must_include_chunks ?? [];
  const requiredChunkSet = requiredChunkKeys(args.entry);
  const rawOnly = new Set(rawSources);
  const linkPulledSources = traversedSources.filter((source) => !rawOnly.has(source));
  const supportRawCovered = supportCoveredCount(args.entry.required_support, rawSet);
  const supportTraversedCovered = supportCoveredCount(args.entry.required_support, traversedSet);
  const chunkRawCovered = [...requiredChunkSet].filter((key) => rawChunkSet.has(key)).length;
  const chunkTraversedCovered = [...requiredChunkSet].filter((key) => traversedChunkSet.has(key)).length;

  return {
    ticket: args.entry.ticket,
    title: args.entry.title,
    queryCount: args.entry.queries.length,
    rawSources,
    traversedSources,
    linkPulledSources,
    primaryTotal: args.entry.required_primary.length,
    primaryMissingRaw: missingSources(args.entry.required_primary, rawSet),
    primaryMissingTraversed: missingSources(args.entry.required_primary, traversedSet),
    supportRawCovered,
    supportTraversedCovered,
    supportTotal: args.entry.required_support.length,
    supportMissingTraversed: supportMissing(args.entry.required_support, traversedSet),
    chunkRawCovered,
    chunkTraversedCovered,
    chunkTotal: requiredChunks.length,
    chunkMissingTraversed: requiredChunks.filter(
      (chunk) => !traversedChunkSet.has(chunkKey(chunk.source, chunk.heading_path)),
    ),
  };
}

export function summarizeRealWorkflow(args: {
  cases: RealWorkflowCaseResult[];
  topK: number;
  linkHops: number;
  importedSources: number;
}): RealWorkflowSummary {
  const ticketCount = args.cases.length;
  const primaryTotal = args.cases.reduce((sum, row) => sum + row.primaryTotal, 0);
  const primaryRawHits = args.cases.reduce(
    (sum, row) => sum + (row.primaryTotal - row.primaryMissingRaw.length),
    0,
  );
  const primaryTraversedHits = args.cases.reduce(
    (sum, row) => sum + (row.primaryTotal - row.primaryMissingTraversed.length),
    0,
  );
  const supportTotal = args.cases.reduce((sum, row) => sum + row.supportTotal, 0);
  const supportRawHits = args.cases.reduce((sum, row) => sum + row.supportRawCovered, 0);
  const supportTraversedHits = args.cases.reduce((sum, row) => sum + row.supportTraversedCovered, 0);
  const chunkTotal = args.cases.reduce((sum, row) => sum + row.chunkTotal, 0);
  const chunkRawHits = args.cases.reduce((sum, row) => sum + row.chunkRawCovered, 0);
  const chunkTraversedHits = args.cases.reduce((sum, row) => sum + row.chunkTraversedCovered, 0);
  const ticketsServedRaw = args.cases.filter(
    (row) => row.primaryMissingRaw.length === 0 && row.supportRawCovered === row.supportTotal,
  ).length;
  const ticketsServedTraversed = args.cases.filter(
    (row) => row.primaryMissingTraversed.length === 0 && row.supportTraversedCovered === row.supportTotal,
  ).length;

  return {
    tickets: ticketCount,
    totalQueries: args.cases.reduce((sum, row) => sum + row.queryCount, 0),
    topK: args.topK,
    linkHops: args.linkHops,
    importedSources: args.importedSources,
    primaryRawHits,
    primaryTraversedHits,
    primaryTotal,
    supportRawHits,
    supportTraversedHits,
    supportTotal,
    chunkRawHits,
    chunkTraversedHits,
    chunkTotal,
    ticketsServedRaw,
    ticketsServedTraversed,
    avgRawSources:
      ticketCount === 0 ? 0 : args.cases.reduce((sum, row) => sum + row.rawSources.length, 0) / ticketCount,
    avgLinkPulledSources:
      ticketCount === 0 ? 0 : args.cases.reduce((sum, row) => sum + row.linkPulledSources.length, 0) / ticketCount,
  };
}

export async function runRealWorkflowEval(
  opts: RealWorkflowEvalOptions = {},
): Promise<RealWorkflowReport> {
  const repoRoot = resolve(opts.repoRoot ?? defaultRepoRoot());
  const fixturePath = resolve(opts.fixturePath ?? defaultFixturePath(repoRoot));
  const topK = opts.topK ?? parsePositiveInt(process.env.TOP_K, 5);
  const linkHops = opts.linkHops ?? parsePositiveInt(process.env.LINK_HOPS, 2);
  const workflowCases = loadRealWorkflowCases(fixturePath);
  const cwd = mkdtempSync(join(tmpdir(), "contexttrail-realwork-"));

  try {
    init(cwd);
    copyDirSync(join(repoRoot, "docs"), join(cwd, "docs"));
    runImport(cwd, IMPORT_GLOBS);
    const db = openDb(join(cwd, ".contexttrail", "cache", "contexttrail.db"));
    try {
      const baseConfig = loadConfig(cwd);
      // PRD-0030 / 30.1: when --budget=N is supplied, override the
      // "default" budget slot. The probe always asks for budget: "default"
      // so a single-site override is sufficient; sweep mode reuses the
      // same code path with different N values.
      const config = opts.budgetTokens === undefined
        ? baseConfig
        : {
            ...baseConfig,
            retrieval: {
              ...baseConfig.retrieval,
              budgets: { ...baseConfig.retrieval.budgets, default: opts.budgetTokens },
            },
          };
      const sources = listSourcesCanonical(db).map((source) => source.source_path);
      const importedSources = new Set(sources);
      const currentChunks = listCurrentChunksCanonical(db);
      const chunkKeyById = new Map<string, string>();
      const firstChunkKeyBySource = new Map<string, string>();
      for (const chunk of currentChunks) {
        const key = chunkKey(chunk.source_path, chunk.heading_path);
        chunkKeyById.set(chunk.version_id, key);
        if (!firstChunkKeyBySource.has(chunk.source_path)) {
          firstChunkKeyBySource.set(chunk.source_path, key);
        }
      }
      const docBodyCache = new Map<string, string>();
      const resolveBody = (sourcePath: string): string => {
        const cached = docBodyCache.get(sourcePath);
        if (cached !== undefined) return cached;
        let body = "";
        try {
          body = readFileSync(join(cwd, sourcePath), "utf8");
        } catch {
          body = "";
        }
        docBodyCache.set(sourcePath, body);
        return body;
      };

      // Pre-load nav facts once: the nav-graph traversal lever uses
      // SourceProfile.nav_section_id captured at import time and is
      // identical across all queries.
      const navFacts = listSourceProfiles(db).map((p) => ({
        source_path: p.source_path,
        nav_section_id: p.nav_section_id ?? null,
        nav_provenance: p.nav_provenance ?? null,
      }));

      // Robustness knob: cap queries per ticket. WORKFLOW_MAX_QUERIES=1
      // simulates a single-shot agent that issues one query and assembles
      // from there — the worst-case real user.
      const maxQueriesPerTicket = parsePositiveInt(process.env.WORKFLOW_MAX_QUERIES, 0);
      const cases: RealWorkflowCaseResult[] = [];
      for (const entry of workflowCases) {
        const rawSources = new Set<string>();
        const rawChunkKeys = new Set<string>();
        const traversedSourcesFromBudgetedPack = new Set<string>();
        const traversedChunkKeysFromBudgetedPack = new Set<string>();
        const queriesToRun = maxQueriesPerTicket > 0
          ? entry.queries.slice(0, maxQueriesPerTicket)
          : entry.queries;
        for (const query of queriesToRun) {
          const request: RetrievalRequest = {
            task: query,
            query_anchors: { files: [], symbols: [], routes: [] },
            budget: "default",
            expected_locked: [],
            explain: false,
          };
          if (opts.budgetTokens !== undefined) {
            const { pack } = assembleContextPackWithLinks({
              db,
              request,
              cwd,
              maxHops: linkHops,
              budgetTokensOverride: opts.budgetTokens,
            });
            for (const ranked of budgetedRankedEntries(pack, opts.budgetTokens)) {
              if (ranked.kind !== "chunk") continue;
              const source = sourceFromContextTrail(ranked.contexttrail);
              if (!source) continue;
              const key = rankedChunkKey(ranked, chunkKeyById);
              traversedSourcesFromBudgetedPack.add(source);
              if (key !== undefined) traversedChunkKeysFromBudgetedPack.add(key);
              if (!isTraversalAddedEntry(ranked)) {
                rawSources.add(source);
                if (key !== undefined) rawChunkKeys.add(key);
              }
            }
            continue;
          }
          const result = retrieve(db, request, config);
          const response = presentContextPack({
            query,
            result,
            requested_budget: config.retrieval.budgets.default,
            has_sources: importedSources.size > 0,
            explain: false,
            min_final_score: config.retrieval.min_final_score,
          });
          for (const ranked of response.ranked.filter((entry) => entry.kind === "chunk").slice(0, topK)) {
            const source = sourceFromContextTrail(ranked.contexttrail);
            if (source) rawSources.add(source);
            const key = rankedChunkKey(ranked, chunkKeyById);
            if (key !== undefined) rawChunkKeys.add(key);
          }
        }
        if (opts.budgetTokens !== undefined) {
          cases.push(scoreRealWorkflowCase({
            entry,
            rawSources,
            traversedSources: traversedSourcesFromBudgetedPack,
            rawChunks: rawChunkKeys,
            traversedChunks: traversedChunkKeysFromBudgetedPack,
          }));
          continue;
        }
        const linkTraversed = expandLinksKHops({
          seeds: rawSources,
          corpusSources: importedSources,
          resolveBody,
          maxHops: linkHops,
        });
        // PRD-0027 follow-up: also expand via nav siblings. The two
        // levers are complementary — links fire on cross-referenced
        // corpora, nav fires on framework-driven (vitepress / mkdocs /
        // docusaurus) corpora. Their union is what the engine should
        // surface for assembly.
        const navSiblings = expandNavSiblings({
          seeds: rawSources,
          navFacts: navFacts,
        });
        const traversedSources = new Set<string>([...linkTraversed, ...navSiblings]);
        const traversedChunkKeys = new Set(rawChunkKeys);
        for (const source of traversedSources) {
          if (rawSources.has(source)) continue;
          const key = firstChunkKeyBySource.get(source);
          if (key !== undefined) traversedChunkKeys.add(key);
        }
        cases.push(scoreRealWorkflowCase({
          entry,
          rawSources,
          traversedSources,
          rawChunks: rawChunkKeys,
          traversedChunks: traversedChunkKeys,
        }));
      }

      return {
        repoRoot,
        fixturePath,
        summary: summarizeRealWorkflow({
          cases,
          topK,
          linkHops,
          importedSources: importedSources.size,
        }),
        cases,
      };
    } finally {
      closeDb(db);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function pct(n: number, d: number): string {
  return d === 0 ? "-" : `${((n / d) * 100).toFixed(1)}%`;
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((row) => row[i]!.length)));
  return rows.map((row) => row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ")).join("\n");
}

export function renderRealWorkflowReport(report: RealWorkflowReport): string {
  const s = report.summary;
  const lines: string[] = [];
  lines.push("Real-workflow context assembly eval");
  lines.push("");
  lines.push(`Fixture: ${report.fixturePath}`);
  lines.push(`Imported sources: ${s.importedSources}`);
  lines.push(`${s.tickets} tickets, top-${s.topK} per query, ${s.linkHops} link hops, ${s.totalQueries} total queries`);
  lines.push("");
  lines.push(
    table([
      ["Metric", "Raw retrieval", "After link traversal"],
      [
        "Required primary docs",
        `${s.primaryRawHits}/${s.primaryTotal} (${pct(s.primaryRawHits, s.primaryTotal)})`,
        `${s.primaryTraversedHits}/${s.primaryTotal} (${pct(s.primaryTraversedHits, s.primaryTotal)})`,
      ],
      [
        "Required support groups",
        `${s.supportRawHits}/${s.supportTotal} (${pct(s.supportRawHits, s.supportTotal)})`,
        `${s.supportTraversedHits}/${s.supportTotal} (${pct(s.supportTraversedHits, s.supportTotal)})`,
      ],
      [
        "Required chunks",
        `${s.chunkRawHits}/${s.chunkTotal} (${pct(s.chunkRawHits, s.chunkTotal)})`,
        `${s.chunkTraversedHits}/${s.chunkTotal} (${pct(s.chunkTraversedHits, s.chunkTotal)})`,
      ],
      [
        "Tickets fully served",
        `${s.ticketsServedRaw}/${s.tickets} (${pct(s.ticketsServedRaw, s.tickets)})`,
        `${s.ticketsServedTraversed}/${s.tickets} (${pct(s.ticketsServedTraversed, s.tickets)})`,
      ],
    ]),
  );
  lines.push("");
  lines.push(`Average raw sources per ticket: ${s.avgRawSources.toFixed(1)}`);
  lines.push(`Average link-pulled sources per ticket: ${s.avgLinkPulledSources.toFixed(1)}`);

  const misses = report.cases.filter(
    (row) => row.primaryMissingTraversed.length > 0 || row.supportTraversedCovered < row.supportTotal,
  );
  lines.push("");
  lines.push(`Traversed misses: ${misses.length}`);
  for (const row of misses) {
    lines.push(`  ${row.ticket}  ${row.title}`);
    if (row.primaryMissingTraversed.length > 0) {
      lines.push(`    primary missing: ${row.primaryMissingTraversed.join(", ")}`);
    }
    if (row.supportMissingTraversed.length > 0) {
      lines.push("    support missing:");
      for (const group of row.supportMissingTraversed) {
        lines.push(`      one of: ${group.join(", ")}`);
      }
    }
    if (row.chunkMissingTraversed.length > 0) {
      lines.push("    chunks missing:");
      for (const chunk of row.chunkMissingTraversed) {
        lines.push(`      ${chunk.source} > ${chunk.heading_path.join(" > ")}`);
      }
    }
  }
  return lines.join("\n") + "\n";
}

export function workflowAssemblyVerdictFromReport(report: RealWorkflowReport) {
  return evaluateAssemblyGates({
    workflow_assembly: {
      served: report.summary.ticketsServedTraversed,
      total: report.summary.tickets,
    },
  });
}

export function emitRealWorkflowProbeCli(args: {
  report: RealWorkflowReport;
  json: boolean;
  io: ProbeCliIO;
}) {
  const { report, json, io } = args;
  io.write(json ? `${JSON.stringify(report, null, 2)}\n` : renderRealWorkflowReport(report));

  const verdict = workflowAssemblyVerdictFromReport(report);
  if (!json) {
    io.write("\n");
    io.write(renderAssemblyVerdict(verdict));
  }
  if (!verdict.pass) io.exit(1);
  return verdict;
}

export function parseProbeBudgetArgs(
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

export type BudgetSweepRow = {
  budget: number;
  served: number;
  total: number;
  chunkCovered: number;
  chunkTotal: number;
};

export function renderBudgetSweepTable(rows: BudgetSweepRow[]): string {
  if (rows.length === 0) return "";
  const baseline = rows.reduce(
    (best, row) => (row.budget > best.budget ? row : best),
    rows[0]!,
  );
  const dataRows = rows.map((row) => {
    const pctStr = row.total === 0 ? "-" : `${((row.served / row.total) * 100).toFixed(1)}%`;
    const chunkPctStr = row.chunkTotal === 0 ? "-" : `${((row.chunkCovered / row.chunkTotal) * 100).toFixed(1)}%`;
    const delta = row.served - baseline.served;
    const deltaStr = row.budget === baseline.budget
      ? " baseline"
      : `${delta > 0 ? "+" : ""}${delta} ${Math.abs(delta) === 1 ? "case" : "cases"}`;
    return [
      String(row.budget),
      `${row.served} / ${row.total}  (${pctStr})`,
      `${row.chunkCovered} / ${row.chunkTotal}  (${chunkPctStr})`,
      deltaStr,
    ];
  });
  const header = ["budget", "workflow_doc", "workflow_chunk", "delta_vs_default"];
  return table([header, ...dataRows]);
}

async function runBudgetSweep(budgets: number[], json: boolean): Promise<void> {
  const rows: BudgetSweepRow[] = [];
  for (const budget of budgets) {
    const report = await runRealWorkflowEval({ budgetTokens: budget });
    rows.push({
      budget,
      served: report.summary.ticketsServedTraversed,
      total: report.summary.tickets,
      chunkCovered: report.summary.chunkTraversedHits,
      chunkTotal: report.summary.chunkTotal,
    });
  }
  if (json) {
    process.stdout.write(`${JSON.stringify({ budget_sweep: rows }, null, 2)}\n`);
    return;
  }
  process.stdout.write("Budget sweep (PRD-0030 / 30.1)\n\n");
  process.stdout.write(`${renderBudgetSweepTable(rows)}\n`);
}

async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  const { budget, budgetSweep } = parseProbeBudgetArgs(process.argv);
  if (budgetSweep && budgetSweep.length > 0) {
    await runBudgetSweep(budgetSweep, json);
    return;
  }
  // --budget=N runs a single non-default budget and skips the PRD-0029
  // verdict (the verdict is locked to the default-budget measurement).
  // Bare invocation (no --budget) is byte-identical to the pre-30.1 path.
  const report = await runRealWorkflowEval(budget !== undefined ? { budgetTokens: budget } : {});
  if (budget !== undefined) {
    process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : renderRealWorkflowReport(report));
    process.stdout.write(`\n(verdict skipped: --budget=${budget} is not the gated default)\n`);
    return;
  }
  emitRealWorkflowProbeCli({
    report,
    json,
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
