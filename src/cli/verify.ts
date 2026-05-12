import { join } from "node:path";
import { readFileSync } from "node:fs";
import matter from "gray-matter";
import { openDb, closeDb } from "../store/db.js";
import { buildFreshnessLookups, computeFreshness } from "../cards/freshness.js";
import { freshnessMatchesCanonical } from "../cards/freshness-policy.js";
import { listAllLinks } from "../store/cards.js";
import type { CardLink, FreshnessReason, FreshnessState } from "../types/card.js";
import { loadConfig } from "../config/load.js";
import { resolveDocRole } from "../scope/doc-role.js";

export type VerifyFailure = {
  kind:
    | "orphan_link"
    | "empty_stable_key"
    | "stale_freshness_state"
    | "missing_version_pin"
    | "unknown_version_pin"
    | "orphan_code_anchor"
    | "stale_doc_role";
  message: string;
  detail?: Record<string, unknown>;
};

export type VerifyReport = {
  ok: boolean;
  failures: VerifyFailure[];
  checked: {
    doc_role_sources: number;
  };
};

/**
 * `contexttrail verify` — integrity check over the cache. Asserts:
 *   - no orphan card_links (chunk_stable_key with no chunk row)
 *   - no doc_chunks with empty stable_key
 *   - no cards whose materialized freshness_state disagrees with the canonical
 *     rule (links + version_ids + tombstones)
 *   - no card_links with empty version_pin
 *   - no card_links whose version_pin doesn't appear on any chunk row
 *   - no orphan code_anchors (chunk_version_id with no chunk row)
 *
 * Exits non-zero (caller's responsibility) when any failure surfaces.
 */
export function runVerify(cwd: string): VerifyReport {
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  const config = loadConfig(cwd);
  const failures: VerifyFailure[] = [];
  const checked = {
    doc_role_sources: 0,
  };
  try {
    // 1. orphan card_links
    const orphans = db
      .prepare(
        `SELECT cl.card_id, cl.chunk_stable_key
         FROM card_links cl
         LEFT JOIN doc_chunks c ON c.stable_key = cl.chunk_stable_key
         WHERE c.stable_key IS NULL`,
      )
      .all() as { card_id: string; chunk_stable_key: string }[];
    for (const o of orphans) {
      failures.push({
        kind: "orphan_link",
        message: `Card ${o.card_id} links to unknown stable_key ${o.chunk_stable_key}`,
        detail: o,
      });
    }

    // 2. empty stable_key
    const emptySK = db
      .prepare("SELECT version_id FROM doc_chunks WHERE stable_key = ''")
      .all() as { version_id: string }[];
    for (const r of emptySK) {
      failures.push({
        kind: "empty_stable_key",
        message: `doc_chunk ${r.version_id} has empty stable_key`,
        detail: r,
      });
    }

    // 3. stale freshness_state
    const cardRows = db
      .prepare(
        "SELECT id, freshness_state, freshness_reason FROM cards",
      )
      .all() as { id: string; freshness_state: string; freshness_reason: string }[];
    if (cardRows.length > 0) {
      const allLinks = listAllLinks(db);
      const linksByCard = new Map<string, CardLink[]>();
      for (const l of allLinks) {
        const arr = linksByCard.get(l.card_id) ?? [];
        arr.push(l);
        linksByCard.set(l.card_id, arr);
      }
      const { currentByStableKey, knownStableKeys } = buildFreshnessLookups(db);
      for (const c of cardRows) {
        const r = computeFreshness(
          linksByCard.get(c.id) ?? [],
          currentByStableKey,
          knownStableKeys,
        );
        const stored = {
          state: c.freshness_state as FreshnessState,
          reason: c.freshness_reason as FreshnessReason,
        };
        if (!freshnessMatchesCanonical(stored, r)) {
          failures.push({
            kind: "stale_freshness_state",
            message: `Card ${c.id} freshness_state=${c.freshness_state}/${c.freshness_reason} disagrees with canonical rule (${r.state}/${r.reason})`,
            detail: {
              card_id: c.id,
              stored_state: c.freshness_state,
              stored_reason: c.freshness_reason,
              canonical_state: r.state,
              canonical_reason: r.reason,
            },
          });
        }
      }
    }

    // 4. missing/unknown version_pin
    const linkRows = db
      .prepare(
        "SELECT card_id, chunk_stable_key, version_pin FROM card_links",
      )
      .all() as { card_id: string; chunk_stable_key: string; version_pin: string }[];
    const allVersions = new Set(
      (
        db
          .prepare("SELECT version_id FROM doc_chunks")
          .all() as { version_id: string }[]
      ).map((r) => r.version_id),
    );
    for (const l of linkRows) {
      if (!l.version_pin || l.version_pin.trim() === "") {
        failures.push({
          kind: "missing_version_pin",
          message: `Link ${l.card_id} -> ${l.chunk_stable_key} has empty version_pin`,
          detail: l,
        });
        continue;
      }
      if (!allVersions.has(l.version_pin)) {
        failures.push({
          kind: "unknown_version_pin",
          message: `Link ${l.card_id} -> ${l.chunk_stable_key} pinned to version_pin=${l.version_pin} which doesn't exist on any chunk row`,
          detail: l,
        });
      }
    }

    // 5. orphan code_anchors
    const orphanAnchors = db
      .prepare(
        `SELECT ca.chunk_version_id, ca.kind, ca.value
         FROM code_anchors ca
         LEFT JOIN doc_chunks c ON c.version_id = ca.chunk_version_id
         WHERE c.version_id IS NULL`,
      )
      .all() as { chunk_version_id: string; kind: string; value: string }[];
    for (const a of orphanAnchors) {
      failures.push({
        kind: "orphan_code_anchor",
        message: `code_anchor ${a.kind}=${a.value} references unknown chunk_version_id ${a.chunk_version_id}`,
        detail: a,
      });
    }

    // 6. doc_role activation/backfill. PRD-0005 added doc_role/role_source
    // columns additively, so upgraded repos can have schema-present rows that
    // still carry stale canonical/default values until import backfills them.
    const docRoleRows = db
      .prepare(
        `SELECT DISTINCT source_path, doc_role, role_source
         FROM doc_chunks
         WHERE status='current'`,
      )
      .all() as { source_path: string; doc_role: string; role_source: string }[];
    checked.doc_role_sources = docRoleRows.length;
    for (const row of docRoleRows) {
      const expected = expectedDocRole(cwd, row.source_path, config);
      if (!expected) continue;
      if (row.doc_role !== expected.doc_role || row.role_source !== expected.role_source) {
        failures.push({
          kind: "stale_doc_role",
          message:
            `${row.source_path} has doc_role=${row.doc_role}/${row.role_source}, ` +
            `expected ${expected.doc_role}/${expected.role_source}; run ` +
            "`contexttrail import <your docs glob>` to activate PRD-0005 role backfill.",
          detail: {
            source_path: row.source_path,
            stored_doc_role: row.doc_role,
            stored_role_source: row.role_source,
            expected_doc_role: expected.doc_role,
            expected_role_source: expected.role_source,
          },
        });
      }
    }
  } finally {
    closeDb(db);
  }
  return { ok: failures.length === 0, failures, checked };
}

function expectedDocRole(
  cwd: string,
  sourcePath: string,
  config: ReturnType<typeof loadConfig>,
): ReturnType<typeof resolveDocRole> | null {
  try {
    const raw = readFileSync(join(cwd, sourcePath), "utf8");
    const frontmatter = matter(raw).data as Record<string, unknown>;
    return resolveDocRole({ source_path: sourcePath, frontmatter, config });
  } catch {
    return null;
  }
}
