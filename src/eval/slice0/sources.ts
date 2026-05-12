/**
 * Slice 0 (PRD-0010 / THO-113) — source-level aggregation and critical-source
 * recall metrics. Eval-only.
 *
 * Source recall is computed pre-pack: aggregation operates on the chunk
 * candidates produced by `captureSlice0ChunkCandidates`. Cards do not
 * contribute to source recall.
 */
import type { Slice0ChunkCandidate } from "./candidates.js";
import type { ExpectationKind } from "../types.js";
import type { RealCorpusEvalCase } from "../real-corpus-fixture.js";

export type Slice0SourceCandidate = {
  rank: number;
  source_path: string;
  best_chunk_rank: number;
  best_chunk_score: number;
  contributing_chunks: Array<{
    version_id: string;
    rank: number;
    final_score: number;
  }>;
};

export type RecallCount = { found: number; total: number };

export type Slice0SourceRecallMetrics = {
  /** rank of expected_top_source in deduped source candidates, or null if absent. */
  expected_source_rank: number | null;
  expected_source_recall_at_10: boolean;
  expected_source_recall_at_20: boolean;
  expected_source_recall_at_50: boolean;
  /** Critical-source-set recall — null when the case is not critical (unsupported, signal_empty, or no must_include_sources). */
  critical_source_recall_at_10: RecallCount | null;
  critical_source_recall_at_20: RecallCount | null;
  critical_source_recall_at_50: RecallCount | null;
  all_critical_sources_covered_at_10: boolean | null;
  all_critical_sources_covered_at_20: boolean | null;
  all_critical_sources_covered_at_50: boolean | null;
  /** Critical sources that were absent from the top-50 source candidates. */
  missing_critical_sources_at_10: string[] | null;
  missing_critical_sources_at_20: string[] | null;
  missing_critical_sources_at_50: string[] | null;
};

export function aggregateSourceCandidates(
  chunks: Slice0ChunkCandidate[],
): Slice0SourceCandidate[] {
  const bySource = new Map<string, Slice0SourceCandidate>();
  for (const c of chunks) {
    if (!c.source_path) continue;
    const existing = bySource.get(c.source_path);
    if (!existing) {
      bySource.set(c.source_path, {
        rank: 0,
        source_path: c.source_path,
        best_chunk_rank: c.rank,
        best_chunk_score: c.final_score,
        contributing_chunks: [
          { version_id: c.version_id, rank: c.rank, final_score: c.final_score },
        ],
      });
      continue;
    }
    existing.best_chunk_rank = Math.min(existing.best_chunk_rank, c.rank);
    existing.best_chunk_score = Math.max(existing.best_chunk_score, c.final_score);
    existing.contributing_chunks.push({
      version_id: c.version_id,
      rank: c.rank,
      final_score: c.final_score,
    });
  }
  const ordered = [...bySource.values()].sort((a, b) => {
    if (a.best_chunk_rank !== b.best_chunk_rank) {
      return a.best_chunk_rank - b.best_chunk_rank;
    }
    if (b.best_chunk_score !== a.best_chunk_score) {
      return b.best_chunk_score - a.best_chunk_score;
    }
    return a.source_path.localeCompare(b.source_path);
  });
  return ordered.map((s, idx) => ({ ...s, rank: idx + 1 }));
}

/**
 * A case is critical-for-source-recall iff:
 *   - it is answerable (expectation_kind is `deterministic` or `ambiguous`,
 *     i.e., NOT `signal_empty`)
 *   - it is not a signal_empty case by query mode or warning expectation
 *   - `must_include_sources` is non-empty
 *
 * For unsupported / signal_empty cases there is no critical source set; they
 * are evaluated on honest abstention and separability instead (see
 * separability.ts).
 */
export function isAnswerableCase(
  caseInfo: Pick<
    RealCorpusEvalCase,
    "expectation_kind" | "expected_query_mode" | "expected_signal_empty_warning"
  >,
): boolean {
  if (caseInfo.expectation_kind === "signal_empty") return false;
  if (caseInfo.expected_query_mode === "signal_empty") return false;
  if (caseInfo.expected_signal_empty_warning) return false;
  return true;
}

export function isCriticalSourceCase(
  caseInfo: Pick<
    RealCorpusEvalCase,
    | "expectation_kind"
    | "expected_query_mode"
    | "expected_signal_empty_warning"
    | "must_include_sources"
  >,
): boolean {
  if (!isAnswerableCase(caseInfo)) return false;
  return caseInfo.must_include_sources.length > 0;
}

export type SourceRecallInput = {
  sources: Slice0SourceCandidate[];
  expected_top_source: string;
  acceptable_top_sources: string[];
  must_include_sources: string[];
  is_critical: boolean;
};

export function computeSourceRecallMetrics(
  input: SourceRecallInput,
): Slice0SourceRecallMetrics {
  const rankByPath = new Map(input.sources.map((s) => [s.source_path, s.rank]));
  const expectedRank = rankByPath.get(input.expected_top_source) ?? null;

  const recallAtK = (k: number): boolean =>
    expectedRank !== null && expectedRank <= k;

  const critical = (k: number): RecallCount | null => {
    if (!input.is_critical) return null;
    let found = 0;
    for (const required of input.must_include_sources) {
      const r = rankByPath.get(required);
      if (r !== undefined && r <= k) found += 1;
    }
    return { found, total: input.must_include_sources.length };
  };

  const allCovered = (k: number): boolean | null => {
    const c = critical(k);
    if (c === null) return null;
    return c.total > 0 && c.found === c.total;
  };

  const missing = (k: number): string[] | null => {
    if (!input.is_critical) return null;
    return input.must_include_sources.filter((req) => {
      const r = rankByPath.get(req);
      return r === undefined || r > k;
    });
  };

  return {
    expected_source_rank: expectedRank,
    expected_source_recall_at_10: recallAtK(10),
    expected_source_recall_at_20: recallAtK(20),
    expected_source_recall_at_50: recallAtK(50),
    critical_source_recall_at_10: critical(10),
    critical_source_recall_at_20: critical(20),
    critical_source_recall_at_50: critical(50),
    all_critical_sources_covered_at_10: allCovered(10),
    all_critical_sources_covered_at_20: allCovered(20),
    all_critical_sources_covered_at_50: allCovered(50),
    missing_critical_sources_at_10: missing(10),
    missing_critical_sources_at_20: missing(20),
    missing_critical_sources_at_50: missing(50),
  };
}

/** Helper to inspect ExpectationKind enum bound shape (compile-time safety). */
export function _isExpectationKindLiteral(k: ExpectationKind): k is ExpectationKind {
  return Boolean(k);
}
