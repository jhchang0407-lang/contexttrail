/**
 * THO-140 / PRD-0013 V2.5.7 — source-rerank ablations + generalization
 * guardrails.
 *
 * The ablation harness re-aggregates per-case observations into per-mode
 * metrics. lexical_only and full_v25 are computed from already-captured
 * data; future modes are typed but report "—" until their toggle lands.
 * The point is to prevent coefficient-only ships: every scoring change must
 * map to a named ScoringInvariant.
 */
import { describe, it, expect } from "vitest";
import {
  ABLATION_MODES,
  runRetrievalAblation,
  topCompetitorDelta,
  validateScoringInvariants,
  type AblationModeResult,
  type AblationMode,
} from "./ablation.js";
import type { Slice0CaseObservation } from "./report.js";

function answerable(id: string, opts: {
  repo?: string;
  in_top_50: boolean;
  top1_acceptable: boolean;
  top3_acceptable: boolean;
  unsupported_confident?: boolean;
  expectation_kind?: "deterministic" | "ambiguous" | "signal_empty";
}): Slice0CaseObservation {
  const isSupp = (opts.expectation_kind ?? "deterministic") !== "signal_empty";
  return {
    id,
    repo: opts.repo ?? "test",
    expectation_kind: opts.expectation_kind ?? "deterministic",
    is_critical: isSupp,
    expected_query_mode: "unanchored",
    query_intent: "broad_domain",
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
      critical_source_recall_at_10: { found: opts.in_top_50 ? 1 : 0, total: 1 },
      critical_source_recall_at_20: { found: opts.in_top_50 ? 1 : 0, total: 1 },
      critical_source_recall_at_50: { found: opts.in_top_50 ? 1 : 0, total: 1 },
      all_critical_sources_covered_at_10: opts.in_top_50,
      all_critical_sources_covered_at_20: opts.in_top_50,
      all_critical_sources_covered_at_50: opts.in_top_50,
      missing_critical_sources_at_10: opts.in_top_50 ? [] : ["docs/expected.md"],
      missing_critical_sources_at_20: opts.in_top_50 ? [] : ["docs/expected.md"],
      missing_critical_sources_at_50: opts.in_top_50 ? [] : ["docs/expected.md"],
    },
    oracle: {
      oracle_source_top1_at_50: opts.in_top_50,
      oracle_all_critical_sources_at_50: opts.in_top_50,
      oracle_answerable_success_at_50: opts.in_top_50,
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
    separability: {
      available: {
        coverage_confidence: opts.unsupported_confident ? "confident" : "uncertain",
        confidence_reason: "score_above_confident_floor",
        query_mode: "unanchored",
        warning_kinds: [],
        ranked_count: 1,
        top1_score: 0.7,
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
    },
    actual_top1_acceptable: opts.top1_acceptable,
    actual_top3_acceptable: opts.top3_acceptable,
  };
}

describe("ABLATION_MODES", () => {
  it("declares the canonical generalization-discipline modes", () => {
    expect(ABLATION_MODES).toEqual([
      "lexical_only",
      "source_profile_only",
      "multi_path_only",
      "coverage_only",
      "confidence_only",
      "full_v25",
    ]);
  });
});

describe("runRetrievalAblation", () => {
  const observations = [
    answerable("a1", { in_top_50: true, top1_acceptable: true, top3_acceptable: true }),
    answerable("a2", { in_top_50: true, top1_acceptable: false, top3_acceptable: true }),
    answerable("a3", { in_top_50: false, top1_acceptable: false, top3_acceptable: false }),
  ];

  it("emits a result row per mode", () => {
    const result = runRetrievalAblation({ observations });
    expect(result.modes.map((m: AblationModeResult) => m.mode)).toEqual(ABLATION_MODES);
  });

  it("computes full_v25 from actual_top*_acceptable", () => {
    const result = runRetrievalAblation({ observations });
    const full = result.modes.find((m) => m.mode === "full_v25")!;
    expect(full.top1_rate).toBeCloseTo(1 / 3);
    expect(full.top3_rate).toBeCloseTo(2 / 3);
    expect(full.candidate_recall_at_50_rate).toBeCloseTo(2 / 3);
  });

  it("computes lexical_only from expected_source rank diagnostics", () => {
    // lexical_only top-3 = expected_source in top-3 (we approximate by
    // rank<=3 of expected source); for our fixture rank is 5 (>3), so 0/3.
    const result = runRetrievalAblation({ observations });
    const lex = result.modes.find((m) => m.mode === "lexical_only")!;
    expect(lex.top3_rate).toBeCloseTo(0);
    expect(lex.candidate_recall_at_50_rate).toBeCloseTo(2 / 3);
  });

  it("marks future-toggle modes as not_runnable when their flag is unavailable", () => {
    const result = runRetrievalAblation({ observations });
    const toggled = (mode: AblationMode) =>
      result.modes.find((m) => m.mode === mode)!.runnable;
    expect(toggled("source_profile_only")).toBe(false);
    expect(toggled("multi_path_only")).toBe(false);
    expect(toggled("coverage_only")).toBe(false);
    expect(toggled("confidence_only")).toBe(false);
    expect(toggled("lexical_only")).toBe(true);
    expect(toggled("full_v25")).toBe(true);
  });
});

describe("validateScoringInvariants", () => {
  it("flags a coefficient change with no named structural invariant as a structural-gate failure", () => {
    const result = validateScoringInvariants({
      changes: [
        { kind: "coefficient", description: "lifted alias weight 0.025 → 0.04", invariant: null },
      ],
    });
    expect(result.passed).toBe(false);
    expect(result.failures[0].reason).toMatch(/no.*invariant/i);
  });

  it("passes when every change names a structural invariant", () => {
    const result = validateScoringInvariants({
      changes: [
        {
          kind: "coefficient",
          description: "lifted alias weight 0.025 → 0.04",
          invariant: "alias_path_agreement_amplifies_path_filename_coverage",
        },
      ],
    });
    expect(result.passed).toBe(true);
  });
});

describe("topCompetitorDelta", () => {
  it("returns the feature delta between expected source and the top competing source", () => {
    const delta = topCompetitorDelta({
      expected: {
        source_path: "docs/expected.md",
        score: 0.72,
        title_token_coverage: 0.5,
        path_token_coverage: 0.33,
        alias_hit_count: 1,
      },
      top_competitor: {
        source_path: "docs/competitor.md",
        score: 0.85,
        title_token_coverage: 0.0,
        path_token_coverage: 0.0,
        alias_hit_count: 3,
      },
    });
    expect(delta.score_gap).toBeCloseTo(0.85 - 0.72);
    expect(delta.feature_deltas.title_token_coverage).toBeCloseTo(-0.5);
    expect(delta.feature_deltas.alias_hit_count).toBe(2);
  });
});
