/**
 * Substrate migration.
 *
 * One-shot, deterministic, single-transaction transform from flat schema
 * (`doc_chunks` + `cards` + `card_anchors` + `card_links` + `code_anchors`)
 * to substrate (`context_objects` + `doc_chunk_ext` + `card_ext` + `links`
 * + `code_anchors_v2`).
 *
 * Two invariants gate the migration before it touches real data:
 *   1. Round-trip:     every (content, stable_key, scope, code_anchors,
 *                      version_id) tuple byte-identical pre/post
 *                      every Card body + frontmatter + links + version_pin
 *                      preserved
 *   2. Identical-pack: predefined query set returns byte-identical Pack
 *                      output (rendered text + JSON) pre/post on the
 *                      frozen fixture corpus
 *
 * The script refuses to run unless `force: true` (gate intentionally bypassed
 * for the fixture round-trip itself) OR `gate_passed: true` is supplied by
 * the caller after running the invariant tests on the fixture.
 *
 * Failure inside the transaction rolls back; the cache is untouched.
 */
import type { Db } from "./db.js";
import { SUBSTRATE_SCHEMA_DDL } from "./substrate-schema.js";

export type MigrationReport = {
  context_objects_written: number;
  doc_chunk_ext_written: number;
  card_ext_written: number;
  code_anchors_v2_written: number;
  links_written: number;
};

export type MigrateOptions = {
  /** When true, skip the gate check. Used by the fixture round-trip test. */
  force?: boolean;
  /** Caller-supplied promise that the round-trip + identical-pack invariants
   *  passed on the frozen fixture corpus. The migration script refuses to
   *  run against real data unless this is true. */
  gate_passed?: boolean;
};

export class MigrationGateError extends Error {}

export function migrateFlatToSubstrate(
  db: Db,
  opts: MigrateOptions = {},
): MigrationReport {
  if (!opts.force && !opts.gate_passed) {
    throw new MigrationGateError(
      "migrateFlatToSubstrate refused: ADR-0009 gate not satisfied. " +
        "Run the round-trip + identical-pack invariant tests on the frozen " +
        "fixture corpus and pass { gate_passed: true }.",
    );
  }

  // Apply substrate DDL idempotently.
  db.exec(SUBSTRATE_SCHEMA_DDL);

  const report: MigrationReport = {
    context_objects_written: 0,
    doc_chunk_ext_written: 0,
    card_ext_written: 0,
    code_anchors_v2_written: 0,
    links_written: 0,
  };

  const tx = db.transaction(() => {
    // 1. Doc chunks → context_objects + doc_chunk_ext
    const insertCO = db.prepare(`
      INSERT OR REPLACE INTO context_objects (
        id, kind, source_uri, authority, scope_layer, scope_data,
        content_hash, source_hash, freshness_state, freshness_reason,
        status, indexed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertDCE = db.prepare(`
      INSERT OR REPLACE INTO doc_chunk_ext (
        context_object_id, stable_key, doc_id, source_path, heading_path,
        heading_level, chunk_index, chunk_count, title, body, token_count,
        start_line, end_line, heading_slug
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const chunkRows = db
      .prepare(
        `SELECT version_id, stable_key, doc_id, source_path, heading_path,
                heading_level, chunk_index, chunk_count, title, body,
                token_count, chunk_content_hash, source_content_hash,
                start_line, end_line, heading_slug, status, scope_layer,
                scope_data, indexed_at
         FROM doc_chunks`,
      )
      .all() as Array<{
        version_id: string;
        stable_key: string;
        doc_id: string;
        source_path: string;
        heading_path: string;
        heading_level: number | null;
        chunk_index: number;
        chunk_count: number;
        title: string;
        body: string;
        token_count: number;
        chunk_content_hash: string;
        source_content_hash: string;
        start_line: number | null;
        end_line: number | null;
        heading_slug: string | null;
        status: string;
        scope_layer: string | null;
        scope_data: string | null;
        indexed_at: string;
      }>;

    for (const r of chunkRows) {
      insertCO.run(
        r.version_id,
        "doc_chunk",
        r.source_path,
        "imported",
        r.scope_layer,
        r.scope_data,
        r.chunk_content_hash,
        r.source_content_hash,
        // Doc Chunks default to 'verified' freshness; the materialized
        // freshness rule applies to Cards only.
        "verified",
        "no_links",
        r.status,
        r.indexed_at,
        r.indexed_at,
      );
      insertDCE.run(
        r.version_id,
        r.stable_key,
        r.doc_id,
        r.source_path,
        r.heading_path,
        r.heading_level,
        r.chunk_index,
        r.chunk_count,
        r.title,
        r.body,
        r.token_count,
        r.start_line,
        r.end_line,
        r.heading_slug,
      );
      report.context_objects_written++;
      report.doc_chunk_ext_written++;
    }

    // 2. Cards → context_objects + card_ext
    const insertCE = db.prepare(`
      INSERT OR REPLACE INTO card_ext (
        context_object_id, card_type, title, body, provenance, authored_by, command, covers,
        author_review_state, token_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const cardRows = db
      .prepare(
        `SELECT id, type, title, body, authority, scope_layer, scope_data,
                provenance, authored_by, command, covers, source_path, source_hash,
                freshness_state, freshness_reason, author_review_state,
                token_count, updated_at
         FROM cards`,
      )
      .all() as Array<{
        id: string;
        type: string;
        title: string;
        body: string;
        authority: string;
        scope_layer: string | null;
        scope_data: string | null;
        provenance: string;
        authored_by: string;
        command: string | null;
        covers: string | null;
        source_path: string;
        source_hash: string;
        freshness_state: string;
        freshness_reason: string;
        author_review_state: string;
        token_count: number;
        updated_at: string;
      }>;

    for (const r of cardRows) {
      insertCO.run(
        r.id,
        "card",
        r.source_path,
        r.authority,
        r.scope_layer,
        r.scope_data,
        // Cards have no chunk_content_hash; reuse source_hash for both.
        r.source_hash,
        r.source_hash,
        r.freshness_state,
        r.freshness_reason,
        "current",
        r.updated_at,
        r.updated_at,
      );
      insertCE.run(
        r.id,
        r.type,
        r.title,
        r.body,
        r.provenance,
        r.authored_by,
        r.command,
        r.covers,
        r.author_review_state,
        r.token_count,
      );
      report.context_objects_written++;
      report.card_ext_written++;
    }

    // 3. Anchors. Both chunk anchors (code_anchors) and card anchors
    // (card_anchors) collapse into the unified code_anchors_v2 table.
    const insertCA2 = db.prepare(`
      INSERT OR REPLACE INTO code_anchors_v2
        (context_object_id, kind, value, confidence, source)
      VALUES (?, ?, ?, ?, ?)
    `);
    const chunkAnchors = db
      .prepare(
        "SELECT chunk_version_id, kind, value, confidence, source FROM code_anchors",
      )
      .all() as Array<{
        chunk_version_id: string;
        kind: string;
        value: string;
        confidence: string;
        source: string;
      }>;
    for (const a of chunkAnchors) {
      insertCA2.run(a.chunk_version_id, a.kind, a.value, a.confidence, a.source);
      report.code_anchors_v2_written++;
    }
    const cardAnchors = db
      .prepare("SELECT card_id, kind, value FROM card_anchors")
      .all() as Array<{ card_id: string; kind: string; value: string }>;
    for (const a of cardAnchors) {
      // Card anchors carry no confidence/source in the flat schema;
      // synthesize 'high' / 'frontmatter' for substrate symmetry.
      insertCA2.run(a.card_id, a.kind, a.value, "high", "frontmatter");
      report.code_anchors_v2_written++;
    }

    // 4. Card links → unified links table.
    const insertLink = db.prepare(`
      INSERT INTO links (
        from_kind, from_id, to_kind, to_id, link_type,
        version_pin, content_hash_pin, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // Wipe any prior migration's link rows so re-runs are idempotent.
    db.prepare("DELETE FROM links").run();
    const cardLinks = db
      .prepare(
        `SELECT card_id, chunk_stable_key, version_pin, content_hash_pin,
                link_type, linked_at FROM card_links`,
      )
      .all() as Array<{
        card_id: string;
        chunk_stable_key: string;
        version_pin: string;
        content_hash_pin: string;
        link_type: string;
        linked_at: string;
      }>;
    for (const l of cardLinks) {
      insertLink.run(
        "card",
        l.card_id,
        "doc_chunk",
        l.chunk_stable_key,
        l.link_type,
        l.version_pin,
        l.content_hash_pin,
        "frontmatter",
        l.linked_at,
      );
      report.links_written++;
    }
  });

  tx();
  return report;
}
