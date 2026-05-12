import type { Db } from "./db.js";
import type { DocChunk, ChunkScope } from "../types/chunk.js";
import { upsertChunk } from "./chunks.js";
import { upsertAnchor, deleteAnchorsForChunk } from "./anchors.js";
import { extractMentions } from "../extract/mentions.js";

/**
 * Single per-chunk write path used by both `contexttrail import` and `contexttrail index`.
 *
 * Persists the chunk row, then refreshes its `code_anchors`:
 *   - mention extraction over the chunk body
 *   - frontmatter-declared scope arrays (files / symbols / routes)
 *
 * Anchors are deleted-then-reinserted to keep the table consistent with the
 * chunk's current body and scope (no stale rows on re-import or re-index).
 */
export function persistChunkWithAnchors(
  db: Db,
  chunk: DocChunk,
  scope: ChunkScope,
): void {
  upsertChunk(db, chunk);
  deleteAnchorsForChunk(db, chunk.version_id);

  for (const m of extractMentions(chunk.body)) {
    upsertAnchor(db, {
      chunk_version_id: chunk.version_id,
      kind: m.kind,
      value: m.value,
      confidence: m.confidence,
      source: "mention_extraction",
    });
  }
  if (scope.files) {
    for (const f of scope.files) {
      upsertAnchor(db, {
        chunk_version_id: chunk.version_id,
        kind: "file",
        value: f,
        confidence: "high",
        source: "frontmatter",
      });
    }
  }
  if (scope.symbols) {
    for (const s of scope.symbols) {
      upsertAnchor(db, {
        chunk_version_id: chunk.version_id,
        kind: "symbol",
        value: s,
        confidence: "high",
        source: "frontmatter",
      });
    }
  }
  if (scope.routes) {
    for (const r of scope.routes) {
      upsertAnchor(db, {
        chunk_version_id: chunk.version_id,
        kind: "route",
        value: r,
        confidence: "high",
        source: "frontmatter",
      });
    }
  }
}
