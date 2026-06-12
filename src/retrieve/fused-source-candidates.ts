/**
 * Fused source candidates (V2.5.4).
 *
 * Combines the chunk-aggregated source substrate with multi-path fusion. The
 * resulting `ProfileEnrichedSourceCandidate[]` carries a `fused_rank` so
 * source rerank prefers post-RRF ordering over a single chunk-lexical signal.
 *
 * Sources without chunks do not synthesise candidates — final Context Packs
 * cite Doc Chunks; an alias/anchor-only signal can only re-order a source
 * that already has a chunk to cite.
 */
import {
  fuseSourceCandidates,
  generateMultiPathSourceCandidates,
  type LexicalChunkHit,
  type MinimalSourceProfile,
} from "./multi-path-candidates.js";
import type {
  ProfileEnrichedSourceCandidate,
  SourceCandidateChunk,
} from "./source-candidates.js";
import type { SourceProfile } from "../types/source-profile.js";

export type BuildFusedArgs = {
  lexical_chunks: SourceCandidateChunk[];
  profiles: SourceProfile[];
  query_tokens: string[];
  anchors: { files: string[]; symbols: string[]; routes: string[] };
  /** Lookup that returns the SourceProfile attached to a doc-chunk source. */
  profileBySource: (source_path: string) => SourceProfile | null;
};

export function buildFusedSourceCandidates(
  args: BuildFusedArgs,
): ProfileEnrichedSourceCandidate[] {
  // Step 1 — aggregate chunks by source (matches buildProfileEnrichedSourceCandidates).
  type Bucket = {
    source_path: string;
    best_chunk_rank: number;
    best_chunk_score: number;
    contributing_chunks: ProfileEnrichedSourceCandidate["contributing_chunks"];
  };
  const bySource = new Map<string, Bucket>();
  for (const c of args.lexical_chunks) {
    if (c.kind !== "doc_chunk" || !c.source_path) continue;
    const existing = bySource.get(c.source_path);
    if (!existing) {
      bySource.set(c.source_path, {
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

  // Step 2 — compute multi-path fusion using the same lexical hits + profiles.
  const lexicalHits: LexicalChunkHit[] = args.lexical_chunks
    .filter((c) => c.kind === "doc_chunk" && c.source_path)
    .map((c) => ({
      rank: c.rank,
      source_path: c.source_path!,
      final_score: c.final_score,
    }));
  const minimalProfiles: MinimalSourceProfile[] = args.profiles.map((p) => ({
    source_path: p.source_path,
    title: p.title,
    h1: p.h1,
    heading_outline: p.heading_outline,
    aliases: p.aliases,
    questions_answered: p.questions_answered,
    heading_aliases: p.heading_aliases,
    code_fence_entities: p.code_fence_entities,
  }));
  const pathCandidates = generateMultiPathSourceCandidates({
    query_tokens: args.query_tokens,
    anchors: args.anchors,
    lexical_chunk_candidates: lexicalHits,
    profiles: minimalProfiles,
  });
  const fused = fuseSourceCandidates(pathCandidates);
  const fusedBySource = new Map(fused.map((f) => [f.source_path, f]));

  // Step 3 — emit ProfileEnrichedSourceCandidate per chunk-supported source.
  const ordered = [...bySource.values()].sort((a, b) => {
    if (a.best_chunk_rank !== b.best_chunk_rank) return a.best_chunk_rank - b.best_chunk_rank;
    if (b.best_chunk_score !== a.best_chunk_score) return b.best_chunk_score - a.best_chunk_score;
    return a.source_path.localeCompare(b.source_path);
  });
  return ordered.map((bucket, idx) => {
    const fusedHit = fusedBySource.get(bucket.source_path);
    return {
      rank: idx + 1,
      source_path: bucket.source_path,
      best_chunk_rank: bucket.best_chunk_rank,
      best_chunk_score: bucket.best_chunk_score,
      contributing_chunks: bucket.contributing_chunks,
      profile: args.profileBySource(bucket.source_path),
      fused_rank: fusedHit?.rank,
      fused_path_count: fusedHit?.path_count,
    };
  });
}
