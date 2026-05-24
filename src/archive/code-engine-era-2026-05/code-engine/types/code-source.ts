/**
 * CodeSourceFacts (PRD-0028 / slice 28.1).
 *
 * Deterministic per-file metadata extracted from a TypeScript/TSX source via
 * the TypeScript compiler API. Peer kind to SourceProfile in the index — code
 * files indexed alongside docs so retrieval can surface `.ts` files an
 * engineer must modify alongside the PRDs/ADRs they must read.
 *
 * Boundary: structural metadata only (paths + exported symbols + JSDoc
 * summary + signatures + imports). No code bodies.
 */

export const CODE_SOURCE_EXPORT_KINDS = [
  "function",
  "type",
  "interface",
  "class",
  "const",
  "enum",
] as const;
export type CodeSourceExportKind = (typeof CODE_SOURCE_EXPORT_KINDS)[number];

export type CodeSourceExportedSymbol = {
  name: string;
  kind: CodeSourceExportKind;
};

export const CODE_SOURCE_FILE_ROLES = [
  "implementation",
  "config",
  "build",
  "barrel",
  "entrypoint",
  "parser_formatter",
  "schema_type",
  "persistence_driver",
  "test_support",
  "helper",
] as const;
export type CodeSourceFileRole = (typeof CODE_SOURCE_FILE_ROLES)[number];

export type CodeSourceRoleFacts = {
  package_root: string | null;
  workspace_name: string | null;
  workspace_family_keys: string[];
  module_family_keys: string[];
  path_pattern_keys: string[];
  file_roles: CodeSourceFileRole[];
  role_tokens: string[];
  is_barrel: boolean;
  is_support_like: boolean;
};

export type CodeSourcePackageFacts = {
  package_root: string | null;
  package_name: string | null;
  manifest_path: string | null;
  internal_dependency_names: string[];
  internal_dependency_roots: string[];
  internal_dependent_names: string[];
  internal_dependent_roots: string[];
  script_names: string[];
  export_keys: string[];
};

export type CodeSourceCochangeRelatedPath = {
  source_path: string;
  count: number;
};

export type CodeSourceCochangeFacts = {
  related_paths: CodeSourceCochangeRelatedPath[];
};

export const CODE_SOURCE_SIGNATURE_CHAR_BUDGET = 240;
export const CODE_SOURCE_PURPOSE_CHAR_BUDGET = 480;

export type CodeSourceFacts = {
  file_path: string;
  exported_symbols: CodeSourceExportedSymbol[];
  exported_signatures: string[];
  file_purpose: string | null;
  imports: string[];
  role_facts?: CodeSourceRoleFacts;
  package_facts?: CodeSourcePackageFacts;
  cochange_facts?: CodeSourceCochangeFacts;
};

export const CODE_CHUNK_ROLES = [
  "orientation",
  "declaration",
] as const;
export type CodeChunkRole = (typeof CODE_CHUNK_ROLES)[number];

export const CODE_DECLARATION_KINDS = [
  "function",
  "type",
  "interface",
  "class",
  "const",
  "enum",
  "method",
  "property",
] as const;
export type CodeDeclarationKind = (typeof CODE_DECLARATION_KINDS)[number];

export type ExtractedCodeChunk = {
  source_path: string;
  stable_key: string;
  symbol_path: string | null;
  code_role: CodeChunkRole;
  declaration_kind: CodeDeclarationKind | null;
  exported: boolean;
  body: string;
  start_line: number;
  end_line: number;
};

export type CodeIndexArtifacts = {
  facts: CodeSourceFacts;
  chunks: ExtractedCodeChunk[];
};

export type StoredCodeChunk = ExtractedCodeChunk & {
  version_id: string;
  token_count: number;
  chunk_content_hash: string;
  source_content_hash: string;
  indexed_at: string;
  status: "current";
};

export type CodeFamilyEvidenceSummary = {
  families: string[];
  roles: string[];
  direct_query_tokens: string[];
  reasons: string[];
  score: number;
  first_slate_promotable: boolean;
  support_admissible: boolean;
};

export type CodeFacilityEvidenceSummary = {
  facility_tags: string[];
  query_intents: string[];
  direct_query_tokens: string[];
  shared_domain_tokens: string[];
  reasons: string[];
  score: number;
  support_admissible: boolean;
};

export const CODE_RETRIEVAL_CONFIDENCE_LEVELS = [
  "high",
  "medium",
  "low",
] as const;
export type CodeRetrievalConfidenceLevel =
  (typeof CODE_RETRIEVAL_CONFIDENCE_LEVELS)[number];

export type CodeRetrievalConfidence = {
  level: CodeRetrievalConfidenceLevel;
  score: number;
  reasons: string[];
  retry_recommended: boolean;
};

export type CodeSupportCluster = {
  role: "primary" | "support";
  seed_source_path: string;
  distance: number;
  reason:
    | "primary_winner"
    | "code_family_evidence"
    | "owner_fanout"
    | "package_dependency_fanout"
    | "role_family_fanout"
    | "symbol_reference_fanout"
    | "cochange_fanout"
    | "shared_support_import"
    | "support_config"
    | "support_substrate_bundle"
    | "outgoing_import"
    | "incoming_import"
    | "nearby_import"
    | "same_family_substrate";
  relevance: number;
  family_evidence?: CodeFamilyEvidenceSummary;
  facility_evidence?: CodeFacilityEvidenceSummary;
};
