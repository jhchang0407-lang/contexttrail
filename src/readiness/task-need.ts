/**
 * Deterministic task-need extractor.
 *
 * Reads retrieval-side inputs (task text, query mode, provided anchors,
 * query intent) and emits stable need categories the pack readiness
 * verifier and source-scoped chunk selector can reason about. No model
 * dependency.
 */
import type { QueryIntent } from "../types/query.js";
import { topDirectoryGroups } from "../query-anchors.js";

export const TASK_NEEDS = [
  "exact_symbol_behavior",
  "overview_orientation",
  "setup_install",
  "decision_rationale",
  "cross_module_boundary",
  "sibling_support",
] as const;

export type TaskNeed = typeof TASK_NEEDS[number];

export type TaskNeedInputs = {
  task: string;
  query_mode: "anchored" | "unanchored" | "signal_empty";
  query_intent?: QueryIntent;
  symbols?: string[];
  files?: string[];
  routes?: string[];
};

export function extractTaskNeeds(inputs: TaskNeedInputs): TaskNeed[] {
  const needs: TaskNeed[] = [];
  if (isExactSymbolBehavior(inputs)) needs.push("exact_symbol_behavior");
  if (isOverviewOrientation(inputs)) needs.push("overview_orientation");
  if (isSetupInstall(inputs)) needs.push("setup_install");
  if (isDecisionRationale(inputs)) needs.push("decision_rationale");
  if (isCrossModuleBoundary(inputs)) needs.push("cross_module_boundary");
  if (isSiblingSupport(inputs)) needs.push("sibling_support");
  return needs;
}

const SIBLING_PATTERNS = [
  /\bcompare\b/i,
  /\bcomparison\b/i,
  /\bversus\b/i,
  /\bvs\.?\b/i,
  /\bdifference between\b/i,
  /\balternatives?\b/i,
];

function isSiblingSupport(inputs: TaskNeedInputs): boolean {
  return SIBLING_PATTERNS.some((re) => re.test(inputs.task));
}

function isCrossModuleBoundary(inputs: TaskNeedInputs): boolean {
  if (inputs.query_intent === "cross_module") return true;
  const files = inputs.files ?? [];
  if (files.length < 2) return false;
  return topDirectoryGroups(files).size >= 2;
}

const DECISION_PATTERNS = [
  /\bwhy\b/i,
  /\brationale\b/i,
  /\btrade[- ]?off(?:s)?\b/i,
  /\bdecision\b/i,
  /\bdecide\b/i,
  /\bchose\b/i,
  /\bchoice\b/i,
  /\bversus\b|\bvs\.?\b/i,
];

function isDecisionRationale(inputs: TaskNeedInputs): boolean {
  if (inputs.query_intent === "decision_lookup") return true;
  return DECISION_PATTERNS.some((re) => re.test(inputs.task));
}

const OVERVIEW_PATTERNS = [
  /\boverview\b/i,
  /\bintroduction\b/i,
  /\bwhat is\b/i,
  /\bhow does\b/i,
  /\bwhat are\b/i,
  /\bexplain\b/i,
];

function isOverviewOrientation(inputs: TaskNeedInputs): boolean {
  if (inputs.query_intent === "exact_symbol") return false;
  if (OVERVIEW_PATTERNS.some((re) => re.test(inputs.task))) return true;
  return inputs.query_intent === "broad_domain" && inputs.query_mode === "unanchored";
}

function isExactSymbolBehavior(inputs: TaskNeedInputs): boolean {
  if (inputs.query_intent === "exact_symbol") return true;
  return (inputs.symbols ?? []).length > 0;
}

const SETUP_PATTERNS = [
  /\binstall(?:ation|ing)?\b/i,
  /\bset(?:\s|-)?up\b/i,
  /\bgetting started\b/i,
  /\bconfigure\b/i,
  /\bconfiguration\b/i,
  /\binitiali[sz]e\b/i,
  /\bbootstrap\b/i,
];

function isSetupInstall(inputs: TaskNeedInputs): boolean {
  return SETUP_PATTERNS.some((re) => re.test(inputs.task));
}
