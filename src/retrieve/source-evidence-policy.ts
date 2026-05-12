/**
 * Source evidence policy.
 *
 * This is a deterministic comparator over compiled source evidence. It is
 * deliberately shadow-first: callers can ask "what would the deeper policy
 * pick?" without changing production source-rerank math.
 */
import type { AboutnessObservation } from "./aboutness.js";
import {
  compileSourceEvidenceSet,
  type SourceEvidence,
  type SourceEvidenceStrength,
} from "./source-evidence.js";
import type { SourceCard } from "./source-card.js";
import type { QueryIntent } from "./source-rerank.js";

export type SourceEvidencePolicySelected = {
  source_path: string;
  rank: number;
  evidence_rank: number[];
  aboutness_label: SourceEvidence["aboutness_label"];
  reason_codes: SourceEvidencePolicyReason[];
  evidence: SourceEvidence;
};

export type SourceEvidencePolicyDecision = {
  selected_sources: SourceEvidencePolicySelected[];
  fail_closed: boolean;
  top1_top2_margin: number;
  top1_top3_margin: number;
};

export const SOURCE_EVIDENCE_POLICY_REASONS = [
  "identity_direct",
  "identity_supporting",
  "role_direct",
  "relation_covers",
  "relation_partial",
  "structure_overview",
  "demoted_unsupported",
] as const;
export type SourceEvidencePolicyReason =
  (typeof SOURCE_EVIDENCE_POLICY_REASONS)[number];

export type DecideSourceEvidencePolicyArgs = {
  cards: SourceCard[];
  aboutness: AboutnessObservation[];
  query_intent: QueryIntent;
};

export function decideSourceEvidencePolicy(
  args: DecideSourceEvidencePolicyArgs,
): SourceEvidencePolicyDecision {
  const evidence = compileSourceEvidenceSet({
    cards: args.cards,
    aboutness: args.aboutness,
  });

  if (args.query_intent === "signal_empty") {
    const hasUsefulEvidence = evidence.some(
      (item) =>
        item.aboutness_label !== "unsupported" &&
        (item.identity_score > 0 || item.relation_score > 0),
    );
    if (!hasUsefulEvidence) return emptyFailClosed();
  }

  const selected = evidence
    .filter((item) => item.aboutness_label !== "unsupported")
    .map((item) => ({
      source_path: item.source_path,
      rank: item.rank,
      evidence_rank: evidenceRank(args.query_intent, item),
      aboutness_label: item.aboutness_label,
      reason_codes: reasonCodes(item),
      evidence: item,
    }))
    .filter((item) => hasPositiveEvidence(item.evidence));

  if (selected.length === 0) return emptyFailClosed();

  selected.sort((a, b) => compareEvidenceRank(a, b));

  return {
    selected_sources: selected,
    fail_closed: false,
    top1_top2_margin: rankMargin(selected[0], selected[1]),
    top1_top3_margin: rankMargin(selected[0], selected[2]),
  };
}

function evidenceRank(intent: QueryIntent, evidence: SourceEvidence): number[] {
  const relation = labelScore(evidence.aboutness_label);
  const identity = evidence.identity_score;
  const role = evidence.role_score;
  const structure = evidence.structure_score;
  const directIdentity = evidence.trusted_direct_identity ? 1 : 0;
  const overview = evidence.trusted_overview_shape ? 1 : 0;

  if (intent === "file_anchored" || intent === "exact_symbol") {
    return [directIdentity, identity, relation, role, structure, -evidence.rank];
  }
  if (intent === "broad_domain" || intent === "decision_lookup") {
    return [relation, overview, role, structure, identity, -evidence.rank];
  }
  return [relation, identity, role, structure, -evidence.rank];
}

function compareEvidenceRank(
  a: SourceEvidencePolicySelected,
  b: SourceEvidencePolicySelected,
): number {
  const max = Math.max(a.evidence_rank.length, b.evidence_rank.length);
  for (let index = 0; index < max; index += 1) {
    const av = a.evidence_rank[index] ?? 0;
    const bv = b.evidence_rank[index] ?? 0;
    if (av !== bv) return bv - av;
  }
  return a.source_path.localeCompare(b.source_path);
}

function rankMargin(
  top: SourceEvidencePolicySelected | undefined,
  next: SourceEvidencePolicySelected | undefined,
): number {
  if (!top || !next) return 0;
  const max = Math.max(top.evidence_rank.length, next.evidence_rank.length);
  for (let index = 0; index < max; index += 1) {
    const delta = (top.evidence_rank[index] ?? 0) - (next.evidence_rank[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function hasPositiveEvidence(evidence: SourceEvidence): boolean {
  return (
    evidence.identity_score > 0 ||
    evidence.role_score > 0 ||
    evidence.relation_score > 0 ||
    evidence.structure_score > 0
  );
}

function labelScore(label: SourceEvidence["aboutness_label"]): number {
  switch (label) {
    case "covers":
      return 4;
    case "partial":
      return 3;
    case "adjacent":
      return 2;
    case "too_broad":
    case "too_narrow":
      return 1;
    case "unsupported":
    case "unknown":
      return 0;
    default:
      return assertNever(label);
  }
}

function reasonCodes(evidence: SourceEvidence): SourceEvidencePolicyReason[] {
  const reasons: SourceEvidencePolicyReason[] = [];
  if (evidence.identity_strength === "direct") reasons.push("identity_direct");
  if (evidence.identity_strength === "supporting") {
    reasons.push("identity_supporting");
  }
  if (evidence.role_strength === "direct") reasons.push("role_direct");
  if (evidence.aboutness_label === "covers") reasons.push("relation_covers");
  if (evidence.aboutness_label === "partial") reasons.push("relation_partial");
  if (evidence.trusted_overview_shape) reasons.push("structure_overview");
  if (evidence.aboutness_label === "unsupported") reasons.push("demoted_unsupported");
  return reasons;
}

function emptyFailClosed(): SourceEvidencePolicyDecision {
  return {
    selected_sources: [],
    fail_closed: true,
    top1_top2_margin: 0,
    top1_top3_margin: 0,
  };
}

export function compareStrength(
  a: SourceEvidenceStrength,
  b: SourceEvidenceStrength,
): number {
  return strengthRank(a) - strengthRank(b);
}

function strengthRank(strength: SourceEvidenceStrength): number {
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

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
