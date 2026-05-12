import { describe, expect, it } from "vitest";
import {
  evidenceFreshnessRank,
  freshnessMatchesCanonical,
  isEvidencePromotable,
  preserveAuthoredFreshness,
  seedFreshness,
} from "./freshness-policy.js";
import type { Card, FreshnessState } from "../types/card.js";

function evidenceCard(state: FreshnessState): Card {
  return {
    id: "E001",
    type: "evidence",
    title: "test",
    body: "...",
    authority: "accepted",
    scope: { layer: "module", source: {} },
    symbol_anchors: [],
    file_anchors: [],
    route_anchors: [],
    links: [],
    freshness_state: state,
    freshness_reason: "all_links_current",
    author_review_state: "unreviewed",
    token_count: 5,
    source_path: ".contexttrail/cards/e001.md",
    source_hash: "h",
    updated_at: "2026-01-01T00:00:00Z",
    command: "npm test",
    covers: [],
  };
}

describe("freshness policy", () => {
  it("seeds loader freshness from links unless authored stale evidence overrides it", () => {
    expect(seedFreshness({ linkCount: 0 })).toEqual({
      state: "verified",
      reason: "no_links",
    });
    expect(seedFreshness({ linkCount: 1 })).toEqual({
      state: "verified",
      reason: "all_links_current",
    });
    expect(seedFreshness({
      linkCount: 1,
      authoredState: "potentially_superseded",
      authoredReason: "tombstoned_link",
    })).toEqual({
      state: "potentially_superseded",
      reason: "tombstoned_link",
    });
  });

  it("treats authored potentially_superseded as a valid explicit freshness exception", () => {
    const authored = {
      state: "potentially_superseded" as const,
      reason: "version_drift" as const,
    };
    const canonical = {
      state: "verified" as const,
      reason: "all_links_current" as const,
    };

    expect(preserveAuthoredFreshness(authored, canonical)).toEqual(authored);
    expect(freshnessMatchesCanonical(authored, canonical)).toBe(true);
    expect(freshnessMatchesCanonical({
      state: "needs_review",
      reason: "version_drift",
    }, canonical)).toBe(false);
  });

  it("blocks evidence promotion for potentially_superseded; allows others", () => {
    expect(isEvidencePromotable(evidenceCard("potentially_superseded"))).toBe(false);
    expect(isEvidencePromotable(evidenceCard("verified"))).toBe(true);
    expect(isEvidencePromotable(evidenceCard("needs_review"))).toBe(true);
    expect(isEvidencePromotable(evidenceCard("unverified"))).toBe(true);
    expect(isEvidencePromotable(evidenceCard("maybe_affected"))).toBe(true);
  });

  it("ranks evidence by quality so verified wins ties against needs_review or unverified", () => {
    expect(evidenceFreshnessRank(evidenceCard("verified"))).toBeGreaterThan(
      evidenceFreshnessRank(evidenceCard("unverified")),
    );
    expect(evidenceFreshnessRank(evidenceCard("unverified"))).toBeGreaterThan(
      evidenceFreshnessRank(evidenceCard("needs_review")),
    );
    expect(evidenceFreshnessRank(evidenceCard("needs_review"))).toBeGreaterThan(
      evidenceFreshnessRank(evidenceCard("maybe_affected")),
    );
  });
});
