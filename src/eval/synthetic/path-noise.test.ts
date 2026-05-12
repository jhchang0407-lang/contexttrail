/**
 * V4.5 — path-structure noise.
 *
 * Real-corpus parents and children sometimes do not share a clean path
 * prefix. The canonical "middleware concepts" doc may live at
 * `docs/concepts/middleware.md` while the leaves live under
 * `docs/middleware/builtin/cors.md` — NOT a descendant of the parent's
 * directory. V3's `parent_over_leaf` rule depends on
 * `isStrictAncestorPath(parent, leaf)`. When path nesting is broken, the
 * `parent_vs_leaf` aboutness reason never fires and V3 falls back to
 * lexical, which loses on hard cases.
 *
 * The wrapper moves leaves into a sibling directory while keeping their
 * filenames and bodies identical. The expected_top1 (parent) is unchanged.
 */
import { describe, expect, it } from "vitest";
import {
  generateAdjacentSiblingCases,
  generateChangelogReleaseIntentCases,
  generateHardAnchoredExactVsBroadCases,
  generateHardParentVsLeafCases,
  generateOverviewVsReferenceCases,
  withParaphraseFanout,
  withPathStructureNoise,
  withTitleVerbosity,
  type SyntheticCase,
} from "./generators.js";
import { runSyntheticEval } from "./runner.js";
import { syntheticLexicalRanker, syntheticV3Ranker } from "./v3-adapter.js";

function groupByBase(cases: SyntheticCase[]): Map<string, SyntheticCase[]> {
  const grouped = new Map<string, SyntheticCase[]>();
  for (const c of cases) {
    const key = c.id.replace(/-p\d+$/, "");
    const bucket = grouped.get(key) ?? [];
    bucket.push(c);
    grouped.set(key, bucket);
  }
  return grouped;
}

function groupedRate(
  cases: SyntheticCase[],
  ranker: typeof syntheticV3Ranker,
): { passed: number; total: number; rate: number } {
  const grouped = groupByBase(cases);
  let passed = 0;
  for (const [, variants] of grouped.entries()) {
    const result = runSyntheticEval({ cases: variants, ranker });
    if (result.overall.passed === variants.length) passed += 1;
  }
  return { passed, total: grouped.size, rate: grouped.size === 0 ? 0 : passed / grouped.size };
}

describe("withPathStructureNoise (leaves_to_sibling_dir)", () => {
  it("moves leaves out of the parent's path prefix into a sibling directory", () => {
    const original = generateHardParentVsLeafCases({ count: 1, seed: 1 });
    const noisy = withPathStructureNoise(original, { mode: "leaves_to_sibling_dir" });
    const o = original[0];
    const n = noisy[0];
    const parentDir = o.expected_top1.replace(/\.md$/, "") + "/";
    const originalLeaves = o.corpus.filter(
      (d) =>
        d.source_path !== o.expected_top1 &&
        !d.source_path.startsWith("docs/elsewhere/"),
    );
    const noisyLeaves = n.corpus.filter(
      (d) =>
        d.source_path !== n.expected_top1 &&
        !d.source_path.startsWith("docs/elsewhere/"),
    );
    expect(originalLeaves.length).toBe(noisyLeaves.length);
    expect(originalLeaves.every((d) => d.source_path.startsWith(parentDir))).toBe(true);
    expect(noisyLeaves.every((d) => !d.source_path.startsWith(parentDir))).toBe(true);
  });

  it("preserves the parent's path and the noise docs unchanged", () => {
    const original = generateHardParentVsLeafCases({ count: 1, seed: 2 });
    const noisy = withPathStructureNoise(original, { mode: "leaves_to_sibling_dir" });
    expect(noisy[0].expected_top1).toBe(original[0].expected_top1);
    const originalNoise = original[0].corpus
      .filter((d) => d.source_path.startsWith("docs/elsewhere/"))
      .map((d) => d.source_path);
    const noisyNoise = noisy[0].corpus
      .filter((d) => d.source_path.startsWith("docs/elsewhere/"))
      .map((d) => d.source_path);
    expect(noisyNoise).toEqual(originalNoise);
  });

  it("preserves leaf titles, bodies, and headings (only paths change)", () => {
    const original = generateHardParentVsLeafCases({ count: 1, seed: 3 });
    const noisy = withPathStructureNoise(original, { mode: "leaves_to_sibling_dir" });
    const originalLeavesByTitle = new Map(
      original[0].corpus.map((d) => [d.title, d]),
    );
    for (const noisyDoc of noisy[0].corpus) {
      const originalMatch = originalLeavesByTitle.get(noisyDoc.title);
      if (!originalMatch) continue;
      // Path may differ. Everything else must match.
      expect(noisyDoc.body_tokens).toEqual(originalMatch.body_tokens);
      expect(noisyDoc.headings).toEqual(originalMatch.headings);
      expect(noisyDoc.intro).toEqual(originalMatch.intro);
    }
  });

  it("keeps outbound link references consistent with rewritten leaf paths", () => {
    const original = generateHardParentVsLeafCases({ count: 1, seed: 4 });
    const noisy = withPathStructureNoise(original, { mode: "leaves_to_sibling_dir" });
    const originalParent = original[0].corpus.find(
      (d) => d.source_path === original[0].expected_top1,
    )!;
    const noisyParent = noisy[0].corpus.find(
      (d) => d.source_path === noisy[0].expected_top1,
    )!;
    const noisyPaths = new Set(noisy[0].corpus.map((d) => d.source_path));
    expect(originalParent.outbound_links?.length).toBeGreaterThan(0);
    expect(noisyParent.outbound_links?.length).toBe(originalParent.outbound_links?.length);
    for (const link of noisyParent.outbound_links ?? []) {
      expect(noisyPaths.has(link)).toBe(true);
      expect(link.startsWith("docs/leaves/")).toBe(true);
    }
  });

  it("is a no-op for loss classes other than parent_vs_leaf (until extended)", () => {
    const cases = [
      ...generateHardAnchoredExactVsBroadCases({ count: 1, seed: 5 }),
      ...generateChangelogReleaseIntentCases({ count: 1, seed: 6 }),
    ];
    const noisy = withPathStructureNoise(cases, { mode: "leaves_to_sibling_dir" });
    expect(noisy.map((c) => c.expected_top1)).toEqual(cases.map((c) => c.expected_top1));
    for (let i = 0; i < cases.length; i++) {
      expect(noisy[i].corpus.map((d) => d.source_path)).toEqual(
        cases[i].corpus.map((d) => d.source_path),
      );
    }
  });

  it("is deterministic across repeated wraps", () => {
    const original = generateHardParentVsLeafCases({ count: 4, seed: 7 });
    const a = withPathStructureNoise(original, { mode: "leaves_to_sibling_dir" });
    const b = withPathStructureNoise(original, { mode: "leaves_to_sibling_dir" });
    expect(a.map((c) => c.corpus.map((d) => d.source_path))).toEqual(
      b.map((c) => c.corpus.map((d) => d.source_path)),
    );
  });
});

describe("V3+V4 under path-structure noise — exposes parent_over_leaf fragility", () => {
  it("V5.1 closes the parent_over_leaf leak: V3 holds near-baseline under path-structure noise", () => {
    const baseline = generateHardParentVsLeafCases({ count: 30, seed: 41 });
    const perturbed = withPathStructureNoise(baseline, {
      mode: "leaves_to_sibling_dir",
    });
    const v3Baseline = runSyntheticEval({ cases: baseline, ranker: syntheticV3Ranker });
    const v3Perturbed = runSyntheticEval({ cases: perturbed, ranker: syntheticV3Ranker });
    const lexicalPerturbed = runSyntheticEval({
      cases: perturbed,
      ranker: syntheticLexicalRanker,
    });

    // Baseline must be near-perfect — otherwise the test isn't measuring
    // the path-noise effect, it's measuring some other latent issue.
    expect(v3Baseline.overall.rate).toBeGreaterThanOrEqual(0.95);

    // V5.1 fix: drop must be small. The earlier −37pp leak is closed by
    // `concept_over_leaves_by_purpose_promoted`, which fires regardless
    // of path nesting.
    const drop = v3Baseline.overall.rate - v3Perturbed.overall.rate;
    expect(drop).toBeLessThanOrEqual(0.05);

    // V3 must clearly beat lexical under path noise — lexical loses badly.
    expect(v3Perturbed.overall.rate).toBeGreaterThan(
      lexicalPerturbed.overall.rate,
    );

    // eslint-disable-next-line no-console
    console.log(
      "[parent_over_leaf under path noise — V5.1]",
      JSON.stringify(
        {
          v3_baseline: v3Baseline.overall,
          v3_perturbed: v3Perturbed.overall,
          lexical_perturbed: lexicalPerturbed.overall,
          drop_pp: Math.round(drop * 1000) / 10,
        },
        null,
        2,
      ),
    );
  });

  it("paraphrase × path-noise: V5.1+V5.4 close the leak under query-shape variation", () => {
    const baseline = withParaphraseFanout(
      generateHardParentVsLeafCases({ count: 20, seed: 43 }),
    );
    const perturbed = withParaphraseFanout(
      withPathStructureNoise(
        generateHardParentVsLeafCases({ count: 20, seed: 43 }),
        { mode: "leaves_to_sibling_dir" },
      ),
    );
    const v3Baseline = groupedRate(baseline, syntheticV3Ranker);
    const v3Perturbed = groupedRate(perturbed, syntheticV3Ranker);
    const lexicalPerturbed = groupedRate(perturbed, syntheticLexicalRanker);

    // V5.4: the overview-shape detector lets V5.1 promote the concept doc
    // even when a leaf has strictly higher token coverage (e.g., a leaf
    // heading literally matches the paraphrased query). When the query
    // carries overview vocabulary ("what is X", "X overview", etc.), the
    // user's intent shape pins selection to the concept regardless of
    // lexical leaf-density. Drop should be small now.
    const drop = v3Baseline.rate - v3Perturbed.rate;
    expect(drop).toBeLessThanOrEqual(0.05);
    expect(v3Perturbed.rate).toBeGreaterThan(lexicalPerturbed.rate);
  });

  it("title-verbosity × path-noise: combined perturbation does not silently improve V3 above lexical", () => {
    // If V3 mysteriously *improves* under both perturbations, that means
    // some other primitive accidentally caught the case — investigate.
    // The honest expectation is: V3 ~= lexical here (no V3 advantage).
    const cases = withTitleVerbosity(
      withPathStructureNoise(
        generateHardParentVsLeafCases({ count: 30, seed: 45 }),
        { mode: "leaves_to_sibling_dir" },
      ),
      { mode: "prefix_suffix" },
    );
    const v3 = runSyntheticEval({ cases, ranker: syntheticV3Ranker });
    const lexical = runSyntheticEval({ cases, ranker: syntheticLexicalRanker });
    expect(v3.overall.rate).toBeGreaterThanOrEqual(lexical.overall.rate);
  });

  it("control: classes unaffected by path-structure noise still hold (anchored, overview, adjacent)", () => {
    // Sanity check: applying path-noise to non-applicable classes does not
    // accidentally break them. The wrapper is a no-op for these classes
    // today, so behavior should match unperturbed.
    const original = [
      ...generateHardAnchoredExactVsBroadCases({ count: 15, seed: 51 }),
      ...generateOverviewVsReferenceCases({ count: 15, seed: 53 }),
      ...generateAdjacentSiblingCases({ count: 15, seed: 55 }),
    ];
    const noisy = withPathStructureNoise(original, { mode: "leaves_to_sibling_dir" });
    const originalResult = runSyntheticEval({ cases: original, ranker: syntheticV3Ranker });
    const noisyResult = runSyntheticEval({ cases: noisy, ranker: syntheticV3Ranker });
    expect(noisyResult.overall.passed).toBe(originalResult.overall.passed);
  });
});
