/**
 * Source evidence compiler.
 *
 * This module is intentionally narrower than `source-rerank.ts`: it does not
 * score or sort. It turns the current SourceCard + aboutness record into a
 * typed evidence record so selection policy can reason over categories instead
 * of reaching into many shallow metadata fields directly.
 */
import type { AboutnessObservation } from "./aboutness.js";
import type { SourceCard } from "./source-card.js";
import type { QueryIntent } from "./source-rerank.js";
import { tokenize as tokenizeRetrievalText } from "./tokenize.js";

export const SOURCE_EVIDENCE_KINDS = [
  "identity",
  "role",
  "relation",
  "structure",
  "exclusion",
] as const;
export type SourceEvidenceKind = (typeof SOURCE_EVIDENCE_KINDS)[number];

export const SOURCE_EVIDENCE_STRENGTHS = [
  "none",
  "weak",
  "supporting",
  "direct",
] as const;
export type SourceEvidenceStrength =
  (typeof SOURCE_EVIDENCE_STRENGTHS)[number];

export type SourceEvidenceProvenance =
  | "source_card"
  | "aboutness"
  | "profile"
  | "path_topology"
  | "nav_metadata"
  | "heading_alias"
  | "code_fence_entity";

export type SourceEvidenceClaim = {
  kind: SourceEvidenceKind;
  strength: SourceEvidenceStrength;
  provenance: SourceEvidenceProvenance;
  reason: string;
  value?: string;
  matched_tokens: string[];
};

export type SourceEvidence = {
  source_path: string;
  rank: number;
  query_intent: QueryIntent;
  aboutness_label: AboutnessObservation["label"] | "unknown";
  claims: SourceEvidenceClaim[];
  identity_strength: SourceEvidenceStrength;
  role_strength: SourceEvidenceStrength;
  relation_strength: SourceEvidenceStrength;
  structure_strength: SourceEvidenceStrength;
  exclusion_strength: SourceEvidenceStrength;
  identity_score: number;
  role_score: number;
  relation_score: number;
  structure_score: number;
  trusted_direct_identity: boolean;
  trusted_overview_shape: boolean;
};

export type CompileSourceEvidenceArgs = {
  card: SourceCard;
  aboutness?: AboutnessObservation;
};

export type CompileSourceEvidenceSetArgs = {
  cards: SourceCard[];
  aboutness: AboutnessObservation[];
};

export function compileSourceEvidenceSet(
  args: CompileSourceEvidenceSetArgs,
): SourceEvidence[] {
  const aboutnessByPath = new Map(
    args.aboutness.map((obs) => [obs.source_path, obs]),
  );
  return [...args.cards]
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.source_path.localeCompare(b.source_path);
    })
    .map((card) =>
      compileSourceEvidence({
        card,
        aboutness: aboutnessByPath.get(card.source_path),
      }),
    );
}

export function compileSourceEvidence(
  args: CompileSourceEvidenceArgs,
): SourceEvidence {
  const { card, aboutness } = args;
  const claims: SourceEvidenceClaim[] = [
    ...identityClaims(card),
    ...roleClaims(card),
    ...relationClaims(card, aboutness),
    ...structureClaims(card),
  ];
  const byKind = (kind: SourceEvidenceKind) =>
    claims.filter((claim) => claim.kind === kind);

  const identityStrength = maxStrength(byKind("identity"));
  const roleStrength = maxStrength(byKind("role"));
  const relationStrength = maxStrength(byKind("relation"));
  const structureStrength = maxStrength(byKind("structure"));
  const exclusionStrength = maxStrength(byKind("exclusion"));

  return {
    source_path: card.source_path,
    rank: card.rank,
    query_intent: card.query_intent,
    aboutness_label: aboutness?.label ?? "unknown",
    claims,
    identity_strength: identityStrength,
    role_strength: roleStrength,
    relation_strength: relationStrength,
    structure_strength: structureStrength,
    exclusion_strength: exclusionStrength,
    identity_score: strengthScore(identityStrength),
    role_score: strengthScore(roleStrength),
    relation_score: strengthScore(relationStrength),
    structure_score: strengthScore(structureStrength),
    trusted_direct_identity: identityStrength === "direct",
    trusted_overview_shape:
      structureStrength === "direct" &&
      (card.query_intent === "broad_domain" ||
        card.query_intent === "decision_lookup"),
  };
}

export function strengthScore(strength: SourceEvidenceStrength): number {
  switch (strength) {
    case "direct":
      return 3;
    case "supporting":
      return 2;
    case "weak":
      return 1;
    case "none":
      return 0;
    default:
      return assertNever(strength);
  }
}

function identityClaims(card: SourceCard): SourceEvidenceClaim[] {
  const claims: SourceEvidenceClaim[] = [];
  const coverage = card.token_coverage;
  const bestCoverage = Math.max(
    coverage.title_token_coverage,
    coverage.path_token_coverage,
    coverage.heading_token_coverage,
  );
  if (bestCoverage > 0) {
    claims.push({
      kind: "identity",
      strength: strengthFromCoverage(bestCoverage),
      provenance: "source_card",
      reason: "token_coverage",
      value: bestCoverage.toFixed(4),
      matched_tokens: [...card.query_tokens],
    });
  }

  const anchorSymbols = normalizedSet(card.anchor_symbols);
  if (anchorSymbols.size > 0) {
    const basename = normalizeToken(
      card.source_path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "",
    );
    if (basename && anchorSymbols.has(basename)) {
      claims.push({
        kind: "identity",
        strength: "direct",
        provenance: "source_card",
        reason: "anchor_symbol_matches_basename",
        value: basename,
        matched_tokens: [basename],
      });
    }
  }

  const headingAlias = bestTokenMatch(
    card.query_tokens,
    card.heading_aliases.flatMap((alias) => alias.tokens),
  );
  if (headingAlias.coverage > 0) {
    claims.push({
      kind: "identity",
      strength: strengthFromCoverage(headingAlias.coverage),
      provenance: "heading_alias",
      reason: "heading_alias_token_match",
      value: headingAlias.coverage.toFixed(4),
      matched_tokens: headingAlias.matched,
    });
  }

  const entityTokens = card.code_fence_entities.flatMap((entity) =>
    tokenizeRetrievalText(entity.normalized || entity.value),
  );
  const entityMatch = bestTokenMatch(card.query_tokens, entityTokens);
  if (entityMatch.coverage > 0) {
    claims.push({
      kind: "identity",
      strength: strengthFromCoverage(entityMatch.coverage),
      provenance: "code_fence_entity",
      reason: "code_fence_entity_token_match",
      value: entityMatch.coverage.toFixed(4),
      matched_tokens: entityMatch.matched,
    });
  }

  return claims;
}

function roleClaims(card: SourceCard): SourceEvidenceClaim[] {
  const purpose = card.profile_signals?.doc_purpose;
  if (!purpose || purpose === "unknown") return [];
  const strength = purposeStrength(card.query_intent, purpose);
  if (strength === "none") return [];
  return [
    {
      kind: "role",
      strength,
      provenance: "profile",
      reason: "doc_purpose_matches_query_intent",
      value: purpose,
      matched_tokens: [],
    },
  ];
}

function relationClaims(
  card: SourceCard,
  aboutness?: AboutnessObservation,
): SourceEvidenceClaim[] {
  if (!aboutness) return [];
  const claims: SourceEvidenceClaim[] = [];
  const labelStrength = relationStrengthFromLabel(aboutness.label);
  if (labelStrength !== "none") {
    claims.push({
      kind: "relation",
      strength: labelStrength,
      provenance: "aboutness",
      reason: `aboutness_${aboutness.label}`,
      matched_tokens: [],
    });
  }
  for (const code of aboutness.reason_codes) {
    claims.push({
      kind: "relation",
      strength: relationStrengthFromReason(card.query_intent, code),
      provenance: "aboutness",
      reason: code,
      matched_tokens: [],
    });
  }
  return claims;
}

function structureClaims(card: SourceCard): SourceEvidenceClaim[] {
  const claims: SourceEvidenceClaim[] = [];
  if (card.path_topology.is_section_landing) {
    claims.push({
      kind: "structure",
      strength: "supporting",
      provenance: "path_topology",
      reason: "section_landing",
      matched_tokens: [],
    });
  }
  if (card.path_topology.is_index_file) {
    claims.push({
      kind: "structure",
      strength: "weak",
      provenance: "path_topology",
      reason: "index_file",
      matched_tokens: [],
    });
  }
  if (
    card.nav_metadata.is_nav_landing &&
    card.nav_metadata.nav_provenance === "explicit_config"
  ) {
    claims.push({
      kind: "structure",
      strength: "direct",
      provenance: "nav_metadata",
      reason: "explicit_nav_landing",
      matched_tokens: [],
    });
  }
  return claims;
}

function purposeStrength(
  intent: QueryIntent,
  purpose: string,
): SourceEvidenceStrength {
  if (intent === "decision_lookup") {
    if (purpose === "concept" || purpose === "adr" || purpose === "prd") {
      return "direct";
    }
    if (purpose === "guide" || purpose === "readme") return "supporting";
    return "weak";
  }
  if (intent === "broad_domain") {
    if (
      purpose === "concept" ||
      purpose === "readme" ||
      purpose === "package_readme" ||
      purpose === "quick_start"
    ) {
      return "direct";
    }
    if (purpose === "guide" || purpose === "example") return "supporting";
    return "weak";
  }
  if (intent === "file_anchored" || intent === "exact_symbol") {
    if (
      purpose === "api_reference" ||
      purpose === "guide" ||
      purpose === "runbook"
    ) {
      return "direct";
    }
    if (purpose === "concept" || purpose === "readme") return "supporting";
    return "weak";
  }
  return "none";
}

function relationStrengthFromLabel(
  label: AboutnessObservation["label"],
): SourceEvidenceStrength {
  switch (label) {
    case "covers":
      return "direct";
    case "partial":
      return "supporting";
    case "adjacent":
      return "weak";
    case "too_broad":
    case "too_narrow":
    case "unsupported":
      return "none";
    default:
      return assertNever(label);
  }
}

function relationStrengthFromReason(
  intent: QueryIntent,
  reason: AboutnessObservation["reason_codes"][number],
): SourceEvidenceStrength {
  if (
    (reason === "parent_vs_leaf" ||
      reason === "concept_over_leaves_by_purpose") &&
    (intent === "broad_domain" || intent === "decision_lookup")
  ) {
    return "supporting";
  }
  if (reason === "decision_vs_procedural" && intent === "decision_lookup") {
    return "supporting";
  }
  if (reason === "guide_vs_reference" && intent === "file_anchored") {
    return "supporting";
  }
  if (reason === "changelog_release_intent") return "weak";
  return "weak";
}

function strengthFromCoverage(coverage: number): SourceEvidenceStrength {
  if (coverage >= 0.75) return "direct";
  if (coverage >= 0.4) return "supporting";
  if (coverage > 0) return "weak";
  return "none";
}

function maxStrength(claims: SourceEvidenceClaim[]): SourceEvidenceStrength {
  let best: SourceEvidenceStrength = "none";
  for (const claim of claims) {
    if (strengthScore(claim.strength) > strengthScore(best)) {
      best = claim.strength;
    }
  }
  return best;
}

function bestTokenMatch(queryTokens: string[], targetTokens: string[]): {
  coverage: number;
  matched: string[];
} {
  if (queryTokens.length === 0 || targetTokens.length === 0) {
    return { coverage: 0, matched: [] };
  }
  const targets = new Set(targetTokens.map(normalizeToken).filter(Boolean));
  const matched = dedupePreserveOrder(
    queryTokens.map(normalizeToken).filter((token) => token && targets.has(token)),
  );
  return {
    coverage: matched.length / queryTokens.length,
    matched,
  };
}

function normalizedSet(values: string[]): Set<string> {
  return new Set(values.map(normalizeToken).filter(Boolean));
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function dedupePreserveOrder<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
