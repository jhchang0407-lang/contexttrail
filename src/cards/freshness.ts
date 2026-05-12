import type { Db } from "../store/db.js";
import { listLinksForCard, listAllLinks, updateCardFreshness } from "../store/cards.js";
import type { FreshnessReason, FreshnessState, CardLink } from "../types/card.js";
import { preserveAuthoredFreshness, type FreshnessResult } from "./freshness-policy.js";

/**
 * The materialized-freshness rule (D41, ADR-0006).
 *
 * Pure function over (links.version_pin, current chunk version_ids, tombstones).
 * Reproducible: rerunning yields the same result for mechanically materialized
 * states. Authored `potentially_superseded` cards are preserved as an explicit
 * author signal because the retrieval filter treats that state as non-promotable
 * evidence.
 */
export function computeFreshness(
  links: CardLink[],
  currentVersionIdByStableKey: Map<string, string>,
  knownStableKeys: Set<string>,
): FreshnessResult {
  if (links.length === 0) {
    return { state: "verified", reason: "no_links" };
  }

  let sawTombstoned = false;
  let sawDrift = false;

  for (const link of links) {
    const current = currentVersionIdByStableKey.get(link.chunk_stable_key);
    if (current === undefined) {
      // No current chunk under this stable_key. Either:
      //  - the stable_key never existed (link to an unknown chunk), or
      //  - every version under it has been tombstoned.
      // Both are surfaced as `tombstoned_link` because the link target is
      // unreachable from the agent's point of view.
      if (knownStableKeys.has(link.chunk_stable_key)) {
        sawTombstoned = true;
      } else {
        sawTombstoned = true;
      }
      continue;
    }
    if (current !== link.version_pin) {
      sawDrift = true;
    }
  }

  // tombstoned wins over drift in the reason hierarchy because it's a strict
  // superset (the link target is gone, not just changed).
  if (sawTombstoned) return { state: "needs_review", reason: "tombstoned_link" };
  if (sawDrift) return { state: "needs_review", reason: "version_drift" };
  return { state: "verified", reason: "all_links_current" };
}

/** Build the lookup tables `computeFreshness` needs from the live DB. */
export function buildFreshnessLookups(db: Db): {
  currentByStableKey: Map<string, string>;
  knownStableKeys: Set<string>;
} {
  const rows = db
    .prepare(
      "SELECT stable_key, version_id, status FROM doc_chunks",
    )
    .all() as { stable_key: string; version_id: string; status: string }[];
  const currentByStableKey = new Map<string, string>();
  const knownStableKeys = new Set<string>();
  for (const r of rows) {
    knownStableKeys.add(r.stable_key);
    if (r.status === "current") {
      // If multiple current chunks share a stable_key (shouldn't happen in v1
      // but defensive), the lexicographically last wins — deterministic.
      const prev = currentByStableKey.get(r.stable_key);
      if (!prev || r.version_id > prev) {
        currentByStableKey.set(r.stable_key, r.version_id);
      }
    }
  }
  return { currentByStableKey, knownStableKeys };
}

/** Materialize freshness for one card and persist to `cards.freshness_state`. */
export function materializeFreshness(db: Db, card_id: string): FreshnessResult {
  const stored = getStoredFreshness(db, card_id);
  const links = listLinksForCard(db, card_id);
  const { currentByStableKey, knownStableKeys } = buildFreshnessLookups(db);
  const canonical = computeFreshness(links, currentByStableKey, knownStableKeys);
  const next = stored ? preserveAuthoredFreshness(stored, canonical) : canonical;
  updateCardFreshness(db, card_id, next.state, next.reason);
  return next;
}

/** Materialize freshness for every card. Called by the indexer post-import. */
export function materializeAllFreshness(db: Db): Map<string, FreshnessResult> {
  const cards = db.prepare("SELECT id, freshness_state, freshness_reason FROM cards").all() as {
    id: string;
    freshness_state: FreshnessState;
    freshness_reason: FreshnessReason;
  }[];
  if (cards.length === 0) return new Map();
  const cardIds = cards.map((r) => r.id);
  const storedFreshness = new Map(
    cards.map((r) => [r.id, { state: r.freshness_state, reason: r.freshness_reason }]),
  );
  const all = listAllLinks(db);
  const linksByCard = new Map<string, CardLink[]>();
  for (const l of all) {
    const arr = linksByCard.get(l.card_id) ?? [];
    arr.push(l);
    linksByCard.set(l.card_id, arr);
  }
  const { currentByStableKey, knownStableKeys } = buildFreshnessLookups(db);
  const results = new Map<string, FreshnessResult>();
  const tx = db.transaction(() => {
    for (const id of cardIds) {
      const canonical = computeFreshness(
        linksByCard.get(id) ?? [],
        currentByStableKey,
        knownStableKeys,
      );
      const next = preserveAuthoredFreshness(storedFreshness.get(id)!, canonical);
      updateCardFreshness(db, id, next.state, next.reason);
      results.set(id, next);
    }
  });
  tx();
  return results;
}

function getStoredFreshness(db: Db, card_id: string): FreshnessResult | undefined {
  const row = db
    .prepare("SELECT freshness_state, freshness_reason FROM cards WHERE id = ?")
    .get(card_id) as { freshness_state: string; freshness_reason: FreshnessReason } | undefined;
  if (!row) return undefined;
  return {
    state: row.freshness_state as FreshnessState,
    reason: row.freshness_reason,
  };
}
