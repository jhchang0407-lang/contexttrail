import type { PackReadinessState } from "./eval-readiness.js";
import type { PackReadinessReasonCode } from "./pack-verifier.js";
import type { TaskNeed } from "./task-need.js";
import {
  canAnswerWithCaveat,
  derivedReasonCodes,
  shouldAbstain,
  shouldAskForAnchors,
  shouldInspectPackBeforeRetry,
} from "./recovery-plan-policy.js";
import {
  buildAnchorRequests,
  buildFollowUpSearches,
} from "./recovery-searches.js";

export const RECOVERY_ACTIONS = [
  "answer",
  "answer_with_caveat",
  "inspect_pack_or_retry",
  "retry_with_followup_searches",
  "ask_for_anchors",
  "abstain",
] as const;

export type RecoveryAction = typeof RECOVERY_ACTIONS[number];

export const RECOVERY_PLAN_REASON_CODES = [
  "pack_ready",
  "ranked_context_available",
  "insufficient_ranked_context",
  "needs_user_anchor",
  "retry_can_expand_query",
  "safe_to_answer_with_caveat",
] as const;

export type RecoveryPlanReasonCode =
  | PackReadinessReasonCode
  | typeof RECOVERY_PLAN_REASON_CODES[number];

export type RecoveryPlanInput = {
  task: string;
  query_intent?: string;
  query_mode: "anchored" | "signal_empty" | "unanchored";
  coverage_confidence: "confident" | "uncertain" | "empty";
  pack_readiness: PackReadinessState;
  reason_codes: PackReadinessReasonCode[];
  missing_needs: TaskNeed[];
  warnings: string[];
  ranked: {
    contexttrail: string;
    score: number;
    tokens: number;
    kind: "chunk" | "card";
    source_path?: string;
  }[];
  files?: string[];
  symbols?: string[];
  routes?: string[];
};

export type RecoveryPlan = {
  action: RecoveryAction;
  reason_codes: RecoveryPlanReasonCode[];
  hint: string;
  follow_up_searches: string[];
  anchor_requests: string[];
};

export function buildRecoveryPlan(input: RecoveryPlanInput): RecoveryPlan {
  const reasonCodes = uniqueReasonCodes([
    ...input.reason_codes,
    ...derivedReasonCodes(input),
  ]);
  const follow_up_searches = buildFollowUpSearches(input);
  const anchor_requests = buildAnchorRequests(input);

  if (shouldAbstain(input)) {
    return {
      action: "abstain",
      reason_codes: reasonCodes,
      hint: "The ledger does not have enough supporting context to answer this safely.",
      follow_up_searches,
      anchor_requests,
    };
  }

  if (shouldAskForAnchors(input)) {
    return {
      action: "ask_for_anchors",
      reason_codes: reasonCodes,
      hint: anchor_requests.length > 0
        ? `Ask for ${anchor_requests.join(", ")} before answering.`
        : "Ask for a concrete file, symbol, route, package, or config key before answering.",
      follow_up_searches,
      anchor_requests,
    };
  }

  if (input.coverage_confidence === "confident" && input.pack_readiness === "ready") {
    return {
      action: "answer",
      reason_codes: reasonCodes,
      hint: "The ledger has a ready pack with confident coverage.",
      follow_up_searches,
      anchor_requests,
    };
  }

  if (canAnswerWithCaveat(input)) {
    return {
      action: "answer_with_caveat",
      reason_codes: reasonCodes,
      hint: "Answer from the ranked context, cite the specific refs used, and call out what is still uncertain.",
      follow_up_searches,
      anchor_requests,
    };
  }

  if (shouldInspectPackBeforeRetry(input)) {
    return {
      action: "inspect_pack_or_retry",
      reason_codes: reasonCodes,
      hint: "Inspect the current ranked refs first. If they do not directly support the task, retry with the generated follow-up searches.",
      follow_up_searches,
      anchor_requests,
    };
  }

  return {
    action: "retry_with_followup_searches",
    reason_codes: reasonCodes,
    hint: follow_up_searches.length > 0
      ? "Retry with the generated follow-up searches rather than repeating the same broad query."
      : "Retry with a narrower query derived from the task and the current top refs.",
    follow_up_searches,
    anchor_requests,
  };
}

function uniqueReasonCodes(codes: RecoveryPlanReasonCode[]): RecoveryPlanReasonCode[] {
  const seen = new Set<RecoveryPlanReasonCode>();
  const out: RecoveryPlanReasonCode[] = [];
  for (const code of codes) {
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}
