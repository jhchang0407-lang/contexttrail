/**
 * THO-132 — Slice 2 eval diagnostics + hard gates.
 *
 * Slice 2 layers source-rerank diagnostics on top of Slice 0 capture/report
 * substrate and adds the PRD-0012 ranking gates without weakening any prior
 * floor.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateSlice2Gates,
  SLICE2_TOP1_FLOOR,
  SLICE2_TOP3_FLOOR,
  type Slice2GateResult,
} from "./slice2.js";

function gates(over: Partial<Parameters<typeof evaluateSlice2Gates>[0]> = {}) {
  return evaluateSlice2Gates({
    synthetic_regression: false,
    critical_source_set_recall_at_50_rate: 1.0,
    false_confident_unsupported: 0,
    answerable_top1_rate: 0.78,
    answerable_top3_rate: 0.94,
    ...over,
  });
}

describe("evaluateSlice2Gates", () => {
  it("passes when all floors are met", () => {
    const r = gates();
    expect(r.passed).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it("fails when synthetic regression failed", () => {
    const r = gates({ synthetic_regression: true });
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.gate === "synthetic_regression")).toBe(true);
  });

  it("fails when critical-source-set recall@50 dips below 100%", () => {
    const r = gates({ critical_source_set_recall_at_50_rate: 0.99 });
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.gate === "critical_source_recall")).toBe(true);
  });

  it("fails when any unsupported case is false-confident", () => {
    const r = gates({ false_confident_unsupported: 1 });
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.gate === "false_confident_unsupported")).toBe(
      true,
    );
  });

  it(`fails when answerable top-1 < ${SLICE2_TOP1_FLOOR * 100}%`, () => {
    const r = gates({ answerable_top1_rate: 0.74 });
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.gate === "answerable_top1_floor")).toBe(true);
  });

  it(`fails when answerable top-3 < ${SLICE2_TOP3_FLOOR * 100}%`, () => {
    const r = gates({ answerable_top3_rate: 0.93 });
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.gate === "answerable_top3_floor")).toBe(true);
  });

  it("reports every failing gate, not just the first", () => {
    const r: Slice2GateResult = gates({
      critical_source_set_recall_at_50_rate: 0.9,
      false_confident_unsupported: 2,
      answerable_top1_rate: 0.4,
    });
    const failedGates = r.failures.map((f) => f.gate);
    expect(failedGates).toEqual(
      expect.arrayContaining([
        "critical_source_recall",
        "false_confident_unsupported",
        "answerable_top1_floor",
      ]),
    );
  });
});

describe("Slice 2 movement diagnostics shape", () => {
  it("captures before/after source rank, score, and key feature reasons", () => {
    // Type-only sanity test: SourceRerankObservation has the expected fields.
    const obs: import("./slice2.js").SourceRerankObservation = {
      source_path: "docs/concepts/foo.md",
      pre_rerank_rank: 3,
      post_rerank_rank: 1,
      pre_rerank_score: 0.45,
      post_rerank_score: 0.72,
      feature_reasons: {
        lexical_chunk_score: 0.45,
        source_rank_prior: 0.58,
        title_token_coverage: 0.5,
        path_token_coverage: 0.33,
        title_path_agreement: 0.33,
        heading_token_coverage: 0.0,
        alias_hit_count: 1,
        purpose_compat_bonus: 0.25,
        distractor_penalty: 0,
        role_penalty: 0,
      },
    };
    expect(obs.pre_rerank_rank).toBe(3);
    expect(obs.post_rerank_rank).toBe(1);
  });
});
