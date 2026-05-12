/**
 * V4.12b — compositional SET-COVER probe.
 *
 * Distinct from `generateCompositionalModeCases` (single combined target):
 * here the canonical answer is a SET of two docs that must BOTH surface
 * in top-3. Real-world: "tRPC with Next.js" needs the tRPC concept doc
 * AND the Next.js adapter doc. Top-1 alone is not sufficient.
 *
 * Pass criterion: top-3 contains BOTH expected_must_include_top3 entries.
 */
import { describe, expect, it } from "vitest";
import {
  generateCompositionalSetCoverCases,
  generateHardCompositionalSetCoverCases,
  type SyntheticCase,
} from "./generators.js";
import { syntheticLexicalRanker, syntheticV3Ranker } from "./v3-adapter.js";
import { wilson95 } from "./stats.js";

function setCoverRate(
  cases: SyntheticCase[],
  ranker: typeof syntheticV3Ranker,
): {
  covered: number;
  total: number;
  rate: number;
  lower95: number;
  upper95: number;
} {
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

describe("generateCompositionalSetCoverCases", () => {
  it("emits cases with TWO distinct must-include sources (not one combined target)", () => {
    const cases = generateCompositionalSetCoverCases({ count: 5, seed: 1 });
    expect(cases).toHaveLength(5);
    for (const c of cases) {
      expect(c.expected_must_include_top3).toHaveLength(2);
      const [a, b] = c.expected_must_include_top3;
      expect(a).not.toBe(b);
      expect(c.corpus.map((d) => d.source_path)).toContain(a);
      expect(c.corpus.map((d) => d.source_path)).toContain(b);
    }
  });

  it("places one anchor under /concepts/ and the other under /adapters/", () => {
    const cases = generateCompositionalSetCoverCases({ count: 4, seed: 2 });
    for (const c of cases) {
      const paths = c.expected_must_include_top3;
      expect(paths.some((p) => p.startsWith("docs/concepts/"))).toBe(true);
      expect(paths.some((p) => p.startsWith("docs/adapters/"))).toBe(true);
    }
  });

  it("queries reference both feature and platform tokens", () => {
    const cases = generateCompositionalSetCoverCases({ count: 5, seed: 3 });
    for (const c of cases) {
      const f = c.paraphrase_args?.feature?.toLowerCase();
      const p = c.paraphrase_args?.platform?.toLowerCase();
      expect(f).toBeTruthy();
      expect(p).toBeTruthy();
      expect(c.query.toLowerCase()).toContain(f!);
      expect(c.query.toLowerCase()).toContain(p!);
    }
  });

  it("includes both feature-only and platform-only distractors", () => {
    const cases = generateCompositionalSetCoverCases({ count: 3, seed: 4 });
    for (const c of cases) {
      const aPath = c.expected_must_include_top3.find((p) =>
        p.startsWith("docs/concepts/"),
      );
      const bPath = c.expected_must_include_top3.find((p) =>
        p.startsWith("docs/adapters/"),
      );
      const aDistractors = c.corpus.filter(
        (d) =>
          d.source_path !== aPath &&
          d.source_path !== bPath &&
          d.source_path.startsWith("docs/concepts/"),
      );
      const bDistractors = c.corpus.filter(
        (d) =>
          d.source_path !== aPath &&
          d.source_path !== bPath &&
          d.source_path.startsWith("docs/adapters/"),
      );
      expect(aDistractors.length).toBeGreaterThanOrEqual(1);
      expect(bDistractors.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("is deterministic given the same seed", () => {
    const a = generateCompositionalSetCoverCases({ count: 4, seed: 17 });
    const b = generateCompositionalSetCoverCases({ count: 4, seed: 17 });
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(a.map((c) => c.query)).toEqual(b.map((c) => c.query));
  });
});

describe("V3+V4 under compositional set-cover probe", () => {
  it("baseline: surfaces V3 set-cover rate against lexical at N=30", () => {
    const cases = generateCompositionalSetCoverCases({ count: 30, seed: 31 });
    const v3 = setCoverRate(cases, syntheticV3Ranker);
    const lexical = setCoverRate(cases, syntheticLexicalRanker);

    // eslint-disable-next-line no-console
    console.log(
      "[compositional set-cover baseline]",
      JSON.stringify({ v3, lexical }, null, 2),
    );

    expect(v3.rate).toBeGreaterThanOrEqual(lexical.rate);
  });

  it("witnesses the failure mode: most leaks should be 'one anchor only', not 'zero anchors'", () => {
    const cases = generateCompositionalSetCoverCases({ count: 30, seed: 33 });
    let oneAnchor = 0;
    let zeroAnchors = 0;
    let bothAnchors = 0;
    for (const c of cases) {
      const top3 = new Set(syntheticV3Ranker(c).slice(0, 3));
      const hits = c.expected_must_include_top3.filter((p) => top3.has(p)).length;
      if (hits === 0) zeroAnchors += 1;
      else if (hits === 1) oneAnchor += 1;
      else bothAnchors += 1;
    }
    // eslint-disable-next-line no-console
    console.log(
      "[compositional set-cover failure mode]",
      JSON.stringify({ both: bothAnchors, one: oneAnchor, zero: zeroAnchors }, null, 2),
    );
    // Diagnostic only — we don't gate on the breakdown, just record it so
    // the next V4 primitive has a baseline.
    expect(bothAnchors + oneAnchor + zeroAnchors).toBe(30);
  });
});

describe("V4.12b statistical certification of compositional set-cover", () => {
  it("Wilson 95% bound on V3 compositional set-cover rate at N=500", () => {
    const cases = generateCompositionalSetCoverCases({ count: 500, seed: 41 });
    const v3 = setCoverRate(cases, syntheticV3Ranker);
    const lexical = setCoverRate(cases, syntheticLexicalRanker);

    // eslint-disable-next-line no-console
    console.log(
      "[compositional set-cover N=500 stats]",
      JSON.stringify({ v3, lexical }, null, 2),
    );

    // Sanity: V3 ≥ lexical.
    expect(v3.rate).toBeGreaterThanOrEqual(lexical.rate);
    // Certification: the easy compositional set-cover shape should now be
    // essentially solved, not merely better than lexical.
    expect(v3.lower95).toBeGreaterThanOrEqual(0.99);
  });
});

describe("V4.12c HARD compositional set-cover (adversarial)", () => {
  it("wrong-platform bridge near-misses use distinct source identities", () => {
    const cases = generateHardCompositionalSetCoverCases({ count: 3, seed: 49 });
    for (const c of cases) {
      const bridgePath = c.expected_must_include_top3.find((p) =>
        p.startsWith("docs/adapters/"),
      );
      const feature = (c.paraphrase_args?.feature ?? "").toLowerCase();
      const wrongBridgePaths = c.corpus
        .filter(
          (d) =>
            d.source_path.startsWith("docs/adapters/") &&
            d.source_path !== bridgePath &&
            d.title.toLowerCase().includes(feature),
        )
        .map((d) => d.source_path);
      expect(new Set(wrongBridgePaths).size).toBe(wrongBridgePaths.length);
      expect(wrongBridgePaths.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("baseline at N=30 — should expose either a real V3 advantage or a real leak", () => {
    const cases = generateHardCompositionalSetCoverCases({ count: 30, seed: 51 });
    const v3 = setCoverRate(cases, syntheticV3Ranker);
    const lexical = setCoverRate(cases, syntheticLexicalRanker);

    // eslint-disable-next-line no-console
    console.log(
      "[hard compositional set-cover baseline]",
      JSON.stringify({ v3, lexical }, null, 2),
    );

    // The hard version should pressure lexical: assert it's NOT trivially 100%.
    expect(lexical.rate).toBeLessThan(1);
    // Sanity: V3 ≥ lexical.
    expect(v3.rate).toBeGreaterThanOrEqual(lexical.rate);
  });

  it("Wilson 95% bound at N=500 — documents V3's compositional set-cover ceiling honestly", () => {
    const cases = generateHardCompositionalSetCoverCases({ count: 500, seed: 53 });
    const v3 = setCoverRate(cases, syntheticV3Ranker);
    const lexical = setCoverRate(cases, syntheticLexicalRanker);

    // eslint-disable-next-line no-console
    console.log(
      "[hard compositional set-cover N=500 stats]",
      JSON.stringify({ v3, lexical }, null, 2),
    );

    // Sanity: V3 ≥ lexical.
    expect(v3.rate).toBeGreaterThanOrEqual(lexical.rate);
    // Certification: the hard compositional set-cover claim should be a real
    // lower-bound guarantee, not just a logged number.
    expect(v3.lower95).toBeGreaterThanOrEqual(0.99);
    // Witness: hard version pressures lexical below 95% at N=500.
    expect(lexical.upper95).toBeLessThan(0.95);
  });
});
