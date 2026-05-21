import type { CodeQueryFacet } from "./code-query-facets.js";

export type CodeCandidateEvidenceFamily =
  | "chunk_text"
  | "source_facts"
  | "exact_symbol"
  | "path_identity"
  | "query_facet"
  | "import_graph"
  | "code_family"
  | "repo_family"
  | "artifact_policy";

export type CodeCandidateEvidenceRole =
  | "owner"
  | "support"
  | "artifact_policy"
  | "anchor"
  | "shadow";

export type CodeCandidateEvidenceTarget =
  | "direct_owner"
  | "support_candidate"
  | "shadow_only"
  | "reject";

export type CodeCandidateEvidenceStrength =
  | "weak"
  | "medium"
  | "strong";

export type CodeCandidateEvidence = {
  source_path: string;
  family: CodeCandidateEvidenceFamily;
  role: CodeCandidateEvidenceRole;
  target: CodeCandidateEvidenceTarget;
  reason: string;
  strength?: CodeCandidateEvidenceStrength;
  channel_rank?: number;
  coverage?: number;
};

export type CodeCandidateEvidenceSummary = {
  source_path: string;
  evidence: CodeCandidateEvidence[];
  owner_families: CodeCandidateEvidenceFamily[];
  support_families: CodeCandidateEvidenceFamily[];
  shadow_families: CodeCandidateEvidenceFamily[];
  independent_owner_evidence_count: number;
  independent_support_evidence_count: number;
  has_exact_file_anchor: boolean;
  has_exact_symbol_anchor: boolean;
  passive_artifact: "none" | "rejected" | "explicit_intent" | "support_only";
};

export function codeQueryFacetEvidence(args: {
  source_path: string;
  facet: CodeQueryFacet;
}): CodeCandidateEvidence {
  const dotted = args.facet.reason === "dotted_identity";
  return {
    source_path: args.source_path,
    family: "query_facet",
    role: dotted ? "owner" : "shadow",
    target: dotted ? "direct_owner" : "shadow_only",
    reason: args.facet.reason,
    strength: dotted ? "medium" : "weak",
  };
}

export function summarizeCodeCandidateEvidence(
  evidence: CodeCandidateEvidence[],
): CodeCandidateEvidenceSummary[] {
  const byPath = new Map<string, CodeCandidateEvidence[]>();
  for (const item of evidence) {
    const current = byPath.get(item.source_path) ?? [];
    current.push(item);
    byPath.set(item.source_path, current);
  }

  return [...byPath.entries()]
    .map(([sourcePath, items]) => summarizeFileEvidence(sourcePath, items))
    .sort((a, b) => a.source_path.localeCompare(b.source_path));
}

function summarizeFileEvidence(
  sourcePath: string,
  evidence: CodeCandidateEvidence[],
): CodeCandidateEvidenceSummary {
  const ownerFamilies = distinctFamilies(evidence, "owner");
  const supportFamilies = distinctFamilies(evidence, "support");
  const shadowFamilies = distinctFamilies(evidence, "shadow");
  return {
    source_path: sourcePath,
    evidence,
    owner_families: ownerFamilies,
    support_families: supportFamilies,
    shadow_families: shadowFamilies,
    independent_owner_evidence_count: ownerFamilies.length,
    independent_support_evidence_count: supportFamilies.length,
    has_exact_file_anchor: evidence.some((item) => item.reason === "exact_file_anchor"),
    has_exact_symbol_anchor: evidence.some((item) =>
      item.reason === "exact_symbol_anchor" || item.family === "exact_symbol"
    ),
    passive_artifact: summarizePassiveArtifact(evidence),
  };
}

function distinctFamilies(
  evidence: CodeCandidateEvidence[],
  role: CodeCandidateEvidenceRole,
): CodeCandidateEvidenceFamily[] {
  return [
    ...new Set(
      evidence
        .filter((item) => item.role === role)
        .map((item) => item.family),
    ),
  ].sort();
}

function summarizePassiveArtifact(
  evidence: CodeCandidateEvidence[],
): CodeCandidateEvidenceSummary["passive_artifact"] {
  const artifact = evidence.find((item) => item.family === "artifact_policy");
  if (!artifact) return "none";
  if (artifact.reason === "explicit_artifact_intent") return "explicit_intent";
  if (artifact.reason === "support_only_artifact") return "support_only";
  return artifact.target === "reject" ? "rejected" : "none";
}
