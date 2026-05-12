import { describe, expect, it } from "vitest";
import type { AboutnessObservation } from "./aboutness.js";
import {
  compileSourceEvidence,
  compileSourceEvidenceSet,
} from "./source-evidence.js";
import type { SourceCard } from "./source-card.js";

function card(overrides: Partial<SourceCard> = {}): SourceCard {
  return {
    schema_version: 1,
    rank: 1,
    source_path: "docs/guide/router.md",
    query_intent: "file_anchored",
    query_tokens: ["router"],
    profile_signals: {
      title: "Routers",
      doc_purpose: "guide",
      doc_role: "canonical",
      heading_count: 3,
      alias_kinds: ["title", "filename"],
      has_intro: true,
    },
    candidate_path_evidence: {
      best_chunk_rank: 1,
      best_chunk_score: 0.8,
      contributing_chunk_count: 2,
      fused_rank: 1,
      fused_path_count: 2,
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
  overrides: Partial<AboutnessObservation> = {},
): AboutnessObservation {
  return {
    source_path: "docs/guide/router.md",
    rank: 1,
    label: "covers",
    reason_codes: [],
    combined_token_coverage: 1,
    ...overrides,
  };
}

describe("compileSourceEvidence", () => {
  it("separates identity, role, relation, and structure evidence", () => {
    const evidence = compileSourceEvidence({
      card: card({
        path_topology: { is_section_landing: true },
      }),
      aboutness: aboutness(),
    });

    expect(evidence.identity_strength).toBe("direct");
    expect(evidence.role_strength).toBe("direct");
    expect(evidence.relation_strength).toBe("direct");
    expect(evidence.structure_strength).toBe("supporting");
    expect(evidence.claims.map((claim) => claim.kind)).toEqual(
      expect.arrayContaining(["identity", "role", "relation", "structure"]),
    );
  });

  it("preserves anchor-symbol basename matches as direct identity", () => {
    const evidence = compileSourceEvidence({
      card: card({
        source_path: "docs/api/useQuery.md",
        anchor_symbols: ["useQuery"],
        token_coverage: {
          title_token_coverage: 0,
          path_token_coverage: 0,
          heading_token_coverage: 0,
        },
      }),
    });

    expect(evidence.identity_strength).toBe("direct");
    expect(
      evidence.claims.some(
        (claim) => claim.reason === "anchor_symbol_matches_basename",
      ),
    ).toBe(true);
  });

  it("treats explicit nav landing as direct structure only when provenance is trusted", () => {
    const trusted = compileSourceEvidence({
      card: card({
        query_intent: "broad_domain",
        nav_metadata: {
          is_nav_landing: true,
          nav_provenance: "explicit_config",
        },
      }),
    });
    const structural = compileSourceEvidence({
      card: card({
        query_intent: "broad_domain",
        nav_metadata: {
          is_nav_landing: true,
          nav_provenance: "structural",
        },
      }),
    });

    expect(trusted.structure_strength).toBe("direct");
    expect(trusted.trusted_overview_shape).toBe(true);
    expect(structural.structure_strength).toBe("none");
  });

  it("emits stable rank-ordered evidence sets", () => {
    const out = compileSourceEvidenceSet({
      cards: [
        card({ rank: 2, source_path: "docs/b.md" }),
        card({ rank: 1, source_path: "docs/a.md" }),
      ],
      aboutness: [
        aboutness({ source_path: "docs/b.md", rank: 2 }),
        aboutness({ source_path: "docs/a.md", rank: 1 }),
      ],
    });

    expect(out.map((item) => item.source_path)).toEqual(["docs/a.md", "docs/b.md"]);
  });
});
