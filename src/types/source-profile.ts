/**
 * SourceProfile (PRD-0012 / Slice 2 v2).
 *
 * Rebuildable retrieval-index metadata for one imported markdown source.
 * NOT a Context Object kind — final Context Packs continue to cite Doc Chunks
 * and Cards only. Profiles are deterministic; no index-time LLM calls.
 */
import type { DocRole, RoleSource } from "./chunk.js";
import type { HeadingAlias } from "../retrieve/heading-aliases.js";
import type { CodeFenceEntity } from "../retrieve/code-fence-entities.js";

export const DOC_PURPOSES = [
  "concept",
  "api_reference",
  "guide",
  "quick_start",
  "migration",
  "changelog",
  "release_note",
  "runbook",
  "adr",
  "prd",
  "readme",
  "package_readme",
  "example",
  "unknown",
] as const;
export type DocPurpose = (typeof DOC_PURPOSES)[number];

export type PurposeSource =
  | "frontmatter"
  | "config_pattern"
  | "path_rule"
  | "title_rule"
  | "content_rule"
  | "default";

export type AliasKind =
  | "path"
  | "title"
  | "heading"
  | "symbol"
  | "route"
  | "package"
  | "filename";

export type AliasConfidence = "high" | "medium" | "low";

export type AliasOrigin =
  | "frontmatter"
  | "title"
  | "h1"
  | "heading"
  | "path"
  | "filename"
  | "package_name"
  | "intro";

export type SourceAlias = {
  kind: AliasKind;
  value: string;
  confidence: AliasConfidence;
  origin: AliasOrigin;
};

export type HeadingOutlineEntry = {
  level: number;
  text: string;
  slug: string;
};

export type SummarySource = "deterministic_intro" | "frontmatter" | "empty";
export type QuestionsAnsweredSource = "heading_question_extraction" | "empty";

export type NavMetadataOrigin =
  | "frontmatter"
  | "readme_as_index"
  | "mkdocs"
  | "docusaurus_category"
  | "docusaurus_sidebar"
  | "vitepress";

export type NavMetadataProvenance =
  | "explicit_config"
  | "frontmatter"
  | "structural";

export type SourceProfile = {
  source_path: string;
  source_content_hash: string;
  title: string;
  h1: string | null;
  intro: string | null;
  heading_outline: HeadingOutlineEntry[];

  doc_role: DocRole;
  role_source: RoleSource;

  doc_purpose: DocPurpose;
  purpose_source: PurposeSource;

  aliases: SourceAlias[];

  summary: string | null;
  summary_source: SummarySource;

  questions_answered: string[];
  questions_answered_source: QuestionsAnsweredSource;

  chunk_count: number;
  token_count: number;
  indexed_at: string;

  /**
   * PRD-0023 / slice 23.2: import-time path-topology fields.
   *
   * All five are additive optional. They are populated by the
   * deterministic extractors in `src/retrieve/path-topology.ts` at
   * import time. Older persisted profiles that pre-date PRD-0023 may
   * not carry them; consumers must treat absence as "no signal" rather
   * than a hard failure.
   *
   * - `path_depth` — directory depth under the import root by path
   *   segments. Filename does not count.
   * - `is_index_file` — basename ∈ {index, readme, _index} ∧ extension
   *   ∈ {.md, .mdx, .markdown} (case-insensitive).
   * - `is_section_landing` — deterministic four-case rule over the
   *   corpus: parent `Foo.md` wins over `Foo/index.md`; bare children
   *   are not flagged.
   * - `package_segment` — captured `<name>` from `packages|apps|crates|sdk/<name>/`.
   * - `version_segment` — `vN`, `vN.x`, `N.x`, or one of
   *   {next, beta, latest, legacy, deprecated} on a directory segment.
   */
  path_depth?: number;
  is_index_file?: boolean;
  is_section_landing?: boolean;
  package_segment?: string | null;
  version_segment?: string | null;

  /**
   * PRD-0024 / slice 24.1.2: import-time heading aliases.
   *
   * Normalized search-form projection of `heading_outline`, populated
   * by `extractHeadingAliases` at import time. Source-rerank's
   * existing `heading_token_coverage` feature consumes these for
   * exact / suffix / token-normalized matches; the candidate
   * generation substrate consumes them alongside title and path
   * aliases.
   *
   * Additive optional — older profiles that pre-date PRD-0024 may
   * leave this undefined; consumers must treat absence as "no
   * heading evidence" rather than a hard failure.
   */
  heading_aliases?: HeadingAlias[];

  /**
   * PRD-0024 / slice 24.2.2: import-time code-fence entities.
   *
   * Structured projection of fenced code blocks (imports, package
   * names, config files / keys, CLI commands, exported symbols and
   * route literals) populated by `extractCodeFenceEntities` at import
   * time. Consumed by the existing alias substrate and source-rerank's
   * existing `alias_hit_count` and `owner_identity_score` features
   * for exact matches only.
   *
   * Additive optional — older profiles that pre-date PRD-0024 / 24.2
   * may leave this undefined; consumers must treat absence as "no
   * code-fence evidence" rather than a hard failure.
   */
  code_fence_entities?: CodeFenceEntity[];

  /**
   * PRD-0027 / slice 27.1.2: import-time nav-graph projection.
   *
   * Additive optional fields populated at import time by the
   * deterministic `parseNavConfig` walker (VitePress, Docusaurus,
   * MkDocs, frontmatter `sidebar_position`, README-as-section-index).
   * Consumed by source-rerank's existing alias substrate and
   * `overview_owner_score` features in slice 27.1.3 — no new
   * score-component coefficients enter `SourceRerankFeatures`.
   *
   * - `nav_section_id` — stable section key the doc belongs to
   *   (`"server"`, `"guide"`, etc.). Diagnostic-only in v1.
   * - `nav_position` — 1-indexed order within the section
   *   (1 = first / landing). Diagnostic-only in v1.
   * - `nav_label` — the label nav config uses for this doc, often
   *   more canonical than `title` (e.g. nav says `"Routers"` while
   *   the doc title is `"Defining Routers in tRPC"`). Feeds the
   *   alias set consumed by `alias_hit_count` and
   *   `owner_identity_score`.
   * - `is_nav_landing` — true iff this doc is the first of multiple
   *   entries in its section. Feeds `overview_owner_score`'s
   *   existing weighted sum.
   * - `nav_origin` / `nav_provenance` — explain and trust boundary.
   *   Rerank may consume explicit/frontmatter labels, but only
   *   explicit config landings affect overview-owner scoring.
   *
   * All fields are additive optional — older profiles that pre-date
   * PRD-0027 may leave them undefined; consumers must treat absence
   * as "no nav signal" rather than a hard failure.
   */
  nav_section_id?: string | null;
  nav_position?: number | null;
  nav_label?: string | null;
  is_nav_landing?: boolean;
  nav_origin?: NavMetadataOrigin | null;
  nav_provenance?: NavMetadataProvenance | null;
};
