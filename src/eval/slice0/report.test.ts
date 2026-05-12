import { describe, it, expect } from "vitest";
import {
  aggregateSlice0Report,
  renderSlice0Markdown,
  type Slice0CaseObservation,
  type Slice0RepoCapture,
} from "./report.js";
import type { Slice0SeparabilityFeatures } from "./separability.js";

function sep(
  top1: number,
  conf: "confident" | "uncertain" | "empty",
  reason: Slice0SeparabilityFeatures["available"]["confidence_reason"] = "score_above_confident_floor",
): Slice0SeparabilityFeatures {
  return {
    available: {
      coverage_confidence: conf,
      confidence_reason: reason,
      query_mode: "unanchored",
      warning_kinds: [],
      ranked_count: 1,
      top1_score: top1,
      top1_top2_margin: 0,
      top1_top3_margin: 0,
      top1_features: null,
    },
    unavailable: {
      retriever_agreement: "unavailable_in_slice_0",
      source_alias_hit_count: "unavailable_in_slice_0",
      dense_sparse_agreement: "unavailable_in_slice_0",
      generated_question_agreement: "unavailable_in_slice_0",
      source_purpose_compatibility: "unavailable_in_slice_0",
    },
  };
}

function answerable(id: string, opts: {
  intent?: string;
  in_top_50: boolean;
  all_critical_in_top_50: boolean;
  top1_acceptable: boolean;
  top3_acceptable: boolean;
}): Slice0CaseObservation {
  return {
    id,
    repo: "test",
    expectation_kind: "deterministic",
    is_critical: true,
    expected_query_mode: "unanchored",
    query_intent: (opts.intent ?? "broad_domain") as Slice0CaseObservation["query_intent"],
    must_include_sources: ["docs/expected.md"],
    expected_top_source: "docs/expected.md",
    acceptable_top_sources: ["docs/expected.md"],
    chunk_candidates: [],
    source_candidates: [],
    source_recall: {
      expected_source_rank: opts.in_top_50 ? 5 : null,
      expected_source_recall_at_10: opts.in_top_50,
      expected_source_recall_at_20: opts.in_top_50,
      expected_source_recall_at_50: opts.in_top_50,
      critical_source_recall_at_10: { found: opts.all_critical_in_top_50 ? 1 : 0, total: 1 },
      critical_source_recall_at_20: { found: opts.all_critical_in_top_50 ? 1 : 0, total: 1 },
      critical_source_recall_at_50: { found: opts.all_critical_in_top_50 ? 1 : 0, total: 1 },
      all_critical_sources_covered_at_10: opts.all_critical_in_top_50,
      all_critical_sources_covered_at_20: opts.all_critical_in_top_50,
      all_critical_sources_covered_at_50: opts.all_critical_in_top_50,
      missing_critical_sources_at_10: opts.all_critical_in_top_50 ? [] : ["docs/expected.md"],
      missing_critical_sources_at_20: opts.all_critical_in_top_50 ? [] : ["docs/expected.md"],
      missing_critical_sources_at_50: opts.all_critical_in_top_50 ? [] : ["docs/expected.md"],
    },
    oracle: {
      oracle_source_top1_at_50: opts.in_top_50,
      oracle_all_critical_sources_at_50: opts.all_critical_in_top_50,
      oracle_answerable_success_at_50: opts.in_top_50 && opts.all_critical_in_top_50,
      oracle_failure_reason: opts.in_top_50 ? null : "expected_source_absent",
      actual_top_source_acceptable: opts.top1_acceptable,
    },
    loss: {
      post_threshold_critical_recall_at_50: { found: 1, total: 1 },
      post_pack_critical_recall_at_50: { found: 1, total: 1 },
      source_to_threshold_loss: [],
      threshold_to_pack_loss: [],
      budget_loss_sources: [],
    },
    separability: sep(0.7, "confident"),
    actual_top1_acceptable: opts.top1_acceptable,
    actual_top3_acceptable: opts.top3_acceptable,
  };
}

function unsupported(id: string, conf: "confident" | "uncertain" | "empty"): Slice0CaseObservation {
  return {
    id,
    repo: "test",
    expectation_kind: "signal_empty",
    is_critical: false,
    expected_query_mode: "unanchored",
    query_intent: "broad_domain",
    must_include_sources: [],
    expected_top_source: "",
    acceptable_top_sources: [],
    chunk_candidates: [],
    source_candidates: [],
    source_recall: {
      expected_source_rank: null,
      expected_source_recall_at_10: false,
      expected_source_recall_at_20: false,
      expected_source_recall_at_50: false,
      critical_source_recall_at_10: null,
      critical_source_recall_at_20: null,
      critical_source_recall_at_50: null,
      all_critical_sources_covered_at_10: null,
      all_critical_sources_covered_at_20: null,
      all_critical_sources_covered_at_50: null,
      missing_critical_sources_at_10: null,
      missing_critical_sources_at_20: null,
      missing_critical_sources_at_50: null,
    },
    oracle: {
      oracle_source_top1_at_50: null,
      oracle_all_critical_sources_at_50: null,
      oracle_answerable_success_at_50: null,
      oracle_failure_reason: null,
      actual_top_source_acceptable: null,
    },
    loss: {
      post_threshold_critical_recall_at_50: null,
      post_pack_critical_recall_at_50: null,
      source_to_threshold_loss: null,
      threshold_to_pack_loss: null,
      budget_loss_sources: null,
    },
    separability: sep(conf === "confident" ? 0.6 : conf === "uncertain" ? 0.2 : 0.0, conf),
    actual_top1_acceptable: false,
    actual_top3_acceptable: false,
  };
}

describe("aggregateSlice0Report", () => {
  it("aggregates answerable and unsupported cases separately", () => {
    const captures: Slice0RepoCapture[] = [
      {
        repo: "test",
        cases: [
          answerable("a1", { in_top_50: true, all_critical_in_top_50: true, top1_acceptable: true, top3_acceptable: true }),
          answerable("a2", { in_top_50: true, all_critical_in_top_50: true, top1_acceptable: false, top3_acceptable: true }),
          answerable("a3", { in_top_50: false, all_critical_in_top_50: false, top1_acceptable: false, top3_acceptable: false }),
          unsupported("u1", "empty"),
          unsupported("u2", "uncertain"),
        ],
      },
    ];
    const report = aggregateSlice0Report({
      captures,
      synthetic_regression: false,
      generated_at: "2026-05-08T00:00:00Z",
    });
    expect(report.case_count).toBe(5);
    expect(report.answerable_cases).toBe(3);
    expect(report.unsupported_cases).toBe(2);
    // 2 of 3 answerable cases have all critical sources covered@50.
    expect(report.metrics.critical_source_set_recall_at_50_rate).toBeCloseTo(2 / 3);
    // top-1 acceptable: 1/3
    expect(report.metrics.actual_top_source_top1_acceptable_rate).toBeCloseTo(1 / 3);
    // top-3 acceptable: 2/3
    expect(report.metrics.actual_top_source_top3_acceptable_rate).toBeCloseTo(2 / 3);
    expect(report.metrics.synthetic_regression).toBe(false);
    // Branch decision is included.
    expect(report.branch_decision.primary_branch).toBeDefined();
  });

  it("synthetic regression forces stop_fix_regression branch", () => {
    const captures: Slice0RepoCapture[] = [
      {
        repo: "test",
        cases: [
          answerable("a1", { in_top_50: true, all_critical_in_top_50: true, top1_acceptable: true, top3_acceptable: true }),
        ],
      },
    ];
    const report = aggregateSlice0Report({
      captures,
      synthetic_regression: true,
      generated_at: "2026-05-08T00:00:00Z",
    });
    expect(report.branch_decision.primary_branch).toBe("stop_fix_regression");
  });

  it("computes per-repo and per-intent breakdowns", () => {
    const captures: Slice0RepoCapture[] = [
      {
        repo: "alpha",
        cases: [
          answerable("a1", { intent: "broad_domain", in_top_50: true, all_critical_in_top_50: true, top1_acceptable: true, top3_acceptable: true }),
          answerable("a2", { intent: "exact_symbol", in_top_50: false, all_critical_in_top_50: false, top1_acceptable: false, top3_acceptable: false }),
        ],
      },
      {
        repo: "beta",
        cases: [
          answerable("b1", { intent: "broad_domain", in_top_50: true, all_critical_in_top_50: true, top1_acceptable: true, top3_acceptable: true }),
        ],
      },
    ];
    const report = aggregateSlice0Report({
      captures,
      synthetic_regression: false,
      generated_at: "2026-05-08T00:00:00Z",
    });
    expect(report.per_repo.alpha?.answerable_cases).toBe(2);
    expect(report.per_repo.beta?.answerable_cases).toBe(1);
    expect(report.per_intent.broad_domain?.answerable_cases).toBe(2);
    expect(report.per_intent.exact_symbol?.answerable_cases).toBe(1);
  });

  it("classifies each critical-source miss by failure layer (THO-134)", () => {
    // Three critical observations failing at different layers.
    const cases: Slice0CaseObservation[] = [
      // a-display: source is packed but missed displayed top-3.
      {
        ...answerable("a-display", {
          in_top_50: true,
          all_critical_in_top_50: true,
          top1_acceptable: false,
          top3_acceptable: false,
        }),
        source_candidates: [
          {
            rank: 1,
            source_path: "docs/expected.md",
            best_chunk_rank: 1,
            best_chunk_score: 0.9,
            contributing_chunks: [],
          },
        ],
        loss: {
          post_threshold_critical_recall_at_50: { found: 1, total: 1 },
          post_pack_critical_recall_at_50: { found: 1, total: 1 },
          source_to_threshold_loss: [],
          threshold_to_pack_loss: [],
          budget_loss_sources: [],
        },
        displayed_top3_sources: ["docs/other.md"],
      },
      // a-pack: source above threshold but not packed.
      {
        ...answerable("a-pack", {
          in_top_50: true,
          all_critical_in_top_50: true,
          top1_acceptable: false,
          top3_acceptable: false,
        }),
        source_candidates: [
          {
            rank: 4,
            source_path: "docs/expected.md",
            best_chunk_rank: 4,
            best_chunk_score: 0.5,
            contributing_chunks: [],
          },
        ],
        loss: {
          post_threshold_critical_recall_at_50: { found: 1, total: 1 },
          post_pack_critical_recall_at_50: { found: 0, total: 1 },
          source_to_threshold_loss: [],
          threshold_to_pack_loss: ["docs/expected.md"],
          budget_loss_sources: ["docs/expected.md"],
        },
        displayed_top3_sources: [],
      },
      // a-absent: source not in candidate set at all.
      {
        ...answerable("a-absent", {
          in_top_50: false,
          all_critical_in_top_50: false,
          top1_acceptable: false,
          top3_acceptable: false,
        }),
        source_candidates: [],
        loss: {
          post_threshold_critical_recall_at_50: { found: 0, total: 1 },
          post_pack_critical_recall_at_50: { found: 0, total: 1 },
          source_to_threshold_loss: [],
          threshold_to_pack_loss: [],
          budget_loss_sources: [],
        },
        displayed_top3_sources: [],
      },
    ];
    const report = aggregateSlice0Report({
      captures: [{ repo: "test", cases }],
      synthetic_regression: false,
      generated_at: "2026-05-08T00:00:00Z",
    });
    const layers = Object.fromEntries(
      report.observations.map((o) => [o.id, o.failure_layer?.layer]),
    );
    expect(layers["a-display"]).toBe("display_loss");
    expect(layers["a-pack"]).toBe("pack_loss");
    expect(layers["a-absent"]).toBe("absent_from_candidates");
    // Aggregated histogram.
    expect(report.failure_layer_counts).toMatchObject({
      display_loss: 1,
      pack_loss: 1,
      absent_from_candidates: 1,
    });
  });

  it("classifies a critical-source miss as 'not_imported' when imported_sources lacks it (THO-135)", () => {
    const cases: Slice0CaseObservation[] = [
      {
        ...answerable("a-not-imported", {
          in_top_50: false,
          all_critical_in_top_50: false,
          top1_acceptable: false,
          top3_acceptable: false,
        }),
        source_candidates: [],
        loss: {
          post_threshold_critical_recall_at_50: { found: 0, total: 1 },
          post_pack_critical_recall_at_50: { found: 0, total: 1 },
          source_to_threshold_loss: [],
          threshold_to_pack_loss: [],
          budget_loss_sources: [],
        },
        displayed_top3_sources: [],
        imported_sources: ["docs/other.md"],
      },
    ];
    const report = aggregateSlice0Report({
      captures: [{ repo: "test", cases }],
      synthetic_regression: false,
      generated_at: "2026-05-08T00:00:00Z",
    });
    expect(report.observations[0].failure_layer?.layer).toBe("not_imported");
    expect(report.failure_layer_counts?.not_imported).toBe(1);
  });

  it("populates V3 source-selection diagnostics per case (THO-143)", () => {
    const cases: Slice0CaseObservation[] = [
      // Display loss with parent-vs-leaf relationship.
      {
        ...answerable("a-parent-leaf", {
          in_top_50: true,
          all_critical_in_top_50: true,
          top1_acceptable: false,
          top3_acceptable: false,
        }),
        must_include_sources: ["docs/concepts/middleware.md"],
        source_candidates: [
          {
            rank: 4,
            source_path: "docs/concepts/middleware.md",
            best_chunk_rank: 4,
            best_chunk_score: 0.4,
            contributing_chunks: [],
          },
        ],
        displayed_top3_sources: [
          "docs/concepts/middleware/builtin/cors.md",
          "docs/concepts/middleware/builtin/jwt.md",
          "docs/concepts/middleware/guides/create.md",
        ],
      },
      // Clean — required source is in displayed top-3.
      {
        ...answerable("a-clean", {
          in_top_50: true,
          all_critical_in_top_50: true,
          top1_acceptable: true,
          top3_acceptable: true,
        }),
        displayed_top3_sources: ["docs/expected.md", "docs/other.md"],
      },
    ];
    const report = aggregateSlice0Report({
      captures: [{ repo: "test", cases }],
      synthetic_regression: false,
      generated_at: "2026-05-08T00:00:00Z",
    });
    const byId = Object.fromEntries(
      report.observations.map((o) => [o.id, o]),
    );
    expect(byId["a-parent-leaf"].must_include_top3).toBe(false);
    expect(byId["a-parent-leaf"].source_selection_loss?.category).toBe(
      "parent_vs_leaf",
    );
    expect(byId["a-clean"].must_include_top3).toBe(true);
    expect(byId["a-clean"].source_selection_loss?.category).toBe("none");
    expect(report.source_selection_metrics?.display_loss_count).toBe(1);
    expect(
      report.source_selection_metrics?.loss_category_counts.parent_vs_leaf,
    ).toBe(1);
  });

  it("counts false-confident unsupported cases for the branch decision", () => {
    const captures: Slice0RepoCapture[] = [
      {
        repo: "test",
        cases: [
          unsupported("u1", "confident"),
          unsupported("u2", "confident"),
          unsupported("u3", "confident"),
          unsupported("u4", "empty"),
        ],
      },
    ];
    const report = aggregateSlice0Report({
      captures,
      synthetic_regression: false,
      generated_at: "2026-05-08T00:00:00Z",
    });
    expect(report.metrics.false_confident_unsupported).toBe(3);
    // Above the THO-124 tolerance, branch must still flag confidence work.
    expect(report.branch_decision.primary_branch).toBe("confidence_or_abstention");
  });
});

describe("renderSlice0Markdown", () => {
  it("includes branch decision and headline metrics", () => {
    const captures: Slice0RepoCapture[] = [
      {
        repo: "test",
        cases: [
          answerable("a1", { in_top_50: true, all_critical_in_top_50: true, top1_acceptable: true, top3_acceptable: true }),
        ],
      },
    ];
    const report = aggregateSlice0Report({
      captures,
      synthetic_regression: false,
      generated_at: "2026-05-08T00:00:00Z",
    });
    const md = renderSlice0Markdown(report);
    expect(md).toContain("# Retrieval Engine V2 Slice 0");
    expect(md).toContain("Branch decision");
    expect(md).toContain(report.branch_decision.primary_branch);
    expect(md).toContain("critical-source-set recall");
  });

  it("renders a Failure layers histogram and tags the Top misses table (THO-134)", () => {
    const cases: Slice0CaseObservation[] = [
      {
        ...answerable("a-absent", {
          in_top_50: false,
          all_critical_in_top_50: false,
          top1_acceptable: false,
          top3_acceptable: false,
        }),
        source_candidates: [],
        loss: {
          post_threshold_critical_recall_at_50: { found: 0, total: 1 },
          post_pack_critical_recall_at_50: { found: 0, total: 1 },
          source_to_threshold_loss: [],
          threshold_to_pack_loss: [],
          budget_loss_sources: [],
        },
        displayed_top3_sources: [],
      },
    ];
    const md = renderSlice0Markdown(
      aggregateSlice0Report({
        captures: [{ repo: "test", cases }],
        synthetic_regression: false,
        generated_at: "2026-05-08T00:00:00Z",
      }),
    );
    expect(md).toContain("Failure layers");
    expect(md).toContain("absent_from_candidates");
    // Top misses row should carry the layer.
    const missesSection = md.split("## Top misses")[1] ?? "";
    expect(missesSection).toContain("Layer");
    expect(missesSection).toContain("absent_from_candidates");
  });

  it("renders a V3 source-selection section with display-loss counts (THO-143)", () => {
    const cases: Slice0CaseObservation[] = [
      {
        ...answerable("a-parent", {
          in_top_50: true,
          all_critical_in_top_50: true,
          top1_acceptable: false,
          top3_acceptable: false,
        }),
        must_include_sources: ["docs/concepts/middleware.md"],
        source_candidates: [
          {
            rank: 4,
            source_path: "docs/concepts/middleware.md",
            best_chunk_rank: 4,
            best_chunk_score: 0.4,
            contributing_chunks: [],
          },
        ],
        displayed_top3_sources: [
          "docs/concepts/middleware/builtin/cors.md",
          "docs/concepts/middleware/builtin/jwt.md",
          "docs/concepts/middleware/guides/create.md",
        ],
      },
    ];
    const md = renderSlice0Markdown(
      aggregateSlice0Report({
        captures: [{ repo: "test", cases }],
        synthetic_regression: false,
        generated_at: "2026-05-08T00:00:00Z",
      }),
    );
    expect(md).toContain("Source-selection (PRD-0014 V3.1)");
    expect(md).toContain("must_include_top3 rate");
    expect(md).toContain("parent_vs_leaf");
    expect(md).toContain("display losses");
  });

  it("renders V3 release gates with combined+holdout floors (THO-149)", () => {
    const cases: Slice0CaseObservation[] = [
      answerable("a1", {
        in_top_50: true,
        all_critical_in_top_50: true,
        top1_acceptable: true,
        top3_acceptable: true,
      }),
    ];
    const report = aggregateSlice0Report({
      captures: [{ repo: "test", cases }],
      synthetic_regression: false,
      generated_at: "2026-05-08T00:00:00Z",
    });
    const md = renderSlice0Markdown(report);
    expect(md).toContain("V3 release gates");
    expect(md).toContain("must_include missing reduced");
    expect(report.v3_release_gates).toBeDefined();
  });

  it("renders a confidence diagnostics section for unsupported cases (THO-123)", () => {
    const captures: Slice0RepoCapture[] = [
      {
        repo: "test",
        cases: [
          {
            ...unsupported("u-false-confident", "confident"),
            separability: sep(0.93, "confident", "score_above_confident_floor"),
          },
          {
            ...unsupported("u-honest", "uncertain"),
            separability: sep(0.84, "uncertain", "low_confidence_warning"),
          },
        ],
      },
    ];
    const report = aggregateSlice0Report({
      captures,
      synthetic_regression: false,
      generated_at: "2026-05-08T00:00:00Z",
    });
    const md = renderSlice0Markdown(report);
    expect(md).toContain("Confidence diagnostics");
    expect(md).toContain("u-false-confident");
    expect(md).toContain("score_above_confident_floor");
    expect(md).toContain("low_confidence_warning");
  });
});
