/**
 * Wilson score 95% confidence interval for a binomial pass rate.
 *
 * Replaces the naive normal-approximation interval (which behaves badly
 * near 0% and 100%) with the Wilson score interval, which has correct
 * coverage properties at small N and at extreme observed rates.
 *
 * Used by the synthetic harness to turn per-class assertions into
 * statistically meaningful claims:
 *
 *   expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(target)
 *
 * At observed 100% with N=30 the lower bound is ~88%; at N=1000 it's
 * ~99.6%. That spread is what tells us how many samples we need to
 * certify a given accuracy target.
 */
const Z_95 = 1.959963984540054; // 1.96 — two-sided 95% normal critical value
const Z_99 = 2.5758293035489004; // two-sided 99% normal critical value

export type WilsonInterval = { lower: number; upper: number };

export function wilson(passed: number, total: number, z: number): WilsonInterval {
  if (total <= 0) return { lower: 0, upper: 0 };
  const n = total;
  const p = passed / total;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const lower = (center - margin) / denom;
  const upper = (center + margin) / denom;
  return {
    lower: Math.max(0, Math.min(1, lower)),
    upper: Math.max(0, Math.min(1, upper)),
  };
}

export function wilson95(passed: number, total: number): WilsonInterval {
  return wilson(passed, total, Z_95);
}

export function wilson99(passed: number, total: number): WilsonInterval {
  return wilson(passed, total, Z_99);
}

export function wilson95Lower(passed: number, total: number): number {
  return wilson95(passed, total).lower;
}

export function wilson99Lower(passed: number, total: number): number {
  return wilson99(passed, total).lower;
}

export function wilson95Upper(passed: number, total: number): number {
  return wilson95(passed, total).upper;
}

export function wilson99Upper(passed: number, total: number): number {
  return wilson99(passed, total).upper;
}

/**
 * Sample size required (roughly) to achieve a Wilson lower bound `target`
 * given an observed pass rate of 1.0 (no failures). Used to plan
 * generator counts: if you want to certify 99% with no observed failures,
 * you need N ≥ requiredSampleSizeFor100Pct(0.99).
 */
export function requiredSampleSizeFor100Pct(target: number): number {
  // Solve wilson95Lower(N, N) >= target for N. Closed-form exists, but a
  // monotone search is fine and avoids algebra mistakes.
  let lo = 1;
  let hi = 100_000;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (wilson95Lower(mid, mid) >= target) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function additionalSuccessesForWilsonLower(args: {
  passed: number;
  total: number;
  target: number;
  confidence: "95" | "99";
}): number {
  const lower = args.confidence === "99" ? wilson99Lower : wilson95Lower;
  if (lower(args.passed, args.total) >= args.target) return 0;
  let added = 1;
  while (added <= 1_000_000) {
    if (lower(args.passed + added, args.total + added) >= args.target) break;
    added *= 2;
  }
  let lo = Math.floor(added / 2) + 1;
  let hi = added;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (lower(args.passed + mid, args.total + mid) >= args.target) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
