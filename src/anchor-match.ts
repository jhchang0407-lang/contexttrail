import type { CodeAnchorConfidence, CodeAnchorKind } from "./types/chunk.js";

export type AnchorMatchKind = "exact" | "case_insensitive" | "symbol_form_variant";

export type AnchorMatch = {
  kind: AnchorMatchKind;
  confidence: CodeAnchorConfidence;
};

const FUZZY_CONFIDENCE: CodeAnchorConfidence = "low";

export function matchAnchorValue(
  query: { kind: CodeAnchorKind; value: string },
  indexed: { kind: CodeAnchorKind; value: string; confidence: CodeAnchorConfidence },
): AnchorMatch | null {
  if (query.kind !== indexed.kind) return null;
  if (query.value === indexed.value) {
    return { kind: "exact", confidence: indexed.confidence };
  }

  // Business identifiers ("id") match by exact, case-folded equality ONLY.
  // Separators are deliberately NOT normalized: CLM-2026-0412, CLM/2026/0412
  // and CLM20260412 stay distinct — separator structure is part of the
  // identifier, only letter case is presentation. Unlike fuzzy symbol forms,
  // a case-folded id match keeps the indexed confidence: clm-2026-0412 vs
  // CLM-2026-0412 is not a weaker claim, just a different spelling.
  if (query.kind === "id") {
    if (query.value.toLowerCase() === indexed.value.toLowerCase()) {
      return { kind: "case_insensitive", confidence: indexed.confidence };
    }
    return null;
  }

  if (query.kind !== "symbol") return null;

  if (query.value.toLowerCase() === indexed.value.toLowerCase()) {
    return { kind: "case_insensitive", confidence: FUZZY_CONFIDENCE };
  }

  if (symbolFormVariant(query.value, indexed.value)) {
    return { kind: "symbol_form_variant", confidence: FUZZY_CONFIDENCE };
  }

  return null;
}

function symbolFormVariant(a: string, b: string): boolean {
  const aSegments = symbolSegments(a);
  const bSegments = symbolSegments(b);
  if (aSegments.length === 0 || bSegments.length === 0) return false;

  // `JWT` should bind to `JWTAuthMiddleware`, but `Scheduler_1` should not
  // bind to `Scheduler_1_NotPresent`. Limit fuzzy prefixing to a single
  // provided symbol token against one indexed symbol segment.
  if (aSegments.length === 1 && segmentPrefixMatch(aSegments[0]!, bSegments)) {
    return true;
  }

  return false;
}

function symbolSegments(value: string): string[] {
  return value
    .split(/[^A-Za-z0-9]+/)
    .map((s) => normalizeSymbolSegment(s))
    .filter((s) => s.length > 0);
}

function normalizeSymbolSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function segmentPrefixMatch(needle: string, haystack: string[]): boolean {
  if (needle.length < 3) return false;
  return haystack.some((segment) => {
    if (segment === needle) return true;
    if (segment.length <= needle.length) return false;
    return segment.startsWith(needle);
  });
}
