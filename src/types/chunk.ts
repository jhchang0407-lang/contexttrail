export const CHUNK_SCOPE_LAYERS = [
  "company",
  "team",
  "project",
  "module",
  "decision",
  "unknown",
] as const;
export type ChunkScopeLayer = (typeof CHUNK_SCOPE_LAYERS)[number];

export type ChunkScopeSource = {
  frontmatter?: boolean;
  config_rule?: string;
  path_inference?: boolean;
  mention_extraction?: boolean;
};

export type ChunkScope = {
  layer: ChunkScopeLayer;
  company?: string;
  team?: string;
  project?: string;
  module?: string;
  feature?: string;
  domains?: string[];
  files?: string[];
  symbols?: string[];
  routes?: string[];
  source: ChunkScopeSource;
};

export type DocChunk = {
  // Identity
  stable_key: string;
  version_id: string;

  // Source
  source_path: string;
  doc_id: string;

  // Structure
  heading_path: string[];
  heading_level: number;
  chunk_index: number;       // 1-based, intra-section
  chunk_count: number;       // total parts within the section
  title: string;             // last heading

  // Content
  body: string;
  token_count: number;
  chunk_content_hash: string;

  // Anchors
  start_line: number;
  end_line: number;
  heading_slug?: string;

  // Lifecycle
  status: ChunkStatus;
  source_content_hash: string;
  indexed_at: string;

  // Scope
  scope: ChunkScope;

  // Role
  doc_role?: DocRole;
  role_source?: RoleSource;

  // Warnings (non-persisted, surfaced to caller)
  warnings?: string[];

  /**
   * PRD-0036 / 36.2 (B3): traceability for chunks produced by the chunker's
   * forced-split of an atomic block (list / code / table) exceeding
   * 2× max_tokens. `index` is 1-based; `total` matches across all parts.
   * Absent on chunks that were emitted whole.
   */
  split_part?: { index: number; total: number };
};

export const DOC_ROLES = ["canonical", "ideation", "example", "archive"] as const;
export type DocRole = (typeof DOC_ROLES)[number];
export type RoleSource = "frontmatter" | "config_pattern" | "default";

export const CHUNK_STATUSES = ["current", "tombstoned"] as const;
export type ChunkStatus = (typeof CHUNK_STATUSES)[number];

export type IndexedDocSource = {
  source_path: string;
  source_mtime_ms: number;
  source_size: number;
  source_content_hash: string;
  last_indexed_at: string;
  last_indexed_git_sha?: string;
  chunk_count: number;
};

export type CodeAnchorKind = "file" | "symbol" | "route" | "env_var" | "test";
export type CodeAnchorConfidence = "high" | "medium" | "low" | "ambiguous";
export type CodeAnchorSource =
  | "frontmatter"
  | "mention_extraction"
  | "manual"
  | "config_rule";

export type CodeAnchor = {
  chunk_version_id: string;
  kind: CodeAnchorKind;
  value: string;
  confidence: CodeAnchorConfidence;
  source: CodeAnchorSource;
};
