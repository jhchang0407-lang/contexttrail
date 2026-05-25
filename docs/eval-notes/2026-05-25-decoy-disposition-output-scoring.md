# Decoy Disposition and Output Scoring

Status: kept

Previous method commit: `155a367`

Method: add a source-disposition layer to context-pack traces and final-output scoring for decoy use. Retrieved sections are labelled as `authoritative`, `supporting`, `contradictory`, `excluded_non_authoritative`, or `stale_or_wrong_scope`. Agent outputs can now include `excluded_citations` for sources that were intentionally rejected, while ordinary `citations` from declared decoy sources are counted as decoy authority misuse.

Why this is generic: office work often requires looking at tempting but non-authoritative documents, such as drafts, templates, old records, similar entities, and requested-but-not-accepted terms. The important product behavior is not simply "never retrieve a decoy"; it is "do not let a decoy become authority unless it is explicitly marked as rejected."

Normal panel comparison:

| Metric | Previous checkpoint | With disposition/scoring |
| --- | ---: | ---: |
| Slot evidence recall | 193/199 | 193/199 |
| Required slots satisfied | 98/106 | 98/106 |
| Evidence section recall | 196/199 | 196/199 |
| Searched-scope coverage | 41/45 | 41/45 |
| Decoy source hits | 30 | 30 |

Mutation aggregate comparison:

| Mutation | Required/scope/section/decoys |
| --- | ---: |
| broad_task_queries | 93/106, 39/45, 188/199, 29 |
| minimal_task_queries | 75/106, 34/45, 158/199, 23 |
| corpus_noise | 98/106, 41/45, 196/199, 27 |

Sample output-scoring result:

| Metric | Result |
| --- | ---: |
| Field accuracy | 1/1 |
| Citation validity | 0/1 |
| Abstention quality | 1/2 |
| Decoy authority misuse fields | 2 |
| Decoy authority citations | 2 |
| Decoy rejected citations | 1 |

Interpretation: the sample output intentionally has one correct decoy rejection and two decoy misuses. The scorer now distinguishes these cases:

- `data_confidentiality_review / data_residency_requirement`: safe rejection of a non-binding policy memo.
- `post_termination_data_return_review / us_only_hosting_requirement`: misuse of the same policy memo as authority.
- `three_way_match_review / invoice_total`: misuse of an older invoice as an authority citation, causing citation validity to fail despite the answer value being correct.

Result: kept. This change does not alter retrieval quality, but it makes the eval stricter and more diagnostic for final agent behavior.

Next improvements:

- Add generated agent outputs for more workflows, not just the three sample fields.
- Require every decoy retrieved in context to receive a disposition before pack assembly is considered complete.
- Add a "missing-context explanation quality" score for whether excluded decoys and searched-scope evidence justify abstention.
- Track whether final answers cite only `authoritative` or acceptable `supporting` sections.
