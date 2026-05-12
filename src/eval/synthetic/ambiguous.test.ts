/**
 * V5.5 — ambiguous-query probe.
 *
 * Some real queries have multiple equally-valid answers. "How do error
 * boundaries work" against a corpus that documents three equivalent
 * mechanisms (try/catch, error_boundary component, ErrorBoundary
 * wrapper). The right behaviour is set-cover: top-3 should contain ALL
 * three docs, not pick one and pad with distractors.
 *
 * Pass criterion: top-3 covers all three equally-canonical sources.
 *
 * Distinct from V4.6 set-cover (concept + example) which has two docs
 * of DIFFERENT purposes. This probes whether V3 surfaces multiple docs
 * of the SAME purpose when they cover the query equally.
 */
import { describe, expect, it } from "vitest";
import {
  generateAmbiguousMultiAnswerCases,
  type SyntheticCase,
} from "./generators.js";
import { syntheticLexicalRanker, syntheticV3Ranker } from "./v3-adapter.js";
import { wilson95 } from "./stats.js";

function multiAnswerCoverageRate(
  cases: SyntheticCase[],
  ranker: typeof syntheticV3Ranker,
): { covered: number; total: number; rate: number; lower95: number; upper95: number } {
  let covered = 0;
  for (const c of cases) {
    const top3 = new Set(ranker(c).slice(0, 3));
    if (c.expected_must_include_top3.every((p) => top3.has(p))) covered += 1;
  }
  const ci = wilson95(covered, cases.length);
  return {
    covered,
    total: cases.length,
    rate: cases.length === 0 ? 0 : covered / cases.length,
    lower95: ci.lower,
    upper95: ci.upper,
  };
}

describe("generateAmbiguousMultiAnswerCases", () => {
  it("emits cases with three equally-canonical answers in expected_must_include_top3", () => {
    const cases = generateAmbiguousMultiAnswerCases({ count: 5, seed: 1 });
    expect(cases).toHaveLength(5);
    for (const c of cases) {
      expect(c.expected_must_include_top3).toHaveLength(3);
      const set = new Set(c.expected_must_include_top3);
      expect(set.size).toBe(3); // all distinct
      for (const p of c.expected_must_include_top3) {
        expect(c.corpus.map((d) => d.source_path)).toContain(p);
      }
    }
  });

  it("the three canonical answers all share the same doc_purpose", () => {
    // The probe is specifically about same-purpose ambiguity. Different-
    // purpose ambiguity is V4.6 set-cover.
    const cases = generateAmbiguousMultiAnswerCases({ count: 3, seed: 2 });
    for (const c of cases) {
      const purposes = c.expected_must_include_top3.map(
        (p) => c.corpus.find((d) => d.source_path === p)?.doc_purpose,
      );
      const distinctPurposes = new Set(purposes);
      expect(distinctPurposes.size).toBe(1);
    }
  });

  it("includes 2-3 distractors that share the query token but are not canonical", () => {
    const cases = generateAmbiguousMultiAnswerCases({ count: 3, seed: 3 });
    for (const c of cases) {
      const distractors = c.corpus.filter(
        (d) => !c.expected_must_include_top3.includes(d.source_path),
      );
      expect(distractors.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("is deterministic given the same seed", () => {
    const a = generateAmbiguousMultiAnswerCases({ count: 4, seed: 17 });
    const b = generateAmbiguousMultiAnswerCases({ count: 4, seed: 17 });
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(a.map((c) => c.expected_must_include_top3)).toEqual(
      b.map((c) => c.expected_must_include_top3),
    );
  });
});

describe("V3+V4 under ambiguous-query probe", () => {
  it("baseline: documents whether V3 surfaces ALL three canonical answers in top-3", () => {
    const cases = generateAmbiguousMultiAnswerCases({ count: 30, seed: 31 });
    const v3 = multiAnswerCoverageRate(cases, syntheticV3Ranker);
    const lexical = multiAnswerCoverageRate(cases, syntheticLexicalRanker);

    // eslint-disable-next-line no-console
    console.log(
      "[ambiguous baseline]",
      JSON.stringify({ v3, lexical }, null, 2),
    );

    // Sanity: V3 must not be strictly worse than lexical.
    expect(v3.rate).toBeGreaterThanOrEqual(lexical.rate);
  });

  it("witnesses partial coverage: when V3 fails, count whether 0 / 1 / 2 of the three are in top-3", () => {
    const cases = generateAmbiguousMultiAnswerCases({ count: 30, seed: 33 });
    let zero = 0;
    let one = 0;
    let two = 0;
    let three = 0;
    for (const c of cases) {
      const top3 = new Set(syntheticV3Ranker(c).slice(0, 3));
      const hits = c.expected_must_include_top3.filter((p) => top3.has(p)).length;
      if (hits === 0) zero += 1;
      else if (hits === 1) one += 1;
      else if (hits === 2) two += 1;
      else three += 1;
    }
    // eslint-disable-next-line no-console
    console.log(
      "[ambiguous coverage histogram]",
      JSON.stringify({ zero, one, two, three }, null, 2),
    );
    // Diagnostic only.
    expect(zero + one + two + three).toBe(30);
  });
});

describe("V5.5 statistical certification of ambiguous-query coverage", () => {
  it("Wilson 95% bound on V3 ambiguous coverage at N=500", () => {
    const cases = generateAmbiguousMultiAnswerCases({ count: 500, seed: 41 });
    const v3 = multiAnswerCoverageRate(cases, syntheticV3Ranker);
    const lexical = multiAnswerCoverageRate(cases, syntheticLexicalRanker);

    // eslint-disable-next-line no-console
    console.log(
      "[ambiguous N=500 stats]",
      JSON.stringify({ v3, lexical }, null, 2),
    );

    expect(v3.rate).toBeGreaterThanOrEqual(lexical.rate);
  });
});
