/**
 * Eval-only oracle decomposition for real-corpus misses.
 *
 * Slice 0 already measures source recall and the post-hoc oracle ceiling. This
 * module turns those raw facts into an action-oriented layer label: query-mode
 * mismatch, candidate-generation miss, threshold/pack loss, source-selection
 * not applied, source-selection missed, or pure top-1 ordering noise.
 */
import type { ExpectationKind } from "../types.js";

export const ORACLE_DIAGNOSTIC_LAYERS = [
  "top1_pass",
  "unsupported_honest",
  "unsupported_false_confident",
  "query_mode_mismatch",
  "candidate_generation",
  "threshold_loss",
  "pack_loss",
  "source_selection_identified_unapplied",
  "source_selection_identified_display_gap",
  "source_selection_missed_owner",
  "answer_only_top1_miss",
  "source_rank_misorder",
] as const;

export type OracleDiagnosticLayer = (typeof ORACLE_DIAGNOSTIC_LAYERS)[number];

export type OracleDiagnosticObservation = {
  id: string;
  repo: string;
  expectation_kind: ExpectationKind;
  expected_query_mode: "anchored" | "signal_empty" | "unanchored";
  actual_query_mode?: "anchored" | "signal_empty" | "unanchored";
  expected_top_source: string;
  acceptable_top_sources: string[];
  must_include_sources: string[];
  actual_top1_acceptable: boolean;
  actual_top3_acceptable: boolean;
  agent_answer_pass?: boolean;
  source_candidates: Array<{ source_path: string; rank: number }>;
  loss: {
    source_to_threshold_loss: string[] | null;
    threshold_to_pack_loss: string[] | null;
    budget_loss_sources: string[] | null;
  };
  separability: {
    available: {
      coverage_confidence: "confident" | "uncertain" | "empty";
    };
  };
  source_selection?: {
    selected_sources: Array<{
      source_path: string;
      rank: number;
      reason_codes: string[];
    }>;
  };
  source_selection_applied?: boolean;
  displayed_top3_sources?: string[];
};

export type OracleCaseDiagnostic = {
  repo: string;
  id: string;
  layer: OracleDiagnosticLayer;
  expected_top_source: string;
  acceptable_top_sources: string[];
  expected_source_rank: number | null;
  expected_reachable_at_5: boolean;
  expected_reachable_at_10: boolean;
  expected_reachable_at_20: boolean;
  expected_reachable_at_50: boolean;
  all_critical_reachable_at_5: boolean | null;
  all_critical_reachable_at_10: boolean | null;
  all_critical_reachable_at_20: boolean | null;
  all_critical_reachable_at_50: boolean | null;
  top1_acceptable: boolean;
  top3_acceptable: boolean;
  agent_answer_pass: boolean | null;
  expected_query_mode: "anchored" | "signal_empty" | "unanchored";
  actual_query_mode: "anchored" | "signal_empty" | "unanchored" | null;
  source_selection_applied: boolean | null;
  source_selection_owner_rank: number | null;
  source_selection_top_reason_codes: string[];
  displayed_top3_sources: string[];
};

export type OracleFailureAggregate = {
  counts: Record<OracleDiagnosticLayer, number>;
  cases: OracleCaseDiagnostic[];
  top1_misses: OracleCaseDiagnostic[];
  reachability: {
    expected_at_5: number;
    expected_at_10: number;
    expected_at_20: number;
    expected_at_50: number;
    all_critical_at_50: number;
    answerable_cases: number;
  };
};

export function buildOracleFailureAggregate(
  observations: OracleDiagnosticObservation[],
): OracleFailureAggregate {
  const cases = observations.map(classifyOracleCase);
  const counts = Object.fromEntries(
    ORACLE_DIAGNOSTIC_LAYERS.map((layer) => [layer, 0]),
  ) as Record<OracleDiagnosticLayer, number>;
  for (const c of cases) counts[c.layer] += 1;

  const answerable = cases.filter(
    (c) =>
      c.layer !== "unsupported_honest" &&
      c.layer !== "unsupported_false_confident",
  );

  return {
    counts,
    cases,
    top1_misses: cases.filter(
      (c) =>
        !c.top1_acceptable &&
        c.layer !== "unsupported_honest" &&
        c.layer !== "unsupported_false_confident",
    ),
    reachability: {
      expected_at_5: answerable.filter((c) => c.expected_reachable_at_5).length,
      expected_at_10: answerable.filter((c) => c.expected_reachable_at_10).length,
      expected_at_20: answerable.filter((c) => c.expected_reachable_at_20).length,
      expected_at_50: answerable.filter((c) => c.expected_reachable_at_50).length,
      all_critical_at_50: answerable.filter(
        (c) => c.all_critical_reachable_at_50 === true,
      ).length,
      answerable_cases: answerable.length,
    },
  };
}

export function classifyOracleCase(
  obs: OracleDiagnosticObservation,
): OracleCaseDiagnostic {
  const rankBySource = new Map(
    obs.source_candidates.map((s) => [s.source_path, s.rank]),
  );
  const acceptableRank = bestRank(rankBySource, obs.acceptable_top_sources);
  const criticalAt = (k: number): boolean | null => {
    if (obs.must_include_sources.length === 0) return null;
    return obs.must_include_sources.every((source) => {
      const rank = rankBySource.get(source);
      return rank !== undefined && rank <= k;
    });
  };
  const selectedRankBySource = new Map(
    (obs.source_selection?.selected_sources ?? []).map((s, index) => [
      s.source_path,
      index + 1,
    ]),
  );
  const sourceSelectionOwnerRank = bestRank(
    selectedRankBySource,
    obs.acceptable_top_sources,
  );
  const selectedTop = obs.source_selection?.selected_sources[0];
  const actualMode = obs.actual_query_mode ?? null;
  const coverage = obs.separability.available.coverage_confidence;

  let layer: OracleDiagnosticLayer;
  if (obs.expectation_kind === "signal_empty") {
    layer = coverage === "confident"
      ? "unsupported_false_confident"
      : "unsupported_honest";
  } else if (obs.actual_top1_acceptable) {
    layer = "top1_pass";
  } else if (actualMode !== null && actualMode !== obs.expected_query_mode) {
    layer = "query_mode_mismatch";
  } else if (criticalAt(50) === false) {
    layer = "candidate_generation";
  } else if ((obs.loss.source_to_threshold_loss ?? []).length > 0) {
    layer = "threshold_loss";
  } else if (
    (obs.loss.threshold_to_pack_loss ?? []).length > 0 ||
    (obs.loss.budget_loss_sources ?? []).length > 0
  ) {
    layer = "pack_loss";
  } else if (
    sourceSelectionOwnerRank === 1 &&
    obs.source_selection_applied === false
  ) {
    layer = "source_selection_identified_unapplied";
  } else if (
    sourceSelectionOwnerRank !== null &&
    sourceSelectionOwnerRank <= 3 &&
    !obs.actual_top3_acceptable
  ) {
    layer = "source_selection_identified_display_gap";
  } else if (
    obs.source_selection !== undefined &&
    (sourceSelectionOwnerRank === null || sourceSelectionOwnerRank > 3)
  ) {
    layer = "source_selection_missed_owner";
  } else if (obs.agent_answer_pass === true) {
    layer = "answer_only_top1_miss";
  } else {
    layer = "source_rank_misorder";
  }

  return {
    repo: obs.repo,
    id: obs.id,
    layer,
    expected_top_source: obs.expected_top_source,
    acceptable_top_sources: obs.acceptable_top_sources,
    expected_source_rank: acceptableRank,
    expected_reachable_at_5: acceptableRank !== null && acceptableRank <= 5,
    expected_reachable_at_10: acceptableRank !== null && acceptableRank <= 10,
    expected_reachable_at_20: acceptableRank !== null && acceptableRank <= 20,
    expected_reachable_at_50: acceptableRank !== null && acceptableRank <= 50,
    all_critical_reachable_at_5: criticalAt(5),
    all_critical_reachable_at_10: criticalAt(10),
    all_critical_reachable_at_20: criticalAt(20),
    all_critical_reachable_at_50: criticalAt(50),
    top1_acceptable: obs.actual_top1_acceptable,
    top3_acceptable: obs.actual_top3_acceptable,
    agent_answer_pass: obs.agent_answer_pass ?? null,
    expected_query_mode: obs.expected_query_mode,
    actual_query_mode: actualMode,
    source_selection_applied: obs.source_selection_applied ?? null,
    source_selection_owner_rank: sourceSelectionOwnerRank,
    source_selection_top_reason_codes: selectedTop?.reason_codes ?? [],
    displayed_top3_sources: obs.displayed_top3_sources ?? [],
  };
}

function bestRank(
  rankBySource: Map<string, number>,
  sources: string[],
): number | null {
  let best: number | null = null;
  for (const source of sources) {
    const rank = rankBySource.get(source);
    if (rank === undefined) continue;
    best = best === null ? rank : Math.min(best, rank);
  }
  return best;
}
