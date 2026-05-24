# Absence Verifier

Status: kept after narrowing

Previous method commit: `d7d634c`

Method: for `missing_check` slots, add a narrow absence-verification pass that can pull 1 extra section with both slot salience and absence signals such as missing, pending, no record, not confirmed, gap, hold, or exception. This targets missing-context work, where the engine must prove what it searched rather than only retrieve positive answer evidence.

Implementation check:

The first pass allowed 2 absence verifier sections. It improved full-panel searched-scope from 38/45 to 40/45, but raised decoy source hits from 30 to 34. That looked like an implementation problem: the method was too eager and picked absence-like language from declared decoys.

Final setting: 1 absence verifier section.

Incremental full panel comparison:

| Metric | Cross-slot pool | Absence verifier |
| --- | ---: | ---: |
| Slot evidence recall | 191/199 (96.0%) | 191/199 (96.0%) |
| Required slots satisfied | 95/106 (89.6%) | 95/106 (89.6%) |
| Evidence section recall | 195/199 (98.0%) | 195/199 (98.0%) |
| Searched-scope coverage | 38/45 (84.4%) | 38/45 (84.4%) |
| Human review load | 33/208 | 33/208 |
| Decoy source hits | 30 | 30 |

Holdout mutation comparison:

| Mutation | Cross-slot pool required slots | Absence verifier required slots |
| --- | ---: | ---: |
| broad_task_queries | 19/21 (90.5%) | 19/21 (90.5%) |
| minimal_task_queries | 16/21 (76.2%) | 17/21 (81.0%) |
| corpus_noise | 20/21 (95.2%) | 20/21 (95.2%) |

Result: the narrowed verifier improves the hardest minimal-query holdout without increasing decoy hits or full-panel review load. The wider version was rejected as too noisy.
