import type { QueryMode } from "./query-scope.js";
import { anchorIntentFallbackEnabledFromEnv } from "./source-rerank-flags.js";

export const QUERY_INTENTS = [
  "decision_lookup",
  "exact_symbol",
  "broad_domain",
  "file_anchored",
  "signal_empty",
] as const;
export type QueryIntent = (typeof QUERY_INTENTS)[number];

const DECISION_REGEX =
  /\b(why|tradeoff|trade-off|rationale|decision|decisions|chose|prefer|prefers|alternative)\b/i;

export type IntentInputs = {
  task: string;
  query_mode: QueryMode;
  has_anchors?: boolean;
  enable_anchor_intent_fallback?: boolean;
};

export function classifyQueryIntent(input: IntentInputs): QueryIntent {
  if (input.query_mode === "signal_empty") {
    if (
      input.has_anchors &&
      (input.enable_anchor_intent_fallback ?? anchorIntentFallbackEnabledFromEnv())
    ) {
      return "file_anchored";
    }
    return "signal_empty";
  }
  if (input.has_anchors) return "file_anchored";
  if (DECISION_REGEX.test(input.task)) return "decision_lookup";
  if (/[a-z][A-Z]|[A-Za-z]+\.[A-Za-z]+|[A-Za-z]+\(\)/.test(input.task)) {
    return "exact_symbol";
  }
  return "broad_domain";
}
