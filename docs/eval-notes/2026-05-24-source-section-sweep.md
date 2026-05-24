# Source-First Section Sweep

Status: kept

Previous method commit: `36852af`

Method: after slot candidate expansion selects the top sections, sweep up to 2 additional high-salience sections from the same selected sources. The sweep uses the same non-gold slot salience signal as candidate expansion and is intended to rescue right-source/wrong-section misses without widening the search to unrelated documents.

Incremental full panel comparison:

| Metric | Candidate expansion | Source sweep |
| --- | ---: | ---: |
| Slot evidence recall | 182/199 (91.5%) | 191/199 (96.0%) |
| Required slots satisfied | 87/106 (82.1%) | 94/106 (88.7%) |
| Evidence section recall | 188/199 (94.5%) | 195/199 (98.0%) |
| Searched-scope coverage | 37/45 (82.2%) | 37/45 (82.2%) |
| Human review load | 40/208 | 33/208 |
| Decoy source hits | 30 | 30 |

Holdout mutation comparison:

| Mutation | Candidate expansion required slots | Source sweep required slots |
| --- | ---: | ---: |
| broad_task_queries | 16/21 (76.2%) | 19/21 (90.5%) |
| minimal_task_queries | 13/21 (61.9%) | 16/21 (76.2%) |
| corpus_noise | 17/21 (81.0%) | 20/21 (95.2%) |

Result: the method reduces right-source/wrong-section misses and improves relationship-history and numeric lanes without increasing decoy source hits or over-budget slots. It does not improve searched-scope gaps because those usually require absence verification rather than more positive evidence from already selected sources.
