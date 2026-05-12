import type { Db } from "./db.js";
import type {
  Card,
  CardAuthority,
  CardLink,
  CardSymbolAnchor,
  CardType,
  AuthorReviewState,
  FreshnessState,
  FreshnessReason,
} from "../types/card.js";
import { encodeChunkScope } from "./scope-codec.js";
import {
  rowToCard,
  withCardRelations,
  type StoredCardRow,
} from "./storage-mappers.js";
import {
  deleteCardAnchorsInSubstrate,
  deleteCardInSubstrate,
  deleteCardLinksInSubstrate,
  setCardAuthorReviewInSubstrate,
  setCardFreshnessInSubstrate,
  upsertCardAnchorToSubstrate,
  upsertCardLinkToSubstrate,
  upsertCardToSubstrate,
} from "./substrate-sync.js";

const FTS_DELETE_SQL =
  "DELETE FROM cards_fts WHERE rowid = (SELECT rowid FROM cards WHERE id=?)";
const FTS_INSERT_SQL =
  "INSERT INTO cards_fts(rowid, title, body) VALUES ((SELECT rowid FROM cards WHERE id=?), ?, ?)";

import { tokenize as tokenizeForIndex } from "../retrieve/tokenize.js";

function ftsField(text: string): string {
  return tokenizeForIndex(text, { stem: true, splitCodeIdentifiers: true }).join(" ");
}

export function upsertCard(db: Db, c: Card & { token_count?: number }): void {
  const provenance = c.provenance ?? "human_authored";
  const authoredBy = c.authored_by ?? "unknown";
  db.prepare(FTS_DELETE_SQL).run(c.id);
  const stmt = db.prepare(`
    INSERT INTO cards (
      id, type, title, body, authority, scope_layer, scope_data,
      provenance, authored_by, command, covers, source_path, source_hash,
      freshness_state, freshness_reason, author_review_state, token_count, updated_at
    ) VALUES (
      @id, @type, @title, @body, @authority, @scope_layer, @scope_data,
      @provenance, @authored_by, @command, @covers, @source_path, @source_hash,
      @freshness_state, @freshness_reason, @author_review_state, @token_count, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      type=excluded.type,
      title=excluded.title,
      body=excluded.body,
      authority=excluded.authority,
      scope_layer=excluded.scope_layer,
      scope_data=excluded.scope_data,
      provenance=excluded.provenance,
      authored_by=excluded.authored_by,
      command=excluded.command,
      covers=excluded.covers,
      source_path=excluded.source_path,
      source_hash=excluded.source_hash,
      freshness_state=excluded.freshness_state,
      freshness_reason=excluded.freshness_reason,
      author_review_state=excluded.author_review_state,
      token_count=excluded.token_count,
      updated_at=excluded.updated_at
  `);
  stmt.run({
    id: c.id,
    type: c.type,
    title: c.title,
    body: c.body,
    authority: c.authority,
    scope_layer: c.scope.layer ?? null,
    scope_data: encodeChunkScope(c.scope),
    provenance,
    authored_by: authoredBy,
    command: c.type === "evidence" ? c.command : null,
    covers: c.type === "evidence" ? JSON.stringify(c.covers) : null,
    source_path: c.source_path,
    source_hash: c.source_hash,
    freshness_state: c.freshness_state,
    freshness_reason: c.freshness_reason,
    author_review_state: c.author_review_state,
    token_count: c.token_count ?? 0,
    updated_at: c.updated_at,
  } as Record<string, unknown>);
  if (c.authority !== "deprecated") {
    db.prepare(FTS_INSERT_SQL).run(c.id, ftsField(c.title), ftsField(c.body));
  }
  upsertCardToSubstrate(db, {
    ...c,
    provenance,
    authored_by: authoredBy,
    token_count: c.token_count ?? 0,
  } as Card);
}

export function getCardById(db: Db, id: string): Card | null {
  const row = db.prepare("SELECT * FROM cards WHERE id = ?").get(id) as
    | StoredCardRow
    | undefined;
  if (!row) return null;
  const card = rowToCard(row);
  return withCardRelations(card, getAnchorsForCard(db, id), listLinksForCard(db, id));
}

export type ListCardsFilter = {
  type?: CardType;
  authority?: CardAuthority;
  freshness_state?: FreshnessState;
};

export function listCards(db: Db, filter: ListCardsFilter = {}): Card[] {
  const where: string[] = [];
  const params: Record<string, string> = {};
  if (filter.type) {
    where.push("type = @type");
    params.type = filter.type;
  }
  if (filter.authority) {
    where.push("authority = @authority");
    params.authority = filter.authority;
  }
  if (filter.freshness_state) {
    where.push("freshness_state = @freshness_state");
    params.freshness_state = filter.freshness_state;
  }
  const sql =
    "SELECT * FROM cards" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY id";
  const rows = db.prepare(sql).all(params) as StoredCardRow[];
  return rows.map((r) => {
    const card = rowToCard(r);
    return withCardRelations(
      card,
      getAnchorsForCard(db, card.id),
      listLinksForCard(db, card.id),
    );
  });
}

export function deleteCard(db: Db, id: string): void {
  db.prepare(FTS_DELETE_SQL).run(id);
  db.prepare("DELETE FROM card_anchors WHERE card_id = ?").run(id);
  db.prepare("DELETE FROM card_links WHERE card_id = ?").run(id);
  db.prepare("DELETE FROM cards WHERE id = ?").run(id);
  deleteCardInSubstrate(db, id);
}

export function getCardCountByType(db: Db): Record<CardType, number> {
  const counts: Record<CardType, number> = {
    constraint: 0,
    symbol_note: 0,
    evidence: 0,
  };
  const rows = db
    .prepare("SELECT type, COUNT(*) AS n FROM cards GROUP BY type")
    .all() as { type: string; n: number }[];
  for (const r of rows) {
    if (r.type === "constraint" || r.type === "symbol_note" || r.type === "evidence") {
      counts[r.type] = r.n;
    }
  }
  return counts;
}

// ---- card_anchors ---------------------------------------------------------

export type CardAnchor = { card_id: string; kind: "symbol" | "file" | "route"; value: string };

export function upsertCardAnchor(db: Db, a: CardAnchor): void {
  db
    .prepare(
      "INSERT OR IGNORE INTO card_anchors (card_id, kind, value) VALUES (?, ?, ?)",
    )
    .run(a.card_id, a.kind, a.value);
  upsertCardAnchorToSubstrate(db, a);
}

export function deleteAnchorsForCard(db: Db, card_id: string): void {
  db.prepare("DELETE FROM card_anchors WHERE card_id = ?").run(card_id);
  deleteCardAnchorsInSubstrate(db, card_id);
}

export function getAnchorsForCard(db: Db, card_id: string): CardAnchor[] {
  return db
    .prepare("SELECT card_id, kind, value FROM card_anchors WHERE card_id = ?")
    .all(card_id) as CardAnchor[];
}

/** Cards whose `symbol` anchors include any of the requested values (D39 strict equality). */
export function findCardsBySymbolAnchors(
  db: Db,
  symbols: string[],
): { card_id: string; symbol: string }[] {
  if (symbols.length === 0) return [];
  const placeholders = symbols.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT card_id, value AS symbol FROM card_anchors
       WHERE kind = 'symbol' AND value IN (${placeholders})`,
    )
    .all(...symbols) as { card_id: string; symbol: string }[];
}

// ---- card_links -----------------------------------------------------------

export function upsertCardLink(db: Db, link: CardLink): void {
  db
    .prepare(
      `INSERT INTO card_links
         (card_id, chunk_stable_key, version_pin, content_hash_pin, link_type, linked_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(card_id, chunk_stable_key, link_type) DO UPDATE SET
         version_pin=excluded.version_pin,
         content_hash_pin=excluded.content_hash_pin,
         linked_at=excluded.linked_at`,
    )
    .run(
      link.card_id,
      link.chunk_stable_key,
      link.version_pin,
      link.content_hash_pin,
      link.link_type,
      link.linked_at,
    );
  upsertCardLinkToSubstrate(db, link);
}

export function deleteCardLink(
  db: Db,
  card_id: string,
  chunk_stable_key: string,
  link_type: CardLink["link_type"],
): void {
  db
    .prepare(
      "DELETE FROM card_links WHERE card_id = ? AND chunk_stable_key = ? AND link_type = ?",
    )
    .run(card_id, chunk_stable_key, link_type);
}

export function deleteLinksForCard(db: Db, card_id: string): void {
  db.prepare("DELETE FROM card_links WHERE card_id = ?").run(card_id);
  deleteCardLinksInSubstrate(db, card_id);
}

export function listLinksForCard(db: Db, card_id: string): CardLink[] {
  return db
    .prepare(
      `SELECT card_id, chunk_stable_key, version_pin, content_hash_pin, link_type, linked_at
       FROM card_links WHERE card_id = ?`,
    )
    .all(card_id) as CardLink[];
}

export function listLinksByStableKey(
  db: Db,
  chunk_stable_key: string,
): CardLink[] {
  return db
    .prepare(
      `SELECT card_id, chunk_stable_key, version_pin, content_hash_pin, link_type, linked_at
       FROM card_links WHERE chunk_stable_key = ?`,
    )
    .all(chunk_stable_key) as CardLink[];
}

export function listAllLinks(db: Db): CardLink[] {
  return db
    .prepare(
      `SELECT card_id, chunk_stable_key, version_pin, content_hash_pin, link_type, linked_at
       FROM card_links`,
    )
    .all() as CardLink[];
}

export function updateCardFreshness(
  db: Db,
  card_id: string,
  freshness_state: FreshnessState,
  freshness_reason: FreshnessReason,
): void {
  db
    .prepare(
      "UPDATE cards SET freshness_state = ?, freshness_reason = ? WHERE id = ?",
    )
    .run(freshness_state, freshness_reason, card_id);
  setCardFreshnessInSubstrate(db, card_id, freshness_state, freshness_reason);
}

export function updateCardAuthorReview(
  db: Db,
  card_id: string,
  author_review_state: AuthorReviewState,
): number {
  const result = db
    .prepare("UPDATE cards SET author_review_state = ? WHERE id = ?")
    .run(author_review_state, card_id);
  if (result.changes > 0) {
    setCardAuthorReviewInSubstrate(db, card_id, author_review_state);
  }
  return result.changes;
}

// Note: CardSymbolAnchor type is exported from types/card.ts; this helper
// preserves the existing import shape if other modules need it.
export type { CardSymbolAnchor };
