/**
 * Slice 0 (PRD-0010 / THO-112) — pre-pack scored candidate diagnostics.
 *
 * Captures the full set of scored Doc Chunk candidates after retrieval
 * scoring runs and BEFORE `min_final_score` thresholding, budget packing,
 * and structural assembly. Eval/diagnostic-only. This file does not change
 * production retrieval behavior or any wire contract.
 */
import type { Db } from "../../store/db.js";
import type { ContextTrailConfig } from "../../config/defaults.js";
import {
  filterEligible,
  parseRequest,
  scoreCandidates,
  type RetrievalRequest,
} from "../../retrieve/retrieve.js";
import {
  compileQueryScopes,
} from "../../retrieve/query-scope.js";
import {
  packWithLocked,
  type CandidateTrace,
} from "../../retrieve/pack.js";
import {
  buildSourceRerankPipeline,
  rankScoreTracesForSourceCandidates,
} from "../../retrieve/source-rerank-pipeline.js";
import type { AboutnessObservation } from "../../retrieve/aboutness.js";
import {
  listCurrentChunksCanonical,
  lookupCodeAnchorContributorsCanonical,
} from "../../store/read-model.js";
import { listSourceProfiles } from "../../store/source-profiles.js";
import { makeSourceProfileAnchorLookup } from "../../retrieve/source-profile-anchor-lookup.js";
import type { SourceCard } from "../../retrieve/source-card.js";
import type { SourceSelectionDecision } from "../../retrieve/source-selection-decision.js";

export type Slice0ChunkCandidate = {
  rank: number;
  version_id: string;
  source_path: string;
  heading_path: string[];
  final_score: number;
  packing_score: number;
  bm25_norm: number;
  heading_match: number;
  scope_match: number;
  mention_overlap: number;
  specificity: number;
  text_score: number;
  token_count: number;
  doc_role?: string;
  role_source?: string;
};

export type Slice0Capture = {
  /** Full scored candidates ranked by final_score desc, no threshold/packing applied. */
  chunk_candidates: Slice0ChunkCandidate[];
  /** Configured min_final_score so callers can compute post-threshold loss. */
  threshold: number;
  /** Budget tokens that production packing would have used. */
  budget_tokens: number;
  /** version_ids of chunks that production packing would have included. */
  included_version_ids: string[];
  /** version_ids of chunks production would have dropped at threshold. */
  below_threshold_version_ids: string[];
  /** version_ids of chunks dropped by the budget packer (above threshold). */
  budget_dropped_version_ids: string[];
  /** Production V3 source cards captured for eval-only diagnostics. */
  source_cards: SourceCard[];
  /** Production V3 aboutness labels captured for eval-only diagnostics. */
  source_aboutness: AboutnessObservation[];
  /** Production V3 source-selection decision captured for eval-only diagnostics. */
  source_selection: SourceSelectionDecision;
  /** Whether production packing/display consumed the V3 source-selection order. */
  source_selection_applied: boolean;
};

export type CaptureSlice0Args = {
  db: Db;
  config: ContextTrailConfig;
  request: RetrievalRequest;
};

/**
 * Reuse the production retrieval stages up through scoring, but instead of
 * threading the result into pack/assembly we keep the raw scored candidates
 * AND mirror what the production packer would have done so the same JSON
 * artifact can compute post-threshold and post-pack loss diagnostics.
 *
 * Cards are intentionally excluded from the chunk-candidate list. Slice 0's
 * doc-source-recall metric is docs-only by PRD; locked Cards are evaluated
 * separately through locked-include gates, and non-locked Cards do not
 * satisfy doc source recall unless a fixture explicitly declares one.
 */
export function captureSlice0ChunkCandidates(args: CaptureSlice0Args): Slice0Capture {
  const { db, config, request } = args;
  const { weights, budget_tokens } = parseRequest(request, config);

  const allChunks = listCurrentChunksCanonical(db);
  const eligibleChunks = filterEligible(allChunks);
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

  const traces = scoreCandidates(
    db,
    eligibleChunks,
    request,
    query_scopes,
    query_compilation.query_mode,
    weights,
    config.retrieval.field_weights,
  );

  const chunkBySource = new Map(eligibleChunks.map((c) => [c.version_id, c]));

  const sorted = rankScoreTracesForSourceCandidates(traces);

  const chunk_candidates: Slice0ChunkCandidate[] = sorted.map(({ trace, rank }) => {
    const chunk = chunkBySource.get(trace.version_id);
    return {
      rank,
      version_id: trace.version_id,
      source_path: chunk?.source_path ?? "",
      heading_path: chunk?.heading_path ?? [],
      final_score: trace.final_score,
      packing_score: trace.packing_score,
      bm25_norm: trace.bm25_norm,
      heading_match: trace.heading_match,
      scope_match: trace.scope_match,
      mention_overlap: trace.mention_overlap,
      specificity: trace.specificity,
      text_score: trace.text_score,
      token_count: trace.token_count,
      doc_role: trace.doc_role,
      role_source: trace.role_source,
    };
  });

  // Mirror production packing on doc chunks only so we can attribute the
  // post-threshold and post-pack loss for Slice 0 reporting. This includes
  // the same source-rerank ranks production packing consumes; otherwise the
  // eval would classify pack/display losses against a stale ordering.
  const sourceRerank = buildSourceRerankPipeline({
    db,
    chunks: eligibleChunks,
    traces,
    task: request.task,
    query_mode: query_compilation.query_mode,
    query_anchors: request.query_anchors,
    query_compilation,
  });
  const candidates: CandidateTrace[] = traces.map((t) => ({
    ...t,
    kind: "doc_chunk" as const,
    source_rerank_rank: sourceRerank.source_rank_by_version_id.get(t.version_id),
    source_selection_rank:
      sourceRerank.source_selection_rank_by_version_id.get(t.version_id),
  }));
  const mirrored = packWithLocked({
    locked: [],
    candidates,
    budget_tokens,
    min_final_score: config.retrieval.min_final_score,
  });
  const includedSet = new Set(mirrored.included.map((t) => t.version_id));
  const belowThresholdSet = new Set(
    mirrored.omitted
      .filter((t) => t.omitted_reason === "below_threshold")
      .map((t) => t.version_id),
  );
  const budgetDroppedSet = new Set(
    mirrored.omitted
      .filter((t) => t.omitted_reason === "budget")
      .map((t) => t.version_id),
  );

  return {
    chunk_candidates,
    threshold: config.retrieval.min_final_score,
    budget_tokens,
    included_version_ids: [...includedSet],
    below_threshold_version_ids: [...belowThresholdSet],
    budget_dropped_version_ids: [...budgetDroppedSet],
    source_cards: sourceRerank.source_cards,
    source_aboutness: sourceRerank.source_aboutness,
    source_selection: sourceRerank.source_selection,
    source_selection_applied: sourceRerank.source_selection_applied,
  };
}
