# 2026-05-25 Document Workflow Breadth Expansion

## Change

Expanded the robust document-workflow eval from 50 workflows to 55 workflows.

New public-real source lanes:

- FAR 52.204-21 basic safeguarding for vendor/security compliance.
- IRS Publication 463 accountable-plan reimbursement rules.
- OSHA recordkeeping guidance for workplace injury recordability.

New messy synthetic office lanes:

- SOW scope-change review with stale template decoy, verbal approval conflict,
  missing signed change order, and computed change-order value.
- Sales commission exception review with stale comp-plan decoy, spreadsheet
  calculation error, quota-bound accelerator, and missing exception approval.

## Robust Result

Baseline robust panel after expansion:

- Workflows: `55`
- Task variants: `155`
- Slots: `182`
- Fields: `447`
- Queries: `215`
- Imported sources: `124`
- Slot evidence recall: `470/473`
- Required slots satisfied: `176/181`
- Evidence section recall: `473/473`
- Searched-scope coverage: `86/88`
- Citation validity: `390/390`
- Citation authority: `446/447`
- Computed grounding: `12/12`
- Judgment grounding: `14/14`
- Over-budget slots: `0/182`

Context efficiency:

| Bucket | Tokens |
| --- | ---: |
| Retrieved | 64,712 |
| Required evidence | 15,073 |
| Searched-scope proof | 2,261 |
| Supporting total | 40,650 |
| Useful support | 33,555 |
| Redundant support | 7,095 |
| Excluded or stale | 6,728 |
| Generated noise | 0 |

## Ablation Result

The oracle floor stayed below the 20k-30k target even after the eval expanded:

| Variant | Retrieved tokens | Reduction | Quality |
| --- | ---: | ---: | --- |
| strict_required | 17,485 | 73.0% | pass |
| required_plus_cited_context | 17,485 | 73.0% | pass |
| required_plus_tiny_support | 46,589 | 28.0% | pass |
| required_plus_useful_support | 51,040 | 21.1% | pass |
| no_redundant_support | 57,768 | 10.7% | pass |
| no_stale_excluded | 58,135 | 10.2% | pass |

`pass` means no regression versus the expanded full baseline, not perfect
workflow quality.

## Corpus Noise Result

With generated corpus noise:

- Imported sources: `133`
- Slot evidence recall: `468/473`
- Required slots satisfied: `175/181`
- Evidence section recall: `471/473`
- Citation validity: `389/390`
- Citation authority: `445/447`
- Generated noise retrieved: `0`
- Over-budget slots: `0/182`

## Read

The expansion did not reveal a new broad failure mode. The new public and messy
lanes held, while misses stayed concentrated in the existing hard families:

- evidence rejected inside a slot
- evidence retrieved in another slot
- right source but wrong section
- missing searched-scope proof for absence/completeness checks

This makes the next engine work more credible: the 20k-30k target still looks
realistic after adding wider use cases, but production must approximate the
`17,485` oracle floor without gold labels.
