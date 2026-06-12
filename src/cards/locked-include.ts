import type { Card } from "../types/card.js";
import type { QueryScope } from "../retrieve/scope-match.js";
import type { QueryAnchors } from "../retrieve/score.js";
import { evidenceFreshnessRank, isEvidencePromotable } from "./freshness-policy.js";

export const LOCK_REASON_KINDS = [
  "constraint_scope_match",
  "symbol_note_exact",
  "evidence_covers_locked",
] as const;

/** Per-card explanation surfaced in `contexttrail explain` and the Pack render. */
export type LockReason = {
  card_id: string;
  kind: (typeof LOCK_REASON_KINDS)[number];
  /** Hierarchical-down match path. e.g. "project:fundops -> module:fundops/ledger" */
  scope_match_path?: string;
  /** Symbol that matched, for symbol_note locks. */
  matched_symbol?: string;
  /** Set when a constraint locks via `company:` scope so the
   *  author can audit unintended over-broad locking. */
  broad_scope?: boolean;
  /** Primary locked cards that promoted this evidence card. */
  derived_from?: string[];
};

export const LOCK_FAILURE_REASONS = [
  "missing_inferred_scope_field",
  "scope_mismatch",
  "no_query_scope",
  "symbol_not_exact",
  "filtered_stale",
  "not_lockable_type",
] as const;

export type LockFailure = {
  card_id: string;
  card_type: Card["type"];
  candidate_match_path: string;
  failed_reason: (typeof LOCK_FAILURE_REASONS)[number];
  detail?: string;
};

export type LockConsideration =
  | { card_id: string; matched: true; reason: LockReason }
  | { card_id: string; matched: false; failure: LockFailure };

export type LockedIncludeResult = {
  locked: Card[];
  reasons: LockReason[];
  considerationsByCardId: Map<string, LockConsideration>;
};

/**
 * Hierarchical-down constraint matching.
 *
 * A `constraint` Card locks for a query scope iff the card's scope is
 * an *ancestor* (or equal) of the query's scope along the hierarchy
 * `company > team > project > module > feature`. Sibling modules do not
 * match each other; descendants do not subsume ancestors.
 */
function constraintMatchesScope(
  card: Card,
  q: QueryScope,
): { matches: boolean; path: string; broad_scope: boolean } {
  const cs = card.scope;
  // company:-scoped cards lock universally. Surfaced via broad_scope.
  if (cs.layer === "company") {
    if (cs.company !== undefined && q.company !== undefined && cs.company !== q.company) {
      return { matches: false, path: "", broad_scope: false };
    }
    return {
      matches: true,
      path: `company:${cs.company ?? "*"} (universal)`,
      broad_scope: true,
    };
  }

  if (cs.layer === "team") {
    if (cs.team && q.team && cs.team === q.team) {
      return { matches: true, path: `team:${cs.team}`, broad_scope: false };
    }
    return { matches: false, path: "", broad_scope: false };
  }

  if (cs.layer === "project") {
    if (cs.project && q.project && cs.project === q.project) {
      return {
        matches: true,
        path: `project:${cs.project} -> ${q.module ? `module:${q.module}` : `project:${q.project}`}`,
        broad_scope: false,
      };
    }
    return { matches: false, path: "", broad_scope: false };
  }

  if (cs.layer === "module") {
    // Strict module match required: descendants don't subsume ancestors;
    // siblings don't match.
    if (
      cs.module &&
      q.module &&
      cs.module === q.module &&
      (cs.project === undefined || cs.project === q.project)
    ) {
      return {
        matches: true,
        path: `module:${cs.module}`,
        broad_scope: false,
      };
    }
    return { matches: false, path: "", broad_scope: false };
  }

  // decision / unknown layers do not produce locked-includes in v1.
  return { matches: false, path: "", broad_scope: false };
}

/** Strict-equality symbol_note matching. */
function symbolNoteMatchesAnchors(
  card: Card,
  query_anchors: QueryAnchors,
): string | null {
  const querySyms = query_anchors.symbols ?? [];
  if (querySyms.length === 0) return null;
  for (const cardSym of card.symbol_anchors) {
    if (querySyms.includes(cardSym)) return cardSym;
  }
  return null;
}

export function resolveLockedInclude(
  cards: Card[],
  query_scopes: QueryScope[],
  query_anchors: QueryAnchors,
): LockedIncludeResult {
  const primary = resolvePrimaryLocks(cards, query_scopes, query_anchors);
  const evidence = promoteEvidenceFromLocks(cards, primary.locked.map((card) => card.id));
  const considerationsByCardId = new Map(primary.considerationsByCardId);
  for (const [cardId, consideration] of evidence.considerationsByCardId) {
    considerationsByCardId.set(cardId, consideration);
  }
  return {
    locked: [...primary.locked, ...evidence.locked],
    reasons: [...primary.reasons, ...evidence.reasons],
    considerationsByCardId,
  };
}

export function resolvePrimaryLocks(
  cards: Card[],
  query_scopes: QueryScope[],
  query_anchors: QueryAnchors,
): LockedIncludeResult {
  const locked: Card[] = [];
  const reasons: LockReason[] = [];
  const considerationsByCardId = new Map<string, LockConsideration>();

  for (const card of cards) {
    if (card.authority === "deprecated") {
      considerationsByCardId.set(card.id, {
        card_id: card.id,
        matched: false,
        failure: {
          card_id: card.id,
          card_type: card.type,
          candidate_match_path: "filtered by authority/freshness",
          failed_reason: "filtered_stale",
          detail: `${card.authority}/${card.freshness_state}`,
        },
      });
      continue;
    }
    if (card.type === "evidence") {
      considerationsByCardId.set(card.id, {
        card_id: card.id,
        matched: false,
        failure: {
          card_id: card.id,
          card_type: card.type,
          candidate_match_path: "evidence requires a locked primary card",
          failed_reason: "not_lockable_type",
          detail: "evidence cards only lock through one-hop covers: promotion",
        },
      });
      continue;
    }

    if (card.type === "constraint") {
      let bestPath: string | null = null;
      let broad = false;
      // company-scope constraints lock universally, even when the
      // query carries no inferred scope. Iterate over query_scopes ∪ [{}] so
      // an unscoped query still triggers the company-layer match.
      const scopesToCheck =
        query_scopes.length > 0 ? query_scopes : [{} as (typeof query_scopes)[number]];
      for (const q of scopesToCheck) {
        const m = constraintMatchesScope(card, q);
        if (m.matches) {
          // Prefer the most-specific match path (longer string), but stable
          // tie-break by first match order otherwise.
          if (!bestPath || m.path.length > bestPath.length) {
            bestPath = m.path;
          }
          if (m.broad_scope) broad = true;
        }
      }
      if (bestPath) {
        locked.push(card);
        const reason: LockReason = {
          card_id: card.id,
          kind: "constraint_scope_match",
          scope_match_path: bestPath,
          broad_scope: broad || undefined,
        };
        reasons.push(reason);
        considerationsByCardId.set(card.id, {
          card_id: card.id,
          matched: true,
          reason,
        });
      } else {
        considerationsByCardId.set(card.id, {
          card_id: card.id,
          matched: false,
          failure: classifyConstraintLockFailure(card, query_scopes),
        });
      }
      continue;
    }

    if (card.type === "symbol_note") {
      const matched = symbolNoteMatchesAnchors(card, query_anchors);
      if (matched !== null) {
        locked.push(card);
        const reason: LockReason = {
          card_id: card.id,
          kind: "symbol_note_exact",
          matched_symbol: matched,
        };
        reasons.push(reason);
        considerationsByCardId.set(card.id, {
          card_id: card.id,
          matched: true,
          reason,
        });
      } else {
        const symbols = query_anchors.symbols ?? [];
        considerationsByCardId.set(card.id, {
          card_id: card.id,
          matched: false,
          failure: {
            card_id: card.id,
            card_type: card.type,
            candidate_match_path:
              symbols.length > 0
                ? `query symbols: ${symbols.join(", ")}`
                : "no query symbols",
            failed_reason: "symbol_not_exact",
            detail: `expected one of: ${card.symbol_anchors.join(", ") || "(none)"}`,
          },
        });
      }
      continue;
    }
  }

  return { locked, reasons, considerationsByCardId };
}

export function promoteEvidenceFromLocks(
  cards: Card[],
  primaryLockedIds: string[],
): LockedIncludeResult {
  const locked: Card[] = [];
  const reasons: LockReason[] = [];
  const considerationsByCardId = new Map<string, LockConsideration>();
  const promotedEvidence = new Map<string, { card: Card; derived_from: string[] }>();
  const evidenceCards = cards
    .filter((card) => card.type === "evidence")
    .filter((card) => card.authority !== "deprecated")
    .filter(isEvidencePromotable)
    .sort((a, b) => {
      const aRank = evidenceFreshnessRank(a);
      const bRank = evidenceFreshnessRank(b);
      if (bRank !== aRank) return bRank - aRank;
      const aCoverage = a.type === "evidence" ? a.covers.length : 0;
      const bCoverage = b.type === "evidence" ? b.covers.length : 0;
      if (bCoverage !== aCoverage) return bCoverage - aCoverage;
      return a.id.localeCompare(b.id);
    });

  for (const primaryId of primaryLockedIds) {
    let promotedForPrimary = 0;
    for (const card of evidenceCards) {
      if (!card.covers.includes(primaryId)) continue;
      const existing = promotedEvidence.get(card.id);
      if (existing) {
        if (!existing.derived_from.includes(primaryId)) {
          existing.derived_from.push(primaryId);
        }
        promotedForPrimary++;
        continue;
      }
      if (promotedForPrimary >= 2) continue;
      promotedEvidence.set(card.id, { card, derived_from: [primaryId] });
      promotedForPrimary++;
    }
  }

  for (const { card, derived_from } of promotedEvidence.values()) {
    locked.push(card);
    const reason: LockReason = {
      card_id: card.id,
      kind: "evidence_covers_locked",
      derived_from,
    };
    reasons.push(reason);
    considerationsByCardId.set(card.id, {
      card_id: card.id,
      matched: true,
      reason,
    });
  }

  return { locked, reasons, considerationsByCardId };
}

function classifyConstraintLockFailure(
  card: Extract<Card, { type: "constraint" }>,
  query_scopes: QueryScope[],
): LockFailure {
  if (query_scopes.length === 0) {
    return {
      card_id: card.id,
      card_type: card.type,
      candidate_match_path: "no inferred query scope",
      failed_reason: "no_query_scope",
      detail: "constraint cards require an inferred query scope unless they are company-scoped",
    };
  }

  const candidate_match_path = query_scopes
    .map((scope) => `${scopeLabel(card.scope)} -> ${queryScopeLabel(scope)}`)
    .join("; ");
  const missing = missingScopeFields(card, query_scopes);
  if (missing.length > 0) {
    return {
      card_id: card.id,
      card_type: card.type,
      candidate_match_path,
      failed_reason: "missing_inferred_scope_field",
      detail: `missing query scope field(s): ${missing.join(", ")}`,
    };
  }

  return {
    card_id: card.id,
    card_type: card.type,
    candidate_match_path,
    failed_reason: "scope_mismatch",
    detail: "constraint scope did not cover any inferred query scope",
  };
}

function missingScopeFields(
  card: Extract<Card, { type: "constraint" }>,
  query_scopes: QueryScope[],
): string[] {
  if (card.scope.layer === "company") return [];
  const fields: Array<keyof QueryScope> = [];
  if (card.scope.layer === "team") fields.push("team");
  if (card.scope.layer === "project") fields.push("project");
  if (card.scope.layer === "module") fields.push("module");
  return fields.filter((field) => query_scopes.every((scope) => scope[field] === undefined));
}

function scopeLabel(scope: Card["scope"]): string {
  if (scope.layer === "company") return `company:${scope.company ?? "*"}`;
  if (scope.layer === "team") return `team:${scope.team ?? "*"}`;
  if (scope.layer === "project") return `project:${scope.project ?? "*"}`;
  if (scope.layer === "module") return `module:${scope.module ?? "*"}`;
  return scope.layer;
}

function queryScopeLabel(scope: QueryScope): string {
  if (scope.module) return `module:${scope.module}`;
  if (scope.project) return `project:${scope.project}`;
  if (scope.team) return `team:${scope.team}`;
  if (scope.company) return `company:${scope.company}`;
  return "unknown";
}
