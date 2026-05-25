# 2026-05-25 Assembly Budget Methods

## Goal

Test whether the document-workflow engine can move toward a 20k-token working
context target without weakening broad eval quality.

The important distinction from this run:

- `retrieved slot-summed` counts the same section again when several slots use it.
- `unique assembled context` counts each workflow section once, which is closer
  to what a real context pack should send to an agent.

## Baseline After Breadth Expansion

Robust panel:

- workflows: `55`
- task variants: `155`
- fields: `447`
- evidence section recall: `473/473`
- searched-scope coverage: `86/88`
- citation validity: `390/390`
- citation authority: `446/447`
- retrieved slot-summed tokens: `64,712`
- strict required oracle floor: `17,485`

## Method Attempts

### Top-k Reduction

Reducing early retrieval did not work.

- `top-k=4`: `59,753` tokens, but regressed evidence and citation metrics.
- `top-k=3`: `56,709` tokens, but regressed slot evidence, searched-scope, and citation metrics.
- `top-k=2`: `52,948` tokens, worse regressions.

Read: early top-k pruning saves too little and removes real evidence in hard
cases. The candidate pool needs to stay broad.

### Expansion Shutdown

Disabling expansion stages cut token volume to `40,901`, but caused broad
quality loss:

- slot evidence: `446/473`
- required slots: `150/181`
- searched-scope coverage: `72/88`
- citation validity: `382/390`

Read: expansion stages are carrying real evidence and absence proof, not just
support bloat.

### Workflow-Level Section Budgeting

A generic post-retrieval section-pruning pass reduced the robust panel to
`55,474` tokens, but regressed badly:

- slot evidence: `453/473`
- required slots: `168/181`
- evidence section recall: `456/473`
- citation validity: `375/390`
- citation authority: `429/447`

Read: whole-section pruning is too blunt. Low-scoring sections can still carry
one required fact, especially in messy numeric, HR, and public-policy tasks.

### Snippet Compression

Naive snippet compression reduced the robust panel to `57,984` tokens, but
dropped required lines inside long public-document sections.

A safer field-scaled version restored quality, but only reduced the panel to
`64,614` tokens, a `98` token reduction from baseline. That is not worth the
added engine complexity.

Read: most chunks are already short. Snippet compression helps only after the
engine knows which evidence spans matter.

## New Observation Added

The report now shows unique assembled-context tokens separately from
slot-summed retrieval tokens.

Latest robust panel:

- retrieved slot-summed: `64,712`
- unique assembled context: `33,142`
- duplicate slot overlap: `31,570`
- unique required evidence: `13,015`
- unique searched-scope proof: `1,528`
- unique supporting context: `14,577`
- unique useful support: `12,647`
- unique redundant support: `1,930`
- unique excluded/stale context: `4,022`

Read: the first safe reduction is not retrieval starvation. It is assembly
deduplication. After dedupe, the remaining gap to 20k is mostly useful support
and excluded/stale proof. That support cannot be removed blindly.

## Recommendation

The next real method should be evidence selection, not tighter retrieval caps:

1. retrieve a broad candidate pool
2. dedupe sections at the workflow-pack level
3. identify field/slot evidence spans and missing-proof spans
4. include small local context around selected spans
5. include only the strongest support that explains computation, judgment, or
   authority exclusions

The eval already proves the theoretical target is possible: strict required
context passes at `17,485` slot-summed tokens. The product problem is building a
non-oracle selector that can approximate that floor without knowing the gold
answers.
