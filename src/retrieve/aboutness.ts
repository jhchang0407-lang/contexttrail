/**
 * THO-145 / PRD-0014 V3.3 — top-N aboutness verifier.
 *
 * For each top-N candidate source card, decide whether the source is about
 * the task and explain why with structured reason codes:
 *
 *   - covers       — strong evidence the source is the right first read
 *   - partial      — some evidence but coverage is incomplete
 *   - adjacent     — useful sibling, not the canonical answer
 *   - too_broad    — overview-level when the query asks for a specific topic
 *   - too_narrow   — leaf when the query asks for a parent concept/decision
 *   - unsupported  — no real evidence; should not be a confident pick
 *
 * The verifier is deterministic. It reads SourceCard fields plus the query
 * intent and emits a label + reason codes per card. Selection (V3.4) and
 * pack/display (V3.5) consume the labels.
 *
 * No repo-specific paths or fixture-specific rules. Reason codes are stable
 * across documentation shapes and ablatable in tests.
 */
import type { SourceCard } from "./source-card.js";
import type { QueryIntent } from "./source-rerank.js";

export const ABOUTNESS_LABELS = [
  "covers",
  "partial",
  "adjacent",
  "too_broad",
  "too_narrow",
  "unsupported",
] as const;
export type AboutnessLabel = (typeof ABOUTNESS_LABELS)[number];

export const RELATIONSHIP_REASON_CODES = [
  "parent_vs_leaf",
  "overview_vs_leaf",
  "guide_vs_reference",
  "decision_vs_procedural",
  "changelog_release_intent",
  "broad_container_vs_specific_topic",
  // V5.1: purpose-only overview signal. Fires when target is concept-purpose
  // and the candidate set has multiple guide/api_reference siblings sharing
  // query tokens. Independent of path nesting — fixes the parent_vs_leaf
  // and overview_vs_reference leaks where path structure is broken or where
  // the canonical concept doc has a bare title competing with same-dir
  // reference docs.
  "concept_over_leaves_by_purpose",
] as const;
export type RelationshipReasonCode =
  (typeof RELATIONSHIP_REASON_CODES)[number];

export type AboutnessObservation = {
  source_path: string;
  rank: number;
  label: AboutnessLabel;
  reason_codes: RelationshipReasonCode[];
  /** Combined token coverage signal used by the label decision. */
  combined_token_coverage: number;
};

export type ClassifyTopNAboutnessArgs = {
  cards: SourceCard[];
  query_intent: QueryIntent;
};

export function classifyTopNAboutness(
  args: ClassifyTopNAboutnessArgs,
): AboutnessObservation[] {
  const cards = [...args.cards].sort((a, b) => a.rank - b.rank);
  return cards.map((target) => {
    const others = cards.filter((c) => c !== target);
    const reasons = classifySourceRelationship({ target, others });
    const label = pickLabel({
      target,
      others,
      reasons,
      query_intent: args.query_intent,
    });
    const combined = combinedCoverage(target);
    return {
      source_path: target.source_path,
      rank: target.rank,
      label,
      reason_codes: reasons,
      combined_token_coverage: combined,
    };
  });
}

export type ClassifySourceRelationshipArgs = {
  target: SourceCard;
  others: SourceCard[];
};

export function classifySourceRelationship(
  args: ClassifySourceRelationshipArgs,
): RelationshipReasonCode[] {
  const { target, others } = args;
  const reasons: RelationshipReasonCode[] = [];
  const tp = target.profile_signals?.doc_purpose;

  // changelog/release intent — signals from doc_purpose or filename shape.
  if (
    tp === "changelog" ||
    tp === "release_note" ||
    isChangelogPath(target.source_path)
  ) {
    reasons.push("changelog_release_intent");
  }

  // parent_vs_leaf / overview_vs_leaf — target path is a strict ancestor of
  // at least one neighbor. The top-N can also contain unrelated sources, so
  // requiring every neighbor to be a descendant hides real parent/leaf losses.
  if (others.some((o) => isStrictAncestorPath(target.source_path, o.source_path))) {
    reasons.push("parent_vs_leaf");
    if (tp === "concept" || tp === "guide" || tp === "readme") {
      reasons.push("overview_vs_leaf");
    }
  }

  // broad_container_vs_specific_topic — target is shorter-pathed and others
  // sit in deeper directories (without being strict descendants).
  if (
    others.length > 0 &&
    others.every((o) => pathDepth(o.source_path) > pathDepth(target.source_path))
  ) {
    if (!reasons.includes("parent_vs_leaf")) {
      reasons.push("broad_container_vs_specific_topic");
    }
  }

  // decision_vs_procedural — emitted on either side when a decision-rationale
  // doc (concept / adr / prd) sits next to a procedural doc (guide /
  // api_reference / runbook). Selection (V3.4) reads it as "these two are in
  // tension"; the side label depends on query intent.
  const decisionPurposes = new Set(["concept", "adr", "prd"]);
  const proceduralPurposes = new Set(["guide", "api_reference", "runbook"]);
  if (
    (tp && decisionPurposes.has(tp) &&
      others.some((o) => {
        const op = o.profile_signals?.doc_purpose;
        return op !== undefined && proceduralPurposes.has(op);
      })) ||
    (tp && proceduralPurposes.has(tp) &&
      others.some((o) => {
        const op = o.profile_signals?.doc_purpose;
        return op !== undefined && decisionPurposes.has(op);
      }))
  ) {
    reasons.push("decision_vs_procedural");
  }

  // guide_vs_reference — symmetric between guide and api_reference siblings.
  if (
    (tp === "guide" &&
      others.some((o) => o.profile_signals?.doc_purpose === "api_reference")) ||
    (tp === "api_reference" &&
      others.some((o) => o.profile_signals?.doc_purpose === "guide"))
  ) {
    reasons.push("guide_vs_reference");
  }

  // V5.1: concept_over_leaves_by_purpose — fires when target is concept-
  // purpose AND at least 2 other cards are guide/api_reference. This is
  // path-structure-INDEPENDENT, so it fires when path nesting is broken
  // (parent_vs_leaf can't fire) or when the overview's title is bare and
  // its same-dir api_reference siblings out-densify it.
  const leafLikePurposes = new Set(["guide", "api_reference"]);
  if (tp === "concept") {
    const leafLikeCount = others.filter((o) => {
      const op = o.profile_signals?.doc_purpose;
      return op !== undefined && leafLikePurposes.has(op);
    }).length;
    if (leafLikeCount >= 2) {
      reasons.push("concept_over_leaves_by_purpose");
    }
  }

  return dedupePreserveOrder(reasons);
}

type PickLabelArgs = {
  target: SourceCard;
  others: SourceCard[];
  reasons: RelationshipReasonCode[];
  query_intent: QueryIntent;
};

function pickLabel(args: PickLabelArgs): AboutnessLabel {
  const { target, others, reasons, query_intent } = args;
  const combined = combinedCoverage(target);
  const fusedAgreement =
    target.candidate_path_evidence.fused_path_count ?? 0;
  const bestScore = target.candidate_path_evidence.best_chunk_score;
  const coverageVerdict = target.coverage_decision?.verdict;

  if (coverageVerdict === "unsupported" || coverageVerdict === "needs_anchors") {
    return "unsupported";
  }

  // unsupported — no token evidence and no fused agreement and weak chunk score.
  if (combined < 0.05 && fusedAgreement <= 1 && bestScore < 0.2) {
    return "unsupported";
  }

  // too_narrow — query is decision/broad and a parent ancestor exists in the
  // top-N. For these intents the leaf is the wrong abstraction level even
  // when its lexical coverage edges out the parent's.
  const parentAncestorExists = others.some((o) =>
    isStrictAncestorPath(o.source_path, target.source_path),
  );
  if (
    parentAncestorExists &&
    (query_intent === "decision_lookup" || query_intent === "broad_domain")
  ) {
    return "too_narrow";
  }

  // too_broad — target is parent of every other card and query is anchored or
  // exact-symbol; an overview is too coarse for a leaf-level question.
  if (
    reasons.includes("parent_vs_leaf") &&
    (query_intent === "exact_symbol" || query_intent === "file_anchored")
  ) {
    return "too_broad";
  }

  // adjacent — a sibling in the same parent dir is ranked higher (or has
  // strictly stronger coverage). Rank order is the primary signal because
  // the candidate-rank substrate already reflects fusion + lexical strength.
  const strongerSibling = others.find(
    (o) =>
      sameParentDir(o.source_path, target.source_path) &&
      o.source_path !== target.source_path &&
      o.rank < target.rank &&
      combined < 0.35 &&
      combinedCoverage(o) >= combined,
  );
  if (strongerSibling) {
    return "adjacent";
  }

  if (coverageVerdict === "partial") {
    return "partial";
  }

  // quick_start onboarding docs — broad "get started / install / first
  // steps" queries often have sparse lexical overlap with the canonical
  // quick-start page. When the doc is explicitly quick_start-shaped and the
  // query carries onboarding vocabulary, treat moderate coverage as enough
  // for `covers`.
  if (
    query_intent === "broad_domain" &&
    target.profile_signals?.doc_purpose === "quick_start" &&
    queryIsGettingStartedShape(target.query_tokens) &&
    combined >= 0.2 &&
    fusedAgreement >= 1 &&
    bestScore >= 0.25
  ) {
    return "covers";
  }

  // covers — strong combined coverage and at least one independent fusion path.
  if (combined >= 0.5 && fusedAgreement >= 1 && bestScore >= 0.3) {
    return "covers";
  }

  return "partial";
}

function combinedCoverage(card: SourceCard): number {
  const t = card.token_coverage;
  return Math.max(
    t.title_token_coverage,
    t.path_token_coverage,
    t.heading_token_coverage,
  );
}

function isChangelogPath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith("/changelog.md") ||
    lower.endsWith("changelog.md") ||
    lower.includes("/release-notes") ||
    lower.endsWith("/release.md")
  );
}

function isStrictAncestorPath(ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return false;
  const ancestorDir = stripExtension(ancestor);
  return descendant.startsWith(ancestorDir + "/");
}

function stripExtension(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  const lastDot = path.lastIndexOf(".");
  if (lastDot > lastSlash) return path.slice(0, lastDot);
  return path;
}

function pathDepth(path: string): number {
  return path.split("/").filter((p) => p.length > 0).length;
}

function sameParentDir(a: string, b: string): boolean {
  return parentDir(a) === parentDir(b);
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function dedupePreserveOrder<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const i of items) {
    if (!seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  }
  return out;
}

const GETTING_STARTED_VOCAB_STEM = /^(start|quick|instal|setup|begin|first|intro|hello)$/;

function queryIsGettingStartedShape(queryTokens: string[]): boolean {
  return queryTokens.some((token) => GETTING_STARTED_VOCAB_STEM.test(token));
}
