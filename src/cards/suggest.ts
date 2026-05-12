import type { Db } from "../store/db.js";
import { listCurrentChunks } from "../store/chunks.js";
import { getAnchorsForChunk } from "../store/anchors.js";
import { scopeMatchScore, type QueryScope } from "../retrieve/scope-match.js";
import type { Card } from "../types/card.js";
import type { DocChunk } from "../types/chunk.js";

export type LinkSuggestion = {
  chunk: DocChunk;
  anchor_overlap: number;
  scope_match: number;
};

/** Project the card's scope into a `QueryScope` so we can reuse scope-match. */
function cardScopeAsQuery(card: Card): QueryScope {
  return {
    company: card.scope.company,
    team: card.scope.team,
    project: card.scope.project,
    module: card.scope.module,
    feature: card.scope.feature,
  };
}

/**
 * Inline link suggester (D40, ADR-0008): given a freshly authored Card,
 * return up to `topN` Doc Chunks ranked by anchor overlap, then scope match.
 *
 * Pure function over the chunk store + anchors. Does NOT mutate state. The
 * caller (e.g. `contexttrail card add`) decides which suggestions become real links.
 */
export function suggestLinks(
  db: Db,
  card: Card,
  topN: number,
): LinkSuggestion[] {
  const chunks = listCurrentChunks(db);
  if (chunks.length === 0) return [];

  const cardSyms = new Set(card.symbol_anchors);
  const cardFiles = new Set(card.file_anchors);
  const queryScope = cardScopeAsQuery(card);

  const ranked: LinkSuggestion[] = chunks.map((chunk) => {
    const anchors = getAnchorsForChunk(db, chunk.version_id);
    let matched = 0;
    for (const a of anchors) {
      if (a.kind === "symbol" && cardSyms.has(a.value)) matched += 1;
      else if (a.kind === "file" && cardFiles.has(a.value)) matched += 1;
    }
    const denom = cardSyms.size + cardFiles.size;
    const anchor_overlap = denom > 0 ? matched / denom : 0;
    const scope_match = scopeMatchScore([queryScope], chunk.scope);
    return { chunk, anchor_overlap, scope_match };
  });

  ranked.sort((a, b) => {
    if (b.anchor_overlap !== a.anchor_overlap) return b.anchor_overlap - a.anchor_overlap;
    if (b.scope_match !== a.scope_match) return b.scope_match - a.scope_match;
    return a.chunk.version_id.localeCompare(b.chunk.version_id);
  });

  return ranked.slice(0, topN);
}
