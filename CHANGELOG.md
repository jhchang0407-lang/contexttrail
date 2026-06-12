# Changelog

## 0.1.0-beta.0 — 2026-06-12

First public beta.

### Added

- Structure-aware PDF extraction: lines and cells are reconstructed from
  positioned text geometry into key-value pairs, tables, and headings;
  filled AcroForm field values are extracted; ruled-grid tables are
  detected from drawn lines. PDFs with recovered structure upgrade from
  `layout_sensitive` to `parsed_with_warnings`.
- `task_readiness` block on `retrieve_context_pack` responses: slot-level
  readiness, blocking slots, and a recovery plan so agents know whether to
  answer, retry, or ask the user.
- Localhost setup UI rejects cross-origin requests to state-changing
  endpoints (CSRF protection for Agent Rules, folder import, and uploads).

### Changed

- ContextTrail is now a document-only context engine. The experimental
  code-indexing lane from the project's earlier direction (code chunk
  retrieval, `get_code_chunk` MCP tool, `code_globs` config) has been
  removed. File/symbol/route anchors extracted from documents are
  unaffected.
- Exclusion globs (`!pattern`) in `contexttrail import` are now honored.
- Import is resilient to unreadable directories, files deleted
  mid-import, symlink loops, and folder names containing glob
  metacharacters such as parentheses.
- Plain-text ingestion detects UTF-8/UTF-16 byte-order marks and flags
  undecodable content instead of silently indexing mojibake.
- Corrupt/encrypted/empty PDFs produce one concise warning instead of a
  multi-kilobyte extractor stack trace.

### Fixed

- A title-subset ranking promotion could outrank the canonical changelog
  on release-history queries and bury combined topic+mode guides on
  compositional queries. Certified synthetic lower bounds are restored
  (changelog class back above its 0.95 floor).
- `contexttrail sync` against an unmounted or temporarily missing folder
  no longer tombstones the indexed corpus for that folder.
- `contexttrail index` reports re-extraction failures as warnings instead
  of counting them as "unchanged".
