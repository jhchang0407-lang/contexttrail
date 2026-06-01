/**
 * Resolved Context Pack representation (Slice B / THO-67).
 *
 * One normalized internal representation that the three Context Pack projections
 * consume:
 *   - MCP wire format         (`mcp/presenter.ts`)
 *   - CLI markdown            (`retrieve/render.ts:renderText`)
 *   - CLI debug JSON          (`retrieve/render.ts:renderJson`)
 *
 * Each projection has a legitimately different presentation grammar (audiences,
 * ordering rules, formatting). The duplication this module removes is *resolution*:
 * card/chunk lookups, freshness state structuring, lock-reason wiring, ordering,
 * and warning derivation. Pre-formatted display strings live in projections, not
 * here — `freshness-policy.ts` and `cards/locked-include.ts` own the meaning;
 * projections own the formatting.
 */
import type { Card, AuthorReviewState, FreshnessReason, FreshnessState } from "../types/card.js";
import type { DocChunk } from "../types/chunk.js";
import type { StoredCodeChunk } from "../archive/code-engine-era-2026-05/code-engine/types/code-source.js";
import type { LockFailure, LockReason } from "../cards/locked-include.js";
import type {
  CardPackedTrace,
  CodePackedTrace,
  DocChunkPackedTrace,
  IncludedTrace,
  LockedEntry,
  OmittedTrace,
  PackResult,
} from "./pack.js";
import type { QueryCompilation, QueryMode } from "./query-scope.js";

/**
 * Display ordering for ranked entries. Used by all three projections.
 * Splits cards-of-type-evidence into a separate group so projections that
 * want a distinct evidence section (markdown) can render it; projections
 * that flatten (wire, json) concatenate `relevant + evidence`.
 */
export function orderIncludedForRender(
  included: IncludedTrace[],
  chunksByVersionId?: Map<string, DocChunk>,
  codeByVersionId?: Map<string, StoredCodeChunk>,
  cardsByCardId?: Map<string, Card>,
  options?: {
    diversifyAcrossSources?: boolean;
    query_text?: string;
    query_mode?: QueryMode;
    query_compilation?: QueryCompilation;
  },
): {
  relevant: IncludedTrace[];
  evidence: Extract<IncludedTrace, { kind: "card" }>[];
} {
  const relevant: IncludedTrace[] = [];
  const evidence: Extract<IncludedTrace, { kind: "card" }>[] = [];
  for (const trace of included) {
    if (trace.kind !== "card") {
      relevant.push(trace);
      continue;
    }
    const card = cardsByCardId?.get(trace.card_id);
    if (card?.type === "evidence") evidence.push(trace);
    else relevant.push(trace);
  }
  return {
    relevant: orderByDisplayRelevance(
      relevant,
      chunksByVersionId,
      codeByVersionId,
      cardsByCardId,
      options,
    ),
    evidence: orderByDisplayRelevance(evidence),
  };
}

function orderByDisplayRelevance<T extends IncludedTrace>(
  traces: T[],
  chunksByVersionId?: Map<string, DocChunk>,
  codeByVersionId?: Map<string, StoredCodeChunk>,
  cardsByCardId?: Map<string, Card>,
  options?: {
    diversifyAcrossSources?: boolean;
    query_text?: string;
    query_mode?: QueryMode;
    query_compilation?: QueryCompilation;
  },
): T[] {
  const firstReadSignals = buildFirstReadSignals(
    options?.query_mode,
    options?.query_compilation,
    traces,
    chunksByVersionId,
  );
  const rationaleSignals = buildRationaleSignals(
    options?.query_mode,
    options?.query_text,
    traces,
    chunksByVersionId,
  );
  const unanchoredTopicSignals = buildUnanchoredTopicSignals(
    options?.query_mode,
    options?.query_text,
  );
  const sorted = [...traces].sort((a, b) => {
    const codeBias = compareCodeDisplayPriority(a, b);
    if (codeBias !== 0) return codeBias;
    const sourceSelectionBias = compareSourceSelectionPriority(a, b);
    if (sourceSelectionBias !== 0) return sourceSelectionBias;
    const structuralBias = compareStructuralAssemblyPriority(a, b);
    if (structuralBias !== 0) return structuralBias;
    const sourceRerankBias = compareSourceRerankPriority(a, b);
    if (sourceRerankBias !== 0) return sourceRerankBias;
    const sourceScopedBias = compareSourceScopedPriority(a, b);
    if (sourceScopedBias !== 0) return sourceScopedBias;
    const rationaleBias = compareRationalePriority(a, b, rationaleSignals, chunksByVersionId);
    if (rationaleBias !== 0) return rationaleBias;
    const topicalBias = compareUnanchoredTopicPriority(
      a,
      b,
      unanchoredTopicSignals,
      chunksByVersionId,
    );
    if (topicalBias !== 0) return topicalBias;
    const firstReadBias = compareFirstReadPriority(
      a,
      b,
      firstReadSignals,
      chunksByVersionId,
    );
    if (firstReadBias !== 0) return firstReadBias;
    if (b.final_score !== a.final_score) return b.final_score - a.final_score;
    if (b.scope_match !== a.scope_match) return b.scope_match - a.scope_match;
    if (b.mention_overlap !== a.mention_overlap) return b.mention_overlap - a.mention_overlap;
    if (b.packing_score !== a.packing_score) return b.packing_score - a.packing_score;
    return a.version_id.localeCompare(b.version_id);
  });
  const sourceDiversified = promoteFirstChunkPerRerankedSource(sorted);
  if (unanchoredTopicSignals.enabled) {
    return diversifyTailAfterFirst(
      sourceDiversified,
      chunksByVersionId,
      codeByVersionId,
      cardsByCardId,
    );
  }
  if (!options?.diversifyAcrossSources && !rationaleSignals.enabled) return sourceDiversified;
  return diversifyAcrossSources(
    sourceDiversified,
    chunksByVersionId,
    codeByVersionId,
    cardsByCardId,
  );
}

function compareStructuralAssemblyPriority(a: IncludedTrace, b: IncludedTrace): number {
  if (a.kind !== "doc_chunk" || b.kind !== "doc_chunk") return 0;
  return compareOptionalRank(
    a.structural_assembly_rank,
    b.structural_assembly_rank,
  );
}

function compareCodeDisplayPriority(a: IncludedTrace, b: IncludedTrace): number {
  if (a.kind === "code" && b.kind !== "code") return -1;
  if (a.kind !== "code" && b.kind === "code") return 1;
  if (a.kind !== "code" || b.kind !== "code") return 0;
  return compareOptionalRank(a.code_rank, b.code_rank);
}

function compareSourceScopedPriority(a: IncludedTrace, b: IncludedTrace): number {
  if (a.kind !== "doc_chunk" || b.kind !== "doc_chunk") return 0;
  return compareOptionalRank(
    a.source_scoped_selection_rank,
    b.source_scoped_selection_rank,
  );
}

function compareSourceRerankPriority(a: IncludedTrace, b: IncludedTrace): number {
  if (a.kind !== "doc_chunk" || b.kind !== "doc_chunk") return 0;
  return compareOptionalRank(a.source_rerank_rank, b.source_rerank_rank);
}

function compareSourceSelectionPriority(a: IncludedTrace, b: IncludedTrace): number {
  if (a.kind !== "doc_chunk" || b.kind !== "doc_chunk") return 0;
  return compareOptionalRank(a.source_selection_rank, b.source_selection_rank);
}

function promoteFirstChunkPerRerankedSource<T extends IncludedTrace>(traces: T[]): T[] {
  if (traces.some((trace) => trace.kind === "code")) {
    const code: T[] = [];
    const rest: T[] = [];
    for (const trace of traces) {
      if (trace.kind === "code") code.push(trace);
      else rest.push(trace);
    }
    return [...code, ...promoteFirstChunkPerRerankedSource(rest)];
  }

  const useSelection = traces.some(
    (trace) => trace.kind === "doc_chunk" && trace.source_selection_rank !== undefined,
  );
  const rankOf = (trace: IncludedTrace): number | undefined => {
    if (trace.kind !== "doc_chunk") return undefined;
    return useSelection ? trace.source_selection_rank : trace.source_rerank_rank;
  };
  const rerankedSourceCount = new Set(
    traces.flatMap((trace) => {
      const rank = rankOf(trace);
      return rank === undefined ? [] : [rank];
    }),
  ).size;
  if (rerankedSourceCount < 2) return traces;

  const seenSourceRanks = new Set<number>();
  const firstPerSource: T[] = [];
  const rest: T[] = [];
  for (const trace of traces) {
    const rank = rankOf(trace);
    if (rank === undefined) {
      rest.push(trace);
      continue;
    }
    if (seenSourceRanks.has(rank)) {
      rest.push(trace);
      continue;
    }
    seenSourceRanks.add(rank);
    firstPerSource.push(trace);
  }
  return [...firstPerSource, ...rest];
}

function compareOptionalRank(a: number | undefined, b: number | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  if (a === b) return 0;
  return a - b;
}

function diversifyTailAfterFirst<T extends IncludedTrace>(
  traces: T[],
  chunksByVersionId?: Map<string, DocChunk>,
  codeByVersionId?: Map<string, StoredCodeChunk>,
  cardsByCardId?: Map<string, Card>,
): T[] {
  if (traces.length <= 2) return traces;
  const first = traces[0];
  if (first === undefined) return traces;
  const tail = traces.slice(1);
  const seen = new Set<string>([
    displayGroupKey(first, chunksByVersionId, codeByVersionId, cardsByCardId),
  ]);
  const firstByGroup: T[] = [];
  const rest: T[] = [];
  for (const trace of tail) {
    const key = displayGroupKey(trace, chunksByVersionId, codeByVersionId, cardsByCardId);
    if (seen.has(key)) {
      rest.push(trace);
      continue;
    }
    seen.add(key);
    firstByGroup.push(trace);
  }
  return [first, ...firstByGroup, ...rest];
}

function diversifyAcrossSources<T extends IncludedTrace>(
  traces: T[],
  chunksByVersionId?: Map<string, DocChunk>,
  codeByVersionId?: Map<string, StoredCodeChunk>,
  cardsByCardId?: Map<string, Card>,
): T[] {
  const firstByGroup: T[] = [];
  const rest: T[] = [];
  const seen = new Set<string>();
  for (const trace of traces) {
    const key = displayGroupKey(trace, chunksByVersionId, codeByVersionId, cardsByCardId);
    if (seen.has(key)) {
      rest.push(trace);
      continue;
    }
    seen.add(key);
    firstByGroup.push(trace);
  }
  return [...firstByGroup, ...rest];
}

function displayGroupKey(
  trace: IncludedTrace,
  chunksByVersionId?: Map<string, DocChunk>,
  codeByVersionId?: Map<string, StoredCodeChunk>,
  cardsByCardId?: Map<string, Card>,
): string {
  if (trace.kind === "card") {
    const card = cardsByCardId?.get(trace.card_id);
    return `card:${card?.id ?? trace.card_id}`;
  }
  if (trace.kind === "code") {
    const chunk = codeByVersionId?.get(trace.version_id);
    return `code:${chunk?.source_path ?? trace.version_id}`;
  }
  const chunk = chunksByVersionId?.get(trace.version_id);
  return `doc:${chunk?.source_path ?? trace.version_id}`;
}

function shouldDiversifyDisplayOrder(
  query_mode: QueryMode,
  query_compilation: QueryCompilation,
): boolean {
  if (query_mode !== "anchored") return false;
  const distinctScopes = new Set<string>();
  for (const anchor of query_compilation.anchors) {
    for (const scope of anchor.scopes) {
      distinctScopes.add(JSON.stringify(scope));
    }
  }
  return distinctScopes.size >= 2;
}

type FirstReadSignals = {
  enabled: boolean;
  fileOnlyMultiScope: boolean;
  routeSymbolOnlyMultiScope: boolean;
  directContributorChunkIds: Set<string>;
  fallbackContributorChunkIds: Set<string>;
  fileAnchorOrderByKey: Map<string, number>;
  moduleSupportByKey: Map<string, number>;
  highScoreFloor: number;
};

const DIRECT_CONTRIBUTOR_SCORE_WINDOW = 0.8;
const RATIONALE_SCORE_WINDOW = 0.5;
const RATIONALE_QUERY_PATTERN = /\b(why|decision|decisions|rationale|tradeoff|tradeoffs|adr|because|govern|security)\b/i;
const UNANCHORED_TOPIC_SCORE_THRESHOLD = 3;

function buildFirstReadSignals(
  query_mode: QueryMode | undefined,
  query_compilation: QueryCompilation | undefined,
  traces: IncludedTrace[],
  chunksByVersionId?: Map<string, DocChunk>,
): FirstReadSignals {
  if (
    query_mode !== "anchored" ||
    query_compilation === undefined ||
    !shouldDiversifyDisplayOrder(query_mode, query_compilation)
  ) {
    return {
      enabled: false,
      fileOnlyMultiScope: false,
      routeSymbolOnlyMultiScope: false,
      directContributorChunkIds: new Set<string>(),
      fallbackContributorChunkIds: new Set<string>(),
      fileAnchorOrderByKey: new Map<string, number>(),
      moduleSupportByKey: new Map<string, number>(),
      highScoreFloor: -Infinity,
    };
  }

  const highScoreFloor =
    Math.max(...traces.map((trace) => trace.final_score)) - DIRECT_CONTRIBUTOR_SCORE_WINDOW;
  const directContributorChunkIds = new Set<string>();
  const fallbackContributorChunkIds = new Set<string>();
  const fileAnchorOrderByKey = new Map<string, number>();
  const moduleSupportByKey = new Map<string, number>();
  const routeSymbolOnlyMultiScope =
    query_compilation.anchors.length >= 2 &&
    query_compilation.anchors.every((anchor) => anchor.anchor.kind !== "file") &&
    query_compilation.anchors.some((anchor) => anchor.anchor.kind === "route") &&
    query_compilation.anchors.some((anchor) => anchor.anchor.kind === "symbol");
  for (const [anchorIndex, anchor] of query_compilation.anchors.entries()) {
    const anchorWeight =
      anchor.anchor.kind === "file"
        ? 1
        : routeSymbolOnlyMultiScope && anchor.anchor.kind === "route"
          ? 3
          : 2;
    let sawChunkContributor = false;
    for (const contributor of anchor.contributing_anchors) {
      if (contributor.kind !== "chunk") continue;
      sawChunkContributor = true;
      if (chunksByVersionId?.has(contributor.object_id) !== false) {
        directContributorChunkIds.add(contributor.object_id);
      }
    }
    if (!sawChunkContributor && anchor.anchor.kind === "file") {
      let bestMatch: IncludedTrace | undefined;
      for (const trace of traces) {
        if (trace.kind === "card") continue;
        const chunk = chunksByVersionId?.get(trace.version_id);
        if (!chunk?.scope.project || !chunk.scope.module) continue;
        const matchesAnchorScope = anchor.scopes.some(
          (scope) => scope.project === chunk.scope.project && scope.module === chunk.scope.module,
        );
        if (!matchesAnchorScope) continue;
        if (!bestMatch || trace.final_score > bestMatch.final_score) bestMatch = trace;
      }
      if (bestMatch) fallbackContributorChunkIds.add(bestMatch.version_id);
    }
    for (const scope of anchor.scopes) {
      if (!scope.project || !scope.module) continue;
      const key = `${scope.project}::${scope.module}`;
      if (anchor.anchor.kind === "file" && !fileAnchorOrderByKey.has(key)) {
        fileAnchorOrderByKey.set(key, anchorIndex);
      }
      moduleSupportByKey.set(key, Math.max(moduleSupportByKey.get(key) ?? 0, anchorWeight));
    }
  }

  return {
    enabled: true,
    fileOnlyMultiScope: query_compilation.anchors.every((anchor) => anchor.anchor.kind === "file"),
    routeSymbolOnlyMultiScope,
    directContributorChunkIds,
    fallbackContributorChunkIds,
    fileAnchorOrderByKey,
    moduleSupportByKey,
    highScoreFloor,
  };
}

type RationaleSignals = {
  enabled: boolean;
  highScoreFloor: number;
};

type UnanchoredTopicSignals = {
  enabled: boolean;
  queryTokens: string[];
};

function buildRationaleSignals(
  query_mode: QueryMode | undefined,
  query_text: string | undefined,
  traces: IncludedTrace[],
  chunksByVersionId?: Map<string, DocChunk>,
): RationaleSignals {
  if (
    query_mode !== "unanchored" ||
    query_text === undefined ||
    !RATIONALE_QUERY_PATTERN.test(query_text)
  ) {
    return { enabled: false, highScoreFloor: -Infinity };
  }
  const hasRationaleDoc = traces.some((trace) =>
    trace.kind !== "card" && isRationaleDoc(chunksByVersionId?.get(trace.version_id)),
  );
  if (!hasRationaleDoc) return { enabled: false, highScoreFloor: -Infinity };
  return {
    enabled: true,
    highScoreFloor: Math.max(...traces.map((trace) => trace.final_score)) - RATIONALE_SCORE_WINDOW,
  };
}

function compareRationalePriority(
  a: IncludedTrace,
  b: IncludedTrace,
  signals: RationaleSignals,
  chunksByVersionId?: Map<string, DocChunk>,
): number {
  if (!signals.enabled) return 0;
  const aPriority = rationalePriority(a, signals, chunksByVersionId);
  const bPriority = rationalePriority(b, signals, chunksByVersionId);
  if (aPriority !== bPriority) return bPriority - aPriority;
  return 0;
}

function rationalePriority(
  trace: IncludedTrace,
  signals: RationaleSignals,
  chunksByVersionId?: Map<string, DocChunk>,
): number {
  if (trace.kind === "card" || trace.final_score < signals.highScoreFloor) return 0;
  return isRationaleDoc(chunksByVersionId?.get(trace.version_id)) ? 1 : 0;
}

function isRationaleDoc(chunk: DocChunk | undefined): boolean {
  if (!chunk) return false;
  if (chunk.source_path.includes("/adr/")) return true;
  return chunk.heading_path.some((heading) =>
    /^(ADR-\d+|Decision|Consequences|Context)\b/i.test(heading),
  );
}

function buildUnanchoredTopicSignals(
  query_mode: QueryMode | undefined,
  query_text: string | undefined,
): UnanchoredTopicSignals {
  if (
    query_mode !== "unanchored" ||
    query_text === undefined ||
    RATIONALE_QUERY_PATTERN.test(query_text)
  ) {
    return { enabled: false, queryTokens: [] };
  }
  const queryTokens = topicTokens(query_text);
  if (queryTokens.length === 0) return { enabled: false, queryTokens: [] };
  return { enabled: true, queryTokens };
}

function compareUnanchoredTopicPriority(
  a: IncludedTrace,
  b: IncludedTrace,
  signals: UnanchoredTopicSignals,
  chunksByVersionId?: Map<string, DocChunk>,
): number {
  if (!signals.enabled) return 0;
  const aPriority = unanchoredTopicPriority(a, signals, chunksByVersionId);
  const bPriority = unanchoredTopicPriority(b, signals, chunksByVersionId);
  if (aPriority.score >= UNANCHORED_TOPIC_SCORE_THRESHOLD || bPriority.score >= UNANCHORED_TOPIC_SCORE_THRESHOLD) {
    if (aPriority.score !== bPriority.score) return bPriority.score - aPriority.score;
    if (aPriority.firstMatchIndex !== bPriority.firstMatchIndex) {
      return aPriority.firstMatchIndex - bPriority.firstMatchIndex;
    }
  }
  return 0;
}

function unanchoredTopicPriority(
  trace: IncludedTrace,
  signals: UnanchoredTopicSignals,
  chunksByVersionId?: Map<string, DocChunk>,
): { score: number; firstMatchIndex: number } {
  if (trace.kind === "card") return { score: 0, firstMatchIndex: Number.POSITIVE_INFINITY };
  const chunk = chunksByVersionId?.get(trace.version_id);
  if (!chunk) return { score: 0, firstMatchIndex: Number.POSITIVE_INFINITY };

  const sourceTokens = topicTokens(chunk.source_path.split("/").pop()?.replace(/\.md$/i, "") ?? "");
  const headingTokens = topicTokens(chunk.heading_path.join(" "));

  let score = 0;
  let firstMatchIndex = Number.POSITIVE_INFINITY;
  for (const [index, token] of signals.queryTokens.entries()) {
    const sourceMatch = sourceTokens.some((candidate) => topicalTokenMatch(token, candidate));
    const headingMatch = headingTokens.some((candidate) => topicalTokenMatch(token, candidate));
    if (!sourceMatch && !headingMatch) continue;
    score += sourceMatch
      ? Math.max(1, 4 - index * 0.75)
      : Math.max(0.5, 2 - index * 0.35);
    if (index < firstMatchIndex) firstMatchIndex = index;
  }
  return { score, firstMatchIndex };
}

function topicTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !TOPIC_STOPWORDS.has(token))
    .map(stemTopicToken);
}

function stemTopicToken(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function topicalTokenMatch(queryToken: string, candidateToken: string): boolean {
  if (queryToken === candidateToken) return true;
  if (queryToken.length >= 6 && candidateToken.length >= 6) {
    return queryToken.startsWith(candidateToken) || candidateToken.startsWith(queryToken);
  }
  return false;
}

const TOPIC_STOPWORDS = new Set([
  "how",
  "are",
  "and",
  "the",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "when",
  "api",
  "after",
  "before",
  "against",
  "work",
  "handling",
  "event",
  "operation",
  "behavior",
  "existing",
  "return",
]);

function compareFirstReadPriority(
  a: IncludedTrace,
  b: IncludedTrace,
  signals: FirstReadSignals,
  chunksByVersionId?: Map<string, DocChunk>,
): number {
  if (!signals.enabled) return 0;
  const aPriority = firstReadPriority(a, signals, chunksByVersionId);
  const bPriority = firstReadPriority(b, signals, chunksByVersionId);
  if (
    signals.fileOnlyMultiScope &&
    a.kind !== "card" &&
    b.kind !== "card" &&
    aPriority.fileAnchorOrder !== bPriority.fileAnchorOrder
  ) {
    return aPriority.fileAnchorOrder - bPriority.fileAnchorOrder;
  }
  if (aPriority.directContributor !== bPriority.directContributor) {
    return bPriority.directContributor - aPriority.directContributor;
  }
  if (aPriority.kindRank !== bPriority.kindRank) {
    return bPriority.kindRank - aPriority.kindRank;
  }
  if (aPriority.directContributor === 0 && bPriority.directContributor === 0) {
    if (aPriority.moduleSupport !== bPriority.moduleSupport) {
      return bPriority.moduleSupport - aPriority.moduleSupport;
    }
    return 0;
  }
  if (aPriority.moduleSupport !== bPriority.moduleSupport) {
    return bPriority.moduleSupport - aPriority.moduleSupport;
  }
  if (aPriority.scopeSpecificity !== bPriority.scopeSpecificity) {
    return bPriority.scopeSpecificity - aPriority.scopeSpecificity;
  }
  if (aPriority.introRank !== bPriority.introRank) {
    return bPriority.introRank - aPriority.introRank;
  }
  return 0;
}

function firstReadPriority(
  trace: IncludedTrace,
  signals: FirstReadSignals,
  chunksByVersionId?: Map<string, DocChunk>,
): {
  directContributor: number;
  fileAnchorOrder: number;
  moduleSupport: number;
  kindRank: number;
  scopeSpecificity: number;
  introRank: number;
} {
  if (trace.kind === "card") {
    return {
      directContributor: 0,
      fileAnchorOrder: Number.POSITIVE_INFINITY,
      moduleSupport: 0,
      kindRank: 0,
      scopeSpecificity: trace.scope_match,
      introRank: 0,
    };
  }
  const chunk = chunksByVersionId?.get(trace.version_id);
  const isDirectContributor =
    signals.directContributorChunkIds.has(trace.version_id) && trace.final_score >= signals.highScoreFloor;
  const isFallbackContributor = signals.fallbackContributorChunkIds.has(trace.version_id);
  return {
    directContributor: isDirectContributor || isFallbackContributor ? 1 : 0,
    fileAnchorOrder:
      signals.fileOnlyMultiScope && chunk?.scope.project && chunk.scope.module
        ? (signals.fileAnchorOrderByKey.get(`${chunk.scope.project}::${chunk.scope.module}`) ??
            Number.POSITIVE_INFINITY)
        : Number.POSITIVE_INFINITY,
    moduleSupport:
      chunk?.scope.project &&
      chunk.scope.module &&
      (trace.final_score >= signals.highScoreFloor || isFallbackContributor)
        ? (signals.moduleSupportByKey.get(`${chunk.scope.project}::${chunk.scope.module}`) ?? 0)
        : 0,
    kindRank: 1,
    scopeSpecificity: trace.scope_match,
    introRank: chunkIntroRank(chunk),
  };
}

function chunkIntroRank(chunk: DocChunk | undefined): number {
  if (!chunk) return 0;
  const headingDepth = Math.max(0, chunk.heading_path.length - 1);
  return Math.max(0, 10 - headingDepth);
}

// ---------------------------------------------------------------------------
// Atoms — structured, not pre-formatted
// ---------------------------------------------------------------------------

export type FreshnessSummary = {
  state: FreshnessState;
  reason: FreshnessReason;
  author_review_state: AuthorReviewState;
  /** True when the state is anything other than `verified` — a presentation
   *  hint that projections may render as a warning. Format is per-projection. */
  isWarning: boolean;
};

export function freshnessSummary(card: Card): FreshnessSummary {
  return {
    state: card.freshness_state,
    reason: card.freshness_reason,
    author_review_state: card.author_review_state,
    isWarning: card.freshness_state !== "verified",
  };
}

// ---------------------------------------------------------------------------
// Locked / ranked / omitted entries
// ---------------------------------------------------------------------------

export type PresentedLockedEntry = {
  /** Original locked entry from the pack (token_count, lock_reason). */
  entry: LockedEntry;
  /** Resolved Card; never undefined — the pipeline only locks Cards it knows about. */
  card: Card;
  /** Same as `entry.lock_reason`, surfaced for projection convenience. */
  reason: LockReason;
  freshness: FreshnessSummary;
};

export type PresentedRankedChunk = {
  kind: "doc_chunk";
  trace: DocChunkPackedTrace;
  chunk: DocChunk;
};

export type PresentedRankedCode = {
  kind: "code";
  trace: CodePackedTrace;
  code: StoredCodeChunk;
};

export type PresentedRankedCard = {
  kind: "card";
  trace: CardPackedTrace;
  card: Card;
  freshness: FreshnessSummary;
};

export type PresentedRankedEntry =
  | PresentedRankedChunk
  | PresentedRankedCard
  | PresentedRankedCode;

export type PresentedOmittedChunk = {
  kind: "doc_chunk";
  trace: OmittedTrace;
  /** May be `undefined` if the chunk reference is stale (e.g., tombstoned). */
  chunk: DocChunk | undefined;
};

export type PresentedOmittedCard = {
  kind: "card";
  trace: OmittedTrace;
  card: Card | undefined;
};

export type PresentedOmittedCode = {
  kind: "code";
  trace: OmittedTrace;
  code: StoredCodeChunk | undefined;
};

export type PresentedOmittedEntry =
  | PresentedOmittedChunk
  | PresentedOmittedCard
  | PresentedOmittedCode;

// ---------------------------------------------------------------------------
// Warnings — generated + passed through
// ---------------------------------------------------------------------------

export const WIRE_WARNING_KINDS = new Set<string>([
  "no_matches",
  "no_sources",
  "locked_overflow",
  "anchors_unrecognized",
  "low_confidence",
  // PRD-0035 / slice 35.2 — pre-retrieve freshness check.
  "stale_source",
  "missing_source",
  "weak_extraction",
  "needs_ocr",
]);

export type PresentedWarning = {
  kind: string;
  message: string;
  hint?: string;
};

// ---------------------------------------------------------------------------
// PackPresentation
// ---------------------------------------------------------------------------

export type PackPresentation = {
  query: string;
  query_mode: QueryMode;
  budget: PackResult["budget"];
  /** Locked in original pack order. Projections may regroup by card_type. */
  locked: PresentedLockedEntry[];
  /** Display-ordered relevant entries (non-evidence cards + chunks). */
  relevant: PresentedRankedEntry[];
  /** Display-ordered evidence cards from the global ranker. */
  evidence: PresentedRankedCard[];
  omitted: PresentedOmittedEntry[];
  /** Generated warnings (no_matches, no_sources, low_confidence, anchors_unrecognized)
   *  union pack-level warnings (locked_overflow, freshness, tombstoned_link).
   *  Projections filter to their own vocabulary. */
  warnings: PresentedWarning[];
  query_compilation: QueryCompilation;
  lock_failures: LockFailure[];
  safety_net_engaged: boolean;
  /** Total tokens / budget metadata pass-through. */
  total_tokens: number;
  budget_tokens: number;
};

export type ResolvePackPresentationArgs = {
  query: string;
  pack: PackResult;
  chunksByVersionId: Map<string, DocChunk>;
  codeByVersionId?: Map<string, StoredCodeChunk>;
  cardsByCardId: Map<string, Card>;
  query_mode: QueryMode;
  query_compilation: QueryCompilation;
  lock_failures: LockFailure[];
  has_sources: boolean;
  /** When set, used to detect a fallback safety-net engagement that pack-level
   *  flags didn't catch (every included entry below the wire `min_final_score`). */
  min_final_score?: number;
};

const LOW_CONFIDENCE_MAX_SCORE = 0.9;

export function resolvePackPresentation(args: ResolvePackPresentationArgs): PackPresentation {
  const {
    query,
    pack,
    chunksByVersionId,
    codeByVersionId,
    cardsByCardId,
    query_mode,
    query_compilation,
    lock_failures,
  } = args;

  const fallbackSafetyNet =
    args.min_final_score === undefined
      ? false
      : pack.included.length > 0 &&
        pack.omitted.length === 0 &&
        pack.included.every((t) => t.final_score < args.min_final_score!);
  const safetyNetEngaged = pack.safety_net_engaged || fallbackSafetyNet;

  const locked: PresentedLockedEntry[] = pack.locked.map((entry) => {
    const card = cardsByCardId.get(entry.card_id);
    if (!card) {
      throw new Error(
        `PackPresentation: locked entry ${entry.card_id} has no resolved Card — ` +
          "card lookups should be populated for every locked entry by the retrieval pipeline.",
      );
    }
    return {
      entry,
      card,
      reason: entry.lock_reason,
      freshness: freshnessSummary(card),
    };
  });

  const orderedIncluded = orderIncludedForRender(
    pack.included,
    chunksByVersionId,
    codeByVersionId,
    cardsByCardId,
    {
      diversifyAcrossSources: shouldDiversifyDisplayOrder(query_mode, query_compilation),
      query_text: query,
      query_mode,
      query_compilation,
    },
  );

  const relevant: PresentedRankedEntry[] = (safetyNetEngaged ? [] : orderedIncluded.relevant)
    .map((trace): PresentedRankedEntry | undefined => {
      if (trace.kind === "card") {
        const card = cardsByCardId.get(trace.card_id);
        if (!card) return undefined;
        return { kind: "card", trace, card, freshness: freshnessSummary(card) };
      }
      if (trace.kind === "code") {
        const code = codeByVersionId?.get(trace.version_id);
        if (!code) return undefined;
        return { kind: "code", trace, code };
      }
      const chunk = chunksByVersionId.get(trace.version_id);
      if (!chunk) return undefined;
      return { kind: "doc_chunk", trace, chunk };
    })
    .filter((entry): entry is PresentedRankedEntry => entry !== undefined);

  const evidence: PresentedRankedCard[] = (safetyNetEngaged ? [] : orderedIncluded.evidence)
    .map((trace): PresentedRankedCard | undefined => {
      const card = cardsByCardId.get(trace.card_id);
      if (!card) return undefined;
      return { kind: "card", trace, card, freshness: freshnessSummary(card) };
    })
    .filter((entry): entry is PresentedRankedCard => entry !== undefined);

  const omittedSource: OmittedTrace[] = safetyNetEngaged
    ? pack.included.map((t) => ({
        ...t,
        reason: "below_threshold (safety-net)",
        omitted_reason: "below_threshold" as const,
      }))
    : pack.omitted;

  const omitted: PresentedOmittedEntry[] = omittedSource.map((trace) => {
    if (trace.kind === "card") {
      return { kind: "card", trace, card: cardsByCardId.get(trace.card_id) };
    }
    if (trace.kind === "code") {
      return { kind: "code", trace, code: codeByVersionId?.get(trace.version_id) };
    }
    return { kind: "doc_chunk", trace, chunk: chunksByVersionId.get(trace.version_id) };
  });

  const warnings: PresentedWarning[] = [];
  let lowConfidenceWarned = false;

  if (query_mode === "signal_empty") {
    warnings.push({
      kind: "anchors_unrecognized",
      message: "Files/symbols/routes were provided but produced no inferred scope.",
      hint: "Author cards or chunks anchored to these paths/symbols, or query a path/symbol already present in the corpus.",
    });
  }

  // Wire `ranked` is `relevant` + `evidence`; safety-net forces it to empty,
  // and that's what triggers the `no_matches` path.
  const wireRankedCount = relevant.length + evidence.length;
  if (!args.has_sources) {
    warnings.push({
      kind: "no_sources",
      message: "no imported doc sources found in this repo",
      hint: "run `contexttrail import docs <glob>` to populate the cache",
    });
  } else if (wireRankedCount === 0) {
    warnings.push({
      kind: "no_matches",
      message:
        locked.length > 0
          ? "locked Cards returned, but no Doc Chunks or non-locked Cards cleared threshold"
          : "no chunks or locked Cards matched this task within the budget",
      hint: "try a broader budget (--budget large), different `files`/`symbols`, or rephrasing the task",
    });
  } else if (query_mode === "unanchored") {
    let maxScore = -Infinity;
    for (const r of [...relevant, ...evidence]) {
      if (r.trace.final_score > maxScore) maxScore = r.trace.final_score;
    }
    if (maxScore < LOW_CONFIDENCE_MAX_SCORE) {
      warnings.push({
        kind: "low_confidence",
        message: `ranked matches are weak (top score ${roundScore(maxScore)})`,
        hint: "provide files/symbols/routes or rephrase with more specific domain terms",
      });
      lowConfidenceWarned = true;
    }
  }

  const topCode = [...relevant, ...evidence].find(
    (entry): entry is PresentedRankedCode => entry.kind === "code",
  );
  if (
    !lowConfidenceWarned &&
    topCode?.trace.retrieval_confidence?.retry_recommended
  ) {
    const confidence = topCode.trace.retrieval_confidence;
    warnings.push({
      kind: "low_confidence",
      message:
        `top code match confidence is ${confidence.level} (${roundScore(confidence.score)})`,
      hint: "retry with a more specific file, symbol, package, or implementation term",
    });
  }

  for (const w of pack.warnings) {
    warnings.push({ kind: w.kind, message: w.message });
  }

  return {
    query,
    query_mode,
    budget: pack.budget,
    locked,
    relevant,
    evidence,
    omitted,
    warnings,
    query_compilation,
    lock_failures,
    safety_net_engaged: safetyNetEngaged,
    total_tokens: pack.total_tokens,
    budget_tokens: pack.budget_tokens,
  };
}

function roundScore(score: number): string {
  return score.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
