import type { ChunkScope, ChunkScopeLayer } from "./chunk.js";

export const CARD_TYPES = ["constraint", "symbol_note", "evidence"] as const;
export type CardType = (typeof CARD_TYPES)[number];
export type CardProvenance =
  | "human_authored"
  | "imported_from_doc"
  | "system_derived";

/** Authority is orthogonal to freshness (ADR-0006). v1 cards land at `accepted`. */
export type CardAuthority = "accepted" | "candidate" | "deprecated";

/** Materialized by the indexer from (links.version_pin, current chunk version_ids, tombstones).
 *  Import may preserve authored `potentially_superseded` as an explicit stale-evidence signal. */
export const FRESHNESS_STATES = [
  "verified",
  "unverified",
  "needs_review",
  "maybe_affected",
  "potentially_superseded",
] as const;
export type FreshnessState = (typeof FRESHNESS_STATES)[number];

/** Manual review state on the Card. Flipped only by `contexttrail card verify` /
 *  `contexttrail card mark-needs-review`. Never overloaded onto freshness_state (ADR-0006). */
export const AUTHOR_REVIEW_STATES = [
  "unreviewed",
  "verified",
  "needs_review_manual",
] as const;
export type AuthorReviewState = (typeof AUTHOR_REVIEW_STATES)[number];

export const CARD_LINK_TYPES = ["evidences", "mentions", "covers"] as const;
export type CardLinkType = (typeof CARD_LINK_TYPES)[number];

/** Why freshness_state has its current value. Surfaced in `contexttrail explain`. */
export type FreshnessReason =
  | "all_links_current"
  | "no_links"
  | "version_drift"
  | "tombstoned_link";

/** Pinned at link-creation time so freshness rebuilds deterministically (D41). */
export type CardLink = {
  card_id: string;
  chunk_stable_key: string;
  /** version_id of the linked chunk at the moment the link was created. */
  version_pin: string;
  /** chunk_content_hash captured at link time, for redundant audit (cheap). */
  content_hash_pin: string;
  link_type: CardLinkType;
  linked_at: string;
};

export type CardSymbolAnchor = {
  card_id: string;
  /** Strict string identity (D39 / ADR-0011): case-sensitive, full chain. */
  symbol: string;
};

export type CardFileAnchor = {
  card_id: string;
  file_path: string;
};

type CardBase = {
  id: string;
  type: CardType;
  title: string;
  body: string;
  authority: CardAuthority;
  provenance: CardProvenance;
  authored_by: string;
  /** Cards carry the same scope shape as Doc Chunks so D38 hierarchical-down
   *  matching can compare like to like. */
  scope: ChunkScope;
  /** Strict-equality anchors for `symbol_note` D39 matching. Always present
   *  for symbol_notes; may be empty for constraint and evidence cards. */
  symbol_anchors: string[];
  /** File anchors mirror chunk file-anchors; informational for v1. */
  file_anchors: string[];
  /** Route anchors mirror chunk route-anchors for query-anchor scope inference. */
  route_anchors: string[];
  /** Author-declared links to Doc Chunks (D40). Never auto-derived. */
  links: CardLink[];
  freshness_state: FreshnessState;
  freshness_reason: FreshnessReason;
  author_review_state: AuthorReviewState;
  /** cl100k_base token count of the card body. Persisted on the cards row. */
  token_count: number;
  /** Path to the markdown source (relative to repo root). */
  source_path: string;
  source_hash: string;
  updated_at: string;
};

export type ConstraintCard = CardBase & {
  type: "constraint";
};

export type SymbolNoteCard = CardBase & {
  type: "symbol_note";
};

export type EvidenceCard = CardBase & {
  type: "evidence";
  command: string;
  covers: string[];
};

export type Card = ConstraintCard | SymbolNoteCard | EvidenceCard;

export const CARD_LAYER_ORDER: readonly ChunkScopeLayer[] = [
  "company",
  "team",
  "project",
  "module",
  "decision",
  "unknown",
];
