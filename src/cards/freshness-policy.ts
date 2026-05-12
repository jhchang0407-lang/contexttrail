import type { Card, FreshnessReason, FreshnessState } from "../types/card.js";

export type FreshnessResult = {
  state: FreshnessState;
  reason: FreshnessReason;
};

/**
 * Evidence-promotion freshness policy (ADR-0011).
 *
 * Evidence Cards may be promoted into the locked-include set when a primary
 * locked Card cites them via `covers`. Promotion is a freshness predicate,
 * not a locking rule: only "fresh enough" evidence may promote.
 *
 * `potentially_superseded` is excluded entirely (the author has flagged the
 * evidence as stale). Other states promote but rank by quality so that
 * `verified` evidence wins ties against `unverified` or `needs_review`.
 */
const EVIDENCE_FRESHNESS_RANK: Record<FreshnessState, number> = {
  verified: 4,
  unverified: 3,
  needs_review: 2,
  maybe_affected: 1,
  potentially_superseded: 0,
};

export function isEvidencePromotable(card: Card): boolean {
  return card.freshness_state !== "potentially_superseded";
}

export function evidenceFreshnessRank(card: Card): number {
  return EVIDENCE_FRESHNESS_RANK[card.freshness_state];
}

export type SeedFreshnessInput = {
  linkCount: number;
  authoredState?: FreshnessState;
  authoredReason?: FreshnessReason;
};

export function seedFreshness(input: SeedFreshnessInput): FreshnessResult {
  if (input.authoredState !== undefined) {
    return {
      state: input.authoredState,
      reason: input.authoredReason ?? defaultReasonForAuthoredState(input.authoredState, input.linkCount),
    };
  }
  return {
    state: "verified",
    reason: input.linkCount > 0 ? "all_links_current" : "no_links",
  };
}

export function preserveAuthoredFreshness(
  stored: FreshnessResult,
  canonical: FreshnessResult,
): FreshnessResult {
  if (isAuthoredFreshnessException(stored)) {
    return stored;
  }
  return canonical;
}

export function freshnessMatchesCanonical(
  stored: FreshnessResult,
  canonical: FreshnessResult,
): boolean {
  if (isAuthoredFreshnessException(stored)) return true;
  return stored.state === canonical.state && stored.reason === canonical.reason;
}

export function isAuthoredFreshnessException(stored: FreshnessResult): boolean {
  return stored.state === "potentially_superseded";
}

function defaultReasonForAuthoredState(
  state: FreshnessState,
  linkCount: number,
): FreshnessReason {
  if (state !== "verified") return "version_drift";
  return linkCount > 0 ? "all_links_current" : "no_links";
}
