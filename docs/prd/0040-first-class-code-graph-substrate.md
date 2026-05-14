# PRD-0040: First-Class Code Graph Substrate

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's fortieth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md) — see `code-source index`, `import graph`, `workflow assembly`, and `agent-completion source-file coverage`. Governing ADRs: [ADR-0005](../adr/0005-two-phase-schema-flat-then-substrate.md) (stable substrate over throwaway schema), [ADR-0015](../adr/0015-task-readiness-gates-authority-not-access.md) (retrieval as reusable substrate for future products), [ADR-0019](../adr/0019-retrieval-architecture-rethink.md) (deterministic-core deepening before any AI layer). Predecessor PRDs: [PRD-0028](0028-code-source-index-for-agent-completion.md) (code-source index), [PRD-0031](0031-reverse-import-traversal-structural-hypothesis.md) (reverse-import investigation), and [PRD-0035](0035-sync-hygiene-code-source-tombstoning-and-freshness-check.md) (code-source sync hygiene).
>
> Boundary rule: this PRD turns today's retrieval-local import graph into a first-class substrate index shared by retrieval and eval. It does NOT introduce a separate graph database, full code-body indexing, semantic code summarization, or a generalized cross-object knowledge graph in the same slice.

## Problem Statement

ContextTrail already knows important code-structure facts:

- the `code-source index` captures file identity through paths, exported symbols, signatures, purpose comments, and imports
- retrieval can walk the `import graph` forward and reverse to assemble substrate files
- eval code can reconstruct neighborhood shape to audit misses and measure agent-completion behavior

But those capabilities do not yet live behind one canonical substrate abstraction.

Today the import graph is effectively re-derived wherever it is needed:

- retrieval rebuilds an in-memory `importsByPath` map before structural expansion
- reverse-import traversal is assembled ad hoc from the same data
- eval tooling reconstructs the graph again for miss-shape analysis and diagnostics
- future features would have to choose between copying one of those patterns or adding yet another graph-specific helper

That fragmentation is survivable while the only graph lever is "walk imports during retrieval." It becomes a structural liability once the product needs more from the same code structure:

- shared diagnostics for "why did this file surface?"
- stable graph facts for setup confidence and future drift analysis
- richer code assembly that can distinguish identity edges from neighborhood edges
- follow-on graph kinds such as symbol ownership without rewriting the import graph a second time

From the user perspective, the gap shows up as unnecessary incompleteness. ContextTrail can often surface the right files, but it cannot yet say "this is the canonical code-side graph the engine understands" in the same way it can for `SourceProfile`, links, or code anchors. A durable context substrate should not force each consumer to rebuild the same graph from raw rows.

## Solution

Add a first-class **code graph substrate** to Layer 2 (`Context graph / index`) with one deliberately narrow first slice:

- canonical **file nodes**
- canonical **imports / imported-by edges**
- deterministic storage in SQLite alongside the existing retrieval index
- one shared read API used by retrieval and eval

The existing `code-source index` remains the lexical retrieval surface. The new code graph is the structural surface that sits beside it.

The first shipped graph kind is intentionally small:

| graph element | shipped now | deferred |
|---|---|---|
| file node | yes | n/a |
| import edge | yes | n/a |
| reverse-import lookup | yes | n/a |
| symbol node | no | later slice |
| doc-chunk / card / code cross-links | no | later slice |
| full code body | no | never in this PRD |

This keeps the work additive:

1. import-time extraction produces canonical graph facts once
2. storage persists graph facts once
3. retrieval reads the graph instead of reconstructing it
4. eval reads the same graph instead of reconstructing it
5. later graph kinds can extend the same substrate without redoing the import graph

## User Stories

1. As a maintainer, I want one canonical code graph abstraction, so that retrieval and eval stop rebuilding the same import graph separately.
2. As a maintainer, I want the code graph to live in SQLite with the rest of the substrate, so that graph facts survive process boundaries and do not depend on per-request reconstruction.
3. As a maintainer, I want the first code graph slice to stay narrow, so that we improve substrate quality without turning this into a generalized knowledge-graph detour.
4. As a retrieval engineer, I want code-import traversal to read from the canonical graph, so that assembly logic has one source of structural truth.
5. As a retrieval engineer, I want reverse-import traversal to come from the same graph API as forward traversal, so that inbound and outbound neighborhood logic cannot drift apart.
6. As an eval author, I want miss-shape audits to read the same graph as production retrieval, so that diagnostics describe the live engine rather than a parallel reconstruction.
7. As a pilot user, I want substrate files to keep surfacing in the Context Pack after the refactor, so that graph cleanup does not regress workflow assembly or agent-completion source-file coverage.
8. As a pilot user, I want the graph layer to remain deterministic, so that code assembly still works without any AI call.
9. As a future contributor, I want import-graph facts to be reusable by later features, so that setup confidence, drift analysis, and graph diagnostics can build on the same base.
10. As a future contributor, I want the next graph kind to be additive, so that symbol ownership can land without replacing the import graph implementation.
11. As a maintainer, I want code-source lexical retrieval to remain separate from graph expansion, so that a structural graph refactor does not blur ranking identity with neighborhood expansion.
12. As a maintainer, I want tombstoned or deleted code files to disappear from graph traversal naturally, so that the graph respects the same freshness and sync hygiene as the rest of the index.
13. As a maintainer, I want graph queries to be explainable, so that when a file surfaces because it was import-traversed the engine can say so honestly.
14. As a maintainer, I want graph storage to follow existing substrate naming discipline, so that later schema growth does not create a second throwaway branch beside `links` and `code_anchors_v2`.
15. As a future contributor, I want graph tests to focus on observable behavior, so that we can change storage internals without rewriting every assertion.
16. As a future contributor, I want later symbol-node work to be explicitly deferred rather than implied, so that the first slice remains safe to ship and easy to review.
17. As a product owner, I want this work represented as a PRD, so that follow-on slices and issue breakdown happen in the repo’s normal planning flow rather than as oral architecture.
18. As a product owner, I want the issue breakdown to produce thin vertical slices, so that each ticket can be independently triaged and grabbed by an AFK agent.

## Implementation Decisions

### Decision 1: Add a canonical code graph store beside the code-source index

The import graph graduates from retrieval-local reconstruction to a first-class stored index. The graph is persisted in SQLite as deterministic nodes and edges, not rebuilt solely in memory per request.

The code-source index remains intact and continues to answer lexical "which file matches this query?" questions. The code graph answers structural "which files are connected to this one?" questions.

### Decision 2: Ship file nodes and import edges first

The first graph slice models only:

- file identity
- outbound imports
- inbound importers

Symbol nodes, symbol edges, and cross-object graph relationships are explicitly deferred. That keeps the first slice small enough to validate the substrate seam before expanding graph scope.

### Decision 3: Build one shared graph read API

All graph consumers should go through one deep module that exposes stable behaviors such as:

- list outgoing import neighbors
- list incoming importer neighbors
- expand a seed set by bounded graph traversal
- answer whether a path is a known graph node

The API should speak in repo-relative file identities and graph edge types, not storage-row details.

### Decision 4: Retrieval stops reconstructing `importsByPath`

The current retrieval path rebuilds forward and reverse import maps from raw code-source rows. That logic moves behind the shared code graph API. Retrieval still controls ranking, pack composition, and traversal policy; it no longer owns graph reconstruction.

### Decision 5: Eval consumes the same graph as production

Miss-shape audits, graph-assembly probes, and any import-neighborhood diagnostics should query the same code graph API used by retrieval. Production and measurement should not disagree about what the graph contains.

### Decision 6: Graph lifecycle follows existing import and tombstoning behavior

Import-time code-source extraction remains the source of graph facts. Graph persistence updates when code sources are imported, refreshed, or tombstoned. Deleted files should disappear from the graph through the same sync hygiene that already protects the code-source index.

### Decision 7: Keep graph storage additive to the substrate

The new graph tables should be additive and forward-compatible with later graph kinds. This PRD should not reopen the substrate model or introduce a second architectural center of gravity beside `context_objects`, `links`, and `code_anchors_v2`.

### Decision 8: Preserve deterministic-core boundaries

The graph stores structural code facts only. It does not index code bodies, depend on model-generated summaries, or require AI assistance for correctness. Any later quality layer must remain optional and layered above this substrate.

### Decision 9: Defer symbol ownership to a follow-on slice

Exported symbols remain part of lexical code-source identity in this PRD. Making symbols first-class graph nodes is useful, but it is a separate scope decision that should be evaluated only after the canonical import graph is in place and shared by current consumers.

## Testing Decisions

Good tests for this PRD verify external graph behavior and consumer-visible outcomes, not the incidental storage shape.

That means tests should prefer assertions like:

- a bounded traversal from these seed files reaches these known neighbors
- reverse traversal returns importers of the same live graph nodes used in retrieval
- tombstoned code files no longer appear as graph neighbors
- retrieval and eval produce the same neighborhood facts from the same indexed corpus

And should avoid assertions like:

- exact internal insertion order of graph rows unless that order is part of the public deterministic contract
- consumer knowledge of how the graph module builds caches internally

Modules / behaviors that need coverage:

1. Graph persistence writes file nodes and import edges deterministically from imported code-source facts.
2. Graph reads return correct outgoing and incoming neighbors for representative import shapes.
3. Bounded expansion matches today’s import-traversal contract, including forward-only and forward-plus-reverse traversal.
4. Tombstoning or deleting a code file removes it from graph traversal results.
5. Retrieval code-source expansion produces the same surfaced neighborhood through the new graph API as it did before the refactor.
6. Eval miss-shape and diagnostic code reads the shared graph instead of reconstructing a separate one.
7. Existing workflow-assembly and agent-completion probes do not regress after the graph refactor.

Useful prior art:

- code-source index storage and tombstoning tests
- import traversal tests
- real-workflow and agent-completion probe tests
- graph-assembly and localized-graph-assembly eval tests

## Out of Scope

- A separate graph database or service.
- Full code-body indexing.
- AI-generated code summaries.
- Symbol nodes and symbol-to-file ownership traversal.
- Doc Chunk / Card / code-object graph unification.
- New ranking coefficients tied specifically to the graph refactor.
- Background graph watchers or daemonized updates.
- Cross-repo graph joins.

## Further Notes

This PRD is intentionally about substrate completeness, not new visible product surface. The user-facing payoff is reliability and reuse:

- one graph, not many reconstructions
- one source of truth for structural code neighbors
- one seam that later features can extend

If the first slice lands cleanly, the natural follow-on question is whether exported symbols should become first-class graph nodes. That follow-on should be treated as a separate planning decision, not quietly absorbed into this PRD.
