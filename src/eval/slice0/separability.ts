/**
 * Slice 0 (PRD-0010 / THO-115) — unsupported separability audit.
 *
 * Compares supported and unsupported (or signal_empty) cases using only the
 * deterministic features that exist today. V2-only features (multi-retriever
 * agreement, source-purpose compatibility, dense/sparse agreement, etc.) are
 * explicitly labeled `unavailable_in_slice_0` rather than being zero-filled,
 * so the branch decision cannot accidentally rely on them.
 */
import type { Slice0ChunkCandidate } from "./candidates.js";
import {
  decideCoverageConfidence,
  type CoverageConfidenceReason,
} from "../../retrieve/confidence-policy.js";
import type { CoverageDecision } from "../../retrieve/coverage-verifier.js";

export type CoverageConfidenceState = "confident" | "uncertain" | "empty";
export type Slice0QueryMode = "anchored" | "signal_empty" | "unanchored";

export const SLICE0_UNAVAILABLE_FEATURES = [
  "retriever_agreement",
  "source_alias_hit_count",
  "dense_sparse_agreement",
  "generated_question_agreement",
  "source_purpose_compatibility",
] as const;

export type Slice0UnavailableFeature = (typeof SLICE0_UNAVAILABLE_FEATURES)[number];

export type Slice0SeparabilityFeatures = {
  available: {
    coverage_confidence: CoverageConfidenceState;
    /** PRD-0011 / THO-123: which rule produced the confidence classification. */
    confidence_reason: CoverageConfidenceReason;
    query_mode: Slice0QueryMode;
    warning_kinds: string[];
    ranked_count: number;
    top1_score: number;
    top1_top2_margin: number;
    top1_top3_margin: number;
    /** Per-candidate score features for the top-1; null when no candidates. */
    top1_features: {
      bm25_norm: number;
      heading_match: number;
      scope_match: number;
      mention_overlap: number;
      final_score: number;
    } | null;
  };
  unavailable: Record<Slice0UnavailableFeature, "unavailable_in_slice_0">;
};

export type SeparabilityInput = {
  candidates: Slice0ChunkCandidate[];
  coverage_confidence: CoverageConfidenceState;
  query_mode: Slice0QueryMode;
  warning_kinds: string[];
  ranked_count: number;
  /** Optional inputs that mirror the policy surface for replaying the
   *  classification reason in the eval. Defaults preserve historical behavior
   *  for tests that don't set them. */
  has_locked?: boolean;
  safety_net_engaged?: boolean;
  /** THO-139 / PRD-0013 V2.5.6: top-source coverage decision so the
   *  recomputed reason matches the production presenter's behavior. */
  top_coverage_decision?: CoverageDecision;
};

export function computeSeparabilityFeatures(
  input: SeparabilityInput,
): Slice0SeparabilityFeatures {
  const top1 = input.candidates[0]?.final_score ?? 0;
  const top2 = input.candidates[1]?.final_score ?? 0;
  const top3 = input.candidates[2]?.final_score ?? 0;
  const top1Cand = input.candidates[0] ?? null;

  const unavailable: Record<Slice0UnavailableFeature, "unavailable_in_slice_0"> = {
    retriever_agreement: "unavailable_in_slice_0",
    source_alias_hit_count: "unavailable_in_slice_0",
    dense_sparse_agreement: "unavailable_in_slice_0",
    generated_question_agreement: "unavailable_in_slice_0",
    source_purpose_compatibility: "unavailable_in_slice_0",
  };

  // Replay the same shared policy that drives the wire `coverage_confidence`
  // so the eval surface and presenter cannot drift on `reason`.
  const decision = decideCoverageConfidence({
    query_mode: input.query_mode,
    has_locked: input.has_locked ?? false,
    ranked_scores: input.candidates.map((c) => c.final_score),
    warning_kinds: input.warning_kinds,
    safety_net_engaged: input.safety_net_engaged ?? false,
    top_coverage_decision: input.top_coverage_decision,
  });

  return {
    available: {
      coverage_confidence: input.coverage_confidence,
      confidence_reason: decision.reason,
      query_mode: input.query_mode,
      warning_kinds: [...input.warning_kinds],
      ranked_count: input.ranked_count,
      top1_score: top1,
      top1_top2_margin: top1 - top2,
      top1_top3_margin: top1 - top3,
      top1_features: top1Cand
        ? {
            bm25_norm: top1Cand.bm25_norm,
            heading_match: top1Cand.heading_match,
            scope_match: top1Cand.scope_match,
            mention_overlap: top1Cand.mention_overlap,
            final_score: top1Cand.final_score,
          }
        : null,
    },
    unavailable,
  };
}

export type Slice0SeparabilityGroupSummary = {
  cases: number;
  avg_top1_score: number;
  avg_top1_top2_margin: number;
  avg_top1_top3_margin: number;
  coverage_confidence: Record<CoverageConfidenceState, number>;
  query_mode: Record<Slice0QueryMode, number>;
  warning_kind_counts: Record<string, number>;
};

export type Slice0SeparabilityClassification =
  | "sufficient"
  | "weak"
  | "inconclusive";

export type Slice0SeparabilitySummary = {
  supported: Slice0SeparabilityGroupSummary;
  unsupported: Slice0SeparabilityGroupSummary;
  /** Unsupported cases that report `confident` — these are release blockers. */
  false_confident_unsupported: number;
  classification: Slice0SeparabilityClassification;
  /** Reason behind the classification (human-readable, mechanical). */
  classification_reason: string;
};

export type SeparabilitySummaryInput = {
  supported: Slice0SeparabilityFeatures[];
  unsupported: Slice0SeparabilityFeatures[];
};

function summarizeGroup(
  features: Slice0SeparabilityFeatures[],
): Slice0SeparabilityGroupSummary {
  const summary: Slice0SeparabilityGroupSummary = {
    cases: features.length,
    avg_top1_score: 0,
    avg_top1_top2_margin: 0,
    avg_top1_top3_margin: 0,
    coverage_confidence: { confident: 0, uncertain: 0, empty: 0 },
    query_mode: { anchored: 0, signal_empty: 0, unanchored: 0 },
    warning_kind_counts: {},
  };
  if (features.length === 0) return summary;
  let scoreSum = 0;
  let m12Sum = 0;
  let m13Sum = 0;
  for (const f of features) {
    scoreSum += f.available.top1_score;
    m12Sum += f.available.top1_top2_margin;
    m13Sum += f.available.top1_top3_margin;
    summary.coverage_confidence[f.available.coverage_confidence] += 1;
    summary.query_mode[f.available.query_mode] += 1;
    for (const wk of f.available.warning_kinds) {
      summary.warning_kind_counts[wk] = (summary.warning_kind_counts[wk] ?? 0) + 1;
    }
  }
  summary.avg_top1_score = scoreSum / features.length;
  summary.avg_top1_top2_margin = m12Sum / features.length;
  summary.avg_top1_top3_margin = m13Sum / features.length;
  return summary;
}

export function summarizeSeparability(
  input: SeparabilitySummaryInput,
): Slice0SeparabilitySummary {
  const supported = summarizeGroup(input.supported);
  const unsupported = summarizeGroup(input.unsupported);
  const false_confident_unsupported = input.unsupported.filter(
    (f) => f.available.coverage_confidence === "confident",
  ).length;

  let classification: Slice0SeparabilityClassification = "inconclusive";
  let reason = "no supported or unsupported cases";

  if (supported.cases > 0 && unsupported.cases > 0) {
    const scoreGap = supported.avg_top1_score - unsupported.avg_top1_score;
    const supportedConfidentRate =
      supported.coverage_confidence.confident / supported.cases;
    const unsupportedHonestRate =
      (unsupported.coverage_confidence.empty +
        unsupported.coverage_confidence.uncertain) /
      unsupported.cases;
    if (
      scoreGap >= 0.2 &&
      supportedConfidentRate >= 0.6 &&
      unsupportedHonestRate >= 0.6 &&
      false_confident_unsupported === 0
    ) {
      classification = "sufficient";
      reason = `score_gap=${scoreGap.toFixed(2)}, supported_confident=${(supportedConfidentRate * 100).toFixed(0)}%, unsupported_honest=${(unsupportedHonestRate * 100).toFixed(0)}%`;
    } else if (false_confident_unsupported > 0 || scoreGap < 0.05) {
      classification = "weak";
      reason = `score_gap=${scoreGap.toFixed(2)}, false_confident_unsupported=${false_confident_unsupported}`;
    } else {
      classification = "weak";
      reason = `score_gap=${scoreGap.toFixed(2)}, supported_confident=${(supportedConfidentRate * 100).toFixed(0)}%, unsupported_honest=${(unsupportedHonestRate * 100).toFixed(0)}%`;
    }
  } else if (supported.cases === 0 && unsupported.cases === 0) {
    classification = "inconclusive";
    reason = "no supported or unsupported cases";
  } else {
    classification = "inconclusive";
    reason = supported.cases === 0
      ? "no supported cases to compare against"
      : "no unsupported cases to compare against";
  }

  return {
    supported,
    unsupported,
    false_confident_unsupported,
    classification,
    classification_reason: reason,
  };
}
