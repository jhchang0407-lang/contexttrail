/**
 * Adapter that wraps the current V3 deterministic stack (source-card →
 * aboutness verifier → selection decision) into a SyntheticRanker. Lets us
 * measure V3 against the synthetic suite as a baseline before any V4 work.
 *
 * The adapter does not invent new evidence: every signal it feeds the V3
 * pipeline can be derived from a SyntheticDoc with a generic recipe. If V3
 * fails on the synthetic suite, the failure is in the V3 mechanism, not
 * in the synthetic representation.
 */
import { describe, expect, it } from "vitest";
import {
  generateAdjacentSiblingCases,
  generateAnchoredExactVsBroadCases,
  generateHardAnchoredExactVsBroadCases,
  generateHardParentVsLeafCases,
  generateParentVsLeafCases,
} from "./generators.js";
import { runSyntheticEval } from "./runner.js";
import { syntheticLexicalRanker, syntheticV3Ranker } from "./v3-adapter.js";

describe("syntheticV3Ranker", () => {
  it("returns a non-empty ranking for a well-formed synthetic case", () => {
    const c = generateParentVsLeafCases({ count: 1, seed: 0 })[0];
    const ranking = syntheticV3Ranker(c);
    expect(ranking.length).toBeGreaterThan(0);
    expect(c.corpus.map((d) => d.source_path)).toContain(ranking[0]);
  });

  it("integrates cleanly with runSyntheticEval", () => {
    const cases = [
      ...generateParentVsLeafCases({ count: 5, seed: 11 }),
      ...generateAnchoredExactVsBroadCases({ count: 5, seed: 13 }),
    ];
    const result = runSyntheticEval({ cases, ranker: syntheticV3Ranker });
    // Sanity: ran every case.
    expect(result.overall.total).toBe(10);
    // Per-class buckets exist.
    expect(result.per_class.parent_vs_leaf?.total).toBe(5);
    expect(result.per_class.anchored_exact_vs_broad?.total).toBe(5);
  });

  it("does not depend on corpus order", () => {
    const original = generateAdjacentSiblingCases({ count: 1, seed: 17 })[0];
    const shuffled = {
      ...original,
      corpus: [...original.corpus].reverse(),
    };
    expect(syntheticV3Ranker(shuffled)[0]).toBe(syntheticV3Ranker(original)[0]);
    expect(syntheticLexicalRanker(shuffled)[0]).toBe(syntheticLexicalRanker(original)[0]);
  });

  it("exposes nontrivial lexical pressure on hard generators", () => {
    const cases = [
      ...generateHardParentVsLeafCases({ count: 12, seed: 23 }),
      ...generateHardAnchoredExactVsBroadCases({ count: 12, seed: 29 }),
    ];
    const lexical = runSyntheticEval({ cases, ranker: syntheticLexicalRanker });
    expect(lexical.overall.rate).toBeLessThan(1);
  });
});
