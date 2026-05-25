# 2026-05-25 Public Document Hybrid Eval

## Purpose

This lane tests generated business workflows against real public source
documents plus deliberately messy office packets. It is separate from the
synthetic document-workflow panel so we can see whether engine changes survive
legalistic wording, rough internal notes, stale artifacts, and folder clutter
without mixing that signal into the authored business-corpus promotion gate.

## Fixture

Fixture paths:

- `tests/fixtures/document-workflows/public-hybrid-policy/workflows.yaml`
- `tests/fixtures/document-workflows/messy-office-packets/workflows.yaml`

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

The public-policy fixture documents are real public-source excerpts. The messy
office fixture documents are generated work artifacts designed to mimic rough
private business folders: copied Slack notes, OCR scans, scratchpads, stale
drafts, forwarded emails, and partial ledger exports.

## Workloads

- HR/FMLA: eligibility thresholds and employer notice obligations.
- Insurance/NFIP: coverage definition, proof-of-loss requirements, and sewer
  backup exclusion boundary.
- Procurement/contracts/FAR: written changes, disputes, invoices, accepted-item
  payment, prompt payment, and termination controls.
- Missing-context/authority hierarchy: worksite count is missing, CFR is
  governing, DOL fact sheet is only support.
- Finance/SEC: total sales, net income, category/service growth, gross margin
  percentages, margin changes, Mac sales decline, margin drivers, and future
  margin risk.
- Messy HR/FMLA packet: copied leave notes, payroll export, site headcount
  scratchpad, eligibility notice date math, readiness judgment, stale
  checklist, missing medical certification.
- Messy AP packet: OCR invoice, current PO, stale PO draft, short receiving
  note, bank-change hold, partial-payment arithmetic, approval-threshold
  judgment, payment-release judgment.
- Messy customer follow-up packet: raw demo notes, current order form, security
  review forward, support export, renewal-date math, follow-up risk judgment,
  stale renewal plan.

## Observation Coverage

The hybrid panel now uses deterministic reference outputs by default. These are
oracle-style outputs derived from the fixture gold, not model answers. Their
purpose is to exercise the scorer every time the public hybrid lane runs.

Active observation dimensions:

- Retrieval evidence recall
- Required slot satisfaction
- Searched-scope coverage for missing-context checks
- Field accuracy against reference outputs
- Extracted, computed, and judgment value accuracy
- Computed and judgment grounding against cited retrieved evidence
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

- 8 workflows
- 24 task variants
- 23 required slots
- 85 fields
- 38 queries
- 22 imported sources
- 109/109 slot evidence recall
- 23/23 required slots satisfied
- 109/109 evidence section recall
- 15/15 searched-scope coverage
- 76/76 field accuracy
- 59/59 extracted value accuracy
- 8/8 computed value accuracy
- 9/9 judgment value accuracy
- 8/8 computed grounding
- 9/9 judgment grounding
- 76/76 citation validity
- 85/85 citation authority
- 9/9 abstention quality
- 9/9 review explanation quality
- 5 rejected decoy citations and 0 decoy authority citations
- 5 decoy source retrieval hits
- 0/23 slots over budget

## Mutation Result

Command:

```bash
npm run -s eval:document-workflow:hybrid:mutations
```

Result summary:

- Broad task queries: 109/109 evidence section recall, 23/23 required slots,
  15/15 searched scope, 8/8 computed grounding, 9/9 judgment grounding, and
  0/23 slots over budget.
- Minimal task queries: 105/109 evidence section recall, 19/23 required slots,
  12/15 searched scope, 8/8 computed grounding, and 8/9 judgment grounding.
  Misses concentrate in the messy FMLA packet plus stale-source explanation
  checks when slot queries are stripped to task wording only.
- Corpus noise: 109/109 evidence section recall, 23/23 required slots, 15/15
  searched scope, 8/8 computed grounding, 9/9 judgment grounding, and 12/23
  slots over budget because generated noise inflated selected context.

## Interpretation

This is stronger than the initial seed. It now checks real public regulatory,
contractual, and SEC language; generated messy-office artifacts; workflow
phrasing; missing-context abstention; citation authority; and mutation behavior.

It is still a diagnostic lane, not a promotion-grade generalization claim. The
8 workflows, 23 required slots, and 109 evidence checks are intentionally small
enough to iterate quickly, which also makes them easy to overfit. Use the robust
document workflow panel when judging whether an engine method should stick:

```bash
npm run -s eval:document-workflow:robust:trace
npm run -s eval:document-workflow:robust:mutations:trace
```

The computed and judgment fields make the eval more honest. The reference
answer can compute the right value, but the context pack is scored separately on
whether it retrieved and cited all operands. The lane now covers 8 computed
questions and 9 judgment questions spanning date math, table arithmetic,
contractual thresholds, payment release, coverage boundaries, and risk
judgment.

The latest engine-side improvements that stuck were generic: derived slots get
stronger cross-slot promotion for numeric/status/risk/approval evidence, stale
cross-slot sections are penalized, and rule-application sections trigger a
targeted same-source completion pass for derived slots. A broader source-affinity
repair was tested and reverted because it regressed minimal-query pressure.

The current weakness is no longer normal-path extraction; it is mutation
robustness under underspecified task wording, especially same-source
wrong-section misses and stale-source explanation checks in messy folders.

It is still not a generalization proof. The next strengthening step is to add
longer and less-cleanly excerpted public documents and larger messy folders:
CUAD contracts, procurement solicitations, government manuals, multi-document
SEC packets, email exports, OCR-like PDFs, and spreadsheet-derived Markdown.
Those should add contradictory authority, stale filing periods, table-only
evidence, duplicate names, attachment drift, and larger folder-level noise.
