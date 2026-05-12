import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  generateAdjacentSiblingCases,
  generateAnchoredExactVsBroadCases,
  generateChangelogReleaseIntentCases,
  generateDecisionVsProceduralCases,
  generateHardAnchoredExactVsBroadCases,
  generateHardParentVsLeafCases,
  generateParentVsLeafCases,
  type GeneratorOptions,
  type SyntheticCase,
  type SyntheticDoc,
} from "./generators.js";
import { syntheticLexicalRanker, syntheticV3Ranker } from "./v3-adapter.js";

type GeneratorFn = (opts: GeneratorOptions) => SyntheticCase[];

function stableShuffle<T>(items: T[], salt: number): T[] {
  return items
    .map((item, index) => ({ item, key: permuteKey(index, salt) }))
    .sort((a, b) => a.key - b.key)
    .map(({ item }) => item);
}

function permuteKey(index: number, salt: number): number {
  let x = (index + 1) * 0x45d9f3b;
  x ^= salt | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

function exactOwnerCount(c: SyntheticCase): number {
  return c.corpus.filter((d) => matchesQueryOwner(d, c.query)).length;
}

function matchesQueryOwner(doc: SyntheticDoc, query: string): boolean {
  const filename = doc.source_path.split("/").pop()?.replace(/\.md$/, "") ?? "";
  const loweredQuery = query.toLowerCase();
  return (
    doc.title.toLowerCase() === loweredQuery ||
    filename.toLowerCase() === loweredQuery
  );
}

describe("synthetic generator properties", () => {
  const families: Array<[string, GeneratorFn]> = [
    ["parent_vs_leaf", generateParentVsLeafCases],
    ["parent_vs_leaf_hard", generateHardParentVsLeafCases],
    ["anchored_exact_vs_broad", generateAnchoredExactVsBroadCases],
    ["anchored_exact_vs_broad_hard", generateHardAnchoredExactVsBroadCases],
    ["decision_vs_procedural", generateDecisionVsProceduralCases],
    ["adjacent_sibling", generateAdjacentSiblingCases],
    ["changelog_release_intent", generateChangelogReleaseIntentCases],
  ];

  for (const [label, generator] of families) {
    it(`${label} is deterministic across repeated calls`, () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10_000 }),
          fc.integer({ min: 1, max: 5 }),
          (seed, count) => {
            const a = generator({ seed, count });
            const b = generator({ seed, count });
            expect(a).toEqual(b);
          },
        ),
      );
    });

    it(`${label} keeps V3 and lexical rankings invariant under corpus permutation`, () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10_000 }),
          fc.integer({ min: -100_000, max: 100_000 }),
          (seed, salt) => {
            const original = generator({ seed, count: 1 })[0];
            const permuted = {
              ...original,
              corpus: stableShuffle([...original.corpus], salt),
            };
            expect(syntheticV3Ranker(permuted)).toEqual(syntheticV3Ranker(original));
            expect(syntheticLexicalRanker(permuted)).toEqual(
              syntheticLexicalRanker(original),
            );
          },
        ),
      );
    });
  }

  it("anchored families always expose exactly one exact owner doc", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (seed) => {
        const easy = generateAnchoredExactVsBroadCases({ seed, count: 3 });
        const hard = generateHardAnchoredExactVsBroadCases({ seed, count: 3 });
        for (const c of [...easy, ...hard]) {
          expect(exactOwnerCount(c)).toBe(1);
        }
      }),
    );
  });

  it("parent_vs_leaf families always keep leaves under the parent path", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (seed) => {
        const suites = [
          ...generateParentVsLeafCases({ seed, count: 3 }),
          ...generateHardParentVsLeafCases({ seed, count: 3 }),
        ];
        for (const c of suites) {
          const parentDir = c.expected_top1.replace(/\.md$/, "") + "/";
          const leaves = c.corpus.filter((d) => d.source_path !== c.expected_top1);
          for (const leaf of leaves) {
            if (leaf.source_path.startsWith("docs/elsewhere/")) continue;
            expect(leaf.source_path.startsWith(parentDir)).toBe(true);
          }
        }
      }),
    );
  });
});
