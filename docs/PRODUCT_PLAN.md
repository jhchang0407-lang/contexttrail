# Product Plan

## Goal

Build ContextTrail into a focused document workflow engine before investing in
a broad UI or broad file-format support.

The product should not be positioned as generic RAG. It should be positioned as
an evidence-backed work system for document-heavy operations.

## Why Pivot

The text chunking and retrieval engine is the strongest current asset. The
code-context lane is valuable but harder, broader, and less immediate. Many
non-code domains have the same context problem with clearer workflow value:
too many documents, too many exact facts, too much manual review, and high cost
for hallucinated answers.

## First Product Wedge

Insurance claim document review:

- Policy declarations and endorsements.
- First notice of loss and adjuster notes.
- Repair estimates, invoices, ledgers, and proof-of-loss instructions.
- Tasks that fill structured outputs with citations and review flags.

The first wedge should prove that ContextTrail can retrieve the right evidence
sections and support reliable field-level completion.

## Eval Generalization

The product wedge can stay narrow while the eval panel is broader. The current
eval should pressure six reusable business-work shapes:

- Case / evidence adjudication.
- Contract / policy obligation review.
- Numeric / transaction reconciliation.
- Relationship / history synthesis.
- Employee lifecycle operations.
- Vendor onboarding compliance.

This keeps engine improvements from fitting only insurance documents while the
product still works toward one coherent end-to-end workflow first.

The eval should now be read in three layers:

- The full panel checks cross-archetype generalization.
- The holdout and stress splits check promotion risk.
- The mutation runner checks query-wording and corpus-clutter brittleness.

## Product Shape

The target system should:

1. Ingest a workflow corpus.
2. Normalize source documents into stable evidence-bearing sections.
3. Retrieve sections for each workflow task.
4. Extract fields with citations.
5. Flag missing and conflicting evidence.
6. Produce a compact human review surface.

## Non-Goals For Now

- A polished non-technical UI before the eval is meaningful.
- Broad support for every file type before one vertical works end to end.
- Perfect code-context retrieval.
- Uncited free-form answers.

## Success Definition

ContextTrail is working when a real workflow can show:

- High evidence section recall.
- Accurate field values.
- Valid citations for every answered field.
- Honest abstention on missing or conflicting evidence.
- Lower human review load without hiding risky fields.
