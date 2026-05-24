# Expected-Place Search

Status: kept

Previous method commit: `47da72b`

Method: for `missing_check` slots, add up to two generic "expected place" sections from sources already grounded by the current slot or sibling slots. The scorer looks for office-work proof locations such as identity, status, exceptions, notes, relationship/stakeholder, statement, ledger, and thread sections, plus absence language. It does not use expected values or gold searched-scope sections.

Why this is generic: proving that something is missing usually requires checking the place where that fact would normally appear, not just retrieving text that says "missing." This pattern applies across policies, contracts, payments, claims, HR records, sales history, and vendor packets.

Implementation note: an earlier ordering let expected-place sections displace the narrower absence verifier and caused one extra decoy source hit. The kept version runs expected-place after absence verification and requires current/sibling source support, so it fills likely places inside already-relevant sources instead of roaming the corpus.

Incremental full panel comparison:

| Metric | Rule-application context | Expected-place search |
| --- | ---: | ---: |
| Slot evidence recall | 192/199 (96.5%) | 192/199 (96.5%) |
| Required slots satisfied | 96/106 (90.6%) | 97/106 (91.5%) |
| Evidence section recall | 195/199 (98.0%) | 195/199 (98.0%) |
| Searched-scope coverage | 38/45 (84.4%) | 41/45 (91.1%) |
| Decoy source hits | 30 | 30 |

Mutation aggregate comparison:

| Mutation | Rule required/scope/decoys | Expected-place required/scope/decoys |
| --- | ---: | ---: |
| broad_task_queries | 91/106, 35/45, 29 | 93/106, 39/45, 29 |
| minimal_task_queries | 74/106, 32/45, 23 | 75/106, 34/45, 23 |
| corpus_noise | 96/106, 38/45, 27 | 97/106, 41/45, 27 |

Holdout mutation comparison:

| Mutation | Rule-application context | Expected-place search |
| --- | ---: | ---: |
| broad_task_queries | 19/21 (90.5%) | 19/21 (90.5%) |
| minimal_task_queries | 17/21 (81.0%) | 17/21 (81.0%) |
| corpus_noise | 20/21 (95.2%) | 20/21 (95.2%) |

Result: kept. This is a meaningful searched-scope improvement with no decoy regression and no holdout regression. Remaining misses are mostly regular evidence misses where the right section is still rejected or selected by another slot, plus one missing-context case where the source never enters any grounded slot.
