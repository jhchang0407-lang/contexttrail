/**
 * THO-146 / PRD-0014 V3.4 — deterministic source-selection decision.
 *
 * Consumes source cards (V3.2) + aboutness observations (V3.3) and returns
 * a selected source order with structured reason codes and margins. The
 * decision is deterministic and fail-closed: if no candidate passes the
 * aboutness floor, the selection is empty rather than confidently wrong.
 *
 * Locked Cards bypass selection entirely (PRD-0014: "locked Cards remain
 * outside source selection"); this module never sees them.
 */
import { describe, expect, it } from "vitest";
import {
  decideSourceSelection,
  type SourceSelectionDecision,
} from "./source-selection-decision.js";
import type { SourceCard } from "./source-card.js";
import type { AboutnessObservation } from "./aboutness.js";
import { tokenizeForRerank as tokenizeForRerankExpr } from "./source-rerank.js";

function card(overrides: Partial<SourceCard> = {}): SourceCard {
  return {
    schema_version: 1,
    rank: 1,
    source_path: "docs/concepts/middleware.md",
    query_intent: "decision_lookup",
    query_tokens: ["middlewar"],
    profile_signals: {
      title: "Middleware",
      doc_purpose: "concept",
      doc_role: "canonical",
      heading_count: 5,
      alias_kinds: ["title", "filename"],
      has_intro: true,
    },
    candidate_path_evidence: {
      best_chunk_rank: 1,
      best_chunk_score: 0.78,
      contributing_chunk_count: 2,
      fused_rank: 1,
      fused_path_count: 3,
    },
    top_chunk_evidence: { version_id: "vid", rank: 1, final_score: 0.78 },
    token_coverage: {
      title_token_coverage: 0.5,
      path_token_coverage: 0.5,
      heading_token_coverage: 0.3,
    },
    coverage_decision: null,
    ...overrides,
  };
}

function obs(
  source_path: string,
  rank: number,
  label: AboutnessObservation["label"],
  reason_codes: AboutnessObservation["reason_codes"] = [],
  combined = 0.5,
): AboutnessObservation {
  return {
    source_path,
    rank,
    label,
    reason_codes,
    combined_token_coverage: combined,
  };
}

describe("decideSourceSelection", () => {
  it("selects a `covers` candidate ahead of a `partial` neighbor", () => {
    const decision = decideSourceSelection({
      cards: [
        card({ source_path: "a.md", rank: 1 }),
        card({ source_path: "b.md", rank: 2 }),
      ],
      aboutness: [obs("a.md", 1, "covers"), obs("b.md", 2, "partial")],
      query_intent: "decision_lookup",
    });
    expect(decision.selected_sources.map((s) => s.source_path)).toEqual([
      "a.md",
      "b.md",
    ]);
    expect(decision.fail_closed).toBe(false);
  });

  it("promotes a parent overview over a leaf for decision queries (parent_over_leaf)", () => {
    const decision = decideSourceSelection({
      cards: [
        card({
          source_path: "docs/concepts/middleware/builtin/cors.md",
          rank: 1,
          profile_signals: {
            title: "CORS",
            doc_purpose: "guide",
            doc_role: "canonical",
            heading_count: 3,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
        card({
          source_path: "docs/concepts/middleware.md",
          rank: 4,
        }),
      ],
      aboutness: [
        obs("docs/concepts/middleware/builtin/cors.md", 1, "too_narrow", [
          "parent_vs_leaf",
        ]),
        obs("docs/concepts/middleware.md", 4, "covers", ["parent_vs_leaf"]),
      ],
      query_intent: "decision_lookup",
    });
    expect(decision.selected_sources[0].source_path).toBe(
      "docs/concepts/middleware.md",
    );
    expect(decision.selected_sources[0].reason_codes).toContain(
      "parent_over_leaf",
    );
  });

  it("does not promote an unknown broad container just because it is a parent path", () => {
    const decision = decideSourceSelection({
      cards: [
        card({
          source_path: "docs/blog/switching-environments.md",
          rank: 1,
          profile_signals: {
            title: "Switching environments",
            doc_purpose: "guide",
            doc_role: "canonical",
            heading_count: 3,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
        card({
          source_path: "docs/guide/environment.md",
          rank: 2,
          profile_signals: {
            title: "Environment",
            doc_purpose: "guide",
            doc_role: "canonical",
            heading_count: 4,
            alias_kinds: ["title", "filename"],
            has_intro: true,
          },
        }),
        card({
          source_path: "docs/blog.md",
          rank: 49,
          profile_signals: {
            title: "Blog",
            doc_purpose: "unknown",
            doc_role: "canonical",
            heading_count: 1,
            alias_kinds: ["title", "filename"],
            has_intro: true,
          },
        }),
      ],
      aboutness: [
        obs("docs/blog/switching-environments.md", 1, "adjacent"),
        obs("docs/guide/environment.md", 2, "partial"),
        obs("docs/blog.md", 49, "partial", ["parent_vs_leaf"]),
      ],
      query_intent: "broad_domain",
    });
    expect(decision.selected_sources[0].source_path).toBe(
      "docs/guide/environment.md",
    );
    expect(
      decision.selected_sources.find((s) => s.source_path === "docs/blog.md")
        ?.reason_codes,
    ).not.toContain("parent_over_leaf");
  });

  it("promotes a decision/concept doc over procedural neighbors for decision queries", () => {
    const decision = decideSourceSelection({
      cards: [
        card({
          source_path: "docs/server/adapters/nextjs.md",
          rank: 1,
          profile_signals: {
            title: "Next.js adapter",
            doc_purpose: "guide",
            doc_role: "canonical",
            heading_count: 3,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
        card({
          source_path: "docs/further/rpc.md",
          rank: 4,
          profile_signals: {
            title: "RPC vs REST",
            doc_purpose: "concept",
            doc_role: "canonical",
            heading_count: 4,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
      ],
      aboutness: [
        obs("docs/server/adapters/nextjs.md", 1, "adjacent", [
          "decision_vs_procedural",
        ]),
        obs("docs/further/rpc.md", 4, "covers", ["decision_vs_procedural"]),
      ],
      query_intent: "decision_lookup",
    });
    expect(decision.selected_sources[0].source_path).toBe("docs/further/rpc.md");
    expect(decision.selected_sources[0].reason_codes).toContain(
      "decision_over_procedural",
    );
  });

  it("promotes an anchored exact topic over broad reference docs for file_anchored queries", () => {
    const decision = decideSourceSelection({
      cards: [
        card({
          source_path: "docs/reference/configuration.md",
          rank: 1,
          query_intent: "file_anchored",
          profile_signals: {
            title: "Configuration",
            doc_purpose: "api_reference",
            doc_role: "canonical",
            heading_count: 12,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
        card({
          source_path: "docs/reference/globs.md",
          rank: 5,
          query_intent: "file_anchored",
          profile_signals: {
            title: "Globs",
            doc_purpose: "guide",
            doc_role: "canonical",
            heading_count: 4,
            alias_kinds: ["title", "filename"],
            has_intro: true,
          },
        }),
      ],
      aboutness: [
        obs("docs/reference/configuration.md", 1, "too_broad", [
          "guide_vs_reference",
        ]),
        obs("docs/reference/globs.md", 5, "covers", ["guide_vs_reference"]),
      ],
      query_intent: "file_anchored",
    });
    expect(decision.selected_sources[0].source_path).toBe(
      "docs/reference/globs.md",
    );
    expect(decision.selected_sources[0].reason_codes).toContain(
      "anchored_over_broad",
    );
  });

  it("preserves a changelog/release source when its aboutness flagged release intent", () => {
    const decision = decideSourceSelection({
      cards: [
        card({
          source_path: "packages/docs-v3/README.md",
          rank: 1,
          profile_signals: {
            title: "README",
            doc_purpose: "package_readme",
            doc_role: "canonical",
            heading_count: 4,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
        card({
          source_path: "packages/docs-v3/CHANGELOG.md",
          rank: 6,
          query_tokens: ["version", "changelog"],
          profile_signals: {
            title: "Changelog",
            doc_purpose: "changelog",
            doc_role: "canonical",
            heading_count: 0,
            alias_kinds: ["title"],
            has_intro: false,
          },
        }),
      ],
      aboutness: [
        obs("packages/docs-v3/README.md", 1, "partial"),
        obs(
          "packages/docs-v3/CHANGELOG.md",
          6,
          "covers",
          ["changelog_release_intent"],
        ),
      ],
      query_intent: "broad_domain",
    });
    expect(decision.selected_sources[0].source_path).toBe(
      "packages/docs-v3/CHANGELOG.md",
    );
    expect(decision.selected_sources[0].reason_codes).toContain(
      "changelog_release_intent_preserved",
    );
  });

  it("does not promote release notes when the query does not ask about release history", () => {
    const decision = decideSourceSelection({
      cards: [
        card({
          source_path: "docs/canonical.md",
          rank: 1,
          query_tokens: ["refund", "idempot"],
        }),
        card({
          source_path: "docs/release-notes.md",
          rank: 2,
          query_tokens: ["refund", "idempot"],
          profile_signals: {
            title: "Release notes",
            doc_purpose: "release_note",
            doc_role: "canonical",
            heading_count: 2,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
      ],
      aboutness: [
        obs("docs/canonical.md", 1, "partial"),
        obs("docs/release-notes.md", 2, "partial", [
          "changelog_release_intent",
        ]),
      ],
      query_intent: "broad_domain",
    });
    expect(decision.selected_sources[0].source_path).toBe("docs/canonical.md");
    expect(decision.selected_sources[1].reason_codes).not.toContain(
      "changelog_release_intent_preserved",
    );
  });

  it("does not promote changelogs for unversioned migration queries", () => {
    const queryTokens = tokenizeForRerankExpr(
      "migrate from eslint and prettier to biome",
    );
    const decision = decideSourceSelection({
      cards: [
        card({
          source_path: "docs/guides/migrate-eslint-prettier.md",
          rank: 1,
          query_tokens: queryTokens,
          profile_signals: {
            title: "Migrate from ESLint and Prettier",
            doc_purpose: "migration",
            doc_role: "canonical",
            heading_count: 5,
            alias_kinds: ["title", "filename"],
            has_intro: true,
          },
        }),
        card({
          source_path: "docs/changelog_v1.md",
          rank: 4,
          query_tokens: queryTokens,
          profile_signals: {
            title: "Changelog",
            doc_purpose: "changelog",
            doc_role: "canonical",
            heading_count: 2,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
      ],
      aboutness: [
        obs("docs/guides/migrate-eslint-prettier.md", 1, "covers"),
        obs("docs/changelog_v1.md", 4, "partial", [
          "changelog_release_intent",
        ]),
      ],
      query_intent: "broad_domain",
    });
    expect(decision.selected_sources[0].source_path).toBe(
      "docs/guides/migrate-eslint-prettier.md",
    );
    expect(decision.selected_sources[1].reason_codes).not.toContain(
      "changelog_release_intent_preserved",
    );
  });

  it("fails closed when every candidate is unsupported", () => {
    const decision = decideSourceSelection({
      cards: [
        card({ source_path: "a.md", rank: 1 }),
        card({ source_path: "b.md", rank: 2 }),
      ],
      aboutness: [
        obs("a.md", 1, "unsupported"),
        obs("b.md", 2, "unsupported"),
      ],
      query_intent: "broad_domain",
    });
    expect(decision.fail_closed).toBe(true);
    expect(decision.selected_sources).toEqual([]);
  });

  it("returns score margins between selected sources", () => {
    const decision = decideSourceSelection({
      cards: [
        card({ source_path: "a.md", rank: 1 }),
        card({ source_path: "b.md", rank: 2 }),
        card({ source_path: "c.md", rank: 3 }),
      ],
      aboutness: [
        obs("a.md", 1, "covers"),
        obs("b.md", 2, "partial"),
        obs("c.md", 3, "adjacent"),
      ],
      query_intent: "broad_domain",
    });
    const ranks = decision.selected_sources.map((s) => s.score);
    // Strictly descending — covers > partial > adjacent.
    expect(ranks[0]).toBeGreaterThan(ranks[1]);
    expect(ranks[1]).toBeGreaterThan(ranks[2]);
    expect(decision.top1_top2_margin).toBeGreaterThan(0);
  });

  it("keeps example promotion below a supported concept on broad queries", () => {
    const decision = decideSourceSelection({
      cards: [
        card({
          source_path: "docs/concepts/cache.md",
          rank: 2,
          query_tokens: ["cache"],
          profile_signals: {
            title: "Cache",
            doc_purpose: "concept",
            doc_role: "canonical",
            heading_count: 4,
            alias_kinds: ["title", "filename"],
            has_intro: true,
          },
        }),
        card({
          source_path: "docs/examples/cache-basic.md",
          rank: 1,
          query_tokens: ["cache"],
          profile_signals: {
            title: "Cache example",
            doc_purpose: "example",
            doc_role: "canonical",
            heading_count: 3,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
      ],
      aboutness: [
        obs("docs/concepts/cache.md", 2, "covers", [], 0.6),
        obs("docs/examples/cache-basic.md", 1, "partial", [], 0.4),
      ],
      query_intent: "broad_domain",
    });
    expect(decision.selected_sources[0].source_path).toBe("docs/concepts/cache.md");
    expect(decision.selected_sources[1].reason_codes).toContain(
      "example_for_broad_domain_promoted",
    );
  });

  it("does not promote examples when no supported concept is present", () => {
    const decision = decideSourceSelection({
      cards: [
        card({
          source_path: "docs/examples/cache-basic.md",
          rank: 1,
          query_tokens: ["cache"],
          profile_signals: {
            title: "Cache example",
            doc_purpose: "example",
            doc_role: "canonical",
            heading_count: 3,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
        card({
          source_path: "docs/reference/cache-fields.md",
          rank: 2,
          query_tokens: ["cache"],
          profile_signals: {
            title: "Cache fields",
            doc_purpose: "api_reference",
            doc_role: "canonical",
            heading_count: 8,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
      ],
      aboutness: [
        obs("docs/examples/cache-basic.md", 1, "partial", [], 0.4),
        obs("docs/reference/cache-fields.md", 2, "covers", [], 0.7),
      ],
      query_intent: "broad_domain",
    });
    expect(decision.selected_sources[0].source_path).toBe(
      "docs/reference/cache-fields.md",
    );
    expect(decision.selected_sources[1].reason_codes).not.toContain(
      "example_for_broad_domain_promoted",
    );
  });

  it("preserves a changelog source for natural-language release queries (THO-V4 query-shape fix)", () => {
    // Each query shape must trigger changelog preservation. The previous
    // detector only matched stemmed words ("changelog", "releas", etc.),
    // missing the most common natural phrasing where the user says "what
    // changed in X v3" / "what's new in X".
    const queryShapes = [
      "what changed in router v3",
      "whats new in router 3.0",
      "router 3.0 release notes",
      "router migration to v3",
      "router upgrade to v3",
      "breaking changes in router 3",
    ];
    for (const query of queryShapes) {
      const decision = decideSourceSelection({
        cards: [
          card({
            source_path: "packages/router/CHANGELOG.md",
            rank: 5,
            query_tokens: tokenizeForRerankExpr(query),
            profile_signals: {
              title: "Router changelog",
              doc_purpose: "changelog",
              doc_role: "canonical",
              heading_count: 4,
              alias_kinds: ["title"],
              has_intro: true,
            },
          }),
          card({
            source_path: "packages/router/README.md",
            rank: 1,
            query_tokens: tokenizeForRerankExpr(query),
            profile_signals: {
              title: "Router",
              doc_purpose: "package_readme",
              doc_role: "canonical",
              heading_count: 6,
              alias_kinds: ["title"],
              has_intro: true,
            },
          }),
        ],
        aboutness: [
          obs("packages/router/CHANGELOG.md", 5, "covers", [
            "changelog_release_intent",
          ]),
          obs("packages/router/README.md", 1, "partial"),
        ],
        query_intent: "broad_domain",
      });
      expect(decision.selected_sources[0].source_path).toBe(
        "packages/router/CHANGELOG.md",
      );
      expect(decision.selected_sources[0].reason_codes).toContain(
        "changelog_release_intent_preserved",
      );
    }
  });

  it("promotes a card whose title is the exact query phrase, regardless of doc_purpose (V4.2)", () => {
    // Reason: profile classification is noisy on real corpora. A primitive
    // that only depends on title-equals-query should fire even when
    // doc_purpose is missing or wrong.
    const decision = decideSourceSelection({
      cards: [
        card({
          source_path: "docs/reference/configuration.md",
          rank: 1,
          query_tokens: tokenizeForRerankExpr("globs"),
          query_intent: "file_anchored",
          profile_signals: {
            title: "Configuration",
            doc_purpose: "api_reference",
            doc_role: "canonical",
            heading_count: 12,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
        card({
          source_path: "docs/reference/globs.md",
          rank: 5,
          query_tokens: tokenizeForRerankExpr("globs"),
          query_intent: "file_anchored",
          profile_signals: {
            title: "Globs",
            // doc_purpose intentionally "unknown" — the target's profile
            // classification is missing.
            doc_purpose: "unknown",
            doc_role: "canonical",
            heading_count: 4,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
      ],
      aboutness: [
        // No guide_vs_reference reason fires because target is "unknown".
        obs("docs/reference/configuration.md", 1, "partial"),
        obs("docs/reference/globs.md", 5, "covers"),
      ],
      query_intent: "file_anchored",
    });
    expect(decision.selected_sources[0].source_path).toBe(
      "docs/reference/globs.md",
    );
    expect(decision.selected_sources[0].reason_codes).toContain(
      "title_exact_match_promoted",
    );
  });

  it("does not promote when multiple cards have title-equals-query (ambiguous)", () => {
    // Two cards with the same title — the primitive should refuse to break
    // the tie (deterministic precision floor).
    const decision = decideSourceSelection({
      cards: [
        card({
          source_path: "docs/server/nextjs.md",
          rank: 1,
          query_tokens: tokenizeForRerankExpr("nextjs"),
          query_intent: "file_anchored",
          profile_signals: {
            title: "Nextjs",
            doc_purpose: "guide",
            doc_role: "canonical",
            heading_count: 3,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
        card({
          source_path: "docs/client/nextjs.md",
          rank: 2,
          query_tokens: tokenizeForRerankExpr("nextjs"),
          query_intent: "file_anchored",
          profile_signals: {
            title: "Nextjs",
            doc_purpose: "guide",
            doc_role: "canonical",
            heading_count: 3,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
      ],
      aboutness: [
        obs("docs/server/nextjs.md", 1, "partial"),
        obs("docs/client/nextjs.md", 2, "partial"),
      ],
      query_intent: "file_anchored",
    });
    expect(decision.selected_sources[0].reason_codes).not.toContain(
      "title_exact_match_promoted",
    );
  });

  it("does not flip a fail-closed decision when one card has missing reasons", () => {
    const decision = decideSourceSelection({
      cards: [card({ source_path: "a.md", rank: 1 })],
      aboutness: [obs("a.md", 1, "unsupported", [])],
      query_intent: "signal_empty",
    });
    expect(decision.fail_closed).toBe(true);
    expect(decision.selected_sources).toEqual([]);
  });
});
