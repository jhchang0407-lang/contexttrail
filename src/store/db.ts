import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { SCHEMA_DDL } from "./schema.js";

export type Db = Database.Database;

export function openDb(filePath: string): Db {
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  try {
    db.pragma("journal_mode = WAL");
    db.exec(SCHEMA_DDL);
    ensureAdditiveColumns(db);
  } catch (err) {
    try {
      db.close();
    } catch {
      // ignore close failures while propagating the original error
    }
    if (isCorruptDbError(err)) {
      throw new Error(
        `ContextTrail cache at ${filePath} is corrupted. Delete the .contexttrail/cache directory and re-run \`contexttrail import\` to rebuild it.`,
        { cause: err },
      );
    }
    throw err;
  }
  return db;
}

function isCorruptDbError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  return code === "SQLITE_NOTADB" || err.message.includes("file is not a database");
}

function ensureAdditiveColumns(db: Db): void {
  const chunkColumns = new Set(
    (db.prepare("PRAGMA table_info(doc_chunks)").all() as { name: string }[]).map(
      (r) => r.name,
    ),
  );
  if (!chunkColumns.has("doc_role")) {
    db.exec("ALTER TABLE doc_chunks ADD COLUMN doc_role TEXT NOT NULL DEFAULT 'canonical'");
  }
  if (!chunkColumns.has("role_source")) {
    db.exec("ALTER TABLE doc_chunks ADD COLUMN role_source TEXT NOT NULL DEFAULT 'default'");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_chunks_doc_role ON doc_chunks(doc_role)");

  const cardColumns = new Set(
    (db.prepare("PRAGMA table_info(cards)").all() as { name: string }[]).map(
      (r) => r.name,
    ),
  );
  if (!cardColumns.has("provenance")) {
    db.exec("ALTER TABLE cards ADD COLUMN provenance TEXT NOT NULL DEFAULT 'human_authored'");
  }
  if (!cardColumns.has("authored_by")) {
    db.exec("ALTER TABLE cards ADD COLUMN authored_by TEXT NOT NULL DEFAULT 'unknown'");
  }

  const dceExists = (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='doc_chunk_ext'")
      .get() as { name: string } | undefined
  );
  if (!dceExists) return;
  const dceColumns = new Set(
    (db.prepare("PRAGMA table_info(doc_chunk_ext)").all() as { name: string }[]).map(
      (r) => r.name,
    ),
  );
  if (!dceColumns.has("doc_role")) {
    db.exec("ALTER TABLE doc_chunk_ext ADD COLUMN doc_role TEXT NOT NULL DEFAULT 'canonical'");
  }
  if (!dceColumns.has("role_source")) {
    db.exec("ALTER TABLE doc_chunk_ext ADD COLUMN role_source TEXT NOT NULL DEFAULT 'default'");
  }

  const ceExists = (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='card_ext'")
      .get() as { name: string } | undefined
  );
  if (!ceExists) return;
  const ceColumns = new Set(
    (db.prepare("PRAGMA table_info(card_ext)").all() as { name: string }[]).map(
      (r) => r.name,
    ),
  );
  if (!ceColumns.has("provenance")) {
    db.exec("ALTER TABLE card_ext ADD COLUMN provenance TEXT NOT NULL DEFAULT 'human_authored'");
  }
  if (!ceColumns.has("authored_by")) {
    db.exec("ALTER TABLE card_ext ADD COLUMN authored_by TEXT NOT NULL DEFAULT 'unknown'");
  }

  // PRD-0023 / slice 23.2: additive path-topology columns on
  // source_profiles. All NULLABLE — older rows degrade to "no signal"
  // until reindex.
  const profileExists = (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='source_profiles'")
      .get() as { name: string } | undefined
  );
  if (!profileExists) return;
  const profileColumns = new Set(
    (db.prepare("PRAGMA table_info(source_profiles)").all() as { name: string }[]).map(
      (r) => r.name,
    ),
  );
  if (!profileColumns.has("path_depth")) {
    db.exec("ALTER TABLE source_profiles ADD COLUMN path_depth INTEGER");
  }
  if (!profileColumns.has("is_index_file")) {
    db.exec("ALTER TABLE source_profiles ADD COLUMN is_index_file INTEGER");
  }
  if (!profileColumns.has("is_section_landing")) {
    db.exec("ALTER TABLE source_profiles ADD COLUMN is_section_landing INTEGER");
  }
  if (!profileColumns.has("package_segment")) {
    db.exec("ALTER TABLE source_profiles ADD COLUMN package_segment TEXT");
  }
  if (!profileColumns.has("version_segment")) {
    db.exec("ALTER TABLE source_profiles ADD COLUMN version_segment TEXT");
  }
  if (!profileColumns.has("heading_aliases")) {
    db.exec("ALTER TABLE source_profiles ADD COLUMN heading_aliases TEXT");
  }
  if (!profileColumns.has("code_fence_entities")) {
    db.exec("ALTER TABLE source_profiles ADD COLUMN code_fence_entities TEXT");
  }
  if (!profileColumns.has("nav_section_id")) {
    db.exec("ALTER TABLE source_profiles ADD COLUMN nav_section_id TEXT");
  }
  if (!profileColumns.has("nav_position")) {
    db.exec("ALTER TABLE source_profiles ADD COLUMN nav_position INTEGER");
  }
  if (!profileColumns.has("nav_label")) {
    db.exec("ALTER TABLE source_profiles ADD COLUMN nav_label TEXT");
  }
  if (!profileColumns.has("is_nav_landing")) {
    db.exec("ALTER TABLE source_profiles ADD COLUMN is_nav_landing INTEGER");
  }
  if (!profileColumns.has("nav_origin")) {
    db.exec("ALTER TABLE source_profiles ADD COLUMN nav_origin TEXT");
  }
  if (!profileColumns.has("nav_provenance")) {
    db.exec("ALTER TABLE source_profiles ADD COLUMN nav_provenance TEXT");
  }
}

export function closeDb(db: Db): void {
  db.close();
}
