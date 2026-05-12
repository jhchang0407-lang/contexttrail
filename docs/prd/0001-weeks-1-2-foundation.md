# PRD-0001: Weeks 1–2 — Doc import, chunking, scope, code anchors, deterministic retrieval

> Source-of-truth canonical doc. Mirrored to Linear as the project's first PRD issue. Slices into independently-grabbable issues via `/to-issues`.
>
> Spec references throughout: `D{n}` = entry in [`docs/DESIGN.md`](../DESIGN.md); `ADR-NNNN` = [`docs/adr/`](../adr/); `R2.{n}` = [`docs/IDEAS.md`](../IDEAS.md). Glossary: [`docs/CONTEXT.md`](../CONTEXT.md).

## Problem Statement

AI coding agents (Claude Code, Cursor, similar) routinely make wrong-direction edits because they lack project-specific context. The user has lived this on fundops — DB-vs-JSON drift, run-pipeline cross-module whack-a-mole — where the agent's mistake came from missing a rule that lived "somewhere in the docs" but never reached the agent's working context.

Today's alternatives are inadequate for the team-scale use case (see [ADR-0004](../adr/0004-bar-2-scope-with-embeddings-and-bootstrap.md), [`IDEAS.md` R2.19](../IDEAS.md)):

- **A growing `CLAUDE.md`** is unscoped, unverifiable, token-wasteful past ~200 lines, and silently goes stale.
- **Code-search tools** (`claude-context`, `probe`) retrieve by similarity. Rules whose prompt vocabulary doesn't match the query are *silently dropped*. The agent ships the regression.
- **Spec-generation tools** (`spec-gen`, `ryanwaits/contexttrail`) extract specs from code, top-down. They don't carry hand-authored team intent and they don't have locked-include semantics.

ContextTrail v1 builds a **substrate** for *hand-authored, scoped, version-pinned* knowledge that always reaches the agent. Weeks 1–2 lay the deterministic core of that substrate: import markdown docs, chunk by heading with stable identity, tag with project/module/symbol scope, extract code anchors via precision-first regex, and return scored Context Packs against a retrieval request — all without AI calls. Cards (week 3), MCP server (week 4), context assembly groundwork (week 5), bootstrap (week 6), and dogfood (week 7) build on this foundation.

The substrate must work standalone. Higher-level assembly and optional AI features land *after* the deterministic core has been proven correct on its own. *If semantic retrieval is required for correctness, you built a search engine. If the deterministic core stands on its own, you built a context engine.*

## Solution

Weeks 1–2 deliver four CLI commands and a single retrieval pipeline.

**Week 1 — Import and substrate:**

- `contexttrail init` creates `.contexttrail/` with `config.yaml` and a WAL'd SQLite cache.
- `contexttrail import docs <glob>...` parses markdown sources via `remark` + `unified` + `remark-gfm` + `gray-matter`, chunks each source by heading per the algorithm in [D30](../DESIGN.md), assigns stable identity ([D31](../DESIGN.md)), resolves scope per [D33](../DESIGN.md), and extracts code anchors via the precision-first regex table in [D32](../DESIGN.md). Token counts use `gpt-tokenizer` with `cl100k_base` ([D28](../DESIGN.md)).
- `contexttrail index` re-scans indexed sources via mtime+size fast-path, recomputes content hash on hits, re-parses on content change, and tombstones removed chunks.
- `contexttrail scope inspect [--unknown]` shows per-chunk scope and code anchors as the safety valve for tuning the regex table.

**Week 2 — Retrieval and Context Pack:**

- `contexttrail context "task" --files X --symbols Y [--budget small|default|large] [--json] [--explain]` builds a retrieval request, runs the retrieval pipeline (query parse → eligibility filter → score → pack → render), and emits a Context Pack.
- The pipeline scores every candidate chunk via the hybrid formula in [D34](../DESIGN.md):
  - `text_score = 0.70 · BM25_norm + 0.30 · heading_match_score`
  - `final_score = text_score × (1 + 0.70 · scope_match) × (1 + 0.80 · mention_overlap) × specificity_weight(layer)`
  - `packing_score = final_score / sqrt(token_count)`
  - `min_final_score = 0.05` (drops tiny irrelevant chunks)
  - All weights live in `config.yaml` from day 1 — tunable without code edits.
- `contexttrail explain` produces a per-chunk score breakdown showing which signal drove inclusion or omission.

**The substrate is correct enough for week 3 cards if and only if:**

1. Chunks have stable identity across content edits and reorders (heading rename invalidates, by design).
2. Re-imports detect change via mtime+size fast-path; full content hash on hits.
3. Tombstones fire when chunks disappear from sources.
4. Code anchors are reliable enough that AST fingerprinting in v1.5 can pivot off them.
5. The hybrid scoring formula returns sensible top-K on real markdown.
6. `contexttrail explain` decomposes scores cleanly so weight tuning is empirical, not vibes.

## User Stories

### Doc import and chunking

1. As a developer with a layered markdown doc set, I want to run `contexttrail init` in my repo so that ContextTrail has a place to store its cache and config.
2. As a developer, I want `contexttrail init` to be idempotent so that re-running it doesn't clobber my config or cache.
3. As a developer, I want `contexttrail import docs/**/*.md` to parse my sources via a real markdown AST so that heading hierarchy, line ranges, and code-fence atomicity are correct (D28).
4. As a developer with frontmatter on some docs, I want frontmatter to override config rules per-field so that I can express "this doc's project is `payments`, but inherit everything else from the rule" (D33).
5. As a developer, I want section content with multiple paragraphs that exceeds `target_tokens` to greedy-fill into multiple chunks rather than balance, so chunking is deterministic and the formula is simple (D30).
6. As a developer with an oversized fenced code block in my docs, I want ContextTrail to emit one oversized chunk with a warning rather than split the code mid-function (D30).
7. As a developer, I want chunks to carry a drift (`Source: ... > Section: A > B > C > Part: 2/3`) prepended at pack time so the agent has navigation context without prose-tail overlap (D30).
8. As a developer, I want each chunk to have a stable_key derived from `source_path + heading_path + chunk_index_within_section` so insertions and reorders survive (D31).
9. As a developer, I want each chunk to also have a version_id derived from `stable_key + content_hash` so the pinning mechanism for week-3 card freshness can detect content edits (D31).
10. As a developer, I want a heading rename to invalidate stable_key (acceptable v1 cost) so I don't need fuzzy supersedes recovery in v1.

### Scope tagging

11. As a developer, I want chunks to carry a layered scope (`company > team > project > module > symbol > decision`) so that retrieval can prefer specific over general (D33).
12. As a developer, I want config-rule scope tagging to default to the rule's stated `layer` *without* automatically deriving project name from `docs/<segment>` so I don't get fake specificity from folder categories (`docs/architecture/foo.md` does not become `project: architecture`) (D33).
13. As a developer with `src/payments/internal/refund.ts`, I want `module_from_path_after: src` to pick the single segment after the marker (`module=payments`) so I'm not surprised by nested-module confusion (D33).
14. As a developer, I want chunks to inherit their parent file's scope while their `code_anchors` are augmented per-chunk by mention extraction, so the layer/project/module fields stay consistent within a file but anchors stay fine-grained (D33).
15. As a developer, I want `contexttrail scope inspect --unknown` to list chunks with `layer: unknown` so I can tighten my config rules iteratively.

### Code anchors

16. As a developer, I want code anchors extracted via a precision-first regex table so my chunks carry reliable file/symbol/route/env_var/test references (D32).
17. As a developer, I want unbacked bare PascalCase identifiers (e.g. plain `RefundService` typed in prose) to be skipped during mention extraction so I don't pollute anchors with false positives (D32).
18. As a developer, I want backticked file paths with extension-and-slash to extract as `file` anchors at high confidence (D32).
19. As a developer, I want backticked `METHOD /path` patterns (e.g. `POST /orders/:id/cancel`) to extract as `route` anchors at high confidence (D32).
20. As a developer, I want env-var anchors to require an underscore plus uppercase pattern of length ≥4 so common acronyms (`API`, `HTTP`, `JSON`) are not misclassified (D32).
21. As a developer, I want `contexttrail scope inspect` to surface extracted anchors per chunk so I can audit false-positive rates on real docs and tune the regex table.

### Storage and re-indexing

22. As a developer, I want SQLite opened with WAL mode so future daemon mode is unblocked at zero v1 cost (per [ADR-0005](../adr/0005-two-phase-schema-flat-then-substrate.md)).
23. As a developer, I want the v1 cache schema to be flat (`doc_chunks`, `indexed_doc_sources`, `code_anchors`) without the substrate's `context_objects` indirection, so week-1 ships a working Context Pack quickly without abstracting over a set of size one (ADR-0005).
24. As a developer, I want a nullable `embedding BLOB` column on `doc_chunks` from day 1 so week-5 embedding work doesn't require schema migration.
25. As a developer, I want `contexttrail index` to be a no-op when source mtime and size are unchanged, so re-indexing on a clean tree is fast.
26. As a developer, I want `contexttrail index` to recompute content hash when mtime or size changed, and re-parse only when the hash actually changed, so spurious mtime updates don't trigger work.
27. As a developer, I want chunks whose source no longer exists (or whose section was removed) to be tombstoned rather than deleted, so future linked cards can surface a tombstone warning rather than fail silently.

### Retrieval and Context Pack

28. As a developer, I want `contexttrail context "make refunds idempotent" --files src/payments/refund.ts --symbols RefundService.processRefund` to return a Context Pack of relevant doc chunks within the budget (D34).
29. As a developer, I want BM25 ranking via SQLite FTS5 with per-query normalization so the lexical signal is comparable across queries (D34).
30. As a developer, I want heading-match (Jaccard of stemmed task tokens vs joined `heading_path`) to compose additively with BM25 so a chunk with a strong heading match can rescue a near-zero BM25 (D34, [ADR-0007](../adr/0007-hybrid-scoring-additive-text-multiplicative-structure.md)).
31. As a developer, I want scope-match to compose multiplicatively as `(1 + w_scope · scope_match)` so a chunk in the wrong module never beats one in the right module at equal text strength (D34, ADR-0007).
32. As a developer with multi-file queries (e.g. `--files src/a.ts src/b.ts`), I want scope-match to OR via `max(...)` over query scopes so cross-module work doesn't get penalized.
33. As a developer running `contexttrail context` without `--files` or `--symbols`, I want scope-match and mention-overlap to degrade to 0 (neutral, not 1) so unscoped queries still return sensible chunks driven by BM25+heading.
34. As a developer, I want a `min_final_score` threshold (default 0.05) so tiny irrelevant chunks don't sneak into the pack just because their `score / sqrt(tokens)` looks cheap (D34, ADR-0007).
35. As a developer, I want packing to be greedy by `final_score / sqrt(token_count)` until the budget is exhausted, so larger chunks pay an honest size cost without being crushed (D34).
36. As a developer, I want `--budget small | default | large` (4k / 6k / 10k tokens) so I can size the pack to the agent's task and model.
37. As a developer, I want `--json` output that is stable across versions so week-4 MCP can use it as the response contract.
38. As a developer, I want `contexttrail explain` to produce a per-chunk score breakdown (BM25_norm, heading_match, scope_match, mention_overlap, specificity, text_score, final_score, token_count, packing_score, included/omitted reason) so I can audit and tune (D34).
39. As a developer, I want all scoring weights (`w_bm25`, `w_heading`, `w_scope`, `w_mentions`, `specificity_weight[*]`, `min_final_score`) read from `config.yaml`, so I can flip `w_heading: 0` without code edits and watch the ranking change.

### Configuration

40. As a developer, I want `contexttrail init` to write a default `config.yaml` with sane chunking, scoring, and budget defaults so I can run `contexttrail import` immediately.
41. As a developer, I want `config.yaml` validated by zod so a malformed config fails fast with a useful error rather than producing weird runtime behavior.
42. As a developer, I want `doc_scopes` rules to be matched in order with first-match semantics so I can express "anything in `docs/payments/*` is layer=project, project=payments; everything else under `docs/` is layer=project but has no project name" (D33).

### Substrate readiness for v1.5+

43. As a future maintainer, I want chunks identified stably enough across edits that week-3 cards can pin to them via version_id (i.e., insertions of a new heading above don't break sibling stable_keys).
44. As a future maintainer, I want code anchors reliable enough that the v1.5 AST-fingerprinting drift detector can pivot off them ("symbol X changed in code → which chunks/cards reference X?").
45. As a future maintainer, I want field names in the flat v1 schema to map cleanly to the substrate model (`doc_chunks.body` → `doc_chunk_ext.body`; `doc_chunks.scope_data` → `context_objects.scope_data`) so the week-3 substrate migration is a structural move, not a rename pass (ADR-0005).

## Implementation Decisions

### Architecture and scope

- **Bar 2 scope is the v1 frame.** Weeks 1–2 are the flat deterministic core; context assembly groundwork (week 5) and bootstrap (week 6) are deliberately deferred. The deterministic core must work standalone.
- **Substrate phasing**: weeks 1–2 use the flat schema (`doc_chunks` + `indexed_doc_sources` + `code_anchors`), substrate migration lands at week 3 when the second object kind (Card) arrives ([ADR-0005](../adr/0005-two-phase-schema-flat-then-substrate.md)).
- **Forward-compat scaffolding cut**: only the WAL pragma is retained from D26's original list. `LLMProvider`, `EmbeddingProvider`, `maybe*` hooks, `extraction_runs` table, and AI telemetry are deferred to the call sites that need them (ADR-0004).
- **Single npm package** (no monorepo), `commander` CLI, domain-folder source layout (D36).

### Modules

The deep modules (encapsulated, isolatable, testable through a stable interface):

- **Markdown parser** wraps `remark` + `unified` + `remark-gfm` + `gray-matter`. Surface: `parse(source) → { ast, frontmatter, lineMap }`.
- **Tokenizer** wraps `gpt-tokenizer` with `cl100k_base`. Surface: `count(text) → number`.
- **Chunker** consumes markdown AST + frontmatter and emits `DocChunk[]`. Encapsulates D30 (no-merge, greedy-fill, preserve-and-warn, contexttrail-only), D31 (stable_key + version_id with intra-section index), and the `chunk_index_within_section` derivation.
- **Scope resolver** encapsulates D33 precedence (frontmatter per-field override → config rule → path inference → unknown) and chunk-level inheritance.
- **Mention extraction** is the precision-first regex table from D32. Surface: `(chunkBody) → CodeAnchor[]` where `CodeAnchor = { kind, value, confidence, source }`.
- **Scorer** is the hybrid formula from D34. Pure function. Surface: `(chunk, request, config) → ScoreBreakdown`.
- **Packer** is greedy packing by `final_score / sqrt(token_count)` until budget, with `min_final_score` filter. Pure function.

The shallow modules (glue / orchestration):

- **Storage** wraps `better-sqlite3` with the flat-schema DDL, WAL pragma, and a thin migration registry.
- **Config** loads `.contexttrail/config.yaml` via zod.
- **CLI commands** (`init`, `import`, `index`, `scope-inspect`, `context`) orchestrate the deep modules.
- **Render** emits text + `--json` output. The `--json` schema is stable from week 2 because week-4 MCP will reuse it.
- **Explain trace** formats per-chunk breakdowns for `contexttrail explain`.

### Glossary discipline

The CLI surface and prose use canonical terms from [`docs/CONTEXT.md`](../CONTEXT.md):

- `Doc Chunk` (not "chunk" alone), `Card`, `Context Pack`, `Context Object`, `code anchor` (the noun), `mention extraction` (only as the process phrase), `link` (object→object), `scope`, `layer`, `query anchors`, `scope_match`, `mention_overlap`, `retrieval pipeline`, `retrieval request`, `retrieval`, `authority`, `freshness`.
- "Status," "reference," and "scope layer" are banned in code and prose. Lifecycle on Doc Chunks (`current | tombstoned`) is referred to as "lifecycle," not "status."

### Schema

Flat-schema DDL in [`SCHEMA.md`](../SCHEMA.md#sqlite-cache-schema--week-12-flat). Canonical points:

- `doc_chunks(version_id PRIMARY KEY, stable_key, doc_id, source_path, heading_path JSON, heading_level, chunk_index, chunk_count, title, body, token_count, chunk_content_hash, source_content_hash, start_line, end_line, heading_slug, status, scope_layer, scope_data JSON, embedding BLOB NULLABLE, embedding_model TEXT NULLABLE, indexed_at)`
- `indexed_doc_sources(source_path PRIMARY KEY, source_mtime_ms, source_size, source_content_hash, last_indexed_at, last_indexed_git_sha, chunk_count)`
- `code_anchors(chunk_version_id, kind, value, confidence, source, PRIMARY KEY(chunk_version_id, kind, value))` — note the rename from `chunk_code_mentions` per the canonical-term cleanup
- `doc_chunks_fts USING fts5(title, heading_path, body)` for BM25
- `PRAGMA journal_mode=WAL` on every open

### Config defaults

[`SCHEMA.md`](../SCHEMA.md#config-file-v1) is canonical. Highlights:

- `chunking: { target_tokens: 500, max_tokens: 900, overlap_tokens: 0, merge_adjacent_sections: false, oversized_atomic_blocks: preserve_and_warn, context_header: true }`
- `tokenizer: { encoding: cl100k_base }`
- `chunk_identity: { stable_key: hash(source_path + heading_path + chunk_index_within_section), version_id: hash(stable_key + content_hash) }`
- `embeddings: { enabled: false, ... }` — reserved optional surface, not a v1 checkpoint
- `retrieval.scoring: { w_bm25: 0.70, w_heading: 0.30, w_scope: 0.70, w_mentions: 0.80, specificity_weight: { module: 1.40, project: 1.20, decision: 1.10, team: 1.00, company: 0.90, unknown: 1.00 } }`
- `retrieval.budgets: { small: 4000, default: 6000, large: 10000 }`
- `retrieval.min_final_score: 0.05`

### CLI contracts

- `contexttrail init` — idempotent; creates `.contexttrail/config.yaml` from defaults if absent, opens cache with WAL.
- `contexttrail import docs <glob>...` — parses each file, populates `indexed_doc_sources` and `doc_chunks` and `code_anchors`. Logs warnings for oversized atomic blocks. Emits a summary.
- `contexttrail index` — re-scans every indexed source via mtime+size fast-path; recomputes hash on hits; tombstones removed chunks; emits a summary.
- `contexttrail scope inspect [--unknown]` — text output with per-chunk scope, layer, code anchors, source line range; `--unknown` filter.
- `contexttrail context "task" [--files X...] [--symbols Y...] [--budget small|default|large] [--json] [--explain]` — emits the Context Pack as text (default) or stable JSON. With `--explain`, includes per-chunk score breakdowns.

### Deferred to later weeks (named here so they don't leak into v1)

- Cards, locked-include, authority/freshness model — week 3
- Substrate migration to `context_objects` + extension tables — week 3
- MCP server and `retrieve_context_pack` MCP tool — week 4
- Context assembly groundwork (sufficiency rules, widening signals, assembly evals) — week 5
- Bootstrap (LLM-proposed candidates, inbox, triage CLI) — week 6
- Dogfood + measurement on fundops — week 7
- AST fingerprinting and drift detection — v1.5+

## Testing Decisions

Tests are written against module interfaces, not implementation. The deep modules (chunker, scope resolver, mention extraction, scorer, packer) get exhaustive coverage; shallow modules (CLI, render, storage) get integration-level coverage where it adds signal.

**Test depth assignment is deferred to `/to-issues` slicing.** The expectation today: each deep module gets a colocated `*.test.ts` file with cases driven by the spec.

What makes a good test in this codebase:

- **Tests assert external behavior, not internal state.** A chunker test asserts the `DocChunk[]` output for a given input; it does not inspect intermediate AST nodes or call private methods.
- **Tests are spec-driven.** Each row in the D32 mention-extraction table gets at least one positive case and one negative (or near-miss) case. Each chunking case A/B/C/D from D30 gets a dedicated test.
- **Identity tests are insertion-driven.** stable_key invariance is asserted by simulating a heading insertion and confirming sibling stable_keys hold; rename invalidation is asserted symmetrically.
- **Retrieval tests use synthetic chunks with known scope and anchors**, not real markdown, so the scoring formula is testable without committing demo docs.
- **Weights are read from a fixture config**, so tuning tests can flip a weight to 0 and assert ranking changes accordingly.

Prior art for tests in this codebase: none — the repo currently has zero source code. The colocated-`*.test.ts` convention follows vitest's standard pattern (D36).

Modules nominally targeted for tests (final scope decided per-issue at `/to-issues` time):

- **Chunker** — exhaustive (cases A/B/C/D plus identity invariants)
- **Scope resolver** — exhaustive (per-field override, no-auto-derive, multi-rule precedence, chunk inheritance)
- **Mention extraction** — exhaustive (table-driven; positive + negative per row)
- **Scorer** — exhaustive (formula correctness; component independence; min_final_score filter; missing-query-anchor neutrality)
- **Packer** — moderate (budget enforcement, greedy ordering, threshold)
- **Markdown parser** — light (smoke tests; rely on remark's own tests)
- **Tokenizer** — light (smoke tests; rely on gpt-tokenizer's own tests)
- **Storage** — integration (round-trip a chunk through the schema)
- **CLI** — integration (golden-output tests for each subcommand against a small fixture repo)

## Out of Scope

- Cards (constraint, symbol_note, evidence) and locked-include — week 3
- Substrate migration to `context_objects` + extension tables — week 3
- MCP server and any MCP tool — week 4
- Context assembly groundwork — week 5
- Card bootstrap, inbox, triage CLI — week 6
- Dogfood + measurement protocol on fundops — week 7
- AST fingerprinting; drift detection (`drift review` CLI; `list_drift` MCP) — v1.5+
- File watcher mode — post-v1
- Multi-repo / monorepo cross-context — post-v1
- CI / GitHub PR integration — post-v1
- LLM rerank — post-v1 (skip if measurement doesn't require it)
- Vector index (`sqlite-vec`, hnswlib) — only when chunk count crosses ~100k
- External doc sources (Notion, Confluence, Google Docs, PDF) — markdown only in v1
- `propose_card` MCP tool — post-v1
- Decision and feature_intent card types — post-v1
- AST-based symbol resolution (`ts-morph`) — v1.5+
- Forward-compat AI scaffolding (`LLMProvider` interface, `maybe*` hooks, telemetry tables) — added per call site, never speculatively (ADR-0004)
- Polished docs site / examples gallery beyond README — post-v1

## Further Notes

### How this PRD lands in code

After this PRD is accepted in Linear (via `needs-triage` → triage → ready), `/to-issues` slices it into independently-grabbable tickets (one per module, plus integration tickets for CLI commands). Each ticket carries its own acceptance criteria distilled from this PRD's user stories and `MVP.md` week 1–2 deliverables tables.

The expected slicing:

- 12 tickets for week 1 (project scaffold, storage, markdown parser, tokenizer, chunker, scope resolver, mention extraction, config, `contexttrail init`, `contexttrail import`, `contexttrail index`, `contexttrail scope inspect`)
- 12 tickets for week 2 (FTS5/BM25, heading-match, scope-match, mention-overlap, specificity, scorer, query scope inference, packer, explain trace, render, `contexttrail context`, config wiring)

See [`MVP.md` weeks 1 and 2](../MVP.md) for the canonical deliverables tables.

### Spec references for implementers

- **Architecture frame** — [`CORE.md`](../CORE.md), [`MVP.md`](../MVP.md), [`ARCHITECTURE.md`](../ARCHITECTURE.md)
- **Schemas and config** — [`SCHEMA.md`](../SCHEMA.md)
- **Glossary** — [`CONTEXT.md`](../CONTEXT.md)
- **Locked decisions in dependency order** — [`DESIGN.md`](../DESIGN.md), specifically D27–D36 for this PRD
- **Substantive shifts** — [`adr/`](../adr/), specifically ADR-0004 (Bar 2 scope), ADR-0005 (two-phase schema), ADR-0006 (authority + freshness orthogonality), ADR-0007 (hybrid scoring formula)
- **Open questions and deferred items** — [`OPEN.md`](../OPEN.md)
- **Design tangents and competitor analysis** — [`IDEAS.md`](../IDEAS.md), specifically R2.19 (May 2026 competitive sweep)

### What "done" looks like

When this PRD is fully implemented:

- A user clones a repo, runs `npm i -g contexttrail`, runs `contexttrail init`, runs `contexttrail import docs/**/*.md`, and gets a populated `.contexttrail/cache/contexttrail.db` with chunks, anchors, and FTS5 index ready.
- They run `contexttrail context "make refunds idempotent" --files src/payments/refund.ts --symbols RefundService.processRefund --explain` and get a Context Pack of ≤6 chunks within budget, with a clear per-chunk score breakdown.
- They run `contexttrail scope inspect --unknown` and see a small, justified list (no false-unknowns).
- They edit a doc, re-run `contexttrail index`, and the affected chunks update with new version_ids while their stable_keys hold (or invalidate on heading rename, by design).
- The substrate-readiness check from [`MVP.md` week 7 acceptance](../MVP.md) can be run mechanically and pass.

Week 3 (cards) is unblocked.

### Triage label and routing

This PRD is published with the `needs-triage` label per [`/to-prd`](../adr/) skill convention. After triage acceptance, the label flips to `Feature` and the issue moves into Linear's normal flow toward `Ready for Agent`. `/to-issues` runs only after this PRD is accepted, not before.

## Outcome

**Status (2026-05-06):** shipped. Retrospective annotation — week-1-2 code was bundled into the initial repo scaffold rather than shipped as named slices, so this Outcome documents what *exists today* and what *later work surfaced about week-1-2 design* rather than per-checkpoint commit hashes.

**Modules delivered:**

| Module | Surface |
|---|---|
| [`src/parse/`](../../src/parse) | Markdown parse (gray-matter + remark + remark-gfm), heading-scoped chunker with atomic-block preservation, cl100k_base tokenizer |
| [`src/scope/`](../../src/scope) | `doc_scopes` config rules + frontmatter-override scope resolution; `module_from_path_after` / `module_from_path` derivation |
| [`src/extract/`](../../src/extract) | D32 precision-first regex mention extraction; 5 anchor kinds × 4 confidence levels |
| [`src/retrieve/`](../../src/retrieve) | D34 hybrid scoring (BM25 + heading_match + scope_match + mention_overlap + specificity); 5-stage pipeline parse → eligible → score → pack → render |
| [`src/store/`](../../src/store) | SQLite/WAL with `doc_chunks` + `code_anchors` + `indexed_doc_sources` + `doc_chunks_fts`; optional future embedding storage remains additive, not load-bearing for v1 |
| [`src/cli/`](../../src/cli) | `contexttrail init / import / index / scope inspect / context` (read-only retrieval surface) |

Fixture corpus (fundops-flavored): [`tests/fixtures/docs/payments/`](../../tests/fixtures/docs/payments) (refunds, audit, reconciliation), [`tests/fixtures/docs/auth/sessions.md`](../../tests/fixtures/docs/auth/sessions.md), [`tests/fixtures/docs/adr/0001-idempotency-keys.md`](../../tests/fixtures/docs/adr/0001-idempotency-keys.md). The benchmark seed is [`tests/fixtures/context-benchmark.json`](../../tests/fixtures/context-benchmark.json) — superseded structurally by the week-3 [`tests/fixtures/golden/`](../../tests/fixtures/golden) corpus.

**Test surface delivered (week-1-2 baseline):** 106 vitest cases across the 5 modules, ~1.2 s. (Week 3 took the suite to 211; week 4 to ~386.)

**Architecture decisions surfaced in later weeks that re-frame week-1-2 design:**

- **Locked-include layered cleanly on top of D34 scoring.** The week-3 work ([PRD-0002](0002-week-3-cards-and-substrate.md)) added Cards as a second Context Object kind without rewriting the scoring formula; D34's hybrid shape (additive text + multiplicative structural) was the right seam to extend, not replace.
- **Substrate migration was right to defer ([D29](../DESIGN.md) / [ADR-0005](../adr/0005-two-phase-schema-flat-then-substrate.md)).** The flat schema's field naming aligned cleanly with substrate-side `context_objects` + `doc_chunk_ext`. The migration in PRD-0002 / 3b was a half-day, single-transaction transform — exactly as ADR-0005 predicted. Pre-emptive substrate would have been the wrong shape.
- **Card type bias (D42, added week 3) is rarely load-bearing on real corpora.** Most authored Cards lock-include via D38/D39, bypassing the global ranker entirely. The 1.2× multiplier on non-locked Cards has cosmetic effect on most queries today. Worth instrumenting before tuning the constant.

**Deferred / known follow-ups (re-surfaced from week-1-2 territory by later work):**

- **Locked-include matching potentially under-firing on real-corpus dogfood.** PRD-0004 eval-prep noted only 2 of 15 cards locked on the refund/idempotency dogfood query. Whether this is a matching-rule bug ([ADR-0011](../adr/0011-locked-include-matching-rules.md)) or correct behavior with too-narrow scope tags is unresolved. The originating signal — `scope_match` and `mention_overlap` interacting under D34 — traces back to week-1-2 design. Followed up in [PRD-0005](0005-retrieval-correctness-and-observability.md).
- **Anchor-derived query-scope inference.** Week-1-2 inferred query scope only from `--files` paths; `--symbols` did not contribute. PRD-0005 expands this. The week-1-2 design left the seam in place but did not exercise it.
- **`contexttrail index` re-scan is implicit-on-import only.** No file watcher, no incremental re-anchor; re-running `contexttrail index` reads every source. Acceptable at v1 scale; flagged as a future seam if dogfood corpora grow past ~10k chunks.

**Out-of-scope observations surfaced during later work:**

- **The week-1-2 golden seed (`context-benchmark.json`) is structural, not quality-graded.** It asserts "does the engine produce a Pack of expected shape?" not "are the top-3 chunks the ones a human would have picked?". Quality-graded relevance judgments are week-7 (measurement protocol) territory.
- **`contexttrail scope inspect --unknown` is the unsung hero.** Calibrating `doc_scopes` rules against real corpora before retrieval matters is what keeps week-1-2 retrieval honest. A non-obvious week-1-2 deliverable that pays back through every later week.
- **Optional embedding storage staying additive** remains a useful future-proofing choice, but embeddings are no longer on the critical v1 path. The substrate should first prove fact-finding quality and context assembly without relying on semantic retrieval.

PRD-0001 unblocked [PRD-0002](0002-week-3-cards-and-substrate.md) (Cards overlay), which unblocked [PRD-0003](0003-week-4-mcp-server.md) (MCP server), which unblocked [PRD-0004](0004-mcp-payload-size.md) (payload reduction) and [PRD-0005](0005-retrieval-correctness-and-observability.md) (retrieval correctness). Every later PRD's Outcome section traces foundational decisions back to this one.
