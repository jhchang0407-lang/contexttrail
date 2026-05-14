import { hasQueryAnchors } from "../query-anchors.js";
import type {
  RecoveryPlanInput,
  RecoveryPlanReasonCode,
} from "./recovery-plan.js";

export function shouldAbstain(input: RecoveryPlanInput): boolean {
  if (input.coverage_confidence === "empty") return true;
  if (input.pack_readiness === "unsupported") return true;
  if (input.ranked.length === 0 && input.warnings.includes("no_sources")) return true;
  return false;
}

export function shouldAskForAnchors(input: RecoveryPlanInput): boolean {
  if (input.query_intent === "signal_empty") return true;
  if (input.query_mode === "signal_empty") return true;
  if (input.pack_readiness === "needs_anchors") return true;
  if (input.warnings.includes("anchors_unrecognized")) return true;

  const hasUserAnchors = hasQueryAnchors(input);
  const missingAnchorSensitiveNeed = input.missing_needs.some((need) =>
    need === "exact_symbol_behavior" || need === "cross_module_boundary",
  );
  return !hasUserAnchors && missingAnchorSensitiveNeed && input.ranked.length < 3;
}

export function canAnswerWithCaveat(input: RecoveryPlanInput): boolean {
  if (input.ranked.length === 0) return false;
  if (input.coverage_confidence === "empty") return false;
  if (input.pack_readiness === "unsupported" || input.pack_readiness === "needs_anchors") return false;
  if (input.reason_codes.includes("must_include_missing")) return false;
  if (input.reason_codes.includes("anchors_unrecognized")) return false;
  if (input.query_intent === "signal_empty") return false;
  if (input.missing_needs.includes("exact_symbol_behavior") && !hasQueryAnchors(input)) return false;
  if (input.missing_needs.includes("cross_module_boundary") && !hasQueryAnchors(input)) return false;
  if (input.coverage_confidence === "uncertain" && !hasQueryAnchors(input)) return false;
  return input.ranked.length >= 3 || input.reason_codes.includes("ambiguous_top_family");
}

export function shouldInspectPackBeforeRetry(input: RecoveryPlanInput): boolean {
  if (input.coverage_confidence !== "uncertain") return false;
  if (hasQueryAnchors(input)) return false;
  if (input.query_mode !== "unanchored") return false;
  if (input.reason_codes.includes("no_evidence")) return false;
  if (input.warnings.includes("no_matches")) return false;
  if (input.ranked.length < 5) return false;
  if (input.missing_needs.includes("exact_symbol_behavior")) return false;
  if (input.missing_needs.includes("cross_module_boundary")) return false;
  return true;
}

export function derivedReasonCodes(input: RecoveryPlanInput): RecoveryPlanReasonCode[] {
  const out: RecoveryPlanReasonCode[] = [];
  if (input.pack_readiness === "ready" && input.coverage_confidence === "confident") {
    out.push("pack_ready");
  }
  if (input.ranked.length > 0) out.push("ranked_context_available");
  else out.push("insufficient_ranked_context");
  if (shouldAskForAnchors(input)) out.push("needs_user_anchor");
  if (canAnswerWithCaveat(input)) out.push("safe_to_answer_with_caveat");
  if (input.coverage_confidence === "uncertain" || input.pack_readiness === "partial") {
    out.push("retry_can_expand_query");
  }
  return out;
}
