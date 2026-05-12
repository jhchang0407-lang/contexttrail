/**
 * Slice 0 (PRD-0010 / THO-114) — post-hoc source oracle and post-scoring loss
 * diagnostics. Eval-only.
 *
 * The "oracle" here is a hypothetical reranker that, if any critical source is
 * present in the top-N candidate set, can promote it to rank 1. It estimates
 * the maximum value of source-level reranking without changing candidate
 * generation. It does not introduce a real reranker, change the wire
 * contract, or mutate retrieval state.
 */
import type { Slice0SourceCandidate, RecallCount } from "./sources.js";
import type { Slice0ChunkCandidate } from "./candidates.js";

export type OracleFailureReason =
  | "expected_source_absent"
  | "critical_source_absent";

export type Slice0OracleMetrics = {
  /** True when expected_top_source is present in the top-50 candidate set,
   *  i.e., a perfect source-level reranker COULD have made it top-1. */
  oracle_source_top1_at_50: boolean | null;
  /** True when every critical source is present in the top-50 candidate set. */
  oracle_all_critical_sources_at_50: boolean | null;
  /** True when both expected and all critical sources are reachable by oracle. */
  oracle_answerable_success_at_50: boolean | null;
  /** Why the oracle could not satisfy the case (null on success or non-critical). */
  oracle_failure_reason: OracleFailureReason | null;
  /** True when the actual ranking already places an acceptable source at rank 1. */
  actual_top_source_acceptable: boolean | null;
};

export type OracleInput = {
  sources: Slice0SourceCandidate[];
  expected_top_source: string;
  acceptable_top_sources: string[];
  must_include_sources: string[];
  is_critical: boolean;
};

const ORACLE_K = 50;

export function computeOracleMetrics(input: OracleInput): Slice0OracleMetrics {
  if (!input.is_critical) {
    return {
      oracle_source_top1_at_50: null,
      oracle_all_critical_sources_at_50: null,
      oracle_answerable_success_at_50: null,
      oracle_failure_reason: null,
      actual_top_source_acceptable: null,
    };
  }

  const rankByPath = new Map(input.sources.map((s) => [s.source_path, s.rank]));
  const inTop50 = (path: string): boolean => {
    const r = rankByPath.get(path);
    return r !== undefined && r <= ORACLE_K;
  };

  const expectedReachable = inTop50(input.expected_top_source);
  const allCritical =
    input.must_include_sources.length > 0 &&
    input.must_include_sources.every(inTop50);

  const answerable_success = expectedReachable && allCritical;

  let failure: OracleFailureReason | null = null;
  if (!expectedReachable) failure = "expected_source_absent";
  else if (!allCritical) failure = "critical_source_absent";

  const actualTopRanked = input.sources[0]?.source_path ?? "";
  const actual_top_source_acceptable = input.acceptable_top_sources.includes(actualTopRanked);

  return {
    oracle_source_top1_at_50: expectedReachable,
    oracle_all_critical_sources_at_50: allCritical,
    oracle_answerable_success_at_50: answerable_success,
    oracle_failure_reason: failure,
    actual_top_source_acceptable,
  };
}

export type Slice0LossDiagnostics = {
  /** Source-set recall after the production min_final_score thresholding. */
  post_threshold_critical_recall_at_50: RecallCount | null;
  /** Source-set recall after the production budget packer. */
  post_pack_critical_recall_at_50: RecallCount | null;
  /** Critical sources whose ONLY contributing chunks fell below threshold. */
  source_to_threshold_loss: string[] | null;
  /** Critical sources that survived threshold but were lost in budget packing. */
  threshold_to_pack_loss: string[] | null;
  /** Sources that were budget-dropped (above threshold but didn't fit). */
  budget_loss_sources: string[] | null;
};

export type LossInput = {
  sources: Slice0SourceCandidate[];
  candidates: Slice0ChunkCandidate[];
  included_version_ids: string[];
  below_threshold_version_ids: string[];
  budget_dropped_version_ids: string[];
  must_include_sources: string[];
  is_critical: boolean;
};

export function computeLossDiagnostics(input: LossInput): Slice0LossDiagnostics {
  if (!input.is_critical) {
    return {
      post_threshold_critical_recall_at_50: null,
      post_pack_critical_recall_at_50: null,
      source_to_threshold_loss: null,
      threshold_to_pack_loss: null,
      budget_loss_sources: null,
    };
  }

  const includedSet = new Set(input.included_version_ids);
  const belowThresholdSet = new Set(input.below_threshold_version_ids);
  const budgetDroppedSet = new Set(input.budget_dropped_version_ids);

  // For each candidate chunk, group by its source_path so we know which
  // chunks belong to which source after each pipeline stage.
  const chunksBySource = new Map<string, Slice0ChunkCandidate[]>();
  for (const c of input.candidates) {
    if (!c.source_path) continue;
    const arr = chunksBySource.get(c.source_path) ?? [];
    arr.push(c);
    chunksBySource.set(c.source_path, arr);
  }

  // post_threshold sources = sources with at least one chunk above threshold.
  // (chunks below threshold have version_id in below_threshold_version_ids;
  // anything not in that set passed the threshold.)
  const sourceHasAboveThresholdChunk = new Set<string>();
  for (const [src, chunks] of chunksBySource.entries()) {
    if (chunks.some((c) => !belowThresholdSet.has(c.version_id))) {
      sourceHasAboveThresholdChunk.add(src);
    }
  }
  // post_pack sources = sources with at least one chunk that was actually
  // packed (passed both threshold AND budget).
  const sourceHasIncludedChunk = new Set<string>();
  for (const [src, chunks] of chunksBySource.entries()) {
    if (chunks.some((c) => includedSet.has(c.version_id))) {
      sourceHasIncludedChunk.add(src);
    }
  }
  // budget-dropped sources = sources whose ONLY surviving chunks were
  // dropped at the budget packer.
  const sourceOnlyBudgetDropped = new Set<string>();
  for (const [src, chunks] of chunksBySource.entries()) {
    const survivors = chunks.filter((c) => !belowThresholdSet.has(c.version_id));
    if (survivors.length === 0) continue;
    if (survivors.every((c) => budgetDroppedSet.has(c.version_id))) {
      sourceOnlyBudgetDropped.add(src);
    }
  }

  const post_threshold = (paths: string[]): RecallCount => ({
    found: paths.filter((p) => sourceHasAboveThresholdChunk.has(p)).length,
    total: paths.length,
  });
  const post_pack = (paths: string[]): RecallCount => ({
    found: paths.filter((p) => sourceHasIncludedChunk.has(p)).length,
    total: paths.length,
  });

  const required = input.must_include_sources;

  // source-to-threshold loss: critical sources present in candidates but
  // whose surviving (above-threshold) chunks are zero.
  const source_to_threshold_loss = required.filter((p) => {
    const chunks = chunksBySource.get(p);
    if (!chunks || chunks.length === 0) return false; // absent entirely, not a threshold loss
    return chunks.every((c) => belowThresholdSet.has(c.version_id));
  });

  // threshold-to-pack loss: critical sources that had above-threshold
  // chunks but none of them made it into the pack.
  const threshold_to_pack_loss = required.filter(
    (p) => sourceHasAboveThresholdChunk.has(p) && !sourceHasIncludedChunk.has(p),
  );

  return {
    post_threshold_critical_recall_at_50: post_threshold(required),
    post_pack_critical_recall_at_50: post_pack(required),
    source_to_threshold_loss,
    threshold_to_pack_loss,
    budget_loss_sources: required.filter((p) => sourceOnlyBudgetDropped.has(p)),
  };
}
