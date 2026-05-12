import type {
  AuthorReviewState,
  Card,
  CardLink,
  FreshnessReason,
  FreshnessState,
} from "../types/card.js";
import type { ChunkScope, DocChunk } from "../types/chunk.js";
import { decodeChunkScope } from "./scope-codec.js";

export type StoredCardRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  authority: string;
  provenance: string;
  authored_by: string;
  scope_data: string | null;
  command: string | null;
  covers: string | null;
  source_path: string;
  source_hash: string;
  freshness_state: string;
  freshness_reason: string;
  author_review_state: string;
  token_count: number;
  updated_at: string;
};

export type StoredChunkRow = {
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
  doc_role: string;
  role_source: string;
  status: string;
  scope_data: string | null;
  indexed_at: string;
};

export type StoredCardAnchorRow = {
  kind: "symbol" | "file" | "route";
  value: string;
};

export function rowToCard(row: StoredCardRow): Card {
  const scope = decodeChunkScope(row.scope_data);
  const base = {
    id: row.id,
    title: row.title,
    body: row.body,
    authority: row.authority as Card["authority"],
    provenance: (row.provenance || "human_authored") as Card["provenance"],
    authored_by: row.authored_by || "unknown",
    scope,
    symbol_anchors: [],
    file_anchors: [],
    route_anchors: [],
    links: [],
    freshness_state: row.freshness_state as FreshnessState,
    freshness_reason: row.freshness_reason as FreshnessReason,
    author_review_state: row.author_review_state as AuthorReviewState,
    token_count: row.token_count,
    source_path: row.source_path,
    source_hash: row.source_hash,
    updated_at: row.updated_at,
  };
  if (row.type === "evidence") {
    return {
      ...base,
      type: "evidence",
      command: row.command ?? "",
      covers: row.covers ? (JSON.parse(row.covers) as string[]) : [],
    };
  }
  if (row.type === "symbol_note") {
    return {
      ...base,
      type: "symbol_note",
    };
  }
  return {
    ...base,
    type: "constraint",
  };
}

export function withCardRelations(
  card: Card,
  anchors: StoredCardAnchorRow[],
  links: CardLink[],
): Card {
  return {
    ...card,
    symbol_anchors: anchors.filter((a) => a.kind === "symbol").map((a) => a.value),
    file_anchors: anchors.filter((a) => a.kind === "file").map((a) => a.value),
    route_anchors: anchors.filter((a) => a.kind === "route").map((a) => a.value),
    links,
  } as Card;
}

export function rowToChunk(row: StoredChunkRow): DocChunk {
  const scope: ChunkScope = decodeChunkScope(row.scope_data);
  return {
    version_id: row.version_id,
    stable_key: row.stable_key,
    doc_id: row.doc_id,
    source_path: row.source_path,
    heading_path: JSON.parse(row.heading_path) as string[],
    heading_level: row.heading_level ?? 0,
    chunk_index: row.chunk_index,
    chunk_count: row.chunk_count,
    title: row.title,
    body: row.body,
    token_count: row.token_count,
    chunk_content_hash: row.chunk_content_hash,
    source_content_hash: row.source_content_hash,
    start_line: row.start_line ?? 0,
    end_line: row.end_line ?? 0,
    heading_slug: row.heading_slug ?? undefined,
    doc_role: row.doc_role as DocChunk["doc_role"],
    role_source: row.role_source as DocChunk["role_source"],
    status: row.status as DocChunk["status"],
    indexed_at: row.indexed_at,
    scope,
  };
}
