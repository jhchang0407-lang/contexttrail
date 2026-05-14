/**
 * code_sources persistence (PRD-0028 / slice 28.2).
 *
 * Persists `CodeSourceFacts` produced by the slice-28.1 extractor and keeps the
 * `code_sources_fts` FTS5 virtual table in sync so retrieval (slice 28.3) can
 * surface code files alongside doc chunks. Identifier is `source_path` (corpus-
 * relative); storage shape mirrors the `source_profiles` pattern.
 */
import type { Db } from "./db.js";
import type {
  CodeSourceExportedSymbol,
  CodeSourceFacts,
} from "../types/code-source.js";
import { deleteCodeChunksForSource } from "./code-chunks.js";

/**
 * Principled fixed BM25F weights for the `code_sources_fts` virtual table.
 * Values are spec-locked in PRD-0028 § slice 28.2; gate-3 in slice 28.3
 * guards against any temptation to tune them to the eval.
 */
export const CODE_SOURCES_FTS_WEIGHTS = {
  file_path: 2.5,
  exported_symbols: 2.5,
  file_purpose: 1.2,
  exported_signatures: 1.0,
} as const;

export type StoredCodeSource = {
  facts: CodeSourceFacts;
  source_content_hash: string;
  indexed_at: string;
};

const UPSERT_SQL = `
INSERT INTO code_sources (
  source_path, source_content_hash, exported_symbols, exported_signatures,
  file_purpose, imports, indexed_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(source_path) DO UPDATE SET
  source_content_hash=excluded.source_content_hash,
  exported_symbols=excluded.exported_symbols,
  exported_signatures=excluded.exported_signatures,
  file_purpose=excluded.file_purpose,
  imports=excluded.imports,
  indexed_at=excluded.indexed_at
`;

const FTS_DELETE_SQL = `DELETE FROM code_sources_fts WHERE rowid = ?`;
const FTS_INSERT_SQL = `
INSERT INTO code_sources_fts (rowid, file_path, exported_symbols, file_purpose, exported_signatures)
VALUES (?, ?, ?, ?, ?)
`;

function ftsRowid(source_path: string): number {
  // Stable 53-bit hash so the same path always maps to the same rowid (lets
  // us "DELETE then INSERT" instead of carrying a separate id column).
  let h = 0x811c9dc5;
  for (let i = 0; i < source_path.length; i++) {
    h ^= source_path.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h % 2147483647;
}

export function upsertCodeSource(
  db: Db,
  args: { facts: CodeSourceFacts; source_content_hash: string; indexed_at: string },
): void {
  const { facts } = args;
  const tx = db.transaction(() => {
    db.prepare(UPSERT_SQL).run(
      facts.file_path,
      args.source_content_hash,
      JSON.stringify(facts.exported_symbols),
      JSON.stringify(facts.exported_signatures),
      facts.file_purpose,
      JSON.stringify(facts.imports),
      args.indexed_at,
    );
    const rowid = ftsRowid(facts.file_path);
    db.prepare(FTS_DELETE_SQL).run(rowid);
    db.prepare(FTS_INSERT_SQL).run(
      rowid,
      facts.file_path,
      facts.exported_symbols.map((s) => s.name).join(" "),
      facts.file_purpose ?? "",
      facts.exported_signatures.join(" "),
    );
  });
  tx();
}

type CodeSourceRow = {
  source_path: string;
  source_content_hash: string;
  exported_symbols: string;
  exported_signatures: string;
  file_purpose: string | null;
  imports: string;
  indexed_at: string;
};

function rowToStored(row: CodeSourceRow): StoredCodeSource {
  return {
    facts: {
      file_path: row.source_path,
      exported_symbols: JSON.parse(row.exported_symbols) as CodeSourceExportedSymbol[],
      exported_signatures: JSON.parse(row.exported_signatures) as string[],
      file_purpose: row.file_purpose,
      imports: JSON.parse(row.imports) as string[],
    },
    source_content_hash: row.source_content_hash,
    indexed_at: row.indexed_at,
  };
}

export function getCodeSource(db: Db, source_path: string): StoredCodeSource | null {
  const row = db
    .prepare("SELECT * FROM code_sources WHERE source_path = ?")
    .get(source_path) as CodeSourceRow | undefined;
  return row ? rowToStored(row) : null;
}

export function listCodeSources(db: Db): StoredCodeSource[] {
  const rows = db
    .prepare("SELECT * FROM code_sources ORDER BY source_path")
    .all() as CodeSourceRow[];
  return rows.map(rowToStored);
}

export function deleteCodeSource(db: Db, source_path: string): void {
  const tx = db.transaction(() => {
    deleteCodeChunksForSource(db, source_path);
    db.prepare("DELETE FROM code_sources WHERE source_path = ?").run(source_path);
    db.prepare(FTS_DELETE_SQL).run(ftsRowid(source_path));
  });
  tx();
}

export type CodeSourceFtsHit = {
  file_path: string;
  bm25: number;
};

/**
 * BM25F-weighted full-text search over the four code-source fields.
 *
 * The weights live in `CODE_SOURCES_FTS_WEIGHTS` and match the PRD spec —
 * `exported_symbols` and `file_path` carry the canonical identity signal
 * (2.5), `file_purpose` summary substrate (1.2), `exported_signatures`
 * body-equivalent (1.0). Lower bm25() rank is better, so the result list is
 * sorted ascending by `bm25`.
 */
export function searchCodeSourcesFts(
  db: Db,
  query: string,
  limit = 50,
): CodeSourceFtsHit[] {
  if (!query.trim()) return [];
  const w = CODE_SOURCES_FTS_WEIGHTS;
  let rows: Array<{ file_path: string; bm25: number }>;
  try {
    rows = db
      .prepare(
        `SELECT file_path,
                bm25(code_sources_fts, ?, ?, ?, ?) AS bm25
         FROM code_sources_fts
         WHERE code_sources_fts MATCH ?
         ORDER BY bm25 ASC
         LIMIT ?`,
      )
      .all(
        w.file_path,
        w.exported_symbols,
        w.file_purpose,
        w.exported_signatures,
        query,
        limit,
      ) as Array<{ file_path: string; bm25: number }>;
  } catch {
    // FTS5 MATCH syntax errors degrade to no hits rather than throwing
    // through to retrieval callers — same pattern as the cards FTS layer.
    return [];
  }
  return rows;
}
