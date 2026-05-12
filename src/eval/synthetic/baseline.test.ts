/**
 * V3 baseline measurement against the synthetic suite.
 *
 * This is not a gate test — its job is to *document* where the current
 * deterministic V3 stack passes and where it leaks, so V4 work has a
 * before/after number per loss class. The assertions are loose floors,
 * intentionally below current performance, so the test stays informative
 * without flapping when synthetic seeds change.
 */
import { describe, expect, it } from "vitest";
import {
  generateAdjacentSiblingCases,
  generateAnchoredExactVsBroadCases,
  generateChangelogReleaseIntentCases,
  generateDecisionVsProceduralCases,
  generateHardAnchoredExactVsBroadCases,
  generateHardParentVsLeafCases,
  generateOverviewVsReferenceCases,
  generateParentVsLeafCases,
  generateUnsupportedSanityCases,
  withNoisyProfiles,
  withParaphraseFanout,
  withTargetPurposeDropped,
  type SyntheticCase,
} from "./generators.js";
import { runSyntheticEval } from "./runner.js";
import {
  syntheticLexicalRanker,
  syntheticV3Decision,
  syntheticV3Ranker,
} from "./v3-adapter.js";

function runGroupedParaphraseEval(
  cases: SyntheticCase[],
  ranker: typeof syntheticV3Ranker,
) {
  const grouped = new Map<string, SyntheticCase[]>();
  for (const c of cases) {
    const key = c.id.replace(/-p\d+$/, "");
    const bucket = grouped.get(key) ?? [];
    bucket.push(c);
    grouped.set(key, bucket);
  }

  let passed = 0;
  const failures: string[] = [];
  for (const [baseId, variants] of grouped.entries()) {
    const result = runSyntheticEval({ cases: variants, ranker });
    if (result.overall.passed === variants.length) passed += 1;
    else failures.push(baseId);
  }

  return {
    passed,
    total: grouped.size,
    rate: grouped.size === 0 ? 0 : passed / grouped.size,
    failures,
  };
}

describe("V3 baseline on synthetic suite", () => {
  it("records per-class top-1 + top-3 rates so V4 has a before/after delta", () => {
    const easy = [
      ...generateParentVsLeafCases({ count: 30, seed: 101 }),
      ...generateAnchoredExactVsBroadCases({ count: 30, seed: 103 }),
    ];
    const hard = [
      ...generateHardParentVsLeafCases({ count: 30, seed: 201 }),
      ...generateHardAnchoredExactVsBroadCases({ count: 30, seed: 203 }),
    ];
    const otherClasses = [
      ...generateDecisionVsProceduralCases({ count: 30, seed: 301 }),
      ...generateAdjacentSiblingCases({ count: 30, seed: 303 }),
      ...generateChangelogReleaseIntentCases({ count: 30, seed: 305 }),
      ...generateOverviewVsReferenceCases({ count: 30, seed: 307 }),
    ];
    const unsupported = generateUnsupportedSanityCases({ count: 30, seed: 401 });
    const easyResult = runSyntheticEval({ cases: easy, ranker: syntheticV3Ranker });
    const hardResult = runSyntheticEval({ cases: hard, ranker: syntheticV3Ranker });
    const otherResult = runSyntheticEval({ cases: otherClasses, ranker: syntheticV3Ranker });
    const unsupportedResult = runUnsupportedEval(unsupported);
    const lexicalHardResult = runSyntheticEval({ cases: hard, ranker: syntheticLexicalRanker });

    // Profile-noise perturbations — test whether V3 still picks correctly
    // when distractor doc_purpose labels are wrong, and whether V3 still
    // picks correctly when the target's own purpose is dropped to unknown.
    const noisyHard = withNoisyProfiles(hard, { probability: 0.5, seed: 9001 });
    const noisyOther = withNoisyProfiles(otherClasses, { probability: 0.5, seed: 9002 });
    const targetDroppedHard = withTargetPurposeDropped(hard);
    const targetDroppedOther = withTargetPurposeDropped(otherClasses);
    const noisyHardResult = runSyntheticEval({ cases: noisyHard, ranker: syntheticV3Ranker });
    const noisyOtherResult = runSyntheticEval({ cases: noisyOther, ranker: syntheticV3Ranker });
    const targetDroppedHardResult = runSyntheticEval({ cases: targetDroppedHard, ranker: syntheticV3Ranker });
    const targetDroppedOtherResult = runSyntheticEval({ cases: targetDroppedOther, ranker: syntheticV3Ranker });

    // V4.3: paraphrase fanout. Each canonical case gets exploded into N
    // query phrasings against the same corpus + same expected_top1.
    const paraphrased = withParaphraseFanout([
      ...generateHardParentVsLeafCases({ count: 30, seed: 501 }),
      ...generateHardAnchoredExactVsBroadCases({ count: 30, seed: 503 }),
      ...generateDecisionVsProceduralCases({ count: 30, seed: 505 }),
      ...generateAdjacentSiblingCases({ count: 30, seed: 507 }),
      ...generateChangelogReleaseIntentCases({ count: 30, seed: 509 }),
      ...generateOverviewVsReferenceCases({ count: 30, seed: 511 }),
    ]);
    const paraphraseResult = runSyntheticEval({ cases: paraphrased, ranker: syntheticV3Ranker });
    const lexicalParaphraseResult = runSyntheticEval({
      cases: paraphrased,
      ranker: syntheticLexicalRanker,
    });
    const groupedParaphraseResult = runGroupedParaphraseEval(
      paraphrased,
      syntheticV3Ranker,
    );
    const groupedLexicalParaphraseResult = runGroupedParaphraseEval(
      paraphrased,
      syntheticLexicalRanker,
    );
    expect(easyResult.overall.total).toBe(60);
    expect(hardResult.overall.total).toBe(60);
    expect(otherResult.overall.total).toBe(120);
    expect(lexicalHardResult.overall.rate).toBeLessThan(1);
    expect(lexicalHardResult.per_class.parent_vs_leaf?.rate ?? 1).toBeLessThan(0.2);
    expect(lexicalHardResult.per_class.anchored_exact_vs_broad?.rate ?? 1).toBeLessThan(0.95);
    expect(hardResult.overall.rate).toBeGreaterThan(lexicalHardResult.overall.rate);
    expect(paraphraseResult.overall.rate).toBeGreaterThan(
      lexicalParaphraseResult.overall.rate,
    );
    expect(groupedParaphraseResult.rate).toBeGreaterThanOrEqual(
      groupedLexicalParaphraseResult.rate,
    );
    const result = otherResult; // surface the loss classes V3 hasn't been measured on yet

    // Print the per-class snapshot so the value is captured by CI logs.
    // (Vitest preserves console output on the test report.)
    // eslint-disable-next-line no-console
    console.log(
      "[V3 baseline]",
      JSON.stringify(
        {
          easy: { overall: easyResult.overall, per_class: easyResult.per_class },
          hard: { overall: hardResult.overall, per_class: hardResult.per_class },
          lexical_hard: {
            overall: lexicalHardResult.overall,
            per_class: lexicalHardResult.per_class,
          },
          other_classes: {
            overall: otherResult.overall,
            per_class: otherResult.per_class,
            per_class_top3: otherResult.per_class_top3,
            first_8_failures: otherResult.failures.slice(0, 8).map((f) => ({
              class: f.loss_class,
              query: f.query,
              expected: f.expected_top1,
              actual_top3: f.actual_top3,
            })),
          },
          unsupported_sanity: unsupportedResult,
          noisy_profiles_hard: {
            overall: noisyHardResult.overall,
            per_class: noisyHardResult.per_class,
          },
          noisy_profiles_other: {
            overall: noisyOtherResult.overall,
            per_class: noisyOtherResult.per_class,
          },
          target_purpose_dropped_hard: {
            overall: targetDroppedHardResult.overall,
            per_class: targetDroppedHardResult.per_class,
          },
          target_purpose_dropped_other: {
            overall: targetDroppedOtherResult.overall,
            per_class: targetDroppedOtherResult.per_class,
          },
          paraphrase_fanout: {
            overall: paraphraseResult.overall,
            lexical_overall: lexicalParaphraseResult.overall,
            per_class: paraphraseResult.per_class,
            lexical_per_class: lexicalParaphraseResult.per_class,
            per_class_top3: paraphraseResult.per_class_top3,
            grouped_base_cases: groupedParaphraseResult,
            grouped_base_cases_lexical: groupedLexicalParaphraseResult,
            // First few failures across the fanout — the *queries* matter
            // here, not the corpora. Same corpus, different phrasing.
            first_8_failures: paraphraseResult.failures.slice(0, 8).map((f) => ({
              class: f.loss_class,
              query: f.query,
              expected: f.expected_top1,
              actual_top3: f.actual_top3,
            })),
          },
        },
        null,
        2,
      ),
    );
  });
});

/**
 * Unsupported sanity cases have no expected_top1 in the corpus. Pass means
 * V3 selection failed closed (returned an empty selection) instead of
 * confidently picking an unrelated doc. We re-run the V3 stack here and
 * inspect the decision directly rather than using the runner's pass/fail
 * logic (which assumes a positive expected_top1).
 */
function runUnsupportedEval(cases: ReturnType<typeof generateUnsupportedSanityCases>) {
  let failClosed = 0;
  let confidentlyWrong = 0;
  for (const c of cases) {
    const decision = syntheticV3Decision(c);
    if (decision.fail_closed) failClosed += 1;
    else confidentlyWrong += 1;
  }
  return {
    fail_closed: failClosed,
    confidently_wrong: confidentlyWrong,
    total: cases.length,
  };
}
