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
- Workflow-closed required evidence + searched-scope proof: `14,447`
- Slot evidence recall: `396/398`
- Evidence section recall: `398/398`
- Citation validity: `336/336`
- Citation authority: `388/389`

Ablation curve:

| Variant | Retrieved tokens | Reduction | Quality |
| --- | ---: | ---: | --- |
| strict_required | 14,447 | 74.1% | pass |
| required_plus_cited_context | 14,447 | 74.1% | pass |
| required_plus_tiny_support | 40,219 | 27.9% | pass |
| required_plus_useful_support | 43,611 | 21.8% | pass |
| no_redundant_support | 49,331 | 11.6% | pass |
| no_stale_excluded | 50,168 | 10.1% | pass |

In this table, `pass` means no regression versus the current full baseline, not
perfect end-to-end workflow quality. The baseline still has its known robust
panel misses.

The first per-slot `strict_required` ablation missed one global evidence/citation
path:

- `medical_leave_accommodation_review / fmla_not_eligible`
- missing section: `corpus/employee-profile.md > Employee Record ER-4471 > Employment Dates`

That section was retrieved elsewhere in the baseline pack but not retained by
the strict per-slot evidence-only variant.

The first workflow-closure attempt fixed the misses but inflated
`strict_required` to `28,866` tokens because it copied globally required sections
into too many slots. That was an implementation problem, not evidence that
strict assembly needed that much context.

The kept method uses workflow-level evidence closure targeted by slot:

- collect all retrieved sections across the workflow
- identify sections that satisfy any workflow evidence or searched-scope
  requirement
- add a required section back only to slots whose fields require that section
- keep output-cited support only for fields that belong to the same slot

## Read

This confirms the suspicion: the current full pack is not close to the minimum
needed by the present eval. The baseline uses `55,794` tokens, while the
workflow-closed oracle floor passes at `14,447` tokens.

Do not turn `strict_required` into an engine method directly: this ablation uses
gold evidence and searched-scope requirements, so it is an oracle lower-bound
diagnostic. Its job is to estimate how small the pack can become if the engine
learns to keep only task-critical evidence and proof.

The next engine work should target a non-oracle approximation of this: keep
required evidence, keep missing-context proof, and add only support that is
likely to be cited or needed for computation/judgment. The `20k-30k` goal looks
realistic because the oracle floor is now well below that range.
