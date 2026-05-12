/**
 * Shared source-rerank orchestration for production retrieval and eval probes.
 *
 * V2.5 needs the same source-rank substrate everywhere: lexical source ranks
 * must be derived from score order, then fused with deterministic source
 * signals, then used by both production packing and Slice 0 diagnostics.
 */
import type { Db } from "../store/db.js";
import type { DocChunk } from "../types/chunk.js";
import type { QueryAnchors, ScoreTrace } from "./score.js";
import type { QueryCompilation, QueryMode } from "./query-scope.js";
import {
  buildFusedSourceCandidates,
} from "./fused-source-candidates.js";
import {
  classifyQueryIntent,
  rerankSourceCandidatesWithTrace,
  tokenizeForRerank,
  type QueryIntent,
  type RerankedSource,
} from "./source-rerank.js";
import { tokenize as tokenizeRetrievalText } from "./tokenize.js";
import type { CloseCallTiebreakerEntry } from "./source-rerank-tiebreakers.js";
import type { SourceCandidateChunk } from "./source-candidates.js";
import {
  verifySourceCoverage,
  type CoverageVerification,
} from "./coverage-verifier.js";
import {
  buildSourceCardsFromCandidates,
  type SourceCard,
  type SourceCardCoverageDecision,
} from "./source-card.js";
import {
  classifyTopNAboutness,
  type AboutnessObservation,
} from "./aboutness.js";
import {
  decideSourceSelection,
  type SourceSelectionDecision,
} from "./source-selection-decision.js";
import {
  applyCloseCallPairwiseRerank,
  type PairwiseRerankAblationLog,
} from "./pairwise-rerank.js";
import { buildAdjudicatorAdapter } from "./source-adjudicator.js";
import {
  getSourceProfile,
  listSourceProfiles,
} from "../store/source-profiles.js";
import { hasQueryAnchors } from "../query-anchors.js";

export type RankedScoreTrace = {
  trace: ScoreTrace;
  /** 1-indexed rank by score order, not storage/insertion order. */
  rank: number;
};

export type BuildSourceRerankPipelineArgs = {
  db: Db;
  chunks: DocChunk[];
  traces: ScoreTrace[];
  task: string;
  query_mode: QueryMode;
  query_anchors: QueryAnchors;
  query_compilation: QueryCompilation;
};

export type SourceRerankPipelineResult = {
  source_chunks: SourceCandidateChunk[];
  query_intent: QueryIntent;
  reranked: RerankedSource[];
  top_source_coverage?: CoverageVerification;
  /** PRD-0014 V3.2: top-N retrieval metadata for source comparison. */
  source_cards: SourceCard[];
  /** PRD-0014 V3.3: deterministic aboutness labels for source cards. */
  source_aboutness: AboutnessObservation[];
  /** PRD-0014 V3.4: selected source order consumed by packing/display. */
  source_selection: SourceSelectionDecision;
  /** True when the V3 decision is strong enough to override V2.5 source-rerank. */
  source_selection_applied: boolean;
  source_rank_by_version_id: Map<string, number>;
  source_selection_rank_by_version_id: Map<string, number>;
  /** PRD-0016 P16.6 / THO-164: ablation log of the live adjudicator
   *  pass. Empty when no close-call pair was evaluated. */
  adjudicator_ablation: PairwiseRerankAblationLog;
  /** PRD-0022 (THO-208 / THO-209): close-call tiebreaker explain trace.
   *  Empty when RETRIEVAL_RERANK_TIEBREAKERS=off (default in 22.1/22.2). */
  rerank_tiebreaker_trace: CloseCallTiebreakerEntry[];
};

const SOURCE_SELECTION_TOP_N = 50;
/** PRD-0016 P16.6 / THO-164: maximum (top1.score - top2.score) at
 *  which the adjudicator is consulted. The adapter itself is the
 *  primary safety gate (decisive lexical / role-specific evidence
 *  required) — this margin keeps the adapter focused on close pairs
 *  but is loose enough to let it engage on the top-3-hit/top-1-miss
 *  cohort PRD-0016 targets. */
const ADJUDICATOR_CLOSE_CALL_MARGIN = 0.5;
const APPLY_SOURCE_SELECTION_REASONS = new Set([
  "parent_over_leaf",
  "decision_over_procedural",
  "anchored_over_broad",
  "changelog_release_intent_preserved",
  "pairwise_rerank_promoted",
  // V4.2: profile-independent exact-title-match primitive. Resilient to the
  // real-fixture failure mode where doc_purpose classification is wrong or
  // missing for the canonical owner doc.
  "title_exact_match_promoted",
  // V5.1: concept-over-leaves promotion that doesn't depend on path nesting.
  // Closes parent_vs_leaf-under-path-noise and overview_vs_reference leaks.
  "concept_over_leaves_by_purpose_promoted",
  // V5.3: example-purpose promotion. Surfaces canonical examples alongside
  // the concept doc for broad_domain queries — closes the set-cover leak.
  "example_for_broad_domain_promoted",
]);

export function rankScoreTracesForSourceCandidates(
  traces: ScoreTrace[],
): RankedScoreTrace[] {
  return [...traces]
    .sort((a, b) => {
      if (b.final_score !== a.final_score) return b.final_score - a.final_score;
      if (b.packing_score !== a.packing_score) return b.packing_score - a.packing_score;
      return a.version_id.localeCompare(b.version_id);
    })
    .map((trace, idx) => ({ trace, rank: idx + 1 }));
}

export function buildSourceRerankPipeline(
  args: BuildSourceRerankPipelineArgs,
): SourceRerankPipelineResult {
  const chunksByVersionId = new Map(args.chunks.map((c) => [c.version_id, c]));
  const source_chunks: SourceCandidateChunk[] = rankScoreTracesForSourceCandidates(
    args.traces,
  ).map(({ trace, rank }) => {
    const chunk = chunksByVersionId.get(trace.version_id);
    return {
      rank,
      version_id: trace.version_id,
      source_path: chunk?.source_path ?? null,
      final_score: trace.final_score,
      kind: "doc_chunk" as const,
    };
  });

  const queryTokens = tokenizeForRerank(args.task);
  const queryRawTokens = tokenizeRetrievalText(args.task, { stem: false });
  const anchors = {
    files: args.query_anchors.files ?? [],
    symbols: args.query_anchors.symbols ?? [],
    routes: args.query_anchors.routes ?? [],
  };
  const enrichedSources = buildFusedSourceCandidates({
    lexical_chunks: source_chunks,
    profiles: listSourceProfiles(args.db),
    query_tokens: queryTokens,
    anchors,
    profileBySource: (path) => getSourceProfile(args.db, path),
  });
  const query_intent = classifyQueryIntent({
    task: args.task,
    query_mode: args.query_mode,
    has_anchors: hasQueryAnchors(anchors),
  });
  const rerankResult = rerankSourceCandidatesWithTrace({
    candidates: enrichedSources,
    query_tokens: queryTokens,
    query_raw_tokens: queryRawTokens,
    intent: query_intent,
    query_anchors: anchors,
  });
  const reranked = rerankResult.reranked;
  const tiebreaker_trace = rerankResult.tiebreaker_trace;

  const sourceRankByPath = new Map<string, number>();
  for (const r of reranked) {
    sourceRankByPath.set(r.candidate.source_path, r.rank);
  }
  const source_rank_by_version_id = new Map<string, number>();
  for (const chunk of args.chunks) {
    const rank = sourceRankByPath.get(chunk.source_path);
    if (rank !== undefined) {
      source_rank_by_version_id.set(chunk.version_id, rank);
    }
  }

  const top = reranked[0];
  const top_source_coverage = top
    ? verifySourceCoverage({
        intent: query_intent,
        query_tokens: queryTokens,
        candidate: top.candidate,
        path_agreement: top.candidate.fused_path_count ?? 1,
        top_chunk_score: top.candidate.best_chunk_score,
        required_anchors: anchors,
      })
    : undefined;

  const coverage_by_source = new Map<string, SourceCardCoverageDecision>();
  if (top && top_source_coverage) {
    coverage_by_source.set(
      top.candidate.source_path,
      toSourceCardCoverageDecision(top_source_coverage),
    );
  }
  const source_cards = buildSourceCardsFromCandidates({
    candidates: reranked.slice(0, SOURCE_SELECTION_TOP_N).map((r) => ({
      ...r.candidate,
      rank: r.rank,
    })),
    query_tokens: queryTokens,
    query_intent,
    top_n: SOURCE_SELECTION_TOP_N,
    coverage_by_source,
    task: args.task,
    anchor_symbols: args.query_anchors.symbols ?? [],
  });
  const source_aboutness = classifyTopNAboutness({
    cards: source_cards,
    query_intent,
  });
  const initial_selection = decideSourceSelection({
    cards: source_cards,
    aboutness: source_aboutness,
    query_intent,
    trusted_file_anchor_evidence: hasTrustedFileAnchorEvidence(args.query_compilation),
  });

  // PRD-0016 P16.6 / THO-164: live deterministic pairwise adjudication
  // on close-call top-1 vs top-2. The adapter is conservative — only
  // swaps when the adjudicator's |margin| ≥ 2 and confidence ≥ medium,
  // and the V3 selection's top1/top2 score gap is below the close-call
  // threshold. The pre-existing applyCloseCallPairwiseRerank guards
  // (fail_closed, can't promote unsupported, ablation logging) all
  // apply.
  const adjudicated = applyCloseCallPairwiseRerank({
    decision: initial_selection,
    cards: source_cards,
    adapter: buildAdjudicatorAdapter(query_intent),
    close_call_margin: ADJUDICATOR_CLOSE_CALL_MARGIN,
  });
  const source_selection = adjudicated.decision;
  const adjudicator_ablation = adjudicated.ablation_log;
  if (process.env.CONTEXTTRAIL_DEBUG_ADJUDICATOR && adjudicator_ablation.invocations > 0) {
    process.stderr.write(`[ADJ] task='${args.task}' intent=${query_intent}\n`);
    for (const e of adjudicator_ablation.entries) {
      process.stderr.write(
        `     ${e.pair[0]} | ${e.pair[1]} preferred=${e.preferred} swap=${e.swap_applied} reasons=${e.reasons.join(",")}\n`,
      );
    }
  }

  const source_selection_applied = shouldApplySourceSelection(source_selection);
  const selectedSourceRankByPath = new Map<string, number>();
  if (source_selection_applied) {
    source_selection.selected_sources.forEach((source, index) => {
      selectedSourceRankByPath.set(source.source_path, index + 1);
    });
  }
  const source_selection_rank_by_version_id = new Map<string, number>();
  for (const chunk of args.chunks) {
    const rank = selectedSourceRankByPath.get(chunk.source_path);
    if (rank !== undefined) {
      source_selection_rank_by_version_id.set(chunk.version_id, rank);
    }
  }

  return {
    source_chunks,
    query_intent,
    reranked,
    top_source_coverage,
    source_cards,
    source_aboutness,
    source_selection,
    source_selection_applied,
    adjudicator_ablation,
    rerank_tiebreaker_trace: tiebreaker_trace,
    source_rank_by_version_id,
    source_selection_rank_by_version_id,
  };
}

export function shouldApplySourceSelection(
  decision: SourceSelectionDecision,
): boolean {
  if (decision.fail_closed) return false;
  const top = decision.selected_sources[0];
  if (!top) return false;
  return top.reason_codes.some((reason) =>
    APPLY_SOURCE_SELECTION_REASONS.has(reason),
  );
}

export function hasTrustedFileAnchorEvidence(
  compilation: QueryCompilation,
): boolean {
  return compilation.anchors.some(
    (anchor) =>
      anchor.anchor.kind === "file" &&
      anchor.recognition !== "none" &&
      anchor.contributing_anchors.some(
        (contributor) =>
          contributor.confidence === "high" || contributor.confidence === "medium",
      ),
  );
}

function toSourceCardCoverageDecision(
  verification: CoverageVerification,
): SourceCardCoverageDecision {
  return {
    verdict: verification.decision === "covers" ? "supported" : verification.decision,
    signals: verification.reasons,
  };
}
