/**
 * V4.10 — statistical scale-up.
 *
 * The other synthetic suites run 30 cases per class, which gives a
 * 95% CI of roughly [88%, 100%] at observed 100% — too wide to certify
 * any specific accuracy target. This suite runs 500 cases per class and
 * reports Wilson 95% lower bounds, which is the smallest claim a
 * frequentist would accept given the observed pass rate.
 *
 * Per-class Wilson lower bounds at N=500, observed 100%, are roughly
 * 99.2%. So this suite can certify "≥ 99% with 95% confidence" when V3
 * actually passes every case, and it produces a meaningful lower bound
 * (not just "100%") on classes where V3 leaks.
 *
 * Each test is gated only on (a) lower bound exceeds a documented floor
 * and (b) lower bound exceeds the lexical lower bound. The floors are
 * intentionally honest — set just below the current observed rate so a
 * regression triggers without flapping on per-seed noise.
 */
import { describe, expect, it } from "vitest";
import {
  generateChangelogReleaseIntentCases,
  generateConceptNearMissCases,
  generateDecisionVsProceduralCases,
  generateHardAnchoredExactVsBroadCases,
  generateHardParentVsLeafCases,
  withParaphraseFanout,
  type SyntheticCase,
} from "./generators.js";
import { runSyntheticEval } from "./runner.js";
import { syntheticLexicalRanker, syntheticV3Ranker } from "./v3-adapter.js";
import { requiredSampleSizeFor100Pct, wilson95 } from "./stats.js";

type Snapshot = {
  passed: number;
  total: number;
  observed: number;
  lower95: number;
  upper95: number;
};

function snapshot(
  cases: SyntheticCase[],
  ranker: typeof syntheticV3Ranker,
): Snapshot {
  const result = runSyntheticEval({ cases, ranker });
  const ci = wilson95(result.overall.passed, result.overall.total);
  return {
    passed: result.overall.passed,
    total: result.overall.total,
    observed: result.overall.rate,
    lower95: ci.lower,
    upper95: ci.upper,
  };
}

const SCALE = 500;

describe("V4.10 statistical certification at N=500", () => {
  it("documents how many samples are needed to certify each accuracy level", () => {
    // Sanity table — surface the relationship between sample size and
    // certifiable accuracy so the rest of the suite has context.
    const table = [
      { target: 0.9, n: requiredSampleSizeFor100Pct(0.9) },
      { target: 0.95, n: requiredSampleSizeFor100Pct(0.95) },
      { target: 0.99, n: requiredSampleSizeFor100Pct(0.99) },
      { target: 0.995, n: requiredSampleSizeFor100Pct(0.995) },
      { target: 0.999, n: requiredSampleSizeFor100Pct(0.999) },
    ];
    // eslint-disable-next-line no-console
    console.log("[sample size required to certify, observed=100%]", table);
    // Sanity check the table is monotone.
    for (let i = 1; i < table.length; i++) {
      expect(table[i].n).toBeGreaterThan(table[i - 1].n);
    }
  });

  it("hard parent_vs_leaf: V3 certifiable lower bound exceeds 99% — the headline claim", () => {
    const cases = generateHardParentVsLeafCases({ count: SCALE, seed: 1001 });
    const v3 = snapshot(cases, syntheticV3Ranker);
    const lex = snapshot(cases, syntheticLexicalRanker);
    // eslint-disable-next-line no-console
    console.log("[scale parent_vs_leaf]", { v3, lex });
    // Headline: V3 certifies ≥ 99% with 95% confidence on this class.
    expect(v3.lower95).toBeGreaterThanOrEqual(0.99);
    // Sanity: lexical alone cannot make this claim.
    expect(v3.lower95).toBeGreaterThan(lex.lower95);
  });

  it("hard anchored_exact_vs_broad: V3 certifiable lower bound exceeds 99%", () => {
    const cases = generateHardAnchoredExactVsBroadCases({ count: SCALE, seed: 1003 });
    const v3 = snapshot(cases, syntheticV3Ranker);
    const lex = snapshot(cases, syntheticLexicalRanker);
    // eslint-disable-next-line no-console
    console.log("[scale anchored]", { v3, lex });
    expect(v3.lower95).toBeGreaterThanOrEqual(0.99);
    expect(v3.lower95).toBeGreaterThan(lex.lower95);
  });

  it("decision_vs_procedural: V3 certifiable lower bound exceeds 99%", () => {
    const cases = generateDecisionVsProceduralCases({ count: SCALE, seed: 1005 });
    const v3 = snapshot(cases, syntheticV3Ranker);
    // eslint-disable-next-line no-console
    console.log("[scale decision_vs_procedural]", v3);
    expect(v3.lower95).toBeGreaterThanOrEqual(0.99);
  });

  it("changelog_release_intent: V3 certifiable lower bound exceeds 95% (clean phrasings)", () => {
    // Without the verbose×paraphrase combination, changelog should still
    // be very strong. The ≥95% floor (rather than 99%) leaves headroom
    // for the per-seed variation we observed earlier.
    const cases = generateChangelogReleaseIntentCases({ count: SCALE, seed: 1007 });
    const v3 = snapshot(cases, syntheticV3Ranker);
    // eslint-disable-next-line no-console
    console.log("[scale changelog]", v3);
    expect(v3.lower95).toBeGreaterThanOrEqual(0.95);
  });

  it("near-miss: V3 certifiable lower bound exceeds 99%", () => {
    const cases = generateConceptNearMissCases({ count: SCALE, seed: 1009 });
    const v3 = snapshot(cases, syntheticV3Ranker);
    // eslint-disable-next-line no-console
    console.log("[scale near-miss]", v3);
    expect(v3.lower95).toBeGreaterThanOrEqual(0.99);
  });
});

describe("V4.10 statistical certification under paraphrase × scale", () => {
  it("paraphrase × parent_vs_leaf: lower bound exceeds 99%", () => {
    // 200 base cases × ~10 paraphrases ≈ 2000 trials.
    const cases = withParaphraseFanout(
      generateHardParentVsLeafCases({ count: 200, seed: 1101 }),
    );
    const v3 = snapshot(cases, syntheticV3Ranker);
    // eslint-disable-next-line no-console
    console.log("[scale paraphrase × parent]", v3);
    expect(v3.lower95).toBeGreaterThanOrEqual(0.99);
  });

  it("paraphrase × anchored: lower bound exceeds 99%", () => {
    const cases = withParaphraseFanout(
      generateHardAnchoredExactVsBroadCases({ count: 200, seed: 1103 }),
    );
    const v3 = snapshot(cases, syntheticV3Ranker);
    // eslint-disable-next-line no-console
    console.log("[scale paraphrase × anchored]", v3);
    expect(v3.lower95).toBeGreaterThanOrEqual(0.99);
  });
});
