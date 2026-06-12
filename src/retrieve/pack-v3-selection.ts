/**
 * Pack/display integration for source selection (V3.5).
 *
 * `applySourceSelectionToChunks` stamps `source_selection_rank` on candidate
 * doc chunks whose `source_path` survived the V3.4 selection decision. The
 * pack comparator (pack.ts) reads `source_selection_rank` ahead of the
 * legacy `source_rerank_rank` so the V3 decision drives display order.
 *
 * Locked Cards bypass selection entirely — the helper only touches doc
 * chunks. Non-locked Cards are not in scope for V3.5; their type-bias and
 * score remain authoritative for ranking.
 */
import type { CandidateDocChunkTrace } from "./pack.js";
import type { SourceSelectionDecision } from "./source-selection-decision.js";

export type ChunkWithSource = CandidateDocChunkTrace & {
  source_path?: string | null;
};

export type ApplySourceSelectionArgs = {
  chunks: ChunkWithSource[];
  decision: SourceSelectionDecision;
};

export function applySourceSelectionToChunks(
  args: ApplySourceSelectionArgs,
): ChunkWithSource[] {
  if (args.decision.fail_closed) {
    return args.chunks.map(clearSourceSelectionRank);
  }
  const rankBySource = new Map<string, number>();
  args.decision.selected_sources.forEach((s, i) => {
    rankBySource.set(s.source_path, i + 1);
  });
  return args.chunks.map((c) => {
    const clean = clearSourceSelectionRank(c);
    const path = c.source_path ?? null;
    if (path === null) return clean;
    const rank = rankBySource.get(path);
    if (rank === undefined) return clean;
    return { ...clean, source_selection_rank: rank };
  });
}

function clearSourceSelectionRank(chunk: ChunkWithSource): ChunkWithSource {
  const { source_selection_rank: _oldRank, ...rest } = chunk;
  return rest;
}
