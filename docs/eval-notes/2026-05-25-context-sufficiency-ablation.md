# 2026-05-25 Context Sufficiency Ablation

## Method

Add a document-workflow ablation runner that scores the same retrieved workflow
through smaller context-pack variants:

- `strict_required`: gold evidence and searched-scope proof only
- `required_plus_cited_context`: required sections plus sections cited by the
  reference output; this is an oracle lower-bound diagnostic
- `required_plus_tiny_support`: required sections plus a small per-slot support
  allowance
- `required_plus_useful_support`: required sections plus all useful support
- `no_redundant_support`: full pack minus redundant support
- `no_stale_excluded`: full pack minus stale/excluded context

The runner compares every variant against the full baseline on section recall,
required slots, searched-scope coverage, citation validity, citation authority,
computed grounding, judgment grounding, abstention, and review explanation.

## Robust Result

Baseline robust panel:

- Retrieved tokens: `55,794`
- Required evidence + searched-scope proof: `14,353`
- Slot evidence recall: `396/398`
- Evidence section recall: `398/398`
- Citation validity: `336/336`
- Citation authority: `388/389`

Ablation curve:

| Variant | Retrieved tokens | Reduction | Quality |
| --- | ---: | ---: | --- |
| strict_required | 14,353 | 74.3% | 3 losses |
| required_plus_cited_context | 28,783 | 48.4% | pass |
| required_plus_tiny_support | 40,125 | 28.1% | pass |
| required_plus_useful_support | 43,517 | 22.0% | pass |
| no_redundant_support | 49,237 | 11.8% | pass |
| no_stale_excluded | 50,074 | 10.3% | pass |

`strict_required` missed one global evidence/citation path:

- `medical_leave_accommodation_review / fmla_not_eligible`
- missing section: `corpus/employee-profile.md > Employee Record ER-4471 > Employment Dates`

That section was retrieved elsewhere in the baseline pack but not retained by
the strict per-slot evidence-only variant.

## Read

This confirms the suspicion: the current full pack is not close to the minimum
needed by the present eval. The baseline uses `55,794` tokens, while the
reference-output oracle floor passes at `28,783` tokens.

Do not turn `required_plus_cited_context` into an engine method directly: it
uses reference-output citations, which are an oracle. Its job is to estimate how
far the pack can shrink if the engine learns to keep only task-critical support.

The next engine work should target a non-oracle approximation of this: keep
required evidence, keep missing-context proof, and add only support that is
likely to be cited or needed for computation/judgment.
