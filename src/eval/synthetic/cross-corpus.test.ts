/**
 * V4.8 — cross-corpus generalization probe.
 *
 * The base generators draw topic names from fixed PARENT_TOPICS,
 * LEAF_TOPIC_SUFFIXES, and REFERENCE_NOUNS arrays. If V3 has accidentally
 * fitted to those repeated tokens (via the tokenizer's stop-word list, or
 * via path/name heuristics that key on common English words), V3's wins
 * could be illusory — they'd disappear on a fresh vocabulary.
 *
 * The probe re-runs the same generator structure with a vocabulary made
 * of pseudo-nonsense words ("zorptarn", "blubcrest"), so token identity
 * cannot be the load-bearing signal. V3's wins must come from STRUCTURAL
 * properties (path nesting, doc_purpose, profile signals) — not from
 * coincidental token-shape matches.
 *
 * Pass criterion: V3's win rate on the nonsense corpora is within a
 * tight band of its win rate on the canonical-vocab corpora. If it
 * collapses, V3 was vocabulary-fitted.
 */
import { describe, expect, it } from "vitest";
import {
  generateChangelogReleaseIntentCases,
  generateConceptNearMissCases,
  generateConceptPlusExampleCases,
  generateHardAnchoredExactVsBroadCases,
  generateHardParentVsLeafCases,
  generateOverviewVsReferenceCases,
  withFreshCaseVocabulary,
  type SyntheticCase,
} from "./generators.js";
import { runSyntheticEval } from "./runner.js";
import { syntheticV3Ranker } from "./v3-adapter.js";

describe("withFreshCaseVocabulary", () => {
  it("rewrites topic words across paths, titles, intros, headings, bodies", () => {
    const original = generateHardParentVsLeafCases({ count: 1, seed: 1 });
    const swapped = withFreshCaseVocabulary(original, { seed: 1 });
    const originalTitles = original[0].corpus.map((d) => d.title.toLowerCase());
    const swappedTitles = swapped[0].corpus.map((d) => d.title.toLowerCase());
    // No title from the original vocab should survive.
    for (const ot of originalTitles) {
      expect(swappedTitles).not.toContain(ot);
    }
  });

  it("preserves the SHAPE of cases — same length, same loss_class, same intent", () => {
    const original = generateHardAnchoredExactVsBroadCases({ count: 5, seed: 2 });
    const swapped = withFreshCaseVocabulary(original, { seed: 2 });
    expect(swapped.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(swapped[i].loss_class).toBe(original[i].loss_class);
      expect(swapped[i].intent).toBe(original[i].intent);
      expect(swapped[i].corpus.length).toBe(original[i].corpus.length);
    }
  });

  it("keeps expected_top1 referencing a doc that exists in the swapped corpus", () => {
    const original = generateHardParentVsLeafCases({ count: 3, seed: 3 });
    const swapped = withFreshCaseVocabulary(original, { seed: 3 });
    for (const c of swapped) {
      expect(c.corpus.map((d) => d.source_path)).toContain(c.expected_top1);
    }
  });

  it("is deterministic given the same inputs and seed", () => {
    const original = generateHardParentVsLeafCases({ count: 4, seed: 4 });
    const a = withFreshCaseVocabulary(original, { seed: 99 });
    const b = withFreshCaseVocabulary(original, { seed: 99 });
    expect(a.map((c) => c.expected_top1)).toEqual(b.map((c) => c.expected_top1));
  });
});

describe("V3 generalizes to nonsense vocabulary", () => {
  function nonsenseSwap(cases: SyntheticCase[], seed: number): SyntheticCase[] {
    return withFreshCaseVocabulary(cases, { seed });
  }

  function deltaWithinBand(
    canonical: number,
    nonsense: number,
    bandPp: number,
  ): boolean {
    return Math.abs(canonical - nonsense) <= bandPp;
  }

  it("hard parent_vs_leaf: nonsense vocab keeps V3 within 5pp of canonical", () => {
    const canonical = generateHardParentVsLeafCases({ count: 30, seed: 41 });
    const swapped = nonsenseSwap(canonical, 41);
    const cRate = runSyntheticEval({ cases: canonical, ranker: syntheticV3Ranker }).overall.rate;
    const nRate = runSyntheticEval({ cases: swapped, ranker: syntheticV3Ranker }).overall.rate;
    expect(deltaWithinBand(cRate, nRate, 0.05)).toBe(true);
  });

  it("hard anchored_exact_vs_broad: nonsense vocab keeps V3 within 5pp of canonical", () => {
    const canonical = generateHardAnchoredExactVsBroadCases({ count: 30, seed: 43 });
    const swapped = nonsenseSwap(canonical, 43);
    const cRate = runSyntheticEval({ cases: canonical, ranker: syntheticV3Ranker }).overall.rate;
    const nRate = runSyntheticEval({ cases: swapped, ranker: syntheticV3Ranker }).overall.rate;
    expect(deltaWithinBand(cRate, nRate, 0.05)).toBe(true);
  });

  it("changelog_release_intent: nonsense vocab keeps V3 within 10pp of canonical", () => {
    // Slightly looser band for changelog because the queryAsksReleaseHistory
    // detector responds to the version-shape "v3" token regardless of pkg
    // vocabulary; the only swap is the package name token.
    const canonical = generateChangelogReleaseIntentCases({ count: 30, seed: 45 });
    const swapped = nonsenseSwap(canonical, 45);
    const cRate = runSyntheticEval({ cases: canonical, ranker: syntheticV3Ranker }).overall.rate;
    const nRate = runSyntheticEval({ cases: swapped, ranker: syntheticV3Ranker }).overall.rate;

    // eslint-disable-next-line no-console
    console.log(
      "[cross-corpus changelog]",
      JSON.stringify({ canonical: cRate, nonsense: nRate }, null, 2),
    );

    expect(deltaWithinBand(cRate, nRate, 0.10)).toBe(true);
  });

  it("near-miss: nonsense vocab keeps V3 within 5pp of canonical", () => {
    const canonical = generateConceptNearMissCases({ count: 30, seed: 47 });
    const swapped = nonsenseSwap(canonical, 47);
    const cRate = runSyntheticEval({ cases: canonical, ranker: syntheticV3Ranker }).overall.rate;
    const nRate = runSyntheticEval({ cases: swapped, ranker: syntheticV3Ranker }).overall.rate;
    expect(deltaWithinBand(cRate, nRate, 0.05)).toBe(true);
  });

  it("set-cover: nonsense vocab does not change set-cover failure mode", () => {
    // For set-cover, both canonical and nonsense should be similarly low —
    // the leak is structural, not vocabulary-dependent.
    const canonical = generateConceptPlusExampleCases({ count: 30, seed: 49 });
    const swapped = nonsenseSwap(canonical, 49);
    const cRate = runSyntheticEval({ cases: canonical, ranker: syntheticV3Ranker }).overall.rate;
    const nRate = runSyntheticEval({ cases: swapped, ranker: syntheticV3Ranker }).overall.rate;
    expect(deltaWithinBand(cRate, nRate, 0.10)).toBe(true);
  });

  it("overview_vs_reference: nonsense vocab keeps V3 within 10pp of canonical", () => {
    const canonical = generateOverviewVsReferenceCases({ count: 30, seed: 51 });
    const swapped = nonsenseSwap(canonical, 51);
    const cRate = runSyntheticEval({ cases: canonical, ranker: syntheticV3Ranker }).overall.rate;
    const nRate = runSyntheticEval({ cases: swapped, ranker: syntheticV3Ranker }).overall.rate;
    expect(deltaWithinBand(cRate, nRate, 0.10)).toBe(true);
  });
});
