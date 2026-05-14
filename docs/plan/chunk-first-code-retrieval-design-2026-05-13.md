# Chunk-First Code Retrieval Design (Deterministic Claude-Context Shape)

Date: 2026-05-13

## Purpose

This memo captures the current design direction for the next code-retrieval architecture pass before it is promoted into a PRD.

The goal is to move DriftLedger's code retrieval away from file-card-first assembly and toward a chunk-first code lane that keeps prompt context small while still giving the agent enough real code to start work safely.

This design is intentionally inspired by the shape of chunk-first code retrieval systems such as Claude Context, but keeps DriftLedger's deterministic-core constraint:

- no embeddings in v1
- no LLM judging in the critical retrieval path
- no graph-first retrieval
- no full-file prompt dumping

## Why This Exists

The current code path is structurally mismatched with the rest of retrieval:

- doc retrieval is first-class inside the native retrieval and pack pipeline
- code retrieval is still largely appended after the main pack logic
- the import graph can generate large candidate mass even when only a tiny amount survives into the final pack

That creates three problems:

1. Code does not compete under the same honest budget authority as docs.
2. Prompt size is being controlled too late.
3. The primary code retrieval unit is not close enough to what the agent actually needs to start editing.

The design here fixes those by making real code chunks the primary code retrieval unit while preserving file identity and file-level import structure as supporting substrate.

## Design Goals

1. Keep code context small enough that the agent does not waste tokens on broad file exploration.
2. Keep code context useful enough that the agent can navigate directly to likely edit sites.
3. Reuse the existing retrieval honesty model instead of inventing a separate code-readiness world.
4. Keep the new code lane deterministic, inspectable, and measurable.
5. Preserve the current file-level code-source and import-graph substrate as the parent identity layer.

## Non-Goals

- Replacing the file-level `code_source` layer.
- Adding embeddings or LLM reranking in the first pass.
- Introducing chunk-to-chunk graph edges.
- Building a generalized cross-object knowledge graph.
- Indexing tests by default.
- Making non-TS/JS chunkers part of the initial vertical slice.

## High-Level Model

The target design has two code layers:

1. `code_sources`
   - file identity layer
   - owns file path, imports, exported symbol facts, and the file-level import graph
   - remains the parent layer for grouping, graph traversal, explain, and evaluation

2. `code_chunks`
   - first-class code retrieval unit
   - stores real chunk bodies plus searchable structural metadata
   - becomes the primary code lane substrate for ranking and packing

Retrieval becomes:

1. retrieve code chunks directly
2. aggregate chunk evidence into parent file evidence
3. rerank files and choose best chunk(s) within each winning file
4. pack code as a first-class lane inside the real budget authority
5. let the file-level import graph add a small number of late neighboring files only after direct winners are known

## Chunk Model

### Primary retrieval unit

The primary code retrieval unit is a real AST/code chunk, not a file card.

For the TS/JS spike, that means:

- top-level exported declarations
- top-level non-exported declarations
- class methods as their own chunks
- a small persisted orientation chunk when needed

This is intentionally closer to the "real snippet first" shape of Claude Context than to the existing file-summary-first code-source mixer.

### What counts as a chunk

Implementation chunks:

- top-level function declarations
- top-level class declarations
- top-level const/let declarations when they are meaningful declarations
- top-level type/interface/enum declarations
- class methods as separate chunks

Orientation chunks:

- file header
- class header
- module-level declaration block

Orientation is winner-dependent. A file-oriented module, a class-heavy file, and a configuration-like module should not all be forced through the same orientation shape.

### What does not count as a primary chunk

The first slice does not index:

- arbitrary anonymous executable blocks as peer implementation chunks
- nested inner functions as independent retrieval units
- overlapping copies of adjacent AST units
- whole-file bodies as the default retrieval unit

### Chunk boundaries

Chunk boundaries should follow exact AST units with no overlap.

If a logical AST unit is too large, it should be recursively split into budgetable physical chunk rows while preserving the logical declaration identity above them.

### Chunk roles

Public code-role vocabulary should stay small:

- `implementation`
- `orientation`
- `neighbor`
- `test`

Richer internal reasons can exist underneath this, but the public surface and eval fixtures should stay stable and readable.

## Extraction and Indexing

### Initial language scope

The initial vertical slice is TS/JS only.

The architecture should remain open to later Python/Go/Rust chunkers, but the first pass should not pretend to support richer chunk retrieval for languages not currently present in the working repo slice.

### One parse walk, two products

For TS/JS, one AST walk should produce both:

- the file-level `code_source`
- the child `code_chunks`

The import-time extractor should expose a combined API, with the old file-only API kept as a compatibility wrapper during migration.

### `code_chunks` as a rebuildable retrieval index

`code_chunks` should be a rebuildable retrieval-index peer, not a new `context_object` kind.

This implies:

- production-shaped tables from the start
- current rows only, not tombstoned historical versions
- semantic `stable_key` plus content-derived `version_id`
- atomic per-file replacement on import

### Chunk identity

Chunk identity should follow semantic declaration identity, not line coordinates.

Recommended shape:

- `stable_key`: `source_path + semantic symbol path + role`
- `version_id`: `stable_key + chunk_content_hash`

Line numbers are still important, but for navigation and display, not for durable identity.

### Searchable fields

The first `code_chunks_fts` index should carry:

- `file_path`
- `symbol_path`
- `declaration_kind`
- `code_role`
- `body`

`symbol_path` should be fully qualified when possible, such as `ClassName.methodName` rather than just `methodName`.

The chunk body should be stored inline in the indexable substrate rather than reconstructed from file spans during retrieval.

## Retrieval Pipeline

### First-pass candidate generation

Code retrieval should start from direct chunk retrieval, not from file-card retrieval.

The first pass should use lexical/deterministic retrieval over code-chunk fields. No embedding layer is assumed in the first implementation slice.

### Parent-file aggregation

Winning files should be inferred from child chunk hits, not the other way around.

Recommended parent-file scoring:

- strongest child chunk as the main signal
- small support bonus for additional distinct child hits

This preserves file identity as a real ranking feature without making file cards the primary retrieval unit again.

### Code-specific reranking

Code chunks should have their own reranking layer.

The reranker should be smaller than the doc-side source-rerank pipeline, but deliberate. Likely features include:

- task text
- provided anchors such as files and symbols
- symbol-path match quality
- file-path match quality
- declaration kind
- code role
- parent file strength
- class-to-method relationship

The reranker should reuse the existing task/query taxonomy first rather than inventing a second code-intent language.

### Selection within a file

Default policy:

- one best chunk per winning file first

Escape hatch:

- allow a second chunk from the same file under deterministic rules

The preferred two-chunk shape is:

- one orientation chunk
- one implementation chunk

This should happen only after first-per-file diversity is satisfied.

## Import Graph Policy

The import graph remains file-level only in the first slice.

That means:

- neighbor choice happens at the file level
- a neighboring file contributes its best code chunk if it earns a slot
- the graph never becomes the primary candidate generator

Graph policy:

- late augmentation only
- after direct winners are known
- one hop by default
- capped by both count and token share

This keeps graph structure useful without letting structural adjacency drown direct code identity.

## Packing and Budgeting

### Code becomes first-class inside the real pack authority

The reserved code lane must live inside the core pack authority, not in a presenter-only or eval-only second pass.

This is the only way to keep:

- budgets honest
- omitted reasons honest
- coverage/readiness honest
- explain/accounting coherent

### Conditional code floor

The code lane should not reserve tokens for every query.

The reserved code minimum should trigger only when the task shape clearly needs code, for example:

- explicit file anchors
- explicit symbol anchors
- `exact_symbol_behavior`
- `cross_module_boundary`

Broad doc or rationale questions should not pay a default code tax just because code happened to match lexically.

### Reserve shape

The reserve should be a fixed chunk-shaped floor per budget tier, not a percentage of the full pack.

Initial working values:

- `small`: `900`
- `default`: `1200`
- `large`: `1600`

The intent is to reserve enough code to be useful, not to enforce a visually balanced doc/code ratio.

### Pack competition

Recommended rule:

- reserve the minimum code floor when triggered
- after that, let overall rank win

This avoids artificial fixed doc/code ratios while still protecting implementation-shaped queries from code displacement.

## Response Contract

### Ranked entry kind

On the wire, first-class code chunks should still appear as `kind: "code"`.

The internal substrate becomes chunk-first, but the public top-level kind does not need a noisy enum expansion yet.

### Structured location fields

Ranked doc/code entries should grow a small uniform structured location surface:

- `source_path`
- `start_line`
- `end_line`
- `symbol_path?`
- `code_role?`

These fields should be machine-readable. `contexttrail` remains human-readable.

### `contexttrail`

`contexttrail` should also carry compact line-range hints for scanning, but the structured fields remain authoritative.

### Why-this-won

Returned code entries should carry a tiny "why this won" explanation surface so the retrieval result stays inspectable and downstream selection remains intelligible.

### `get_code_chunk`

Add a first-class `get_code_chunk` lookup tool parallel to `get_doc_chunk`.

It should support:

- exact lookup by stable chunk id
- selector lookup by `file_path + symbol_path`

Selector lookup should return the logical declaration view, even when retrieval had to split the declaration into multiple physical chunk rows.

## Confidence, Readiness, and Recovery

### Shared honesty contract

Code should participate in the existing pack honesty contract rather than creating a separate code-readiness world.

That means code affects:

- `coverage_confidence`
- `pack_readiness`
- `recovery_plan`

### Missing code under a triggered code floor

If the code floor is triggered but no code entry survives into the pack:

- cap `coverage_confidence` at `uncertain`
- reuse existing public readiness reasons such as `exact_symbol_missing` and `cross_module_boundary_missing`
- surface code-lane specifics in `budget` and `explain`, not through a new public omitted enum

### Recovery behavior

When the code floor is triggered and code evidence is missing, retries should become code-shaped rather than generic task narrowing.

Examples:

- symbol + behavior
- file basename + integration
- winning symbol path + sibling implementation

## Evaluation and Rollout

### Rollout shape

The first implementation should run in shadow mode against the existing file-card code path.

The new slice should write production-shaped `code_chunks` rows at import time, but remain shadowed at read time until the results are good enough to promote.

### Primary and secondary metrics

Primary gate:

- agent-completion source-file coverage

Secondary code-lane metrics:

- top-1 acceptable code chunk
- ranked useful code chunk presence

In a mixed doc+code pack, `Top-1 acceptable` should mean the first `code` entry is acceptable, not the absolute first ranked entry overall.

### Fixture shape

Code-chunk evaluation should use a small typed annotation layer on top of the existing commit-grounded cases.

Recommended fields:

- `acceptable_top_code_chunks`
- `must_include_code_chunks`

Selectors should be semantic rather than line-based, such as:

- `source_path`
- `symbol_path`
- `code_role`

### Observability

Every retrieval response should expose enough code-lane accounting to tune the system mechanically.

Minimum public budget additions:

- `budget.code_lane.triggered`
- `budget.code_lane.reserved`
- `budget.code_lane.used`

Minimum deeper accounting should include at least:

- direct code chunk tokens
- orientation chunk tokens
- graph-added code chunk tokens
- doc chunk tokens

## Out of Scope for the First Slice

- embeddings
- LLM code-judge reranking
- chunk-to-chunk graph edges
- full-file code packing by default
- default test-file participation
- non-TS/JS rich chunkers
- generalized code summary generation

## Migration Summary

The intended migration path is:

1. keep `code_sources` and the file-level graph
2. add `code_chunks` as a new retrieval-index peer
3. shadow the new chunk lane against the old file-card lane
4. move code into the native pack authority
5. promote only after file coverage, chunk usefulness, and token accounting all look healthy

## Documentation Status

This memo already drove the first documentation cleanup pass:

- `docs/CONTEXT.md` now distinguishes **pack entry** from **Context Object**
- `docs/CONTEXT.md` now treats assembly levers as late augmentation rather than primary retrieval
- [ADR-0023](../adr/0023-chunk-first-code-retrieval-with-file-graph-late-augmentation.md) records the chunk-first code retrieval shape
- [ADR-0024](../adr/0024-code-must-compete-inside-the-core-pack-authority.md) records that code must participate inside the core pack authority
- [ADR-0025](../adr/0025-code-navigation-fields-and-get-code-chunk-are-first-class-mcp-contract.md) records the MCP contract revision for precise code navigation and code-chunk lookup

The remaining documentation follow-up is the new PRD that turns this design into a staged delivery plan and explicitly supersedes the earlier "point at the file, not the body" boundary for the new slice while keeping the older PRDs as historical progression.
