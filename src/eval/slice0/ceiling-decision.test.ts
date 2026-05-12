/**
 * THO-141 / PRD-0013 V2.5.8 — deterministic ceiling decision.
 *
 * When V2.5 can't pass holdout gates, produce a structured decision that
 * identifies the remaining bottleneck so V3 can target it directly. The
 * decision must be derivable from the report alone — no extra runs.
 */
import { describe, it, expect } from "vitest";
import { decideCeilingBottleneck, CEILING_BOTTLENECKS } from "./ceiling-decision.js";
import type { Slice0Report } from "./report.js";

function passingGates() {
  return { passed: true, failures: [] } as const;
}

function makeReport(over: Partial<Slice0Report> = {}): Slice0Report {
  const base: Slice0Report = {
    schema_version: 1,
    generated_at: "2026-05-08T00:00:00Z",
    case_count: 0,
    answerable_cases: 0,
    unsupported_cases: 0,
    repos: [],
    metrics: {
      case_count: 0,
      answerable_cases: 0,
      unsupported_cases: 0,
      critical_source_set_recall_at_50_rate: 1,
      critical_source_set_recall_at_20_rate: 1,
      critical_source_set_recall_at_10_rate: 1,
      actual_top_source_top1_acceptable_rate: 1,
      actual_top_source_top3_acceptable_rate: 1,
      oracle_answerable_success_at_50_rate: 1,
      post_threshold_critical_recall_at_50_rate: 1,
      post_pack_critical_recall_at_50_rate: 1,
      false_confident_unsupported: 0,
      synthetic_regression: false,
      separability: undefined as unknown as Slice0Report["metrics"]["separability"],
    },
    per_repo: {},
    per_intent: {},
    observations: [],
    branch_decision: {
      primary_branch: "ready_for_source_first_v2_prd",
      recommended_next_prd: "Full Source-First V2 Implementation",
      rationale: "ok",
    },
    synthetic_failed_gates: [],
    slice2_gates: passingGates(),
    holdout_gates: passingGates(),
    failure_layer_counts: {
      none: 0,
      not_imported: 0,
      absent_from_candidates: 0,
      outside_top50: 0,
      below_threshold: 0,
      pack_loss: 0,
      display_loss: 0,
    },
  };
  return { ...base, ...over };
}

describe("CEILING_BOTTLENECKS", () => {
  it("declares the canonical bottleneck set", () => {
    expect(CEILING_BOTTLENECKS).toEqual([
      "ready_for_v3",
      "confidence_separability",
      "corpus_coverage",
      "candidate_generation",
      "source_scoring",
    ]);
  });
});

describe("decideCeilingBottleneck", () => {
  it("returns ready_for_v3 when every holdout and combined gate passes", () => {
    const out = decideCeilingBottleneck(makeReport({}));
    expect(out.bottleneck).toBe("ready_for_v3");
    expect(out.gates_passed).toBe(true);
  });

  it("names confidence_separability when false-confident unsupported is nonzero", () => {
    const out = decideCeilingBottleneck(
      makeReport({
        metrics: {
          ...makeReport({}).metrics,
          false_confident_unsupported: 3,
        },
        holdout_gates: {
          passed: false,
          failures: [
            {
              gate: "false_confident_unsupported",
              message: "3 unsupported case(s) reported confident",
            },
          ],
        },
      }),
    );
    expect(out.bottleneck).toBe("confidence_separability");
  });

  it("names corpus_coverage when not_imported dominates the failure layers", () => {
    const out = decideCeilingBottleneck(
      makeReport({
        holdout_gates: {
          passed: false,
          failures: [
            {
              gate: "critical_source_recall",
              message: "98.9% < 100.0% floor",
            },
          ],
        },
        failure_layer_counts: {
          none: 0,
          not_imported: 5,
          absent_from_candidates: 1,
          outside_top50: 0,
          below_threshold: 0,
          pack_loss: 0,
          display_loss: 0,
        },
      }),
    );
    expect(out.bottleneck).toBe("corpus_coverage");
  });

  it("names candidate_generation when absent_from_candidates / outside_top50 dominate", () => {
    const out = decideCeilingBottleneck(
      makeReport({
        holdout_gates: {
          passed: false,
          failures: [{ gate: "critical_source_recall", message: "x" }],
        },
        failure_layer_counts: {
          none: 0,
          not_imported: 0,
          absent_from_candidates: 4,
          outside_top50: 2,
          below_threshold: 0,
          pack_loss: 0,
          display_loss: 0,
        },
      }),
    );
    expect(out.bottleneck).toBe("candidate_generation");
  });

  it("does not let one recall miss hide dominant display/source-selection losses", () => {
    const out = decideCeilingBottleneck(
      makeReport({
        holdout_gates: {
          passed: false,
          failures: [
            { gate: "critical_source_recall", message: "98.9% < 100%" },
            { gate: "answerable_top1_floor", message: "70% < 75%" },
            { gate: "answerable_top3_floor", message: "88.9% < 93.8%" },
          ],
        },
        failure_layer_counts: {
          none: 106,
          not_imported: 0,
          absent_from_candidates: 0,
          outside_top50: 1,
          below_threshold: 0,
          pack_loss: 0,
          display_loss: 13,
        },
      }),
    );
    expect(out.bottleneck).toBe("source_scoring");
    expect(out.rationale).toContain("source-selection losses");
  });

  it("names source_scoring when top-1/top-3 floors are the only holdout failures", () => {
    const out = decideCeilingBottleneck(
      makeReport({
        holdout_gates: {
          passed: false,
          failures: [
            {
              gate: "answerable_top1_floor",
              message: "71% < 75%",
            },
            {
              gate: "answerable_top3_floor",
              message: "90% < 93.8%",
            },
          ],
        },
        failure_layer_counts: {
          none: 10,
          not_imported: 0,
          absent_from_candidates: 0,
          outside_top50: 0,
          below_threshold: 0,
          pack_loss: 0,
          display_loss: 5,
        },
      }),
    );
    expect(out.bottleneck).toBe("source_scoring");
  });

  it("attaches a human-readable rationale and the failed-gate names", () => {
    const out = decideCeilingBottleneck(
      makeReport({
        holdout_gates: {
          passed: false,
          failures: [
            { gate: "answerable_top1_floor", message: "71% < 75%" },
          ],
        },
        failure_layer_counts: {
          none: 10,
          not_imported: 0,
          absent_from_candidates: 0,
          outside_top50: 0,
          below_threshold: 0,
          pack_loss: 0,
          display_loss: 3,
        },
      }),
    );
    expect(out.bottleneck).toBe("source_scoring");
    expect(out.rationale).toContain("source_scoring");
    expect(out.failed_gates).toContain("answerable_top1_floor");
  });
});
