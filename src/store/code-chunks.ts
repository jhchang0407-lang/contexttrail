import { createHash } from "node:crypto";
import type { Db } from "./db.js";
import { count as countTokens } from "../parse/tokens.js";
import type {
  ExtractedCodeChunk,
  StoredCodeChunk,
} from "../types/code-source.js";

const INSERT_SQL = `
INSERT INTO code_chunks (
  version_id, stable_key, source_path, symbol_path,
  code_role, declaration_kind, exported, body,
  token_count, chunk_content_hash, source_content_hash,
  start_line, end_line, indexed_at, status
) VALUES (
  @version_id, @stable_key, @source_path, @symbol_path,
  @code_role, @declaration_kind, @exported, @body,
  @token_count, @chunk_content_hash, @source_content_hash,
  @start_line, @end_line, @indexed_at, @status
)
`;

const DELETE_FTS_FOR_SOURCE_SQL = `
DELETE FROM code_chunks_fts
 WHERE rowid IN (SELECT rowid FROM code_chunks WHERE source_path = ?)
`;

const INSERT_FTS_SQL = `
INSERT INTO code_chunks_fts (
  rowid, source_path, symbol_path, code_role, declaration_kind, body
) VALUES (
  (SELECT rowid FROM code_chunks WHERE version_id = ?), ?, ?, ?, ?, ?
)
`;

const SEARCH_FTS_SQL = `
SELECT cc.version_id AS version_id,
       bm25(code_chunks_fts, ?, ?, ?, ?, ?) AS bm25
  FROM code_chunks_fts
  JOIN code_chunks cc ON cc.rowid = code_chunks_fts.rowid
 WHERE code_chunks_fts MATCH ?
 ORDER BY bm25 ASC
 LIMIT ?
`;

type CodeChunkRow = {
  version_id: string;
  stable_key: string;
  source_path: string;
  symbol_path: string | null;
  code_role: StoredCodeChunk["code_role"];
  declaration_kind: StoredCodeChunk["declaration_kind"];
  exported: number;
  body: string;
  token_count: number;
  chunk_content_hash: string;
  source_content_hash: string;
  start_line: number;
  end_line: number;
  indexed_at: string;
  status: StoredCodeChunk["status"];
};

export const CODE_CHUNKS_FTS_WEIGHTS = {
  source_path: 2.0,
  symbol_path: 3.0,
  code_role: 1.2,
  declaration_kind: 1.5,
  body: 1.0,
} as const;

export function replaceCodeChunksForSource(
  db: Db,
  args: {
    source_path: string;
    source_content_hash: string;
    indexed_at: string;
    chunks: ExtractedCodeChunk[];
  },
): void {
  const tx = db.transaction(() => {
    db.prepare(DELETE_FTS_FOR_SOURCE_SQL).run(args.source_path);
    db.prepare("DELETE FROM code_chunks WHERE source_path = ?").run(args.source_path);
    for (const chunk of args.chunks) {
      const stored = materializeStoredCodeChunk(chunk, args.source_content_hash, args.indexed_at);
      db.prepare(INSERT_SQL).run({
        ...stored,
        exported: stored.exported ? 1 : 0,
      });
      db.prepare(INSERT_FTS_SQL).run(
        stored.version_id,
        stored.source_path,
        stored.symbol_path ?? "",
        stored.code_role,
        stored.declaration_kind ?? "",
        stored.body,
      );
    }
  });
  tx();
}

export function deleteCodeChunksForSource(db: Db, source_path: string): void {
  db.prepare(DELETE_FTS_FOR_SOURCE_SQL).run(source_path);
  db.prepare("DELETE FROM code_chunks WHERE source_path = ?").run(source_path);
}

export function listCodeChunksForSource(db: Db, source_path: string): StoredCodeChunk[] {
  const rows = db
    .prepare(
      `SELECT *
         FROM code_chunks
        WHERE source_path = ?
        ORDER BY start_line, end_line, stable_key`,
    )
    .all(source_path) as CodeChunkRow[];
  return rows.map(rowToStoredCodeChunk);
}

export function listCurrentCodeChunks(db: Db): StoredCodeChunk[] {
  const rows = db
    .prepare(
      `SELECT *
         FROM code_chunks
        WHERE status = 'current'
        ORDER BY source_path, start_line, end_line, stable_key`,
    )
    .all() as CodeChunkRow[];
  return rows.map(rowToStoredCodeChunk);
}

export function getCodeChunkByVersionId(
  db: Db,
  version_id: string,
): StoredCodeChunk | null {
  const row = db
    .prepare("SELECT * FROM code_chunks WHERE version_id = ?")
    .get(version_id) as CodeChunkRow | undefined;
  return row ? rowToStoredCodeChunk(row) : null;
}

export function getCodeChunkBySourceAndSymbol(
  db: Db,
  source_path: string,
  symbol_path: string,
): StoredCodeChunk | null {
  const row = db
    .prepare(
      `SELECT *
         FROM code_chunks
        WHERE source_path = ?
          AND symbol_path = ?
          AND status = 'current'
        ORDER BY start_line, end_line
        LIMIT 1`,
    )
    .get(source_path, symbol_path) as CodeChunkRow | undefined;
  return row ? rowToStoredCodeChunk(row) : null;
}

export function getCurrentCodeChunkByStableKey(
  db: Db,
  stable_key: string,
): StoredCodeChunk | null {
  const row = db
    .prepare(
      `SELECT *
         FROM code_chunks
        WHERE stable_key = ?
          AND status = 'current'
        ORDER BY start_line, end_line
        LIMIT 1`,
    )
    .get(stable_key) as CodeChunkRow | undefined;
  return row ? rowToStoredCodeChunk(row) : null;
}

export type CodeChunkFtsHit = {
  version_id: string;
  bm25: number;
};

export function searchCodeChunksFts(
  db: Db,
  query: string,
  limit = 50,
): CodeChunkFtsHit[] {
  if (!query.trim()) return [];
  const w = CODE_CHUNKS_FTS_WEIGHTS;
  let rows: Array<{ version_id: string; bm25: number }>;
  try {
    rows = db
      .prepare(SEARCH_FTS_SQL)
      .all(
        w.source_path,
        w.symbol_path,
        w.code_role,
        w.declaration_kind,
        w.body,
        query,
        limit,
      ) as Array<{ version_id: string; bm25: number }>;
  } catch {
    return [];
  }
  return rows;
}

function materializeStoredCodeChunk(
  chunk: ExtractedCodeChunk,
  sourceContentHash: string,
  indexedAt: string,
): StoredCodeChunk {
  const body = chunk.body.trim();
  const chunkContentHash = sha256(body);
  return {
    ...chunk,
    body,
    version_id: sha256(`${chunk.stable_key}\u0000${body}`),
    token_count: countTokens(body),
    chunk_content_hash: chunkContentHash,
    source_content_hash: sourceContentHash,
    indexed_at: indexedAt,
    status: "current",
  };
}

function rowToStoredCodeChunk(row: CodeChunkRow): StoredCodeChunk {
  return {
    ...row,
    exported: row.exported === 1,
  };
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
