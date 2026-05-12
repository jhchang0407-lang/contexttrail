/**
 * THO-166 (PRD-0016 / P16.8): PRD-0016 release verdict.
 *
 * Compares baseline vs current real-corpus summary against the PRD's
 * gates and emits a structured verdict (pass + failing-gates list).
 * The release contract:
 *
 *   - answer top-1                ≥ 112/122 (improvement target)
 *   - answer top-3                ≥ 118/122 (no recall regression)
 *   - true top-3 misses           ≤ 2 (recall cohort improvement)
 *   - top-3-hit / top-1-miss      ≤ 6 (ordering cohort improvement)
 *   - signal-empty coverage hon.  = 26/26 (no safety regression)
 *   - combined coverage honest    = 148/148
 *   - agent answer pass           ≥ 147/148
 *   - query mode correct          ≥ 107/148 (no regression)
 *   - chunk correctness           current ≥ baseline
 *   - payload size                no >5% increase without ambiguity benefit
 *   - synthetic regression        passed
 *
 * The verdict must FAIL when an apparent top-1 win hides a
 * top-3 / signal-empty / coverage / agent regression.
 */
import { describe, expect, it } from "vitest";
import { evaluatePrd0016Gates, renderPrd0016Verdict } from "./prd0016-gates.js";
import type { Prd0016InputSummary } from "./prd0016-gates.js";

const baseline: Prd0016InputSummary = {
  answer_top_1: 105,
  answer_top_3: 118,
  answer_bearing_cases: 122,
  true_top_3_misses: 4,
  top_3_hit_top_1_miss: 13,
  signal_empty_coverage_honest: 26,
  signal_empty_cases: 26,
  combined_coverage_honest: 148,
  total_cases: 148,
  agent_answer: 147,
  query_mode_correct: 107,
  chunk_correct: 3,
  chunk_scored: 3,
  avg_payload_bytes: 100_000,
  synthetic_regression: false,
};

describe("evaluatePrd0016Gates — pass verdict", () => {
  it("passes when current meets every gate target", () => {
    const verdict = evaluatePrd0016Gates({
      baseline,
      current: {
        ...baseline,
        answer_top_1: 113,
        true_top_3_misses: 2,
        top_3_hit_top_1_miss: 6,
        // top-3, signal-empty, coverage, agent stay the same
      },
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.failed_gates).toEqual([]);
  });

  it("passes when current matches baseline (no improvement) but the verdict reflects 'improve' as failing", () => {
    // The release contract is targeted improvement; equality on top-1
    // is reported as a failed gate even when no safety metric
    // regresses.
    const verdict = evaluatePrd0016Gates({ baseline, current: baseline });
    expect(verdict.pass).toBe(false);
    expect(verdict.failed_gates).toContain("answer_top_1_improvement");
  });
});

describe("evaluatePrd0016Gates — safety regression catches", () => {
  it("fails when answer_top_1 improves but answer_top_3 regresses", () => {
    const verdict = evaluatePrd0016Gates({
      baseline,
      current: {
        ...baseline,
        answer_top_1: 115,
        answer_top_3: 116, // regressed below 118
      },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.failed_gates).toContain("answer_top_3_no_regression");
  });

  it("fails when answer_top_1 improves but signal-empty coverage honesty regresses", () => {
    const verdict = evaluatePrd0016Gates({
      baseline,
      current: {
        ...baseline,
        answer_top_1: 115,
        signal_empty_coverage_honest: 25,
      },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.failed_gates).toContain("signal_empty_coverage_honest");
  });

  it("fails when answer_top_1 improves but combined coverage honesty regresses", () => {
    const verdict = evaluatePrd0016Gates({
      baseline,
      current: {
        ...baseline,
        answer_top_1: 115,
        combined_coverage_honest: 147,
      },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.failed_gates).toContain("combined_coverage_honest");
  });

  it("fails when answer_top_1 improves but agent answer regresses", () => {
    const verdict = evaluatePrd0016Gates({
      baseline,
      current: {
        ...baseline,
        answer_top_1: 115,
        agent_answer: 145,
      },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.failed_gates).toContain("agent_answer_no_regression");
  });

  it("fails when answer_top_1 improves but query mode regresses", () => {
    const verdict = evaluatePrd0016Gates({
      baseline,
      current: {
        ...baseline,
        answer_top_1: 115,
        query_mode_correct: 100,
      },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.failed_gates).toContain("query_mode_no_regression");
  });

  it("fails when synthetic regression is flagged regardless of other gates", () => {
    const verdict = evaluatePrd0016Gates({
      baseline,
      current: {
        ...baseline,
        answer_top_1: 113,
        true_top_3_misses: 2,
        top_3_hit_top_1_miss: 6,
        synthetic_regression: true,
      },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.failed_gates).toContain("synthetic_regression");
  });

  it("fails when chunk correctness drops below baseline", () => {
    const verdict = evaluatePrd0016Gates({
      baseline,
      current: { ...baseline, chunk_correct: 2 },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.failed_gates).toContain("chunk_correctness_no_regression");
  });

  it("fails when payload size grows materially without an ambiguity / readiness benefit", () => {
    const verdict = evaluatePrd0016Gates({
      baseline,
      current: {
        ...baseline,
        answer_top_1: 113,
        true_top_3_misses: 2,
        top_3_hit_top_1_miss: 6,
        avg_payload_bytes: 200_000, // 2x growth
      },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.failed_gates).toContain("payload_size_no_bloat");
  });
});

describe("evaluatePrd0016Gates — cohort gates", () => {
  it("fails the recall gate when true_top_3_misses stays above the PRD threshold", () => {
    const verdict = evaluatePrd0016Gates({
      baseline,
      current: { ...baseline, answer_top_1: 113, true_top_3_misses: 3 },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.failed_gates).toContain("true_top_3_misses_target");
  });

  it("fails the ordering gate when top-3-hit/top-1-miss stays above the PRD threshold", () => {
    const verdict = evaluatePrd0016Gates({
      baseline,
      current: { ...baseline, answer_top_1: 113, true_top_3_misses: 2, top_3_hit_top_1_miss: 8 },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.failed_gates).toContain("top_3_hit_top_1_miss_target");
  });
});

describe("renderPrd0016Verdict", () => {
  it("renders a markdown report with the per-gate baseline → current deltas", () => {
    const verdict = evaluatePrd0016Gates({ baseline, current: baseline });
    const md = renderPrd0016Verdict(verdict);
    expect(md).toContain("PRD-0016 Release Verdict");
    expect(md).toContain("answer_top_1_improvement");
    expect(md).toContain("answer_top_3_no_regression");
    expect(md).toContain("FAIL");
  });

  it("clearly shows pass when all gates are met", () => {
    const verdict = evaluatePrd0016Gates({
      baseline,
      current: {
        ...baseline,
        answer_top_1: 113,
        true_top_3_misses: 2,
        top_3_hit_top_1_miss: 6,
      },
    });
    const md = renderPrd0016Verdict(verdict);
    expect(md).toContain("PASS");
  });
});
