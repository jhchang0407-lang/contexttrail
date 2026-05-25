# 2026-05-25 Support Efficiency Pruning

## Method

Split supporting context into two buckets:

- useful support
- redundant support

Then prune conservatively:

- generated / explicitly non-authoritative mutation noise is always removed
- redundant support is only removed when the slot is already over budget
- `missing_check` slots still keep ordinary stale, decoy, and excluded-authority
  proof; only generated mutation noise is allowed through that guard

## Regression Attempt

An intermediate version always pruned redundant support, even when the slot was
not over budget. That caused a real regression under query-pressure mutations:

- broad task queries dropped from `387/398` to `385/398` slot evidence recall
- minimal task queries dropped from `349/398` to `347/398` slot evidence recall

Read: the redundancy classifier is useful for observability and budget-pressure
pruning, but it is not safe enough to delete same-source support when there is
no pressure. Some sections that look redundant by generic fit signals still
act as useful bridges under broad or sparse task wording.

The kept implementation backs off that behavior.

## Result

Robust normal panel:

- Retrieval/citation/grounding metrics unchanged
- Context efficiency now reports `35,721` supporting tokens as `29,164` useful
  support and `6,557` redundant support

Robust broad-query mutation:

- unchanged at `387/398` slot evidence recall
- unchanged at `156/166` required slots
- unchanged at `0/167` over budget

Robust minimal-query mutation:

- unchanged at `349/398` slot evidence recall
- unchanged at `131/166` required slots
- unchanged at `0/167` over budget

Robust corpus-noise mutation:

- Slot evidence recall stayed `394/398`
- Required slots stayed `161/166`
- Evidence section recall stayed `396/398`
- Searched-scope coverage stayed `79/81`
- Citation validity stayed `335/336`
- Citation authority stayed `387/389`
- Generated noise improved from `97,981` tokens to `0`
- Slot budget improved from `49/167` over budget to `0/167`
- Retrieved tokens improved from `150,615` to `52,796`

## Read

Keep the method. The important lesson is that "redundant-looking" support is
not always safe to delete. For the next round, redundancy should remain an
observability signal and a budget-pressure fallback. Strong explicit
non-authority/noise signals can be pruned directly.
