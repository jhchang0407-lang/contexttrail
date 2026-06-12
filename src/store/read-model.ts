import type { Db } from "./db.js";
import type { CodeAnchorConfidence, CodeAnchorKind, ChunkScope } from "../types/chunk.js";
import { getAnchorsForChunk } from "./anchors.js";
import { getCardById, listCards, listLinksForCard } from "./cards.js";
import { getChunkByVersionId, getChunksByStableKey, listCurrentChunks } from "./chunks.js";
import { listSources } from "./sources.js";
import { decodeChunkScope } from "./scope-codec.js";
import { matchAnchorValue } from "../anchor-match.js";
import {
  getAnchorsForChunkFromSubstrate,
  getCardByIdFromSubstrate,
  getChunkByVersionIdFromSubstrate,
  getChunkLookupByVersionIdFromSubstrate,
  getChunksByStableKeyFromSubstrate,
  listCardsFromSubstrate,
  listCurrentChunksFromSubstrate,
  listLinksForCardFromSubstrate,
  listSourcesFromSubstrate,
  type ChunkLookupFromSubstrate,
} from "./substrate-read.js";
import { hasSubstrateTables } from "./substrate-support.js";

export function readModelKind(db: Db): "substrate" | "flat" {
  return hasSubstrateTables(db) ? "substrate" : "flat";
}

export function listCurrentChunksCanonical(db: Db) {
  return readModelKind(db) === "substrate"
    ? listCurrentChunksFromSubstrate(db)
    : listCurrentChunks(db);
}

export function listCardsCanonical(db: Db) {
  return readModelKind(db) === "substrate"
    ? listCardsFromSubstrate(db)
    : listCards(db);
}

export function getAnchorsForChunkCanonical(db: Db, version_id: string) {
  return readModelKind(db) === "substrate"
    ? getAnchorsForChunkFromSubstrate(db, version_id)
    : getAnchorsForChunk(db, version_id);
}

export function getChunkByVersionIdCanonical(db: Db, version_id: string) {
  return readModelKind(db) === "substrate"
    ? getChunkByVersionIdFromSubstrate(db, version_id)
    : getChunkByVersionId(db, version_id);
}

export function getChunksByStableKeyCanonical(db: Db, stable_key: string) {
  return readModelKind(db) === "substrate"
    ? getChunksByStableKeyFromSubstrate(db, stable_key)
    : getChunksByStableKey(db, stable_key);
}

export function getCardByIdCanonical(db: Db, id: string) {
  return readModelKind(db) === "substrate"
    ? getCardByIdFromSubstrate(db, id)
    : getCardById(db, id);
}

export function listLinksForCardCanonical(db: Db, card_id: string) {
  return readModelKind(db) === "substrate"
    ? listLinksForCardFromSubstrate(db, card_id)
    : listLinksForCard(db, card_id);
}

export function listSourcesCanonical(db: Db) {
  return readModelKind(db) === "substrate"
    ? listSourcesFromSubstrate(db)
    : listSources(db);
}

export function getChunkLookupCanonical(
  db: Db,
  input: { version_id?: string; stable_key?: string },
): (ChunkLookupFromSubstrate & { freshness_state: string }) | null {
  if (readModelKind(db) === "substrate") {
    if (input.version_id) {
      return getChunkLookupByVersionIdFromSubstrate(db, input.version_id);
    }
    if (input.stable_key) {
      const versions = getChunksByStableKeyFromSubstrate(db, input.stable_key);
      const chunk = versions.find((c) => c.status === "current") ?? versions[0] ?? null;
      if (!chunk) return null;
      return {
        ...chunk,
        freshness_state: chunk.status === "current" ? "verified" : "unverified",
      };
    }
    return null;
  }

  if (input.version_id) {
    const chunk = getChunkByVersionId(db, input.version_id);
    return chunk
      ? {
          ...chunk,
          freshness_state: chunk.status === "current" ? "verified" : "unverified",
        }
      : null;
  }
  if (input.stable_key) {
    const versions = getChunksByStableKey(db, input.stable_key);
    const chunk = versions.find((c) => c.status === "current") ?? versions[0] ?? null;
    return chunk
      ? {
          ...chunk,
          freshness_state: chunk.status === "current" ? "verified" : "unverified",
        }
      : null;
  }
  return null;
}

export type CodeAnchorLookupContributor = {
  object_id: string;
  kind: "card" | "chunk";
  scope: ChunkScope;
  value: string;
  confidence: CodeAnchorConfidence;
  source_path?: string;
  match_source?: "code_anchor";
  match_kind?:
    | "exact"
    | "case_insensitive"
    | "symbol_form_variant"
    | "source_path_exact"
    | "source_path_suffix"
    | "source_basename"
    | "source_basename_without_extension";
};

type AnchorContributorRow = {
  object_id: string;
  kind: "card" | "chunk";
  scope_data: string | null;
  value: string;
  confidence: CodeAnchorConfidence;
  source_path: string | null;
};

export function lookupCodeAnchorContributorsCanonical(
  db: Db,
  anchor: { kind: CodeAnchorKind; value: string },
): CodeAnchorLookupContributor[] {
  return readModelKind(db) === "substrate"
    ? lookupCodeAnchorContributorsFromSubstrate(db, anchor)
    : lookupCodeAnchorContributorsFromFlat(db, anchor);
}

function lookupCodeAnchorContributorsFromFlat(
  db: Db,
  anchor: { kind: CodeAnchorKind; value: string },
): CodeAnchorLookupContributor[] {
  const chunkRows = db
    .prepare(
      `SELECT c.version_id AS object_id,
              'chunk' AS kind,
              c.scope_data AS scope_data,
              ca.value AS value,
              ca.confidence AS confidence,
              c.source_path AS source_path
         FROM code_anchors ca
         JOIN doc_chunks c ON c.version_id = ca.chunk_version_id
        WHERE ca.kind = ? AND c.status = 'current'`,
    )
    .all(anchor.kind) as AnchorContributorRow[];
  const cardRows = db
    .prepare(
      `SELECT c.id AS object_id,
              'card' AS kind,
              c.scope_data AS scope_data,
              ca.value AS value,
              'high' AS confidence,
              c.source_path AS source_path
         FROM card_anchors ca
         JOIN cards c ON c.id = ca.card_id
        WHERE ca.kind = ?
          AND c.authority != 'deprecated'
          AND c.freshness_state != 'potentially_superseded'`,
    )
    .all(anchor.kind) as AnchorContributorRow[];
  return filterAnchorRows(anchor, [...cardRows, ...chunkRows]);
}

function lookupCodeAnchorContributorsFromSubstrate(
  db: Db,
  anchor: { kind: CodeAnchorKind; value: string },
): CodeAnchorLookupContributor[] {
  const rows = db
    .prepare(
      `SELECT co.id AS object_id,
              CASE WHEN co.kind = 'card' THEN 'card' ELSE 'chunk' END AS kind,
              co.scope_data AS scope_data,
              ca.value AS value,
              ca.confidence AS confidence,
              co.source_uri AS source_path
         FROM code_anchors_v2 ca
         JOIN context_objects co ON co.id = ca.context_object_id
        WHERE ca.kind = ?
          AND (
            (co.kind = 'doc_chunk' AND co.status = 'current')
            OR
            (co.kind = 'card'
              AND co.authority != 'deprecated'
              AND co.freshness_state != 'potentially_superseded')
          )`,
    )
    .all(anchor.kind) as AnchorContributorRow[];
  return filterAnchorRows(anchor, rows);
}

function filterAnchorRows(
  anchor: { kind: CodeAnchorKind; value: string },
  rows: AnchorContributorRow[],
): CodeAnchorLookupContributor[] {
  const out: CodeAnchorLookupContributor[] = [];
  for (const row of rows) {
    const match =
      row.kind === "card"
        ? row.value === anchor.value
          ? { kind: "exact" as const, confidence: row.confidence }
          : null
        : matchAnchorValue(anchor, {
            kind: anchor.kind,
            value: row.value,
            confidence: row.confidence,
          });
    if (!match) continue;
    out.push(
      rowToAnchorContributor(
        // source_path is reported for id anchors only: the query compiler's
        // discrimination gate needs to count distinct sources per id binding.
        // Other kinds keep their existing (source_path-free) contributor
        // payloads byte-identical on the wire.
        { ...row, confidence: match.confidence, source_path: anchor.kind === "id" ? row.source_path : null },
        { match_source: "code_anchor", match_kind: match.kind },
      ),
    );
  }
  return out;
}

function rowToAnchorContributor(
  row: AnchorContributorRow,
  provenance?: Pick<CodeAnchorLookupContributor, "match_source" | "match_kind">,
): CodeAnchorLookupContributor {
  return {
    object_id: row.object_id,
    kind: row.kind,
    scope: decodeChunkScope(row.scope_data),
    value: row.value,
    confidence: row.confidence,
    ...(row.source_path ? { source_path: row.source_path } : {}),
    ...provenance,
  };
}
