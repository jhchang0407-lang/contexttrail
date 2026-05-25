# Full-Panel Reference Output Scoring

Status: kept

Previous method commit: `706ceee`

Method: generate deterministic reference outputs for all document-workflow fixtures and strengthen final-output scoring. The generated file is an oracle-style upper bound derived from field gold, not a model output. It lets the harness score all 208 fields for value accuracy, citation validity, citation authority, abstention, missing-context explanation quality, decoy authority misuse, and explicit decoy rejection.

Added scoring:

- `citation_authority`: normal citations must not use declared decoy sources and must match the field's expected evidence or searched scope.
- `review_explanation`: missing/conflicting outputs must include an explanation that matches the fixture's review reason.
- `excluded_citations`: final outputs can cite tempting documents only as explicitly rejected evidence with a disposition and reason.

Normal panel result:

| Metric | Result |
| --- | ---: |
| Slot evidence recall | 193/199 |
| Required slots satisfied | 98/106 |
| Evidence section recall | 196/199 |
| Searched-scope coverage | 41/45 |
| Decoy source hits | 30 |

Reference-output result:

| Metric | Result |
| --- | ---: |
| Field accuracy | 179/179 |
| Citation validity | 176/179 |
| Citation authority | 203/208 |
| Abstention quality | 27/29 |
| Review explanation quality | 27/29 |
| Decoy authority misuse | 0 |
| Decoy rejected citations | 5 |

Interpretation: the reference outputs contain the correct values and no decoy misuse, but the context engine still does not assemble enough evidence for five output fields to be fully authoritative. The remaining failures are not output-generator mistakes; they line up with current retrieval/assembly misses:

- `cto_follow_up_context / account_name`: account identity source is still missed by the slot.
- `expansion_timing_review / economic_buyer_engaged`: discovery-call searched-scope proof is not grounded.
- `renewal_pricing_separation_stress / economic_buyer_currently_engaged`: stakeholder-map and discovery-call missing-context proof is incomplete.
- `remote_work_exception_review / remote_tenure_rule`: employee-profile employment dates are still missed by the rule slot.
- `remote_work_exception_review / security_training_current`: same employee-profile section is still missed.

Sample bad-output result:

| Metric | Result |
| --- | ---: |
| Citation authority | 1/3 |
| Abstention quality | 1/2 |
| Review explanation quality | 1/2 |
| Decoy authority misuse | 2 |
| Decoy rejected citations | 1 |

Result: kept. This makes the harness much closer to workflow-completion quality: correct answers are no longer enough if their citations are not grounded in acceptable source dispositions.

Next improvements:

- Fix the five remaining authority failures with generic routing improvements, not vertical-specific rules.
- Add model-generated outputs as a second output track beside the deterministic reference file.
- Promote source dispositions into the actual context pack contract so downstream agents can be instructed to cite only authoritative/supporting sections and to use excluded citations only for abstention reasoning.
