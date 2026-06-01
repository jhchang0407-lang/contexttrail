/** v1 flat-schema DDL (weeks 1–2). Migrates to substrate at week 3. */
export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS indexed_doc_sources (
  source_path TEXT PRIMARY KEY,
  source_mtime_ms INTEGER NOT NULL,
  source_size INTEGER NOT NULL,
  source_content_hash TEXT NOT NULL,
  last_indexed_at TEXT NOT NULL,
  last_indexed_git_sha TEXT,
  chunk_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS source_extractions (
  source_path TEXT PRIMARY KEY,
  source_content_hash TEXT NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL,
  quality TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_source_extractions_status ON source_extractions(status);
CREATE INDEX IF NOT EXISTS idx_source_extractions_quality ON source_extractions(quality);

CREATE TABLE IF NOT EXISTS doc_chunks (
  version_id TEXT PRIMARY KEY,
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
  chunk_content_hash TEXT NOT NULL,
  source_content_hash TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  heading_slug TEXT,
  status TEXT NOT NULL,
  scope_layer TEXT,
  scope_data TEXT,
  doc_role TEXT NOT NULL DEFAULT 'canonical',
  role_source TEXT NOT NULL DEFAULT 'default',
  embedding BLOB,
  embedding_model TEXT,
  indexed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_status ON doc_chunks(status);
CREATE INDEX IF NOT EXISTS idx_chunks_stable_key ON doc_chunks(stable_key);
CREATE INDEX IF NOT EXISTS idx_chunks_source_path ON doc_chunks(source_path);
CREATE INDEX IF NOT EXISTS idx_chunks_scope_layer ON doc_chunks(scope_layer);
-- idx_chunks_doc_role is created in ensureAdditiveColumns after the column
-- itself is guaranteed to exist on upgraded caches.

CREATE TABLE IF NOT EXISTS code_anchors (
  chunk_version_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (chunk_version_id, kind, value),
  FOREIGN KEY (chunk_version_id) REFERENCES doc_chunks(version_id)
);

CREATE INDEX IF NOT EXISTS idx_code_anchors_value ON code_anchors(value);
CREATE INDEX IF NOT EXISTS idx_code_anchors_kind_value ON code_anchors(kind, value);

CREATE VIRTUAL TABLE IF NOT EXISTS doc_chunks_fts USING fts5(
  title, heading_path, body
);

-- Week 3 / Checkpoint 3a: Cards on the flat schema.
-- Substrate migration (3b) folds these into context_objects + card_ext + links.
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  authority TEXT NOT NULL,
  provenance TEXT NOT NULL DEFAULT 'human_authored',
  authored_by TEXT NOT NULL DEFAULT 'unknown',
  scope_layer TEXT,
  scope_data TEXT,
  command TEXT,
  covers TEXT,                                 -- JSON array of card ids (evidence -> covers)
  source_path TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  -- Materialized by the indexer (D41). Never written outside the indexer
  -- link-walk; manual review lives in author_review_state.
  freshness_state TEXT NOT NULL,
  freshness_reason TEXT NOT NULL,
  author_review_state TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cards_type ON cards(type);
CREATE INDEX IF NOT EXISTS idx_cards_authority ON cards(authority);
CREATE INDEX IF NOT EXISTS idx_cards_scope_layer ON cards(scope_layer);
CREATE INDEX IF NOT EXISTS idx_cards_freshness ON cards(freshness_state);

-- Strict-equality anchors for symbol_notes (D39, ADR-0011). One row per
-- (card, symbol) so multi-anchor declarations are explicit and queryable.
CREATE TABLE IF NOT EXISTS card_anchors (
  card_id TEXT NOT NULL,
  kind TEXT NOT NULL,                          -- 'symbol' | 'file' | 'route' (v1)
  value TEXT NOT NULL,
  PRIMARY KEY (card_id, kind, value),
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_card_anchors_value ON card_anchors(value);
CREATE INDEX IF NOT EXISTS idx_card_anchors_kind_value ON card_anchors(kind, value);

-- Author-declared Card -> Doc Chunk links (D40, ADR-0008). version_pin is
-- captured at link creation; the freshness materializer compares it against
-- the current version_id of the chunk with this stable_key.
CREATE TABLE IF NOT EXISTS card_links (
  card_id TEXT NOT NULL,
  chunk_stable_key TEXT NOT NULL,
  version_pin TEXT NOT NULL,
  content_hash_pin TEXT NOT NULL,
  link_type TEXT NOT NULL,                     -- 'evidences' | 'mentions' | 'covers'
  linked_at TEXT NOT NULL,
  PRIMARY KEY (card_id, chunk_stable_key, link_type),
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_card_links_card ON card_links(card_id);
CREATE INDEX IF NOT EXISTS idx_card_links_stable_key ON card_links(chunk_stable_key);
CREATE INDEX IF NOT EXISTS idx_card_links_version_pin ON card_links(version_pin);

-- FTS5 over Cards so non-locked Cards can compete in the global ranker
-- alongside Doc Chunks (D42).
CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
  title, body
);

-- PRD-0012 Slice 2 v2: deterministic SourceProfile metadata. Rebuildable
-- retrieval-index objects, NOT a Context Object kind. Final Context Packs
-- continue to cite Doc Chunks and Cards only.
CREATE TABLE IF NOT EXISTS source_profiles (
  source_path TEXT PRIMARY KEY,
  source_content_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  h1 TEXT,
  intro TEXT,
  heading_outline TEXT NOT NULL,
  doc_role TEXT NOT NULL,
  role_source TEXT NOT NULL,
  doc_purpose TEXT NOT NULL,
  purpose_source TEXT NOT NULL,
  summary TEXT,
  summary_source TEXT NOT NULL,
  questions_answered TEXT NOT NULL,
  questions_answered_source TEXT NOT NULL,
  chunk_count INTEGER NOT NULL,
  token_count INTEGER NOT NULL,
  indexed_at TEXT NOT NULL,
  path_depth INTEGER,
  is_index_file INTEGER,
  is_section_landing INTEGER,
  package_segment TEXT,
  version_segment TEXT,
  heading_aliases TEXT,
  code_fence_entities TEXT,
  nav_section_id TEXT,
  nav_position INTEGER,
  nav_label TEXT,
  is_nav_landing INTEGER,
  nav_origin TEXT,
  nav_provenance TEXT
);

CREATE INDEX IF NOT EXISTS idx_source_profiles_purpose ON source_profiles(doc_purpose);
CREATE INDEX IF NOT EXISTS idx_source_profiles_role ON source_profiles(doc_role);

CREATE TABLE IF NOT EXISTS source_aliases (
  source_path TEXT NOT NULL,
  alias_kind TEXT NOT NULL,
  alias_value TEXT NOT NULL,
  confidence TEXT NOT NULL,
  origin TEXT NOT NULL,
  PRIMARY KEY (source_path, alias_kind, alias_value),
  FOREIGN KEY (source_path) REFERENCES source_profiles(source_path) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_aliases_value ON source_aliases(alias_value);
CREATE INDEX IF NOT EXISTS idx_source_aliases_kind_value ON source_aliases(alias_kind, alias_value);

-- PRD-0028 / slice 28.2: code-source structural metadata. Peer kind to
-- source_profiles in the retrieval index; structural identity only (paths +
-- exported symbols + JSDoc summary + signatures + imports) — no code bodies.
-- Older caches without this table fall through the additive ensure path.
CREATE TABLE IF NOT EXISTS code_sources (
  source_path TEXT PRIMARY KEY,
  source_content_hash TEXT NOT NULL,
  exported_symbols TEXT NOT NULL,
  exported_signatures TEXT NOT NULL,
  file_purpose TEXT,
  imports TEXT NOT NULL,
  role_facts TEXT,
  package_facts TEXT,
  cochange_facts TEXT,
  indexed_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS code_sources_fts USING fts5(
  file_path, exported_symbols, file_purpose, exported_signatures
);

CREATE TABLE IF NOT EXISTS code_chunks (
  version_id TEXT PRIMARY KEY,
  stable_key TEXT NOT NULL,
  source_path TEXT NOT NULL,
  symbol_path TEXT,
  code_role TEXT NOT NULL,
  declaration_kind TEXT,
  exported INTEGER NOT NULL,
  body TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  chunk_content_hash TEXT NOT NULL,
  source_content_hash TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  indexed_at TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_code_chunks_source_path ON code_chunks(source_path);
CREATE INDEX IF NOT EXISTS idx_code_chunks_stable_key ON code_chunks(stable_key);
CREATE INDEX IF NOT EXISTS idx_code_chunks_symbol_path ON code_chunks(symbol_path);

CREATE VIRTUAL TABLE IF NOT EXISTS code_chunks_fts USING fts5(
  source_path, symbol_path, code_role, declaration_kind, body
);

CREATE TABLE IF NOT EXISTS code_graph_nodes (
  source_path TEXT PRIMARY KEY,
  indexed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS code_graph_edges (
  from_path TEXT NOT NULL,
  to_path TEXT NOT NULL,
  edge_kind TEXT NOT NULL,
  PRIMARY KEY (from_path, to_path, edge_kind)
);

CREATE INDEX IF NOT EXISTS idx_code_graph_edges_from ON code_graph_edges(from_path);
CREATE INDEX IF NOT EXISTS idx_code_graph_edges_to ON code_graph_edges(to_path);
`;
