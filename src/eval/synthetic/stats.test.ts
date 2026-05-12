/**
 * Wilson score interval — statistical lower/upper bounds for a binomial
 * pass rate. Used to convert per-class assertions from spot estimates
 * ("rate >= 0.9") into statistically meaningful claims ("with 95%
 * confidence, the true rate is at least 0.85"). At small N the Wilson
 * lower bound sits well below the observed rate, which is the honest
 * statement we want.
 *
 * Reference: https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval#Wilson_score_interval
 */
import { describe, expect, it } from "vitest";
import { wilson95, wilson95Lower, wilson95Upper } from "./stats.js";

describe("wilson95", () => {
  it("collapses to [0, 0] when total is 0", () => {
    expect(wilson95(0, 0)).toEqual({ lower: 0, upper: 0 });
  });

  it("returns lower < observed < upper for a typical case", () => {
    const { lower, upper } = wilson95(900, 1000);
    expect(lower).toBeLessThan(0.9);
    expect(upper).toBeGreaterThan(0.9);
    expect(upper).toBeLessThan(1);
  });

  it("at observed 100% with n=30, the lower bound is well below 1", () => {
    // 30 trials with all passes — frequentists are still uncertain.
    const { lower } = wilson95(30, 30);
    expect(lower).toBeLessThan(0.95);
  });

  it("at observed 100% with n=1000, the lower bound is much tighter", () => {
    const { lower } = wilson95(1000, 1000);
    expect(lower).toBeGreaterThan(0.99);
  });

  it("symmetric helpers agree with the full interval", () => {
    expect(wilson95Lower(820, 900)).toBeCloseTo(wilson95(820, 900).lower, 6);
    expect(wilson95Upper(820, 900)).toBeCloseTo(wilson95(820, 900).upper, 6);
  });

  it("never reports lower < 0 or upper > 1", () => {
    const { lower, upper } = wilson95(0, 10);
    expect(lower).toBeGreaterThanOrEqual(0);
    expect(upper).toBeLessThanOrEqual(1);
    const both = wilson95(10, 10);
    expect(both.lower).toBeGreaterThanOrEqual(0);
    expect(both.upper).toBeLessThanOrEqual(1);
  });

  it("requires more samples for tighter bounds — n=30 is wider than n=300 at the same observed rate", () => {
    const small = wilson95(27, 30); // 90%
    const large = wilson95(270, 300); // 90%
    const smallWidth = small.upper - small.lower;
    const largeWidth = large.upper - large.lower;
    expect(largeWidth).toBeLessThan(smallWidth);
  });
});
