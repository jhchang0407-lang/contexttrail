import { CONFIDENT_FINAL_SCORE_FLOOR } from "./confidence-policy.js";
import type { AboutnessObservation } from "./aboutness.js";
import type { QueryCompilation, QueryMode } from "./query-scope.js";
import type { SourceSelectionDecision } from "./source-selection-decision.js";

export type QueryModeHonestyReason =
  | "preserve_initial_mode"
  | "anchors_supported_by_retrieval";

export type QueryModeHonestyInput = {
  initial_query_mode: QueryMode;
  query_compilation: QueryCompilation;
  included_scores: number[];
  source_selection?: SourceSelectionDecision;
  source_aboutness?: AboutnessObservation[];
};

export type QueryModeHonestyDecision = {
  query_mode: QueryMode;
  reason: QueryModeHonestyReason;
};

export function decideQueryModeHonesty(
  input: QueryModeHonestyInput,
): QueryModeHonestyDecision {
  if (input.query_compilation.provided_anchor_count === 0) {
    return {
      query_mode: input.initial_query_mode,
      reason: "preserve_initial_mode",
    };
  }

  if (input.initial_query_mode === "anchored") {
    return {
      query_mode: input.initial_query_mode,
      reason: "preserve_initial_mode",
    };
  }

  if (input.query_compilation.recognized_anchor_count === 0) {
    return {
      query_mode: input.initial_query_mode,
      reason: "preserve_initial_mode",
    };
  }

  const strongestIncludedScore = Math.max(0, ...input.included_scores);
  const hasUsefulSelection =
    input.source_selection !== undefined &&
    !input.source_selection.fail_closed &&
    input.source_selection.selected_sources.length > 0;
  const hasUsefulAboutness =
    input.source_aboutness?.some((entry) => entry.label !== "unsupported") ??
    false;

  if (
    strongestIncludedScore >= CONFIDENT_FINAL_SCORE_FLOOR &&
    (hasUsefulSelection || hasUsefulAboutness)
  ) {
    return {
      query_mode: "anchored",
      reason: "anchors_supported_by_retrieval",
    };
  }

  return {
    query_mode: input.initial_query_mode,
    reason: "preserve_initial_mode",
  };
}
