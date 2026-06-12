/**
 * Substrate-side read functions.
 *
 * After the migration, callers can read Doc Chunks and Cards through the
 * unified `context_objects` + extension tables instead of the flat
 * `doc_chunks` + `cards` tables. The ports here mirror the flat-side
 * functions in `chunks.ts` / `cards.ts` so the rest of retrieval can switch
 * its backing store with a single function-name swap.
 *
 * In v1 we keep both reads available; the production retrieve path still
 * goes through flat tables for backward compatibility, and tests assert
 * that substrate reads produce equivalent output.
 */
import type { Db } from "./db.js";
import type {
  DocChunk,
  CodeAnchor,
} from "../types/chunk.js";
import type {
  Card,
  CardLink,
  FreshnessState,
} from "../types/card.js";
import type { IndexedDocSource } from "../types/chunk.js";
import {
  rowToCard,
  rowToChunk,
  withCardRelations,
  type StoredCardRow,
  type StoredChunkRow,
} from "./storage-mappers.js";

const CHUNK_SELECT = `
  SELECT co.id AS version_id,
         dce.stable_key,
         dce.doc_id,
         dce.source_path,
         dce.heading_path,
         dce.heading_level,
         dce.chunk_index,
         dce.chunk_count,
         dce.title,
         dce.body,
         dce.token_count,
         co.content_hash AS chunk_content_hash,
         co.source_hash AS source_content_hash,
         dce.start_line,
         dce.end_line,
         dce.heading_slug,
         dce.doc_role,
         dce.role_source,
         co.status,
         co.scope_data,
         co.indexed_at,
         co.freshness_state
  FROM context_objects co
  JOIN doc_chunk_ext dce ON dce.context_object_id = co.id
  WHERE co.kind = 'doc_chunk'
`;

export function listCurrentChunksFromSubstrate(db: Db): DocChunk[] {
  const rows = db
    .prepare(CHUNK_SELECT + " AND co.status = 'current'")
    .all() as StoredChunkRow[];
  return rows.map(rowToChunk);
}

export function getChunkByVersionIdFromSubstrate(
  db: Db,
  version_id: string,
): DocChunk | null {
  const row = db.prepare(CHUNK_SELECT + " AND co.id = ?").get(version_id) as
    | StoredChunkRow
    | undefined;
  return row ? rowToChunk(row) : null;
}

export function getChunksByStableKeyFromSubstrate(
  db: Db,
  stable_key: string,
): DocChunk[] {
  const rows = db
    .prepare(CHUNK_SELECT + " AND dce.stable_key = ? ORDER BY co.status DESC, co.id")
    .all(stable_key) as StoredChunkRow[];
  return rows.map(rowToChunk);
}

export type ChunkLookupFromSubstrate = DocChunk & {
  freshness_state: FreshnessState;
};

export function getChunkLookupByVersionIdFromSubstrate(
  db: Db,
  version_id: string,
): ChunkLookupFromSubstrate | null {
  const row = db.prepare(CHUNK_SELECT + " AND co.id = ?").get(version_id) as
    | (StoredChunkRow & { freshness_state?: string })
    | undefined;
  if (!row) return null;
  return {
    ...rowToChunk(row),
    freshness_state: (row.freshness_state as FreshnessState | undefined) ?? "verified",
  };
}

const CARD_SELECT = `
  SELECT co.id,
         ce.card_type AS type,
         ce.title,
         ce.body,
         ce.provenance,
         ce.authored_by,
         co.authority,
         co.scope_data,
         ce.command,
         ce.covers,
         co.source_uri AS source_path,
         co.source_hash,
         co.freshness_state,
         co.freshness_reason,
         ce.author_review_state,
         ce.token_count,
         co.updated_at
  FROM context_objects co
  JOIN card_ext ce ON ce.context_object_id = co.id
  WHERE co.kind = 'card'
`;

export function listCardsFromSubstrate(db: Db): Card[] {
  const rows = db.prepare(CARD_SELECT + " ORDER BY co.id").all() as StoredCardRow[];
  return rows.map((r) => {
    const card = rowToCard(r);
    return withCardRelations(
      card,
      listAnchorsForCardFromSubstrate(db, card.id),
      listLinksForCardFromSubstrate(db, card.id),
    );
  });
}

export function getCardByIdFromSubstrate(db: Db, id: string): Card | null {
  const row = db.prepare(CARD_SELECT + " AND co.id = ?").get(id) as
    | StoredCardRow
    | undefined;
  if (!row) return null;
  const card = rowToCard(row);
  return withCardRelations(
    card,
    listAnchorsForCardFromSubstrate(db, card.id),
    listLinksForCardFromSubstrate(db, card.id),
  );
}

function listAnchorsForCardFromSubstrate(db: Db, card_id: string) {
  return db
    .prepare(
      `SELECT kind, value
         FROM code_anchors_v2
        WHERE context_object_id = ?
          AND kind IN ('symbol', 'file', 'route')`,
    )
    .all(card_id) as Array<{ kind: "symbol" | "file" | "route"; value: string }>;
}

export function listLinksForCardFromSubstrate(db: Db, card_id: string): CardLink[] {
  return db
    .prepare(
      `SELECT from_id AS card_id,
              to_id AS chunk_stable_key,
              version_pin,
              content_hash_pin,
              link_type,
              created_at AS linked_at
         FROM links
        WHERE from_kind = 'card' AND to_kind = 'doc_chunk' AND from_id = ?`,
    )
    .all(card_id) as CardLink[];
}

export function getAnchorsForChunkFromSubstrate(db: Db, version_id: string): CodeAnchor[] {
  return db
    .prepare(
      `SELECT context_object_id AS chunk_version_id, kind, value, confidence, source
         FROM code_anchors_v2
        WHERE context_object_id = ?`,
    )
    .all(version_id) as CodeAnchor[];
}

export function listSourcesFromSubstrate(db: Db): IndexedDocSource[] {
  const rows = db
    .prepare(
      `SELECT dce.source_path AS source_path,
              MAX(co.indexed_at) AS last_indexed_at,
              COUNT(*) AS chunk_count
         FROM context_objects co
         JOIN doc_chunk_ext dce ON dce.context_object_id = co.id
        WHERE co.kind = 'doc_chunk' AND co.status = 'current'
        GROUP BY dce.source_path
        ORDER BY dce.source_path`,
    )
    .all() as Array<{
      source_path: string;
      last_indexed_at: string;
      chunk_count: number;
    }>;
  return rows.map((row) => ({
    source_path: row.source_path,
    source_mtime_ms: 0,
    source_size: 0,
    source_content_hash: "",
    last_indexed_at: row.last_indexed_at,
    chunk_count: row.chunk_count,
  }));
}
