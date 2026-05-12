/**
 * THO-138 / PRD-0013 V2.5.5 — deterministic source coverage verifier.
 *
 * Decides whether a candidate source plausibly covers the query need.
 * It is NOT a reranker. It is a gate: confidence (S6) and assembly readiness
 * consume the structured decision + reason codes. Conservative on
 * unsupported unanchored cases; intent-aware so a rationale query is not
 * served by an api_reference doc just because the lexical score is high.
 */
import type { ProfileEnrichedSourceCandidate } from "./source-candidates.js";
import type { QueryIntent } from "./source-rerank.js";
import { tokenize } from "./tokenize.js";

export const COVERAGE_DECISIONS = [
  "covers",
  "partial",
  "unsupported",
  "needs_anchors",
] as const;
export type CoverageDecision = (typeof COVERAGE_DECISIONS)[number];

export const COVERAGE_REASON_CODES = [
  "title_path_match",
  "alias_symbol_match",
  "heading_match",
  "anchor_match",
  "weak_aboutness",
  "low_specificity_section",
  "off_domain_match",
  "missing_anchor",
  "no_query_signal",
] as const;
export type CoverageReasonCode = (typeof COVERAGE_REASON_CODES)[number];

export type CoverageVerifierInput = {
  intent: QueryIntent;
  query_tokens: string[];
  candidate: ProfileEnrichedSourceCandidate;
  /** Distinct multi-path candidate paths supporting this source post-fusion. */
  path_agreement: number;
  /** Top-1 chunk score under this source — used to flag high-lexical, low-aboutness cases. */
  top_chunk_score: number;
  required_anchors: { files: string[]; symbols: string[]; routes: string[] };
};

export type CoverageVerification = {
  decision: CoverageDecision;
  reasons: CoverageReasonCode[];
};

const RATIONALE_PURPOSES = new Set(["adr", "prd", "concept", "runbook", "guide"]);

export function verifySourceCoverage(
  input: CoverageVerifierInput,
): CoverageVerification {
  const reasons: CoverageReasonCode[] = [];
  const profile = input.candidate.profile;

  if (input.intent === "signal_empty") {
    return { decision: "unsupported", reasons: ["off_domain_match"] };
  }

  if (!profile) {
    return { decision: "unsupported", reasons: ["weak_aboutness"] };
  }

  // Apply the same tokenizer the index uses so query and source stems align.
  const queryStems = new Set(input.query_tokens.flatMap((t) => tokenize(t)));

  const titleStems = new Set(tokenize(profile.title));
  const pathStems = new Set(tokenize(profile.source_path));
  const headingStems = new Set(
    profile.heading_outline.flatMap((h) => tokenize(h.text)),
  );
  const aliasSymbolStems = new Set<string>();
  const aliasOtherStems = new Set<string>();
  for (const a of profile.aliases) {
    const stems = tokenize(a.value);
    for (const s of stems) {
      if (a.kind === "symbol" || a.kind === "route") aliasSymbolStems.add(s);
      else aliasOtherStems.add(s);
    }
  }

  const overlapCount = (set: Set<string>) =>
    [...queryStems].filter((s) => set.has(s)).length;

  const titleOverlap = overlapCount(titleStems);
  const pathOverlap = overlapCount(pathStems);
  const headingOverlap = overlapCount(headingStems);
  const symbolAliasOverlap = overlapCount(aliasSymbolStems);
  const otherAliasOverlap = overlapCount(aliasOtherStems);

  const titleHit = titleOverlap > 0;
  const pathHit = pathOverlap > 0;
  const headingHit = headingOverlap > 0;
  const symbolAliasHit = symbolAliasOverlap > 0;
  const otherAliasHit = otherAliasOverlap > 0;

  const titlePathHit = titleHit || pathHit;
  // PRD-0013 ceiling fix: when the query has multiple content tokens, "covers"
  // for broad_domain requires the doc to match ≥2 of them. A single-token
  // overlap with the corpus name (e.g., "hono" matching every Hono doc when
  // the topic is gRPC) is partial at most — it must not surface as confident.
  // Count distinct query tokens that match ANY of title/path/heading/alias.
  // A token matched by multiple surfaces still counts once — otherwise the
  // corpus name (matching title + path + alias) inflates aboutness when the
  // real topic of the query has zero coverage.
  const distinctQueryTokensWithEvidence = [...queryStems].filter((s) =>
    titleStems.has(s) ||
    pathStems.has(s) ||
    headingStems.has(s) ||
    aliasSymbolStems.has(s) ||
    aliasOtherStems.has(s),
  ).length;
  const queryContentSize = queryStems.size;
  const strongTitlePathMatch =
    distinctQueryTokensWithEvidence >= 2 ||
    (queryContentSize <= 1 && distinctQueryTokensWithEvidence >= 1);

  if (titlePathHit) reasons.push("title_path_match");
  if (symbolAliasHit) reasons.push("alias_symbol_match");
  if (headingHit) reasons.push("heading_match");

  // Anchor signals — independent of textual aboutness.
  const sourcePath = input.candidate.source_path;
  const anchorMatched =
    input.required_anchors.files.some(
      (f) => f === sourcePath || sourcePath.endsWith(`/${f}`),
    );
  if (anchorMatched) reasons.push("anchor_match");

  if (input.intent === "file_anchored") {
    if (anchorMatched) {
      return { decision: "covers", reasons };
    }
    // Anchors typically point at CODE files, while doc sources are markdown —
    // a literal anchor match is rare. The anchor still binds scope, so any
    // title/path/heading/alias evidence on the doc side is enough to call it
    // covers. Only `no aboutness at all` falls through to needs_anchors.
    if (titlePathHit || symbolAliasHit || headingHit) {
      return { decision: "covers", reasons };
    }
    const hasRequired =
      input.required_anchors.files.length +
        input.required_anchors.symbols.length +
        input.required_anchors.routes.length >
      0;
    if (hasRequired) {
      reasons.push("missing_anchor");
      return { decision: "needs_anchors", reasons };
    }
    // No anchors at all: fall through to broad_domain handling.
  }

  if (input.intent === "exact_symbol") {
    if (symbolAliasHit) {
      return { decision: "covers", reasons };
    }
    if (titlePathHit) {
      return { decision: "covers", reasons };
    }
    if (headingHit) {
      reasons.push("weak_aboutness");
      return { decision: "partial", reasons };
    }
    reasons.push("weak_aboutness");
    return { decision: "unsupported", reasons };
  }

  if (input.intent === "decision_lookup") {
    const isRationale = RATIONALE_PURPOSES.has(profile.doc_purpose);
    if (isRationale && (titlePathHit || headingHit)) {
      return { decision: "covers", reasons };
    }
    if (
      profile.doc_purpose === "api_reference" ||
      profile.doc_purpose === "package_readme" ||
      profile.doc_purpose === "readme"
    ) {
      reasons.push("low_specificity_section");
      return { decision: "partial", reasons };
    }
    reasons.push("weak_aboutness");
    return { decision: "unsupported", reasons };
  }

  // broad_domain (and file_anchored fallthrough)
  if (strongTitlePathMatch && input.path_agreement >= 2) {
    return { decision: "covers", reasons };
  }
  if (titlePathHit || symbolAliasHit) {
    return { decision: "partial", reasons };
  }
  if (headingHit && otherAliasHit) {
    return { decision: "partial", reasons };
  }
  // No aboutness signal: high lexical score is not enough.
  reasons.push("weak_aboutness");
  if (queryStems.size === 0) {
    reasons.push("no_query_signal");
    return { decision: "unsupported", reasons };
  }
  // Off-domain: the source is canonical for something else but the query
  // tokens have no overlap with title/path/heading/alias.
  reasons.push("off_domain_match");
  return { decision: "unsupported", reasons };
}
