# PRD-0048 family-ranking promotion verdict - 2026-05-15

This report records the local verification evidence for PRD-0048 after adding
targeted code-lane family evidence and guardrails for persistence, import
workflow, SourceProfile storage, and holdout family diagnostics.

The PRD-0047 final baseline is the comparison point. The rejected PRD-0047
intermediate broad expansion remains rejected: this slice does not promote a
generic family-support flood.

## Commands

- `npm test -- --run src/retrieve/code-family-evidence.test.ts src/retrieve/code-source-mix.test.ts`
- `npm test -- --run src/retrieve/code-family-evidence.test.ts src/retrieve/code-source-mix.test.ts src/eval/code-lane-comparison.test.ts src/eval/cross-repo-code-lane-comparison.test.ts src/eval/agent-completion-probe.test.ts src/eval/prd-0042-promotion-verdict.test.ts src/eval/task-success.test.ts src/mcp/presenter.test.ts src/mcp/schemas.test.ts`
- `npm run build:all`
- `npm run eval:code-lane-comparison`
- `node --input-type=module -e 'import { buildPrd0042ValidationRepos } from "./dist/eval/prd-0042-promotion-verdict.js"; import { runCrossRepoCodeLaneComparison, renderCrossRepoCodeLaneComparison } from "./dist/eval/cross-repo-code-lane-comparison.js"; const report = await runCrossRepoCodeLaneComparison({ repos: buildPrd0042ValidationRepos(process.cwd()) }); process.stdout.write(renderCrossRepoCodeLaneComparison(report));'`
- `npm run eval:real-corpus`

The first TDD red check failed as intended before the persistence narrowing:
generic `session-storage` was admitted as persistence support. After the fix,
the focused persistence/import/SourceProfile/retrieval-index tests passed. The
broader focused suite passed with 9 files and 139 tests. Build passed.

## Code-Lane Comparison

Baseline is `docs/evals/reports/prd-0047-promotion-verdict-2026-05-14.md`.

| Metric | PRD-0047 final | PRD-0048 final | Delta |
| --- | ---: | ---: | ---: |
| Ranked code-file coverage | 54/66 (81.8%) | 54/66 (81.8%) | 0 |
| Code top-1 acceptable | 12/14 (85.7%) | 12/14 (85.7%) | 0 |
| Code ranked useful | 14/14 (100.0%) | 14/14 (100.0%) | 0 |
| Support-cluster useful | 14/14 (100.0%) | 14/14 (100.0%) | 0 |
| Prompt variant top-1 | 20/42 (47.6%) | 20/42 (47.6%) | 0 |
| Prompt variant top-3 | 26/42 (61.9%) | 26/42 (61.9%) | 0 |
| Prompt variant ranked | 41/42 (97.6%) | 41/42 (97.6%) | 0 |
| Tickets top-3 robust | 5/14 | 5/14 | 0 |
| Tickets ranked robust | 13/14 | 13/14 | 0 |

## Residual Family Movement

| Family | PRD-0047 missing/ranked-below/support/body | PRD-0048 missing/ranked-below/support/body | Verdict |
| --- | --- | --- | --- |
| persistence_substrate | 7 / 6 / 12 / 0 | 7 / 6 / 11 / 0 | promoted: targeted store-only narrowing reduced support misses without aggregate regression |
| import_workflow | 3 / 8 / 8 / 0 | 3 / 8 / 8 / 0 | promoted as guarded behavior tests, neutral eval movement |
| source_profile_storage | 1 / 8 / 4 / 0 | 1 / 8 / 4 / 0 | promoted as guardrail coverage, neutral eval movement |
| retrieval_index | 0 / 1 / 1 / 0 | 0 / 1 / 1 / 0 | deferred for runtime promotion |
| cli_workflow | 1 / 0 / 1 / 0 | 1 / 0 / 1 / 0 | rejected as broad runtime method; diagnostics remain |

## Holdout

Ralph still reports the same useful diagnostic buckets:

| Family | Files | Missing from ranked | Ranked below top 3 | Support missing | Body only |
| --- | ---: | ---: | ---: | ---: | ---: |
| retrieval_index | 3 | 4 | 0 | 4 | 0 |
| other | 2 | 2 | 0 | 2 | 0 |
| cli_workflow | 3 | 0 | 3 | 3 | 0 |

The holdout did not clear the runtime-promotion gate. No repository-specific
aliases, ticket IDs, or expected-file hints were added. The safe outcome for
48.4 is to keep diagnostics and synthetic retrieval-index evidence while
deferring runner/validator/CLI runtime promotion.

## Real-Corpus Guardrail

The broad real-corpus verdict remains `FAIL` on the existing PRD-0016 release
targets:

- `true_top_3_misses_target`
- `top_3_hit_top_1_miss_target`

No no-regression guardrail failed:

| Gate | Result |
| --- | --- |
| Answer top-1 improvement | PASS |
| Answer top-3 no regression | PASS |
| Signal-empty coverage honest | PASS |
| Combined coverage honest | PASS |
| Agent answer no regression | PASS |
| Query mode no regression | PASS |
| Chunk correctness no regression | PASS |
| Payload size no bloat | PASS, current growth 0.0% |
| Synthetic regression | PASS |

## Verdict

Promoted:

- Targeted persistence substrate support with store-only direct-token hygiene.
- Import-workflow support behavior guarded by synthetic and retrieval tests.
- SourceProfile storage support guardrails that avoid broad source-card
  promotion.
- Residual family diagnostics in paired and cross-repo reports.

Deferred or rejected:

- Broad CLI workflow promotion is rejected for this slice.
- Ralph holdout retrieval-index and runner/validator runtime promotion is
  deferred until it can improve top-3 or support usefulness without weakening
  the ContextTrail baseline.

The PRD-0048 runtime state preserves the PRD-0047 aggregate bar and improves one
targeted persistence-family support miss. The baseline should not be ratcheted
yet; the next slice should target the remaining `persistence_substrate` schema/db
misses or the `import_workflow` ranked-below-top-3 pressure with another narrow
eval-gated method.
