/**
 * Synthetic-eval runner — runs a ranker over generated cases and reports
 * per-class pass rates. The runner is mechanism-test infrastructure, not a
 * scoring tweak: any primitive that wants to ship over deterministic
 * source selection runs against this suite first.
 */
import { describe, expect, it } from "vitest";
import {
  generateParentVsLeafCases,
  generateAnchoredExactVsBroadCases,
} from "./generators.js";
import { runSyntheticEval, type SyntheticRanker } from "./runner.js";

describe("runSyntheticEval", () => {
  it("scores a perfect ranker as 100% on every class", () => {
    const cases = [
      ...generateParentVsLeafCases({ count: 5, seed: 1 }),
      ...generateAnchoredExactVsBroadCases({ count: 5, seed: 2 }),
    ];
    const oracle: SyntheticRanker = (c) => [c.expected_top1];
    const result = runSyntheticEval({ cases, ranker: oracle });
    expect(result.overall.passed).toBe(10);
    expect(result.overall.total).toBe(10);
    expect(result.per_class.parent_vs_leaf?.rate).toBe(1);
    expect(result.per_class.anchored_exact_vs_broad?.rate).toBe(1);
  });

  it("scores a contrarian ranker (always picks last doc) as 0% with all cases listed as failures", () => {
    const cases = generateParentVsLeafCases({ count: 4, seed: 3 });
    const contrarian: SyntheticRanker = (c) => [
      c.corpus[c.corpus.length - 1].source_path,
    ];
    const result = runSyntheticEval({ cases, ranker: contrarian });
    expect(result.overall.passed).toBe(0);
    expect(result.failures).toHaveLength(4);
    expect(result.failures[0].expected_top1).toBeDefined();
    expect(result.failures[0].actual_top3).toBeDefined();
  });

  it("counts a case as a pass only when expected_top1 is at rank 1", () => {
    const cases = generateParentVsLeafCases({ count: 1, seed: 4 });
    const c = cases[0];
    const wrongFirst: SyntheticRanker = () => [
      c.corpus[c.corpus.length - 1].source_path,
      c.expected_top1,
    ];
    const result = runSyntheticEval({ cases, ranker: wrongFirst });
    expect(result.overall.passed).toBe(0);
    // top3 should still capture the source — used by the must_include metric.
    expect(result.per_class_top3.parent_vs_leaf?.rate).toBe(1);
  });

  it("reports a separate must_include_top3 rate per class", () => {
    const cases = generateParentVsLeafCases({ count: 3, seed: 5 });
    const onlyTop3: SyntheticRanker = (c) => {
      // Put the expected source at rank 3 (so top1 fails, top3 passes).
      const others = c.corpus
        .filter((d) => d.source_path !== c.expected_top1)
        .map((d) => d.source_path);
      return [...others.slice(0, 2), c.expected_top1];
    };
    const result = runSyntheticEval({ cases, ranker: onlyTop3 });
    expect(result.per_class.parent_vs_leaf?.rate).toBe(0);
    expect(result.per_class_top3.parent_vs_leaf?.rate).toBe(1);
  });
});
