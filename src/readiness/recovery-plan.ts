import type { PackReadinessState } from "./eval-readiness.js";
import type { PackReadinessReasonCode } from "./pack-verifier.js";
import type { TaskNeed } from "./task-need.js";
import {
  hasQueryAnchors,
  missingQueryAnchorRequests,
} from "../query-anchors.js";

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
  ranked: { contexttrail: string; score: number; tokens: number; kind: "chunk" | "card" | "code" }[];
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

function shouldAbstain(input: RecoveryPlanInput): boolean {
  if (input.coverage_confidence === "empty") return true;
  if (input.pack_readiness === "unsupported") return true;
  if (input.ranked.length === 0 && input.warnings.includes("no_sources")) return true;
  return false;
}

function shouldAskForAnchors(input: RecoveryPlanInput): boolean {
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

function canAnswerWithCaveat(input: RecoveryPlanInput): boolean {
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

function shouldInspectPackBeforeRetry(input: RecoveryPlanInput): boolean {
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

function derivedReasonCodes(input: RecoveryPlanInput): RecoveryPlanReasonCode[] {
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

function buildAnchorRequests(input: RecoveryPlanInput): string[] {
  return missingQueryAnchorRequests(input).slice(0, 3);
}

function buildFollowUpSearches(input: RecoveryPlanInput): string[] {
  const taskTerms = importantTerms(input.task).slice(0, 6);
  const anchors = [...(input.symbols ?? []), ...(input.files ?? []), ...(input.routes ?? [])]
    .map(cleanSearchTerm)
    .filter((term) => term.length > 0);
  const sources = input.ranked
    .filter((entry) => entry.kind === "chunk")
    .map((entry) => sourceFromContextTrail(entry.contexttrail))
    .filter((source) => source.length > 0)
    .slice(0, 3);

  const searches: string[] = [];
  addSearch(searches, [...anchors.slice(0, 2), ...taskTerms.slice(0, 4)].join(" "));

  if (input.missing_needs.includes("exact_symbol_behavior")) {
    addSearch(searches, [...anchors.slice(0, 2), ...taskTerms, "behavior"].join(" "));
  }
  if (input.missing_needs.includes("cross_module_boundary")) {
    addSearch(searches, [...taskTerms, ...sourceBasenames(sources), "integration"].join(" "));
  }
  if (input.reason_codes.includes("ambiguous_top_family")) {
    addSearch(searches, [...taskTerms, ...sourceBasenames(sources)].join(" "));
  }
  if (input.coverage_confidence === "uncertain") {
    addSearch(searches, [...taskTerms, "guide reference"].join(" "));
  }
  for (const source of sources) {
    addSearch(searches, `${source} ${taskTerms.slice(0, 3).join(" ")}`);
  }

  return searches.slice(0, 5);
}

function addSearch(searches: string[], search: string): void {
  const cleaned = cleanSearchTerm(search);
  if (cleaned.length === 0) return;
  if (!searches.includes(cleaned)) searches.push(cleaned);
}

function importantTerms(text: string): string[] {
  const stop = new Set([
    "about",
    "after",
    "before",
    "does",
    "from",
    "have",
    "into",
    "that",
    "the",
    "this",
    "what",
    "when",
    "where",
    "which",
    "with",
    "would",
    "how",
  ]);
  return text
    .toLowerCase()
    .match(/[a-z0-9_./:-]+/g)
    ?.map((term) => term.replace(/^[-:./]+|[-:./]+$/g, ""))
    .filter((term) => term.length > 2 && !stop.has(term)) ?? [];
}

function sourceFromContextTrail(contexttrail: string): string {
  const sourceMatch = /^Source:\s+([^>]+?)(?:\s+>|$)/.exec(contexttrail);
  return sourceMatch?.[1]?.trim() ?? "";
}

function sourceBasenames(sources: string[]): string[] {
  return sources
    .map((source) => source.split("/").filter(Boolean).at(-1) ?? "")
    .map((source) => source.replace(/\.[^.]+$/, ""))
    .filter((source) => source.length > 0);
}

function cleanSearchTerm(search: string): string {
  return search.replace(/\s+/g, " ").trim();
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
