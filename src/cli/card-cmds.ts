import { join } from "node:path";
import {
  readFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { loadConfig } from "../config/load.js";
import { openDb, closeDb } from "../store/db.js";
import {
  upsertCardLink,
  deleteCardLink,
  listCards,
  getCardById,
  updateCardAuthorReview,
} from "../store/cards.js";
import { suggestLinks } from "../cards/suggest.js";
import { materializeAllFreshness } from "../cards/freshness.js";
import { nextCardIdentity, writeCardFile } from "../cards/materialize.js";
import type { Card, CardType, AuthorReviewState } from "../types/card.js";
import { getChunksByStableKey, getChunkByVersionId } from "../store/chunks.js";

/**
 * `contexttrail card add <type>` — scaffold a Card markdown file. By design this
 * does NOT shell out to $EDITOR (untestable side-effect); the caller is
 * expected to open the returned `path` in their editor manually. After
 * editing the file, `contexttrail card import` (or any `contexttrail context` invocation
 * whose pipeline materializes cards) picks up the change.
 */
export type CardAddResult = {
  id: string;
  path: string;
  template: string;
};

export function runCardAdd(cwd: string, type: CardType): CardAddResult {
  const cfg = loadConfig(cwd);
  const identity = nextCardIdentity(cwd, type, "new");
  const id = identity.card_id;
  const dir = join(cwd, cfg.cards.source_dir);
  mkdirSync(dir, { recursive: true });
  const path = identity.path;
  if (!existsSync(path)) {
    writeCardFile({
      kind: "scaffold",
      path,
      card_id: id,
      card_type: type,
    });
  }
  const template = readFileSync(path, "utf8");
  return { id, path, template };
}

/** `contexttrail card list` — enumerate every Card with the unified status surface. */
export type CardListEntry = {
  id: string;
  type: CardType;
  title: string;
  scope_summary: string;
  freshness: string;
  link_count: number;
  unlinked: boolean;
};

function scopeSummary(c: Card): string {
  const s = c.scope;
  if (s.layer === "company") return `company:${s.company ?? "*"}`;
  if (s.layer === "team") return `team:${s.team ?? "*"}`;
  if (s.layer === "project") return `project:${s.project ?? "*"}`;
  if (s.layer === "module") return `module:${s.module ?? "*"}`;
  return s.layer;
}

function unifiedFreshness(c: Card): string {
  if (c.author_review_state === "needs_review_manual") {
    return "needs_review_manual";
  }
  if (c.freshness_state === "needs_review") {
    return `needs_review (${c.freshness_reason})`;
  }
  if (c.author_review_state === "verified") return "verified*";
  return c.freshness_state;
}

export type CardListFilter = {
  scope?: string;
  type?: CardType;
  needs_review?: boolean;
};

export function runCardList(cwd: string, filter: CardListFilter = {}): CardListEntry[] {
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  try {
    const cards = listCards(db, { type: filter.type });
    const out: CardListEntry[] = [];
    for (const c of cards) {
      if (filter.needs_review) {
        if (
          c.freshness_state !== "needs_review" &&
          c.author_review_state !== "needs_review_manual"
        )
          continue;
      }
      if (filter.scope) {
        const s = scopeSummary(c);
        if (!s.includes(filter.scope)) continue;
      }
      out.push({
        id: c.id,
        type: c.type,
        title: c.title,
        scope_summary: scopeSummary(c),
        freshness: unifiedFreshness(c),
        link_count: c.links.length,
        unlinked: c.type === "evidence" && c.links.length === 0,
      });
    }
    return out;
  } finally {
    closeDb(db);
  }
}

export function renderCardList(rows: CardListEntry[]): string {
  if (rows.length === 0) return "contexttrail card list: no Cards\n";
  const header = ["id", "type", "title", "scope", "freshness", "links", ""];
  const widths = [6, 12, 36, 18, 28, 6, 10];
  const rowsArr: string[][] = [
    header,
    ...rows.map((r) => [
      r.id,
      r.type,
      r.title.length > 36 ? r.title.slice(0, 33) + "..." : r.title,
      r.scope_summary,
      r.freshness,
      String(r.link_count),
      r.unlinked ? "unlinked" : "",
    ]),
  ];
  return (
    rowsArr
      .map((row) => row.map((cell, i) => cell.padEnd(widths[i] ?? 8)).join(" "))
      .join("\n") + "\n"
  );
}

/** `contexttrail card show <id>` — body + frontmatter + linked-chunk contexttrails. */
export type CardShowResult = {
  card: Card;
  links: {
    chunk_stable_key: string;
    version_pin: string;
    link_type: string;
    chunk?: { source_path: string; heading_path: string[]; current_version_id: string };
  }[];
};

export function runCardShow(cwd: string, id: string): CardShowResult | null {
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  try {
    const card = getCardById(db, id);
    if (!card) return null;
    const links = card.links.map((l) => {
      const versions = getChunksByStableKey(db, l.chunk_stable_key);
      const current = versions.find((v) => v.status === "current");
      return {
        chunk_stable_key: l.chunk_stable_key,
        version_pin: l.version_pin,
        link_type: l.link_type,
        chunk: current
          ? {
              source_path: current.source_path,
              heading_path: current.heading_path,
              current_version_id: current.version_id,
            }
          : undefined,
      };
    });
    return { card, links };
  } finally {
    closeDb(db);
  }
}

export function renderCardShow(r: CardShowResult): string {
  const c = r.card;
  const lines: string[] = [];
  lines.push(`# ${c.id}: ${c.title}`);
  lines.push(`type: ${c.type}    authority: ${c.authority}    scope: ${scopeSummary(c)}`);
  lines.push(`freshness: ${unifiedFreshness(c)}`);
  if (c.symbol_anchors.length > 0) {
    lines.push(`symbol_anchors: ${c.symbol_anchors.join(", ")}`);
  }
  if (c.type === "evidence") lines.push(`command: ${c.command}`);
  lines.push("");
  lines.push(c.body);
  lines.push("");
  if (r.links.length > 0) {
    lines.push("Linked chunks:");
    for (const l of r.links) {
      if (l.chunk) {
        const drift =
          l.chunk.current_version_id === l.version_pin ? "" : " (drift)";
        lines.push(
          `  - ${l.chunk.source_path} > ${l.chunk.heading_path.join(" > ")} [${l.link_type}, pin=${l.version_pin}${drift}]`,
        );
      } else {
        lines.push(
          `  - ${l.chunk_stable_key} [${l.link_type}, pin=${l.version_pin}, tombstoned]`,
        );
      }
    }
  } else if (c.type === "evidence") {
    lines.push("Linked chunks: (unlinked)");
  }
  return lines.join("\n") + "\n";
}

/** `contexttrail card verify <id>` — flips author_review_state only. */
export function runCardVerify(cwd: string, id: string): boolean {
  return setAuthorReview(cwd, id, "verified");
}

/** `contexttrail card mark-needs-review <id>` — flips author_review_state only. */
export function runCardMarkNeedsReview(cwd: string, id: string): boolean {
  return setAuthorReview(cwd, id, "needs_review_manual");
}

function setAuthorReview(cwd: string, id: string, state: AuthorReviewState): boolean {
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  try {
    return updateCardAuthorReview(db, id, state) > 0;
  } finally {
    closeDb(db);
  }
}

/** `contexttrail card link <card> <chunk_version_id>` — write a `mentions` link.
 *  Captures the chunk's current `version_id` as `version_pin`. */
export function runCardLink(
  cwd: string,
  card_id: string,
  chunk_version_id: string,
  link_type: "evidences" | "mentions" | "covers" = "mentions",
): boolean {
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  try {
    const chunk = getChunkByVersionId(db, chunk_version_id);
    if (!chunk) return false;
    if (!getCardById(db, card_id)) return false;
    upsertCardLink(db, {
      card_id,
      chunk_stable_key: chunk.stable_key,
      version_pin: chunk.version_id,
      content_hash_pin: chunk.chunk_content_hash,
      link_type,
      linked_at: new Date().toISOString(),
    });
    materializeAllFreshness(db);
    return true;
  } finally {
    closeDb(db);
  }
}

/** `contexttrail card unlink <card> <chunk_version_id>` — remove a link. */
export function runCardUnlink(
  cwd: string,
  card_id: string,
  chunk_version_id: string,
  link_type: "evidences" | "mentions" | "covers" = "mentions",
): boolean {
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  try {
    const chunk = getChunkByVersionId(db, chunk_version_id);
    if (!chunk) return false;
    deleteCardLink(db, card_id, chunk.stable_key, link_type);
    materializeAllFreshness(db);
    return true;
  } finally {
    closeDb(db);
  }
}

/** Build the inline-suggestion list shown by `contexttrail card add`. */
export function runCardSuggest(
  cwd: string,
  card_id: string,
  topN: number = 5,
): { source_path: string; heading_path: string[]; version_id: string; anchor_overlap: number; scope_match: number }[] {
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  try {
    const card = getCardById(db, card_id);
    if (!card) return [];
    const s = suggestLinks(db, card, topN);
    return s.map((x) => ({
      source_path: x.chunk.source_path,
      heading_path: x.chunk.heading_path,
      version_id: x.chunk.version_id,
      anchor_overlap: x.anchor_overlap,
      scope_match: x.scope_match,
    }));
  } finally {
    closeDb(db);
  }
}
