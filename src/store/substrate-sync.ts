import type { Db } from "./db.js";
import type { DocChunk, CodeAnchor, IndexedDocSource } from "../types/chunk.js";
import type { Card, CardLink, AuthorReviewState, FreshnessReason, FreshnessState } from "../types/card.js";
import { encodeChunkScope } from "./scope-codec.js";
import { hasSubstrateTables } from "./substrate-support.js";

type CardAnchorLike = {
  card_id: string;
  kind: "symbol" | "file" | "route";
  value: string;
};

export function upsertChunkToSubstrate(db: Db, chunk: DocChunk): void {
  if (!hasSubstrateTables(db)) return;
  db.prepare(
    `INSERT OR REPLACE INTO context_objects
       (id, kind, source_uri, authority, scope_layer, scope_data, content_hash, source_hash,
        freshness_state, freshness_reason, status, indexed_at, updated_at)
     VALUES (?, 'doc_chunk', ?, 'imported', ?, ?, ?, ?, 'verified', 'no_links', ?, ?, ?)`,
  ).run(
    chunk.version_id,
    chunk.source_path,
    chunk.scope.layer,
    encodeChunkScope(chunk.scope),
    chunk.chunk_content_hash,
    chunk.source_content_hash,
    chunk.status,
    chunk.indexed_at,
    chunk.indexed_at,
  );
  db.prepare(
    `INSERT OR REPLACE INTO doc_chunk_ext
       (context_object_id, stable_key, doc_id, source_path, heading_path, heading_level,
        chunk_index, chunk_count, title, body, token_count, start_line, end_line,
        heading_slug, doc_role, role_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    chunk.version_id,
    chunk.stable_key,
    chunk.doc_id,
    chunk.source_path,
    JSON.stringify(chunk.heading_path),
    chunk.heading_level,
    chunk.chunk_index,
    chunk.chunk_count,
    chunk.title,
    chunk.body,
    chunk.token_count,
    chunk.start_line,
    chunk.end_line,
    chunk.heading_slug ?? null,
    chunk.doc_role ?? "canonical",
    chunk.role_source ?? "default",
  );
}

export function tombstoneChunkInSubstrate(db: Db, version_id: string): void {
  if (!hasSubstrateTables(db)) return;
  db.prepare("UPDATE context_objects SET status = 'tombstoned' WHERE id = ?").run(version_id);
}

export function deleteChunkAnchorsInSubstrate(db: Db, version_id: string): void {
  if (!hasSubstrateTables(db)) return;
  db.prepare("DELETE FROM code_anchors_v2 WHERE context_object_id = ?").run(version_id);
}

export function upsertChunkAnchorToSubstrate(db: Db, anchor: CodeAnchor): void {
  if (!hasSubstrateTables(db)) return;
  db.prepare(
    `INSERT OR REPLACE INTO code_anchors_v2
       (context_object_id, kind, value, confidence, source)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    anchor.chunk_version_id,
    anchor.kind,
    anchor.value,
    anchor.confidence,
    anchor.source,
  );
}

export function upsertCardToSubstrate(db: Db, card: Card): void {
  if (!hasSubstrateTables(db)) return;
  const provenance = card.provenance ?? "human_authored";
  const authoredBy = card.authored_by ?? "unknown";
  db.prepare(
    `INSERT OR REPLACE INTO context_objects
       (id, kind, source_uri, authority, scope_layer, scope_data, content_hash, source_hash,
        freshness_state, freshness_reason, status, indexed_at, updated_at)
     VALUES (?, 'card', ?, ?, ?, ?, ?, ?, ?, ?, 'current', ?, ?)`,
  ).run(
    card.id,
    card.source_path,
    card.authority,
    card.scope.layer,
    encodeChunkScope(card.scope),
    card.source_hash,
    card.source_hash,
    card.freshness_state,
    card.freshness_reason,
    card.updated_at,
    card.updated_at,
  );
  db.prepare(
    `INSERT OR REPLACE INTO card_ext
       (context_object_id, card_type, title, body, provenance, authored_by, command, covers, author_review_state, token_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    card.id,
    card.type,
    card.title,
    card.body,
    provenance,
    authoredBy,
    card.type === "evidence" ? card.command : null,
    card.type === "evidence" ? JSON.stringify(card.covers) : null,
    card.author_review_state,
    card.token_count,
  );
}

export function deleteCardInSubstrate(db: Db, card_id: string): void {
  if (!hasSubstrateTables(db)) return;
  deleteCardAnchorsInSubstrate(db, card_id);
  deleteCardLinksInSubstrate(db, card_id);
  db.prepare("DELETE FROM card_ext WHERE context_object_id = ?").run(card_id);
  db.prepare("DELETE FROM context_objects WHERE id = ?").run(card_id);
}

export function deleteCardAnchorsInSubstrate(db: Db, card_id: string): void {
  if (!hasSubstrateTables(db)) return;
  db.prepare("DELETE FROM code_anchors_v2 WHERE context_object_id = ?").run(card_id);
}

export function upsertCardAnchorToSubstrate(db: Db, anchor: CardAnchorLike): void {
  if (!hasSubstrateTables(db)) return;
  db.prepare(
    `INSERT OR REPLACE INTO code_anchors_v2
       (context_object_id, kind, value, confidence, source)
     VALUES (?, ?, ?, 'high', 'frontmatter')`,
  ).run(anchor.card_id, anchor.kind, anchor.value);
}

export function deleteCardLinksInSubstrate(db: Db, card_id: string): void {
  if (!hasSubstrateTables(db)) return;
  db.prepare("DELETE FROM links WHERE from_kind = 'card' AND from_id = ?").run(card_id);
}

export function upsertCardLinkToSubstrate(db: Db, link: CardLink): void {
  if (!hasSubstrateTables(db)) return;
  db.prepare(
    `DELETE FROM links
      WHERE from_kind = 'card' AND from_id = ? AND to_kind = 'doc_chunk' AND to_id = ? AND link_type = ?`,
  ).run(link.card_id, link.chunk_stable_key, link.link_type);
  db.prepare(
    `INSERT INTO links
       (from_kind, from_id, to_kind, to_id, link_type, version_pin, content_hash_pin, source, created_at)
     VALUES ('card', ?, 'doc_chunk', ?, ?, ?, ?, 'frontmatter', ?)`,
  ).run(
    link.card_id,
    link.chunk_stable_key,
    link.link_type,
    link.version_pin,
    link.content_hash_pin,
    link.linked_at,
  );
}

export function setCardFreshnessInSubstrate(
  db: Db,
  card_id: string,
  state: FreshnessState,
  reason: FreshnessReason,
): void {
  if (!hasSubstrateTables(db)) return;
  db
    .prepare(
      "UPDATE context_objects SET freshness_state = ?, freshness_reason = ? WHERE id = ?",
    )
    .run(state, reason, card_id);
}

export function setCardAuthorReviewInSubstrate(
  db: Db,
  card_id: string,
  state: AuthorReviewState,
): void {
  if (!hasSubstrateTables(db)) return;
  db
    .prepare("UPDATE card_ext SET author_review_state = ? WHERE context_object_id = ?")
    .run(state, card_id);
}

export function upsertSourceMetadataToSubstrate(_db: Db, _source: IndexedDocSource): void {
  // Source metadata is derived from current doc_chunk_ext rows in substrate.
  // No separate write path is needed here.
}
