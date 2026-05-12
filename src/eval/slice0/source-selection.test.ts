/**
 * THO-143 / PRD-0014 V3.1 — source-selection diagnostics.
 *
 * The V2.5 ceiling decision is `source_scoring`: candidates and abstention are
 * fine, the engine still fails to put declared `must_include_sources` into the
 * displayed top-3 in 13 cases. V3.1 adds:
 *
 *   1. `must_include_top3` — separate fact from `acceptable_top3`.
 *   2. Stable loss categories that explain *why* a required source was lost.
 *   3. Aggregate counters and a display-loss gate that future V3 slices can
 *      tighten without re-deriving the per-case classification.
 */
import { describe, expect, it } from "vitest";
import {
  aggregateSourceSelectionMetrics,
  classifySourceSelectionLoss,
  evaluateV3ReleaseGates,
  evaluateV3SourceSelectionGates,
  mustIncludeTop3,
  SOURCE_SELECTION_LOSS_CATEGORIES,
  type SourceSelectionAggregateInputCase,
  type SourceSelectionLossCategory,
} from "./source-selection.js";

describe("mustIncludeTop3", () => {
  it("is true when every must_include source appears in displayed top-3", () => {
    const result = mustIncludeTop3({
      must_include_sources: ["docs/concepts/middleware.md"],
      displayed_top3_sources: [
        "docs/concepts/middleware.md",
        "docs/middleware/builtin/cors.md",
        "docs/guides/create.md",
      ],
    });
    expect(result).toBe(true);
  });

  it("is false when any must_include source is absent from displayed top-3", () => {
    const result = mustIncludeTop3({
      must_include_sources: ["docs/concepts/middleware.md"],
      displayed_top3_sources: [
        "docs/middleware/builtin/cors.md",
        "docs/middleware/builtin/jwt.md",
        "docs/guides/create.md",
      ],
    });
    expect(result).toBe(false);
  });

  it("only considers the displayed top-3 even when a caller passes more sources", () => {
    const result = mustIncludeTop3({
      must_include_sources: ["docs/required.md"],
      displayed_top3_sources: [
        "docs/a.md",
        "docs/b.md",
        "docs/c.md",
        "docs/required.md",
      ],
    });
    expect(result).toBe(false);
  });

  it("requires every must_include source when the set has more than one entry", () => {
    const args = {
      must_include_sources: [
        "docs/server/overview.md",
        "docs/server/authorization.md",
      ],
      displayed_top3_sources: [
        "docs/server/overview.md",
        "docs/server/procedures.md",
        "docs/server/headers.md",
      ],
    };
    expect(mustIncludeTop3(args)).toBe(false);
  });

  it("is true vacuously when there are no must_include sources", () => {
    const result = mustIncludeTop3({
      must_include_sources: [],
      displayed_top3_sources: ["docs/anything.md"],
    });
    expect(result).toBe(true);
  });
});

describe("classifySourceSelectionLoss", () => {
  it("returns `none` when every must_include source is in displayed top-3", () => {
    const result = classifySourceSelectionLoss({
      intent: "decision_lookup",
      must_include_sources: ["docs/concepts/middleware.md"],
      displayed_top3_sources: [
        "docs/concepts/middleware.md",
        "docs/middleware/builtin/cors.md",
        "docs/guides/create.md",
      ],
      candidate_rank_by_source: new Map([
        ["docs/concepts/middleware.md", 1],
      ]),
    });
    expect(result.category).toBe("none");
    expect(result.missing_source).toBeNull();
  });

  it("classifies a parent overview lost to leaf siblings", () => {
    const result = classifySourceSelectionLoss({
      intent: "decision_lookup",
      must_include_sources: ["docs/concepts/middleware.md"],
      displayed_top3_sources: [
        "docs/concepts/middleware/builtin/cors.md",
        "docs/concepts/middleware/builtin/jwt.md",
        "docs/concepts/middleware/guides/create.md",
      ],
      candidate_rank_by_source: new Map([
        ["docs/concepts/middleware.md", 4],
        ["docs/concepts/middleware/builtin/cors.md", 1],
      ]),
    });
    expect(result.category).toBe("parent_vs_leaf");
    expect(result.missing_source).toBe("docs/concepts/middleware.md");
  });

  it("classifies a decision query that lost to procedural docs", () => {
    const result = classifySourceSelectionLoss({
      intent: "decision_lookup",
      must_include_sources: ["docs/further/rpc.md"],
      displayed_top3_sources: [
        "docs/server/adapters/nextjs.md",
        "docs/server/adapters/express.md",
        "docs/server/ssr.md",
      ],
      candidate_rank_by_source: new Map([
        ["docs/further/rpc.md", 7],
        ["docs/server/adapters/nextjs.md", 1],
      ]),
      descriptor_by_source: new Map([
        ["docs/further/rpc.md", { source_path: "docs/further/rpc.md", doc_purpose: "concept" }],
        ["docs/server/adapters/nextjs.md", { source_path: "docs/server/adapters/nextjs.md", doc_purpose: "guide" }],
        ["docs/server/adapters/express.md", { source_path: "docs/server/adapters/express.md", doc_purpose: "guide" }],
        ["docs/server/ssr.md", { source_path: "docs/server/ssr.md", doc_purpose: "guide" }],
      ]),
    });
    expect(result.category).toBe("decision_vs_procedural");
  });

  it("classifies an anchored topic lost to broad api_reference docs", () => {
    const result = classifySourceSelectionLoss({
      intent: "file_anchored",
      must_include_sources: ["docs/reference/globs.md"],
      displayed_top3_sources: [
        "docs/reference/configuration.md",
        "docs/reference/package-configuration.md",
        "docs/reference/run.md",
      ],
      candidate_rank_by_source: new Map([
        ["docs/reference/globs.md", 5],
        ["docs/reference/configuration.md", 1],
      ]),
      descriptor_by_source: new Map([
        ["docs/reference/globs.md", { source_path: "docs/reference/globs.md", doc_purpose: "guide" }],
        ["docs/reference/configuration.md", { source_path: "docs/reference/configuration.md", doc_purpose: "api_reference" }],
        ["docs/reference/package-configuration.md", { source_path: "docs/reference/package-configuration.md", doc_purpose: "api_reference" }],
        ["docs/reference/run.md", { source_path: "docs/reference/run.md", doc_purpose: "api_reference" }],
      ]),
    });
    expect(result.category).toBe("anchored_exact_vs_broad");
  });

  it("classifies a changelog/release intent miss when the required source is a changelog", () => {
    const result = classifySourceSelectionLoss({
      intent: "broad_domain",
      must_include_sources: ["packages/docs-v3/CHANGELOG.md"],
      displayed_top3_sources: [
        "packages/docs-v3/README.md",
        "packages/docs-v3/optionality.md",
        "packages/docs-v3/recipes.md",
      ],
      candidate_rank_by_source: new Map([
        ["packages/docs-v3/CHANGELOG.md", 8],
        ["packages/docs-v3/README.md", 1],
      ]),
      descriptor_by_source: new Map([
        ["packages/docs-v3/CHANGELOG.md", {
          source_path: "packages/docs-v3/CHANGELOG.md",
          doc_purpose: "changelog",
        }],
      ]),
    });
    expect(result.category).toBe("changelog_release_intent");
  });

  it("classifies changelog misses from path shape even without descriptors", () => {
    const result = classifySourceSelectionLoss({
      intent: "broad_domain",
      must_include_sources: ["packages/docs-v3/CHANGELOG.md"],
      displayed_top3_sources: [
        "packages/docs-v3/README.md",
        "packages/docs-v3/optionality.md",
        "packages/docs-v3/recipes.md",
      ],
      candidate_rank_by_source: new Map([
        ["packages/docs-v3/CHANGELOG.md", 8],
        ["packages/docs-v3/README.md", 1],
      ]),
    });
    expect(result.category).toBe("changelog_release_intent");
  });

  it("classifies the candidate-recall outlier when the required source isn't in the candidate set", () => {
    const result = classifySourceSelectionLoss({
      intent: "broad_domain",
      must_include_sources: ["docs/getting-started/installation.md"],
      displayed_top3_sources: [
        "docs/getting-started/add-existing.md",
        "docs/guides/migrate.md",
        "docs/guides/tools.md",
      ],
      candidate_rank_by_source: new Map([
        ["docs/getting-started/add-existing.md", 1],
      ]),
    });
    expect(result.category).toBe("candidate_recall_outlier");
    expect(result.missing_source).toBe("docs/getting-started/installation.md");
  });

  it("classifies adjacent_sibling when displayed shares parent dir but isn't an overview/leaf relation", () => {
    const result = classifySourceSelectionLoss({
      intent: "broad_domain",
      must_include_sources: ["docs/server/adapters/nextjs.md"],
      displayed_top3_sources: [
        "docs/server/adapters/express.md",
        "docs/server/adapters/fetch.md",
        "docs/client/nextjs.md",
      ],
      candidate_rank_by_source: new Map([
        ["docs/server/adapters/nextjs.md", 4],
        ["docs/server/adapters/express.md", 1],
      ]),
    });
    expect(result.category).toBe("adjacent_sibling");
  });

  it("falls back to generic_display_loss when no specific relationship matches", () => {
    const result = classifySourceSelectionLoss({
      intent: "broad_domain",
      must_include_sources: ["a/totally-unrelated.md"],
      displayed_top3_sources: [
        "x/something.md",
        "y/other.md",
        "z/elsewhere.md",
      ],
      candidate_rank_by_source: new Map([
        ["a/totally-unrelated.md", 9],
        ["x/something.md", 1],
      ]),
    });
    expect(result.category).toBe("generic_display_loss");
  });
});

describe("aggregateSourceSelectionMetrics", () => {
  function answerable(
    id: string,
    opts: {
      must_include: string[];
      displayed_top3: string[];
      candidate_ranks?: Map<string, number>;
      intent?: SourceSelectionAggregateInputCase["intent"];
    },
  ): SourceSelectionAggregateInputCase {
    return {
      id,
      is_answerable: true,
      intent: opts.intent ?? "broad_domain",
      must_include_sources: opts.must_include,
      displayed_top3_sources: opts.displayed_top3,
      candidate_rank_by_source:
        opts.candidate_ranks ??
        new Map(opts.must_include.map((p, i) => [p, i + 1])),
    };
  }

  it("counts must_include_top3 successes across answerable cases only", () => {
    const result = aggregateSourceSelectionMetrics([
      answerable("a", {
        must_include: ["docs/x.md"],
        displayed_top3: ["docs/x.md", "docs/y.md", "docs/z.md"],
      }),
      answerable("b", {
        must_include: ["docs/x.md"],
        displayed_top3: ["docs/y.md", "docs/z.md", "docs/w.md"],
      }),
      // Unsupported / non-critical should not lower the rate.
      {
        id: "u",
        is_answerable: false,
        intent: "signal_empty",
        must_include_sources: [],
        displayed_top3_sources: ["docs/whatever.md"],
        candidate_rank_by_source: new Map(),
      },
    ]);
    expect(result.must_include_top3_passes).toBe(1);
    expect(result.must_include_top3_eligible).toBe(2);
    expect(result.must_include_top3_rate).toBeCloseTo(0.5);
  });

  it("counts display losses separately from candidate recall outliers", () => {
    const result = aggregateSourceSelectionMetrics([
      answerable("parent-loss", {
        must_include: ["docs/concepts/middleware.md"],
        displayed_top3: [
          "docs/concepts/middleware/builtin/cors.md",
          "docs/concepts/middleware/builtin/jwt.md",
          "docs/concepts/middleware/guides/create.md",
        ],
        candidate_ranks: new Map([
          ["docs/concepts/middleware.md", 4],
          ["docs/concepts/middleware/builtin/cors.md", 1],
        ]),
      }),
      answerable("recall-outlier", {
        must_include: ["docs/getting-started/installation.md"],
        displayed_top3: [
          "docs/getting-started/add-existing.md",
          "docs/guides/migrate.md",
          "docs/guides/tools.md",
        ],
        candidate_ranks: new Map([
          ["docs/getting-started/add-existing.md", 1],
        ]),
      }),
      answerable("clean", {
        must_include: ["docs/server/overview.md"],
        displayed_top3: [
          "docs/server/overview.md",
          "docs/client/overview.md",
          "docs/further/rpc.md",
        ],
      }),
    ]);
    expect(result.display_loss_count).toBe(1);
    expect(result.loss_category_counts.parent_vs_leaf).toBe(1);
    expect(result.loss_category_counts.candidate_recall_outlier).toBe(1);
    expect(result.loss_category_counts.none).toBe(1);
  });

  it("does not count unsupported cases as eligible", () => {
    const result = aggregateSourceSelectionMetrics([
      {
        id: "u-empty",
        is_answerable: false,
        intent: "signal_empty",
        must_include_sources: [],
        displayed_top3_sources: [],
        candidate_rank_by_source: new Map(),
      },
    ]);
    expect(result.must_include_top3_eligible).toBe(0);
    expect(result.must_include_top3_rate).toBe(1);
  });
});

describe("evaluateV3SourceSelectionGates", () => {
  it("passes when display losses are within budget and recall floor is held", () => {
    const result = evaluateV3SourceSelectionGates({
      display_loss_count: 4,
      display_loss_budget: 5,
      must_include_top3_rate: 0.95,
      must_include_top3_floor: 0.9,
      candidate_recall_at_50_rate: 0.992,
      candidate_recall_floor: 0.99,
      false_confident_unsupported: 0,
    });
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("fails the display-loss gate when count exceeds the budget", () => {
    const result = evaluateV3SourceSelectionGates({
      display_loss_count: 13,
      display_loss_budget: 5,
      must_include_top3_rate: 0.6,
      must_include_top3_floor: 0.9,
      candidate_recall_at_50_rate: 0.992,
      candidate_recall_floor: 0.99,
      false_confident_unsupported: 0,
    });
    expect(result.passed).toBe(false);
    const gates = result.failures.map((f) => f.gate);
    expect(gates).toContain("source_selection_display_losses");
    expect(gates).toContain("must_include_top3_floor");
  });

  it("does not let source-selection improvements hide a confidence regression", () => {
    const result = evaluateV3SourceSelectionGates({
      display_loss_count: 0,
      display_loss_budget: 5,
      must_include_top3_rate: 1.0,
      must_include_top3_floor: 0.9,
      candidate_recall_at_50_rate: 0.992,
      candidate_recall_floor: 0.99,
      false_confident_unsupported: 1,
    });
    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.gate)).toContain(
      "false_confident_unsupported",
    );
  });

  it("guards candidate recall from regressing below the V2.5 floor", () => {
    const result = evaluateV3SourceSelectionGates({
      display_loss_count: 0,
      display_loss_budget: 5,
      must_include_top3_rate: 1.0,
      must_include_top3_floor: 0.9,
      candidate_recall_at_50_rate: 0.95,
      candidate_recall_floor: 0.99,
      false_confident_unsupported: 0,
    });
    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.gate)).toContain(
      "candidate_recall_floor",
    );
  });
});

describe("evaluateV3ReleaseGates (V3.7)", () => {
  it("passes when every PRD-0014 release floor is met on both panels", () => {
    const result = evaluateV3ReleaseGates({
      combined: {
        wire_top1_rate: 0.78,
        wire_top3_rate: 0.95,
        candidate_recall_at_50_rate: 0.992,
        display_loss_count: 4,
        must_include_top3_missing_baseline: 13,
        must_include_top3_missing_current: 5,
      },
      holdout: {
        wire_top1_rate: 0.76,
        wire_top3_rate: 0.94,
        candidate_recall_at_50_rate: 0.99,
        display_loss_count: 2,
        must_include_top3_missing_baseline: 13,
        must_include_top3_missing_current: 5,
      },
      false_confident_unsupported: 0,
      unsupported_honesty_rate: 1.0,
      synthetic_regression: false,
    });
    expect(result.passed).toBe(true);
  });

  it("fails when combined wire top-1 falls below 75%", () => {
    const result = evaluateV3ReleaseGates({
      combined: {
        wire_top1_rate: 0.71, // below floor
        wire_top3_rate: 0.95,
        candidate_recall_at_50_rate: 0.992,
        display_loss_count: 4,
        must_include_top3_missing_baseline: 13,
        must_include_top3_missing_current: 5,
      },
      holdout: {
        wire_top1_rate: 0.76,
        wire_top3_rate: 0.94,
        candidate_recall_at_50_rate: 0.99,
        display_loss_count: 2,
        must_include_top3_missing_baseline: 13,
        must_include_top3_missing_current: 5,
      },
      false_confident_unsupported: 0,
      unsupported_honesty_rate: 1.0,
      synthetic_regression: false,
    });
    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.gate)).toContain(
      "combined_wire_top1",
    );
  });

  it("fails when must_include_top3 missing did not drop ≥60%", () => {
    const result = evaluateV3ReleaseGates({
      combined: {
        wire_top1_rate: 0.78,
        wire_top3_rate: 0.95,
        candidate_recall_at_50_rate: 0.992,
        display_loss_count: 4,
        must_include_top3_missing_baseline: 13,
        // Only 23% reduction — below 60% floor.
        must_include_top3_missing_current: 10,
      },
      holdout: {
        wire_top1_rate: 0.76,
        wire_top3_rate: 0.94,
        candidate_recall_at_50_rate: 0.99,
        display_loss_count: 2,
        must_include_top3_missing_baseline: 13,
        must_include_top3_missing_current: 5,
      },
      false_confident_unsupported: 0,
      unsupported_honesty_rate: 1.0,
      synthetic_regression: false,
    });
    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.gate)).toContain(
      "must_include_missing_reduction",
    );
  });

  it("fails when synthetic regression is set", () => {
    const result = evaluateV3ReleaseGates({
      combined: {
        wire_top1_rate: 0.78,
        wire_top3_rate: 0.95,
        candidate_recall_at_50_rate: 0.992,
        display_loss_count: 4,
        must_include_top3_missing_baseline: 13,
        must_include_top3_missing_current: 5,
      },
      holdout: {
        wire_top1_rate: 0.76,
        wire_top3_rate: 0.94,
        candidate_recall_at_50_rate: 0.99,
        display_loss_count: 2,
        must_include_top3_missing_baseline: 13,
        must_include_top3_missing_current: 5,
      },
      false_confident_unsupported: 0,
      unsupported_honesty_rate: 1.0,
      synthetic_regression: true,
    });
    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.gate)).toContain(
      "synthetic_regression",
    );
  });

  it("fails when unsupported honesty drops below 100%", () => {
    const result = evaluateV3ReleaseGates({
      combined: {
        wire_top1_rate: 0.78,
        wire_top3_rate: 0.95,
        candidate_recall_at_50_rate: 0.992,
        display_loss_count: 4,
        must_include_top3_missing_baseline: 13,
        must_include_top3_missing_current: 5,
      },
      holdout: {
        wire_top1_rate: 0.76,
        wire_top3_rate: 0.94,
        candidate_recall_at_50_rate: 0.99,
        display_loss_count: 2,
        must_include_top3_missing_baseline: 13,
        must_include_top3_missing_current: 5,
      },
      false_confident_unsupported: 0,
      unsupported_honesty_rate: 0.95,
      synthetic_regression: false,
    });
    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.gate)).toContain(
      "unsupported_honesty",
    );
  });
});

describe("source selection loss category enum", () => {
  it("includes the named PRD-0014 categories", () => {
    const names: SourceSelectionLossCategory[] = [
      "none",
      "candidate_recall_outlier",
      "parent_vs_leaf",
      "decision_vs_procedural",
      "anchored_exact_vs_broad",
      "overview_vs_reference",
      "adjacent_sibling",
      "changelog_release_intent",
      "generic_display_loss",
    ];
    for (const name of names) {
      expect(SOURCE_SELECTION_LOSS_CATEGORIES).toContain(name);
    }
  });
});
