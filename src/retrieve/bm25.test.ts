import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, closeDb } from "../store/db.js";
import { upsertChunk } from "../store/chunks.js";
import { bm25Norm } from "./bm25.js";
import type { DocChunk } from "../types/chunk.js";

const makeChunk = (overrides: Partial<DocChunk> = {}): DocChunk => ({
  stable_key: "sk",
  version_id: "v",
  source_path: "docs/x.md",
  doc_id: "doc",
  heading_path: ["X"],
  heading_level: 1,
  chunk_index: 1,
  chunk_count: 1,
  title: "X",
  body: "",
  token_count: 5,
  chunk_content_hash: "ch",
  source_content_hash: "src",
  start_line: 1,
  end_line: 1,
  status: "current",
  indexed_at: "2026-05-06T00:00:00Z",
  scope: { layer: "project", source: {} },
  ...overrides,
});

describe("BM25 — FTS5 + per-query normalization", () => {
  it("returns scores in [0,1] with at least one chunk normalized to 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "contexttrail-bm25-"));
    try {
      const db = openDb(join(dir, "contexttrail.db"));
      upsertChunk(
        db,
        makeChunk({
          version_id: "v1",
          title: "Refunds",
          heading_path: ["Refunds"],
          body: "refund refund refund refund processing",
        }),
      );
      upsertChunk(
        db,
        makeChunk({
          version_id: "v2",
          title: "Auth",
          heading_path: ["Authentication"],
          body: "login login session token",
        }),
      );
      upsertChunk(
        db,
        makeChunk({
          version_id: "v3",
          title: "Misc",
          heading_path: ["Misc"],
          body: "general unrelated text here",
        }),
      );

      const scores = bm25Norm(db, "refund processing");
      expect(scores.get("v1")).toBeCloseTo(1.0);
      expect((scores.get("v2") ?? 0)).toBe(0);
      // Per-query normalization: max raw → 1.0
      for (const v of scores.values()) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      closeDb(db);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("empty query returns empty map", () => {
    const dir = mkdtempSync(join(tmpdir(), "contexttrail-bm25-"));
    try {
      const db = openDb(join(dir, "contexttrail.db"));
      upsertChunk(db, makeChunk({ version_id: "v1", body: "anything" }));
      expect(bm25Norm(db, "").size).toBe(0);
      closeDb(db);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
