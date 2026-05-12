/**
 * V4.9 — anti-pattern detection.
 *
 * Some perturbations should make retrieval HARDER, not easier. If V3 rate
 * improves under such a perturbation, that's evidence of an accidental
 * coupling — V3 is probably riding on a brittle correlation rather than
 * the principle the named rule claims.
 *
 * The probes here pair a "neutral" baseline against a "should-be-harmful"
 * perturbation and assert v3(perturbed) <= v3(baseline) + epsilon. A
 * spurious improvement is a smoking gun.
 *
 * Probes:
 *   1. Adding mislabeled distractors should not improve V3.
 *   2. Path-structure noise on parent_vs_leaf should not improve V3.
 *   3. Title verbosity on the target should not improve V3.
 *   4. Duplicating a case should not change V3 rate.
 *   5. Adding additional distractor docs should not improve V3.
 */
import { describe, expect, it } from "vitest";
import {
  generateChangelogReleaseIntentCases,
  generateConceptNearMissCases,
  generateConceptPlusExampleCases,
  generateHardAnchoredExactVsBroadCases,
  generateHardParentVsLeafCases,
  generateOverviewVsReferenceCases,
  withNoisyProfiles,
  withPathStructureNoise,
  withTitleVerbosity,
  type SyntheticCase,
  type SyntheticDoc,
} from "./generators.js";
import { runSyntheticEval } from "./runner.js";
import { syntheticV3Ranker } from "./v3-adapter.js";

const ANTI_PATTERN_EPSILON = 0.05; // 5pp tolerance for noise

function v3Rate(cases: SyntheticCase[]): number {
  return runSyntheticEval({ cases, ranker: syntheticV3Ranker }).overall.rate;
}

function addExtraDistractors(
  cases: SyntheticCase[],
  count: number,
): SyntheticCase[] {
  return cases.map((c, i) => {
    const extras: SyntheticDoc[] = [];
    for (let k = 0; k < count; k++) {
      const path = `docs/extra/extra_${i}_${k}.md`;
      extras.push({
        source_path: path,
        title: `Extra ${k}`,
        h1: `Extra ${k}`,
        intro: `Unrelated extra distractor ${k}.`,
        headings: [`Extra ${k} basics`],
        body_tokens: ["extra", "extra", "basics"],
        doc_purpose: "guide",
        doc_role: "canonical",
      });
    }
    return { ...c, id: `${c.id}-extra`, corpus: [...c.corpus, ...extras] };
  });
}

function duplicateCases(cases: SyntheticCase[]): SyntheticCase[] {
  return cases.flatMap((c, i) => [c, { ...c, id: `${c.id}-dup-${i}` }]);
}

describe("V4.9 anti-pattern detection", () => {
  it("noisy distractor profiles should not improve V3 over the clean baseline", () => {
    // We run this across multiple classes to catch any class where V3
    // accidentally benefits from profile mislabeling.
    const families = [
      generateHardParentVsLeafCases({ count: 30, seed: 71 }),
      generateHardAnchoredExactVsBroadCases({ count: 30, seed: 73 }),
      generateOverviewVsReferenceCases({ count: 30, seed: 75 }),
      generateChangelogReleaseIntentCases({ count: 30, seed: 77 }),
      generateConceptNearMissCases({ count: 30, seed: 79 }),
    ];
    for (const baseline of families) {
      const noisy = withNoisyProfiles(baseline, { probability: 0.5, seed: 111 });
      const baseRate = v3Rate(baseline);
      const noisyRate = v3Rate(noisy);
      expect(noisyRate).toBeLessThanOrEqual(baseRate + ANTI_PATTERN_EPSILON);
    }
  });

  it("path-structure noise should not improve V3 on parent_vs_leaf", () => {
    const baseline = generateHardParentVsLeafCases({ count: 30, seed: 81 });
    const perturbed = withPathStructureNoise(baseline, {
      mode: "leaves_to_sibling_dir",
    });
    const baseRate = v3Rate(baseline);
    const perturbedRate = v3Rate(perturbed);
    expect(perturbedRate).toBeLessThanOrEqual(baseRate + ANTI_PATTERN_EPSILON);
  });

  it("title verbosity should not improve V3 over the clean baseline", () => {
    const families: Array<{ name: string; cases: SyntheticCase[] }> = [
      { name: "parent_vs_leaf_hard", cases: generateHardParentVsLeafCases({ count: 30, seed: 83 }) },
      { name: "anchored_hard", cases: generateHardAnchoredExactVsBroadCases({ count: 30, seed: 85 }) },
      { name: "overview_vs_reference", cases: generateOverviewVsReferenceCases({ count: 30, seed: 87 }) },
    ];
    const findings: Array<{ name: string; base: number; verbose: number; delta: number }> = [];
    for (const { name, cases: baseline } of families) {
      const verbose = withTitleVerbosity(baseline, { mode: "prefix_suffix" });
      const baseRate = v3Rate(baseline);
      const verboseRate = v3Rate(verbose);
      findings.push({
        name,
        base: baseRate,
        verbose: verboseRate,
        delta: verboseRate - baseRate,
      });
    }
    // eslint-disable-next-line no-console
    console.log("[anti-pattern title-verbosity]", JSON.stringify(findings, null, 2));
    for (const f of findings) {
      expect(f.delta).toBeLessThanOrEqual(ANTI_PATTERN_EPSILON);
    }
  });

  it("duplicating cases must not change V3 rate", () => {
    // Duplication should be a no-op for any rank-based metric. If V3's rate
    // shifts under duplication, the runner or ranker has accidental state.
    const baseline = generateHardAnchoredExactVsBroadCases({ count: 20, seed: 91 });
    const duplicated = duplicateCases(baseline);
    const baseRate = v3Rate(baseline);
    const dupRate = v3Rate(duplicated);
    expect(Math.abs(baseRate - dupRate)).toBeLessThan(0.001);
  });

  it("adding unrelated extra distractors should not improve V3", () => {
    const families = [
      generateHardParentVsLeafCases({ count: 20, seed: 93 }),
      generateHardAnchoredExactVsBroadCases({ count: 20, seed: 95 }),
      generateConceptPlusExampleCases({ count: 20, seed: 97 }),
    ];
    for (const baseline of families) {
      const denser = addExtraDistractors(baseline, 4);
      const baseRate = v3Rate(baseline);
      const denserRate = v3Rate(denser);
      expect(denserRate).toBeLessThanOrEqual(baseRate + ANTI_PATTERN_EPSILON);
    }
  });

  it("running the same case set twice gives identical rate (sanity)", () => {
    const baseline = generateHardParentVsLeafCases({ count: 25, seed: 99 });
    const a = v3Rate(baseline);
    const b = v3Rate(baseline);
    expect(a).toBe(b);
  });
});
