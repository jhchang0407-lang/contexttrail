/**
 * Synthetic-eval runner: wraps a candidate ranker, runs it against a list
 * of generated cases, reports per-class top-1 and top-3 pass rates plus a
 * structured failure list.
 *
 * The runner is intentionally minimal. The ranker contract is: given a
 * SyntheticCase, return an ordered list of source_paths that the ranker
 * would display. The runner reads only the first 3 entries.
 */
import type { SourceSelectionLossCategory } from "./loss-category.js";
import type { SyntheticCase } from "./generators.js";

export type SyntheticRanker = (
  syntheticCase: SyntheticCase,
) => string[];

export type SyntheticEvalCounts = {
  passed: number;
  total: number;
  rate: number;
};

export type SyntheticEvalFailure = {
  case_id: string;
  loss_class: SourceSelectionLossCategory;
  query: string;
  expected_top1: string;
  actual_top3: string[];
  rationale: string;
};

export type SyntheticEvalResult = {
  overall: SyntheticEvalCounts;
  per_class: Partial<Record<SourceSelectionLossCategory, SyntheticEvalCounts>>;
  per_class_top3: Partial<Record<SourceSelectionLossCategory, SyntheticEvalCounts>>;
  failures: SyntheticEvalFailure[];
};

export type RunSyntheticEvalArgs = {
  cases: SyntheticCase[];
  ranker: SyntheticRanker;
};

export function runSyntheticEval(args: RunSyntheticEvalArgs): SyntheticEvalResult {
  const perClass = new Map<SourceSelectionLossCategory, [number, number]>();
  const perClassTop3 = new Map<SourceSelectionLossCategory, [number, number]>();
  const failures: SyntheticEvalFailure[] = [];
  let passed = 0;

  for (const c of args.cases) {
    const ranked = args.ranker(c);
    const top3 = ranked.slice(0, 3);
    const top1 = ranked[0];
    const top1Pass = top1 === c.expected_top1;
    const top3Pass = c.expected_must_include_top3.every((p) => top3.includes(p));

    bump(perClass, c.loss_class, top1Pass);
    bump(perClassTop3, c.loss_class, top3Pass);
    if (top1Pass) passed += 1;
    else {
      failures.push({
        case_id: c.id,
        loss_class: c.loss_class,
        query: c.query,
        expected_top1: c.expected_top1,
        actual_top3: top3,
        rationale: c.rationale,
      });
    }
  }

  return {
    overall: { passed, total: args.cases.length, rate: rate(passed, args.cases.length) },
    per_class: counts(perClass),
    per_class_top3: counts(perClassTop3),
    failures,
  };
}

function bump(
  map: Map<SourceSelectionLossCategory, [number, number]>,
  key: SourceSelectionLossCategory,
  pass: boolean,
): void {
  const cur = map.get(key) ?? [0, 0];
  cur[1] += 1;
  if (pass) cur[0] += 1;
  map.set(key, cur);
}

function counts(
  map: Map<SourceSelectionLossCategory, [number, number]>,
): Partial<Record<SourceSelectionLossCategory, SyntheticEvalCounts>> {
  const out: Partial<Record<SourceSelectionLossCategory, SyntheticEvalCounts>> = {};
  for (const [k, [p, t]] of map.entries()) {
    out[k] = { passed: p, total: t, rate: rate(p, t) };
  }
  return out;
}

function rate(passed: number, total: number): number {
  if (total === 0) return 0;
  return passed / total;
}
