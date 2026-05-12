import { describe, expect, it } from "vitest";
import {
  generateCompositionalModeCases,
  type SyntheticCase,
} from "./generators.js";
import { runSyntheticEval } from "./runner.js";
import { syntheticLexicalRanker, syntheticV3Ranker } from "./v3-adapter.js";

describe("generateCompositionalModeCases", () => {
  it("emits a combined target plus single-anchor competitors", () => {
    const cases = generateCompositionalModeCases({ count: 4, seed: 1 });
    for (const c of cases) {
      expect(c.corpus.map((d) => d.source_path)).toContain(c.expected_top1);
      expect(c.corpus.some((d) => d.source_path.startsWith("docs/concepts/"))).toBe(
        true,
      );
      expect(c.corpus.some((d) => d.source_path.startsWith("docs/reference/"))).toBe(
        true,
      );
    }
  });

  it("uses queries with two anchors", () => {
    const cases = generateCompositionalModeCases({ count: 3, seed: 2 });
    for (const c of cases) {
      const lower = c.query.toLowerCase();
      expect(lower.includes(" with ") || lower.includes(" mode")).toBe(true);
    }
  });

  it("is deterministic given the same seed", () => {
    const a = generateCompositionalModeCases({ count: 3, seed: 17 });
    const b = generateCompositionalModeCases({ count: 3, seed: 17 });
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(a.map((c) => c.query)).toEqual(b.map((c) => c.query));
  });
});

describe("V3+V4 under compositional queries", () => {
  it("beats lexical on multi-anchor lookups", () => {
    const cases = generateCompositionalModeCases({ count: 40, seed: 31 });
    const v3 = runSyntheticEval({ cases, ranker: syntheticV3Ranker });
    const lexical = runSyntheticEval({ cases, ranker: syntheticLexicalRanker });
    expect(v3.overall.rate).toBeGreaterThanOrEqual(lexical.overall.rate);
  });

  it("keeps the canonical combined doc in top-3 at a high rate", () => {
    const cases = generateCompositionalModeCases({ count: 40, seed: 33 });
    const v3 = runSyntheticEval({ cases, ranker: syntheticV3Ranker });
    expect(v3.per_class_top3.adjacent_sibling?.rate ?? 0).toBeGreaterThanOrEqual(
      0.9,
    );
  });
});
