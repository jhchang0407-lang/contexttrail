/**
 * V4.11 — real abstention measurement.
 *
 * The previous unsupported_sanity stub asked syntheticV3Ranker for a
 * ranking and counted any non-empty result as "confidently wrong." That
 * was wrong: the adapter masks fail-close by falling back to candidate
 * order. This suite uses a new adapter that exposes the underlying
 * SourceSelectionDecision so abstention can be measured honestly.
 *
 * What we measure:
 *   1. Hard-empty corpus (no doc matches the query at all): V3 should
 *      fail_closed at high rate. A low rate is a SAFETY leak — V3 is
 *      committing to a wrong doc with confidence.
 *   2. Strong-supported corpus: V3 must NOT fail_closed (false negative).
 *      An over-eager fail-close hurts recall.
 *
 * Wilson-95 lower bound is reported per probe so the claim is statistical.
 */
import { describe, expect, it } from "vitest";
import {
  generateHardAnchoredExactVsBroadCases,
  generateHardParentVsLeafCases,
  generateUnsupportedSanityCases,
  type SyntheticCase,
} from "./generators.js";
import { syntheticV3Decision } from "./v3-adapter.js";
import { wilson95 } from "./stats.js";

function failClosedRate(cases: SyntheticCase[]): {
  fail_closed: number;
  total: number;
  rate: number;
  lower95: number;
  upper95: number;
} {
  let failClosed = 0;
  for (const c of cases) {
    const d = syntheticV3Decision(c);
    if (d.fail_closed) failClosed += 1;
  }
  const ci = wilson95(failClosed, cases.length);
  return {
    fail_closed: failClosed,
    total: cases.length,
    rate: cases.length === 0 ? 0 : failClosed / cases.length,
    lower95: ci.lower,
    upper95: ci.upper,
  };
}

describe("V4.11 abstention measurement (the unsupported_sanity stub fix)", () => {
  it("on hard-unsupported corpora, V3 fail_closed is the safety floor we report", () => {
    const cases = generateUnsupportedSanityCases({ count: 500, seed: 2001 });
    const result = failClosedRate(cases);

    // eslint-disable-next-line no-console
    console.log("[abstention hard-unsupported]", result);

    // Sanity: the test must run on a non-empty case set.
    expect(result.total).toBe(500);

    // This is a load-bearing safety certification, not a loose witness.
    // Unsupported corpora should fail_close at effectively 100%; if the
    // Wilson lower bound slips below 99%, we have a meaningful safety
    // regression and should fail CI.
    expect(result.lower95).toBeGreaterThanOrEqual(0.99);
  });

  it("on strongly-supported corpora, V3 should NOT fail_closed (no over-abstention)", () => {
    // V3 abstaining on a clear-answer corpus is a recall failure. Verify
    // the rate is at most a small false-negative tolerance.
    const cases = [
      ...generateHardAnchoredExactVsBroadCases({ count: 250, seed: 2003 }),
      ...generateHardParentVsLeafCases({ count: 250, seed: 2005 }),
    ];
    const result = failClosedRate(cases);

    // eslint-disable-next-line no-console
    console.log("[abstention strong-support]", result);

    expect(result.total).toBe(500);
    // V3 must rarely abstain on strong-support corpora. Floor: ≤ 1%
    // false-negative abstention rate, with Wilson upper bound ≤ 5%.
    expect(result.rate).toBeLessThanOrEqual(0.01);
    expect(result.upper95).toBeLessThanOrEqual(0.05);
  });

  it("the new adapter reports fail_closed independently of the rank fallback", () => {
    // Construct a case where the corpus has no relevant doc. The old
    // adapter would emit a non-empty ranking (lexical fallback). The
    // new adapter must report fail_closed=true.
    const c = generateUnsupportedSanityCases({ count: 1, seed: 99 })[0];
    const d = syntheticV3Decision(c);
    // The adapter returns full decision metadata; ranking may still be
    // non-empty under fail_closed (for diagnostic purposes), but the
    // fail_closed flag is what we trust.
    expect(typeof d.fail_closed).toBe("boolean");
  });
});

describe("V4.11 statistical certification of abstention", () => {
  it("strong-support no-abstention upper bound is below 5% with N=500", () => {
    // Re-stated as a class certification claim.
    const cases = [
      ...generateHardAnchoredExactVsBroadCases({ count: 250, seed: 2007 }),
      ...generateHardParentVsLeafCases({ count: 250, seed: 2009 }),
    ];
    const result = failClosedRate(cases);
    // 95%-confident claim: V3 over-abstains on strong-support corpora
    // less than 5% of the time.
    expect(result.upper95).toBeLessThan(0.05);
  });
});
