# 2026-05-25 Robust Document Workflow Panel

## Why This Exists

The public hybrid lane is useful, but too small to support real-world
generalization claims by itself: 8 workflows, 23 required slots, and 109
evidence requirements can make an engine look better than it is.

This panel is the promotion-facing surface. It combines the authored business
workflow fixtures with the public/messy hybrid fixtures and turns on
deterministic reference-output scoring by default.

## Commands

```bash
npm run -s eval:document-workflow:robust:trace
npm run -s eval:document-workflow:robust:mutations:trace
```

Trace roots:

- `.contexttrail/eval-runs/document-workflow-robust-latest`
- `.contexttrail/eval-runs/document-workflow-robust-mutations-latest`

## Breadth Gate

The robust panel adds a breadth confidence assessment. A lane is still useful
when it fails the gate, but it should be treated as diagnostic rather than a
promotion signal.

Current promotion thresholds:

- 40 workflows
- 100 task variants
- 300 fields
- 120 required slots
- 250 evidence requirements
- 50 searched-scope requirements
- 80 imported sources
- all 6 work archetypes
- all 3 dataset splits
- at least 8 computed fields
- at least 8 judgment fields
- at least 30 missing/conflict fields

## Normal Robust Result

- 9 fixture packets
- 50 workflows
- 135 task variants
- 167 slots
- 166 required slots
- 389 fields
- 199 slot queries
- 113 imported sources
- breadth level: `promotion_candidate`

Scores:

- Slot evidence recall: `396/398`
- Required slots: `162/166`
- Evidence section recall: `398/398`
- Searched-scope coverage: `79/81`
- Field accuracy: `336/336`
- Computed grounding: `8/8`
- Judgment grounding: `9/9`
- Citation validity: `336/336`
- Citation authority: `388/389`
- Abstention quality: `52/53`
- Review explanation: `52/53`
- Decoy authority citations: `0`
- Slot budget: `0/167` over

Normal misses:

- `three_way_match_review / receipt_variance`: right source, wrong invoice-line section.
- `medical_leave_accommodation_review / eligibility_and_accommodation_rules`:
  employee employment dates were retrieved elsewhere but not assembled into the
  rules slot.
- `data_confidentiality_review / data_residency_gap`: non-binding policy memo
  explanation was missed.
- `contractor_conversion_readiness / benefits_and_forms_gap`: same-source
  signed-forms section was missed.

## Mutation Result

Broad task queries:

- Slot evidence recall: `387/398`
- Required slots: `156/166`
- Evidence section recall: `388/398`
- Searched-scope coverage: `77/81`
- Judgment grounding: `9/9`
- Slot budget: `0/167` over
- Main causes: some same-source wrong-section misses remain, but the narrow
  sibling pass now fixes Jules Rivera's worksite-count summary under broad task
  wording.

Minimal task queries:

- Slot evidence recall: `349/398`
- Required slots: `131/166`
- Evidence section recall: `353/398`
- Searched-scope coverage: `68/81`
- Judgment grounding: `8/9`
- Slot budget: `0/167` over
- Main causes: underspecified task wording removes the slot-specific handles
  the engine needs to retrieve identity, status, numeric operand, and
  missing-context proof sections.

Corpus noise:

- Slot evidence recall: `394/398`
- Required slots: `161/166`
- Evidence section recall: `396/398`
- Searched-scope coverage: `79/81`
- Judgment grounding: `9/9`
- Slot budget: `49/167` over
- Main cause: generated non-authoritative noise is usually not cited as truth,
  but it still inflates selected context and breaks budget discipline. The
  retained budget-pruning pass removes large low-fit or low-authority sections
  only after a slot is already over budget, and skips missing-context slots
  because excluded/stale evidence can be part of the proof.

## Read

This is now a better regression surface than the small hybrid lane. It still is
not a real-world proof: 50 workflows is a start, not a launch-grade benchmark.
But it is broad enough to guide method choices without immediately overfitting
to the 8-workflow public/messy packet.

The next engine work should prioritize:

- Better missing-context proof assembly when the needed source is decoy,
  superseded, non-binding, or only useful as excluded evidence.
- Task-plan or slot-query generation for minimal user prompts, because
  retrieval quality drops sharply when the harness removes slot-specific query
  language.
