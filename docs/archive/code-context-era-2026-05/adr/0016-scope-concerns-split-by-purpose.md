# ADR-0016: Scope concerns are intentionally split by purpose

**Status:** Accepted
**Date:** 2026-05-07

## Context

A `/improve-codebase-architecture` walk on 2026-05-07 surfaced "the scope concept is fragmented across modules" as a candidate for consolidation. Five files in `src/` work with scope:

| Module | Concern |
|---|---|
| `scope/resolve.ts` | **Assignment**: at import time, where does this Doc Chunk live in the taxonomy? |
| `retrieve/query-scope.ts` | **Inference**: at query time, what scope is this query asking about? |
| `retrieve/scope-match.ts:scopeMatchScore` | **Ranking signal**: how aligned are these scopes? (symmetric, graded) |
| `cards/locked-include.ts:constraintMatchesScope` | **Lock eligibility**: does this constraint apply? (asymmetric, ancestor-or-equal) |
| `scope/rules.ts:matchesGlob` | **Glob primitive**: does a path match a config rule pattern? |

The premise of the consolidation candidate was that these duplicate behavior. Grilling the code on 2026-05-07 showed the premise was wrong. The five concerns share *types* (`ChunkScope`, `QueryScope`) and the *layer hierarchy* (`company > team > project > module > feature`) but they do not share behavior.

A unified "Scope" module would be a bucket — five separately-defined functions inside one file — rather than a real seam. The asymmetric-vs-symmetric distinction in particular is load-bearing and codified in two existing ADRs (ADR-0007 for symmetric ranking, ADR-0011 for asymmetric locking).

## Decision

**Do not consolidate scope concerns into a single module.** Each of the five concerns owns its module. Consolidation is rejected.

The shared layer hierarchy already lives as `CARD_LAYER_ORDER` in `src/types/card.ts:107`. Shared types (`ChunkScope`, `QueryScope`, `ChunkScopeLayer`) live in `src/types/`. There is no missing primitive to extract.

## Why

**Different return types reflect different questions.**

- `scopeMatchScore` returns a graded `[0, 1]` because ADR-0007 hybrid scoring needs a continuous signal that participates multiplicatively in the final score.
- `constraintMatchesScope` returns a boolean (plus a `path` string for `contexttrail explain`) because ADR-0011 lock eligibility is binary — a constraint either applies or it does not.

**The matching rules disagree by design.**

A concrete check: Doc Chunk `module: payments/refunds` against query `project: payments`:

- `scopeMatchScore` → 0.6 (symmetric project-level alignment — used in scoring per ADR-0007)
- `constraintMatchesScope` → false (descendant does not subsume ancestor — used for locking per ADR-0011)

These are different answers because they answer different questions. ADR-0011 explains the asymmetry: scope is a hierarchy, and a `module:`-scope constraint that subsumed an ancestor query would leak module-specific rules into project-wide work. Symmetric scoring does not have that risk; it is a cheap structural signal that says "these scopes have a project in common."

**Assignment and inference are separate operations.**

`scope/resolve.ts` runs at import time over `(source_path, frontmatter, config)` and produces one canonical `ChunkScope` per Doc Chunk. `retrieve/query-scope.ts` runs at query time over `(query_anchors, cards, chunks, config)` and produces a `QueryScope[]` set. They consume different inputs at different points in the pipeline. Combining them inside one module would force a runtime branch on "is this an import-time or query-time call?" that adds nothing.

**`matchesGlob` is a primitive, not a scope concept.**

It is a glob-to-regex utility used by `scope/resolve.ts` (and could be used elsewhere). It belongs as a primitive in `src/scope/rules.ts`, not absorbed into a "scope" umbrella.

## Consequences

- The five files stay as they are. Future architecture reviews should not re-suggest the consolidation.
- If a new scope concern appears (e.g., scope inference for code-anchor queries beyond what `query-scope.ts` already covers), it gets its own focused module rather than being grafted onto an existing one.
- The shared hierarchy (`CARD_LAYER_ORDER`) and types (`ChunkScope`, `QueryScope`) remain the canonical primitives. Any new module added in this area uses them.
- This ADR is preservation work. It exists so the rejected consolidation is recorded as a deliberate decision, not a future cleanup opportunity.

## Related ADRs

- [ADR-0007](0007-hybrid-scoring-additive-text-multiplicative-structure.md) — defines the symmetric graded `scope_match` signal in the scoring formula.
- [ADR-0011](0011-locked-include-matching-rules.md) — defines the asymmetric ancestor-or-equal `constraintMatchesScope` rule for locked-include.
