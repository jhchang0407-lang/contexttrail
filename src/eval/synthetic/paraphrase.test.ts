/**
 * V4.3b — stricter query-paraphrase fanout.
 *
 * The first fanout pass proved phrasing stability, but its headline number
 * was too flattering because many paraphrases preserved the exact answer-
 * bearing tokens and each base corpus was counted multiple times.
 *
 * This suite adds three guards:
 *   1. lexical fanout baselines, so "100%" has to beat naive retrieval
 *   2. grouped-by-base-case scoring, so repeated paraphrases do not masquerade
 *      as independent wins
 *   3. harder buckets that drop the most direct trigger phrasing while
 *      preserving the same expected source
 */
import { describe, expect, it } from "vitest";
import {
  generateAdjacentSiblingCases,
  generateAnchoredExactVsBroadCases,
  generateChangelogReleaseIntentCases,
  generateDecisionVsProceduralCases,
  generateHardAnchoredExactVsBroadCases,
  generateHardParentVsLeafCases,
  generateOverviewVsReferenceCases,
  generateParentVsLeafCases,
  withParaphraseFanout,
  type SyntheticCase,
} from "./generators.js";
import { runSyntheticEval } from "./runner.js";
import { syntheticLexicalRanker, syntheticV3Ranker } from "./v3-adapter.js";

type GroupedEval = {
  passed: number;
  total: number;
  rate: number;
  failed_base_ids: string[];
};

function groupByBaseCase(cases: SyntheticCase[]): Map<string, SyntheticCase[]> {
  const grouped = new Map<string, SyntheticCase[]>();
  for (const c of cases) {
    const key = c.id.replace(/-p\d+$/, "");
    const bucket = grouped.get(key) ?? [];
    bucket.push(c);
    grouped.set(key, bucket);
  }
  return grouped;
}

function runGroupedEval(
  cases: SyntheticCase[],
  ranker: typeof syntheticV3Ranker,
): GroupedEval {
  const grouped = groupByBaseCase(cases);
  let passed = 0;
  const failed: string[] = [];
  for (const [baseId, variants] of grouped.entries()) {
    const result = runSyntheticEval({ cases: variants, ranker });
    if (result.overall.passed === variants.length) passed += 1;
    else failed.push(baseId);
  }
  return {
    passed,
    total: grouped.size,
    rate: grouped.size === 0 ? 0 : passed / grouped.size,
    failed_base_ids: failed,
  };
}

function filterCases(
  cases: SyntheticCase[],
  predicate: (syntheticCase: SyntheticCase) => boolean,
): SyntheticCase[] {
  return cases.filter(predicate);
}

function isDirectAnchoredExactQuery(c: SyntheticCase): boolean {
  const phrase = c.paraphrase_args?.phrase?.toLowerCase();
  return phrase !== undefined && c.query.toLowerCase() === phrase;
}

function isIndirectAnchoredQuery(c: SyntheticCase): boolean {
  const q = c.query.toLowerCase();
  return q.includes("canonical writeup") || q.includes("main doc");
}

function isDirectReleaseQuery(c: SyntheticCase): boolean {
  const q = c.query.toLowerCase();
  return (
    q.includes("changed") ||
    q.includes("new in") ||
    q.includes("release notes") ||
    q.includes("changelog")
  );
}

function isIndirectReleaseQuery(c: SyntheticCase): boolean {
  const q = c.query.toLowerCase();
  return q.includes("adopt") || q.includes("moving an app onto");
}

describe("withParaphraseFanout", () => {
  it("emits multiple variants per case sharing corpus and expected_top1", () => {
    const original = generateChangelogReleaseIntentCases({ count: 1, seed: 1 });
    const fanned = withParaphraseFanout(original);
    expect(fanned.length).toBeGreaterThan(original.length);
    for (const variant of fanned) {
      expect(variant.expected_top1).toBe(original[0].expected_top1);
      expect(variant.corpus).toEqual(original[0].corpus);
    }
    const queries = new Set(fanned.map((v) => v.query));
    expect(queries.size).toBeGreaterThan(1);
  });

  it("each variant has a unique id derived from the parent case + paraphrase index", () => {
    const original = generateChangelogReleaseIntentCases({ count: 2, seed: 2 });
    const fanned = withParaphraseFanout(original);
    const ids = new Set(fanned.map((v) => v.id));
    expect(ids.size).toBe(fanned.length);
  });

  it("preserves loss_class and intent across paraphrases", () => {
    const original = generateDecisionVsProceduralCases({ count: 1, seed: 3 });
    const fanned = withParaphraseFanout(original);
    for (const v of fanned) {
      expect(v.loss_class).toBe(original[0].loss_class);
      expect(v.intent).toBe(original[0].intent);
    }
  });

  it("works across every loss class without throwing or producing empty fanouts", () => {
    const families = [
      generateParentVsLeafCases({ count: 1, seed: 11 }),
      generateHardParentVsLeafCases({ count: 1, seed: 12 }),
      generateAnchoredExactVsBroadCases({ count: 1, seed: 13 }),
      generateHardAnchoredExactVsBroadCases({ count: 1, seed: 14 }),
      generateDecisionVsProceduralCases({ count: 1, seed: 15 }),
      generateAdjacentSiblingCases({ count: 1, seed: 16 }),
      generateChangelogReleaseIntentCases({ count: 1, seed: 17 }),
      generateOverviewVsReferenceCases({ count: 1, seed: 18 }),
    ];
    for (const family of families) {
      const fanned = withParaphraseFanout(family);
      expect(fanned.length).toBeGreaterThan(family.length);
    }
  });
});

describe("V3+V4 under stricter paraphrase fanout", () => {
  it("beats the lexical baseline on exploded variants and on grouped base cases", () => {
    const cases = withParaphraseFanout([
      ...generateHardParentVsLeafCases({ count: 20, seed: 501 }),
      ...generateHardAnchoredExactVsBroadCases({ count: 20, seed: 503 }),
      ...generateDecisionVsProceduralCases({ count: 20, seed: 505 }),
      ...generateAdjacentSiblingCases({ count: 20, seed: 507 }),
      ...generateChangelogReleaseIntentCases({ count: 20, seed: 509 }),
      ...generateOverviewVsReferenceCases({ count: 20, seed: 511 }),
    ]);
    const v3 = runSyntheticEval({ cases, ranker: syntheticV3Ranker });
    const lexical = runSyntheticEval({ cases, ranker: syntheticLexicalRanker });
    const groupedV3 = runGroupedEval(cases, syntheticV3Ranker);
    const groupedLexical = runGroupedEval(cases, syntheticLexicalRanker);

    expect(v3.overall.rate).toBeGreaterThan(lexical.overall.rate);
    expect(groupedV3.rate).toBeGreaterThanOrEqual(groupedLexical.rate);

    // eslint-disable-next-line no-console
    console.log(
      "[paraphrase fanout]",
      JSON.stringify(
        {
          exploded_v3: v3.overall,
          exploded_lexical: lexical.overall,
          grouped_v3: groupedV3,
          grouped_lexical: groupedLexical,
          lexical_per_class: lexical.per_class,
        },
        null,
        2,
      ),
    );
  });

  it("changelog holds on harder indirect release phrasings, not just explicit release words", () => {
    const all = withParaphraseFanout(
      generateChangelogReleaseIntentCases({ count: 12, seed: 21 }),
    );
    const indirect = filterCases(all, isIndirectReleaseQuery);
    const direct = filterCases(all, isDirectReleaseQuery);
    expect(indirect.length).toBeGreaterThan(0);
    expect(direct.length).toBeGreaterThan(0);

    const indirectResult = runSyntheticEval({ cases: indirect, ranker: syntheticV3Ranker });
    const directResult = runSyntheticEval({ cases: direct, ranker: syntheticV3Ranker });
    const indirectLexical = runSyntheticEval({
      cases: indirect,
      ranker: syntheticLexicalRanker,
    });

    expect(indirectResult.overall.rate).toBeGreaterThanOrEqual(0.8);
    expect(directResult.overall.rate).toBeGreaterThanOrEqual(indirectResult.overall.rate);
    expect(indirectResult.overall.rate).toBeGreaterThan(indirectLexical.overall.rate);
  });

  it("anchored holds on non-exact paraphrases, not only the bare exact phrase", () => {
    const all = withParaphraseFanout(
      generateHardAnchoredExactVsBroadCases({ count: 12, seed: 23 }),
    );
    const direct = filterCases(all, isDirectAnchoredExactQuery);
    const indirect = filterCases(all, isIndirectAnchoredQuery);
    expect(direct.length).toBeGreaterThan(0);
    expect(indirect.length).toBeGreaterThan(0);

    const directResult = runSyntheticEval({ cases: direct, ranker: syntheticV3Ranker });
    const indirectResult = runSyntheticEval({ cases: indirect, ranker: syntheticV3Ranker });

    expect(directResult.overall.rate).toBeGreaterThanOrEqual(0.9);
    expect(indirectResult.overall.rate).toBeGreaterThanOrEqual(0.65);
    // Some anchored paraphrases are still lexically easy because they retain
    // the full exact phrase. The harness-level lexical comparison is the
    // stronger check; this bucket-level assertion only verifies that V3 does
    // not depend solely on the bare exact query form.
    expect(indirectResult.overall.rate).toBeLessThanOrEqual(directResult.overall.rate);
  });

  it("parent_vs_leaf still holds when paraphrases drop explicit overview words", () => {
    const all = withParaphraseFanout(
      generateHardParentVsLeafCases({ count: 12, seed: 25 }),
    );
    const indirect = filterCases(
      all,
      (c) =>
        c.query.toLowerCase().includes("oriented") ||
        c.query.toLowerCase().includes("big picture"),
    );
    expect(indirect.length).toBeGreaterThan(0);

    const result = runSyntheticEval({ cases: indirect, ranker: syntheticV3Ranker });
    const lexical = runSyntheticEval({ cases: indirect, ranker: syntheticLexicalRanker });
    expect(result.overall.rate).toBeGreaterThanOrEqual(0.8);
    expect(result.overall.rate).toBeGreaterThan(lexical.overall.rate);
  });
});
