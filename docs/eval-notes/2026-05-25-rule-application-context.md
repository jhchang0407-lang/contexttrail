# Rule-Application Context

Status: kept

Previous method commit: `d95fc92`

Method: for generic rule, constraint, and exception slots, let the slot pull one fact-like section that helps apply the rule. The scorer uses task text, slot purpose, slot fields, sibling-source support, fact-like headings, numeric/status signals, and stale/non-current penalties. It does not use expected values, gold evidence sections, or vertical-specific labels.

Why this is generic: office workflows often need a policy/rule plus a record/status/date/amount section to apply that rule. This method targets that pattern without encoding insurance, HR, sales, vendor, or finance concepts.

Implementation note: `ruleApplicationK=2` looked stronger on recall but added a decoy source hit (`31` vs `30`), so it was not kept. The kept version uses `ruleApplicationK=1` with an ID guard and stale/non-current penalties.

Incremental full panel comparison:

| Metric | Checkpoint | Rule-application context |
| --- | ---: | ---: |
| Slot evidence recall | 191/199 (96.0%) | 192/199 (96.5%) |
| Required slots satisfied | 95/106 (89.6%) | 96/106 (90.6%) |
| Evidence section recall | 195/199 (98.0%) | 195/199 (98.0%) |
| Searched-scope coverage | 38/45 (84.4%) | 38/45 (84.4%) |
| Decoy source hits | 30 | 30 |

Holdout mutation comparison:

| Mutation | Checkpoint | Rule-application context |
| --- | ---: | ---: |
| broad_task_queries | 19/21 (90.5%) | 19/21 (90.5%) |
| minimal_task_queries | 17/21 (81.0%) | 17/21 (81.0%) |
| corpus_noise | 20/21 (95.2%) | 20/21 (95.2%) |

Result: kept as a small but clean improvement. It fixes one class of miss where a rule slot needs a nearby record/date/status section to apply the rule, while avoiding the earlier false-positive expansion. Remaining misses are now more concentrated in missing-context proof, expected-place search, and alias/status wording.
