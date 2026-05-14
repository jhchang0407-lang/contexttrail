# PRD-0041: Chunk-First Code Retrieval Lane

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's forty-first PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md) — see `Context Pack`, `pack entry`, `context assembly`, `agent-completion source-file coverage`, `code-source index`, and `import graph`. Governing ADRs: [ADR-0005](../adr/0005-two-phase-schema-flat-then-substrate.md) (stable substrate over throwaway schema), [ADR-0023](../adr/0023-chunk-first-code-retrieval-with-file-graph-late-augmentation.md) (chunk-first code retrieval with file graph late augmentation), [ADR-0024](../adr/0024-code-must-compete-inside-the-core-pack-authority.md) (code participates inside the core pack authority), and [ADR-0025](../adr/0025-code-navigation-fields-and-get-code-chunk-are-first-class-mcp-contract.md) (MCP code navigation contract). Historical predecessor PRDs: [PRD-0028](0028-code-source-index-for-agent-completion.md) (file-identity code-source index), [PRD-0031](0031-reverse-import-traversal-structural-hypothesis.md) (reverse-import miss-shape audit), and [PRD-0040](0040-first-class-code-graph-substrate.md) (canonical file-level code graph substrate).
>
> Boundary rule: this PRD introduces a **chunk-first code retrieval lane** as a first-class participant in retrieval, packing, readiness, and MCP presentation. It explicitly supersedes the old boundary from PRD-0028 that "pointing the agent at the file is the deliverable" for the new packed-code slice, while preserving PRD-0028's file-identity `code-source index` and PRD-0040's file-level `import graph` as historical progression and as still-live substrate layers. This PRD does NOT add embeddings, query-time LLM judging, chunk-to-chunk graph edges, whole-file default packing, or full multi-language rich chunkers in the first slice.

## Problem Statement

ContextTrail can now assemble strong doc context and can often point at the right code files, but it still has a structural gap between "the agent knows which file might matter" and "the agent has enough real code context to start work without wandering the repo."

From the user's perspective, the current code retrieval path has three failures:

1. It is still too file-shaped. The agent gets file identity and graph neighbors, but not the code-sized unit it actually reasons over while editing.
2. It is still too late in the pipeline. Code can enter after the main pack authority has already made budget decisions, which makes the pack less honest and less measurable.
3. It is still too weak as a navigation contract. The pack can say "this file matters," but it does not yet consistently give the agent exact machine-readable code locations and a deterministic code follow-up lookup path.

The result is wasted context and wasted agent effort. Even when the pack contains the right file names, the agent may still need to grep, open broad file ranges, or fall back to generic repo exploration to discover the actual implementation slice. That fights the core product goal: a small Context Pack that is good enough for real work.

PRD-0028 solved the first file-pointing problem. PRD-0040 solved the "one canonical file graph" problem. The next problem is narrower and more concrete:

> how do we make code a first-class, chunk-sized, budget-honest retrieval lane that gives the agent enough real implementation context to work while still keeping prompt context small?

## Solution

Add a new **chunk-first code retrieval lane** that sits alongside the existing doc retrieval path and meets the rest of the retrieval system at the shared pack contract.

The core shape is:

1. Keep the existing `code-source index` as the file-identity layer.
2. Keep the existing `import graph` as the file-level structural neighbor layer.
3. Add persisted `code_chunks` as a rebuildable retrieval-index peer underneath `code_sources`.
4. Retrieve code by chunk first, not by file card first.
5. Aggregate chunk evidence into parent-file evidence, then choose the best chunk or chunk pair per winning file.
6. Let code compete inside the real pack authority with a conditional reserved code floor.
7. Let the file-level import graph add only a small bounded set of late neighbor files after direct code winners are already known.
8. Expose exact navigation metadata and a `get_code_chunk` MCP tool so the agent can act on winning code entries precisely.

The first implementation slice is intentionally narrow:

- TypeScript / JavaScript only
- deterministic lexical retrieval only
- no embeddings
- no LLM reranking
- no chunk-to-chunk graph
- one vertical slice that includes import-time indexing, shadow retrieval, pack integration, and the MCP contract additions

The end state is not "docs and code become identical." The end state is:

- docs remain source-first
- code becomes chunk-first
- both share the same Context Pack, readiness, confidence, recovery, and budget contract

## User Stories

1. As an engineer using ContextTrail for implementation work, I want the pack to include real code-sized context, so that I can start reasoning from likely edit sites instead of only from file names.
2. As an engineer, I want code retrieval to stay small and selective, so that useful code context does not become a prompt-budget hog.
3. As an engineer, I want the pack to point me at exact file and line locations, so that I can jump directly to the relevant implementation region.
4. As an engineer, I want a deterministic follow-up tool for code chunks, so that I can fetch the winning code region or its logical declaration view without ad hoc repo exploration.
5. As a maintainer, I want code to participate inside the same pack authority as docs, so that budget, omissions, readiness, and confidence stay honest.
6. As a maintainer, I want the code lane to be measured separately from the doc lane, so that I can tune code usefulness without arguing from feel.
7. As a maintainer, I want the code lane to reuse the current honesty contract, so that I do not create a second readiness/confidence world for code.
8. As a maintainer, I want code chunks to be rebuildable retrieval metadata rather than authority-bearing Context Objects, so that code navigation help does not inherit trust semantics it does not need.
9. As a maintainer, I want the file-level code-source and import-graph substrate to remain intact, so that the new lane builds on earlier work instead of replacing it.
10. As a maintainer, I want the import graph to remain late augmentation only, so that direct code identity remains primary and candidate explosion stays bounded.
11. As a maintainer, I want code chunk identity to be semantic rather than line-based, so that lookups and eval fixtures stay stable across ordinary edits.
12. As a maintainer, I want one parse walk to produce both file identity and code chunks, so that we do not duplicate extraction work.
13. As a maintainer, I want the first slice to stay TS/JS-only, so that we prove the architecture before promising richer chunk support for other languages.
14. As a maintainer, I want parent-file ranking to be derived from child code-chunk evidence, so that the code lane feels like real snippet retrieval rather than file-card retrieval in disguise.
15. As a maintainer, I want code chunks to have a code-specific reranker, so that declaration kind, symbol path, and file ownership can influence ranking without embeddings.
16. As a maintainer, I want code to reserve tokens only when the task actually needs code, so that broad doc/rationale queries do not pay a default code tax.
17. As a maintainer, I want the code floor to diversify across files before taking second chunks from the same file, so that the pack stays broad enough to be useful.
18. As a maintainer, I want a deterministic two-chunk escape hatch, so that a file can contribute orientation plus implementation context when one chunk is not enough.
19. As a maintainer, I want graph-added neighbor files to contribute their best chunk rather than only a hint card, so that any neighbor admitted into the pack is useful immediately.
20. As a maintainer, I want graph expansion to stay one-hop and tightly capped, so that structural adjacency remains a support mechanism rather than a new source of prompt bloat.
21. As an agent author, I want ranked code entries to expose structured location fields, so that my agent can navigate by fields instead of parsing human-readable strings.
22. As an agent author, I want `contexttrail` text to remain human-scannable, so that location and reason clues are still visible in explain/debug flows.
23. As an agent author, I want each returned code entry to explain why it won in a compact way, so that I can tell whether I am looking at a direct hit, an orientation slice, or a graph-added neighbor.
24. As an agent author, I want the first winning code chunk to arrive inline in the pack, so that I can often start reasoning immediately without another lookup hop.
25. As an agent author, I want `get_code_chunk` to support both exact-id lookup and logical declaration lookup, so that I can re-fetch the precise physical chunk or ask for the whole symbol view.
26. As an eval author, I want shadow mode to compare the old file-card path against the new code-chunk path on the same queries and budgets, so that regressions and gains are attributable.
27. As an eval author, I want code usefulness metrics that distinguish "top-1 acceptable" from "ranked useful," so that the system is not rewarded for burying the right code lower in the pack.
28. As an eval author, I want semantic code-chunk expectations instead of line-based ones, so that fixtures survive normal code movement.
29. As a retrieval engineer, I want doc retrieval and code retrieval to share the same final pack contract without sharing the same retrieval unit shape, so that each lane can use the right abstraction without fragmenting the product.
30. As a future maintainer, I want the new PRD to state explicitly which older code-retrieval boundaries it supersedes, so that the progression from file-pointing to chunk-first packed code remains legible.

## Implementation Decisions

### Product shape

- This PRD is a **follow-on retrieval slice**, not a reset of earlier code retrieval work.
- The old file-pointing and file-graph slices remain historical and still-live substrate layers.
- The new value is a vertical slice that turns those layers into a chunk-first packed code lane.

### Retrieval architecture

- Docs remain a source-first retrieval lane.
- Code becomes a parallel chunk-first retrieval lane.
- The two lanes meet at the shared Context Pack authority rather than at a shared first-pass retrieval unit.

### Substrate shape

- `code_sources` remains the file-identity layer.
- `code_chunks` is added as a rebuildable retrieval-index peer, not as a new `Context Object` kind.
- `code_chunks` stores current rows only, with semantic `stable_key` plus content-derived `version_id`.
- Import-time refresh is atomic per file: old current chunk rows are replaced by the new current chunk set for that file.

### Extraction

- The first slice is TS/JS only.
- One AST walk should produce both file-level `code_source` facts and child `code_chunks`.
- The extractor surface should grow a combined index-facts API, while the older file-only API may remain as a compatibility wrapper during migration.

### Chunk model

- The primary retrieval unit is a real code chunk, not a file summary card.
- The first slice should include top-level exported declarations, top-level non-exported declarations, class methods, and first-class orientation chunks.
- Whole-file packing is not the default path.
- Oversized logical units may be split into multiple physical chunk rows while preserving one logical declaration identity above them.
- Overlap between adjacent chunks is explicitly out of scope for the first slice.

### Search and ranking

- Code chunks are retrieved directly with deterministic lexical retrieval over chunk fields.
- Searchable chunk fields include file path, symbol path, declaration kind, code role, and chunk body.
- Parent files are ranked from child chunk evidence, using strongest-child plus a small support bonus rather than full summation.
- A code-specific reranker is introduced for code chunks and file winners.
- The reranker reuses the existing task/query taxonomy rather than inventing a separate code-intent language in the first slice.

### Selection and graph policy

- The default code contribution is one best chunk per winning file.
- A deterministic second-chunk escape hatch is allowed for orientation + implementation after first-per-file diversity is satisfied.
- The file-level import graph remains late augmentation only.
- Neighbor files are eligible only after direct winners are chosen.
- A neighbor file contributes its best code chunk, not a file-level hint.
- Graph expansion is one hop by default and capped by both count and token share.

### Packing and honesty

- Code must compete inside the core pack authority, not in a presenter-only or eval-only second pass.
- The code minimum is conditional, not always-on.
- It is triggered by code-heavy needs such as explicit file/symbol anchors, `exact_symbol_behavior`, or `cross_module_boundary`.
- The reserve is a fixed chunk-shaped floor per budget tier rather than a percentage of the whole pack.
- The code floor diversifies across files first, then may admit a second chunk from the same file under deterministic rules.
- Locked-include remains Card-only; code entries are ranked pack entries, not locked authority.

### Confidence, readiness, and recovery

- Code participates in the shared `coverage_confidence`, `pack_readiness`, and `recovery_plan` contract.
- If the conditional code floor is triggered but no code entry survives, confidence is capped at `uncertain`.
- Public readiness reasons should stay need-shaped (`exact_symbol_missing`, `cross_module_boundary_missing`, etc.) rather than adding a new code-only public reason.
- Recovery should prefer code-shaped follow-up searches rather than generic narrowing when code-sensitive needs remain unsatisfied.

### MCP contract

- The same vertical slice owns the MCP contract additions after shadow validation proves the new lane.
- Ranked entries may surface structured navigation fields such as `source_path`, `start_line`, `end_line`, plus code-specific fields such as `symbol_path` and `code_role`.
- The top-level public kind remains `code`; internal substrate changes do not require a new wire kind.
- `contexttrail` remains human-readable and may include compact line-range hints, but structured fields are authoritative.
- A first-class `get_code_chunk` tool is added as the code-side companion to `get_doc_chunk`.
- `get_code_chunk` supports both exact chunk-id lookup and logical declaration lookup by `file_path + symbol_path`.

### Evaluation and rollout

- The first implementation runs in shadow mode against the existing file-card code path.
- The PRD owns one vertical slice: import-time indexing, retrieval, shadow comparison, pack integration, and MCP contract promotion.
- Primary gate remains agent-completion source-file coverage.
- Secondary gates measure top-1 acceptable code chunk and ranked useful code-chunk presence.
- In mixed doc+code packs, code top-1 should be evaluated against the first code entry, not the absolute first ranked entry overall.
- The code-chunk annotation layer should be typed and semantic, not line-based.

### Deep modules

The implementation should prefer a few deep modules over many shallow feature flags:

- a combined TS/JS code-index extractor that yields file identity plus child chunks
- a code-chunk retrieval/rerank module that produces parent-file-aware code candidates
- a unified pack-entry path that lets code compete inside the core pack authority
- a code-chunk lookup module that supports exact and logical declaration views
- a shadow-eval harness that compares old and new code lanes on identical tasks and budgets

## Testing Decisions

Good tests for this PRD should prove external behavior and contract truth, not implementation trivia.

That means:

- test the pack and lookup behavior an agent actually consumes
- test code chunk identity and retrieval outcomes, not incidental AST node ordering
- test budget and readiness behavior through visible outputs
- test shadow comparisons on the same tasks/budgets rather than by eyeballing one-off examples

Tests should avoid locking down:

- incidental internal row ordering unless it is part of the public deterministic contract
- parser implementation details that do not affect chunk identity or returned pack behavior
- private reranker scoring arithmetic unless it changes visible rank/selection behavior

Modules and behaviors that need coverage:

1. TS/JS extraction of file identity plus code chunks from one parse walk.
2. Code chunk identity and refresh semantics (`stable_key`, `version_id`, atomic per-file replacement).
3. Code-chunk fielded lexical retrieval and code-specific reranking behavior.
4. Parent-file aggregation from child chunk evidence.
5. Deterministic one-chunk default plus two-chunk orientation/implementation escape hatch.
6. Conditional code-floor budgeting inside the core pack authority.
7. Late graph augmentation behavior and graph caps.
8. Confidence/readiness/recovery behavior when code-sensitive needs are and are not satisfied.
9. Ranked-entry MCP projection with structured navigation fields.
10. `get_code_chunk` exact-row and logical-declaration lookup behavior.
11. Shadow-mode old-vs-new evaluation on the same query/budget fixtures.
12. Agent-completion file coverage plus code-chunk usefulness metrics.

Prior art for these tests already exists in the repo and should be reused where possible:

- code-source index and import-graph tests
- source-rerank and pack tests
- readiness verifier and recovery-plan tests
- MCP schema, presenter, and contract-equivalence tests
- workflow-assembly and agent-completion probe tests
- graph-assembly and composition-audit tests

## Out of Scope

- Embeddings.
- Query-time LLM judging or code-semantic ranking.
- Chunk-to-chunk graph edges.
- Default whole-file code packing.
- Default test-file participation in the code lane.
- Rich first-slice chunkers for Python, Go, or Rust.
- Promotion of code chunks into authority-bearing `Context Objects`.
- Replacing the file-level `code-source index`.
- Replacing the file-level `import graph`.
- A generalized cross-object code/doc/card graph.
- Rewriting PRD-0028 or PRD-0040 as if they were mistaken instead of historical progression.

## Further Notes

This PRD is intentionally one vertical slice rather than two disconnected projects.

The user-facing value only appears when all of these meet:

- import-time code chunks exist
- retrieval can rank and choose them
- pack authority can budget them honestly
- MCP can return them with exact navigation
- agents can re-fetch them deterministically

Without that vertical seam, the repo would repeat the same problem we are trying to fix: useful parts exist, but the real path still lives elsewhere.

This PRD should therefore be implemented in staged checkpoints inside one issue, not split into a substrate-only PRD and a later integration PRD.

Historical progression matters here:

- PRD-0028 established file identity for code
- PRD-0040 established a canonical file-level code graph
- PRD-0041 adds the packed code-body retrieval lane that those earlier slices deliberately deferred

If this slice lands cleanly, the next natural follow-up questions are:

- whether richer non-TS/JS code chunkers should be added
- whether code/test relationships should surface as a later structured neighbor class
- whether code chunks ever need promotion into a richer substrate role

Those are follow-on questions, not hidden scope inside this PRD.
