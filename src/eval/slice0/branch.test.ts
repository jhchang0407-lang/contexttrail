import { describe, it, expect } from "vitest";
import { decideBranch, type BranchInput } from "./branch.js";

function build(overrides: Partial<BranchInput>): BranchInput {
  return {
    synthetic_regression: false,
    answerable_cases: 30,
    critical_source_set_recall_at_50_rate: 0.97,
    actual_top_source_top1_acceptable_rate: 0.7,
    actual_top_source_top3_acceptable_rate: 0.95,
    separability_classification: "sufficient",
    false_confident_unsupported: 0,
    ...overrides,
  };
}

describe("decideBranch", () => {
  it("synthetic regression beats every other branch", () => {
    const d = decideBranch(
      build({
        synthetic_regression: true,
        critical_source_set_recall_at_50_rate: 0.5,
        separability_classification: "weak",
        false_confident_unsupported: 5,
      }),
    );
    expect(d.primary_branch).toBe("stop_fix_regression");
    expect(d.recommended_next_prd).toBe("Fix Slice 0 Regression");
  });

  it("low critical-source recall beats ranking/aboutness", () => {
    const d = decideBranch(
      build({
        critical_source_set_recall_at_50_rate: 0.8,
        actual_top_source_top1_acceptable_rate: 0.5,
        separability_classification: "sufficient",
      }),
    );
    expect(d.primary_branch).toBe("candidate_generation_or_indexing");
    expect(d.recommended_next_prd).toBe("Candidate Generation / Indexing Rework");
  });

  it("false-confident unsupported above tolerance triggers confidence/abstention even on inconclusive separability", () => {
    const d = decideBranch(
      build({
        critical_source_set_recall_at_50_rate: 0.97,
        separability_classification: "inconclusive",
        false_confident_unsupported: 3,
      }),
    );
    expect(d.primary_branch).toBe("confidence_or_abstention");
  });

  it("high recall + weak top-1 ranking yields source-ranking branch", () => {
    const d = decideBranch(
      build({
        critical_source_set_recall_at_50_rate: 0.97,
        actual_top_source_top1_acceptable_rate: 0.55,
        actual_top_source_top3_acceptable_rate: 0.92,
        separability_classification: "sufficient",
      }),
    );
    expect(d.primary_branch).toBe("source_ranking_or_aboutness");
    expect(d.recommended_next_prd).toBe("SourceProfile + Source Rerank");
  });

  it("high recall + strong ranking + sufficient separability is ready_for_source_first_v2_prd", () => {
    const d = decideBranch(
      build({
        critical_source_set_recall_at_50_rate: 0.99,
        actual_top_source_top1_acceptable_rate: 0.9,
        actual_top_source_top3_acceptable_rate: 0.97,
        separability_classification: "sufficient",
        false_confident_unsupported: 0,
      }),
    );
    expect(d.primary_branch).toBe("ready_for_source_first_v2_prd");
    expect(d.recommended_next_prd).toBe("Full Source-First V2 Implementation");
  });

  it("post-Slice 1: a single false-confident unsupported still blocks on confidence (THO-124)", () => {
    const d = decideBranch(
      build({
        critical_source_set_recall_at_50_rate: 1.0,
        actual_top_source_top1_acceptable_rate: 0.6,
        actual_top_source_top3_acceptable_rate: 0.85,
        separability_classification: "weak",
        false_confident_unsupported: 1,
      }),
    );
    expect(d.primary_branch).toBe("confidence_or_abstention");
  });

  it("zero false-confident unsupported lets ranking become the next bottleneck (THO-124)", () => {
    const d = decideBranch(
      build({
        critical_source_set_recall_at_50_rate: 1.0,
        actual_top_source_top1_acceptable_rate: 0.6,
        actual_top_source_top3_acceptable_rate: 0.85,
        separability_classification: "weak",
        false_confident_unsupported: 0,
      }),
    );
    expect(d.primary_branch).toBe("source_ranking_or_aboutness");
  });

  it("inconclusive separability without false-confident unsupported still defers to recall/ranking", () => {
    // Boundary: separability inconclusive but no false-confident unsupported
    // and high recall + weak ranking — should still recommend source ranking.
    const d = decideBranch(
      build({
        critical_source_set_recall_at_50_rate: 0.97,
        actual_top_source_top1_acceptable_rate: 0.55,
        actual_top_source_top3_acceptable_rate: 0.92,
        separability_classification: "inconclusive",
        false_confident_unsupported: 0,
      }),
    );
    expect(d.primary_branch).toBe("source_ranking_or_aboutness");
  });
});
