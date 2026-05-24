# Alias/Status Evidence

Status: kept

Previous method commit: `6c2180d`

Method: for `role: evidence` slots, add one high-confidence supplemental section from the candidate pool when compact field language matches split heading/body evidence. This covers cases like `DPA signed` matching a section headed `DPA Status` whose body says `Data Processing Addendum signed`, without reordering or replacing the original top evidence.

Why this is generic: business packets often use abbreviations, status headings, and split evidence. The method is not vertical-specific; it recognizes acronyms and field-token coverage inside evidence packets.

Implementation note: the first attempt boosted the main reranker. That improved recall, but it also displaced required evidence and increased decoy hits. The kept version is additive, limited to `role: evidence`, and uses explicit uppercase acronym terms plus field-token coverage. A broader rules-slot version was rejected after the corpus-noise mutation pulled a template-policy decoy.

Incremental full panel comparison:

| Metric | Expected-place search | Alias/status evidence |
| --- | ---: | ---: |
| Slot evidence recall | 192/199 (96.5%) | 193/199 (97.0%) |
| Required slots satisfied | 97/106 (91.5%) | 98/106 (92.5%) |
| Evidence section recall | 195/199 (98.0%) | 196/199 (98.5%) |
| Searched-scope coverage | 41/45 (91.1%) | 41/45 (91.1%) |
| Decoy source hits | 30 | 30 |

Mutation aggregate comparison:

| Mutation | Expected-place required/scope/section/decoys | Alias/status required/scope/section/decoys |
| --- | ---: | ---: |
| broad_task_queries | 93/106, 39/45, 186/199, 29 | 93/106, 39/45, 188/199, 29 |
| minimal_task_queries | 75/106, 34/45, 158/199, 23 | 75/106, 34/45, 158/199, 23 |
| corpus_noise | 97/106, 41/45, 195/199, 27 | 98/106, 41/45, 196/199, 27 |

Holdout mutation comparison:

| Mutation | Expected-place search | Alias/status evidence |
| --- | ---: | ---: |
| broad_task_queries | 19/21 (90.5%) | 19/21 (90.5%) |
| minimal_task_queries | 17/21 (81.0%) | 17/21 (81.0%) |
| corpus_noise | 20/21 (95.2%) | 20/21 (95.2%) |

Result: kept. The method fixes the vendor compliance packet miss around DPA status while keeping decoys and holdouts flat. Remaining misses are now mostly harder routing problems: same-source wrong section, rejected rank-6 sections in non-evidence roles, and one relationship-history searched-scope source that never becomes grounded.
