import { describe, expect, it } from "vitest";
import {
  rankScoreTracesForSourceCandidates,
  shouldApplySourceSelection,
} from "./source-rerank-pipeline.js";
import type { ScoreTrace } from "./score.js";
import type { SourceSelectionDecision } from "./source-selection-decision.js";

const trace = (overrides: Partial<ScoreTrace>): ScoreTrace => ({
  version_id: "v",
  bm25_norm: 0,
  heading_match: 0,
  scope_match: 0,
  mention_overlap: 0,
  specificity: 1,
  text_score: 0,
  final_score: 0,
  token_count: 100,
  packing_score: 0,
  ...overrides,
});

describe("rankScoreTracesForSourceCandidates", () => {
  it("derives lexical source ranks from score order, not storage order", () => {
    const ranked = rankScoreTracesForSourceCandidates([
      trace({ version_id: "inserted-first", final_score: 0.1, packing_score: 0.1 }),
      trace({ version_id: "best-score", final_score: 0.9, packing_score: 0.2 }),
      trace({ version_id: "middle-score", final_score: 0.5, packing_score: 0.3 }),
    ]);

    expect(ranked.map((r) => [r.rank, r.trace.version_id])).toEqual([
      [1, "best-score"],
      [2, "middle-score"],
      [3, "inserted-first"],
    ]);
  });

  it("uses packing score and id as deterministic tie-breakers", () => {
    const ranked = rankScoreTracesForSourceCandidates([
      trace({ version_id: "b", final_score: 0.5, packing_score: 0.1 }),
      trace({ version_id: "c", final_score: 0.5, packing_score: 0.4 }),
      trace({ version_id: "a", final_score: 0.5, packing_score: 0.1 }),
    ]);

    expect(ranked.map((r) => [r.rank, r.trace.version_id])).toEqual([
      [1, "c"],
      [2, "a"],
      [3, "b"],
    ]);
  });
});

describe("shouldApplySourceSelection", () => {
  function decision(
    reason_codes: SourceSelectionDecision["selected_sources"][number]["reason_codes"],
  ): SourceSelectionDecision {
    return {
      selected_sources: [
        {
          source_path: "docs/selected.md",
          rank: 1,
          score: 1,
          aboutness_label: "covers",
          reason_codes,
        },
      ],
      fail_closed: false,
      top1_top2_margin: 0.1,
      top1_top3_margin: 0.2,
    };
  }

  it("keeps ordinary label-only decisions measurement-only", () => {
    expect(shouldApplySourceSelection(decision(["covers_label"]))).toBe(false);
  });

  it("applies decisions with structural promotion reasons", () => {
    expect(shouldApplySourceSelection(decision(["decision_over_procedural"]))).toBe(true);
  });

  it("does not apply fail-closed decisions", () => {
    expect(
      shouldApplySourceSelection({
        selected_sources: [],
        fail_closed: true,
        top1_top2_margin: 0,
        top1_top3_margin: 0,
      }),
    ).toBe(false);
  });
});
