/**
 * V4.7 — adversarial near-miss generator.
 *
 * Corpus contains the canonical target PLUS a structurally-similar doc that
 * is NOT the right answer. Probes whether V4.2's title-exact-match is too
 * greedy, and whether V3 can still pick the canonical doc when a near-miss
 * sibling shares vocabulary, path, and shape.
 *
 * Concrete shape:
 *   - target:    docs/concepts/{topic}.md  with title "{Topic}"
 *   - near-miss: docs/concepts/{topic}-internals.md  with title "{Topic} Internals"
 *   - distractors: same-topic api_reference docs
 *   - query: "{topic}" (pure phrase) — both target and near-miss could
 *     plausibly be top-1; only the bare-titled target is the right answer.
 *
 * Pass criterion: target wins top-1, NOT the near-miss internals doc.
 */
import { describe, expect, it } from "vitest";
import {
  generateConceptNearMissCases,
  withParaphraseFanout,
  type SyntheticCase,
} from "./generators.js";
import { runSyntheticEval } from "./runner.js";
import { syntheticLexicalRanker, syntheticV3Ranker } from "./v3-adapter.js";

describe("generateConceptNearMissCases", () => {
  it("emits a corpus with target plus a structurally-similar near-miss", () => {
    const cases = generateConceptNearMissCases({ count: 5, seed: 1 });
    expect(cases).toHaveLength(5);
    for (const c of cases) {
      const targetTitle = c.corpus.find((d) => d.source_path === c.expected_top1)?.title;
      // The near-miss has the target's title PLUS an extra qualifier word.
      const nearMisses = c.corpus.filter(
        (d) =>
          d.source_path !== c.expected_top1 &&
          targetTitle &&
          d.title.toLowerCase().startsWith(targetTitle.toLowerCase() + " "),
      );
      expect(nearMisses.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("uses a bare-phrase query that could plausibly match either target or near-miss", () => {
    const cases = generateConceptNearMissCases({ count: 3, seed: 2 });
    for (const c of cases) {
      // Query should be the topic phrase, not a longer one.
      expect(c.query.split(/\s+/).length).toBeLessThanOrEqual(2);
    }
  });

  it("is deterministic given the same seed", () => {
    const a = generateConceptNearMissCases({ count: 3, seed: 99 });
    const b = generateConceptNearMissCases({ count: 3, seed: 99 });
    expect(a.map((c) => c.expected_top1)).toEqual(b.map((c) => c.expected_top1));
    expect(a.map((c) => c.query)).toEqual(b.map((c) => c.query));
  });
});

describe("V3+V4 under adversarial near-miss", () => {
  it("documents whether V3 picks the bare-titled canonical doc over its near-miss sibling", () => {
    const cases = generateConceptNearMissCases({ count: 30, seed: 21 });
    const v3 = runSyntheticEval({ cases, ranker: syntheticV3Ranker });
    const lexical = runSyntheticEval({ cases, ranker: syntheticLexicalRanker });

    // eslint-disable-next-line no-console
    console.log(
      "[near-miss baseline]",
      JSON.stringify({ v3: v3.overall, lexical: lexical.overall }, null, 2),
    );

    // Sanity: V3 must not be strictly worse than lexical on near-misses.
    expect(v3.overall.rate).toBeGreaterThanOrEqual(lexical.overall.rate);
  });

  it("witnesses near-miss confusion: when V3 fails, the failure should land on the near-miss, not random docs", () => {
    const cases = generateConceptNearMissCases({ count: 30, seed: 23 });
    const result = runSyntheticEval({ cases, ranker: syntheticV3Ranker });
    let nearMissPicks = 0;
    for (const failure of result.failures) {
      const c = cases.find((cc) => cc.id === failure.case_id);
      if (!c) continue;
      const targetTitle = c.corpus.find((d) => d.source_path === c.expected_top1)?.title;
      if (!targetTitle) continue;
      const top1Path = failure.actual_top3[0];
      const top1Doc = c.corpus.find((d) => d.source_path === top1Path);
      if (
        top1Doc &&
        top1Doc.title.toLowerCase().startsWith(targetTitle.toLowerCase() + " ")
      ) {
        nearMissPicks += 1;
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      "[near-miss diagnostic]",
      JSON.stringify(
        {
          total_failures: result.failures.length,
          near_miss_picks: nearMissPicks,
          random_picks: result.failures.length - nearMissPicks,
        },
        null,
        2,
      ),
    );
    // Useful invariant: when V3 leaks, the failure mode should be a
    // near-miss (the structural confusion the test was designed to expose),
    // not random rank-1 picks. If random_picks dominate, the test is
    // probing something other than what its name claims.
    if (result.failures.length > 0) {
      expect(nearMissPicks).toBeGreaterThanOrEqual(
        Math.floor(result.failures.length * 0.5),
      );
    }
  });

  it("paraphrase × near-miss: probes whether query expansion makes the leak worse", () => {
    const cases = withParaphraseFanout(
      generateConceptNearMissCases({ count: 20, seed: 25 }),
    );
    const v3 = runSyntheticEval({ cases, ranker: syntheticV3Ranker });
    const lexical = runSyntheticEval({ cases, ranker: syntheticLexicalRanker });
    expect(v3.overall.rate).toBeGreaterThanOrEqual(lexical.overall.rate);
  });
});
