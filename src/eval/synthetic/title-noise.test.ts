/**
 * V4.4 — title-noise perturbation.
 *
 * Real-corpus titles are rarely the bare topic word. They look like
 * "Hono middleware concepts and patterns" or "Vitest browser mode (preview)".
 * V4.2's `title_exact_match_promoted` primitive uses strict token-set
 * equality, which means verbose-but-canonical titles silently lose its
 * benefit. This perturbation exposes that fragility so the next fix can
 * relax exact-match toward "query token set is a strict subset of title
 * token set, and uniquely so."
 *
 * By default the perturbation only mutates titles. Anchored classes can
 * additionally opt into filename perturbation so the test cannot keep
 * passing through title-or-filename exact-match.
 */
import { describe, expect, it } from "vitest";
import {
  generateAnchoredExactVsBroadCases,
  generateChangelogReleaseIntentCases,
  generateHardAnchoredExactVsBroadCases,
  generateHardParentVsLeafCases,
  generateOverviewVsReferenceCases,
  generateParentVsLeafCases,
  withParaphraseFanout,
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

describe("withTitleVerbosity", () => {
  it("rewrites the target's title to include extra context words while keeping the topic", () => {
    const original = generateHardAnchoredExactVsBroadCases({ count: 1, seed: 7 });
    const verbose = withTitleVerbosity(original, { mode: "prefix_suffix" });
    const o = original[0];
    const v = verbose[0];
    const targetOriginal = o.corpus.find((d) => d.source_path === o.expected_top1)!;
    const targetVerbose = v.corpus.find((d) => d.source_path === v.expected_top1)!;
    expect(targetVerbose.title).not.toBe(targetOriginal.title);
    expect(targetVerbose.title.toLowerCase()).toContain(
      targetOriginal.title.toLowerCase(),
    );
    expect(targetVerbose.title.split(/\s+/).length).toBeGreaterThan(
      targetOriginal.title.split(/\s+/).length,
    );
  });

  it("does not change non-target docs' titles", () => {
    const original = generateHardParentVsLeafCases({ count: 1, seed: 9 });
    const verbose = withTitleVerbosity(original, { mode: "prefix_suffix" });
    const originalNonTarget = original[0].corpus
      .filter((d) => d.source_path !== original[0].expected_top1)
      .map((d) => d.title);
    const verboseNonTarget = verbose[0].corpus
      .filter((d) => d.source_path !== verbose[0].expected_top1)
      .map((d) => d.title);
    expect(verboseNonTarget).toEqual(originalNonTarget);
  });

  it("is deterministic given the same input cases", () => {
    const original = generateAnchoredExactVsBroadCases({ count: 3, seed: 11 });
    const a = withTitleVerbosity(original, { mode: "prefix_suffix" });
    const b = withTitleVerbosity(original, { mode: "prefix_suffix" });
    expect(a.map((c) => c.corpus.find((d) => d.source_path === c.expected_top1)?.title)).toEqual(
      b.map((c) => c.corpus.find((d) => d.source_path === c.expected_top1)?.title),
    );
  });

  it("can also perturb the target filename so anchored tests do not pass via unchanged filename exact-match", () => {
    const original = generateHardAnchoredExactVsBroadCases({ count: 1, seed: 13 });
    const verbose = withTitleVerbosity(original, {
      mode: "prefix_suffix",
      perturb_filename: true,
    });
    expect(verbose[0].expected_top1).not.toBe(original[0].expected_top1);
    expect(verbose[0].expected_top1).toContain("-canonical.");
    const targetVerbose = verbose[0].corpus.find(
      (d) => d.source_path === verbose[0].expected_top1,
    );
    expect(targetVerbose).toBeDefined();
  });
});

describe("V3+V4 under title-verbosity perturbation", () => {
  // The behaviours below are documented findings, not loose floors. Each
  // assertion encodes a hypothesis we want the harness to confirm or deny.

  it("anchored: V3+V4 still beats lexical even when target's title is verbose", () => {
    const cases = withTitleVerbosity(
      generateHardAnchoredExactVsBroadCases({ count: 30, seed: 21 }),
      { mode: "prefix_suffix", perturb_filename: true },
    );
    const v3 = runSyntheticEval({ cases, ranker: syntheticV3Ranker });
    const lexical = runSyntheticEval({ cases, ranker: syntheticLexicalRanker });
    expect(v3.overall.rate).toBeGreaterThan(lexical.overall.rate);
  });

  it("parent_vs_leaf: holds at near-baseline under title verbosity (≥85%)", () => {
    const cases = withTitleVerbosity(
      generateHardParentVsLeafCases({ count: 30, seed: 23 }),
      { mode: "prefix_suffix" },
    );
    const v3 = runSyntheticEval({ cases, ranker: syntheticV3Ranker });
    expect(v3.overall.rate).toBeGreaterThanOrEqual(0.85);
  });

  // overview_vs_reference under verbose titles is currently a hard class.
  // Keep this as a diagnostic rather than a negative gate so the harness
  // does not fail the day a legitimate primitive improves the class.
  it("overview_vs_reference (hardened): logs current performance under title verbosity", () => {
    const cases = withTitleVerbosity(
      generateOverviewVsReferenceCases({ count: 30, seed: 25 }),
      { mode: "prefix_suffix" },
    );
    const v3 = runSyntheticEval({ cases, ranker: syntheticV3Ranker });
    const lexical = runSyntheticEval({ cases, ranker: syntheticLexicalRanker });
    // Sanity: V3 is at least not WORSE than lexical (i.e. V3 doesn't actively
    // demote the right doc). Exact rate is logged for research tracking.
    expect(v3.overall.rate).toBeGreaterThanOrEqual(lexical.overall.rate);
    // eslint-disable-next-line no-console
    console.log(
      "[overview_vs_reference under title verbosity]",
      JSON.stringify(
        {
          v3: v3.overall,
          lexical: lexical.overall,
        },
        null,
        2,
      ),
    );
  });

  it("paraphrase × verbosity: combining both perturbations does not collapse below lexical", () => {
    const cases = withParaphraseFanout(
      [
        ...withTitleVerbosity(
          generateHardAnchoredExactVsBroadCases({ count: 15, seed: 31 }),
          { mode: "prefix_suffix", perturb_filename: true },
        ),
        ...withTitleVerbosity(
          generateHardParentVsLeafCases({ count: 15, seed: 33 }),
          { mode: "prefix_suffix" },
        ),
        ...withTitleVerbosity(
          generateOverviewVsReferenceCases({ count: 15, seed: 35 }),
          { mode: "prefix_suffix" },
        ),
        ...withTitleVerbosity(
          generateChangelogReleaseIntentCases({ count: 15, seed: 37 }),
          { mode: "prefix_suffix" },
        ),
      ],
    );
    const v3 = groupedRate(cases, syntheticV3Ranker);
    const lexical = groupedRate(cases, syntheticLexicalRanker);
    // Strict: V3 must still win on grouped base cases (every paraphrase passes)
    // even when the target's title is verbose.
    expect(v3.rate).toBeGreaterThan(lexical.rate);

    // eslint-disable-next-line no-console
    console.log(
      "[title-verbosity × paraphrase grouped]",
      JSON.stringify({ v3, lexical }, null, 2),
    );
  });

  it("paraphrase × verbosity per class: surfaces which class leaks under combined perturbation", () => {
    type ClassEval = {
      class: string;
      v3: { passed: number; total: number; rate: number };
      lexical: { passed: number; total: number; rate: number };
    };
    const families: Array<{ name: string; cases: SyntheticCase[] }> = [
      {
        name: "anchored",
        cases: withTitleVerbosity(
          generateHardAnchoredExactVsBroadCases({ count: 30, seed: 41 }),
          { mode: "prefix_suffix", perturb_filename: true },
        ),
      },
      {
        name: "parent_vs_leaf",
        cases: generateHardParentVsLeafCases({ count: 30, seed: 43 }),
      },
      {
        name: "overview_vs_reference",
        cases: generateOverviewVsReferenceCases({ count: 30, seed: 45 }),
      },
      {
        name: "changelog",
        cases: generateChangelogReleaseIntentCases({ count: 30, seed: 47 }),
      },
    ];
    const breakdown: ClassEval[] = families.map(({ name, cases }) => {
      const perturbed = name === "anchored"
        ? withParaphraseFanout(cases)
        : withParaphraseFanout(withTitleVerbosity(cases, { mode: "prefix_suffix" }));
      return {
        class: name,
        v3: groupedRate(perturbed, syntheticV3Ranker),
        lexical: groupedRate(perturbed, syntheticLexicalRanker),
      };
    });
    // eslint-disable-next-line no-console
    console.log(
      "[per-class title-verbosity × paraphrase]",
      JSON.stringify(breakdown, null, 2),
    );
    // No floor here — this test is a diagnostic. V4 work picks targets from
    // the worst class.
    expect(breakdown.length).toBe(4);
  });
});
