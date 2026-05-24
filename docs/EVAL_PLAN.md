# Eval Plan

## Purpose

The eval must answer whether ContextTrail can do real document work, not merely
whether it can retrieve vaguely relevant text.

The eval is not the product. It is the pressure system for the context assembly
engine. Its job is to show where the engine fails, why it failed, and which
engine layer should improve next.

## Current Harness

The first harness is `src/eval/document-workflow-probe.ts`.

It loads a workflow fixture, imports the corpus, retrieves top sections for each
Context Slot, and scores slot-level plus field-level evidence coverage. If a
saved workflow output is supplied with `--output=...`, it also scores extracted
values, citations, abstention, and review load.

Current fixtures:

- `tests/fixtures/document-workflows/insurance-claim/workflows.yaml`
- `tests/fixtures/document-workflows/contract-policy-review/workflows.yaml`
- `tests/fixtures/document-workflows/numeric-reconciliation/workflows.yaml`
- `tests/fixtures/document-workflows/relationship-history/workflows.yaml`
- `tests/fixtures/document-workflows/employee-operations/workflows.yaml`
- `tests/fixtures/document-workflows/vendor-onboarding-compliance/workflows.yaml`

The active panel now has 64 source documents, 30 workflows, 83 natural task
variants, 107 Context Slots, 124 slot queries, 208 fields, 199 evidence
requirements, and 45 searched-scope requirements. It is still intentionally
small enough to inspect, but broad enough to expose repeated failure patterns
across six business-work archetypes.

Run the full panel:

```sh
npm run -s eval:document-workflow:panel
```

Run with durable traces:

```sh
npm run -s eval:document-workflow:panel:trace
```

Run individual pressure slices:

```sh
npm run -s eval:contract-policy
npm run -s eval:numeric-reconciliation
npm run -s eval:relationship-history
npm run -s eval:employee-operations
npm run -s eval:vendor-onboarding
```

Run split-only panels:

```sh
npm run -s eval:document-workflow:panel -- --split=holdout
npm run -s eval:document-workflow:panel -- --split=stress
```

Run mutation pressure:

```sh
npm run -s eval:document-workflow:mutations -- --split=holdout
```

Run a single fixture with traces:

```sh
npm run -s eval:document-workflow -- --trace-dir=.contexttrail/eval-runs/document-workflow-latest
```

Each trace run writes `summary.json` plus one directory per workflow containing
`retrieval-trace.json`, `score.json`, `assembled-pack.md`,
`failure-analysis.json`, and `failure-analysis.md`.

Panel trace runs also write `panel-summary.json`.
Mutation trace runs write `mutation-panel-summary.json`.

## Eval Splits

Each workflow can declare a split:

- `dev`: visible diagnostic cases used for day-to-day debugging.
- `holdout`: promotion cases that should be run before accepting an engine
  method.
- `stress`: deliberately harder cases for wording, decoys, missing evidence,
  and multi-document synthesis.

Every active lane now has at least one holdout workflow and one stress workflow.
That makes the eval materially harder to overfit than the first visible panel,
but the holdout and stress sets are still small. Promotion claims should remain
modest until those splits grow beyond one packet per lane.

## Mutation Pressure

The mutation runner clones each fixture into a temporary packet and reruns the
same gold requirements under deterministic perturbations:

- `broad_task_queries`: replaces each slot's precise authored query with the
  workflow prompt plus slot purpose, plus one natural task variant.
- `minimal_task_queries`: replaces each slot's query with only one natural task
  variant. This is intentionally harsh and approximates weak task planning.
- `corpus_noise`: adds a non-authoritative clutter document that repeats
  workflow-like language.

These mutations do not replace held-out documents. They are an extra brittleness
check: a proposed engine method should not only improve the authored panel; it
should avoid catastrophic collapse under broad task wording and corpus clutter.

## Observation Layer

The trace output must explain misses, not merely count them. For every missing
evidence or searched-scope requirement, the harness emits a diagnosis with:

- The slot that missed.
- The required source, heading path, and text span.
- Whether declared decoys were retrieved.
- Exact required candidates that appeared but were rejected or fell outside
  top-k.
- Exact section hits retrieved by other slots.
- Same-source wrong-section selections.
- A likely cause.

The normal report also includes an aggregate `Miss diagnosis` table. The
per-workflow Markdown file is the drill-down view for the concrete source,
section, rank, and decoy details.

The current miss-cause taxonomy is:

- `source_not_imported`: the required source is absent from the corpus.
- `section_not_imported`: the source exists, but the required heading path does
  not.
- `section_imported_text_mismatch`: the heading exists, but the required text is
  not in the imported section.
- `rejected_in_slot`: the exact section was in the slot candidate set but did
  not survive the selected top-k.
- `retrieved_in_other_slot`: another slot found the exact section, but the
  owning slot did not.
- `right_source_wrong_section`: the slot found the right document but the wrong
  section.
- `decoy_pressure`: the slot selected declared decoy sources while missing the
  required section.
- `not_retrieved_by_slot`: the section exists in the imported corpus, but did
  not appear in this slot's selected or rejected candidate trace.

This layer is what turns the harness into engine feedback: a miss should point
to import coverage, chunking, query planning, slot ownership, ranking, decoy
resistance, or pack assembly.

## Fixture Shape

Each fixture should define:

- Corpus globs.
- Workflow cases.
- Work archetype, eval split, difficulty, challenge tags, and engine failure
  modes.
- Natural task wording variants.
- Decoy sources that should not be treated as target evidence.
- Context Slots with kind, role, purpose, fields, queries, required flag,
  failure modes, and budget.
- Fields to complete.
- Expected field status: answerable, missing, or conflicting.
- Expected values for answerable fields.
- Evidence requirements with source, heading path, and required text.
- Searched-scope requirements for missing-context claims.

Each lane should keep growing in the same pattern: add real-workflow packets,
add realistic source clutter, add decoys that look tempting, and add searched
scope for every absence claim. More questions should mean more operationally
different tasks, not random paraphrases.

## Engine Failure Modes

The harness is organized around failure modes the engine must survive:

- Wrong scope: right topic, wrong claim, contract, draft, account, or employee.
- Shallow relevance: topically related section, but missing operational evidence.
- Missing synthesis: pieces are found separately but not assembled into a pack.
- Override failure: amendment, endorsement, exception, or later doc changes the
  base rule.
- Absence hallucination: says evidence is missing without proving searched
  scope.
- False completeness: produces a confident pack while required context is absent.
- Budget collapse: long docs crowd out critical evidence.
- Citation weakness: cites the wrong section or cannot justify the field.
- Numeric-text split: misses totals, dates, thresholds, line items, or payment
  state.
- Natural task wording failure: succeeds on clause-like language but fails on
  business wording.

Datasets are raw material for these pressure cases. The engine should not be
shaped around a convenient dataset; the dataset should instantiate these
failure modes.

## Difficulty Ladder

- Level 1: direct evidence in one clear section.
- Level 2: multi-section assembly inside one document.
- Level 3: cross-document assembly.
- Level 4: conflict, decoy, stale document, or override handling.
- Level 5: missing or ambiguous evidence with searched-scope proof.
- Level 6: format or extraction stress such as tables, scans, OCR noise, long
  transcripts, and layout-sensitive fields.

## Metrics

**Slot evidence recall**: did each Context Slot retrieve the evidence required
for the fields it owns?

**Required slot satisfaction**: did every required Context Slot assemble enough
evidence without exceeding its budget?

**Evidence section recall**: did retrieval include the exact section needed to
support the field?

**Searched-scope coverage**: when the engine claims evidence is missing, did it
retrieve the source sections that make that absence meaningful?

**Field accuracy**: did the workflow output match the gold value?

**Citation validity**: does each answered value cite the required source span?

**Abstention quality**: did missing or conflicting fields become review items
instead of guesses?

**Review load**: how many fields require review, and are they the right fields?

**Failure-mode pressure**: for each declared engine failure mode, which slots
passed, which evidence was found, and which searched scope was covered?

**Difficulty pressure**: how performance changes across the difficulty ladder.

**Decoy retrieval**: whether the engine pulled in realistic wrong-scope
documents.

## Next Eval Work

1. Add held-out packets for all four archetypes before tuning engine heuristics
   against the visible fixtures.
2. Back the contract / policy obligation slice with public labeled contract
   sources where possible, starting with CUAD-style clause anchors.
3. Back the numeric slice with public invoice / receipt datasets where possible.
4. Add workflow-output execution so the engine can produce candidate field
   outputs directly.
5. Add file-format normalization evals before claiming format support.
