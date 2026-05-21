import type { CodeQueryFacet } from "./code-query-facets.js";
import type { CodeCandidateEvidenceSummary } from "./code-candidate-evidence.js";
import type { QueryAnchors } from "./score.js";

export type CodeMethodAdmissionDecision =
  | "direct_owner"
  | "support_candidate"
  | "shadow_only"
  | "reject";

export type CodeMethodAdmissionReason =
  | "dotted_identity"
  | "explicit_anchor"
  | "independent_evidence"
  | "needs_independent_evidence";

export type CodeMethodAdmission = {
  decision: CodeMethodAdmissionDecision;
  reason: CodeMethodAdmissionReason;
};

export type AdmitCodeQueryFacetArgs = {
  facet: CodeQueryFacet;
  query_anchors?: QueryAnchors;
  query_intent?: string;
  candidate_evidence?: CodeCandidateEvidenceSummary;
  independent_evidence_count?: number;
};

const NON_DOTTED_FACET_PROMOTION_EVIDENCE_FLOOR = 2;

export function admitCodeQueryFacet(
  args: AdmitCodeQueryFacetArgs,
): CodeMethodAdmission {
  if (hasExplicitCodeOwnerAnchor(args)) {
    return { decision: "reject", reason: "explicit_anchor" };
  }

  if (args.facet.reason === "dotted_identity") {
    return { decision: "direct_owner", reason: "dotted_identity" };
  }

  if (independentOwnerEvidenceCount(args) >= NON_DOTTED_FACET_PROMOTION_EVIDENCE_FLOOR) {
    return { decision: "direct_owner", reason: "independent_evidence" };
  }

  return {
    decision: "shadow_only",
    reason: "needs_independent_evidence",
  };
}

function independentOwnerEvidenceCount(args: AdmitCodeQueryFacetArgs): number {
  return args.candidate_evidence?.independent_owner_evidence_count ??
    args.independent_evidence_count ??
    0;
}

function hasExplicitCodeOwnerAnchor(args: AdmitCodeQueryFacetArgs): boolean {
  return (
    (args.query_anchors?.files?.length ?? 0) > 0 ||
    (args.query_anchors?.symbols?.length ?? 0) > 0
  );
}
