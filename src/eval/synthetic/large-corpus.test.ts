import { describe, expect, it } from "vitest";
import {
  generateCompositionalModeCases,
  generateHardAnchoredExactVsBroadCases,
  generateHardParentVsLeafCases,
  withLargeCorpusNoise,
} from "./generators.js";
import { runSyntheticEval } from "./runner.js";
import { syntheticLexicalRanker, syntheticV3Ranker } from "./v3-adapter.js";
import { wilson95 } from "./stats.js";

describe("withLargeCorpusNoise", () => {
  it("expands per-case corpora into production-like sizes", () => {
    const original = generateHardParentVsLeafCases({ count: 2, seed: 1 });
    const expanded = withLargeCorpusNoise(original, {
      same_topic_count: 120,
      unrelated_count: 80,
      seed: 99,
    });
    for (let i = 0; i < original.length; i++) {
      expect(expanded[i].corpus.length).toBeGreaterThanOrEqual(
        original[i].corpus.length + 200,
      );
    }
  });

  it("uses the anchored phrase as the same-topic seed for anchored corpora", () => {
    const original = generateHardAnchoredExactVsBroadCases({ count: 1, seed: 7 });
    const expanded = withLargeCorpusNoise(original, {
      same_topic_count: 5,
      unrelated_count: 0,
      seed: 101,
    });
    const phrase = original[0].paraphrase_args?.phrase?.toLowerCase();
    const extras = expanded[0].corpus.filter((d) => d.source_path.startsWith("docs/large/"));
    expect(phrase).toBeTruthy();
    expect(extras.length).toBe(5);
    expect(extras.every((d) => d.title.toLowerCase().includes(phrase!))).toBe(true);
  });
});

describe("V3+V4 under large per-case corpora", () => {
  const largeNoise = {
    same_topic_count: 120,
    unrelated_count: 80,
    seed: 501,
  } as const;

  it("hard parent_vs_leaf at large corpus: V3 lower-95 ≥ 95%", () => {
    const cases = withLargeCorpusNoise(
      generateHardParentVsLeafCases({ count: 200, seed: 41 }),
      largeNoise,
    );
    const v3 = runSyntheticEval({ cases, ranker: syntheticV3Ranker });
    const lexical = runSyntheticEval({ cases, ranker: syntheticLexicalRanker });
    const ci = wilson95(v3.overall.passed, v3.overall.total);
    // eslint-disable-next-line no-console
    console.log("[large-corpus parent_vs_leaf]", {
      v3: v3.overall,
      lexical: lexical.overall,
      v3_lower95: ci.lower,
    });
    expect(v3.overall.rate).toBeGreaterThan(lexical.overall.rate);
    expect(ci.lower).toBeGreaterThanOrEqual(0.95);
  }, 120_000);

  it("hard anchored_exact_vs_broad at large corpus: V3 lower-95 ≥ 95%", () => {
    const cases = withLargeCorpusNoise(
      generateHardAnchoredExactVsBroadCases({ count: 200, seed: 43 }),
      { ...largeNoise, seed: 503 },
    );
    const v3 = runSyntheticEval({ cases, ranker: syntheticV3Ranker });
    const lexical = runSyntheticEval({ cases, ranker: syntheticLexicalRanker });
    const ci = wilson95(v3.overall.passed, v3.overall.total);
    // eslint-disable-next-line no-console
    console.log("[large-corpus anchored]", {
      v3: v3.overall,
      lexical: lexical.overall,
      v3_lower95: ci.lower,
    });
    expect(v3.overall.rate).toBeGreaterThan(lexical.overall.rate);
    expect(ci.lower).toBeGreaterThanOrEqual(0.95);
  }, 120_000);

  it("compositional queries at large corpus: V3 top-3 lower-95 ≥ 85%", () => {
    const cases = withLargeCorpusNoise(
      generateCompositionalModeCases({ count: 200, seed: 45 }),
      { ...largeNoise, seed: 505 },
    );
    const v3 = runSyntheticEval({ cases, ranker: syntheticV3Ranker });
    const top3 = v3.per_class_top3.adjacent_sibling;
    const ci = top3 ? wilson95(top3.passed, top3.total) : { lower: 0, upper: 0 };
    // eslint-disable-next-line no-console
    console.log("[large-corpus compositional]", {
      top3,
      lower95: ci.lower,
    });
    expect(top3?.rate ?? 0).toBeGreaterThanOrEqual(0.85);
    expect(ci.lower).toBeGreaterThanOrEqual(0.85);
  }, 120_000);
});
