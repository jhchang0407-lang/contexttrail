import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config/load.js";
import { closeDb, openDb } from "../store/db.js";
import {
  deleteAnchorsForCard,
  deleteLinksForCard,
  getCardById,
  upsertCard,
  upsertCardAnchor,
  upsertCardLink,
} from "../store/cards.js";
import { materializeAllFreshness } from "./freshness.js";
import { parseCard } from "./loader.js";

export type CardImportSummary = {
  cards_imported: number;
  cards_skipped: number;
  warnings: string[];
};

/**
 * Accepted Cards live as repo-local markdown files. Importing them is the
 * lifecycle seam that updates cached Card rows, anchors, declared links, and
 * mechanically materialized freshness while preserving manual author review.
 */
export function importAcceptedCards(cwd: string): CardImportSummary {
  const cfg = loadConfig(cwd);
  const cardsDir = join(cwd, cfg.cards.source_dir);
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  const warnings: string[] = [];
  let imported = 0;
  let skipped = 0;
  try {
    const files = walkMarkdown(cardsDir);
    for (const f of files) {
      try {
        const src = readFileSync(f, "utf8");
        const relPath = f.startsWith(cwd + "/") ? f.slice(cwd.length + 1) : f;
        const card = parseCard(src, relPath);
        const existing = getCardById(db, card.id);
        const cardToPersist = existing
          ? { ...card, author_review_state: existing.author_review_state }
          : card;
        upsertCard(db, cardToPersist);
        deleteAnchorsForCard(db, cardToPersist.id);
        for (const sym of cardToPersist.symbol_anchors) {
          upsertCardAnchor(db, { card_id: cardToPersist.id, kind: "symbol", value: sym });
        }
        for (const file of cardToPersist.file_anchors) {
          upsertCardAnchor(db, { card_id: cardToPersist.id, kind: "file", value: file });
        }
        for (const route of cardToPersist.route_anchors) {
          upsertCardAnchor(db, { card_id: cardToPersist.id, kind: "route", value: route });
        }
        deleteLinksForCard(db, cardToPersist.id);
        for (const link of cardToPersist.links) {
          upsertCardLink(db, link);
        }
        imported++;
      } catch (err) {
        warnings.push(
          `${f}: ${err instanceof Error ? err.message : String(err)}`,
        );
        skipped++;
      }
    }
    materializeAllFreshness(db);
  } finally {
    closeDb(db);
  }
  return { cards_imported: imported, cards_skipped: skipped, warnings };
}

function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkMarkdown(full));
    } else if (e.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}
