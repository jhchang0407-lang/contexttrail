/**
 * Profile-enriched source candidates.
 *
 * Aggregates today's chunk candidates by structured source_path, attaches the
 * matching SourceProfile when available, and preserves contributing chunk
 * ranks/scores for diagnostics. Card candidates are kept separate — Cards
 * compete in the global ranker but do not satisfy doc source recall.
 */
import type { Db } from "../store/db.js";
import { getSourceProfile } from "../store/source-profiles.js";
import type { SourceProfile } from "../types/source-profile.js";

export type SourceCandidateChunk = {
  rank: number;
  version_id: string;
  /** null/empty if the candidate is a Card (excluded from source aggregation). */
  source_path: string | null;
  final_score: number;
  kind: "doc_chunk" | "card";
};

export type ContributingChunk = {
  version_id: string;
  rank: number;
  final_score: number;
};

export type ProfileEnrichedSourceCandidate = {
  rank: number;
  source_path: string;
  best_chunk_rank: number;
  best_chunk_score: number;
  contributing_chunks: ContributingChunk[];
  profile: SourceProfile | null;
  /**
   * V2.5.4: post-RRF rank from multi-path fusion when the
   * caller supplied multi-path candidates. Source-rerank prefers this over
   * `best_chunk_rank` for `source_rank_prior` so independent path agreement
   * (alias, anchor, title, …) influences scoring without hidden weights.
   */
  fused_rank?: number;
  /** Distinct candidate paths that contributed to fusion for this source. */
  fused_path_count?: number;
};

export type BuildArgs = {
  db: Db;
  chunks: SourceCandidateChunk[];
};

export function buildProfileEnrichedSourceCandidates(
  args: BuildArgs,
): ProfileEnrichedSourceCandidate[] {
  const { db, chunks } = args;

  type Bucket = {
    source_path: string;
    best_chunk_rank: number;
    best_chunk_score: number;
    contributing_chunks: ContributingChunk[];
    insertion_order: number;
  };

  const bySource = new Map<string, Bucket>();
  let order = 0;
  for (const c of chunks) {
    if (c.kind !== "doc_chunk") continue;
    if (!c.source_path) continue;
    const existing = bySource.get(c.source_path);
    if (!existing) {
      bySource.set(c.source_path, {
        source_path: c.source_path,
        best_chunk_rank: c.rank,
        best_chunk_score: c.final_score,
        contributing_chunks: [
          { version_id: c.version_id, rank: c.rank, final_score: c.final_score },
        ],
        insertion_order: order++,
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

  return ordered.map((bucket, idx) => ({
    rank: idx + 1,
    source_path: bucket.source_path,
    best_chunk_rank: bucket.best_chunk_rank,
    best_chunk_score: bucket.best_chunk_score,
    contributing_chunks: bucket.contributing_chunks,
    profile: getSourceProfile(db, bucket.source_path),
  }));
}
