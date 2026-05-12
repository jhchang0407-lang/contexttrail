import { describe, expect, it } from "vitest";
import type { AboutnessObservation } from "./aboutness.js";
import { decideSourceEvidencePolicy } from "./source-evidence-policy.js";
import type { SourceCard } from "./source-card.js";

function card(overrides: Partial<SourceCard> = {}): SourceCard {
  return {
    schema_version: 1,
    rank: 1,
    source_path: "docs/api/router.md",
    query_intent: "file_anchored",
    query_tokens: ["router"],
    profile_signals: {
      title: "Router",
      doc_purpose: "guide",
      doc_role: "canonical",
      heading_count: 1,
      alias_kinds: ["title"],
      has_intro: true,
    },
    candidate_path_evidence: {
      best_chunk_rank: 1,
      best_chunk_score: 0.8,
      contributing_chunk_count: 1,
      fused_rank: 1,
      fused_path_count: 1,
    },
    top_chunk_evidence: {
      version_id: "v1",
      rank: 1,
      final_score: 0.8,
    },
    token_coverage: {
      title_token_coverage: 1,
      path_token_coverage: 1,
      heading_token_coverage: 0,
    },
    coverage_decision: null,
    phrase_proximity: null,
    source_role: {
      role: "unknown",
      canonicality: "unknown",
      confidence: "unknown",
      provenance: [],
    },
    source_family: null,
    anchor_symbols: [],
    path_topology: {},
    heading_aliases: [],
    code_fence_entities: [],
    nav_metadata: {},
    ...overrides,
  } as SourceCard;
}

function aboutness(
  source_path: string,
  label: AboutnessObservation["label"],
  rank = 1,
): AboutnessObservation {
  return {
    source_path,
    rank,
    label,
    reason_codes: [],
    combined_token_coverage: label === "covers" ? 1 : 0.5,
  };
}

describe("decideSourceEvidencePolicy", () => {
  it("lets direct identity dominate anchored source selection", () => {
    const decision = decideSourceEvidencePolicy({
      query_intent: "file_anchored",
      cards: [
        card({
          rank: 1,
          source_path: "docs/server/validators.md",
          token_coverage: {
            title_token_coverage: 0.2,
            path_token_coverage: 0.2,
            heading_token_coverage: 0.2,
          },
        }),
        card({
          rank: 2,
          source_path: "docs/server/routers.md",
          token_coverage: {
            title_token_coverage: 1,
            path_token_coverage: 1,
            heading_token_coverage: 0,
          },
        }),
      ],
      aboutness: [
        aboutness("docs/server/validators.md", "covers", 1),
        aboutness("docs/server/routers.md", "partial", 2),
      ],
    });

    expect(decision.fail_closed).toBe(false);
    expect(decision.selected_sources[0]?.source_path).toBe("docs/server/routers.md");
    expect(decision.selected_sources[0]?.reason_codes).toContain("identity_direct");
  });

  it("preserves relation and role before identity for broad-domain queries", () => {
    const decision = decideSourceEvidencePolicy({
      query_intent: "broad_domain",
      cards: [
        card({
          rank: 1,
          source_path: "docs/api/router.md",
          query_intent: "broad_domain",
          profile_signals: {
            title: "Router API",
            doc_purpose: "api_reference",
            doc_role: "canonical",
            heading_count: 1,
            alias_kinds: ["title"],
            has_intro: true,
          },
          token_coverage: {
            title_token_coverage: 1,
            path_token_coverage: 1,
            heading_token_coverage: 1,
          },
        }),
        card({
          rank: 2,
          source_path: "docs/concepts/router.md",
          query_intent: "broad_domain",
          profile_signals: {
            title: "Routers",
            doc_purpose: "concept",
            doc_role: "canonical",
            heading_count: 1,
            alias_kinds: ["title"],
            has_intro: true,
          },
          token_coverage: {
            title_token_coverage: 0.5,
            path_token_coverage: 0.5,
            heading_token_coverage: 0,
          },
        }),
      ],
      aboutness: [
        aboutness("docs/api/router.md", "partial", 1),
        aboutness("docs/concepts/router.md", "covers", 2),
      ],
    });

    expect(decision.selected_sources[0]?.source_path).toBe(
      "docs/concepts/router.md",
    );
    expect(decision.selected_sources[0]?.reason_codes).toContain("role_direct");
  });

  it("fails closed when signal-empty has no useful evidence", () => {
    const decision = decideSourceEvidencePolicy({
      query_intent: "signal_empty",
      cards: [
        card({
          query_intent: "signal_empty",
          token_coverage: {
            title_token_coverage: 0,
            path_token_coverage: 0,
            heading_token_coverage: 0,
          },
          profile_signals: null,
        }),
      ],
      aboutness: [aboutness("docs/api/router.md", "unsupported")],
    });

    expect(decision.fail_closed).toBe(true);
    expect(decision.selected_sources).toEqual([]);
  });
});
