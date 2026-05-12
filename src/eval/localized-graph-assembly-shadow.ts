#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import type { Root } from "mdast";
import { parse } from "../parse/markdown.js";
import { closeDb, openDb } from "../store/db.js";
import { listCurrentChunksCanonical } from "../store/read-model.js";
import { listSourceProfiles } from "../store/source-profiles.js";
import type { DocChunk } from "../types/chunk.js";
import type { SourceProfile } from "../types/source-profile.js";
import { tokenize } from "../retrieve/tokenize.js";
import { createHandlers } from "../mcp/handlers.js";
import {
  createRealCorpusLab,
  loadRealCorpusEvalSet,
  realCorpusRoot,
} from "./real-corpus-fixture.js";

export type LocalizedGraphAssemblyMode =
  | "root_link_out_1"
  | "root_link_bidir_1"
  | "root_nav_explicit_1"
  | "root_graph_combined_2";

export type LocalizedGraphEdgeKind = "markdown_link" | "nav_explicit";
export type LocalizedGraphEdgeDirection = "outbound" | "inbound" | "nav";

export type LocalizedGraphEdge = {
  edge_kind: LocalizedGraphEdgeKind;
  direction: LocalizedGraphEdgeDirection;
  provenance: "markdown_ast" | "explicit_config";
  from_chunk_id: string;
  from_source: string;
  from_line?: number;
  target_chunk_id: string;
  target_source: string;
  target_tokens: number;
  url?: string;
  label?: string;
  selection_reason: string;
  score: number;
};

export type LocalizedGraph = {
  outbound: Map<string, LocalizedGraphEdge[]>;
  inbound: Map<string, LocalizedGraphEdge[]>;
  nav: Map<string, LocalizedGraphEdge[]>;
};

export type LocalizedGraphSelection = {
  mode: LocalizedGraphAssemblyMode;
  root_chunk_id?: string;
  root_source?: string;
  selected_chunk_ids: string[];
  selected_sources: string[];
  selected_tokens: number;
  added_chunks: LocalizedGraphEdge[];
  added_tokens: number;
  whole_source_equivalent_tokens: number;
  omitted_edges: Array<{
    target_chunk_id: string;
    target_source: string;
    reason: "cap" | "budget" | "duplicate" | "self";
    edge_kind: LocalizedGraphEdgeKind;
    direction: LocalizedGraphEdgeDirection;
  }>;
};

export type LocalizedGraphShadowRow = {
  repo: string;
  id: string;
  required_sources: string[];
  query_mode: "anchored" | "signal_empty" | "unanchored";
  root_chunk_id?: string;
  root_source?: string;
  top3_sources: string[];
  modes: Record<LocalizedGraphAssemblyMode, LocalizedGraphSelection>;
};

export type LocalizedGraphModeSummary = {
  mode: LocalizedGraphAssemblyMode;
  cases: number;
  seed_full_coverage_cases: number;
  full_coverage_cases: number;
  newly_covered_vs_seed: number;
  newly_covered_vs_top3: number;
  avg_required_coverage: number;
  avg_selected_chunks: number;
  avg_added_chunks: number;
  avg_selected_tokens: number;
  avg_added_tokens: number;
  avg_whole_source_equivalent_tokens: number;
  avg_extra_chunks: number;
  avg_token_savings_vs_whole_source: number;
};

export type LocalizedGraphShadowReport = {
  generated_at: string;
  repos: string[];
  cases: number;
  summaries: LocalizedGraphModeSummary[];
  rows: LocalizedGraphShadowRow[];
};

type LinkReference = {
  source_path: string;
  line: number;
  url: string;
  label: string;
};

type ResolvedLinkTarget = {
  source_path: string;
  chunk: DocChunk;
  reason: string;
  score: number;
};

const MODES: LocalizedGraphAssemblyMode[] = [
  "root_link_out_1",
  "root_link_bidir_1",
  "root_nav_explicit_1",
  "root_graph_combined_2",
];

const GENERIC_LINK_LABELS = new Set([
  "here",
  "this",
  "these",
  "that",
  "it",
  "page",
  "link",
  "docs",
  "documentation",
  "guide",
  "read more",
  "learn more",
  "click here",
]);

export function buildLocalizedGraph(args: {
  cwd: string;
  chunks: DocChunk[];
  profiles: SourceProfile[];
  query: string;
}): LocalizedGraph {
  const chunksBySource = groupChunksBySource(args.chunks);
  const sourceSet = new Set(args.profiles.map((p) => p.source_path));
  const outbound = new Map<string, LocalizedGraphEdge[]>();
  const inbound = new Map<string, LocalizedGraphEdge[]>();
  const nav = buildNavEdges({ chunks: args.chunks, profiles: args.profiles });

  for (const profile of args.profiles) {
    const abs = join(args.cwd, profile.source_path);
    if (!existsSync(abs)) continue;
    const parsed = parse(readFileSync(abs, "utf8"));
    const references = collectMarkdownLinkReferences(parsed.ast, profile.source_path);
    const sourceChunks = chunksBySource.get(profile.source_path) ?? [];

    for (const ref of references) {
      const fromChunk = chunkContainingLine(sourceChunks, ref.line);
      if (!fromChunk) continue;
      const target = resolveLocalizedLinkTarget({
        fromSource: profile.source_path,
        url: ref.url,
        label: ref.label,
        query: args.query,
        sourceSet,
        chunksBySource,
      });
      if (!target) continue;
      if (target.chunk.version_id === fromChunk.version_id) continue;

      const edge: LocalizedGraphEdge = {
        edge_kind: "markdown_link",
        direction: "outbound",
        provenance: "markdown_ast",
        from_chunk_id: fromChunk.version_id,
        from_source: fromChunk.source_path,
        from_line: ref.line,
        target_chunk_id: target.chunk.version_id,
        target_source: target.chunk.source_path,
        target_tokens: target.chunk.token_count,
        url: ref.url,
        label: ref.label,
        selection_reason: target.reason,
        score: target.score,
      };
      pushEdge(outbound, fromChunk.version_id, edge);
      pushEdge(inbound, target.chunk.version_id, { ...edge, direction: "inbound" });
    }
  }

  sortEdgeMap(outbound);
  sortEdgeMap(inbound);
  sortEdgeMap(nav);
  return { outbound, inbound, nav };
}

export function expandLocalizedGraphAssembly(args: {
  mode: LocalizedGraphAssemblyMode;
  root: DocChunk | undefined;
  graph: LocalizedGraph;
  chunks: DocChunk[];
  profiles: SourceProfile[];
  budgetTokens?: number;
  queryMode?: "anchored" | "signal_empty" | "unanchored";
}): LocalizedGraphSelection {
  const chunksById = new Map(args.chunks.map((chunk) => [chunk.version_id, chunk]));
  const profilesBySource = new Map(args.profiles.map((profile) => [profile.source_path, profile]));
  const selectedChunkIds: string[] = [];
  const selectedChunkSet = new Set<string>();
  const added: LocalizedGraphEdge[] = [];
  const omitted: LocalizedGraphSelection["omitted_edges"] = [];
  const maxAdded = args.mode === "root_graph_combined_2" ? 2 : 1;

  if (!args.root) {
    return emptySelection(args.mode);
  }

  if (args.queryMode === "signal_empty") {
    return rootOnlySelection(args.mode, args.root, profilesBySource);
  }

  selectedChunkIds.push(args.root.version_id);
  selectedChunkSet.add(args.root.version_id);
  let selectedTokens = args.root.token_count;
  const budgetTokens = args.budgetTokens ?? Number.POSITIVE_INFINITY;

  const candidates = candidateEdgesForMode(args.mode, args.root.version_id, args.graph);
  for (const edge of candidates) {
    if (edge.target_chunk_id === args.root.version_id) {
      omitted.push(omit(edge, "self"));
      continue;
    }
    if (selectedChunkSet.has(edge.target_chunk_id)) {
      omitted.push(omit(edge, "duplicate"));
      continue;
    }
    if (added.length >= maxAdded) {
      omitted.push(omit(edge, "cap"));
      continue;
    }
    const target = chunksById.get(edge.target_chunk_id);
    if (!target) continue;
    if (selectedTokens + target.token_count > budgetTokens) {
      omitted.push(omit(edge, "budget"));
      continue;
    }
    selectedChunkIds.push(target.version_id);
    selectedChunkSet.add(target.version_id);
    selectedTokens += target.token_count;
    added.push(edge);
  }

  const selectedSources = unique(
    selectedChunkIds
      .map((id) => chunksById.get(id)?.source_path)
      .filter((source): source is string => source !== undefined),
  );
  const wholeSourceTokens = selectedSources.reduce(
    (sum, source) => sum + (profilesBySource.get(source)?.token_count ?? 0),
    0,
  );
  return {
    mode: args.mode,
    root_chunk_id: args.root.version_id,
    root_source: args.root.source_path,
    selected_chunk_ids: selectedChunkIds,
    selected_sources: selectedSources,
    selected_tokens: selectedTokens,
    added_chunks: added,
    added_tokens: added.reduce((sum, edge) => sum + edge.target_tokens, 0),
    whole_source_equivalent_tokens: wholeSourceTokens,
    omitted_edges: omitted,
  };
}

export async function runLocalizedGraphAssemblyShadowEval(
  repos = discoverRealCorpusRepos(),
): Promise<LocalizedGraphShadowReport> {
  const rows: LocalizedGraphShadowRow[] = [];
  for (const repo of repos) {
    const cases = loadRealCorpusEvalSet(repo);
    const lab = createRealCorpusLab(repo);
    try {
      lab.importCorpus();
      const handlers = createHandlers({ cwd: lab.cwd });
      const db = openDb(join(lab.cwd, ".contexttrail/cache/contexttrail.db"));
      try {
        const profiles = listSourceProfiles(db);
        const chunks = listCurrentChunksCanonical(db);
        const chunksById = new Map(chunks.map((chunk) => [chunk.version_id, chunk]));
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
          const rankedChunkIds = response.ranked
            .filter((r) => r.kind === "chunk")
            .map((r) => r.id);
          const root = chunksById.get(rankedChunkIds[0] ?? "");
          const top3Sources = unique(
            rankedChunkIds
              .slice(0, 3)
              .map((id) => chunksById.get(id)?.source_path)
              .filter((source): source is string => source !== undefined),
          );
          const graph = buildLocalizedGraph({
            cwd: lab.cwd,
            chunks,
            profiles,
            query: entry.task,
          });
          const budgetTokens = response.budget.requested;
          const modes = Object.fromEntries(
            MODES.map((mode) => [
              mode,
              expandLocalizedGraphAssembly({
                mode,
                root,
                graph,
                chunks,
                profiles,
                budgetTokens,
                queryMode: response.query_mode,
              }),
            ]),
          ) as Record<LocalizedGraphAssemblyMode, LocalizedGraphSelection>;
          rows.push({
            repo,
            id: entry.id,
            required_sources: entry.must_include_sources,
            query_mode: response.query_mode,
            root_chunk_id: root?.version_id,
            root_source: root?.source_path,
            top3_sources: top3Sources,
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
  mode: LocalizedGraphAssemblyMode,
  rows: LocalizedGraphShadowRow[],
): LocalizedGraphModeSummary {
  const cases = rows.length || 1;
  let seedFullCoverageCases = 0;
  let fullCoverageCases = 0;
  let newlyCoveredVsSeed = 0;
  let newlyCoveredVsTop3 = 0;
  let coverageSum = 0;
  let selectedChunks = 0;
  let addedChunks = 0;
  let selectedTokens = 0;
  let addedTokens = 0;
  let wholeSourceTokens = 0;
  let extraChunks = 0;
  let savingsSum = 0;

  for (const row of rows) {
    const selection = row.modes[mode];
    const selectedCoverage = requiredCoverage(selection.selected_sources, row.required_sources);
    const seedCoverage = requiredCoverage(row.root_source ? [row.root_source] : [], row.required_sources);
    const top3Coverage = requiredCoverage(row.top3_sources, row.required_sources);
    if (seedCoverage === 1) seedFullCoverageCases += 1;
    if (selectedCoverage === 1) fullCoverageCases += 1;
    if (seedCoverage < 1 && selectedCoverage === 1) newlyCoveredVsSeed += 1;
    if (top3Coverage < 1 && selectedCoverage === 1) newlyCoveredVsTop3 += 1;
    coverageSum += selectedCoverage;
    selectedChunks += selection.selected_chunk_ids.length;
    addedChunks += selection.added_chunks.length;
    selectedTokens += selection.selected_tokens;
    addedTokens += selection.added_tokens;
    wholeSourceTokens += selection.whole_source_equivalent_tokens;
    extraChunks += selection.selected_sources.filter((source) => !row.required_sources.includes(source)).length;
    if (selection.whole_source_equivalent_tokens > 0) {
      savingsSum += 1 - selection.selected_tokens / selection.whole_source_equivalent_tokens;
    }
  }

  return {
    mode,
    cases: rows.length,
    seed_full_coverage_cases: seedFullCoverageCases,
    full_coverage_cases: fullCoverageCases,
    newly_covered_vs_seed: newlyCoveredVsSeed,
    newly_covered_vs_top3: newlyCoveredVsTop3,
    avg_required_coverage: coverageSum / cases,
    avg_selected_chunks: selectedChunks / cases,
    avg_added_chunks: addedChunks / cases,
    avg_selected_tokens: selectedTokens / cases,
    avg_added_tokens: addedTokens / cases,
    avg_whole_source_equivalent_tokens: wholeSourceTokens / cases,
    avg_extra_chunks: extraChunks / cases,
    avg_token_savings_vs_whole_source: savingsSum / cases,
  };
}

export function renderLocalizedGraphAssemblyShadowReport(
  report: LocalizedGraphShadowReport,
): string {
  const lines: string[] = [];
  lines.push("Localized graph assembly shadow eval");
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
        "Avg chunks",
        "Avg tokens",
        "Whole-src equiv",
        "Savings",
        "Avg extras",
      ],
      ...report.summaries.map((s) => [
        s.mode,
        `${s.seed_full_coverage_cases}/${s.cases}`,
        `${s.full_coverage_cases}/${s.cases}`,
        String(s.newly_covered_vs_seed),
        String(s.newly_covered_vs_top3),
        pct(s.avg_required_coverage),
        oneDecimal(s.avg_selected_chunks),
        String(Math.round(s.avg_selected_tokens)),
        String(Math.round(s.avg_whole_source_equivalent_tokens)),
        pct(s.avg_token_savings_vs_whole_source),
        oneDecimal(s.avg_extra_chunks),
      ]),
    ]),
  );

  const improved = report.rows.filter((row) =>
    MODES.some((mode) =>
      requiredCoverage(row.top3_sources, row.required_sources) < 1 &&
      requiredCoverage(row.modes[mode].selected_sources, row.required_sources) === 1,
    ),
  );
  lines.push("");
  lines.push("Cases newly fully covered vs top3:");
  if (improved.length === 0) {
    lines.push("  none");
  } else {
    for (const row of improved.slice(0, 20)) {
      const modes = MODES.filter(
        (mode) => requiredCoverage(row.modes[mode].selected_sources, row.required_sources) === 1,
      );
      lines.push(`  ${row.repo}/${row.id}: ${modes.join(", ")}`);
    }
  }
  return lines.join("\n") + "\n";
}

export function collectMarkdownLinkReferences(root: Root, source_path: string): LinkReference[] {
  const definitions = new Map<string, string>();
  const collectDefinitions = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const typed = node as { type?: string; identifier?: unknown; label?: unknown; url?: unknown; children?: unknown[] };
    if (typed.type === "definition" && typeof typed.url === "string") {
      const key = String(typed.identifier ?? typed.label ?? "").toLowerCase();
      if (key) definitions.set(key, typed.url);
    }
    for (const child of typed.children ?? []) collectDefinitions(child);
  };
  collectDefinitions(root);

  const refs: LinkReference[] = [];
  const collectLinks = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const typed = node as {
      type?: string;
      identifier?: unknown;
      url?: unknown;
      children?: unknown[];
      position?: { start?: { line?: number } };
    };
    if (typed.type === "link" && typeof typed.url === "string") {
      const line = typed.position?.start?.line;
      if (line !== undefined) {
        refs.push({
          source_path,
          line,
          url: typed.url,
          label: nodeText(typed).trim(),
        });
      }
    }
    if (typed.type === "linkReference") {
      const key = String(typed.identifier ?? "").toLowerCase();
      const url = definitions.get(key);
      const line = typed.position?.start?.line;
      if (url && line !== undefined) {
        refs.push({
          source_path,
          line,
          url,
          label: nodeText(typed).trim() || key,
        });
      }
    }
    for (const child of typed.children ?? []) collectLinks(child);
  };
  collectLinks(root);
  return refs;
}

export function resolveLocalizedLinkTarget(args: {
  fromSource: string;
  url: string;
  label: string;
  query: string;
  sourceSet: Set<string>;
  chunksBySource: Map<string, DocChunk[]>;
}): ResolvedLinkTarget | undefined {
  const resolved = resolveLinkSource(args);
  if (!resolved || resolved.ambiguous) return undefined;
  const chunks = args.chunksBySource.get(resolved.source_path) ?? [];
  if (chunks.length === 0) return undefined;

  if (resolved.hash) {
    const target = resolveHashChunk(chunks, resolved.hash);
    if (!target) return undefined;
    return {
      source_path: target.source_path,
      chunk: target,
      reason: "hash_heading",
      score: 100,
    };
  }

  const labelGeneric = isGenericLabel(args.label);
  const scored = scoreTargetChunks({
    chunks,
    query: args.query,
    label: args.label,
  });
  const best = scored[0];
  if (best && best.score > 0) {
    if (labelGeneric && best.queryOverlap === 0) return undefined;
    return {
      source_path: best.chunk.source_path,
      chunk: best.chunk,
      reason: best.queryOverlap > 0 ? "target_heading_query_overlap" : "target_heading_label_overlap",
      score: best.score,
    };
  }

  if (labelGeneric) return undefined;
  const intro = introChunk(chunks);
  if (!intro) return undefined;
  return {
    source_path: intro.source_path,
    chunk: intro,
    reason: "target_intro_fallback",
    score: 0.25,
  };
}

export function chunkContainingLine(chunks: DocChunk[], line: number): DocChunk | undefined {
  return chunks
    .filter((chunk) => chunk.start_line <= line && line <= chunk.end_line)
    .sort(
      (a, b) =>
        (a.end_line - a.start_line) - (b.end_line - b.start_line) ||
        a.chunk_index - b.chunk_index ||
        a.version_id.localeCompare(b.version_id),
    )[0];
}

function resolveLinkSource(args: {
  fromSource: string;
  url: string;
  sourceSet: Set<string>;
}): { source_path: string; hash?: string; ambiguous: boolean } | undefined {
  const raw = args.url.trim();
  if (!raw) return undefined;
  if (/^(?:https?:|mailto:|tel:|javascript:)/i.test(raw)) return undefined;

  const hashIndex = raw.indexOf("#");
  const beforeHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const hash = hashIndex >= 0 ? safeDecodeUri(raw.slice(hashIndex + 1)).trim() : "";
  const pathPart = beforeHash.replace(/[?].*$/, "");
  if (!pathPart && !hash) return undefined;

  if (!pathPart) {
    return { source_path: args.fromSource, hash, ambiguous: false };
  }

  const decoded = safeDecodeUri(pathPart).replace(/\\/g, "/");
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

  const matches = unique(expandPathCandidates(candidates).filter((candidate) => args.sourceSet.has(candidate)));
  if (matches.length === 0) return undefined;
  if (matches.length > 1) return { source_path: matches[0]!, hash, ambiguous: true };
  return { source_path: matches[0]!, hash, ambiguous: false };
}

function buildNavEdges(args: {
  chunks: DocChunk[];
  profiles: SourceProfile[];
}): Map<string, LocalizedGraphEdge[]> {
  const bySource = groupChunksBySource(args.chunks);
  const bySourceProfile = new Map(args.profiles.map((profile) => [profile.source_path, profile]));
  const nav = new Map<string, LocalizedGraphEdge[]>();
  for (const root of args.chunks) {
    const profile = bySourceProfile.get(root.source_path);
    if (!profile?.nav_section_id || profile.nav_provenance !== "explicit_config") continue;
    const section = args.profiles
      .filter((p) => p.nav_section_id === profile.nav_section_id)
      .filter((p) => p.nav_provenance === "explicit_config")
      .sort(compareNavOrder);
    const candidates: SourceProfile[] = [];
    const landing = section.find((p) => p.is_nav_landing === true);
    if (landing && landing.source_path !== root.source_path) candidates.push(landing);
    const idx = section.findIndex((p) => p.source_path === root.source_path);
    if (idx >= 0) {
      for (const neighbor of [section[idx - 1], section[idx + 1]]) {
        if (neighbor && neighbor.source_path !== root.source_path) candidates.push(neighbor);
      }
    }
    for (const candidate of uniqueBy(candidates, (p) => p.source_path)) {
      const target = introChunk(bySource.get(candidate.source_path) ?? []);
      if (!target) continue;
      pushEdge(nav, root.version_id, {
        edge_kind: "nav_explicit",
        direction: "nav",
        provenance: "explicit_config",
        from_chunk_id: root.version_id,
        from_source: root.source_path,
        target_chunk_id: target.version_id,
        target_source: target.source_path,
        target_tokens: target.token_count,
        label: candidate.nav_label ?? candidate.title,
        selection_reason: candidate.is_nav_landing ? "explicit_nav_landing" : "explicit_nav_adjacent",
        score: candidate.is_nav_landing ? 5 : 2,
      });
    }
  }
  sortEdgeMap(nav);
  return nav;
}

function candidateEdgesForMode(
  mode: LocalizedGraphAssemblyMode,
  rootId: string,
  graph: LocalizedGraph,
): LocalizedGraphEdge[] {
  if (mode === "root_link_out_1") return [...(graph.outbound.get(rootId) ?? [])].sort(compareEdges);
  if (mode === "root_link_bidir_1") {
    return [
      ...(graph.outbound.get(rootId) ?? []),
      ...(graph.inbound.get(rootId) ?? []),
    ].sort(compareEdges);
  }
  if (mode === "root_nav_explicit_1") return [...(graph.nav.get(rootId) ?? [])].sort(compareEdges);
  return [
    ...(graph.outbound.get(rootId) ?? []),
    ...(graph.nav.get(rootId) ?? []),
    ...(graph.inbound.get(rootId) ?? []),
  ].sort(compareEdges);
}

function scoreTargetChunks(args: {
  chunks: DocChunk[];
  query: string;
  label: string;
}): Array<{ chunk: DocChunk; score: number; queryOverlap: number }> {
  const queryTokens = tokenSet(args.query);
  const labelTokens = tokenSet(args.label);
  return args.chunks
    .map((chunk) => {
      const heading = chunk.heading_path.join(" ");
      const headingTokens = tokenSet(heading);
      const queryOverlap = countOverlap(queryTokens, headingTokens);
      const labelOverlap = countOverlap(labelTokens, headingTokens);
      const phraseBoost =
        containsPhrase(heading, args.query) || containsPhrase(heading, args.label) ? 2 : 0;
      const score = queryOverlap * 3 + labelOverlap * 2 + phraseBoost - chunk.chunk_index * 0.001;
      return { chunk, score, queryOverlap };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.chunk.heading_path.length - b.chunk.heading_path.length ||
        a.chunk.chunk_index - b.chunk.chunk_index ||
        a.chunk.version_id.localeCompare(b.chunk.version_id),
    );
}

function resolveHashChunk(chunks: DocChunk[], hash: string): DocChunk | undefined {
  const normalized = slugify(hash);
  if (!normalized) return undefined;
  return chunks
    .filter((chunk) => {
      const headingSlug = chunk.heading_slug ?? slugify(chunk.title);
      return headingSlug === normalized || slugify(chunk.heading_path[chunk.heading_path.length - 1] ?? "") === normalized;
    })
    .sort(
      (a, b) =>
        a.chunk_index - b.chunk_index ||
        a.start_line - b.start_line ||
        a.version_id.localeCompare(b.version_id),
    )[0];
}

function emptySelection(mode: LocalizedGraphAssemblyMode): LocalizedGraphSelection {
  return {
    mode,
    selected_chunk_ids: [],
    selected_sources: [],
    selected_tokens: 0,
    added_chunks: [],
    added_tokens: 0,
    whole_source_equivalent_tokens: 0,
    omitted_edges: [],
  };
}

function rootOnlySelection(
  mode: LocalizedGraphAssemblyMode,
  root: DocChunk,
  profilesBySource: Map<string, SourceProfile>,
): LocalizedGraphSelection {
  return {
    mode,
    root_chunk_id: root.version_id,
    root_source: root.source_path,
    selected_chunk_ids: [root.version_id],
    selected_sources: [root.source_path],
    selected_tokens: root.token_count,
    added_chunks: [],
    added_tokens: 0,
    whole_source_equivalent_tokens: profilesBySource.get(root.source_path)?.token_count ?? 0,
    omitted_edges: [],
  };
}

function omit(
  edge: LocalizedGraphEdge,
  reason: LocalizedGraphSelection["omitted_edges"][number]["reason"],
): LocalizedGraphSelection["omitted_edges"][number] {
  return {
    target_chunk_id: edge.target_chunk_id,
    target_source: edge.target_source,
    reason,
    edge_kind: edge.edge_kind,
    direction: edge.direction,
  };
}

function pushEdge(map: Map<string, LocalizedGraphEdge[]>, key: string, edge: LocalizedGraphEdge): void {
  const arr = map.get(key) ?? [];
  arr.push(edge);
  map.set(key, arr);
}

function sortEdgeMap(map: Map<string, LocalizedGraphEdge[]>): void {
  for (const [key, edges] of map) map.set(key, uniqueEdges(edges).sort(compareEdges));
}

function compareEdges(a: LocalizedGraphEdge, b: LocalizedGraphEdge): number {
  return (
    b.score - a.score ||
    directionPriority(a.direction) - directionPriority(b.direction) ||
    a.target_tokens - b.target_tokens ||
    a.target_chunk_id.localeCompare(b.target_chunk_id)
  );
}

function directionPriority(direction: LocalizedGraphEdgeDirection): number {
  if (direction === "outbound") return 0;
  if (direction === "nav") return 1;
  return 2;
}

function compareNavOrder(a: SourceProfile, b: SourceProfile): number {
  const ap = a.nav_position ?? Number.MAX_SAFE_INTEGER;
  const bp = b.nav_position ?? Number.MAX_SAFE_INTEGER;
  return ap - bp || a.source_path.localeCompare(b.source_path);
}

function introChunk(chunks: DocChunk[]): DocChunk | undefined {
  return [...chunks].sort(
    (a, b) =>
      a.heading_path.length - b.heading_path.length ||
      a.heading_level - b.heading_level ||
      a.chunk_index - b.chunk_index ||
      a.version_id.localeCompare(b.version_id),
  )[0];
}

function groupChunksBySource(chunks: DocChunk[]): Map<string, DocChunk[]> {
  const out = new Map<string, DocChunk[]>();
  for (const chunk of chunks) {
    const arr = out.get(chunk.source_path) ?? [];
    arr.push(chunk);
    out.set(chunk.source_path, arr);
  }
  for (const [source, local] of out) {
    out.set(source, local.sort((a, b) => a.start_line - b.start_line || a.chunk_index - b.chunk_index));
  }
  return out;
}

function nodeText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const typed = node as { type?: string; value?: unknown; children?: unknown[] };
  if ((typed.type === "text" || typed.type === "inlineCode" || typed.type === "code") && typeof typed.value === "string") {
    return typed.value;
  }
  return (typed.children ?? []).map(nodeText).join(" ");
}

function isGenericLabel(label: string): boolean {
  const normalized = label.toLowerCase().replace(/\s+/g, " ").trim();
  return normalized === "" || GENERIC_LINK_LABELS.has(normalized);
}

function tokenSet(value: string): Set<string> {
  return new Set(tokenize(value, { stem: true, splitCodeIdentifiers: true }).filter((token) => token.length > 1));
}

function countOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const token of a) if (b.has(token)) count += 1;
  return count;
}

function containsPhrase(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase().trim();
  const n = needle.toLowerCase().trim();
  return n.length >= 4 && h.includes(n);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
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
  return sourcePath.split("/").filter(Boolean)[0];
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
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

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const value of values) {
    const k = key(value);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(value);
  }
  return out;
}

function uniqueEdges(edges: LocalizedGraphEdge[]): LocalizedGraphEdge[] {
  return uniqueBy(edges, (edge) => `${edge.from_chunk_id}->${edge.target_chunk_id}:${edge.edge_kind}:${edge.direction}`);
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
  const report = await runLocalizedGraphAssemblyShadowEval(repos);
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(renderLocalizedGraphAssemblyShadowReport(report));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
