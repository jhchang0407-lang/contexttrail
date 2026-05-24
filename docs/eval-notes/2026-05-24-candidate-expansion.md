# Candidate Expansion Before Final Top-K

Status: kept

Baseline commit: `c60ccb9`

Method: keep retrieval unchanged, but let each context slot select its top 5 sections from a wider candidate pool of 12. The slot reranker uses only non-gold signals: slot purpose, role, kind, authored queries, optional filters, field ids/labels, heading/source tokens, and section text. It does not use expected values or evidence requirements.

Full panel comparison:

| Metric | Baseline | Candidate expansion |
| --- | ---: | ---: |
| Slot evidence recall | 163/199 (81.9%) | 182/199 (91.5%) |
| Required slots satisfied | 69/106 (65.1%) | 87/106 (82.1%) |
| Evidence section recall | 179/199 (89.9%) | 188/199 (94.5%) |
| Searched-scope coverage | 30/45 (66.7%) | 37/45 (82.2%) |
| Human review load | 49/208 | 40/208 |
| Decoy source hits | 36 | 30 |

Holdout mutation comparison:

| Mutation | Baseline required slots | Candidate expansion required slots |
| --- | ---: | ---: |
| broad_task_queries | 10/21 (47.6%) | 16/21 (76.2%) |
| minimal_task_queries | 5/21 (23.8%) | 13/21 (61.9%) |
| corpus_noise | 11/21 (52.4%) | 17/21 (81.0%) |

Result: the method directly attacks `rejected_in_slot` misses and also improves searched-scope and noisy-corpus robustness. Residual misses are now mostly wrong-section failures inside the right source, especially relationship-history and identity/rules splits.
