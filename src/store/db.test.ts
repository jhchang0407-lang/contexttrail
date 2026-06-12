import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, closeDb } from "./db.js";
import { upsertChunk, getChunkByVersionId, getChunksByStableKey } from "./chunks.js";
import type { DocChunk } from "../types/chunk.js";

const makeChunk = (overrides: Partial<DocChunk> = {}): DocChunk => ({
  stable_key: "stable-1",
  version_id: "ver-1",
  source_path: "docs/x.md",
  doc_id: "doc-1",
  heading_path: ["A", "B"],
  heading_level: 2,
  chunk_index: 1,
  chunk_count: 1,
  title: "B",
  body: "body content",
  token_count: 5,
  chunk_content_hash: "ch1",
  source_content_hash: "src1",
  start_line: 1,
  end_line: 4,
  heading_slug: "b",
  status: "current",
  indexed_at: "2026-05-06T00:00:00Z",
  scope: { layer: "project", project: "p", source: {} },
  ...overrides,
});

describe("storage — schema and round-trip", () => {
  it("opens db with WAL pragma and round-trips a chunk", () => {
    const dir = mkdtempSync(join(tmpdir(), "contexttrail-store-"));
    const dbPath = join(dir, "contexttrail.db");
    try {
      const db = openDb(dbPath);
      const journal = db
        .prepare("PRAGMA journal_mode")
        .pluck()
        .get() as string;
      expect(journal.toLowerCase()).toBe("wal");

      const c = makeChunk();
      upsertChunk(db, c);
      const got = getChunkByVersionId(db, c.version_id);
      expect(got).toMatchObject({
        version_id: c.version_id,
        stable_key: c.stable_key,
        title: "B",
        heading_path: ["A", "B"],
        token_count: 5,
        status: "current",
      });
      expect(got!.scope.layer).toBe("project");
      closeDb(db);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("nullable embedding column exists from day 1 (week-5 ready)", () => {
    const dir = mkdtempSync(join(tmpdir(), "contexttrail-store-"));
    try {
      const db = openDb(join(dir, "contexttrail.db"));
      const cols = db
        .prepare("PRAGMA table_info(doc_chunks)")
        .all() as { name: string; notnull: number }[];
      const emb = cols.find((c) => c.name === "embedding");
      expect(emb).toBeDefined();
      expect(emb!.notnull).toBe(0);
      const model = cols.find((c) => c.name === "embedding_model");
      expect(model).toBeDefined();
      closeDb(db);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("explains how to recover when the cache db file is corrupt", () => {
    const dir = mkdtempSync(join(tmpdir(), "contexttrail-store-"));
    const dbPath = join(dir, "contexttrail.db");
    try {
      writeFileSync(dbPath, "garbage bytes that are definitely not a sqlite database header");
      let caught: unknown;
      try {
        openDb(dbPath);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      const error = caught as Error;
      expect(error.message).toContain(`ContextTrail cache at ${dbPath} is corrupted.`);
      expect(error.message).toContain("Delete the .contexttrail/cache directory");
      expect(error.message).toContain("re-run `contexttrail import`");
      // Original SqliteError stays attached for debugging.
      expect(error.cause).toBeInstanceOf(Error);
      expect(String((error.cause as Error).message)).toMatch(/file is not a database/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("supports multiple versions per stable_key (current + tombstoned)", () => {
    const dir = mkdtempSync(join(tmpdir(), "contexttrail-store-"));
    try {
      const db = openDb(join(dir, "contexttrail.db"));
      upsertChunk(db, makeChunk({ version_id: "v1", status: "tombstoned" }));
      upsertChunk(db, makeChunk({ version_id: "v2", status: "current" }));
      const all = getChunksByStableKey(db, "stable-1");
      expect(all).toHaveLength(2);
      const statuses = all.map((c) => c.status).sort();
      expect(statuses).toEqual(["current", "tombstoned"]);
      closeDb(db);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
