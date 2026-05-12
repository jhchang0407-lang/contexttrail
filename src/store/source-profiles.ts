/**
 * SourceProfile persistence (PRD-0012 / Slice 2 v2 / THO-127).
 *
 * Profiles are rebuildable retrieval-index metadata. They are written by the
 * import/index path after chunks land, and read by retrieval and eval code
 * via getSourceProfile/listSourceProfiles. Deleting a profile cascades to its
 * aliases.
 */
import type { Db } from "./db.js";
import type {
  AliasConfidence,
  AliasKind,
  AliasOrigin,
  DocPurpose,
  HeadingOutlineEntry,
  PurposeSource,
  QuestionsAnsweredSource,
  SourceAlias,
  SourceProfile,
  SummarySource,
} from "../types/source-profile.js";
import type { DocRole, RoleSource } from "../types/chunk.js";
import type { HeadingAlias } from "../retrieve/heading-aliases.js";
import type { CodeFenceEntity } from "../retrieve/code-fence-entities.js";

const UPSERT_PROFILE_SQL = `
INSERT INTO source_profiles (
  source_path, source_content_hash, title, h1, intro, heading_outline,
  doc_role, role_source, doc_purpose, purpose_source,
  summary, summary_source, questions_answered, questions_answered_source,
  chunk_count, token_count, indexed_at,
  path_depth, is_index_file, is_section_landing, package_segment, version_segment,
  heading_aliases, code_fence_entities,
  nav_section_id, nav_position, nav_label, is_nav_landing, nav_origin, nav_provenance
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(source_path) DO UPDATE SET
  source_content_hash=excluded.source_content_hash,
  title=excluded.title,
  h1=excluded.h1,
  intro=excluded.intro,
  heading_outline=excluded.heading_outline,
  doc_role=excluded.doc_role,
  role_source=excluded.role_source,
  doc_purpose=excluded.doc_purpose,
  purpose_source=excluded.purpose_source,
  summary=excluded.summary,
  summary_source=excluded.summary_source,
  questions_answered=excluded.questions_answered,
  questions_answered_source=excluded.questions_answered_source,
  chunk_count=excluded.chunk_count,
  token_count=excluded.token_count,
  indexed_at=excluded.indexed_at,
  path_depth=excluded.path_depth,
  is_index_file=excluded.is_index_file,
  is_section_landing=excluded.is_section_landing,
  package_segment=excluded.package_segment,
  version_segment=excluded.version_segment,
  heading_aliases=excluded.heading_aliases,
  code_fence_entities=excluded.code_fence_entities,
  nav_section_id=excluded.nav_section_id,
  nav_position=excluded.nav_position,
  nav_label=excluded.nav_label,
  is_nav_landing=excluded.is_nav_landing,
  nav_origin=excluded.nav_origin,
  nav_provenance=excluded.nav_provenance
`;

const DELETE_ALIASES_SQL = `DELETE FROM source_aliases WHERE source_path = ?`;
const INSERT_ALIAS_SQL = `
INSERT OR REPLACE INTO source_aliases (
  source_path, alias_kind, alias_value, confidence, origin
) VALUES (?, ?, ?, ?, ?)
`;

export function upsertSourceProfile(db: Db, profile: SourceProfile): void {
  const tx = db.transaction(() => {
    db.prepare(UPSERT_PROFILE_SQL).run(
      profile.source_path,
      profile.source_content_hash,
      profile.title,
      profile.h1 ?? null,
      profile.intro ?? null,
      JSON.stringify(profile.heading_outline),
      profile.doc_role,
      profile.role_source,
      profile.doc_purpose,
      profile.purpose_source,
      profile.summary ?? null,
      profile.summary_source,
      JSON.stringify(profile.questions_answered),
      profile.questions_answered_source,
      profile.chunk_count,
      profile.token_count,
      profile.indexed_at,
      profile.path_depth ?? null,
      boolToInt(profile.is_index_file),
      boolToInt(profile.is_section_landing),
      profile.package_segment ?? null,
      profile.version_segment ?? null,
      profile.heading_aliases ? JSON.stringify(profile.heading_aliases) : null,
      profile.code_fence_entities
        ? JSON.stringify(profile.code_fence_entities)
        : null,
      profile.nav_section_id ?? null,
      profile.nav_position ?? null,
      profile.nav_label ?? null,
      boolToInt(profile.is_nav_landing),
      profile.nav_origin ?? null,
      profile.nav_provenance ?? null,
    );
    db.prepare(DELETE_ALIASES_SQL).run(profile.source_path);
    const insAlias = db.prepare(INSERT_ALIAS_SQL);
    for (const alias of profile.aliases) {
      insAlias.run(
        profile.source_path,
        alias.kind,
        alias.value,
        alias.confidence,
        alias.origin,
      );
    }
  });
  tx();
}

type ProfileRow = {
  source_path: string;
  source_content_hash: string;
  title: string;
  h1: string | null;
  intro: string | null;
  heading_outline: string;
  doc_role: string;
  role_source: string;
  doc_purpose: string;
  purpose_source: string;
  summary: string | null;
  summary_source: string;
  questions_answered: string;
  questions_answered_source: string;
  chunk_count: number;
  token_count: number;
  indexed_at: string;
  path_depth: number | null;
  is_index_file: number | null;
  is_section_landing: number | null;
  package_segment: string | null;
  version_segment: string | null;
  heading_aliases: string | null;
  code_fence_entities: string | null;
  nav_section_id: string | null;
  nav_position: number | null;
  nav_label: string | null;
  is_nav_landing: number | null;
  nav_origin: string | null;
  nav_provenance: string | null;
};

function boolToInt(value: boolean | undefined): number | null {
  if (value === undefined) return null;
  return value ? 1 : 0;
}

function intToBool(value: number | null): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  return value !== 0;
}

function rowToProfile(row: ProfileRow, aliases: SourceAlias[]): SourceProfile {
  return {
    source_path: row.source_path,
    source_content_hash: row.source_content_hash,
    title: row.title,
    h1: row.h1,
    intro: row.intro,
    heading_outline: JSON.parse(row.heading_outline) as HeadingOutlineEntry[],
    doc_role: row.doc_role as DocRole,
    role_source: row.role_source as RoleSource,
    doc_purpose: row.doc_purpose as DocPurpose,
    purpose_source: row.purpose_source as PurposeSource,
    summary: row.summary,
    summary_source: row.summary_source as SummarySource,
    questions_answered: JSON.parse(row.questions_answered) as string[],
    questions_answered_source:
      row.questions_answered_source as QuestionsAnsweredSource,
    chunk_count: row.chunk_count,
    token_count: row.token_count,
    indexed_at: row.indexed_at,
    aliases,
    path_depth: row.path_depth ?? undefined,
    is_index_file: intToBool(row.is_index_file),
    is_section_landing: intToBool(row.is_section_landing),
    package_segment: row.package_segment ?? undefined,
    version_segment: row.version_segment ?? undefined,
    heading_aliases: row.heading_aliases
      ? (JSON.parse(row.heading_aliases) as HeadingAlias[])
      : undefined,
    code_fence_entities: row.code_fence_entities
      ? (JSON.parse(row.code_fence_entities) as CodeFenceEntity[])
      : undefined,
    nav_section_id: row.nav_section_id ?? undefined,
    nav_position: row.nav_position ?? undefined,
    nav_label: row.nav_label ?? undefined,
    is_nav_landing: intToBool(row.is_nav_landing),
    nav_origin: (row.nav_origin as SourceProfile["nav_origin"]) ?? undefined,
    nav_provenance:
      (row.nav_provenance as SourceProfile["nav_provenance"]) ?? undefined,
  };
}

function loadAliases(db: Db, source_path: string): SourceAlias[] {
  const rows = db
    .prepare(
      `SELECT alias_kind, alias_value, confidence, origin
       FROM source_aliases WHERE source_path = ?
       ORDER BY alias_kind, alias_value`,
    )
    .all(source_path) as Array<{
      alias_kind: string;
      alias_value: string;
      confidence: string;
      origin: string;
    }>;
  return rows.map((r) => ({
    kind: r.alias_kind as AliasKind,
    value: r.alias_value,
    confidence: r.confidence as AliasConfidence,
    origin: r.origin as AliasOrigin,
  }));
}

export function getSourceProfile(
  db: Db,
  source_path: string,
): SourceProfile | null {
  const row = db
    .prepare("SELECT * FROM source_profiles WHERE source_path = ?")
    .get(source_path) as ProfileRow | undefined;
  if (!row) return null;
  const aliases = loadAliases(db, source_path);
  return rowToProfile(row, aliases);
}

export function listSourceProfiles(db: Db): SourceProfile[] {
  const rows = db
    .prepare("SELECT * FROM source_profiles ORDER BY source_path")
    .all() as ProfileRow[];
  return rows.map((r) => rowToProfile(r, loadAliases(db, r.source_path)));
}

export function deleteSourceProfile(db: Db, source_path: string): void {
  // Aliases cascade via foreign key; the explicit delete keeps behavior stable
  // for caches built before foreign_keys were enforced.
  const tx = db.transaction(() => {
    db.prepare(DELETE_ALIASES_SQL).run(source_path);
    db.prepare("DELETE FROM source_profiles WHERE source_path = ?").run(source_path);
  });
  tx();
}
