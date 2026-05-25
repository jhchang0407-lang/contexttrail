# 2026-05-25 Budget Pruning

## Method

Add a post-assembly pruning pass that runs only when a slot already exceeds
its declared token budget. The pass uses generic slot-fit signals:

- slot/query/field-label fit
- field-token coverage
- role and heading hints
- derived numeric/status signals
- low-authority and stale/non-current language

It does not use expected values or gold evidence requirements.

## Implementation Lesson

The first attempt was too aggressive. It pruned small low-scoring sections to
squeeze the final few tokens, which removed real evidence such as account
identity, finance-condition, and non-binding/stale proof sections. That was an
implementation problem, not a rejection of the method.

The kept version is narrower:

- only prune over-budget slots
- skip `missing_check` slots entirely, because stale or non-authoritative
  evidence can be required to prove a missing-context or excluded-authority
  claim
- prune only large low-fit sections or clearly low-authority sections
- record `budget_pruned_sections` in retrieval traces

## Result

Robust normal panel:

- unchanged

Robust broad-query mutation:

- unchanged

Robust minimal-query mutation:

- unchanged

Robust corpus-noise mutation:

- Slot evidence recall: unchanged at `394/398`
- Required slots: unchanged at `161/166`
- Evidence section recall: unchanged at `396/398`
- Searched-scope coverage: unchanged at `79/81`
- Citation validity: unchanged at `335/336`
- Citation authority: unchanged at `387/389`
- Slot budget: improved from `77/167` over budget to `49/167`

## Read

Keep the method. It reduces noise-driven context bloat without hiding the
remaining problem: budget pressure still exists in 49 robust slots, and
missing-context proof should get its own safer pruning/excluded-evidence lane
later rather than sharing the main evidence pruning logic.
