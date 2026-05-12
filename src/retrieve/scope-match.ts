import type { ChunkScope } from "../types/chunk.js";

export type QueryScope = {
  company?: string;
  team?: string;
  project?: string;
  module?: string;
  feature?: string;
};

function single(query: QueryScope, chunk: ChunkScope): number {
  if (
    query.module !== undefined &&
    chunk.module !== undefined &&
    query.module === chunk.module &&
    (query.project === undefined || query.project === chunk.project)
  ) {
    return 1.0;
  }
  if (
    query.project !== undefined &&
    chunk.project !== undefined &&
    query.project === chunk.project
  ) {
    return 0.6;
  }
  if (
    query.team !== undefined &&
    chunk.team !== undefined &&
    query.team === chunk.team
  ) {
    return 0.3;
  }
  if (
    query.company !== undefined &&
    chunk.company !== undefined &&
    query.company === chunk.company
  ) {
    return 0.3;
  }
  return 0;
}

/** Multi-scope OR: max over per-scope matches. Empty array → 0 (neutral). */
export function scopeMatchScore(
  queries: QueryScope[],
  chunk: ChunkScope,
): number {
  if (queries.length === 0) return 0;
  let best = 0;
  for (const q of queries) {
    const s = single(q, chunk);
    if (s > best) best = s;
  }
  return best;
}
