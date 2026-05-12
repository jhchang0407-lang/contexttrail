import type { Db } from "./db.js";
import type { DocChunk } from "../types/chunk.js";
import { encodeChunkScope } from "./scope-codec.js";
import { rowToChunk, type StoredChunkRow } from "./storage-mappers.js";
import {
  tombstoneChunkInSubstrate,
  upsertChunkToSubstrate,
} from "./substrate-sync.js";

const UPSERT_SQL = `
INSERT INTO doc_chunks (
  version_id, stable_key, doc_id, source_path,
  heading_path, heading_level, chunk_index, chunk_count,
  title, body, token_count, chunk_content_hash, source_content_hash,
  start_line, end_line, heading_slug,
  status, scope_layer, scope_data,
  doc_role, role_source,
  indexed_at
) VALUES (
  @version_id, @stable_key, @doc_id, @source_path,
  @heading_path, @heading_level, @chunk_index, @chunk_count,
  @title, @body, @token_count, @chunk_content_hash, @source_content_hash,
  @start_line, @end_line, @heading_slug,
  @status, @scope_layer, @scope_data,
  @doc_role, @role_source,
  @indexed_at
)
ON CONFLICT(version_id) DO UPDATE SET
  stable_key=excluded.stable_key,
  status=excluded.status,
  body=excluded.body,
  token_count=excluded.token_count,
  chunk_content_hash=excluded.chunk_content_hash,
  source_content_hash=excluded.source_content_hash,
  scope_layer=excluded.scope_layer,
  scope_data=excluded.scope_data,
  doc_role=excluded.doc_role,
  role_source=excluded.role_source,
  indexed_at=excluded.indexed_at
`;

const FTS_DELETE_SQL = "DELETE FROM doc_chunks_fts WHERE rowid = (SELECT rowid FROM doc_chunks WHERE version_id=?)";
const FTS_INSERT_SQL = "INSERT INTO doc_chunks_fts(rowid, title, heading_path, body) VALUES ((SELECT rowid FROM doc_chunks WHERE version_id=?), ?, ?, ?)";

import { tokenize as tokenizeForIndex } from "../retrieve/tokenize.js";

/** Pre-tokenize a field for FTS5 storage. Both sides of FTS5 (write + read)
 *  must agree on tokenization; FTS5 treats the stored string as opaque text
 *  and uses its default tokenizer to split on whitespace + punctuation, which
 *  is fine because we hand it our own pre-tokenized stems. */
function ftsField(text: string): string {
  return tokenizeForIndex(text, { stem: true, splitCodeIdentifiers: true }).join(" ");
}

export function upsertChunk(db: Db, c: DocChunk): void {
  db.prepare(FTS_DELETE_SQL).run(c.version_id);
  db.prepare(UPSERT_SQL).run({
    version_id: c.version_id,
    stable_key: c.stable_key,
    doc_id: c.doc_id,
    source_path: c.source_path,
    heading_path: JSON.stringify(c.heading_path),
    heading_level: c.heading_level,
    chunk_index: c.chunk_index,
    chunk_count: c.chunk_count,
    title: c.title,
    body: c.body,
    token_count: c.token_count,
    chunk_content_hash: c.chunk_content_hash,
    source_content_hash: c.source_content_hash,
    start_line: c.start_line,
    end_line: c.end_line,
    heading_slug: c.heading_slug ?? null,
    status: c.status,
    scope_layer: c.scope.layer,
    scope_data: encodeChunkScope(c.scope),
    doc_role: c.doc_role ?? "canonical",
    role_source: c.role_source ?? "default",
    indexed_at: c.indexed_at,
  });
  if (c.status === "current") {
    db.prepare(FTS_INSERT_SQL).run(
      c.version_id,
      ftsField(c.title),
      ftsField(c.heading_path.join(" ")),
      ftsField(c.body),
    );
  }
  upsertChunkToSubstrate(db, c);
}

export function getChunkByVersionId(db: Db, version_id: string): DocChunk | null {
  const row = db
    .prepare("SELECT * FROM doc_chunks WHERE version_id = ?")
    .get(version_id) as StoredChunkRow | undefined;
  return row ? rowToChunk(row) : null;
}

export function getChunksByStableKey(db: Db, stable_key: string): DocChunk[] {
  const rows = db
    .prepare("SELECT * FROM doc_chunks WHERE stable_key = ?")
    .all(stable_key) as StoredChunkRow[];
  return rows.map(rowToChunk);
}

export function tombstoneChunk(db: Db, version_id: string): void {
  db.prepare("UPDATE doc_chunks SET status='tombstoned' WHERE version_id=?").run(
    version_id,
  );
  db.prepare(FTS_DELETE_SQL).run(version_id);
  tombstoneChunkInSubstrate(db, version_id);
}

export function listCurrentChunks(db: Db): DocChunk[] {
  const rows = db
    .prepare("SELECT * FROM doc_chunks WHERE status='current'")
    .all() as StoredChunkRow[];
  return rows.map(rowToChunk);
}

export function updateDocRoleForSource(
  db: Db,
  source_path: string,
  doc_role: NonNullable<DocChunk["doc_role"]>,
  role_source: NonNullable<DocChunk["role_source"]>,
): void {
  db.prepare(
    "UPDATE doc_chunks SET doc_role = ?, role_source = ? WHERE source_path = ?",
  ).run(doc_role, role_source, source_path);
  const substrateDocChunks = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='doc_chunk_ext'")
    .get() as { name: string } | undefined;
  if (!substrateDocChunks) return;
  db.prepare(
    "UPDATE doc_chunk_ext SET doc_role = ?, role_source = ? WHERE source_path = ?",
  ).run(doc_role, role_source, source_path);
}
