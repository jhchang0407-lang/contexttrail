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

## Follow-Up Reduction Attempts

After adding unique-context accounting, several smaller knob and selector
changes were tested from commit `1146da7`.

Clean robust panel baseline:

- retrieved slot-summed: `64,712`
- unique assembled context: `33,142`
- slot evidence: `470/473`
- required slots: `176/181`
- evidence section recall: `473/473`
- searched-scope coverage: `86/88`
- citation validity: `390/390`
- citation authority: `446/447`

### One-Stage Knob Cuts

These looked tempting on the clean panel but were not reliable enough:

- `absence-verifier-k=0`: clean panel kept headline quality and reduced unique
  context to `32,007`, but minimal-query mutation regressed from `142/181`
  required slots and `74/88` searched-scope hits to `139/181` and `70/88`.
- `expected-place-k=1`: clean panel kept headline quality and reduced unique
  context to `32,437`, but minimal-query mutation regressed to `141/181`
  required slots and `72/88` searched-scope hits.
- `cross-slot-k=1`: clean panel kept headline quality, but corpus-noise mutation
  regressed from `468/473` slot evidence and `175/181` required slots to
  `467/473` and `174/181`.
- `source-sweep-k=1`, `source-local-completion-k=0`, `near-miss-k=0`, and
  `rule-application-k=0` each caused direct quality loss in at least one core
  metric.

### Combined Knob Cut

`absence-verifier-k=0`, `expected-place-k=1`, and `cross-slot-k=1` reduced the
clean panel to:

- retrieved slot-summed: `60,372`
- unique assembled context: `31,418`

Clean headline quality held, but mutation quality regressed:

- corpus-noise: `467/473` slot evidence, `174/181` required slots
- minimal-query: `421/473` slot evidence, `139/181` required slots, `69/88`
  searched-scope hits

Read: the clean panel alone would have accepted this, but the mutation panel
caught it as an overfit.

### Selector Tightening Attempts

Tightening the absence verifier to require stronger slot fit removed unrelated
open-item/status sections and reduced the clean panel to about `32.2k` unique
tokens. It still reduced minimal-query searched-scope coverage, so it was
reverted.

Disabling same-source sibling completion reduced the clean panel to `32,754`
unique tokens with no clean-panel loss, but mutation quality dropped sharply:

- broad-query mutation slot evidence fell to `457/473`
- minimal-query mutation slot evidence fell to `407/473`
- citation validity also regressed

Read: same-source siblings look like support on the clean panel, but they are
important recovery evidence under query pressure.

## Current Lesson

The mutation panel is doing its job. Clean-panel token reductions around
`30k-32k` are easy, but the accepted method has to survive broad-query,
minimal-query, and corpus-noise pressure. The remaining reduction cannot come
from generic knob cuts. It needs a real evidence-span selector that can keep
the recovery behavior while sending less surrounding support.

## Accepted Clustered Source-Local Prune

A conservative clustered selector was added after expansion and before
budget-pruning. It only considers source-local completion sections that were
not original query selections and not same-source sibling recovery sections.
Within a source/top-heading cluster, it prunes a candidate only when stronger
sections already cover the slot and the candidate has weak fit, weak field
coverage, and little derived/absence signal.

This is intentionally narrow. Broader versions that included cross-slot or
expected-place sections cut more tokens, but regressed required-slot and
searched-scope coverage.

Accepted robust result:

- retrieved slot-summed: `63,812` from `64,712`
- unique assembled context: `32,757` from `33,142`
- slot evidence: unchanged at `470/473`
- required slots: unchanged at `176/181`
- evidence section recall: unchanged at `473/473`
- searched-scope coverage: unchanged at `86/88`
- citation validity: unchanged at `390/390`
- citation authority: unchanged at `446/447`

Mutation pressure stayed at baseline levels:

- broad-query mutation: `462/473` slot evidence, `170/181` required slots,
  `463/473` section recall, `83/88` searched-scope hits
- minimal-query mutation: `421/473` slot evidence, `142/181` required slots,
  `427/473` section recall, `74/88` searched-scope hits
- corpus-noise mutation: `468/473` slot evidence, `175/181` required slots,
  `471/473` section recall, `86/88` searched-scope hits

Read: this validates the shape of clustered pruning, but it is not the full
20k answer. The safe first version removes obvious source-local neighbor bloat.
The bigger reduction still needs span-level evidence selection.
