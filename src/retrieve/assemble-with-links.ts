/**
 * Engine-level context-assembly wrapper that adds K-hop markdown link
 * traversal to the standard retrieve() + presentContextPack() pipeline.
 *
 * The structural principle (universal across docs corpora) is identical
 * to the one validated by the real-workflow probe: when a doc surfaces
 * in retrieval, the docs it explicitly references via markdown links
 * are part of the assembly need. Expanding the candidate set up to K
 * hops along that link graph captures the foundational chain (PRD →
 * parent PRD → architecture doc) that engineers need but rarely query
 * for by lexical name.
 *
 * Real-workflow probe: 22.2% raw → 95.7% (22/23 tickets) with K=3,
 * 2-hop traversal. This wrapper is the engine-native form of that
 * traversal — callers (MCP handlers, CLI eval, in-process consumers)
 * get the assembled pack without having to reimplement traversal.
 */
import type { Db } from "../store/db.js";
import { listCurrentChunksCanonical } from "../store/read-model.js";
import { listSourceProfiles } from "../store/source-profiles.js";
import { loadConfig } from "../config/load.js";
import { retrieve, type RetrievalRequest } from "./retrieve.js";
import { presentContextPack, type PresentedContextPack } from "../mcp/presenter.js";
import { expandLinksKHops } from "./link-traversal.js";
import { expandNavSiblings } from "./nav-graph-traversal.js";
import type { DocChunk } from "../types/chunk.js";
import { buildCodeRankedEntries } from "./code-source-mix.js";
import { codeSourceIndexEnabledFromEnv } from "./code-source-flag.js";

export const LINK_TRAVERSAL_DEFAULT_HOPS = 2;
export const LINK_TRAVERSAL_INHERITED_SCORE_FRACTION = 0.5;

export type AssembleWithLinksArgs = {
  db: Db;
  request: RetrievalRequest;
  cwd: string;
  /** Override max hops; default 2. Set 0 to disable. */
  maxHops?: number;
  /** Override the inherited-score fraction for added link-target entries. */
  inheritedScoreFraction?: number;
  /** Pass through to presenter; default false. */
  explain?: boolean;
  /** Pass through to presenter; default false. */
  include_rendered_text?: boolean;
  /**
   * PRD-0030 / 30.2: override the budget the resolved `request.budget`
   * slot maps to. Used by the agent-completion probe's `--budget` /
   * `--budget-sweep` modes. When undefined, the loaded config is used
   * unchanged (default behavior).
   */
  budgetTokensOverride?: number;
};

export type AssembleWithLinksResult = {
  pack: PresentedContextPack;
  /** Source paths added by link traversal (not in raw retrieval). */
  linkPulledSources: string[];
};

/**
 * Resolve to true when an env override is unambiguously affirmative.
 * Default: enabled. Set RETRIEVAL_LINK_TRAVERSAL=off to disable.
 */
export function linkTraversalEnabledFromEnv(): boolean {
  const raw = process.env.RETRIEVAL_LINK_TRAVERSAL;
  if (raw === undefined) return true;
  const lower = raw.toLowerCase();
  if (lower === "off" || lower === "0" || lower === "false") return false;
  return true;
}

function sourceFromContextTrail(b: string): string {
  const m = b.match(/^Source:\s+([^>]+?)(?:\s+>|$)/);
  return m?.[1]?.trim() ?? "";
}

function groupChunksBySource(chunks: DocChunk[]): Map<string, DocChunk[]> {
  const out = new Map<string, DocChunk[]>();
  for (const c of chunks) {
    if (c.status !== "current") continue;
    const list = out.get(c.source_path) ?? [];
    list.push(c);
    out.set(c.source_path, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.chunk_index - b.chunk_index);
  }
  return out;
}

export function assembleContextPackWithLinks(
  args: AssembleWithLinksArgs,
): AssembleWithLinksResult {
  const loadedConfig = loadConfig(args.cwd);
  const config = args.budgetTokensOverride === undefined
    ? loadedConfig
    : {
        ...loadedConfig,
        retrieval: {
          ...loadedConfig.retrieval,
          budgets: {
            ...loadedConfig.retrieval.budgets,
            [args.request.budget ?? "default"]: args.budgetTokensOverride,
          },
        },
      };
  const result = retrieve(args.db, args.request, config);
  const allChunks = listCurrentChunksCanonical(args.db) as DocChunk[];
  const chunksBySource = groupChunksBySource(allChunks);
  const corpusSources = new Set(chunksBySource.keys());

  const has_sources = corpusSources.size > 0;
  const pack = presentContextPack({
    query: args.request.task,
    result,
    requested_budget: config.retrieval.budgets[args.request.budget ?? "default"] ?? 0,
    has_sources,
    explain: args.explain ?? false,
    min_final_score: config.retrieval.min_final_score,
    ...(args.include_rendered_text ? { include_rendered_text: true } : {}),
  });

  const maxHops = args.maxHops ?? LINK_TRAVERSAL_DEFAULT_HOPS;
  if (maxHops <= 0 || !linkTraversalEnabledFromEnv()) {
    return { pack, linkPulledSources: [] };
  }

  // Whole-doc body for link extraction = concatenated current chunks per
  // source, in chunk_index order. This is the engine-native equivalent
  // of reading the file off disk.
  const resolveBody = (sourcePath: string): string => {
    const chunks = chunksBySource.get(sourcePath);
    if (!chunks || chunks.length === 0) return "";
    return chunks.map((c) => c.body).join("\n\n");
  };

  const surfacedSources = new Set<string>();
  for (const r of pack.ranked) {
    if (r.kind !== "chunk") continue;
    const src = sourceFromContextTrail(r.contexttrail);
    if (src) surfacedSources.add(src);
  }
  if (surfacedSources.size === 0) {
    return { pack, linkPulledSources: [] };
  }

  const linkExpanded = expandLinksKHops({
    seeds: surfacedSources,
    corpusSources,
    resolveBody,
    maxHops,
  });

  // PRD-0027 follow-up: nav-graph sibling expansion. The link lever
  // only fires on link-heavy corpora (ContextTrail 324 inline links vs
  // valibot 0 / biome 0 / prisma 0). The nav lever uses the SourceProfile
  // nav_section_id captured by slice 27.1.2 to surface same-section
  // siblings — universal across vitepress / mkdocs / docusaurus /
  // frontmatter-sidebar corpora.
  const navFacts = listSourceProfiles(args.db).map((p) => ({
    source_path: p.source_path,
    nav_section_id: p.nav_section_id ?? null,
    nav_provenance: p.nav_provenance ?? null,
  }));
  const navExpanded = expandNavSiblings({
    seeds: surfacedSources,
    navFacts,
  });

  const expanded = new Set<string>([...linkExpanded, ...navExpanded]);

  const linkPulled: string[] = [];
  const additions: PresentedContextPack["ranked"] = [];
  const scoreFraction = args.inheritedScoreFraction ?? LINK_TRAVERSAL_INHERITED_SCORE_FRACTION;
  const rankedScores = pack.ranked.map((r) => r.score);
  const minScore = rankedScores.length > 0 ? Math.min(...rankedScores) : 0;
  const inheritedScore = Math.max(0, minScore * scoreFraction);

  for (const sp of expanded) {
    if (surfacedSources.has(sp)) continue;
    const chunks = chunksBySource.get(sp);
    if (!chunks || chunks.length === 0) continue;
    const first = chunks[0]!;
    linkPulled.push(sp);
    additions.push({
      id: first.version_id,
      kind: "chunk",
      scope: first.scope,
      tokens: first.token_count,
      score: inheritedScore,
      body: first.body,
      contexttrail: `Source: ${sp} > ${first.heading_path.join(" > ")} (link-traversed)`,
      type_bias_applied: false,
    });
  }

  const augmented: PresentedContextPack = {
    ...pack,
    ranked: [...pack.ranked, ...additions],
  };
  // PRD-0028 / slice 28.3: mix code-source candidates into ranked output.
  // Default OFF until promotion gates pass; toggled by
  // RETRIEVAL_CODE_SOURCE_INDEX. Code entries carry `kind: "code"`.
  const codeEntries = codeSourceIndexEnabledFromEnv()
    ? buildCodeRankedEntries({ db: args.db, query: args.request.task })
    : [];
  if (codeEntries.length > 0) {
    augmented.ranked = [...augmented.ranked, ...codeEntries];
  }
  return { pack: augmented, linkPulledSources: linkPulled };
}
