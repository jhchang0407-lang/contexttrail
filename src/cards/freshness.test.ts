import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, closeDb } from "../store/db.js";
import { upsertChunk, tombstoneChunk } from "../store/chunks.js";
import {
  upsertCard,
  upsertCardLink,
  getCardById,
  listCards,
} from "../store/cards.js";
import {
  materializeFreshness,
  materializeAllFreshness,
} from "./freshness.js";
import type { Card } from "../types/card.js";
import type { DocChunk } from "../types/chunk.js";

function withDb<T>(fn: (db: ReturnType<typeof openDb>) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "dl-fresh-"));
  const db = openDb(join(dir, "test.db"));
  try {
    return fn(db);
  } finally {
    closeDb(db);
  }
}

function mkChunk(over: Partial<DocChunk>): DocChunk {
  return {
    stable_key: "sk",
    version_id: "v1",
    source_path: "x.md",
    doc_id: "d",
    heading_path: ["X"],
    heading_level: 1,
    chunk_index: 1,
    chunk_count: 1,
    title: "X",
    body: "b",
    token_count: 10,
    chunk_content_hash: "h1",
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

describe("freshness materializer (D41)", () => {
  it("a card with no links remains 'verified' / 'no_links'", () => {
    withDb((db) => {
      upsertCard(db, mkCard({ id: "C001" }));
      const r = materializeFreshness(db, "C001");
      expect(r.state).toBe("verified");
      expect(r.reason).toBe("no_links");
      const c = getCardById(db, "C001");
      expect(c!.freshness_state).toBe("verified");
      expect(c!.freshness_reason).toBe("no_links");
    });
  });

  it("a card with all links pinned to current version_ids is 'verified' / 'all_links_current'", () => {
    withDb((db) => {
      upsertChunk(db, mkChunk({ stable_key: "sk1", version_id: "v1" }));
      upsertCard(db, mkCard({ id: "C002" }));
      upsertCardLink(db, {
        card_id: "C002",
        chunk_stable_key: "sk1",
        version_pin: "v1",
        content_hash_pin: "h1",
        link_type: "evidences",
        linked_at: "now",
      });
      const r = materializeFreshness(db, "C002");
      expect(r.state).toBe("verified");
      expect(r.reason).toBe("all_links_current");
    });
  });

  it("flips to 'needs_review' / 'version_drift' when a linked chunk rotates version_id", () => {
    withDb((db) => {
      // Initial chunk at version v1.
      upsertChunk(db, mkChunk({ stable_key: "sk1", version_id: "v1" }));
      upsertCard(db, mkCard({ id: "C003" }));
      upsertCardLink(db, {
        card_id: "C003",
        chunk_stable_key: "sk1",
        version_pin: "v1",
        content_hash_pin: "h1",
        link_type: "evidences",
        linked_at: "now",
      });
      // Now the source rotates: a new version v2 of the same stable_key.
      upsertChunk(db, mkChunk({ stable_key: "sk1", version_id: "v2", chunk_content_hash: "h2" }));
      // Tombstone the old version (mirrors what the importer would do).
      tombstoneChunk(db, "v1");
      const r = materializeFreshness(db, "C003");
      expect(r.state).toBe("needs_review");
      expect(r.reason).toBe("version_drift");
    });
  });

  it("flips to 'needs_review' / 'tombstoned_link' when the linked chunk has no current successor", () => {
    withDb((db) => {
      upsertChunk(db, mkChunk({ stable_key: "sk1", version_id: "v1" }));
      upsertCard(db, mkCard({ id: "C004" }));
      upsertCardLink(db, {
        card_id: "C004",
        chunk_stable_key: "sk1",
        version_pin: "v1",
        content_hash_pin: "h1",
        link_type: "evidences",
        linked_at: "now",
      });
      tombstoneChunk(db, "v1");
      const r = materializeFreshness(db, "C004");
      expect(r.state).toBe("needs_review");
      expect(r.reason).toBe("tombstoned_link");
    });
  });

  it("re-verifies (current again) when chunk is re-imported back to the pinned version_id", () => {
    withDb((db) => {
      upsertChunk(db, mkChunk({ stable_key: "sk1", version_id: "v1" }));
      upsertCard(db, mkCard({ id: "C005" }));
      upsertCardLink(db, {
        card_id: "C005",
        chunk_stable_key: "sk1",
        version_pin: "v1",
        content_hash_pin: "h1",
        link_type: "evidences",
        linked_at: "now",
      });
      // First, drift it.
      upsertChunk(db, mkChunk({ stable_key: "sk1", version_id: "v2" }));
      tombstoneChunk(db, "v1");
      const drifted = materializeFreshness(db, "C005");
      expect(drifted.state).toBe("needs_review");
      // Now re-import the original (e.g., user reverted).
      tombstoneChunk(db, "v2");
      upsertChunk(db, mkChunk({ stable_key: "sk1", version_id: "v1" }));
      const r = materializeFreshness(db, "C005");
      expect(r.state).toBe("verified");
      expect(r.reason).toBe("all_links_current");
    });
  });

  it("materializeAllFreshness updates every card", () => {
    withDb((db) => {
      upsertChunk(db, mkChunk({ stable_key: "sk1", version_id: "v1" }));
      upsertCard(db, mkCard({ id: "C001" })); // no links → verified
      upsertCard(db, mkCard({ id: "C002" })); // links current
      upsertCardLink(db, {
        card_id: "C002",
        chunk_stable_key: "sk1",
        version_pin: "v1",
        content_hash_pin: "h1",
        link_type: "evidences",
        linked_at: "now",
      });
      upsertCard(db, mkCard({ id: "C003" })); // links to drifted chunk
      upsertCardLink(db, {
        card_id: "C003",
        chunk_stable_key: "sk1",
        version_pin: "vOLD",
        content_hash_pin: "hOLD",
        link_type: "evidences",
        linked_at: "now",
      });
      materializeAllFreshness(db);
      const cards = Object.fromEntries(
        listCards(db).map((c) => [c.id, c.freshness_state]),
      );
      expect(cards.C001).toBe("verified");
      expect(cards.C002).toBe("verified");
      expect(cards.C003).toBe("needs_review");
    });
  });

  it("preserves authored potentially_superseded in single-card materialization", () => {
    withDb((db) => {
      upsertChunk(db, mkChunk({ stable_key: "sk1", version_id: "v1" }));
      upsertCard(db, mkCard({
        id: "C006",
        freshness_state: "potentially_superseded",
        freshness_reason: "tombstoned_link",
      }));
      upsertCardLink(db, {
        card_id: "C006",
        chunk_stable_key: "sk1",
        version_pin: "v1",
        content_hash_pin: "h1",
        link_type: "evidences",
        linked_at: "now",
      });

      const r = materializeFreshness(db, "C006");

      expect(r).toEqual({ state: "potentially_superseded", reason: "tombstoned_link" });
      expect(getCardById(db, "C006")!.freshness_state).toBe("potentially_superseded");
    });
  });

  it("freshness_state is rebuildable: rerunning yields the same state", () => {
    withDb((db) => {
      upsertChunk(db, mkChunk({ stable_key: "sk1", version_id: "v1" }));
      upsertCard(db, mkCard({ id: "C001" }));
      upsertCardLink(db, {
        card_id: "C001",
        chunk_stable_key: "sk1",
        version_pin: "v_stale",
        content_hash_pin: "h",
        link_type: "evidences",
        linked_at: "now",
      });
      const r1 = materializeFreshness(db, "C001");
      const r2 = materializeFreshness(db, "C001");
      expect(r1).toEqual(r2);
    });
  });
});
