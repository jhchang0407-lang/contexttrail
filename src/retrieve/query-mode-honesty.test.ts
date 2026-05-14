import { describe, expect, it } from "vitest";
import { decideQueryModeHonesty } from "./query-mode-honesty.js";
import type { AboutnessObservation } from "./aboutness.js";
import type { QueryCompilation } from "./query-scope.js";
import type { SourceSelectionDecision } from "./source-selection-decision.js";

function compilation(
  overrides: Partial<QueryCompilation> = {},
): QueryCompilation {
  return {
    query_mode: "signal_empty",
    provided_anchor_count: 1,
    recognized_anchor_count: 0,
    anchors: [],
    ...overrides,
  };
}

function selection(
  overrides: Partial<SourceSelectionDecision> = {},
): SourceSelectionDecision {
  return {
    fail_closed: false,
    top1_top2_margin: 0.2,
    top1_top3_margin: 0.2,
    selected_sources: [
      {
        source_path: "docs/joins.md",
        rank: 1,
        score: 0.5,
        aboutness_label: "partial",
        reason_codes: [],
      },
    ],
    ...overrides,
  };
}

function aboutness(
  overrides: Partial<AboutnessObservation> = {},
): AboutnessObservation {
  return {
    source_path: "docs/joins.md",
    rank: 1,
    label: "partial",
    reason_codes: [],
    combined_token_coverage: 0.25,
    ...overrides,
  };
}

describe("decideQueryModeHonesty", () => {
  it("preserves signal_empty when no anchor was actually recognized", () => {
    const decision = decideQueryModeHonesty({
      initial_query_mode: "signal_empty",
      query_compilation: compilation(),
      included_scores: [0.92, 0.33],
      source_selection: selection(),
      source_aboutness: [aboutness()],
    });

    expect(decision.query_mode).toBe("signal_empty");
    expect(decision.reason).toBe("preserve_initial_mode");
  });

  it("can upgrade unanchored to anchored when explicit anchors still found strong support", () => {
    const decision = decideQueryModeHonesty({
      initial_query_mode: "unanchored",
      query_compilation: compilation({
        query_mode: "unanchored",
        recognized_anchor_count: 1,
      }),
      included_scores: [0.78],
      source_selection: selection(),
      source_aboutness: [aboutness({ label: "covers", combined_token_coverage: 0.5 })],
    });

    expect(decision.query_mode).toBe("anchored");
  });

  it("preserves signal_empty when explicit anchors only produced weak evidence", () => {
    const decision = decideQueryModeHonesty({
      initial_query_mode: "signal_empty",
      query_compilation: compilation(),
      included_scores: [0.24, 0.18],
      source_selection: selection({
        fail_closed: true,
        selected_sources: [],
      }),
      source_aboutness: [aboutness({ label: "unsupported", combined_token_coverage: 0 })],
    });

    expect(decision.query_mode).toBe("signal_empty");
    expect(decision.reason).toBe("preserve_initial_mode");
  });

  it("does not reclassify anchor-free queries", () => {
    const decision = decideQueryModeHonesty({
      initial_query_mode: "unanchored",
      query_compilation: compilation({
        query_mode: "unanchored",
        provided_anchor_count: 0,
      }),
      included_scores: [0.95, 0.81],
      source_selection: selection(),
      source_aboutness: [aboutness()],
    });

    expect(decision.query_mode).toBe("unanchored");
  });
});
