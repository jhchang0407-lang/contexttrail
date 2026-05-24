# ContextTrail — Schemas and On-Disk Layout

> **v1 ships in two phases.** Weeks 1–2 use a simple flat schema (`doc_chunks` + `indexed_doc_sources`) — only one object kind exists, so the substrate's `context_objects` indirection would be premature abstraction. Week 3 migrates to the [substrate model](ARCHITECTURE.md) when cards land — that's when unification across two object kinds (`doc_chunk` + `card`) actually pays off.
>
> Both schemas are documented below. The flat schema is the **week 1–2 implementation target**; the substrate is the **week 3 migration target** and the long-term forward-compatible base.

## On-disk layout (v1)

```
.contexttrail/
  cards/
    C001-refund-audit-logging.md
    S001-refundservice-idempotency.md
    E001-refund-cancel-test.md
  config.yaml
  cache/
    contexttrail.db                       # gitignored — rebuildable
```

**Doc sources are not copied into `.contexttrail/`.** They stay in their original locations (`docs/**`, `**/README.md`, etc.). The `contexttrail import` command parses them and stores chunks in `cache/contexttrail.db`. Source files remain the truth; the cache is rebuildable from them via `contexttrail index`.

**v1 simplification:** all cards in a single `cards/` directory. Folder taxonomy by type comes later.

### `.gitignore`

```
.contexttrail/cache/
.contexttrail/local/
```

## Card file format

Markdown with YAML frontmatter. One card per file. Filename: `<id>-<kebab-title>.md`.

### Minimal v1 schema

```md
---
id: C001
type: constraint # constraint | symbol_note | evidence
title: Refunds require audit logging
authority: accepted # accepted | candidate | deprecated  (the trust axis; orthogonal to freshness)
symbols:
  - RefundService.processRefund
files:
  - src/payments/refund.ts
---

Every refund attempt must emit an audit event, including failed attempts.
```

### Symbol note example

```md
---
id: S001
type: symbol_note
title: RefundService.processRefund must be idempotent
authority: accepted
symbols:
  - RefundService.processRefund
files:
  - src/payments/refund.ts
---

This method may be called multiple times for the same order during provider retries. It must return the existing refund if one already exists, not create a duplicate.
```

### Evidence example

```md
---
id: E001
type: evidence
title: Refund cancellation test
authority: accepted
covers:
  - C001
  - S001
command: npm test -- refund-cancel.test.ts
---

Verifies that canceling a paid order enqueues a refund and emits the audit event.
```

## Full schema (vision, post-v1)

```ts
type ContextCard = {
  id: string; // C001, S001, E001, R001, D001, F001, X001
  type:
    | "requirement"
    | "decision"
    | "constraint"
    | "symbol_note"
    | "feature_intent"
    | "evidence"
    | "conversation_fragment";

  title: string;
  body: string; // markdown after frontmatter

  scope: {
    feature?: string;
    files?: string[];
    symbols?: string[]; // "file::symbol" or "symbol"
    routes?: string[];
    domain?: string[];
  };

  authority: "accepted" | "candidate" | "deprecated"; // collapsed from legacy "status" field

  source: {
    kind:
      | "human"
      | "human_confirmed"
      | "agent_observation"
      | "bootstrap"
      | "conversation"
      | "ticket"
      | "code"
      | "test"
      | "schema"
      | "docs"
      | "git_commit";
    origin?: string; // e.g. "code_comment", "test_name"
    confidence?: "high" | "medium" | "low";
  };

  links: {
    symbols?: string[];
    files?: string[];
    requirements?: string[];
    decisions?: string[];
    constraints?: string[];
    evidence?: string[];
    tickets?: string[];
  };

  freshness: {
    state:
      | "verified"
      | "unverified"
      | "needs_review"
      | "maybe_affected"
      | "potentially_superseded";
    // 'deprecated' moved to authority (the trust axis); freshness is now strictly orthogonal
    reason?: string;
    triggered_by?: {
      change_id?: string;
      symbol?: string;
      change_kind?: string;
    };
    last_verified_sha?: string;
    created_at: string;
    updated_at: string;
  };

  retrieval: {
    keywords?: string[];
    embeddings_text?: string;
    priority?: number;
  };
};
```

## ID conventions

| Prefix | Type                                        |
| ------ | ------------------------------------------- |
| `C`    | constraint                                  |
| `S`    | symbol_note                                 |
| `E`    | evidence                                    |
| `R`    | requirement (post-v1)                       |
| `D`    | decision (post-v1)                          |
| `F`    | feature_intent (post-v1)                    |
| `X`    | candidate / conversation_fragment (post-v1) |

Numbers are sequential within type, zero-padded to 3 digits (`C001`, not `C1`). Filename: `{id}-{kebab-title}.md`.

## Symbol references

Format: `<file_path>::<symbol_name>` for fully-qualified, or `<symbol_name>` if globally unique.

```yaml
symbols:
  - src/payments/refund.ts::RefundService.processRefund
  - OrderService.cancel
```

## SQLite cache schema (v1)

The cache mirrors enough of the markdown to make retrieval fast. Rebuilt by `contexttrail index`.

```sql
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  authority TEXT NOT NULL,            -- 'accepted' | 'candidate' | 'deprecated'  (collapsed from legacy 'status')
  file_path TEXT NOT NULL,            -- source markdown file
  source_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE card_symbols (
  card_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  PRIMARY KEY (card_id, symbol),
  FOREIGN KEY (card_id) REFERENCES cards(id)
);

CREATE TABLE card_files (
  card_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  PRIMARY KEY (card_id, file_path),
  FOREIGN KEY (card_id) REFERENCES cards(id)
);

CREATE TABLE card_links (
  source_card_id TEXT NOT NULL,
  target_card_id TEXT NOT NULL,
  link_type TEXT NOT NULL,            -- 'covers', 'related', etc.
  PRIMARY KEY (source_card_id, target_card_id, link_type)
);

CREATE INDEX idx_cards_type ON cards(type);
CREATE INDEX idx_cards_authority ON cards(authority);
CREATE INDEX idx_card_symbols_symbol ON card_symbols(symbol);
CREATE INDEX idx_card_files_file ON card_files(file_path);
```

Post-v1 additions: `card_freshness`, `card_evidence_runs`, `card_embeddings`, `bootstrap_candidates`.

## Config file (v1)

`.contexttrail/config.yaml`:

```yaml
version: 1

# Code scope (used for mention extraction and card targeting)
scope:
  include:
    - src/**
  exclude:
    - node_modules/**
    - dist/**
    - "**/*.test.ts"
    - "**/*.spec.ts"

# Card storage
cards:
  source_dir: .contexttrail/cards

# Doc import scope rules — frontmatter overrides; built-in defaults below
doc_scopes:
  - id: docs-project-default
    pattern: "docs/**/*.md"
    scope:
      layer: project
  - id: root-readme-project
    pattern: "README.md"
    scope:
      layer: project
  - id: module-readmes
    pattern: "src/**/README.md"
    scope:
      layer: module
      module_from_path_after: src
  - id: package-readmes
    pattern: "packages/*/README.md"
    scope:
      layer: module
      module_from_path: 1
  - id: adr-docs
    pattern: "{docs,doc}/**/{adr,ADR,adrs,ADRs,decisions,Decisions}/**/*.md"
    scope:
      layer: decision

# Chunking
chunking:
  strategy: heading_with_cap
  target_tokens: 500
  max_tokens: 900
  split_by: paragraph
  preserve_blocks: [code_fence, table, list]
  merge_adjacent_sections: false # heading is the unit of meaning
  oversized_atomic_blocks: preserve_and_warn # never split code/table/list
  context_header: true # drift prepended at pack time
  overlap_tokens: 0 # no prose-tail overlap in v1

# Tokenizer (used for chunk caps and pack budget)
tokenizer:
  encoding: cl100k_base # gpt-tokenizer

# Chunk identity
chunk_identity:
  stable_key: hash(source_path + heading_path + chunk_index_within_section)
  version_id: hash(stable_key + content_hash)
  rename_recovery: deferred # heading rename invalidates stable_key in v1

# Indexing
indexing:
  mode: implicit # implicit | manual
  tombstone_retention: indefinite

# Retrieval
retrieval:
  max_locked_constraints: 8
  max_locked_symbol_notes: 8
  max_stale_warnings: 5
  max_evidence: 6
  max_total_tokens: 6000
  budgets:
    small: 4000
    default: 6000
    large: 10000
  min_final_score: 0.05 # drops tiny irrelevant chunks regardless of cheapness
  scoring:
    # text_score = w_bm25 * BM25_norm + w_heading * heading_match
    w_bm25: 0.70
    w_heading: 0.30
    # final_score = text_score * (1 + w_scope*scope_match) * (1 + w_mentions*mention_overlap) * specificity_weight
    w_scope: 0.70
    w_mentions: 0.80
    specificity_weight:
      module: 1.40
      project: 1.20
      decision: 1.10
      team: 1.00
      company: 0.90
      unknown: 1.00
  ranking:
    accepted_card_bias: 1.2
    doc_chunk_bias: 1.0
    candidate_bias: 0.65
    type_priority:
      constraint: 1.4
      symbol_note: 1.25
      evidence: 1.1
      doc_chunk: 1.0
    freshness_weights:
      verified: 1.0
      unverified: 0.85
      needs_review: 0.75
      maybe_affected: 0.85
      potentially_superseded: 0.6
      deprecated: 0.0
  include_candidates_by_default: false

# Languages (for symbol/mention extraction)
languages:
  typescript:
    enabled: true
```

---

## Doc Chunk schema

```ts
type DocChunk = {
  // Identity
  stable_key: string; // hash(source_path + heading_path + chunk_index)
  version_id: string; // hash(stable_key + chunk_content_hash)

  // Source
  source_path: string; // e.g. "docs/payments/refunds.md"
  doc_id: string; // hash(source_path)

  // Structure
  heading_path: string[]; // ["Payments", "Refunds", "Partial Refunds", "Edge Cases"]
  heading_level: number; // 4 in this example
  chunk_index: number; // 1
  chunk_count: number; // 2 (this is part 1 of 2 if section was split)
  title: string; // "Edge Cases" (last heading)

  // Content
  body: string; // chunk text
  token_count: number;
  chunk_content_hash: string;

  // Anchors
  start_line: number;
  end_line: number;
  heading_slug?: string;

  // Lifecycle
  status: "current" | "tombstoned";
  source_content_hash: string; // for change detection on parent doc
  indexed_at: string;

  // Scope (from frontmatter > config rule > path inference > unknown)
  scope: ChunkScope;
};

type ChunkScope = {
  layer: "company" | "team" | "project" | "module" | "decision" | "unknown";

  company?: string;
  team?: string;
  project?: string;
  module?: string;
  feature?: string;
  domains?: string[];

  files?: string[];
  symbols?: string[];
  routes?: string[];

  source: {
    frontmatter?: boolean;
    config_rule?: string;
    path_inference?: boolean;
    mention_extraction?: boolean;
  };
};

type CodeMention = {
  kind: "file" | "symbol" | "route" | "env_var" | "test";
  value: string;
  confidence: "high" | "medium" | "low" | "ambiguous";
  source: "explicit_path" | "exact_symbol" | "bare_identifier" | "code_span";
  ambiguous?: boolean;
};
```

### Doc frontmatter (optional)

```md
---
scope:
  layer: project
  project: payments
  domains: [refunds, billing]
  files:
    - src/payments/**
  symbols:
    - RefundService.processRefund
---

# Refund Processing

...content...
```

Frontmatter overrides config-rule scope. Frontmatter arrays augment mention-extracted code anchors.

---

## Indexed Doc Source schema

```ts
type IndexedDocSource = {
  source_path: string;
  source_mtime_ms: number;
  source_size: number;
  source_content_hash: string;
  last_indexed_at: string;
  last_indexed_git_sha?: string;
  chunk_count: number;
};
```

Used for fast-path change detection. On every retrieval (in `implicit` mode), ContextTrail:

1. `stat`s every indexed source path
2. Skips if `mtime_ms + size` match cached values
3. Otherwise computes `source_content_hash` and re-parses if it changed

---

## SQLite cache schema — week 1–2 (flat)

The week 1–2 implementation uses the flat schema shown later under "Doc chunks (round 2)" / `indexed_doc_sources`. There is only one object kind (`doc_chunk`), so the substrate's indirection is premature.

```sql
PRAGMA journal_mode=WAL;

-- See "Doc chunks (round 2)" and "indexed_doc_sources" tables below.
-- Add a nullable embedding column from the start so week-5 doesn't require migration:
ALTER TABLE doc_chunks ADD COLUMN embedding BLOB;     -- nullable; populated only when --embed
ALTER TABLE doc_chunks ADD COLUMN embedding_model TEXT;
```

**Migration to substrate at week 3:** when card support lands, migrate flat `doc_chunks` rows into `context_objects` + `doc_chunk_ext`. One-time, deterministic, scripted; the migration is documented and tested.

---

## SQLite cache schema — week 3+ (substrate model)

The schema implements the substrate from [ARCHITECTURE.md](ARCHITECTURE.md): a `context_objects` core, type-specific extension tables (`doc_chunk_ext`, `card_ext`), a `sources` table with discriminated kinds, and a single typed `links` table.

```sql
-- Open with WAL mode for forward-compatibility with future daemon mode
PRAGMA journal_mode=WAL;

-- Sources: every ContextObject traces back to a Source. Discriminated by kind.
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                    -- 'markdown_file' | 'card_file' | future:* placeholders
  uri TEXT NOT NULL,                     -- file path, URL, or external identifier
  content_hash TEXT NOT NULL,
  source_mtime_ms INTEGER,               -- for file sources
  source_size INTEGER,                   -- for file sources
  last_indexed_at TEXT NOT NULL,
  last_indexed_git_sha TEXT,
  metadata TEXT                          -- JSON, type-specific
);

CREATE INDEX idx_sources_kind ON sources(kind);
CREATE INDEX idx_sources_uri ON sources(uri);

-- Context objects: unified core. v1 kinds: 'doc_chunk', 'card'.
-- Future kinds add new extension tables; this core never changes.
CREATE TABLE context_objects (
  id TEXT PRIMARY KEY,                   -- version_id for chunks, card_id for cards
  kind TEXT NOT NULL,                    -- 'doc_chunk' | 'card' | future kinds
  source_id TEXT NOT NULL,
  authority TEXT NOT NULL,               -- 'accepted' | 'imported' | 'candidate' | 'inferred'
  scope_layer TEXT,                      -- 'company' | 'team' | 'project' | 'feature' | 'module' | 'symbol' | 'unknown'
  scope_data TEXT,                       -- JSON: full ScopeRef
  content_hash TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  version_id TEXT NOT NULL,
  freshness_state TEXT NOT NULL,         -- 'verified' | 'unverified' | 'needs_review' | 'maybe_affected' | 'potentially_superseded' | 'deprecated' | 'current' | 'tombstoned'
                                         -- Materialized by the indexer from (links.version_pin, current chunk version_ids, tombstones).
                                         -- MUST be rebuildable from canonical truth; only the indexer writes this column.
                                         -- Manual author review status lives in `author_review_state` (separate, stored). See D41, ADR-0006.
  last_verified_sha TEXT,
  embedding BLOB,                        -- nullable; bge-small-en-v1.5 384 floats; populated only when --embed
  embedding_model TEXT,                  -- nullable; populated only if a future embedding adapter writes vectors
  indexed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE INDEX idx_objects_kind ON context_objects(kind);
CREATE INDEX idx_objects_authority ON context_objects(authority);
CREATE INDEX idx_objects_scope_layer ON context_objects(scope_layer);
CREATE INDEX idx_objects_freshness ON context_objects(freshness_state);
CREATE INDEX idx_objects_source ON context_objects(source_id);

-- Doc chunk extension: type-specific fields for kind='doc_chunk'
CREATE TABLE doc_chunk_ext (
  context_object_id TEXT PRIMARY KEY,
  stable_key TEXT NOT NULL,              -- hash(source_path + heading_path + chunk_index)
  doc_id TEXT NOT NULL,
  heading_path TEXT NOT NULL,            -- JSON array
  heading_level INTEGER,
  chunk_index INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  heading_slug TEXT,
  FOREIGN KEY (context_object_id) REFERENCES context_objects(id)
);

CREATE INDEX idx_chunk_stable_key ON doc_chunk_ext(stable_key);
CREATE INDEX idx_chunk_doc_id ON doc_chunk_ext(doc_id);

-- Card extension: type-specific fields for kind='card'
CREATE TABLE card_ext (
  context_object_id TEXT PRIMARY KEY,
  card_type TEXT NOT NULL,               -- 'constraint' | 'symbol_note' | 'evidence' | future types
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  command TEXT,                          -- for evidence cards
  author_review_state TEXT NOT NULL DEFAULT 'unreviewed',
                                         -- 'unreviewed' | 'verified' | 'needs_review_manual'
                                         -- Toggled only by `contexttrail card verify` and `contexttrail card mark-needs-review`.
                                         -- Distinct from context_objects.freshness_state (materialized from links). See D41.
  FOREIGN KEY (context_object_id) REFERENCES context_objects(id)
);

CREATE INDEX idx_card_type ON card_ext(card_type);

-- Code anchors: file/symbol/route/env_var/test mentions extracted from content
-- Used by both doc_chunk and card scope. Generic over object kind.
CREATE TABLE code_anchors (
  context_object_id TEXT NOT NULL,
  kind TEXT NOT NULL,                    -- 'file' | 'symbol' | 'route' | 'env_var' | 'test'
  value TEXT NOT NULL,
  confidence TEXT NOT NULL,              -- 'high' | 'medium' | 'low' | 'ambiguous'
  source TEXT NOT NULL,                  -- 'frontmatter' | 'mention_extraction' | 'manual' | 'config_rule'
  PRIMARY KEY (context_object_id, kind, value),
  FOREIGN KEY (context_object_id) REFERENCES context_objects(id)
);

CREATE INDEX idx_anchors_value ON code_anchors(value);
CREATE INDEX idx_anchors_kind_value ON code_anchors(kind, value);

-- Links: single typed table over all object kinds. Forward-compatible.
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  from_kind TEXT NOT NULL,               -- 'doc_chunk' | 'card' | 'source' | future kinds
  from_id TEXT NOT NULL,
  to_kind TEXT NOT NULL,
  to_id TEXT NOT NULL,
  type TEXT NOT NULL,                    -- 'covers' | 'mentions' | 'evidences' | 'supersedes' | future types
  confidence REAL NOT NULL,
  source TEXT NOT NULL,                  -- 'manual' | 'mention_extraction' | 'frontmatter' | 'agent_proposed'
  version_pin TEXT,                      -- captures target version_id at link creation, for drift detection
  created_at TEXT NOT NULL
);

CREATE INDEX idx_links_from ON links(from_kind, from_id);
CREATE INDEX idx_links_to ON links(to_kind, to_id);
CREATE INDEX idx_links_type ON links(type);

-- Full-text index for BM25 over chunk + card body + title
-- Materialized from doc_chunk_ext + card_ext.
CREATE VIRTUAL TABLE context_objects_fts USING fts5(
  object_id UNINDEXED,
  kind UNINDEXED,
  title,
  heading_path,
  body
);

-- Round-1 specific: legacy compatibility note
-- Earlier round-1 schemas had separate `cards`, `card_symbols`, `card_files`,
-- `card_links`, `doc_chunks`, `indexed_doc_sources`, the original `chunk_code_mentions` (renamed to `code_anchors` from the start),
-- and `card_chunk_links` tables. Those are subsumed by the substrate model
-- above. The substrate is the v1 implementation; the round-1 split was a
-- conceptual sketch that did not survive contact with the architecture frame.

-- Continued in round 1 / round 2 below for reference (legacy):
-- (kept for historical reading; v1 implements the substrate model above)

-- Cards (round 1, superseded by context_objects + card_ext)
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  authority TEXT NOT NULL,            -- collapsed from legacy 'status'
  file_path TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  freshness_state TEXT DEFAULT 'unverified',
  updated_at TEXT NOT NULL
);

CREATE TABLE card_symbols (
  card_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  PRIMARY KEY (card_id, symbol)
);

CREATE TABLE card_files (
  card_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  PRIMARY KEY (card_id, file_path)
);

CREATE TABLE card_links (
  source_card_id TEXT NOT NULL,
  target_card_id TEXT NOT NULL,
  link_type TEXT NOT NULL,
  PRIMARY KEY (source_card_id, target_card_id, link_type)
);

-- Doc sources (round 2)
CREATE TABLE indexed_doc_sources (
  source_path TEXT PRIMARY KEY,
  source_mtime_ms INTEGER NOT NULL,
  source_size INTEGER NOT NULL,
  source_content_hash TEXT NOT NULL,
  last_indexed_at TEXT NOT NULL,
  last_indexed_git_sha TEXT,
  chunk_count INTEGER NOT NULL
);

-- Doc chunks (round 2)
CREATE TABLE doc_chunks (
  version_id TEXT PRIMARY KEY,
  stable_key TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  heading_path TEXT NOT NULL,            -- JSON array
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
  status TEXT NOT NULL,                  -- 'current' | 'tombstoned'
  scope_layer TEXT,
  scope_data TEXT,                       -- JSON of full ChunkScope
  indexed_at TEXT NOT NULL,
  FOREIGN KEY (source_path) REFERENCES indexed_doc_sources(source_path)
);

-- Code anchors for week 1–2 flat schema. Same conceptual data as the substrate's
-- `code_anchors` table (substrate-schema section above) — name aligned from the
-- start so week-3 substrate migration is a structural move, not a rename.
CREATE TABLE code_anchors (
  chunk_version_id TEXT NOT NULL,
  kind TEXT NOT NULL,                    -- 'file' | 'symbol' | 'route' | 'env_var' | 'test'
  value TEXT NOT NULL,
  confidence TEXT NOT NULL,              -- 'high' | 'medium' | 'low' | 'ambiguous'
  source TEXT NOT NULL,                  -- 'frontmatter' | 'mention_extraction' | 'manual' | 'config_rule'
  PRIMARY KEY (chunk_version_id, kind, value),
  FOREIGN KEY (chunk_version_id) REFERENCES doc_chunks(version_id)
);

-- Card-to-chunk links (cards may reference chunks; chunk version_id pinned for staleness)
CREATE TABLE card_chunk_links (
  card_id TEXT NOT NULL,
  chunk_stable_key TEXT NOT NULL,
  chunk_version_id TEXT NOT NULL,        -- pinned for drift detection
  chunk_content_hash TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  PRIMARY KEY (card_id, chunk_stable_key)
);

-- Indices
CREATE INDEX idx_cards_type ON cards(type);
CREATE INDEX idx_cards_authority ON cards(authority);
CREATE INDEX idx_card_symbols_symbol ON card_symbols(symbol);
CREATE INDEX idx_card_files_file ON card_files(file_path);

CREATE INDEX idx_chunks_status ON doc_chunks(status);
CREATE INDEX idx_chunks_stable_key ON doc_chunks(stable_key);
CREATE INDEX idx_chunks_source_path ON doc_chunks(source_path);
CREATE INDEX idx_chunks_scope_layer ON doc_chunks(scope_layer);
CREATE INDEX idx_code_anchors_value ON code_anchors(value);
CREATE INDEX idx_code_anchors_kind_value ON code_anchors(kind, value);

-- Full-text index for BM25 over chunk body + title + heading_path
CREATE VIRTUAL TABLE doc_chunks_fts USING fts5(
  title, heading_path, body,
  content='doc_chunks',
  content_rowid='rowid'
);
```

Post-v1 additions: `card_freshness` history, `card_evidence_runs`, `chunk_embeddings`, `bootstrap_candidates`, `retrieval_log`.
