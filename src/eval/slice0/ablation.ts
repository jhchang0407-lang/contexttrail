/**
 * THO-140 / PRD-0013 V2.5.7 — source-rerank ablations + generalization
 * guardrails.
 *
 * The harness re-aggregates per-case observations into per-mode metrics so
 * the report can show what each layer of V2.5 buys, on dev and holdout.
 *
 * lexical_only and full_v25 are computed from already-captured fields.
 * Other modes are typed and reported as `runnable: false` until their
 * production toggle lands; rendering them today still discourages
 * coefficient-only ships because the column is visible and empty.
 */
import type { Slice0CaseObservation } from "./report.js";

export const ABLATION_MODES = [
  "lexical_only",
  "source_profile_only",
  "multi_path_only",
  "coverage_only",
  "confidence_only",
  "full_v25",
] as const;
export type AblationMode = (typeof ABLATION_MODES)[number];

export type AblationMetrics = {
  cases: number;
  answerable_cases: number;
  candidate_recall_at_50_rate: number;
  top1_rate: number;
  top3_rate: number;
  false_confident_unsupported: number;
};

export type AblationModeResult = {
  mode: AblationMode;
  runnable: boolean;
  /** Empty when runnable=false. */
  metrics?: AblationMetrics;
  /** Same metrics shape evaluated on the dev panel only. */
  dev?: AblationMetrics;
  /** Same metrics shape evaluated on the holdout panel only. */
  holdout?: AblationMetrics;
  notes?: string;
} & {
  // Preserve a flat top-level metric shape for consumers that don't split.
  top1_rate: number;
  top3_rate: number;
  candidate_recall_at_50_rate: number;
};

export type AblationReport = {
  modes: AblationModeResult[];
};

export type AblationInput = {
  observations: Slice0CaseObservation[];
  /** Optional split-by-repo so dev/holdout columns are populated. */
  splitForRepo?: (repo: string) => "dev" | "holdout";
};

function rate(num: number, denom: number): number {
  return denom === 0 ? 0 : num / denom;
}

type ModeAccumulator = {
  cases: number;
  answerable: number;
  candidate_pass: number;
  candidate_total: number;
  top1: number;
  top3: number;
  false_conf: number;
};

function newAcc(): ModeAccumulator {
  return {
    cases: 0,
    answerable: 0,
    candidate_pass: 0,
    candidate_total: 0,
    top1: 0,
    top3: 0,
    false_conf: 0,
  };
}

function tallyFullV25(acc: ModeAccumulator, obs: Slice0CaseObservation): void {
  acc.cases += 1;
  if (obs.expectation_kind !== "signal_empty") {
    acc.answerable += 1;
    if (obs.actual_top1_acceptable) acc.top1 += 1;
    if (obs.actual_top3_acceptable) acc.top3 += 1;
  } else if (obs.separability.available.coverage_confidence === "confident") {
    acc.false_conf += 1;
  }
  if (obs.is_critical) {
    acc.candidate_total += 1;
    if (obs.source_recall.all_critical_sources_covered_at_50 === true) {
      acc.candidate_pass += 1;
    }
  }
}

function tallyLexicalOnly(acc: ModeAccumulator, obs: Slice0CaseObservation): void {
  acc.cases += 1;
  if (obs.expectation_kind !== "signal_empty") {
    acc.answerable += 1;
    const r = obs.source_recall.expected_source_rank;
    if (r !== null && r === 1) acc.top1 += 1;
    if (r !== null && r <= 3) acc.top3 += 1;
  } else if (obs.separability.available.coverage_confidence === "confident") {
    acc.false_conf += 1;
  }
  if (obs.is_critical) {
    acc.candidate_total += 1;
    if (obs.source_recall.all_critical_sources_covered_at_50 === true) {
      acc.candidate_pass += 1;
    }
  }
}

function finalize(acc: ModeAccumulator): AblationMetrics {
  return {
    cases: acc.cases,
    answerable_cases: acc.answerable,
    candidate_recall_at_50_rate: rate(acc.candidate_pass, acc.candidate_total),
    top1_rate: rate(acc.top1, acc.answerable),
    top3_rate: rate(acc.top3, acc.answerable),
    false_confident_unsupported: acc.false_conf,
  };
}

export function runRetrievalAblation(input: AblationInput): AblationReport {
  const modes: AblationModeResult[] = [];

  for (const mode of ABLATION_MODES) {
    if (mode === "full_v25" || mode === "lexical_only") {
      const overall = newAcc();
      const dev = newAcc();
      const holdout = newAcc();
      const tally = mode === "full_v25" ? tallyFullV25 : tallyLexicalOnly;
      for (const obs of input.observations) {
        tally(overall, obs);
        if (input.splitForRepo) {
          const split = input.splitForRepo(obs.repo);
          tally(split === "dev" ? dev : holdout, obs);
        }
      }
      const metrics = finalize(overall);
      modes.push({
        mode,
        runnable: true,
        metrics,
        dev: input.splitForRepo ? finalize(dev) : undefined,
        holdout: input.splitForRepo ? finalize(holdout) : undefined,
        top1_rate: metrics.top1_rate,
        top3_rate: metrics.top3_rate,
        candidate_recall_at_50_rate: metrics.candidate_recall_at_50_rate,
      });
    } else {
      modes.push({
        mode,
        runnable: false,
        notes:
          "Re-running with this toggle requires production-side flags landed in V2.5.7+. Reported as not_runnable until the toggle lands.",
        top1_rate: 0,
        top3_rate: 0,
        candidate_recall_at_50_rate: 0,
      });
    }
  }

  return { modes };
}

/**
 * Structural invariant guardrail. Every coefficient or scoring change must
 * cite a named invariant; the eval CLI fails when any change is unattributed.
 * The invariant string is opaque to the harness — it is the *commitment* that
 * matters, not the value.
 */
export type ScoringChange = {
  kind: "coefficient" | "bucket" | "feature";
  description: string;
  /** Named structural invariant (THO-140); null is a release blocker. */
  invariant: string | null;
};

export type ScoringInvariantValidation = {
  passed: boolean;
  failures: Array<{ change: ScoringChange; reason: string }>;
};

export function validateScoringInvariants(input: {
  changes: ScoringChange[];
}): ScoringInvariantValidation {
  const failures: ScoringInvariantValidation["failures"] = [];
  for (const c of input.changes) {
    if (!c.invariant) {
      failures.push({
        change: c,
        reason:
          "no named structural invariant — coefficient-only changes are not ship evidence (PRD-0013 V2.5.7)",
      });
    }
  }
  return { passed: failures.length === 0, failures };
}

/**
 * Diagnostic helper: feature deltas between the expected source and the top
 * competing source for a missed case. Surfaced in the Top misses table.
 */
export type TopCompetitorFeatures = {
  source_path: string;
  score: number;
  title_token_coverage: number;
  path_token_coverage: number;
  alias_hit_count: number;
};

export type TopCompetitorDelta = {
  expected: TopCompetitorFeatures;
  top_competitor: TopCompetitorFeatures;
  score_gap: number;
  feature_deltas: {
    title_token_coverage: number;
    path_token_coverage: number;
    alias_hit_count: number;
  };
};

export function topCompetitorDelta(input: {
  expected: TopCompetitorFeatures;
  top_competitor: TopCompetitorFeatures;
}): TopCompetitorDelta {
  return {
    expected: input.expected,
    top_competitor: input.top_competitor,
    score_gap: input.top_competitor.score - input.expected.score,
    feature_deltas: {
      title_token_coverage:
        input.top_competitor.title_token_coverage - input.expected.title_token_coverage,
      path_token_coverage:
        input.top_competitor.path_token_coverage - input.expected.path_token_coverage,
      alias_hit_count:
        input.top_competitor.alias_hit_count - input.expected.alias_hit_count,
    },
  };
}
