import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, closeDb } from "../store/db.js";
import { upsertChunk } from "../store/chunks.js";
import { upsertAnchor } from "../store/anchors.js";
import { suggestLinks } from "./suggest.js";
import type { DocChunk } from "../types/chunk.js";
import type { Card } from "../types/card.js";

function withDb<T>(fn: (db: ReturnType<typeof openDb>) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "dl-suggest-"));
  const db = openDb(join(dir, "test.db"));
  try {
    return fn(db);
  } finally {
    closeDb(db);
  }
}

function mkChunk(over: Partial<DocChunk>): DocChunk {
  return {
    stable_key: "sk_x",
    version_id: "v_x",
    source_path: "docs/x.md",
    doc_id: "d_x",
    heading_path: ["X"],
    heading_level: 1,
    chunk_index: 1,
    chunk_count: 1,
    title: "X",
    body: "body",
    token_count: 50,
    chunk_content_hash: "h",
    start_line: 0,
    end_line: 1,
    status: "current",
    source_content_hash: "sh",
    indexed_at: "now",
    scope: { layer: "project", project: "fundops", source: { frontmatter: true } },
    ...over,
  };
}

function mkCard(over: Partial<Card> = {}): Card {
  return {
    id: "C001",
    type: "constraint",
    title: "t",
    body: "",
    authority: "accepted",
    scope: { layer: "project", project: "fundops", source: { frontmatter: true } },
    symbol_anchors: [],
    file_anchors: [],
    links: [],
    token_count: 0,
    freshness_state: "verified",
    freshness_reason: "no_links",
    author_review_state: "unreviewed",
    source_path: "x.md",
    source_hash: "h",
    updated_at: "now",
    ...over,
  };
}

describe("inline link suggester (D40, ADR-0008)", () => {
  it("ranks chunks by anchor overlap first, then scope match", () => {
    withDb((db) => {
      const c1 = mkChunk({ stable_key: "sk1", version_id: "v1", source_path: "a.md" });
      const c2 = mkChunk({
        stable_key: "sk2",
        version_id: "v2",
        source_path: "b.md",
        scope: { layer: "module", project: "fundops", module: "fundops/ledger", source: { frontmatter: true } },
      });
      const c3 = mkChunk({
        stable_key: "sk3",
        version_id: "v3",
        source_path: "c.md",
        scope: { layer: "company", company: "acme", source: { frontmatter: true } },
      });
      upsertChunk(db, c1);
      upsertChunk(db, c2);
      upsertChunk(db, c3);
      // c1 has the matching symbol anchor; c2 doesn't.
      upsertAnchor(db, {
        chunk_version_id: "v1",
        kind: "symbol",
        value: "LedgerEntry.post",
        confidence: "high",
        source: "frontmatter",
      });

      const card = mkCard({
        id: "S001",
        type: "symbol_note",
        symbol_anchors: ["LedgerEntry.post"],
        scope: { layer: "module", project: "fundops", module: "fundops/ledger", source: { frontmatter: true } },
      });
      const suggestions = suggestLinks(db, card, 5);
      // c1 should rank first (anchor + project match), then c2 (module match), then c3 (lowest).
      expect(suggestions[0]!.chunk.version_id).toBe("v1");
      expect(suggestions.length).toBeLessThanOrEqual(5);
    });
  });

  it("returns empty when there are no current chunks", () => {
    withDb((db) => {
      const card = mkCard();
      const s = suggestLinks(db, card, 5);
      expect(s).toEqual([]);
    });
  });

  it("respects the topN cap", () => {
    withDb((db) => {
      for (let i = 0; i < 10; i++) {
        upsertChunk(db, mkChunk({ stable_key: `sk${i}`, version_id: `v${i}`, source_path: `p${i}.md` }));
      }
      const card = mkCard();
      const s = suggestLinks(db, card, 3);
      expect(s).toHaveLength(3);
    });
  });

  it("excludes tombstoned chunks", () => {
    withDb((db) => {
      upsertChunk(db, mkChunk({ stable_key: "sk1", version_id: "v1", status: "tombstoned" }));
      upsertChunk(db, mkChunk({ stable_key: "sk2", version_id: "v2", status: "current" }));
      const card = mkCard();
      const s = suggestLinks(db, card, 5);
      expect(s.map((x) => x.chunk.version_id)).toEqual(["v2"]);
    });
  });
});
