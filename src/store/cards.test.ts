import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, closeDb } from "./db.js";
import {
  upsertCard,
  getCardById,
  listCards,
  deleteCard,
  upsertCardAnchor,
  getAnchorsForCard,
  upsertCardLink,
  listLinksForCard,
  listLinksByStableKey,
  deleteLinksForCard,
  getCardCountByType,
} from "./cards.js";
import type { Card } from "../types/card.js";

const baseScope = {
  layer: "project" as const,
  project: "fundops",
  source: { frontmatter: true },
};

function mkCard(overrides: Partial<Card> = {}): Card {
  const card = {
    id: "C001",
    type: "constraint",
    title: "Money math goes through Money",
    body: "All monetary amounts pass through `Money`. Never raw floats.",
    authority: "accepted",
    scope: baseScope,
    symbol_anchors: [],
    file_anchors: [],
    links: [],
    token_count: 0,
    freshness_state: "verified",
    freshness_reason: "no_links",
    author_review_state: "unreviewed",
    source_path: ".contexttrail/cards/c001-money-math.md",
    source_hash: "abc123",
    updated_at: "2026-05-06T00:00:00Z",
    ...overrides,
  } as Card;
  if (card.type === "evidence") {
    return {
      ...card,
      command: (card as { command?: string }).command ?? "echo hi",
      covers: (card as { covers?: string[] }).covers ?? [],
    };
  }
  return card;
}

function withDb<T>(fn: (db: ReturnType<typeof openDb>) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "dl-cards-"));
  const db = openDb(join(dir, "test.db"));
  try {
    return fn(db);
  } finally {
    closeDb(db);
  }
}

describe("card storage", () => {
  it("upserts and retrieves a card by id", () => {
    withDb((db) => {
      const c = mkCard();
      upsertCard(db, c);
      const got = getCardById(db, c.id);
      expect(got).not.toBeNull();
      expect(got!.id).toBe("C001");
      expect(got!.type).toBe("constraint");
      expect(got!.title).toBe(c.title);
      expect(got!.scope.project).toBe("fundops");
      expect(got!.freshness_state).toBe("verified");
      expect(got!.author_review_state).toBe("unreviewed");
    });
  });

  it("returns null for missing card id", () => {
    withDb((db) => {
      expect(getCardById(db, "C999")).toBeNull();
    });
  });

  it("upsert is idempotent and overwrites prior values", () => {
    withDb((db) => {
      const c = mkCard({ title: "first" });
      upsertCard(db, c);
      upsertCard(db, { ...c, title: "second" });
      expect(getCardById(db, c.id)!.title).toBe("second");
    });
  });

  it("lists cards filtered by type", () => {
    withDb((db) => {
      upsertCard(db, mkCard({ id: "C001", type: "constraint" }));
      upsertCard(db, mkCard({ id: "S001", type: "symbol_note" }));
      upsertCard(db, mkCard({ id: "E001", type: "evidence" }));
      const constraints = listCards(db, { type: "constraint" });
      expect(constraints).toHaveLength(1);
      expect(constraints[0]!.id).toBe("C001");
      expect(listCards(db).map((c) => c.id).sort()).toEqual([
        "C001",
        "E001",
        "S001",
      ]);
    });
  });

  it("counts by type", () => {
    withDb((db) => {
      upsertCard(db, mkCard({ id: "C001", type: "constraint" }));
      upsertCard(db, mkCard({ id: "C002", type: "constraint" }));
      upsertCard(db, mkCard({ id: "S001", type: "symbol_note" }));
      const counts = getCardCountByType(db);
      expect(counts.constraint).toBe(2);
      expect(counts.symbol_note).toBe(1);
      expect(counts.evidence).toBe(0);
    });
  });

  it("upserts and retrieves card anchors (symbol kind)", () => {
    withDb((db) => {
      const c = mkCard({ id: "S001", type: "symbol_note" });
      upsertCard(db, c);
      upsertCardAnchor(db, { card_id: "S001", kind: "symbol", value: "LedgerEntry.post" });
      upsertCardAnchor(db, { card_id: "S001", kind: "symbol", value: "LedgerEntry" });
      const anchors = getAnchorsForCard(db, "S001");
      const symbols = anchors.filter((a) => a.kind === "symbol").map((a) => a.value).sort();
      expect(symbols).toEqual(["LedgerEntry", "LedgerEntry.post"]);
    });
  });

  it("upserts links with version_pin and lists them by card and stable_key", () => {
    withDb((db) => {
      upsertCard(db, mkCard({ id: "C001" }));
      upsertCardLink(db, {
        card_id: "C001",
        chunk_stable_key: "sk_aaa",
        version_pin: "v1",
        content_hash_pin: "h1",
        link_type: "evidences",
        linked_at: "2026-05-06T00:00:00Z",
      });
      const linksByCard = listLinksForCard(db, "C001");
      expect(linksByCard).toHaveLength(1);
      expect(linksByCard[0]!.version_pin).toBe("v1");

      const linksBySk = listLinksByStableKey(db, "sk_aaa");
      expect(linksBySk).toHaveLength(1);
      expect(linksBySk[0]!.card_id).toBe("C001");
    });
  });

  it("deletes a card and cascades anchors and links", () => {
    withDb((db) => {
      upsertCard(db, mkCard({ id: "C001" }));
      upsertCardAnchor(db, { card_id: "C001", kind: "symbol", value: "X" });
      upsertCardLink(db, {
        card_id: "C001",
        chunk_stable_key: "sk_a",
        version_pin: "v",
        content_hash_pin: "h",
        link_type: "evidences",
        linked_at: "now",
      });
      deleteLinksForCard(db, "C001");
      deleteCard(db, "C001");
      expect(getCardById(db, "C001")).toBeNull();
      expect(getAnchorsForCard(db, "C001")).toHaveLength(0);
      expect(listLinksForCard(db, "C001")).toHaveLength(0);
    });
  });
});
