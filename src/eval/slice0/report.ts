/**
 * Slice 0 (PRD-0010 / THO-116, THO-117) — combined report aggregation,
 * markdown rendering, and branch decision.
 *
 * Aggregates per-case Slice 0 captures into a combined report that includes:
 *   - per-repo and per-intent breakdowns
 *   - answerable / unsupported splits
 *   - critical-source recall, oracle, and loss diagnostics
 *   - unsupported separability summary
 *   - synthetic regression status
 *   - branch decision (primary branch + recommended next PRD)
 */
import type { Slice0ChunkCandidate } from "./candidates.js";
import type {
  Slice0SourceCandidate,
  Slice0SourceRecallMetrics,
} from "./sources.js";
import type {
  Slice0OracleMetrics,
  Slice0LossDiagnostics,
} from "./oracle.js";
import type {
  Slice0SeparabilityFeatures,
  Slice0SeparabilitySummary,
} from "./separability.js";
import { summarizeSeparability } from "./separability.js";
import { decideBranch, type BranchDecision } from "./branch.js";
import type {
  ExpectationKind,
  QueryIntent,
} from "../types.js";
import type { AboutnessObservation } from "../../retrieve/aboutness.js";
import type { SourceRerankObservation } from "./slice2.js";
import {
  evaluateSlice2Gates,
  type Slice2GateResult,
} from "./slice2.js";
import { splitForRepo, type Split } from "./splits.js";
import {
  caseFailureLayer,
  FAILURE_LAYERS,
  type CaseFailureLayerObservation,
  type FailureLayer,
} from "./failure-layer.js";
import {
  runRetrievalAblation,
  type AblationReport,
} from "./ablation.js";
import {
  buildOracleFailureAggregate,
  ORACLE_DIAGNOSTIC_LAYERS,
  type OracleFailureAggregate,
} from "./oracle-report.js";
import {
  evaluateSourceOwnerPairs,
  PAIRWISE_LOSS_STAGES,
  type SourceOwnerPairAggregate,
} from "./source-owner-pairs.js";
import {
  decideCeilingBottleneck,
  type DeterministicCeilingDecision,
} from "./ceiling-decision.js";
import {
  aggregateSourceSelectionMetrics,
  classifySourceSelectionLoss,
  evaluateV3ReleaseGates,
  evaluateV3SourceSelectionGates,
  mustIncludeTop3,
  SOURCE_SELECTION_LOSS_CATEGORIES,
  V3_RELEASE_FLOORS,
  type SourceDescriptor,
  type SourceSelectionAggregate,
  type SourceSelectionLossObservation,
  type V3GateResult,
  type V3ReleaseGateResult,
} from "./source-selection.js";
import type { SourceCard } from "../../retrieve/source-card.js";
import type { SourceSelectionDecision } from "../../retrieve/source-selection-decision.js";

export type Slice0CaseObservation = {
  id: string;
  repo: string;
  expectation_kind: ExpectationKind;
  /** Whether the case contributes to critical-source recall metrics. */
  is_critical: boolean;
  expected_query_mode: "anchored" | "signal_empty" | "unanchored";
  actual_query_mode?: "anchored" | "signal_empty" | "unanchored";
  query_intent: QueryIntent;
  must_include_sources: string[];
  expected_top_source: string;
  acceptable_top_sources: string[];
  /** Pre-pack scored candidates (THO-112). */
  chunk_candidates: Slice0ChunkCandidate[];
  /** Deduped source candidates (THO-113). */
  source_candidates: Slice0SourceCandidate[];
  source_recall: Slice0SourceRecallMetrics;
  oracle: Slice0OracleMetrics;
  loss: Slice0LossDiagnostics;
  separability: Slice0SeparabilityFeatures;
  /** Whether the actual top-1 ranked chunk's source is acceptable. */
  actual_top1_acceptable: boolean;
  /** Whether any acceptable source appears in the actual top-3 chunks. */
  actual_top3_acceptable: boolean;
  /** Whether all declared must_include sources appear anywhere in the ranked response. */
  agent_answer_pass?: boolean;
  /** PRD-0012 Slice 2 v2: deterministic source-rerank movement diagnostics. */
  source_rerank?: SourceRerankObservation[];
  /**
   * THO-134: distinct source paths in displayed top-3 chunks. Used for
   * per-source failure-layer classification. Absent on legacy fixtures.
   */
  displayed_top3_sources?: string[];
  /**
   * THO-134: per-case failure-layer classification. Null for non-critical
   * cases (no must_include_sources to evaluate).
   */
  failure_layer?: CaseFailureLayerObservation | null;
  /**
   * THO-135: imported source paths for the case's corpus. When present,
   * failure-layer can classify `not_imported` distinctly from any retrieval
   * stage. Absent → inventory unavailable; classifier defaults to imported.
   */
  imported_sources?: string[];
  /**
   * THO-143 / PRD-0014 V3.1: did every `must_include_sources` entry reach
   * the displayed top-3? Distinct fact from `actual_top3_acceptable`, which
   * also passes when an `acceptable_top_sources` sibling is shown. Absent on
   * non-critical cases.
   */
  must_include_top3?: boolean;
  /**
   * THO-143 / PRD-0014 V3.1: structured loss reason when `must_include_top3`
   * is false. The category names are stable and ablatable; downstream
   * remediation reads them per-loss-type, not per-fixture.
   */
  source_selection_loss?: SourceSelectionLossObservation | null;
  /**
   * Optional descriptors keyed by source path. Populated by callers that
   * have SourceProfile data on hand; the loss classifier uses these to
   * separate decision-vs-procedural and changelog-intent losses from
   * generic display losses. Absent → classifier falls back on path shape.
   */
  source_descriptors?: SourceDescriptor[];
  /**
   * THO-144 / PRD-0014 V3.2: stable retrieval-metadata records for the top-N
   * candidate sources. Optional — populated by the runner when SourceProfile
   * data is available. NOT a Context Object; final Context Packs continue to
   * cite Doc Chunks and Cards only.
   */
  source_cards?: SourceCard[];
  /** PRD-0014 V3.3: deterministic aboutness labels for source cards. */
  source_aboutness?: AboutnessObservation[];
  /** PRD-0014 V3.4: selected source order that feeds pack/display. */
  source_selection?: SourceSelectionDecision;
  /** True when V3 source selection overrode V2.5 source-rerank ordering. */
  source_selection_applied?: boolean;
};

export type Slice0RepoCapture = {
  repo: string;
  cases: Slice0CaseObservation[];
};

export type Slice0AggregateInput = {
  captures: Slice0RepoCapture[];
  synthetic_regression: boolean;
  /** Optional details about synthetic regression for the report body. */
  synthetic_failed_gates?: string[];
  generated_at: string;
  /**
   * THO-149 / PRD-0014 V3.7: V2.5 baseline counts for must_include_top3
   * reduction. Defaults: combined = 13, holdout = 13 (PRD numbers). The
   * runner can override to track a different baseline as the panel evolves.
   */
  must_include_top3_missing_baseline?: {
    combined: number;
    holdout: number;
  };
};

export type Slice0AggregateMetrics = {
  case_count: number;
  answerable_cases: number;
  unsupported_cases: number;
  /** Across answerable+critical cases: rate where all critical sources are covered@50. */
  critical_source_set_recall_at_50_rate: number;
  critical_source_set_recall_at_20_rate: number;
  critical_source_set_recall_at_10_rate: number;
  /** Across answerable cases: top-1 acceptable rate. */
  actual_top_source_top1_acceptable_rate: number;
  actual_top_source_top3_acceptable_rate: number;
  /** Across answerable cases: oracle answerable success@50 rate. */
  oracle_answerable_success_at_50_rate: number;
  /** Loss diagnostics: rate where critical sources still present after threshold. */
  post_threshold_critical_recall_at_50_rate: number;
  post_pack_critical_recall_at_50_rate: number;
  /** Unsupported cases reporting `confident`. */
  false_confident_unsupported: number;
  synthetic_regression: boolean;
  separability: Slice0SeparabilitySummary;
};

export type Slice0PerGroupMetrics = {
  cases: number;
  answerable_cases: number;
  unsupported_cases: number;
  critical_source_set_recall_at_50_rate: number;
  actual_top1_acceptable_rate: number;
  actual_top3_acceptable_rate: number;
};

export type Slice2SplitMetrics = {
  cases: number;
  answerable_cases: number;
  unsupported_cases: number;
  repos: string[];
  /** Top-1 / top-3 from the production wire response (chunk-level). */
  wire_top1_rate: number;
  wire_top3_rate: number;
  /** Top-1 / top-3 from the source-rerank order (source-level). */
  source_rerank_top1_rate: number;
  source_rerank_top3_rate: number;
  /** Candidate recall@50 across answerable+critical cases. */
  candidate_recall_at_50_rate: number;
  /** Unsupported honesty rate: unsupported cases NOT reporting confident. */
  unsupported_honesty_rate: number;
  false_confident_unsupported: number;
  per_intent: Record<string, Slice0PerGroupMetrics>;
};

export type Slice0Report = {
  schema_version: 1;
  generated_at: string;
  case_count: number;
  answerable_cases: number;
  unsupported_cases: number;
  repos: string[];
  metrics: Slice0AggregateMetrics;
  per_repo: Record<string, Slice0PerGroupMetrics>;
  per_intent: Record<string, Slice0PerGroupMetrics>;
  observations: Slice0CaseObservation[];
  branch_decision: BranchDecision;
  synthetic_failed_gates: string[];
  /** PRD-0012 Slice 2 v2: hard gates evaluated from the same metrics. */
  slice2_gates?: Slice2GateResult;
  /** PRD-0012 Slice 2 v2: dev vs holdout split metrics. */
  splits?: Record<Split, Slice2SplitMetrics>;
  /** PRD-0012 Slice 2 v2: holdout-only Slice 2 gates (the real verdict). */
  holdout_gates?: Slice2GateResult;
  /**
   * THO-134: counts of cases by dominant failure layer. Cases without a
   * critical source set are not counted. `none` counts cases where every
   * critical source reached the displayed top-3.
   */
  failure_layer_counts?: Record<FailureLayer, number>;
  /** THO-140: per-mode ablation metrics across dev/holdout/combined. */
  ablations?: AblationReport;
  /** Eval-only decomposition of top-1 misses by first actionable layer. */
  oracle_failure_report?: OracleFailureAggregate;
  /** Eval-only owner-vs-competitor probes for stubborn real-corpus misses. */
  source_owner_pairwise?: SourceOwnerPairAggregate;
  /** THO-141: V2.5 ship verdict — pass or named-bottleneck ceiling decision. */
  ceiling_decision?: DeterministicCeilingDecision;
  /**
   * THO-143 / PRD-0014 V3.1: aggregate source-selection metrics over the
   * combined panel — must_include_top3 rate, display-loss count, per-category
   * counts. Subsequent V3 slices read these to enforce gates without
   * re-deriving per-case classification.
   */
  source_selection_metrics?: SourceSelectionAggregate;
  /**
   * THO-143 / PRD-0014 V3.1: holdout-only source-selection metrics. Holdout
   * is the ship verdict; combined is reported for context.
   */
  holdout_source_selection_metrics?: SourceSelectionAggregate;
  /**
   * THO-143 / PRD-0014 V3.1: V3 release gates evaluated on the holdout panel.
   * Default thresholds remain at PRD-0014 floors so V3.1 measures without
   * tightening; later slices flip these to the binding bar.
   */
  v3_holdout_gates?: V3GateResult;
  /**
   * THO-149 / PRD-0014 V3.7: full V3 release gates over both combined and
   * holdout panels. Reported for measurement during V3 development; the
   * runner does not gate ship on this until V3 meets all floors.
   */
  v3_release_gates?: V3ReleaseGateResult;
};

function rate(num: number, denom: number): number {
  if (denom === 0) return 0;
  return num / denom;
}

function emptyGroup(): Slice0PerGroupMetrics {
  return {
    cases: 0,
    answerable_cases: 0,
    unsupported_cases: 0,
    critical_source_set_recall_at_50_rate: 0,
    actual_top1_acceptable_rate: 0,
    actual_top3_acceptable_rate: 0,
  };
}

type GroupAccumulator = {
  group: Slice0PerGroupMetrics;
  critical_pass: number;
  critical_total: number;
  answerable_top1: number;
  answerable_top3: number;
};

function newAcc(): GroupAccumulator {
  return {
    group: emptyGroup(),
    critical_pass: 0,
    critical_total: 0,
    answerable_top1: 0,
    answerable_top3: 0,
  };
}

function tally(acc: GroupAccumulator, obs: Slice0CaseObservation): void {
  acc.group.cases += 1;
  if (obs.expectation_kind !== "signal_empty") {
    acc.group.answerable_cases += 1;
    if (obs.actual_top1_acceptable) acc.answerable_top1 += 1;
    if (obs.actual_top3_acceptable) acc.answerable_top3 += 1;
  } else {
    acc.group.unsupported_cases += 1;
  }
  if (obs.is_critical) {
    acc.critical_total += 1;
    if (obs.source_recall.all_critical_sources_covered_at_50 === true) {
      acc.critical_pass += 1;
    }
  }
}

function finalizeGroup(acc: GroupAccumulator): Slice0PerGroupMetrics {
  acc.group.critical_source_set_recall_at_50_rate = rate(
    acc.critical_pass,
    acc.critical_total,
  );
  acc.group.actual_top1_acceptable_rate = rate(acc.answerable_top1, acc.group.answerable_cases);
  acc.group.actual_top3_acceptable_rate = rate(acc.answerable_top3, acc.group.answerable_cases);
  return acc.group;
}

export function aggregateSlice0Report(input: Slice0AggregateInput): Slice0Report {
  const observations: Slice0CaseObservation[] = input.captures.flatMap((c) => c.cases);
  // THO-134: classify every critical-source case by failure layer in place,
  // before the per-repo / per-intent tallies and the markdown render read it.
  for (const obs of observations) {
    obs.failure_layer = computeObservationFailureLayer(obs);
    annotateSourceSelection(obs);
  }
  const failure_layer_counts = countFailureLayers(observations);
  const repos = input.captures.map((c) => c.repo);

  let critical_pass_at_10 = 0;
  let critical_pass_at_20 = 0;
  let critical_pass_at_50 = 0;
  let critical_total = 0;
  let answerable = 0;
  let answerable_top1 = 0;
  let answerable_top3 = 0;
  let oracle_answerable_success = 0;
  let post_threshold_pass = 0;
  let post_pack_pass = 0;

  const supportedFeatures: Slice0SeparabilityFeatures[] = [];
  const unsupportedFeatures: Slice0SeparabilityFeatures[] = [];

  const perRepoAccs = new Map<string, GroupAccumulator>();
  const perIntentAccs = new Map<string, GroupAccumulator>();

  // Per-repo grouping uses the capture's `repo` field — the case observation
  // metadata may carry a different `repo` value if the harness chose to.
  for (const cap of input.captures) {
    const repoAcc = perRepoAccs.get(cap.repo) ?? newAcc();
    for (const obs of cap.cases) tally(repoAcc, obs);
    perRepoAccs.set(cap.repo, repoAcc);
  }

  for (const obs of observations) {
    if (obs.expectation_kind !== "signal_empty") {
      answerable += 1;
      if (obs.actual_top1_acceptable) answerable_top1 += 1;
      if (obs.actual_top3_acceptable) answerable_top3 += 1;
      supportedFeatures.push(obs.separability);
    } else {
      unsupportedFeatures.push(obs.separability);
    }
    if (obs.is_critical) {
      critical_total += 1;
      if (obs.source_recall.all_critical_sources_covered_at_10 === true) critical_pass_at_10 += 1;
      if (obs.source_recall.all_critical_sources_covered_at_20 === true) critical_pass_at_20 += 1;
      if (obs.source_recall.all_critical_sources_covered_at_50 === true) critical_pass_at_50 += 1;
      if (obs.oracle.oracle_answerable_success_at_50 === true) oracle_answerable_success += 1;
      const pt = obs.loss.post_threshold_critical_recall_at_50;
      if (pt && pt.total > 0 && pt.found === pt.total) post_threshold_pass += 1;
      const pp = obs.loss.post_pack_critical_recall_at_50;
      if (pp && pp.total > 0 && pp.found === pp.total) post_pack_pass += 1;
    }

    const intentAcc = perIntentAccs.get(obs.query_intent) ?? newAcc();
    tally(intentAcc, obs);
    perIntentAccs.set(obs.query_intent, intentAcc);
  }

  const separability = summarizeSeparability({
    supported: supportedFeatures,
    unsupported: unsupportedFeatures,
  });

  const metrics: Slice0AggregateMetrics = {
    case_count: observations.length,
    answerable_cases: answerable,
    unsupported_cases: observations.length - answerable,
    critical_source_set_recall_at_10_rate: rate(critical_pass_at_10, critical_total),
    critical_source_set_recall_at_20_rate: rate(critical_pass_at_20, critical_total),
    critical_source_set_recall_at_50_rate: rate(critical_pass_at_50, critical_total),
    actual_top_source_top1_acceptable_rate: rate(answerable_top1, answerable),
    actual_top_source_top3_acceptable_rate: rate(answerable_top3, answerable),
    oracle_answerable_success_at_50_rate: rate(oracle_answerable_success, critical_total),
    post_threshold_critical_recall_at_50_rate: rate(post_threshold_pass, critical_total),
    post_pack_critical_recall_at_50_rate: rate(post_pack_pass, critical_total),
    false_confident_unsupported: separability.false_confident_unsupported,
    synthetic_regression: input.synthetic_regression,
    separability,
  };

  const branch_decision = decideBranch({
    synthetic_regression: input.synthetic_regression,
    answerable_cases: answerable,
    critical_source_set_recall_at_50_rate: metrics.critical_source_set_recall_at_50_rate,
    actual_top_source_top1_acceptable_rate: metrics.actual_top_source_top1_acceptable_rate,
    actual_top_source_top3_acceptable_rate: metrics.actual_top_source_top3_acceptable_rate,
    separability_classification: separability.classification,
    false_confident_unsupported: separability.false_confident_unsupported,
  });

  const per_repo: Record<string, Slice0PerGroupMetrics> = {};
  for (const [repo, acc] of perRepoAccs.entries()) {
    per_repo[repo] = finalizeGroup(acc);
  }
  const per_intent: Record<string, Slice0PerGroupMetrics> = {};
  for (const [intent, acc] of perIntentAccs.entries()) {
    per_intent[intent] = finalizeGroup(acc);
  }

  const slice2_gates = evaluateSlice2Gates({
    synthetic_regression: input.synthetic_regression,
    critical_source_set_recall_at_50_rate:
      metrics.critical_source_set_recall_at_50_rate,
    false_confident_unsupported: metrics.false_confident_unsupported,
    answerable_top1_rate: metrics.actual_top_source_top1_acceptable_rate,
    answerable_top3_rate: metrics.actual_top_source_top3_acceptable_rate,
  });

  // PRD-0012 Slice 2 v2: dev vs holdout split — the holdout numbers are the
  // honest verdict; dev numbers are reported for context only. Margin-based
  // gates are evaluated against the holdout panel.
  const splits: Record<Split, Slice2SplitMetrics> = {
    dev: emptySplit(),
    holdout: emptySplit(),
  };
  for (const cap of input.captures) {
    const split = splitForRepo(cap.repo);
    splits[split].repos.push(cap.repo);
  }
  for (const obs of observations) {
    accumulateSplit(splits[splitForRepo(obs.repo)], obs);
  }
  finalizeSplit(splits.dev);
  finalizeSplit(splits.holdout);

  const holdout_gates = evaluateSlice2Gates({
    synthetic_regression: input.synthetic_regression,
    critical_source_set_recall_at_50_rate:
      splits.holdout.candidate_recall_at_50_rate,
    false_confident_unsupported: splits.holdout.false_confident_unsupported,
    answerable_top1_rate: splits.holdout.wire_top1_rate,
    answerable_top3_rate: splits.holdout.wire_top3_rate,
  });

  // THO-143 / PRD-0014 V3.1: aggregate source-selection metrics over the full
  // panel and the holdout panel. The holdout aggregate is the verdict; the
  // combined aggregate is context.
  const source_selection_metrics = aggregateSourceSelectionMetrics(
    observations.map(observationToAggregateInput),
  );
  const holdoutObservations = observations.filter(
    (o) => splitForRepo(o.repo) === "holdout",
  );
  const holdout_source_selection_metrics = aggregateSourceSelectionMetrics(
    holdoutObservations.map(observationToAggregateInput),
  );
  const v3_holdout_gates = evaluateV3SourceSelectionGates({
    display_loss_count: holdout_source_selection_metrics.display_loss_count,
    // V3.1 measures only — the binding budget lands in V3.7. Use the
    // PRD-0014 ceiling so the gate exists with the right shape today and
    // future slices can tighten without changing the call site.
    display_loss_budget: 5,
    must_include_top3_rate:
      holdout_source_selection_metrics.must_include_top3_rate,
    must_include_top3_floor: 0,
    candidate_recall_at_50_rate: splits.holdout.candidate_recall_at_50_rate,
    candidate_recall_floor: 0.989,
    false_confident_unsupported: splits.holdout.false_confident_unsupported,
  });

  // THO-149 / PRD-0014 V3.7: full release-gate evaluation for measurement.
  const baselineMissing = input.must_include_top3_missing_baseline ?? {
    combined: 13,
    holdout: 13,
  };
  const v3_release_gates = evaluateV3ReleaseGates({
    combined: {
      wire_top1_rate: metrics.actual_top_source_top1_acceptable_rate,
      wire_top3_rate: metrics.actual_top_source_top3_acceptable_rate,
      candidate_recall_at_50_rate: metrics.critical_source_set_recall_at_50_rate,
      display_loss_count: source_selection_metrics.display_loss_count,
      must_include_top3_missing_baseline: baselineMissing.combined,
      must_include_top3_missing_current:
        source_selection_metrics.must_include_top3_eligible -
        source_selection_metrics.must_include_top3_passes,
    },
    holdout: {
      wire_top1_rate: splits.holdout.wire_top1_rate,
      wire_top3_rate: splits.holdout.wire_top3_rate,
      candidate_recall_at_50_rate: splits.holdout.candidate_recall_at_50_rate,
      display_loss_count: holdout_source_selection_metrics.display_loss_count,
      must_include_top3_missing_baseline: baselineMissing.holdout,
      must_include_top3_missing_current:
        holdout_source_selection_metrics.must_include_top3_eligible -
        holdout_source_selection_metrics.must_include_top3_passes,
    },
    false_confident_unsupported: metrics.false_confident_unsupported,
    unsupported_honesty_rate: splits.holdout.unsupported_honesty_rate,
    synthetic_regression: input.synthetic_regression,
  });
  const oracle_failure_report = buildOracleFailureAggregate(observations);
  const source_owner_pairwise = evaluateSourceOwnerPairs(observations);

  const report: Slice0Report = {
    schema_version: 1,
    generated_at: input.generated_at,
    case_count: observations.length,
    answerable_cases: answerable,
    unsupported_cases: observations.length - answerable,
    repos,
    metrics,
    per_repo,
    per_intent,
    observations,
    branch_decision,
    synthetic_failed_gates: input.synthetic_failed_gates ?? [],
    slice2_gates,
    splits,
    holdout_gates,
    failure_layer_counts,
    ablations: runRetrievalAblation({
      observations,
      splitForRepo: splitForRepo,
    }),
    oracle_failure_report,
    source_owner_pairwise,
    source_selection_metrics,
    holdout_source_selection_metrics,
    v3_holdout_gates,
    v3_release_gates,
  };
  // THO-141: derive the ceiling decision once the report is otherwise
  // complete so it sees the final gates + failure-layer state.
  report.ceiling_decision = decideCeilingBottleneck(report);
  return report;
}

function annotateSourceSelection(obs: Slice0CaseObservation): void {
  if (obs.expectation_kind === "signal_empty" || obs.must_include_sources.length === 0) {
    obs.must_include_top3 = true;
    obs.source_selection_loss = null;
    return;
  }
  const displayed = obs.displayed_top3_sources ?? [];
  const candidate_rank_by_source = sourceRankMapAtK(obs.source_candidates, 50);
  const descriptor_by_source = obs.source_descriptors
    ? new Map(obs.source_descriptors.map((d) => [d.source_path, d]))
    : undefined;
  obs.must_include_top3 = mustIncludeTop3({
    must_include_sources: obs.must_include_sources,
    displayed_top3_sources: displayed,
  });
  obs.source_selection_loss = classifySourceSelectionLoss({
    intent: obs.query_intent,
    must_include_sources: obs.must_include_sources,
    displayed_top3_sources: displayed,
    candidate_rank_by_source,
    descriptor_by_source,
  });
}

function observationToAggregateInput(
  obs: Slice0CaseObservation,
): import("./source-selection.js").SourceSelectionAggregateInputCase {
  const candidate_rank_by_source = sourceRankMapAtK(obs.source_candidates, 50);
  return {
    id: obs.id,
    is_answerable: obs.expectation_kind !== "signal_empty",
    intent: obs.query_intent,
    must_include_sources: obs.must_include_sources,
    displayed_top3_sources: obs.displayed_top3_sources ?? [],
    candidate_rank_by_source,
    descriptor_by_source: obs.source_descriptors
      ? new Map(obs.source_descriptors.map((d) => [d.source_path, d]))
      : undefined,
  };
}

function sourceRankMapAtK(
  sources: Slice0SourceCandidate[],
  k: number,
): Map<string, number> {
  const candidate_rank_by_source = new Map<string, number>();
  for (const s of sources) {
    if (s.rank <= k) {
      candidate_rank_by_source.set(s.source_path, s.rank);
    }
  }
  return candidate_rank_by_source;
}

function computeObservationFailureLayer(
  obs: Slice0CaseObservation,
): CaseFailureLayerObservation | null {
  if (!obs.is_critical || obs.must_include_sources.length === 0) return null;

  const candidate_rank_by_source = new Map<string, number>();
  for (const s of obs.source_candidates) {
    candidate_rank_by_source.set(s.source_path, s.rank);
  }

  // A source is "in the candidate set" iff it has a candidate rank. From
  // there: above_threshold iff not in source_to_threshold_loss; packed iff
  // also not in threshold_to_pack_loss / budget_loss_sources.
  const sourceToThresholdLoss = new Set(obs.loss.source_to_threshold_loss ?? []);
  const thresholdToPackLoss = new Set(obs.loss.threshold_to_pack_loss ?? []);
  const budgetLoss = new Set(obs.loss.budget_loss_sources ?? []);

  const above_threshold_sources = new Set<string>();
  const packed_sources = new Set<string>();
  for (const path of obs.must_include_sources) {
    if (!candidate_rank_by_source.has(path)) continue;
    if (sourceToThresholdLoss.has(path)) continue;
    above_threshold_sources.add(path);
    if (thresholdToPackLoss.has(path) || budgetLoss.has(path)) continue;
    packed_sources.add(path);
  }

  const displayed_top3_sources = new Set(obs.displayed_top3_sources ?? []);

  return caseFailureLayer({
    must_include_sources: obs.must_include_sources,
    candidate_rank_by_source,
    above_threshold_sources,
    packed_sources,
    displayed_top3_sources,
    imported_sources: obs.imported_sources
      ? new Set(obs.imported_sources)
      : null,
  });
}

function countFailureLayers(
  observations: Slice0CaseObservation[],
): Record<FailureLayer, number> {
  const counts: Record<FailureLayer, number> = Object.fromEntries(
    FAILURE_LAYERS.map((l) => [l, 0]),
  ) as Record<FailureLayer, number>;
  for (const obs of observations) {
    if (!obs.failure_layer) continue;
    counts[obs.failure_layer.layer] += 1;
  }
  return counts;
}

function emptySplit(): Slice2SplitMetrics {
  return {
    cases: 0,
    answerable_cases: 0,
    unsupported_cases: 0,
    repos: [],
    wire_top1_rate: 0,
    wire_top3_rate: 0,
    source_rerank_top1_rate: 0,
    source_rerank_top3_rate: 0,
    candidate_recall_at_50_rate: 0,
    unsupported_honesty_rate: 0,
    false_confident_unsupported: 0,
    per_intent: {},
  };
}

type SplitAcc = {
  metrics: Slice2SplitMetrics;
  wire_top1: number;
  wire_top3: number;
  rerank_top1: number;
  rerank_top3: number;
  candidate_pass: number;
  candidate_total: number;
  unsupported_total: number;
  unsupported_honest: number;
  per_intent_acc: Map<string, GroupAccumulator>;
};

const splitAccs = new WeakMap<Slice2SplitMetrics, SplitAcc>();

function getAcc(metrics: Slice2SplitMetrics): SplitAcc {
  let acc = splitAccs.get(metrics);
  if (!acc) {
    acc = {
      metrics,
      wire_top1: 0,
      wire_top3: 0,
      rerank_top1: 0,
      rerank_top3: 0,
      candidate_pass: 0,
      candidate_total: 0,
      unsupported_total: 0,
      unsupported_honest: 0,
      per_intent_acc: new Map(),
    };
    splitAccs.set(metrics, acc);
  }
  return acc;
}

function rerankTopAcceptable(
  obs: Slice0CaseObservation,
  topN: number,
): boolean {
  const sources = obs.source_rerank ?? [];
  if (sources.length === 0) return false;
  const acceptable = obs.acceptable_top_sources;
  return sources
    .slice(0, topN)
    .some((s) => acceptable.includes(s.source_path));
}

function accumulateSplit(metrics: Slice2SplitMetrics, obs: Slice0CaseObservation): void {
  const acc = getAcc(metrics);
  metrics.cases += 1;
  if (obs.expectation_kind !== "signal_empty") {
    metrics.answerable_cases += 1;
    if (obs.actual_top1_acceptable) acc.wire_top1 += 1;
    if (obs.actual_top3_acceptable) acc.wire_top3 += 1;
    if (rerankTopAcceptable(obs, 1)) acc.rerank_top1 += 1;
    if (rerankTopAcceptable(obs, 3)) acc.rerank_top3 += 1;
  } else {
    metrics.unsupported_cases += 1;
    acc.unsupported_total += 1;
    const cc = obs.separability.available.coverage_confidence;
    if (cc !== "confident") acc.unsupported_honest += 1;
    else metrics.false_confident_unsupported += 1;
  }
  if (obs.is_critical) {
    acc.candidate_total += 1;
    if (obs.source_recall.all_critical_sources_covered_at_50 === true) {
      acc.candidate_pass += 1;
    }
  }
  const intentAcc = acc.per_intent_acc.get(obs.query_intent) ?? newAcc();
  tally(intentAcc, obs);
  acc.per_intent_acc.set(obs.query_intent, intentAcc);
}

function finalizeSplit(metrics: Slice2SplitMetrics): void {
  const acc = getAcc(metrics);
  metrics.wire_top1_rate = rate(acc.wire_top1, metrics.answerable_cases);
  metrics.wire_top3_rate = rate(acc.wire_top3, metrics.answerable_cases);
  metrics.source_rerank_top1_rate = rate(acc.rerank_top1, metrics.answerable_cases);
  metrics.source_rerank_top3_rate = rate(acc.rerank_top3, metrics.answerable_cases);
  metrics.candidate_recall_at_50_rate = rate(acc.candidate_pass, acc.candidate_total);
  metrics.unsupported_honesty_rate = rate(acc.unsupported_honest, acc.unsupported_total);
  for (const [intent, intentAcc] of acc.per_intent_acc.entries()) {
    metrics.per_intent[intent] = finalizeGroup(intentAcc);
  }
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function renderSlice0Markdown(report: Slice0Report): string {
  const lines: string[] = [];
  const m = report.metrics;
  lines.push("# Retrieval Engine V2 Slice 0 — Ceiling Probes");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Repos: ${report.repos.join(", ") || "(none)"}`);
  lines.push(`Cases: ${report.case_count} (answerable=${report.answerable_cases}, unsupported=${report.unsupported_cases})`);
  lines.push("");
  lines.push("## Branch decision");
  lines.push("");
  lines.push(`- **Primary branch:** \`${report.branch_decision.primary_branch}\``);
  lines.push(`- **Recommended next PRD:** ${report.branch_decision.recommended_next_prd}`);
  lines.push(`- **Rationale:** ${report.branch_decision.rationale}`);
  lines.push("");
  lines.push("## Headline metrics");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---:|`);
  lines.push(`| critical-source-set recall@10 (answerable+critical) | ${pct(m.critical_source_set_recall_at_10_rate)} |`);
  lines.push(`| critical-source-set recall@20 | ${pct(m.critical_source_set_recall_at_20_rate)} |`);
  lines.push(`| critical-source-set recall@50 | ${pct(m.critical_source_set_recall_at_50_rate)} |`);
  lines.push(`| actual top-1 acceptable (answerable) | ${pct(m.actual_top_source_top1_acceptable_rate)} |`);
  lines.push(`| actual top-3 acceptable (answerable) | ${pct(m.actual_top_source_top3_acceptable_rate)} |`);
  lines.push(`| oracle answerable success@50 | ${pct(m.oracle_answerable_success_at_50_rate)} |`);
  lines.push(`| post-threshold critical recall@50 | ${pct(m.post_threshold_critical_recall_at_50_rate)} |`);
  lines.push(`| post-pack critical recall@50 | ${pct(m.post_pack_critical_recall_at_50_rate)} |`);
  lines.push(`| false-confident unsupported | ${m.false_confident_unsupported} |`);
  lines.push("");
  lines.push("## Per-repo");
  lines.push("");
  lines.push(`| Repo | Cases | Answerable | Critical recall@50 | Top-1 | Top-3 |`);
  lines.push(`|---|---:|---:|---:|---:|---:|`);
  for (const [repo, g] of Object.entries(report.per_repo).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(
      `| ${repo} | ${g.cases} | ${g.answerable_cases} | ${pct(g.critical_source_set_recall_at_50_rate)} | ${pct(g.actual_top1_acceptable_rate)} | ${pct(g.actual_top3_acceptable_rate)} |`,
    );
  }
  lines.push("");
  lines.push("## Per-intent");
  lines.push("");
  lines.push(`| Intent | Cases | Critical recall@50 | Top-1 | Top-3 |`);
  lines.push(`|---|---:|---:|---:|---:|`);
  for (const [intent, g] of Object.entries(report.per_intent).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(
      `| ${intent} | ${g.cases} | ${pct(g.critical_source_set_recall_at_50_rate)} | ${pct(g.actual_top1_acceptable_rate)} | ${pct(g.actual_top3_acceptable_rate)} |`,
    );
  }
  lines.push("");
  lines.push("## Top misses");
  lines.push("");
  const misses = report.observations
    .filter((o) => o.is_critical && o.source_recall.all_critical_sources_covered_at_50 !== true)
    .slice(0, 20);
  if (misses.length === 0) {
    lines.push("_(none — all critical sources covered@50)_");
  } else {
    lines.push(`| Repo | Case | Missing critical sources @50 | Oracle reachable@50 | Layer |`);
    lines.push(`|---|---|---|---|---|`);
    for (const obs of misses) {
      const missing = (obs.source_recall.missing_critical_sources_at_50 ?? []).join(", ");
      const reachable = obs.oracle.oracle_answerable_success_at_50 === true ? "yes" : "no";
      const layer = obs.failure_layer?.layer ?? "—";
      lines.push(`| ${obs.repo} | ${obs.id} | ${missing || "—"} | ${reachable} | ${layer} |`);
    }
  }
  lines.push("");
  if (report.failure_layer_counts) {
    lines.push("## Failure layers");
    lines.push("");
    lines.push("Critical-source case counts grouped by the highest-precedence remediation layer (THO-134). `none` means every critical source was in the displayed top-3.");
    lines.push("");
    lines.push(`| Layer | Cases |`);
    lines.push(`|---|---:|`);
    for (const layer of FAILURE_LAYERS) {
      const n = report.failure_layer_counts[layer] ?? 0;
      if (n === 0 && layer !== "none") continue;
      lines.push(`| ${layer} | ${n} |`);
    }
    lines.push("");
  }
  if (report.oracle_failure_report) {
    lines.push("## Oracle failure decomposition");
    lines.push("");
    lines.push("Per-case first actionable layer for top-1 misses. This separates recall, query-mode, source-selection, display, and answer-only misses without changing production retrieval.");
    lines.push("");
    const o = report.oracle_failure_report;
    const denom = o.reachability.answerable_cases;
    const fmtReach = (n: number) => `${n}/${denom}`;
    lines.push(`| Reachability | Cases |`);
    lines.push(`|---|---:|`);
    lines.push(`| expected source in candidate top-5 | ${fmtReach(o.reachability.expected_at_5)} |`);
    lines.push(`| expected source in candidate top-10 | ${fmtReach(o.reachability.expected_at_10)} |`);
    lines.push(`| expected source in candidate top-20 | ${fmtReach(o.reachability.expected_at_20)} |`);
    lines.push(`| expected source in candidate top-50 | ${fmtReach(o.reachability.expected_at_50)} |`);
    lines.push(`| all critical sources in top-50 | ${fmtReach(o.reachability.all_critical_at_50)} |`);
    lines.push("");
    lines.push(`| Layer | Cases |`);
    lines.push(`|---|---:|`);
    for (const layer of ORACLE_DIAGNOSTIC_LAYERS) {
      const n = o.counts[layer] ?? 0;
      if (n === 0 && layer !== "top1_pass") continue;
      lines.push(`| ${layer} | ${n} |`);
    }
    const misses = o.top1_misses.slice(0, 20);
    if (misses.length > 0) {
      lines.push("");
      lines.push(`| Case | Layer | expected rank | selection rank | applied | agent answer |`);
      lines.push(`|---|---|---:|---:|---|---|`);
      for (const miss of misses) {
        lines.push(
          `| ${miss.repo}/${miss.id} | ${miss.layer} | ${miss.expected_source_rank ?? "—"} | ${miss.source_selection_owner_rank ?? "—"} | ${miss.source_selection_applied ?? "—"} | ${miss.agent_answer_pass ?? "—"} |`,
        );
      }
    }
    lines.push("");
  }
  if (report.source_owner_pairwise && report.source_owner_pairwise.total > 0) {
    lines.push("## Source-owner pairwise probes");
    lines.push("");
    const p = report.source_owner_pairwise;
    lines.push(`Diagnostic owner-vs-competitor probes: ${p.passed}/${p.total} passing.`);
    lines.push("");
    lines.push(`| First loss stage | Cases |`);
    lines.push(`|---|---:|`);
    for (const stage of PAIRWISE_LOSS_STAGES) {
      const n = p.stage_counts[stage] ?? 0;
      if (n === 0 && stage !== "none") continue;
      lines.push(`| ${stage} | ${n} |`);
    }
    lines.push("");
    lines.push(`| Probe | Stage | owner ranks c/card/sel/display | competitor ranks c/card/sel/display |`);
    lines.push(`|---|---|---|---|`);
    for (const result of p.results) {
      const r = result.ranks;
      const ownerRanks = [
        r.candidate_owner,
        r.source_card_owner,
        r.source_selection_owner,
        r.displayed_owner,
      ].map((rank) => rank ?? "—").join("/");
      const competitorRanks = [
        r.candidate_competitor,
        r.source_card_competitor,
        r.source_selection_competitor,
        r.displayed_competitor,
      ].map((rank) => rank ?? "—").join("/");
      lines.push(
        `| ${result.repo}/${result.case_id} | ${result.first_loss_stage} | ${ownerRanks} | ${competitorRanks} |`,
      );
    }
    lines.push("");
  }
  lines.push("## Unsupported separability");
  lines.push("");
  lines.push(`- classification: \`${m.separability.classification}\``);
  lines.push(`- reason: ${m.separability.classification_reason}`);
  lines.push(`- supported avg top-1 score: ${m.separability.supported.avg_top1_score.toFixed(3)}`);
  lines.push(`- unsupported avg top-1 score: ${m.separability.unsupported.avg_top1_score.toFixed(3)}`);
  lines.push(`- false-confident unsupported: ${m.false_confident_unsupported}`);
  lines.push("");
  lines.push("Slice 0 features marked unavailable (intentionally not zero-filled): retriever_agreement, source_alias_hit_count, dense_sparse_agreement, generated_question_agreement, source_purpose_compatibility.");
  lines.push("");
  lines.push("## Confidence diagnostics");
  lines.push("");
  const unsupportedCases = report.observations.filter(
    (o) => o.expectation_kind === "signal_empty",
  );
  if (unsupportedCases.length === 0) {
    lines.push("_(no unsupported cases on this panel)_");
  } else {
    lines.push("Per-case confidence classifications for unsupported cases. False-confident rows (`coverage=confident` on an unsupported case) are PRD-0011 release blockers.");
    lines.push("");
    lines.push(`| Case | Coverage | Reason | Top-1 | t1-t2 | t1-t3 | Mode | Warnings |`);
    lines.push(`|---|---|---|---:|---:|---:|---|---|`);
    for (const obs of unsupportedCases) {
      const a = obs.separability.available;
      const flag = a.coverage_confidence === "confident" ? "**" : "";
      const warnings = a.warning_kinds.length > 0 ? a.warning_kinds.join(",") : "—";
      lines.push(
        `| ${flag}${obs.id}${flag} | ${a.coverage_confidence} | ${a.confidence_reason} | ${a.top1_score.toFixed(3)} | ${a.top1_top2_margin.toFixed(3)} | ${a.top1_top3_margin.toFixed(3)} | ${a.query_mode} | ${warnings} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Synthetic regression");
  lines.push("");
  if (m.synthetic_regression) {
    lines.push(`- **STATUS:** REGRESSED. Failed gates: ${report.synthetic_failed_gates.join(", ") || "(unknown)"}`);
    lines.push("- Slice 0 must not interpret real-corpus movement until the synthetic fixture is restored.");
  } else {
    lines.push("- **STATUS:** passed (no positive ship power; pass means the floor is intact).");
  }
  lines.push("");

  if (report.splits && report.holdout_gates) {
    lines.push("## Dev vs holdout (PRD-0012 Slice 2 v2)");
    lines.push("");
    lines.push(`Dev (tuned): ${report.splits.dev.repos.join(", ") || "(none)"}`);
    lines.push(`Holdout (untouched): ${report.splits.holdout.repos.join(", ") || "(none)"}`);
    lines.push("");
    lines.push(`| Metric | Dev | Holdout |`);
    lines.push(`|---|---:|---:|`);
    const dev = report.splits.dev;
    const ho = report.splits.holdout;
    lines.push(`| cases | ${dev.cases} | ${ho.cases} |`);
    lines.push(`| answerable cases | ${dev.answerable_cases} | ${ho.answerable_cases} |`);
    lines.push(`| unsupported cases | ${dev.unsupported_cases} | ${ho.unsupported_cases} |`);
    lines.push(`| candidate recall@50 | ${pct(dev.candidate_recall_at_50_rate)} | ${pct(ho.candidate_recall_at_50_rate)} |`);
    lines.push(`| source-rerank top-1 | ${pct(dev.source_rerank_top1_rate)} | ${pct(ho.source_rerank_top1_rate)} |`);
    lines.push(`| source-rerank top-3 | ${pct(dev.source_rerank_top3_rate)} | ${pct(ho.source_rerank_top3_rate)} |`);
    lines.push(`| wire top-1 | ${pct(dev.wire_top1_rate)} | ${pct(ho.wire_top1_rate)} |`);
    lines.push(`| wire top-3 | ${pct(dev.wire_top3_rate)} | ${pct(ho.wire_top3_rate)} |`);
    lines.push(`| unsupported honesty | ${pct(dev.unsupported_honesty_rate)} | ${pct(ho.unsupported_honesty_rate)} |`);
    lines.push(`| false-confident unsupported | ${dev.false_confident_unsupported} | ${ho.false_confident_unsupported} |`);
    lines.push("");

    lines.push("### Per-intent (holdout)");
    lines.push("");
    lines.push(`| Intent | Cases | Critical recall@50 | Top-1 | Top-3 |`);
    lines.push(`|---|---:|---:|---:|---:|`);
    for (const [intent, g] of Object.entries(ho.per_intent).sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(
        `| ${intent} | ${g.cases} | ${pct(g.critical_source_set_recall_at_50_rate)} | ${pct(g.actual_top1_acceptable_rate)} | ${pct(g.actual_top3_acceptable_rate)} |`,
      );
    }
    lines.push("");

    lines.push("## Holdout gates (PRD-0012 — the verdict)");
    lines.push("");
    if (report.holdout_gates.passed) {
      lines.push("- **STATUS:** PASSED");
    } else {
      lines.push("- **STATUS:** FAILED");
      for (const f of report.holdout_gates.failures) {
        lines.push(`  - \`${f.gate}\` — ${f.message}`);
      }
    }
    lines.push("");
  }

  if (report.source_selection_metrics) {
    lines.push("## Source-selection (PRD-0014 V3.1)");
    lines.push("");
    const m = report.source_selection_metrics;
    const ho = report.holdout_source_selection_metrics;
    lines.push(`| Metric | Combined | Holdout |`);
    lines.push(`|---|---:|---:|`);
    lines.push(
      `| must_include_top3 rate | ${pct(m.must_include_top3_rate)} | ${pct(ho?.must_include_top3_rate ?? 0)} |`,
    );
    lines.push(
      `| must_include_top3 eligible | ${m.must_include_top3_eligible} | ${ho?.must_include_top3_eligible ?? 0} |`,
    );
    lines.push(
      `| display losses | ${m.display_loss_count} | ${ho?.display_loss_count ?? 0} |`,
    );
    lines.push("");
    lines.push(`### Display losses by category (combined)`);
    lines.push("");
    lines.push(`| Category | Cases |`);
    lines.push(`|---|---:|`);
    for (const cat of SOURCE_SELECTION_LOSS_CATEGORIES) {
      const n = m.loss_category_counts[cat] ?? 0;
      if (n === 0 && cat !== "none") continue;
      lines.push(`| ${cat} | ${n} |`);
    }
    lines.push("");
    if (report.v3_holdout_gates) {
      lines.push(`### V3 holdout gates`);
      lines.push("");
      if (report.v3_holdout_gates.passed) {
        lines.push("- **STATUS:** PASSED");
      } else {
        lines.push("- **STATUS:** FAILED");
        for (const f of report.v3_holdout_gates.failures) {
          lines.push(`  - \`${f.gate}\` — ${f.message}`);
        }
      }
      lines.push("");
    }
    if (report.v3_release_gates) {
      lines.push(`### V3 release gates (PRD-0014 / THO-149)`);
      lines.push("");
      lines.push(
        `Floors: combined wire top-1 ≥ ${(V3_RELEASE_FLOORS.combined_wire_top1 * 100).toFixed(1)}%, top-3 ≥ ${(V3_RELEASE_FLOORS.combined_wire_top3 * 100).toFixed(1)}%; display losses ≤ ${V3_RELEASE_FLOORS.combined_display_losses}; must_include missing reduced ≥ ${(V3_RELEASE_FLOORS.must_include_missing_reduction * 100).toFixed(0)}%.`,
      );
      lines.push("");
      if (report.v3_release_gates.passed) {
        lines.push("- **STATUS:** PASSED");
      } else {
        lines.push("- **STATUS:** FAILED (measurement only — not a ship blocker until V3 lands)");
        for (const f of report.v3_release_gates.failures) {
          lines.push(`  - \`${f.gate}\` — ${f.message}`);
        }
      }
      lines.push("");
    }
  }

  if (report.ceiling_decision) {
    lines.push("## V2.5 ceiling decision (THO-141)");
    lines.push("");
    const cd = report.ceiling_decision;
    if (cd.gates_passed) {
      lines.push(`- **STATUS:** PASSED — \`${cd.bottleneck}\``);
    } else {
      lines.push(`- **STATUS:** FAILED — bottleneck: \`${cd.bottleneck}\``);
    }
    lines.push(`- **Rationale:** ${cd.rationale}`);
    if (cd.failed_gates.length > 0) {
      lines.push(`- **Failed gates:** ${cd.failed_gates.join(", ")}`);
    }
    lines.push("");
  }

  if (report.ablations) {
    lines.push("## Ablations (THO-140)");
    lines.push("");
    lines.push("Per-mode source-rerank metrics across dev / holdout / combined. Modes flagged `not_runnable` are typed but require a production toggle to populate.");
    lines.push("");
    lines.push(`| Mode | Combined top-1 | Combined top-3 | Dev top-1 | Holdout top-1 | Status |`);
    lines.push(`|---|---:|---:|---:|---:|---|`);
    for (const m of report.ablations.modes) {
      const status = m.runnable ? "runnable" : "not_runnable";
      const fmt = (n: number | undefined) =>
        n === undefined ? "—" : pct(n);
      lines.push(
        `| ${m.mode} | ${fmt(m.metrics?.top1_rate)} | ${fmt(m.metrics?.top3_rate)} | ${fmt(m.dev?.top1_rate)} | ${fmt(m.holdout?.top1_rate)} | ${status} |`,
      );
    }
    lines.push("");
  }

  if (report.slice2_gates) {
    lines.push("## Slice 2 gates — combined panel (context)");
    lines.push("");
    if (report.slice2_gates.passed) {
      lines.push("- **STATUS:** PASSED");
    } else {
      lines.push("- **STATUS:** FAILED");
      for (const f of report.slice2_gates.failures) {
        lines.push(`  - \`${f.gate}\` — ${f.message}`);
      }
    }
    lines.push("");

    const movements = report.observations
      .filter((o) => o.source_rerank && o.source_rerank.length > 0)
      .slice(0, 20);
    if (movements.length > 0) {
      lines.push("## Source-rerank movement (top 20 cases)");
      lines.push("");
      lines.push(`| Case | Source | pre rank | post rank | fused rank (paths) | post score | reasons |`);
      lines.push(`|---|---|---:|---:|---|---:|---|`);
      for (const obs of movements) {
        const top = obs.source_rerank![0]!;
        const reasons: string[] = [];
        if (top.feature_reasons.purpose_compat_bonus > 0)
          reasons.push(`+purpose=${top.feature_reasons.purpose_compat_bonus.toFixed(2)}`);
        if (top.feature_reasons.distractor_penalty < 0)
          reasons.push(`distractor=${top.feature_reasons.distractor_penalty.toFixed(2)}`);
        if (top.feature_reasons.alias_hit_count > 0)
          reasons.push(`alias=${top.feature_reasons.alias_hit_count}`);
        const fused =
          top.fused_rank !== undefined
            ? `${top.fused_rank} (${top.fused_path_count ?? 0})`
            : "—";
        lines.push(
          `| ${obs.id} | ${top.source_path} | ${top.pre_rerank_rank} | ${top.post_rerank_rank} | ${fused} | ${top.post_rerank_score.toFixed(3)} | ${reasons.join(",") || "—"} |`,
        );
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function serializeSlice0Report(report: Slice0Report): string {
  return JSON.stringify(report, null, 2) + "\n";
}
