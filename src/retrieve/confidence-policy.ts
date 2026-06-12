/**
 * Shared coverage-confidence policy.
 *
 * Deterministic mapping from already-available retrieval evidence to
 * `coverage_confidence ∈ {confident, uncertain, empty}`. The presenter and
 * any future eval consumer call this single function so the wire contract
 * and the eval surface cannot drift.
 *
 * This module centralises the previously scattered thresholds; the
 * warning-alignment and margin/mode rules are layered on top of this same
 * decision shape without changing the public types.
 */
import type { QueryMode } from "./query-scope.js";
import type { CoverageDecision } from "./coverage-verifier.js";

export type CoverageConfidenceState = "confident" | "uncertain" | "empty";

export type CoverageConfidenceInput = {
  query_mode: QueryMode;
  has_locked: boolean;
  /** Displayed ranked scores in display order (top-1 first). */
  ranked_scores: number[];
  /** Warning kinds emitted by the presentation layer. */
  warning_kinds: readonly string[];
  safety_net_engaged: boolean;
  /**
   * V2.5.6: coverage decision for the top source.
   * `partial`, `unsupported`, and `needs_anchors` cap confidence at uncertain.
   * Locked accepted Cards still preserve `confident`.
   */
  top_coverage_decision?: CoverageDecision;
};

export type CoverageConfidenceReason =
  | "locked_entries_present"
  | "ranked_empty"
  | "safety_net_engaged"
  | "low_confidence_warning"
  | "signal_empty_query_mode"
  | "narrow_top_score_margin"
  | "unanchored_score_below_confident_floor"
  | "score_above_confident_floor"
  | "score_below_empty_floor"
  | "score_in_uncertain_band"
  | "coverage_unsupported"
  | "coverage_partial"
  | "coverage_needs_anchors";

export type CoverageConfidenceDecision = {
  coverage_confidence: CoverageConfidenceState;
  reason: CoverageConfidenceReason;
  /** Top-1 displayed score if any, else 0. Surfaced for diagnostics. */
  top1_score: number;
  /** top1 - top2 margin if both exist, else 0. */
  top1_top2_margin: number;
  /** top1 - top3 margin if both exist, else 0. */
  top1_top3_margin: number;
};

/** Long-standing thresholds, preserved as-is to keep behavior stable.
 *  Margin/mode rules layer additional caps without changing these. */
export const CONFIDENT_FINAL_SCORE_FLOOR = 0.5;
export const UNCERTAIN_FINAL_SCORE_FLOOR = 0.05;
/** Unanchored ranked-only retrieval needs a stronger absolute signal than
 *  anchored retrieval before we call the corpus coverage confident. */
export const UNANCHORED_CONFIDENT_FINAL_SCORE_FLOOR = 0.95;
/** Margin floors. A non-anchored ranked result with a near-tie at the
 *  top is suspicious even when the absolute score is numerically high — every
 *  observed false-confident case had a top1/top2 margin under 0.07. */
export const CONFIDENT_TOP1_TOP2_MARGIN_FLOOR = 0.12;
export const CONFIDENT_TOP1_TOP3_MARGIN_FLOOR = 0.15;

export function decideCoverageConfidence(
  input: CoverageConfidenceInput,
): CoverageConfidenceDecision {
  // Sort descending so margins reflect the best-vs-second-best gap regardless
  // of display ordering (diversification can put a lower-scored chunk at
  // displayed position 0 — that's a presentation concern, not a confidence
  // signal). Score floor checks also use max(score), since coverage_confidence
  // asks "does the corpus have a strong answer", not "did display put the
  // strongest chunk first".
  const sorted = [...input.ranked_scores].sort((a, b) => b - a);
  const top1 = sorted[0] ?? 0;
  const top2 = sorted[1] ?? 0;
  const top3 = sorted[2] ?? 0;
  const top1_top2_margin = sorted.length >= 2 ? top1 - top2 : 0;
  const top1_top3_margin = sorted.length >= 3 ? top1 - top3 : 0;

  if (input.has_locked) {
    return {
      coverage_confidence: "confident",
      reason: "locked_entries_present",
      top1_score: top1,
      top1_top2_margin,
      top1_top3_margin,
    };
  }
  if (input.ranked_scores.length === 0 || input.safety_net_engaged) {
    return {
      coverage_confidence: "empty",
      reason: input.safety_net_engaged ? "safety_net_engaged" : "ranked_empty",
      top1_score: top1,
      top1_top2_margin,
      top1_top3_margin,
    };
  }
  // Fail closed on verified coverage. Coverage decisions of
  // unsupported / partial / needs_anchors cap confidence at uncertain
  // regardless of how strong the lexical score is. The known
  // false-confident unsupported holdout cases all hit this branch.
  if (input.top_coverage_decision === "unsupported") {
    return {
      coverage_confidence: "uncertain",
      reason: "coverage_unsupported",
      top1_score: top1,
      top1_top2_margin,
      top1_top3_margin,
    };
  }
  if (input.top_coverage_decision === "partial") {
    return {
      coverage_confidence: "uncertain",
      reason: "coverage_partial",
      top1_score: top1,
      top1_top2_margin,
      top1_top3_margin,
    };
  }
  if (input.top_coverage_decision === "needs_anchors") {
    return {
      coverage_confidence: "uncertain",
      reason: "coverage_needs_anchors",
      top1_score: top1,
      top1_top2_margin,
      top1_top3_margin,
    };
  }
  if (input.query_mode === "signal_empty") {
    if (top1 < UNCERTAIN_FINAL_SCORE_FLOOR) {
      return {
        coverage_confidence: "empty",
        reason: "score_below_empty_floor",
        top1_score: top1,
        top1_top2_margin,
        top1_top3_margin,
      };
    }
    return {
      coverage_confidence: "uncertain",
      reason: "signal_empty_query_mode",
      top1_score: top1,
      top1_top2_margin,
      top1_top3_margin,
    };
  }
  if (
    input.query_mode !== "anchored" &&
    ((input.ranked_scores.length >= 2 && top1_top2_margin < CONFIDENT_TOP1_TOP2_MARGIN_FLOOR) ||
      (input.ranked_scores.length >= 3 && top1_top3_margin < CONFIDENT_TOP1_TOP3_MARGIN_FLOOR))
  ) {
    return {
      coverage_confidence: "uncertain",
      reason: "narrow_top_score_margin",
      top1_score: top1,
      top1_top2_margin,
      top1_top3_margin,
    };
  }
  if (input.warning_kinds.includes("low_confidence")) {
    if (top1 < UNCERTAIN_FINAL_SCORE_FLOOR) {
      return {
        coverage_confidence: "empty",
        reason: "score_below_empty_floor",
        top1_score: top1,
        top1_top2_margin,
        top1_top3_margin,
      };
    }
    return {
      coverage_confidence: "uncertain",
      reason: "low_confidence_warning",
      top1_score: top1,
      top1_top2_margin,
      top1_top3_margin,
    };
  }
  const confidentScoreFloor =
    input.query_mode === "anchored"
      ? CONFIDENT_FINAL_SCORE_FLOOR
      : UNANCHORED_CONFIDENT_FINAL_SCORE_FLOOR;
  if (top1 >= confidentScoreFloor) {
    return {
      coverage_confidence: "confident",
      reason: "score_above_confident_floor",
      top1_score: top1,
      top1_top2_margin,
      top1_top3_margin,
    };
  }
  if (top1 < UNCERTAIN_FINAL_SCORE_FLOOR) {
    return {
      coverage_confidence: "empty",
      reason: "score_below_empty_floor",
      top1_score: top1,
      top1_top2_margin,
      top1_top3_margin,
    };
  }
  return {
    coverage_confidence: "uncertain",
    reason:
      input.query_mode !== "anchored" && top1 >= CONFIDENT_FINAL_SCORE_FLOOR
        ? "unanchored_score_below_confident_floor"
        : "score_in_uncertain_band",
    top1_score: top1,
    top1_top2_margin,
    top1_top3_margin,
  };
}
