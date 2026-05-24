# Cross-Slot Evidence Pool

Status: kept

Previous method commit: `65f00d5`

Method: after each slot assembles its own sections, allow a slot to reuse up to 2 high-salience sections found by sibling slots in the same workflow. The reuse scorer uses slot purpose, role, kind, field ids/labels, queries, and section text; it does not use expected values or gold evidence.

Incremental full panel comparison:

| Metric | Source sweep | Cross-slot pool |
| --- | ---: | ---: |
| Slot evidence recall | 191/199 (96.0%) | 191/199 (96.0%) |
| Required slots satisfied | 94/106 (88.7%) | 95/106 (89.6%) |
| Evidence section recall | 195/199 (98.0%) | 195/199 (98.0%) |
| Searched-scope coverage | 37/45 (82.2%) | 38/45 (84.4%) |
| Human review load | 33/208 | 33/208 |
| Decoy source hits | 30 | 30 |

Holdout mutation comparison:

| Mutation | Source sweep required slots | Cross-slot pool required slots |
| --- | ---: | ---: |
| broad_task_queries | 19/21 (90.5%) | 19/21 (90.5%) |
| minimal_task_queries | 16/21 (76.2%) | 16/21 (76.2%) |
| corpus_noise | 20/21 (95.2%) | 20/21 (95.2%) |

Result: the method is a modest improvement, mainly on workflow-level searched-scope reuse. It did not create the feared regression where one slot's noisy context pollutes another slot; decoy hits and review load stayed flat. The remaining misses now point more strongly at absence verification and field-specific section targeting.
