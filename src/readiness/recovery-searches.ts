import { missingQueryAnchorRequests } from "../query-anchors.js";
import type { RecoveryPlanInput } from "./recovery-plan.js";

export function buildAnchorRequests(input: RecoveryPlanInput): string[] {
  return missingQueryAnchorRequests(input).slice(0, 3);
}

export function buildFollowUpSearches(input: RecoveryPlanInput): string[] {
  const taskTerms = importantTerms(input.task).slice(0, 6);
  const anchors = [...(input.symbols ?? []), ...(input.files ?? []), ...(input.routes ?? [])]
    .map(cleanSearchTerm)
    .filter((term) => term.length > 0);
  const sources = input.ranked
    .filter((entry) => entry.kind === "chunk" || entry.kind === "code")
    .map((entry) => entry.source_path ?? sourceFromContextTrail(entry.contexttrail))
    .filter((source) => source.length > 0)
    .slice(0, 3);
  const codeSymbols = input.ranked
    .filter((entry) => entry.kind === "code")
    .map((entry) => cleanSearchTerm(entry.symbol_path ?? ""))
    .filter((symbol) => symbol.length > 0)
    .slice(0, 3);

  const searches: string[] = [];
  addSearch(searches, [...anchors.slice(0, 2), ...taskTerms.slice(0, 4)].join(" "));

  if (input.missing_needs.includes("exact_symbol_behavior")) {
    addSearch(searches, [...anchors.slice(0, 2), ...taskTerms, "behavior"].join(" "));
    addSearch(
      searches,
      [...(input.symbols ?? []), ...codeSymbols, "implementation"].join(" "),
    );
  }
  if (input.missing_needs.includes("cross_module_boundary")) {
    addSearch(searches, [...taskTerms, ...sourceBasenames(sources), "integration"].join(" "));
    addSearch(searches, [...(input.files ?? []), ...sourceBasenames(sources), "call graph"].join(" "));
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
  if (sourceMatch?.[1]) return sourceMatch[1].trim();
  const codeMatch = /^Code:\s+([^>]+?)(?:\s+>|$)/.exec(contexttrail);
  return codeMatch?.[1]?.trim() ?? "";
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
