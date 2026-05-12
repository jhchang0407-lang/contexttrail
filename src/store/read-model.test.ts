import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, closeDb, type Db } from "./db.js";
import { upsertChunk } from "./chunks.js";
import { upsertAnchor } from "./anchors.js";
import { lookupCodeAnchorContributorsCanonical } from "./read-model.js";
import { migrateFlatToSubstrate } from "./migrate.js";
import type { CodeAnchor, DocChunk } from "../types/chunk.js";

function chunk(version_id: string, module: string): DocChunk {
  return {
    stable_key: `stable-${version_id}`,
    version_id,
    source_path: `docs/${version_id}.md`,
    doc_id: `doc-${version_id}`,
    heading_path: ["Synthetic"],
    heading_level: 1,
    chunk_index: 1,
    chunk_count: 1,
    title: "Synthetic",
    body: "body",
    token_count: 10,
    chunk_content_hash: `hash-${version_id}`,
    source_content_hash: `source-${version_id}`,
    start_line: 1,
    end_line: 1,
    status: "current",
    indexed_at: "2026-05-08T00:00:00Z",
    scope: { layer: "module", module, source: {} },
  };
}

function anchor(chunk_version_id: string, value: string): CodeAnchor {
  return {
    chunk_version_id,
    kind: "symbol",
    value,
    confidence: "high",
    source: "frontmatter",
  };
}

function withDb<T>(fn: (db: Db) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "contexttrail-read-model-"));
  try {
    const db = openDb(join(dir, "contexttrail.db"));
    try {
      return fn(db);
    } finally {
      closeDb(db);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function seedAnchorFixtures(db: Db): void {
  upsertChunk(db, chunk("jwt", "auth"));
  upsertAnchor(db, anchor("jwt", "JWTAuthMiddleware"));
  upsertChunk(db, chunk("router", "router"));
  upsertAnchor(db, anchor("router", "RouterAdapter"));
  upsertChunk(db, chunk("absent", "absent"));
  upsertAnchor(db, anchor("absent", "Scheduler_1_2_NotPresent"));
}

describe("lookupCodeAnchorContributorsCanonical", () => {
  it("matches exact symbols, case differences, and single-token form variants on flat reads", () => {
    withDb((db) => {
      seedAnchorFixtures(db);

      expect(
        lookupCodeAnchorContributorsCanonical(db, {
          kind: "symbol",
          value: "JWTAuthMiddleware",
        }).map((c) => [c.object_id, c.confidence]),
      ).toEqual([["jwt", "high"]]);

      expect(
        lookupCodeAnchorContributorsCanonical(db, {
          kind: "symbol",
          value: "routeradapter",
        }).map((c) => [c.object_id, c.confidence]),
      ).toEqual([["router", "low"]]);

      expect(
        lookupCodeAnchorContributorsCanonical(db, {
          kind: "symbol",
          value: "JWT",
        }).map((c) => [c.object_id, c.confidence]),
      ).toEqual([["jwt", "low"]]);

      expect(
        lookupCodeAnchorContributorsCanonical(db, {
          kind: "symbol",
          value: "Scheduler_1_2",
        }),
      ).toEqual([]);
    });
  });

  it("uses the same fuzzy anchor semantics after substrate migration", () => {
    withDb((db) => {
      seedAnchorFixtures(db);
      migrateFlatToSubstrate(db, { force: true });

      expect(
        lookupCodeAnchorContributorsCanonical(db, {
          kind: "symbol",
          value: "JWT",
        }).map((c) => [c.object_id, c.confidence]),
      ).toEqual([["jwt", "low"]]);

      expect(
        lookupCodeAnchorContributorsCanonical(db, {
          kind: "symbol",
          value: "Scheduler_1_2",
        }),
      ).toEqual([]);
    });
  });
});
