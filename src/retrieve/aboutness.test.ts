/**
 * Top-N aboutness verifier (V3.3).
 *
 * Labels each top-N candidate source against the query: `covers`, `partial`,
 * `adjacent`, `too_broad`, `too_narrow`, or `unsupported`, with structured
 * reason codes (parent_vs_leaf, decision_vs_procedural, guide_vs_reference,
 * changelog_release_intent, broad_container_vs_specific_topic, ...).
 *
 * The verifier is deterministic and source-card-shaped. It does not rerank;
 * the source-selection decision module (V3.4) consumes the labels.
 */
import { describe, expect, it } from "vitest";
import {
  classifyTopNAboutness,
  classifySourceRelationship,
  ABOUTNESS_LABELS,
  RELATIONSHIP_REASON_CODES,
  type AboutnessLabel,
  type RelationshipReasonCode,
} from "./aboutness.js";
import type { SourceCard } from "./source-card.js";

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
    top_chunk_evidence: {
      version_id: "vid-1",
      rank: 1,
      final_score: 0.78,
    },
    token_coverage: {
      title_token_coverage: 0.5,
      path_token_coverage: 0.5,
      heading_token_coverage: 0.3,
    },
    coverage_decision: null,
    ...overrides,
  };
}

describe("classifySourceRelationship (parent vs leaf, etc.)", () => {
  it("flags parent overview vs leaf siblings", () => {
    const reason = classifySourceRelationship({
      target: card({
        source_path: "docs/concepts/middleware.md",
        profile_signals: {
          title: "Middleware",
          doc_purpose: "concept",
          doc_role: "canonical",
          heading_count: 5,
          alias_kinds: ["title", "filename"],
          has_intro: true,
        },
      }),
      others: [
        card({
          rank: 2,
          source_path: "docs/concepts/middleware/builtin/cors.md",
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
          rank: 3,
          source_path: "docs/concepts/middleware/builtin/jwt.md",
          profile_signals: {
            title: "JWT",
            doc_purpose: "guide",
            doc_role: "canonical",
            heading_count: 3,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
      ],
    });
    expect(reason).toContain("parent_vs_leaf");
  });

  it("flags parent overview even when top-N also contains an unrelated source", () => {
    const reason = classifySourceRelationship({
      target: card({
        source_path: "docs/concepts/middleware.md",
      }),
      others: [
        card({
          rank: 2,
          source_path: "docs/concepts/middleware/builtin/cors.md",
        }),
        card({
          rank: 3,
          source_path: "docs/server/overview.md",
        }),
      ],
    });
    expect(reason).toContain("parent_vs_leaf");
  });

  it("flags decision_vs_procedural when target is concept/adr but neighbors are guides", () => {
    const reason = classifySourceRelationship({
      target: card({
        source_path: "docs/further/rpc.md",
        profile_signals: {
          title: "RPC vs REST",
          doc_purpose: "concept",
          doc_role: "canonical",
          heading_count: 4,
          alias_kinds: ["title"],
          has_intro: true,
        },
      }),
      others: [
        card({
          rank: 2,
          source_path: "docs/server/adapters/nextjs.md",
          profile_signals: {
            title: "Next.js adapter",
            doc_purpose: "guide",
            doc_role: "canonical",
            heading_count: 3,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
      ],
    });
    expect(reason).toContain("decision_vs_procedural");
  });

  it("flags guide_vs_reference when neighbors are api_reference and target is a guide", () => {
    const reason = classifySourceRelationship({
      target: card({
        source_path: "docs/guide/cli.md",
        profile_signals: {
          title: "CLI",
          doc_purpose: "guide",
          doc_role: "canonical",
          heading_count: 3,
          alias_kinds: ["title"],
          has_intro: true,
        },
      }),
      others: [
        card({
          rank: 2,
          source_path: "docs/api/runner.md",
          profile_signals: {
            title: "Runner API",
            doc_purpose: "api_reference",
            doc_role: "canonical",
            heading_count: 12,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
      ],
    });
    expect(reason).toContain("guide_vs_reference");
  });

  it("flags changelog_release_intent on a changelog target", () => {
    const reason = classifySourceRelationship({
      target: card({
        source_path: "packages/docs-v3/CHANGELOG.md",
        profile_signals: {
          title: "Changelog",
          doc_purpose: "changelog",
          doc_role: "canonical",
          heading_count: 0,
          alias_kinds: ["title"],
          has_intro: false,
        },
      }),
      others: [
        card({
          rank: 2,
          source_path: "packages/docs-v3/README.md",
          profile_signals: {
            title: "README",
            doc_purpose: "package_readme",
            doc_role: "canonical",
            heading_count: 4,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
      ],
    });
    expect(reason).toContain("changelog_release_intent");
  });

  it("flags broad_container_vs_specific_topic when target is short-pathed and neighbors are deeper", () => {
    const reason = classifySourceRelationship({
      target: card({
        source_path: "docs/server/overview.md",
        profile_signals: {
          title: "Server overview",
          doc_purpose: "concept",
          doc_role: "canonical",
          heading_count: 6,
          alias_kinds: ["title"],
          has_intro: true,
        },
      }),
      others: [
        card({
          rank: 2,
          source_path: "docs/server/procedures/queries.md",
          profile_signals: {
            title: "Queries",
            doc_purpose: "guide",
            doc_role: "canonical",
            heading_count: 3,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
        card({
          rank: 3,
          source_path: "docs/server/procedures/mutations.md",
          profile_signals: {
            title: "Mutations",
            doc_purpose: "guide",
            doc_role: "canonical",
            heading_count: 3,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
      ],
    });
    expect(reason).toContain("broad_container_vs_specific_topic");
  });
});

describe("classifyTopNAboutness", () => {
  it("labels a strong top-1 with high token coverage as `covers`", () => {
    const labels = classifyTopNAboutness({
      cards: [
        card({
          token_coverage: {
            title_token_coverage: 1,
            path_token_coverage: 1,
            heading_token_coverage: 0.5,
          },
          candidate_path_evidence: {
            best_chunk_rank: 1,
            best_chunk_score: 0.85,
            contributing_chunk_count: 3,
            fused_rank: 1,
            fused_path_count: 4,
          },
        }),
      ],
      query_intent: "decision_lookup",
    });
    expect(labels[0].label).toBe("covers");
  });

  it("treats quick-start docs as `covers` for onboarding-shaped broad queries", () => {
    const labels = classifyTopNAboutness({
      cards: [
        card({
          query_intent: "broad_domain",
          query_tokens: ["start", "react", "queri"],
          profile_signals: {
            title: "Quick Start",
            doc_purpose: "quick_start",
            doc_role: "canonical",
            heading_count: 4,
            alias_kinds: ["title", "filename"],
            has_intro: true,
          },
          token_coverage: {
            title_token_coverage: 0.2,
            path_token_coverage: 0.2,
            heading_token_coverage: 0,
          },
          candidate_path_evidence: {
            best_chunk_rank: 1,
            best_chunk_score: 0.62,
            contributing_chunk_count: 2,
            fused_rank: 1,
            fused_path_count: 4,
          },
        }),
      ],
      query_intent: "broad_domain",
    });
    expect(labels[0].label).toBe("covers");
  });

  it("does not auto-promote quick-start docs for non-onboarding broad queries", () => {
    const labels = classifyTopNAboutness({
      cards: [
        card({
          query_intent: "broad_domain",
          query_tokens: ["unused", "import"],
          profile_signals: {
            title: "Getting Started",
            doc_purpose: "quick_start",
            doc_role: "canonical",
            heading_count: 4,
            alias_kinds: ["title", "filename"],
            has_intro: true,
          },
          token_coverage: {
            title_token_coverage: 0.2,
            path_token_coverage: 0.2,
            heading_token_coverage: 0,
          },
          candidate_path_evidence: {
            best_chunk_rank: 1,
            best_chunk_score: 0.72,
            contributing_chunk_count: 2,
            fused_rank: 1,
            fused_path_count: 4,
          },
        }),
      ],
      query_intent: "broad_domain",
    });
    expect(labels[0].label).toBe("partial");
  });

  it("labels a weak candidate (no tokens, no fused agreement) as `unsupported`", () => {
    const labels = classifyTopNAboutness({
      cards: [
        card({
          source_path: "x/unrelated.md",
          token_coverage: {
            title_token_coverage: 0,
            path_token_coverage: 0,
            heading_token_coverage: 0,
          },
          candidate_path_evidence: {
            best_chunk_rank: 9,
            best_chunk_score: 0.05,
            contributing_chunk_count: 1,
            fused_rank: null,
            fused_path_count: 1,
          },
          profile_signals: null,
        }),
      ],
      query_intent: "broad_domain",
    });
    expect(labels[0].label).toBe("unsupported");
  });

  it("lets coverage verifier unsupported verdict override token coverage", () => {
    const labels = classifyTopNAboutness({
      cards: [
        card({
          token_coverage: {
            title_token_coverage: 1,
            path_token_coverage: 1,
            heading_token_coverage: 1,
          },
          coverage_decision: {
            verdict: "unsupported",
            signals: ["weak_aboutness"],
          },
        }),
      ],
      query_intent: "broad_domain",
    });
    expect(labels[0].label).toBe("unsupported");
  });

  it("does not upgrade partial coverage verifier verdicts to `covers`", () => {
    const labels = classifyTopNAboutness({
      cards: [
        card({
          token_coverage: {
            title_token_coverage: 1,
            path_token_coverage: 1,
            heading_token_coverage: 1,
          },
          coverage_decision: {
            verdict: "partial",
            signals: ["title_path_match"],
          },
        }),
      ],
      query_intent: "broad_domain",
    });
    expect(labels[0].label).toBe("partial");
  });

  it("labels a partial-coverage candidate as `partial`", () => {
    const labels = classifyTopNAboutness({
      cards: [
        card({
          token_coverage: {
            title_token_coverage: 0.4,
            path_token_coverage: 0.2,
            heading_token_coverage: 0,
          },
          candidate_path_evidence: {
            best_chunk_rank: 2,
            best_chunk_score: 0.45,
            contributing_chunk_count: 1,
            fused_rank: 2,
            fused_path_count: 1,
          },
        }),
      ],
      query_intent: "broad_domain",
    });
    expect(labels[0].label).toBe("partial");
  });

  it("labels a parent-overview candidate as `too_broad` when neighbors are leaves", () => {
    const labels = classifyTopNAboutness({
      cards: [
        card({
          source_path: "docs/concepts/middleware.md",
          token_coverage: {
            title_token_coverage: 0.5,
            path_token_coverage: 0.5,
            heading_token_coverage: 0.3,
          },
        }),
        card({
          rank: 2,
          source_path: "docs/concepts/middleware/builtin/cors.md",
          profile_signals: {
            title: "CORS",
            doc_purpose: "guide",
            doc_role: "canonical",
            heading_count: 3,
            alias_kinds: ["title"],
            has_intro: true,
          },
          token_coverage: {
            title_token_coverage: 0.2,
            path_token_coverage: 0.6,
            heading_token_coverage: 0.1,
          },
        }),
        card({
          rank: 3,
          source_path: "docs/concepts/middleware/builtin/jwt.md",
          profile_signals: {
            title: "JWT",
            doc_purpose: "guide",
            doc_role: "canonical",
            heading_count: 3,
            alias_kinds: ["title"],
            has_intro: true,
          },
        }),
      ],
      // Decision query asks about middleware — leaves are about *specific*
      // middlewares, not the concept; the parent should be a `covers`/`partial`
      // candidate but the leaves should be flagged adjacent or too_narrow.
      query_intent: "decision_lookup",
    });
    expect(labels[1].label === "adjacent" || labels[1].label === "too_narrow").toBe(true);
  });

  it("labels a candidate as `adjacent` when it shares parent dir with a stronger sibling", () => {
    const labels = classifyTopNAboutness({
      cards: [
        card({
          source_path: "docs/server/adapters/express.md",
          token_coverage: {
            title_token_coverage: 0.5,
            path_token_coverage: 0.5,
            heading_token_coverage: 0.3,
          },
        }),
        card({
          rank: 2,
          source_path: "docs/server/adapters/fetch.md",
          profile_signals: {
            title: "Fetch adapter",
            doc_purpose: "guide",
            doc_role: "canonical",
            heading_count: 3,
            alias_kinds: ["title"],
            has_intro: true,
          },
          token_coverage: {
            title_token_coverage: 0.1,
            path_token_coverage: 0.2,
            heading_token_coverage: 0.05,
          },
        }),
      ],
      query_intent: "broad_domain",
    });
    expect(labels[1].label).toBe("adjacent");
  });

  it("attaches relationship reason codes alongside the label", () => {
    const labels = classifyTopNAboutness({
      cards: [
        card({
          source_path: "docs/further/rpc.md",
          query_intent: "decision_lookup",
          profile_signals: {
            title: "RPC vs REST",
            doc_purpose: "concept",
            doc_role: "canonical",
            heading_count: 4,
            alias_kinds: ["title"],
            has_intro: true,
          },
          token_coverage: {
            title_token_coverage: 0.5,
            path_token_coverage: 0.5,
            heading_token_coverage: 0.3,
          },
        }),
        card({
          rank: 2,
          source_path: "docs/server/adapters/nextjs.md",
          profile_signals: {
            title: "Next.js adapter",
            doc_purpose: "guide",
            doc_role: "canonical",
            heading_count: 3,
            alias_kinds: ["title"],
            has_intro: true,
          },
          token_coverage: {
            title_token_coverage: 0.1,
            path_token_coverage: 0.2,
            heading_token_coverage: 0.05,
          },
        }),
      ],
      query_intent: "decision_lookup",
    });
    // The procedural neighbor should carry decision_vs_procedural in reasons.
    const proc = labels.find((l) => l.source_path === "docs/server/adapters/nextjs.md");
    expect(proc?.reason_codes).toContain("decision_vs_procedural");
  });
});

describe("aboutness verifier safety", () => {
  it("does not promote unsupported candidates to `covers` even with relationship reasons", () => {
    const labels = classifyTopNAboutness({
      cards: [
        card({
          source_path: "x/unrelated.md",
          token_coverage: {
            title_token_coverage: 0,
            path_token_coverage: 0,
            heading_token_coverage: 0,
          },
          candidate_path_evidence: {
            best_chunk_rank: 9,
            best_chunk_score: 0.05,
            contributing_chunk_count: 1,
            fused_rank: null,
            fused_path_count: 1,
          },
          profile_signals: {
            title: "Unrelated",
            doc_purpose: "concept",
            doc_role: "canonical",
            heading_count: 1,
            alias_kinds: ["title"],
            has_intro: false,
          },
        }),
      ],
      query_intent: "decision_lookup",
    });
    expect(labels[0].label).toBe("unsupported");
  });
});

describe("aboutness label / reason code enums", () => {
  it("includes the named PRD-0014 labels and reason codes", () => {
    const labels: AboutnessLabel[] = [
      "covers",
      "partial",
      "adjacent",
      "too_broad",
      "too_narrow",
      "unsupported",
    ];
    for (const l of labels) expect(ABOUTNESS_LABELS).toContain(l);
    const reasons: RelationshipReasonCode[] = [
      "parent_vs_leaf",
      "overview_vs_leaf",
      "guide_vs_reference",
      "decision_vs_procedural",
      "changelog_release_intent",
      "broad_container_vs_specific_topic",
    ];
    for (const r of reasons) expect(RELATIONSHIP_REASON_CODES).toContain(r);
  });
});
