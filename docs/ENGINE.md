# Engine

## What Exists Today

The current engine is strongest for Markdown-like text:

- `src/cli/import.ts` imports source files into the local ContextTrail cache.
- `src/parse/markdown.ts` parses Markdown.
- `src/parse/chunker.ts` turns documents into stable chunks with heading paths.
- `src/store/` persists sources, chunks, cards, profiles, and indexes.
- `src/retrieve/` scores and packs relevant context.
- `src/eval/document-workflow-probe.ts` runs the new document-workflow eval.
- `src/eval/document-workflow-panel.ts` runs the cross-domain document-workflow
  panel.
- `src/eval/document-workflow-mutations.ts` reruns the panel under query and
  corpus perturbations.

The code-context engine has been archived under
`src/archive/code-engine-era-2026-05/code-engine/`. Thin compatibility exports
still keep the current build working, but new product work should not extend
that lane unless we deliberately re-open it.

## Current Strength

The engine can already:

- Preserve source paths and heading paths.
- Retrieve relevant sections across a small corpus.
- Assemble retrieval around Context Slots instead of untyped top-k queries.
- Score an operational workflow against gold evidence requirements.
- Score missing-context claims against searched scope.
- Track difficulty, challenge tags, engine failure modes, and decoy retrieval.
- Track workflow splits so dev, holdout, and stress packets can be separated.
- Run deterministic mutation pressure over the same gold requirements.
- Emit durable per-workflow traces with selected and rejected candidates.
- Report evidence misses at field level.
- Diagnose each evidence and searched-scope miss with a likely engine-layer
  cause.
- Score optional workflow outputs for field accuracy, citation validity,
  abstention quality, and review load.

## Current Baseline

The full document-workflow panel runs with:

```sh
npm run -s eval:document-workflow:panel
```

Current panel baseline:

- 64 imported sources.
- 30 workflows across insurance, contract/policy, numeric reconciliation,
  relationship history, employee operations, and vendor onboarding/compliance.
- 83 natural task variants.
- 107 Context Slots.
- 208 fields.
- 199 evidence requirements.
- 45 searched-scope requirements for missing-context claims.
- Dev, holdout, and stress split reporting.
- Archetype, difficulty, failure-mode, decoy, and miss-diagnosis breakdowns.

Current full-panel retrieval baseline:

- Slot evidence recall: 163/199 (81.9%).
- Required slots satisfied: 69/106 (65.1%).
- Evidence section recall: 179/199 (89.9%).
- Searched-scope coverage: 30/45 (66.7%).

The first insurance fixture lives at:

`tests/fixtures/document-workflows/insurance-claim/`

Run it with:

```sh
npm run -s eval:document-workflow
```

Current baseline:

- 13 imported sources.
- 6 workflows.
- 15 natural task variants.
- 19 Context Slots.
- 34 fields.
- 31 evidence requirements.
- 11 searched-scope requirements for missing-context claims.
- Failure-mode and difficulty breakdowns.

The current misses are useful engine signal:

- The water-damage rules slot misses the `Added Protection` section even though
  the workflow later retrieves it elsewhere. That separates slot-specific
  retrieval quality from workflow-level evidence recall.
- The prior-claim missing-context slot does not retrieve all searched-scope
  evidence, which catches an absence claim that is not fully grounded.
- The decoy prior-claim document is retrieved, exposing wrong-scope pressure
  without necessarily making the whole workflow fail.

The first contract / policy review fixture lives at:

`tests/fixtures/document-workflows/contract-policy-review/`

Run it with:

```sh
npm run -s eval:contract-policy
```

Current contract baseline:

- 7 imported sources.
- 6 workflows: exit rights, risk/liability, data/confidentiality,
  assignment/audit/subprocessor review, post-termination data return, and
  AI-training data-use review.
- 17 natural task variants.
- 24 Context Slots.
- 37 fields.
- 35 evidence requirements.
- 9 searched-scope requirements for missing-context claims.
- Decoy pressure from a superseded draft, a non-binding policy memo, and a
  non-binding security questionnaire.

The numeric reconciliation fixture lives at:

`tests/fixtures/document-workflows/numeric-reconciliation/`

Run it with:

```sh
npm run -s eval:numeric-reconciliation
```

Current numeric baseline:

- 13 imported sources.
- 6 workflows: three-way match, open-balance reconciliation, sales-tax review,
  vendor-statement reconciliation, remittance trace, and variance/tax release
  review.
- 16 natural task variants.
- 20 Context Slots.
- 44 fields.
- 43 evidence requirements.
- 9 searched-scope requirements for missing-context claims.
- Decoy pressure from an older same-vendor invoice, a stale tax email, and a
  prior vendor statement with the same open-balance amount.

The relationship-history fixture lives at:

`tests/fixtures/document-workflows/relationship-history/`

Run it with:

```sh
npm run -s eval:relationship-history
```

Current relationship baseline:

- 12 imported sources.
- 6 workflows: CTO follow-up, renewal risk brief, expansion timing review, QBR
  agenda readiness, security-review reschedule brief, and renewal-pricing
  separation stress review.
- 17 natural task variants.
- 22 Context Slots.
- 43 fields.
- 39 evidence requirements.
- 11 searched-scope requirements for missing-context claims.
- Decoy pressure from a stale opportunity and a similarly named account.

The employee-operations fixture lives at:

`tests/fixtures/document-workflows/employee-operations/`

Run it with:

```sh
npm run -s eval:employee-operations
```

Current employee-operations baseline:

- 10 imported sources.
- 3 workflows: benefits readiness, medical leave accommodation review, and
  remote-work exception review.
- 9 natural task variants.
- 10 Context Slots.
- 26 fields.
- 27 evidence requirements.
- 3 searched-scope requirements for missing-context claims.
- The current engine struggles here, especially on short HR sections where the
  right source is found but adjacent required sections fall below top-k.

The vendor-onboarding compliance fixture lives at:

`tests/fixtures/document-workflows/vendor-onboarding-compliance/`

Run it with:

```sh
npm run -s eval:vendor-onboarding
```

Current vendor-onboarding baseline:

- 9 imported sources.
- 3 workflows: onboarding readiness, bank-change payment hold, and security
  exception approval review.
- 9 natural task variants.
- 12 Context Slots.
- 24 fields.
- 24 evidence requirements.
- 2 searched-scope requirements for missing-context claims.
- This lane pressures high-risk onboarding packets, payment-fraud controls,
  security exceptions, and similar-vendor decoys.

## Engine Gaps

The next gaps are:

- Use the new miss diagnoses to improve ranking, slot ownership, and decoy
  resistance instead of tuning against aggregate scores alone.
- Grow holdout and stress beyond one packet per lane.
- Better workflow-output execution, not just retrieval scoring.
- Better handling of adjacent sections in short business documents.
- Held-out packets across all six archetypes so engine tuning does not overfit
  the visible fixtures.
- Public labeled contract-source ingestion for the contract / policy slice.
- Public invoice / receipt source ingestion for numeric reconciliation.
- Normalization for PDFs, DOCX, spreadsheets, emails, and scanned forms.
- Stable evidence anchors beyond Markdown heading paths.
