import type { Db } from "../store/db.js";
import type { ContextTrailConfig } from "../config/defaults.js";
import {
  getAnchorsForChunkCanonical,
  lookupCodeAnchorContributorsCanonical,
  listCardsCanonical,
  listCurrentChunksCanonical,
} from "../store/read-model.js";
import { listSourceProfiles } from "../store/source-profiles.js";
import { bm25Norm, bm25NormCards, type FieldWeights } from "./bm25.js";
import {
  scoreChunk,
  scoreCard,
  type ScoreTrace,
  type ScoringWeights,
} from "./score.js";
import {
  packWithLocked,
  type PackResult,
  type LockedEntry,
  type CandidateTrace,
} from "./pack.js";
import { decideQueryModeHonesty } from "./query-mode-honesty.js";
import {
  resolveLockedInclude,
  type LockConsideration,
  type LockFailure,
} from "../cards/locked-include.js";
import type { DocChunk } from "../types/chunk.js";
import type { Card } from "../types/card.js";
import type { QueryScope } from "./scope-match.js";
import type { QueryAnchors } from "./score.js";
import {
  compileQueryScopes,
  type QueryCompilation,
  type QueryMode,
} from "./query-scope.js";
import {
  applyStructuralAssembly,
  type StructuralAssemblyMetadata,
} from "./assembly.js";
import type { QueryIntent, RerankedSource } from "./source-rerank.js";
import type { CoverageVerification } from "./coverage-verifier.js";
import { buildSourceRerankPipeline } from "./source-rerank-pipeline.js";
import type { SourceCard } from "./source-card.js";
import type { AboutnessObservation } from "./aboutness.js";
import type { SourceSelectionDecision } from "./source-selection-decision.js";
import type { PairwiseRerankAblationLog } from "./pairwise-rerank.js";
import { makeSourceProfileAnchorLookup } from "./source-profile-anchor-lookup.js";
import {
  selectSourceScopedChunks,
  type ChunkSelectionReason,
  type SourceChunkCandidate,
} from "../readiness/chunk-selector.js";
import { extractTaskNeeds, type TaskNeed } from "../readiness/task-need.js";

/**
 * The retrieval pipeline:
 *   query parse → eligibility filter → score → pack → render.
 *
 * Cards extend the pipeline: locked-include resolution runs before the
 * global ranker; non-locked Cards compete in the same ranker as Doc
 * Chunks under a 1.2× type-bias.
 */
export type RetrievalRequest = {
  task: string;
  query_anchors: QueryAnchors;
  budget: "small" | "default" | "large";
  expected_locked?: string[];
  /** When true, callers will display the per-chunk score trace. The pipeline
   *  always returns traces; this flag is informational. */
  explain?: boolean;
};

export type RetrievalResult = {
  request: RetrievalRequest;
  pack: PackResult;
  /** Lookup tables for the renderer. */
  chunksByVersionId: Map<string, DocChunk>;
  cardsByCardId: Map<string, Card>;
  query_scopes: QueryScope[];
  query_mode: QueryMode;
  query_compilation: QueryCompilation;
  lock_failures: LockFailure[];
  candidate_count: number;
  eligible_count: number;
  assembly?: StructuralAssemblyMetadata;
  /** Deterministic source rerank diagnostics. */
  source_rerank?: RerankedSource[];
  /** Deterministic task intent used by source rerank. */
  query_intent?: QueryIntent;
  /**
   * V2.5.5: coverage verification of the top reranked source. Consumed
   * by the shared confidence policy to fail closed on partial /
   * unsupported / needs_anchors coverage.
   */
  top_source_coverage?: CoverageVerification;
  /** V3.2: source-card diagnostics for top-N candidates. */
  source_cards?: SourceCard[];
  /** V3.3: deterministic aboutness labels for source cards. */
  source_aboutness?: AboutnessObservation[];
  /** V3.4: selected source order that feeds pack/display. */
  source_selection?: SourceSelectionDecision;
  /** True when V3 source selection overrode V2.5 source-rerank ordering. */
  source_selection_applied?: boolean;
  /** Ablation log of the live pairwise adjudicator pass. Empty when no
   *  close-call pair was evaluated. */
  adjudicator_ablation?: PairwiseRerankAblationLog;
};

export function parseRequest(
  request: RetrievalRequest,
  config: ContextTrailConfig,
): { weights: ScoringWeights; budget_tokens: number } {
  const weights: ScoringWeights = {
    w_bm25: config.retrieval.scoring.w_bm25,
    w_heading: config.retrieval.scoring.w_heading,
    w_scope: config.retrieval.scoring.w_scope,
    w_mentions: config.retrieval.scoring.w_mentions,
    card_type_bias: config.retrieval.scoring.card_type_bias,
    specificity_weight: config.retrieval.scoring.specificity_weight,
  };
  const budget_tokens = config.retrieval.budgets[request.budget];
  return { weights, budget_tokens };
}

export function filterEligible(chunks: DocChunk[]): DocChunk[] {
  return chunks.filter((c) => c.status === "current");
}

export function scoreCandidates(
  db: Db,
  chunks: DocChunk[],
  request: RetrievalRequest,
  query_scopes: QueryScope[],
  query_mode: QueryMode,
  weights: ScoringWeights,
  fieldWeights?: FieldWeights,
): ScoreTrace[] {
  const bm25 = bm25Norm(db, request.task, fieldWeights);
  return chunks.map((c) =>
    scoreChunk({
      chunk: c,
      anchors: getAnchorsForChunkCanonical(db, c.version_id),
      bm25_norm: bm25.get(c.version_id) ?? 0,
      query: request.task,
      query_scopes,
      query_anchors: request.query_anchors,
      query_mode,
      weights,
    }),
  );
}

export function retrieve(
  db: Db,
  request: RetrievalRequest,
  config: ContextTrailConfig,
): RetrievalResult {
  const { weights, budget_tokens } = parseRequest(request, config);

  // Stage 2 — eligibility.
  const allChunks = listCurrentChunksCanonical(db);
  const eligibleChunks = filterEligible(allChunks);
  const rawCards = filterCardsForActiveProfile(listCardsCanonical(db), config);
  const allCards = rawCards.filter((c) => c.authority !== "deprecated");
  const sourceProfiles = listSourceProfiles(db);
  const { query_scopes, query_compilation } = compileQueryScopes({
    anchors: request.query_anchors,
    config,
    lookup: (anchor) => lookupCodeAnchorContributorsCanonical(db, anchor),
    source_lookup: makeSourceProfileAnchorLookup({
      profiles: sourceProfiles,
      chunks: eligibleChunks,
    }),
    task: request.task,
  });

  // Stage 3a — locked-include. Runs before the global ranker; locked
  // Cards bypass scoring entirely.
  const { locked: lockedCards, reasons: lockReasonList, considerationsByCardId } = resolveLockedInclude(
    rawCards,
    query_scopes,
    request.query_anchors,
  );
  const lockedSet = new Set(lockedCards.map((c) => c.id));

  // Stage 3b — score Doc Chunks via the existing hybrid formula.
  const chunkTraces = scoreCandidates(
    db,
    eligibleChunks,
    request,
    query_scopes,
    query_compilation.query_mode,
    weights,
    config.retrieval.field_weights,
  );

  // Stage 3c — score non-locked Cards. They compete in the global ranker
  // alongside chunks, with the 1.2× type-bias multiplier.
  const cardBm25 = bm25NormCards(db, request.task, config.retrieval.field_weights);
  const nonLockedCards = allCards.filter((c) => !lockedSet.has(c.id));
  const cardTraces: ScoreTrace[] = nonLockedCards.map((card) =>
    scoreCard({
      card,
      bm25_norm: cardBm25.get(card.id) ?? 0,
      query: request.task,
      query_scopes,
      query_anchors: request.query_anchors,
      query_mode: query_compilation.query_mode,
      weights,
    }),
  );

  // Stage 3d — deterministic source rerank. Aggregate chunk traces into
  // profile-enriched source candidates, classify query intent, and rerank
  // by an explainable feature vector. Source rerank only affects doc-chunk
  // ordering inside the pack; cards retain card_type_bias semantics and
  // locked Cards bypass scoring entirely.
  // Source rerank consumes fused candidates so independent path agreement
  // (alias, anchor, title, heading, question) lifts a source over a single
  // strong-but-narrow lexical hit. Final Context Packs still cite Doc
  // Chunks; fusion only re-orders sources that already have chunks.
  const sourceRerank = buildSourceRerankPipeline({
    db,
    chunks: eligibleChunks,
    traces: chunkTraces,
    task: request.task,
    query_mode: query_compilation.query_mode,
    query_anchors: request.query_anchors,
    query_compilation,
  });
  const sourceScopedChunkPriorities = buildSourceScopedChunkPriorities({
    task: request.task,
    query_mode: query_compilation.query_mode,
    query_intent: sourceRerank.query_intent,
    query_anchors: request.query_anchors,
    chunks: eligibleChunks,
    traces: chunkTraces,
    source_selection_applied: sourceRerank.source_selection_applied,
    source_selection: sourceRerank.source_selection,
    reranked_sources: sourceRerank.reranked.map((r) => ({
      source_path: r.candidate.source_path,
      rank: r.rank,
    })),
  });
  // Stage 4 — pack. Locked first; chunks + non-locked cards compete in the
  // remaining budget. Locked entries carry only the fields the pipeline reads
  // downstream (token_count for budget arithmetic, lock_reason for explain).
  const lockedTraces: LockedEntry[] = lockedCards.map((card) => {
    const reason = lockReasonList.find((r) => r.card_id === card.id);
    return {
      kind: "card",
      card_id: card.id,
      card_type: card.type,
      token_count: card.token_count,
      lock_reason: reason ?? { card_id: card.id, kind: "constraint_scope_match" },
    };
  });
  const candidates: CandidateTrace[] = [
    ...chunkTraces.map((t) => ({
      ...t,
      kind: "doc_chunk" as const,
      source_rerank_rank: sourceRerank.source_rank_by_version_id.get(t.version_id),
      source_selection_rank:
        sourceRerank.source_selection_rank_by_version_id.get(t.version_id),
      ...sourceScopedChunkPriorities.get(t.version_id),
    })),
    ...cardTraces.map((t) => {
      const card = nonLockedCards.find((c) => c.id === t.version_id)!;
      return {
        ...t,
        kind: "card" as const,
        card_id: card.id,
        card_type: card.type,
      };
    }),
  ];
  const packResult = packWithLocked({
    locked: lockedTraces,
    candidates,
    budget_tokens,
    min_final_score: config.retrieval.min_final_score,
  });

  const chunksByVersionId = new Map(eligibleChunks.map((c) => [c.version_id, c]));
  const cardsByCardId = new Map(allCards.map((c) => [c.id, c]));
  const chunkTracesByVersionId = new Map(chunkTraces.map((trace) => [trace.version_id, trace]));
  const cardTracesByCardId = new Map(
    nonLockedCards.map((card) => [
      card.id,
      cardTraces.find((trace) => trace.version_id === card.id)!,
    ]),
  );
  const chunkAnchorsByVersionId = new Map(
    eligibleChunks.map((chunk) => [chunk.version_id, getAnchorsForChunkCanonical(db, chunk.version_id)]),
  );
  const cardLinksByCardId = new Map(allCards.map((card) => [card.id, card.links]));
  const assemblyResult = applyStructuralAssembly({
    query: request.task,
    query_mode: query_compilation.query_mode,
    query_anchors: request.query_anchors,
    query_compilation,
    pack: packResult,
    chunksByVersionId,
    cardsByCardId,
    chunkTracesByVersionId,
    cardTracesByCardId,
    chunkAnchorsByVersionId,
    cardLinksByCardId,
  });
  const queryModeHonesty = decideQueryModeHonesty({
    initial_query_mode: query_compilation.query_mode,
    query_compilation,
    included_scores: assemblyResult.pack.included.map((entry) => entry.final_score),
    source_selection: sourceRerank.source_selection,
    source_aboutness: sourceRerank.source_aboutness,
  });
  const lock_failures = computeLockFailures({
    expected_locked: request.expected_locked ?? [],
    cards: rawCards,
    considerationsByCardId,
  });

  return {
    request,
    pack: assemblyResult.pack,
    chunksByVersionId,
    cardsByCardId,
    query_scopes,
    query_mode: queryModeHonesty.query_mode,
    query_compilation,
    lock_failures,
    candidate_count: allChunks.length + allCards.length,
    eligible_count: eligibleChunks.length + allCards.length,
    assembly: assemblyResult.metadata,
    source_rerank: sourceRerank.reranked,
    query_intent: sourceRerank.query_intent,
    top_source_coverage: sourceRerank.top_source_coverage,
    source_cards: sourceRerank.source_cards,
    source_aboutness: sourceRerank.source_aboutness,
    source_selection: sourceRerank.source_selection,
    source_selection_applied: sourceRerank.source_selection_applied,
    adjudicator_ablation: sourceRerank.adjudicator_ablation,
  };
}

function filterCardsForActiveProfile(cards: Card[], config: ContextTrailConfig): Card[] {
  if (!config.active_task_profile_id) return cards;
  const profile = config.task_profiles.find((item) => item.id === config.active_task_profile_id);
  if (!profile) return cards;
  const activeRuleIds = new Set(profile.rule_ids);
  return cards.filter((card) => card.type !== "constraint" || activeRuleIds.has(card.id));
}

type SourceScopedPriority = {
  source_scoped_selection_rank: number;
  source_scoped_selection_reason: ChunkSelectionReason;
};

function buildSourceScopedChunkPriorities(args: {
  task: string;
  query_mode: QueryMode;
  query_intent: QueryIntent;
  query_anchors: QueryAnchors;
  chunks: DocChunk[];
  traces: ScoreTrace[];
  source_selection_applied: boolean;
  source_selection: SourceSelectionDecision;
  reranked_sources: Array<{ source_path: string; rank: number }>;
}): Map<string, SourceScopedPriority> {
  const needs = extractTaskNeeds({
    task: args.task,
    query_mode: args.query_mode,
    query_intent: args.query_intent,
    files: args.query_anchors.files,
    symbols: args.query_anchors.symbols,
    routes: args.query_anchors.routes,
  });
  if (needs.length === 0) return new Map();

  const sourceRanks = activeSourceRanks(args);
  if (sourceRanks.size === 0) return new Map();

  const tracesByVersionId = new Map(args.traces.map((trace) => [trace.version_id, trace]));
  const candidates: SourceChunkCandidate[] = [];
  for (const chunk of args.chunks) {
    const trace = tracesByVersionId.get(chunk.version_id);
    if (!trace) continue;
    candidates.push({
      id: chunk.version_id,
      source_path: chunk.source_path,
      heading_path: chunk.heading_path,
      heading_level: Math.max(1, chunk.heading_path.length),
      chunk_index: chunk.chunk_index,
      chunk_count: chunk.chunk_count,
      score: trace.final_score,
      tokens: trace.token_count,
    });
  }

  const out = new Map<string, SourceScopedPriority>();
  for (const [sourcePath, sourceRank] of sourceRanks) {
    const selection = selectSourceScopedChunks({
      sourcePath,
      candidates,
      needs,
    });
    if (selection.selections.length === 0) continue;
    const reasonRank = reasonPriorityForNeeds(needs, args.task);
    const ordered = [...selection.selections].sort((a, b) => {
      const ar = reasonRank.get(a.reason) ?? 50;
      const br = reasonRank.get(b.reason) ?? 50;
      if (ar !== br) return ar - br;
      return a.chunkId.localeCompare(b.chunkId);
    });
    for (const [idx, selected] of ordered.entries()) {
      out.set(selected.chunkId, {
        // The source rank prefix keeps source order dominant. The pack
        // comparator already compares source ranks first, but making this
        // globally monotonic also keeps diagnostics stable.
        source_scoped_selection_rank: sourceRank * 100 + idx,
        source_scoped_selection_reason: selected.reason,
      });
    }
  }
  return out;
}

function activeSourceRanks(args: {
  source_selection_applied: boolean;
  source_selection: SourceSelectionDecision;
  reranked_sources: Array<{ source_path: string; rank: number }>;
}): Map<string, number> {
  const out = new Map<string, number>();
  if (args.source_selection_applied) {
    for (const [index, source] of args.source_selection.selected_sources.entries()) {
      out.set(source.source_path, index + 1);
    }
    return out;
  }
  for (const source of args.reranked_sources) out.set(source.source_path, source.rank);
  return out;
}

function reasonPriorityForNeeds(needs: TaskNeed[], task: string): Map<ChunkSelectionReason, number> {
  if (needs.includes("overview_orientation") && explicitOverviewShape(task)) {
    return new Map([
      ["intro", 0],
      ["primary", 1],
      ["parent", 2],
      ["sibling", 3],
      ["linked_neighbor", 4],
      ["exact_heading", 5],
    ]);
  }
  if (needs.includes("decision_rationale")) {
    if (explicitRationaleShape(task)) {
      return new Map([
        ["parent", 0],
        ["primary", 1],
        ["intro", 2],
        ["sibling", 3],
        ["linked_neighbor", 4],
        ["exact_heading", 5],
      ]);
    }
    return new Map([
      ["primary", 0],
      ["parent", 1],
      ["intro", 2],
      ["sibling", 3],
      ["linked_neighbor", 4],
      ["exact_heading", 5],
    ]);
  }
  return new Map([
    ["exact_heading", 0],
    ["primary", 1],
    ["sibling", 2],
    ["parent", 3],
    ["intro", 4],
    ["linked_neighbor", 5],
  ]);
}

const EXPLICIT_OVERVIEW_PATTERN = /\b(overview|introduction|intro|what is|what are|explain|how does)\b/i;
const EXPLICIT_RATIONALE_PATTERN = /\b(why|rationale|trade[- ]?off|problem|solve|how)\b/i;

function explicitOverviewShape(task: string): boolean {
  return EXPLICIT_OVERVIEW_PATTERN.test(task);
}

function explicitRationaleShape(task: string): boolean {
  return EXPLICIT_RATIONALE_PATTERN.test(task);
}

export function computeLockFailures(args: {
  expected_locked: string[];
  cards: Card[];
  considerationsByCardId: Map<string, LockConsideration>;
}): LockFailure[] {
  const failures: LockFailure[] = [];
  const cardsById = new Map(args.cards.map((card) => [card.id, card]));

  for (const cardId of args.expected_locked) {
    const consideration = args.considerationsByCardId.get(cardId);
    if (consideration?.matched) continue;
    if (consideration && !consideration.matched) {
      failures.push(consideration.failure);
      continue;
    }
    const card = cardsById.get(cardId);
    if (!card) {
      failures.push({
        card_id: cardId,
        card_type: "constraint",
        candidate_match_path: "card not found",
        failed_reason: "not_lockable_type",
        detail: "expected locked card id was not present in the cache",
      });
      continue;
    }
    failures.push({
      card_id: card.id,
      card_type: card.type,
      candidate_match_path: "not considered by locked-include",
      failed_reason: "not_lockable_type",
      detail: "expected card was present but locked-include produced no consideration outcome",
    });
  }

  return failures;
}
