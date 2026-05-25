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

The documents are real public-source excerpts. The workflow prompts, slots, and
field gold are generated around those documents.

## Workloads

- HR/FMLA: eligibility thresholds and employer notice obligations.
- Insurance/NFIP: coverage definition, proof-of-loss requirements, and sewer
  backup exclusion boundary.
- Procurement/contracts/FAR: written changes, disputes, invoices, accepted-item
  payment, prompt payment, and termination controls.

## Baseline Result

Command:

```bash
npm run -s eval:document-workflow:hybrid:trace
```

Trace:

- `.contexttrail/eval-runs/document-workflow-hybrid-latest`

Result:

- 3 workflows
- 9 task variants
- 8 required slots
- 26 fields
- 13 queries
- 4 imported public sources
- 26/26 slot evidence recall
- 8/8 required slots satisfied
- 26/26 evidence section recall
- 0 decoy source hits
- 0/8 slots over budget

## Interpretation

This is a seed, not a generalization proof. The useful signal is that the
existing engine handles the first public regulatory/contractual fixture without
breaking on formal source language.

The next strengthening step is to add public documents that are longer and less
cleanly excerpted: SEC filings, CUAD contracts, procurement solicitations, and
government manuals. Those should add generated tasks that require conflicting
source authority, missing-context abstention, and numeric table evidence.
