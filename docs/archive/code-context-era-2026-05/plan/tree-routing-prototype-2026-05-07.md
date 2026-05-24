# Tree Routing Prototype Notes — 2026-05-07

## Why we tried this

We explored a ContextTrail-native version of a "table-of-contents tree" retrieval idea inspired by hierarchical, reasoning-style document navigation systems.

The motivation was straightforward:

- retrieval correctness is already strong
- many remaining misses are top-1 ordering failures
- cross-module queries often already contain the right sources in top-3 or top-5
- the open question was whether a branch-first or source-first routing layer could improve first-read quality

This note records the first prototype, the outcome, and what we learned so we do not repeat the same failed shape later.

## Prototype hypothesis

For anchored multi-scope queries:

- build source-level branches from the already ranked document chunks
- choose a representative chunk for each source
- order branches first
- then spill remaining chunks after the branch representatives

In plain terms:

- route to the right source branch first
- only then show additional chunks from within that branch

The intended win was better top-1 behavior for `cross_module_boundary` queries where one sibling source is the right first read even if another source has the strongest local chunk.

## Where it was applied

We tested the idea at the **presentation-order seam** in:

- [presentation.ts](/Users/thomaschang/Repos/ContextTrail/src/retrieve/presentation.ts)

We deliberately did **not** rewrite the retrieval pipeline itself. The prototype was a display-order experiment only.

## How we tested it

We used the existing test surface only:

- presenter tracer-bullet tests in [presenter.test.ts](/Users/thomaschang/Repos/ContextTrail/src/mcp/presenter.test.ts)
- full fixture eval via `npm run eval:retrieval`

This was important because the risk was overfitting a single example while harming the real retrieval buckets.

## Result

The prototype failed at bucket level.

### What looked promising locally

- a targeted presenter test could be made to pass
- the behavior was easy to describe
- the idea felt intuitively aligned with hierarchical navigation

### What happened on the real eval

The broader fixture run regressed materially:

- overall ranked useful: `89.3% -> 87.7%`
- anchored ranked useful: `95.4% -> 92.3%`
- cross-module ranked useful: `89.5% -> 78.9%`
- overall top-1 acceptable: `61.5% -> 34.4%`
- cross-module-boundary top-1 acceptable: `68.4% -> 21.1%`

The prototype also reintroduced distractor ordering problems in several anchored adversarial cases.

## Why it failed

The first useful interpretation is:

- a naive branch-first reorder is too blunt for this corpus

More specifically:

1. ContextTrail retrieval is not "document tree only"
   - chunks, cards, evidence, ADRs, and anchor-derived hits all coexist
   - a source-first reorder ignores that some non-source objects carry important semantics

2. branch selection and display ordering are not the same problem
   - forcing branch order at the final display layer distorted good retrieval scores
   - it treated "routing" as if it were equivalent to "final ranked presentation"

3. source-first logic overrode too much local signal
   - strong chunk-level evidence was displaced even when the source routing intuition was weak
   - the corpus needs softer branch-aware signals, not a hard traversal override

4. cross-module failures are mixed
   - some are card-vs-doc failures
   - some are sibling-module ordering failures
   - some are route/symbol specificity failures
   - one broad branch rule is not expressive enough to solve all of them

## What we learned

### The idea is not useless

The experiment does **not** prove that hierarchical routing is a bad direction overall.

It does suggest:

- the presentation layer is the wrong place for a naive tree traversal
- if tree ideas help, they likely belong earlier in routing/planning
- any future tree experiment should be narrower and more explicit about where hierarchy is allowed to override scores

### Concrete lessons for future attempts

1. do not hard-reorder final ranked output by source branch
2. keep using the current eval as the truth surface
3. prefer small ranking signals over global branch overrides
4. if we revisit hierarchy, prototype it as:
   - candidate routing
   - branch scoring
   - or source-family pruning
   not as a direct final display reorder

## Current conclusion

The current best ContextTrail version remains the score-aware ranking with:

- multi-scope doc-first improvements
- rationale-query shaping
- top-3 repetition reduction

That version keeps all retrieval gates green and remains the fallback baseline.

The tree-routing prototype is a useful **negative result**, not a dead end:

- it rules out one tempting but harmful implementation shape
- it narrows where future hierarchy experiments should happen

## Recommended next step

Return to smaller cross-module improvements from the stable baseline, especially:

1. demoting non-locked cards from `top-1` in cross-module anchored mode when a strong canonical doc exists
2. tightening route/symbol specificity preferences without broad source-level promotion
3. improving first-read doc selection with additive signals rather than branch-first overrides
