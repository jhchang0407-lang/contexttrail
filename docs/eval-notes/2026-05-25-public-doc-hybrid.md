# 2026-05-25 Public Document Hybrid Eval

## Purpose

This lane tests generated business workflows against real public source
documents. It is separate from the synthetic document-workflow panel so we can
see whether engine changes survive legalistic and regulatory wording without
mixing that signal into the authored business-corpus promotion gate.

## Fixture

Fixture path:

- `tests/fixtures/document-workflows/public-hybrid-policy/workflows.yaml`

Public source excerpts:

- 29 CFR 825.110, FMLA eligible employee:
  `tests/fixtures/document-workflows/public-hybrid-policy/corpus/fmla-eligible-employee.md`
- 29 CFR 825.300, FMLA employer notice requirements:
  `tests/fixtures/document-workflows/public-hybrid-policy/corpus/fmla-employer-notices.md`
- 44 CFR Part 61 Appendix A(1), Standard Flood Insurance Policy Dwelling Form:
  `tests/fixtures/document-workflows/public-hybrid-policy/corpus/nfip-dwelling-form.md`
- FAR 52.212-4, commercial products and commercial services clause:
  `tests/fixtures/document-workflows/public-hybrid-policy/corpus/far-52-212-4.md`
- DOL Fact Sheet #28D, employer notification requirements under the FMLA:
  `tests/fixtures/document-workflows/public-hybrid-policy/corpus/fmla-fact-sheet-28d.md`
- Apple Inc. 2023 Form 10-K excerpt:
  `tests/fixtures/document-workflows/public-hybrid-policy/corpus/apple-2023-form-10k-excerpt.md`

The documents are real public-source excerpts. The workflow prompts, slots, and
field gold are generated around those documents.

## Workloads

- HR/FMLA: eligibility thresholds and employer notice obligations.
- Insurance/NFIP: coverage definition, proof-of-loss requirements, and sewer
  backup exclusion boundary.
- Procurement/contracts/FAR: written changes, disputes, invoices, accepted-item
  payment, prompt payment, and termination controls.
- Missing-context/authority hierarchy: worksite count is missing, CFR is
  governing, DOL fact sheet is only support.
- Finance/SEC: total sales, net income, category/service growth, gross margin
  percentages, margin drivers, and future margin risk.

## Observation Coverage

The hybrid panel now uses deterministic reference outputs by default. These are
oracle-style outputs derived from the fixture gold, not model answers. Their
purpose is to exercise the scorer every time the public hybrid lane runs.

Active observation dimensions:

- Retrieval evidence recall
- Required slot satisfaction
- Searched-scope coverage for missing-context checks
- Field accuracy against reference outputs
- Citation validity
- Citation authority
- Abstention quality
- Review explanation quality
- Decoy authority rejection
- Slot budget pressure
- Mutation miss diagnosis

## Baseline Result

Command:

```bash
npm run -s eval:document-workflow:hybrid:trace
```

Trace:

- `.contexttrail/eval-runs/document-workflow-hybrid-latest`

Result:

- 5 workflows
- 15 task variants
- 13 required slots
- 41 fields
- 22 queries
- 6 imported public sources
- 39/39 slot evidence recall
- 13/13 required slots satisfied
- 39/39 evidence section recall
- 4/4 searched-scope coverage
- 39/39 field accuracy
- 39/39 citation validity
- 41/41 citation authority
- 2/2 abstention quality
- 2/2 review explanation quality
- 2 rejected decoy citations and 0 decoy authority citations
- 2 decoy source retrieval hits
- 0/13 slots over budget

## Mutation Result

Command:

```bash
npm run -s eval:document-workflow:hybrid:mutations
```

Result summary:

- Broad task queries: 39/39 evidence recall, 13/13 required slots, 4/4
  searched scope, 0/13 over budget.
- Minimal task queries: 39/39 evidence recall, 12/13 required slots, 3/4
  searched scope. The missed searched-scope item was the DOL fact sheet support
  citation in the FMLA authority-boundary workflow.
- Corpus noise: 39/39 evidence recall, 13/13 required slots, 4/4 searched
  scope, but 11/13 slots over budget because the generated noise document
  inflated selected context.

## Interpretation

This is stronger than the initial seed. It now checks real public regulatory,
contractual, and SEC language; generated workflow phrasing; missing-context
abstention; citation authority; and mutation behavior.

It is still not a generalization proof. The next strengthening step is to add
longer and less-cleanly excerpted public documents: CUAD contracts, procurement
solicitations, government manuals, and multi-document SEC packets. Those should
add contradictory authority, stale filing periods, table-only evidence, and
larger folder-level noise.
