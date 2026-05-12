/**
 * Slice 0 (PRD-0010 / THO-117) — branch decision logic.
 *
 * Pure function. Maps aggregated Slice 0 metrics to one primary branch from
 * the PRD-0010 precedence table:
 *
 *   1. stop_fix_regression
 *   2. candidate_generation_or_indexing
 *   3. confidence_or_abstention
 *   4. source_ranking_or_aboutness
 *   5. ready_for_source_first_v2_prd
 */
import type { Slice0SeparabilityClassification } from "./separability.js";

export const SLICE0_BRANCHES = [
  "stop_fix_regression",
  "candidate_generation_or_indexing",
  "confidence_or_abstention",
  "source_ranking_or_aboutness",
  "ready_for_source_first_v2_prd",
] as const;

export type Slice0Branch = (typeof SLICE0_BRANCHES)[number];

export type Slice0RecommendedPrd =
  | "Candidate Generation / Indexing Rework"
  | "SourceProfile + Source Rerank"
  | "Confidence / Abstention Rework"
  | "Fix Slice 0 Regression"
  | "Full Source-First V2 Implementation";

export type BranchInput = {
  /** True when the synthetic 126-case fixture failed to pass all gates. */
  synthetic_regression: boolean;
  /** Number of answerable cases (denominator for recall claims). */
  answerable_cases: number;
  /** Critical-source-set recall@50 rate across answerable cases. 0..1 */
  critical_source_set_recall_at_50_rate: number;
  /** Share of answerable cases where the actual top-1 source is acceptable. 0..1 */
  actual_top_source_top1_acceptable_rate: number;
  /** Share of answerable cases where an acceptable source is in the top-3. 0..1 */
  actual_top_source_top3_acceptable_rate: number;
  /** Result of the unsupported separability audit. */
  separability_classification: Slice0SeparabilityClassification;
  /** Number of unsupported cases that reported `confident`. Any > 0 is a release blocker. */
  false_confident_unsupported: number;
};

export type BranchDecision = {
  primary_branch: Slice0Branch;
  recommended_next_prd: Slice0RecommendedPrd;
  rationale: string;
};

const RECALL_FLOOR = 0.95;
const RANKING_TOP1_FLOOR = 0.85;
const RANKING_TOP3_FLOOR = 0.95;
/** PRD-0011 / THO-124: false-confident unsupported cases are release blockers. */
export const FALSE_CONFIDENT_TOLERANCE = 0;

export function decideBranch(input: BranchInput): BranchDecision {
  if (input.synthetic_regression) {
    return {
      primary_branch: "stop_fix_regression",
      recommended_next_prd: "Fix Slice 0 Regression",
      rationale:
        "synthetic 126-case fixture regressed; fix instrumentation or accidental behavior change before interpreting real-corpus movement",
    };
  }

  // Recall floor only applies when there are answerable cases to measure
  // against. Panels that are entirely unsupported (or empty) skip directly
  // to the confidence/abstention check below.
  if (
    input.answerable_cases > 0 &&
    input.critical_source_set_recall_at_50_rate < RECALL_FLOOR
  ) {
    return {
      primary_branch: "candidate_generation_or_indexing",
      recommended_next_prd: "Candidate Generation / Indexing Rework",
      rationale: `critical-source-set recall@50 = ${(input.critical_source_set_recall_at_50_rate * 100).toFixed(1)}% < 95% floor; reranking cannot recover sources missing pre-rank`,
    };
  }

  // Confidence/abstention precedence: any false-confident unsupported case
  // exceeds the deterministic Slice 1 tolerance (THO-124). A `weak` separability
  // classification on its own is no longer enough — under the post-Slice 1
  // honest policy, supported cases legitimately drop into `uncertain` when
  // the corpus is genuinely ambiguous, and we don't want that to mask the
  // next-bottleneck signal (ranking).
  if (input.false_confident_unsupported > FALSE_CONFIDENT_TOLERANCE) {
    return {
      primary_branch: "confidence_or_abstention",
      recommended_next_prd: "Confidence / Abstention Rework",
      rationale: `${input.false_confident_unsupported} unsupported case(s) reported \`confident\` (> tolerance ${FALSE_CONFIDENT_TOLERANCE}); honest abstention is still the first bottleneck`,
    };
  }

  const top1Strong = input.actual_top_source_top1_acceptable_rate >= RANKING_TOP1_FLOOR;
  const top3Strong = input.actual_top_source_top3_acceptable_rate >= RANKING_TOP3_FLOOR;
  if (!top1Strong || !top3Strong) {
    return {
      primary_branch: "source_ranking_or_aboutness",
      recommended_next_prd: "SourceProfile + Source Rerank",
      rationale: `recall@50 = ${(input.critical_source_set_recall_at_50_rate * 100).toFixed(1)}% (>=95%) but top-1 = ${(input.actual_top_source_top1_acceptable_rate * 100).toFixed(1)}%, top-3 = ${(input.actual_top_source_top3_acceptable_rate * 100).toFixed(1)}%; ranking/aboutness is the bottleneck`,
    };
  }

  return {
    primary_branch: "ready_for_source_first_v2_prd",
    recommended_next_prd: "Full Source-First V2 Implementation",
    rationale: `recall@50 = ${(input.critical_source_set_recall_at_50_rate * 100).toFixed(1)}%, top-1 = ${(input.actual_top_source_top1_acceptable_rate * 100).toFixed(1)}%, top-3 = ${(input.actual_top_source_top3_acceptable_rate * 100).toFixed(1)}%, separability classified \`${input.separability_classification}\`; proceed to source-first V2`,
  };
}
