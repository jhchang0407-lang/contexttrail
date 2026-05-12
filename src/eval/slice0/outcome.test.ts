/**
 * THO-134 / PRD-0013 V2.5.1 — runner outcome.
 *
 * The real-corpus ceiling-probe runner used to exit nonzero only when the
 * combined-panel Slice 2 gates failed, missing the holdout panel which is the
 * actual ship verdict. `summarizeCeilingProbeOutcome` derives the exit code
 * and the failing-gate messages from the aggregated report so the runner is
 * trivial and the gate logic is unit-testable.
 */
import { describe, it, expect } from "vitest";
import { summarizeCeilingProbeOutcome } from "./outcome.js";
import type { Slice0Report } from "./report.js";

function passingGates() {
  return { passed: true, failures: [] } as const;
}

function failingGate(gate: string, message: string) {
  return {
    passed: false,
    failures: [{ gate, message }],
  } as const;
}

function makeReport(over: Partial<Slice0Report>): Slice0Report {
  return {
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
      // separability is not consulted by the outcome summary; cast to unknown.
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
    ...over,
  };
}

describe("summarizeCeilingProbeOutcome", () => {
  it("exits 0 when synthetic, holdout, and combined gates all pass", () => {
    const result = summarizeCeilingProbeOutcome(makeReport({}));
    expect(result.exit_code).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("exits 1 with a synthetic-regression error when synthetic regressed", () => {
    const result = summarizeCeilingProbeOutcome(
      makeReport({
        metrics: {
          ...makeReport({}).metrics,
          synthetic_regression: true,
        },
        synthetic_failed_gates: ["candidate_recall"],
      }),
    );
    expect(result.exit_code).toBe(1);
    expect(result.errors.join("\n")).toContain("synthetic regression");
  });

  it("exits 1 when holdout gates fail even if combined gates pass", () => {
    const result = summarizeCeilingProbeOutcome(
      makeReport({
        holdout_gates: failingGate(
          "answerable_top1_floor",
          "answerable top-1 = 67.8% < 75.0% floor",
        ),
      }),
    );
    expect(result.exit_code).toBe(1);
    expect(result.errors.join("\n")).toContain("Holdout gates failed");
    expect(result.errors.join("\n")).toContain("answerable_top1_floor");
  });

  it("exits 1 when combined slice2 gates fail", () => {
    const result = summarizeCeilingProbeOutcome(
      makeReport({
        slice2_gates: failingGate(
          "critical_source_recall",
          "critical-source-set recall@50 = 96.7% < 100.0% floor",
        ),
      }),
    );
    expect(result.exit_code).toBe(1);
    expect(result.errors.join("\n")).toContain("Combined Slice 2 gates failed");
  });

  it("exits 1 when false-confident unsupported exceeds tolerance", () => {
    const result = summarizeCeilingProbeOutcome(
      makeReport({
        metrics: {
          ...makeReport({}).metrics,
          false_confident_unsupported: 5,
        },
      }),
    );
    expect(result.exit_code).toBe(1);
    expect(result.errors.join("\n")).toContain("false-confident unsupported");
  });

  it("reports every failing gate, not just the first", () => {
    const result = summarizeCeilingProbeOutcome(
      makeReport({
        holdout_gates: {
          passed: false,
          failures: [
            { gate: "answerable_top1_floor", message: "67.8% < 75.0%" },
            { gate: "answerable_top3_floor", message: "86.7% < 93.8%" },
          ],
        },
        slice2_gates: failingGate(
          "critical_source_recall",
          "97.5% < 100.0%",
        ),
      }),
    );
    expect(result.exit_code).toBe(1);
    const joined = result.errors.join("\n");
    expect(joined).toContain("answerable_top1_floor");
    expect(joined).toContain("answerable_top3_floor");
    expect(joined).toContain("Combined Slice 2 gates failed");
  });
});
