/**
 * Synthetic case generators.
 *
 * The 13 V2.5 source-selection display losses are too few cases to validate
 * any new primitive without overfitting. The synthetic generator produces
 * arbitrary numbers of cases per *named loss class* with deterministic
 * structure, so a primitive's mechanism can be measured separately from
 * whether it flips the small real fixture.
 *
 * Each generator answers a corpus-wide question:
 *   - parent_vs_leaf:           does the engine prefer overview when the
 *                               query is broad and N leaves compete?
 *   - anchored_exact_vs_broad:  does the engine prefer the exact-named doc
 *                               when its title contains the query phrase
 *                               and N broad-reference docs only mention it?
 *
 * Generators are pure and seed-deterministic so cases are reproducible.
 */
import { describe, expect, it } from "vitest";
import {
  generateAdjacentSiblingCases,
  generateAnchoredExactVsBroadCases,
  generateChangelogReleaseIntentCases,
  generateDecisionVsProceduralCases,
  generateHardAnchoredExactVsBroadCases,
  generateHardParentVsLeafCases,
  generateParentVsLeafCases,
  type SyntheticCase,
} from "./generators.js";

describe("generateParentVsLeafCases", () => {
  it("produces well-formed cases tagged parent_vs_leaf", () => {
    const cases = generateParentVsLeafCases({ count: 5, seed: 1 });
    expect(cases).toHaveLength(5);
    for (const c of cases) {
      expect(c.loss_class).toBe("parent_vs_leaf");
      expect(c.corpus.length).toBeGreaterThanOrEqual(3); // parent + at least 2 leaves
      expect(c.expected_top1).toBe(c.expected_must_include_top3[0]);
      // Parent doc is in the corpus.
      expect(c.corpus.map((d) => d.source_path)).toContain(c.expected_top1);
    }
  });

  it("places leaves under the parent's path", () => {
    const cases = generateParentVsLeafCases({ count: 3, seed: 2 });
    for (const c of cases) {
      const parent = c.corpus.find((d) => d.source_path === c.expected_top1);
      expect(parent).toBeDefined();
      const leaves = c.corpus.filter((d) => d.source_path !== c.expected_top1);
      // parent path stripped of extension is a prefix of every leaf path.
      const parentDir = c.expected_top1.replace(/\.md$/, "") + "/";
      for (const leaf of leaves) {
        expect(leaf.source_path.startsWith(parentDir)).toBe(true);
      }
    }
  });

  it("uses broad-domain or decision_lookup intent so the parent is the right answer", () => {
    const cases = generateParentVsLeafCases({ count: 4, seed: 3 });
    for (const c of cases) {
      expect(["broad_domain", "decision_lookup"]).toContain(c.intent);
    }
  });

  it("is deterministic given the same seed", () => {
    const a = generateParentVsLeafCases({ count: 3, seed: 42 });
    const b = generateParentVsLeafCases({ count: 3, seed: 42 });
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(a.map((c) => c.query)).toEqual(b.map((c) => c.query));
  });
});

describe("generateAnchoredExactVsBroadCases", () => {
  it("produces a corpus with one exact-title doc and several broad reference docs", () => {
    const cases = generateAnchoredExactVsBroadCases({ count: 3, seed: 7 });
    for (const c of cases) {
      expect(c.loss_class).toBe("anchored_exact_vs_broad");
      const exact = c.corpus.find((d) => d.source_path === c.expected_top1);
      expect(exact).toBeDefined();
      // Exact-title doc's title must contain the query phrase.
      expect(exact!.title.toLowerCase()).toContain(c.query.toLowerCase());
      // At least one distractor of doc_purpose api_reference exists.
      const distractors = c.corpus.filter((d) => d.source_path !== c.expected_top1);
      expect(distractors.some((d) => d.doc_purpose === "api_reference")).toBe(true);
    }
  });

  it("uses file_anchored intent", () => {
    const cases = generateAnchoredExactVsBroadCases({ count: 2, seed: 11 });
    for (const c of cases) {
      expect(c.intent).toBe("file_anchored");
    }
  });

  it("is deterministic given the same seed", () => {
    const a = generateAnchoredExactVsBroadCases({ count: 4, seed: 99 });
    const b = generateAnchoredExactVsBroadCases({ count: 4, seed: 99 });
    expect(a.map((c) => c.query)).toEqual(b.map((c) => c.query));
  });

  it("has exactly one owner doc whose title or filename matches the query phrase exactly", () => {
    const cases = [
      ...generateAnchoredExactVsBroadCases({ count: 4, seed: 7 }),
      ...generateHardAnchoredExactVsBroadCases({ count: 4, seed: 8 }),
    ];
    for (const c of cases) {
      const ownerLike = c.corpus.filter((d) => {
        const filename = d.source_path.split("/").pop()?.replace(/\.md$/, "") ?? "";
        return (
          d.title.toLowerCase() === c.query.toLowerCase() ||
          filename.toLowerCase() === c.query.toLowerCase()
        );
      });
      expect(ownerLike).toHaveLength(1);
      expect(ownerLike[0]?.source_path).toBe(c.expected_top1);
    }
  });
});

describe("SyntheticCase shape", () => {
  it("carries a rationale string explaining what the case probes", () => {
    const cases: SyntheticCase[] = generateParentVsLeafCases({ count: 1, seed: 0 });
    expect(cases[0].rationale.length).toBeGreaterThan(10);
  });

  it("keeps exactly one expected_top1 doc in each generated corpus", () => {
    const suites = [
      ...generateParentVsLeafCases({ count: 3, seed: 1 }),
      ...generateHardParentVsLeafCases({ count: 3, seed: 2 }),
      ...generateAnchoredExactVsBroadCases({ count: 3, seed: 3 }),
      ...generateHardAnchoredExactVsBroadCases({ count: 3, seed: 4 }),
      ...generateDecisionVsProceduralCases({ count: 3, seed: 5 }),
      ...generateAdjacentSiblingCases({ count: 3, seed: 6 }),
      ...generateChangelogReleaseIntentCases({ count: 3, seed: 7 }),
    ];
    for (const c of suites) {
      const matches = c.corpus.filter((d) => d.source_path === c.expected_top1);
      expect(matches).toHaveLength(1);
    }
  });
});
