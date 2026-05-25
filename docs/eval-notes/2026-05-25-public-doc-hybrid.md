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
  percentages, margin drivers, and future margin risk.
- Messy HR/FMLA packet: copied leave notes, payroll export, site headcount
  scratchpad, stale checklist, missing medical certification.
- Messy AP packet: OCR invoice, current PO, stale PO draft, short receiving
  note, bank-change hold, partial-payment rule.
- Messy customer follow-up packet: raw demo notes, current order form, security
  review forward, support export, stale renewal plan.

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
- 22 required slots
- 72 fields
- 33 queries
- 22 imported sources
- 73/76 slot evidence recall
- 20/22 required slots satisfied
- 74/76 evidence section recall
- 15/15 searched-scope coverage
- 63/63 field accuracy
- 59/59 extracted value accuracy
- 3/3 computed value accuracy
- 1/1 judgment value accuracy
- 2/3 computed grounding
- 1/1 judgment grounding
- 62/63 citation validity
- 71/72 citation authority
- 9/9 abstention quality
- 9/9 review explanation quality
- 5 rejected decoy citations and 0 decoy authority citations
- 5 decoy source retrieval hits
- 0/22 slots over budget

## Mutation Result

Command:

```bash
npm run -s eval:document-workflow:hybrid:mutations
```

Result summary:

- Broad task queries: 75/76 evidence section recall, 19/22 required slots,
  15/15 searched scope, 3/3 computed grounding, 0/22 over budget. Misses were
  Jules Rivera's direct worksite-count section, the AP invoice line-items table
  in the partial-payment slot, and the Meridian support issue in the contract
  constraint slot.
- Minimal task queries: 72/76 evidence section recall, 16/22 required slots,
  12/15 searched scope, 3/3 computed grounding. Misses concentrated in the
  messy FMLA packet: governing rule requirements, worksite count, stale
  checklist rejection, plus AP stale-PO rejection and one public FMLA guidance
  support citation.
- Corpus noise: 74/76 evidence section recall, 20/22 required slots, 15/15
  searched scope, 2/3 computed grounding, and 12/22 slots over budget because
  generated noise inflated selected context.

## Interpretation

This is stronger than the initial seed. It now checks real public regulatory,
contractual, and SEC language; generated messy-office artifacts; workflow
phrasing; missing-context abstention; citation authority; and mutation behavior.

The computed and judgment fields made the eval more honest. The reference
answer can compute the right value, but the context pack is scored separately on
whether it retrieved and cited all operands. That exposed an AP payable-amount
grounding miss: the answer value is right, but the line-item table did not make
it into the relevant slot.

The current weakness is not simple extraction under normal use; it is robust
operand/source targeting when a task requires rule application over messy notes,
tables, stale drafts, or support artifacts that live outside the most obvious
slot.

It is still not a generalization proof. The next strengthening step is to add
longer and less-cleanly excerpted public documents and larger messy folders:
CUAD contracts, procurement solicitations, government manuals, multi-document
SEC packets, email exports, OCR-like PDFs, and spreadsheet-derived Markdown.
Those should add contradictory authority, stale filing periods, table-only
evidence, duplicate names, attachment drift, and larger folder-level noise.
