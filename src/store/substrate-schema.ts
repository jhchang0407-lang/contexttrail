/**
 * Substrate (post-migration) schema.
 *
 * The substrate is the canonical post-migration shape: every Context Object
 * (Doc Chunk + Card) lives in `context_objects` with type-specific fields in
 * `doc_chunk_ext` / `card_ext`. Code anchors and links are unified across
 * object kinds.
 *
 * The migration runs the flat → substrate transform in a single transaction,
 * gated by the round-trip + identical-pack invariants.
 *
 * Conservative design choice for v1: substrate tables co-exist with flat
 * tables after migration. Flat tables are kept for backward compatibility
 * and FTS support; retrieval prefers substrate when it is present, with the
 * flat path retained as a fallback for pre-migration caches.
 */
export const SUBSTRATE_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS context_objects (
  id TEXT PRIMARY KEY,                       -- version_id for chunks, card_id for cards
  kind TEXT NOT NULL,                        -- 'doc_chunk' | 'card'
  source_uri TEXT NOT NULL,                  -- file path, URL, or external identifier
  authority TEXT NOT NULL,                   -- 'accepted' | 'imported' | 'candidate' | 'deprecated'
  scope_layer TEXT,
  scope_data TEXT,                           -- JSON: full ChunkScope
  content_hash TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  freshness_state TEXT NOT NULL,
  freshness_reason TEXT NOT NULL,
  status TEXT NOT NULL,                      -- 'current' | 'tombstoned' (chunk only; cards are always current)
  indexed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_co_kind ON context_objects(kind);
CREATE INDEX IF NOT EXISTS idx_co_authority ON context_objects(authority);
CREATE INDEX IF NOT EXISTS idx_co_scope_layer ON context_objects(scope_layer);
CREATE INDEX IF NOT EXISTS idx_co_freshness ON context_objects(freshness_state);
CREATE INDEX IF NOT EXISTS idx_co_status ON context_objects(status);

CREATE TABLE IF NOT EXISTS doc_chunk_ext (
  context_object_id TEXT PRIMARY KEY,
  stable_key TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  heading_path TEXT NOT NULL,
  heading_level INTEGER,
  chunk_index INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  heading_slug TEXT,
  doc_role TEXT NOT NULL DEFAULT 'canonical',
  role_source TEXT NOT NULL DEFAULT 'default'
);

CREATE INDEX IF NOT EXISTS idx_dce_stable_key ON doc_chunk_ext(stable_key);
CREATE INDEX IF NOT EXISTS idx_dce_source_path ON doc_chunk_ext(source_path);
CREATE INDEX IF NOT EXISTS idx_dce_doc_id ON doc_chunk_ext(doc_id);

CREATE TABLE IF NOT EXISTS card_ext (
  context_object_id TEXT PRIMARY KEY,
  card_type TEXT NOT NULL,                   -- 'constraint' | 'symbol_note' | 'evidence'
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  provenance TEXT NOT NULL DEFAULT 'human_authored',
  authored_by TEXT NOT NULL DEFAULT 'unknown',
  command TEXT,
  covers TEXT,                               -- JSON array of card ids
  author_review_state TEXT NOT NULL DEFAULT 'unreviewed',
  token_count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ce_card_type ON card_ext(card_type);

-- Substrate code_anchors: generic over object kind. Distinct from the
-- chunk-only flat code_anchors table.
CREATE TABLE IF NOT EXISTS code_anchors_v2 (
  context_object_id TEXT NOT NULL,
  kind TEXT NOT NULL,                        -- 'file' | 'symbol' | 'route' | 'env_var' | 'test'
  value TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (context_object_id, kind, value)
);

CREATE INDEX IF NOT EXISTS idx_ca2_value ON code_anchors_v2(value);
CREATE INDEX IF NOT EXISTS idx_ca2_kind_value ON code_anchors_v2(kind, value);

-- Substrate links: typed edges between any two Context Objects. v1 link types:
--   'evidences' | 'mentions' | 'covers' | 'supersedes'.
-- Card → Chunk links carry version_pin captured at link creation (ADR-0008).
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_kind TEXT NOT NULL,                   -- 'doc_chunk' | 'card'
  from_id TEXT NOT NULL,
  to_kind TEXT NOT NULL,
  to_id TEXT NOT NULL,                       -- for Card→Chunk: chunk_stable_key (resolved against current version)
  link_type TEXT NOT NULL,
  version_pin TEXT,                          -- captures target version at link time
  content_hash_pin TEXT,
  source TEXT NOT NULL DEFAULT 'manual',     -- 'manual' | 'frontmatter' | 'mention_extraction'
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_kind, from_id);
CREATE INDEX IF NOT EXISTS idx_links_to ON links(to_kind, to_id);
CREATE INDEX IF NOT EXISTS idx_links_type ON links(link_type);
`;
