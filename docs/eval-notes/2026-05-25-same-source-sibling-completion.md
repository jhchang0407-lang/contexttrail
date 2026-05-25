# 2026-05-25 Same-Source Sibling Completion

## Method

Add a narrow post-assembly completion pass for right-source/wrong-section
misses. If a slot already has a strong section from a source, the pass may add
one sibling section from the same source and same top heading family.

The scoring is generic:

- existing source anchor fit
- slot/query/field-label fit
- field-token coverage
- role and heading hints
- derived numeric/status signals
- stale/non-current penalties

The pass is budget-aware: it does not run when the slot is already over budget,
and it will not add a sibling that pushes the slot over budget.

## Why It Is Generic

Office documents often split the useful evidence across adjacent sections in
the same file:

- a facilities pull plus a working total
- a line-item table plus a status summary
- a request summary plus a final approval note

This method does not encode HR, finance, insurance, or vendor-specific labels.
It only recognizes the broader pattern: a strong selected source can justify
checking one nearby result/status/total-style sibling.

## Result

Robust normal panel:

- unchanged

Robust broad-query mutation:

- Slot evidence recall improved from `385/398` to `387/398`
- Required slots improved from `155/166` to `156/166`
- Evidence section recall improved from `386/398` to `388/398`
- Judgment grounding improved from `8/9` to `9/9`
- Slot budget stayed `0/167` over

Robust minimal-query mutation:

- Slot evidence recall improved from `341/398` to `349/398`
- Required slots improved from `128/166` to `131/166`
- Evidence section recall improved from `345/398` to `353/398`
- Slot budget stayed `0/167` over

Robust corpus-noise mutation:

- Retrieval, citation, grounding, searched-scope, and abstention metrics stayed
  flat
- Slot budget stayed at the post-pruning result of `49/167` over

Public hybrid mutations:

- Broad task queries improved to `109/109` evidence section recall and `23/23`
  required slots.
- Minimal task queries improved to `105/109` evidence section recall while
  required slots stayed `19/23`.

## Read

Keep the method. It fixes the exact broad-task same-source miss in the messy
FMLA packet and gives a larger lift under minimal-query pressure. It does not
solve misses where the slot never selected any section from the needed source;
those still need task-plan/query generation or a safer cross-slot source-copy
method.
