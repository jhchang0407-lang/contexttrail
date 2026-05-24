# PRD-0045 code-lane baseline - 2026-05-14

This is the baseline after eval diagnostic hardening and before applying new retrieval methods for PRD-0045 bounded code support-cluster retrieval.

## Commands

- `rm -rf .contexttrail && npm run eval:code-lane-comparison`
- `rm -rf .contexttrail && npm run eval:real-corpus`

Both commands completed successfully on 2026-05-14 in the local DriftLedger workspace.

## Code-lane comparison baseline

| Metric | Old file-card lane | New chunk-first lane |
| --- | ---: | ---: |
| Ranked code-file coverage | 0/66 (0.0%) | 53/66 (80.3%) |
| Code top-1 acceptable | 0/14 (0.0%) | 12/14 (85.7%) |
| Code ranked useful | 0/14 (0.0%) | 14/14 (100.0%) |
| Support-cluster useful | 0/14 (0.0%) | 13/14 (92.9%) |
| Prompt variant top-1 | 0/42 (0.0%) | 19/42 (45.2%) |
| Prompt variant top-3 | 0/42 (0.0%) | 22/42 (52.4%) |
| Prompt variant ranked | 0/42 (0.0%) | 41/42 (97.6%) |
| Top-3 hit / top-1 miss | 0/14 (0.0%) | 0/14 (0.0%) |
| Ranked hit below top-3 | 0/14 (0.0%) | 2/14 (14.3%) |
| Ranked miss | 14/14 (100.0%) | 0/14 (0.0%) |

Prompt-variant detail for the new lane:

- Prompt support useful: 25/42 (59.5%)
- Prompt ranked-file hits: 116/198 (58.6%)
- Tickets top-1 robust: 1/14
- Tickets top-3 robust: 2/14
- Tickets ranked robust: 13/14

## Code-lane diagnostic targets

| Target file | Tickets | Missing from ranked | Ranked below top-3 | Support missing | Body only |
| --- | --- | ---: | ---: | ---: | ---: |
| `src/types/source-profile.ts` | THO-213, THO-217, THO-220, THO-223, THO-228 | 1 | 4 | 2 | 0 |
| `src/store/schema.ts` | THO-213, THO-217, THO-220, THO-228 | 4 | 0 | 4 | 0 |
| `src/cli/import.ts` | THO-213, THO-224, THO-229 | 1 | 2 | 1 | 1 |
| `src/store/db.ts` | THO-213, THO-217, THO-224, THO-228 | 2 | 1 | 4 | 0 |
| `src/retrieve/source-card.ts` | THO-213, THO-217, THO-220, THO-228 | 0 | 3 | 4 | 0 |
| `src/store/chunks.ts` | THO-224, THO-225 | 1 | 1 | 2 | 0 |
| `src/parse/source-profile.ts` | THO-217, THO-220, THO-228 | 0 | 2 | 2 | 0 |
| `src/store/source-profiles.ts` | THO-217, THO-220 | 0 | 2 | 2 | 0 |

## Real-corpus guardrail baseline

PRD-0016 release verdict: FAIL.

Failed gates:

- `true_top_3_misses_target`
- `top_3_hit_top_1_miss_target`

| Gate | Baseline | Current | Result | Detail |
| --- | ---: | ---: | --- | --- |
| Answer top-1 improvement | 105 | 147 | PASS | target >= 112/174 |
| Answer top-3 no regression | 118 | 166 | PASS | must remain >= 118 |
| True top-3 misses target | 4 | 8 | FAIL | target <= 2 |
| Top-3 hit, top-1 miss target | 13 | 19 | FAIL | target <= 6 |
| Signal-empty coverage honest | 26 | 26 | PASS | must remain >= 26/26 |
| Combined coverage honest | 148 | 200 | PASS | must remain >= 148/200 |
| Agent answer no regression | 147 | 197 | PASS | must remain >= 147/200 |
| Query mode no regression | 107 | 161 | PASS | must remain >= 107/200 |
| Chunk correctness no regression | 3/3 | 3/3 | PASS | chunk-correct count must remain >= 3 |
| Payload size no bloat | 371523 | 371523 | PASS | avg bytes growth <= 5%; current 0.0% |
| Synthetic regression | passed | passed | PASS | synthetic fixture must pass |

## Reading

The main code-lane weakness is not broad recall. The new lane finds a useful ranked result for 41/42 prompt variants, but only 22/42 variants have a useful top-3 slate and only 2/14 tickets are top-3 robust across prompts.

The next implementation methods should therefore focus on prompt-invariant first-slate ordering and bounded support inclusion, especially around the repeated SourceProfile, store schema/db, import/reindex, and source-card families. Avoid corpus-specific aliases or path hints; the useful architectural direction is to expose real code-family relationships that lift already-found implementation-relevant files into the first slate without damaging the real-corpus document guardrail.
