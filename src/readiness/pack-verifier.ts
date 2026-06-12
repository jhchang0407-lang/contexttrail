/**
 * Pack readiness verifier.
 *
 * Consumes the task's named needs, the source-scoped chunk selection,
 * selected sources, must-include coverage, warnings, and coverage
 * confidence; returns a deterministic `PackReadinessResult` with
 * satisfied / missing needs and stable reason codes.
 *
 * Internal-only diagnostic substrate. Not yet promoted to the public
 * `task_readiness` MCP contract — that is a separate decision.
 */
import type { ChunkSelection } from "./chunk-selector.js";
import type { PackReadinessState } from "./eval-readiness.js";
import type { TaskNeed } from "./task-need.js";

export const PACK_READINESS_REASON_CODES = [
  "no_evidence",
  "anchors_unrecognized",
  "coverage_uncertain",
  "must_include_missing",
  "primary_missing",
  "intro_missing",
  "sibling_missing",
  "parent_missing",
  "exact_symbol_missing",
  "cross_module_boundary_missing",
  "all_needs_satisfied",
  // Surfaced when the top-1 vs top-2 source pair is genuinely
  // ambiguous (same family, close score gap). Pack readiness reports
  // the ambiguity instead of pretending a close call is certain.
  "ambiguous_top_family",
] as const;
export type PackReadinessReasonCode = typeof PACK_READINESS_REASON_CODES[number];

export type PackReadinessInputs = {
  needs: TaskNeed[];
  selections: ChunkSelection[];
  selectedSources: string[];
  mustIncludeSources: string[];
  warnings: string[];
  coverage_confidence: "confident" | "uncertain" | "empty";
  lockedCount: number;
  /** Optional ambiguity diagnostic from the top-family planner.
   *  When true, readiness downgrades from ready to partial and
   *  emits an `ambiguous_top_family` reason. */
  topFamilyAmbiguous?: boolean;
};

export type PackReadinessResult = {
  state: PackReadinessState;
  satisfiedNeeds: TaskNeed[];
  missingNeeds: TaskNeed[];
  reasonCodes: PackReadinessReasonCode[];
};

export function verifyPackReadiness(inputs: PackReadinessInputs): PackReadinessResult {
  const reasonCodes: PackReadinessReasonCode[] = [];

  if (inputs.coverage_confidence === "empty") {
    reasonCodes.push("no_evidence");
    return {
      state: "unsupported",
      satisfiedNeeds: [],
      missingNeeds: [...inputs.needs],
      reasonCodes,
    };
  }

  const anchorsUnrecognized = inputs.warnings.includes("anchors_unrecognized");
  if (anchorsUnrecognized) {
    reasonCodes.push("anchors_unrecognized");
  }
  if (inputs.coverage_confidence === "uncertain") {
    reasonCodes.push("coverage_uncertain");
  }
  if (anchorsUnrecognized) {
    return {
      state: "needs_anchors",
      satisfiedNeeds: [],
      missingNeeds: [...inputs.needs],
      reasonCodes,
    };
  }

  const satisfiedNeeds: TaskNeed[] = [];
  const missingNeeds: TaskNeed[] = [];
  for (const need of inputs.needs) {
    if (isNeedSatisfied(need, inputs)) {
      satisfiedNeeds.push(need);
    } else {
      missingNeeds.push(need);
      reasonCodes.push(missingReasonFor(need));
    }
  }

  const missingMustIncludes = inputs.mustIncludeSources.filter(
    (src) => !inputs.selectedSources.includes(src),
  );
  if (missingMustIncludes.length > 0) {
    reasonCodes.push("must_include_missing");
  }

  if (inputs.coverage_confidence === "uncertain") {
    if (inputs.topFamilyAmbiguous) {
      reasonCodes.push("ambiguous_top_family");
    }
    return {
      state: "partial",
      satisfiedNeeds,
      missingNeeds,
      reasonCodes,
    };
  }

  if (missingNeeds.length === 0 && missingMustIncludes.length === 0) {
    if (inputs.topFamilyAmbiguous) {
      // A clean needs/must-include pass is still downgraded to
      // "partial" when the top-1 / top-2 source pair is genuinely
      // ambiguous, so reports cannot pretend an unresolved close call
      // is certain.
      reasonCodes.push("ambiguous_top_family");
      return {
        state: "partial",
        satisfiedNeeds,
        missingNeeds,
        reasonCodes,
      };
    }
    reasonCodes.push("all_needs_satisfied");
    return {
      state: "ready",
      satisfiedNeeds,
      missingNeeds,
      reasonCodes,
    };
  }

  if (inputs.topFamilyAmbiguous) {
    reasonCodes.push("ambiguous_top_family");
  }
  return {
    state: "partial",
    satisfiedNeeds,
    missingNeeds,
    reasonCodes,
  };
}

function isNeedSatisfied(need: TaskNeed, inputs: PackReadinessInputs): boolean {
  const reasons = inputs.selections.map((s) => s.reason);
  switch (need) {
    case "exact_symbol_behavior":
      return reasons.includes("primary") || reasons.includes("exact_heading");
    case "overview_orientation":
      return reasons.includes("intro");
    case "setup_install":
      return reasons.includes("sibling");
    case "decision_rationale":
      return reasons.includes("parent");
    case "cross_module_boundary":
      return new Set(inputs.selectedSources).size >= 2;
    case "sibling_support":
      return reasons.includes("sibling") || new Set(inputs.selectedSources).size >= 2;
  }
}

function missingReasonFor(need: TaskNeed): PackReadinessReasonCode {
  switch (need) {
    case "exact_symbol_behavior":
      return "exact_symbol_missing";
    case "overview_orientation":
      return "intro_missing";
    case "setup_install":
      return "sibling_missing";
    case "decision_rationale":
      return "parent_missing";
    case "cross_module_boundary":
      return "cross_module_boundary_missing";
    case "sibling_support":
      return "sibling_missing";
  }
}
