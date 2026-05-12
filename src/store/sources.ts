import type { Db } from "./db.js";
import type { IndexedDocSource } from "../types/chunk.js";

const UPSERT_SQL = `
INSERT INTO indexed_doc_sources (
  source_path, source_mtime_ms, source_size, source_content_hash,
  last_indexed_at, last_indexed_git_sha, chunk_count
) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(source_path) DO UPDATE SET
  source_mtime_ms=excluded.source_mtime_ms,
  source_size=excluded.source_size,
  source_content_hash=excluded.source_content_hash,
  last_indexed_at=excluded.last_indexed_at,
  last_indexed_git_sha=excluded.last_indexed_git_sha,
  chunk_count=excluded.chunk_count
`;

export function upsertSource(db: Db, s: IndexedDocSource): void {
  db.prepare(UPSERT_SQL).run(
    s.source_path,
    s.source_mtime_ms,
    s.source_size,
    s.source_content_hash,
    s.last_indexed_at,
    s.last_indexed_git_sha ?? null,
    s.chunk_count,
  );
}

export function getSource(db: Db, source_path: string): IndexedDocSource | null {
  const row = db
    .prepare("SELECT * FROM indexed_doc_sources WHERE source_path=?")
    .get(source_path) as
    | (IndexedDocSource & { last_indexed_git_sha: string | null })
    | undefined;
  if (!row) return null;
  return {
    source_path: row.source_path,
    source_mtime_ms: row.source_mtime_ms,
    source_size: row.source_size,
    source_content_hash: row.source_content_hash,
    last_indexed_at: row.last_indexed_at,
    last_indexed_git_sha: row.last_indexed_git_sha ?? undefined,
    chunk_count: row.chunk_count,
  };
}

export function deleteSource(db: Db, source_path: string): void {
  db.prepare("DELETE FROM indexed_doc_sources WHERE source_path=?").run(source_path);
}

export function listSources(db: Db): IndexedDocSource[] {
  const rows = db
    .prepare("SELECT * FROM indexed_doc_sources")
    .all() as (IndexedDocSource & { last_indexed_git_sha: string | null })[];
  return rows.map((r) => ({
    source_path: r.source_path,
    source_mtime_ms: r.source_mtime_ms,
    source_size: r.source_size,
    source_content_hash: r.source_content_hash,
    last_indexed_at: r.last_indexed_at,
    last_indexed_git_sha: r.last_indexed_git_sha ?? undefined,
    chunk_count: r.chunk_count,
  }));
}

export function listChunkVersionIdsForSource(
  db: Db,
  source_path: string,
  status: "current" | "tombstoned" | "any" = "any",
): string[] {
  const sql =
    status === "any"
      ? "SELECT version_id FROM doc_chunks WHERE source_path=?"
      : "SELECT version_id FROM doc_chunks WHERE source_path=? AND status=?";
  const rows =
    status === "any"
      ? (db.prepare(sql).all(source_path) as { version_id: string }[])
      : (db.prepare(sql).all(source_path, status) as { version_id: string }[]);
  return rows.map((r) => r.version_id);
}
