# PRD-0047 residual family diagnostics verdict - 2026-05-14

This report records the local verification evidence for PRD-0047 after adding
residual miss family diagnostics and holdout cross-repo family reporting.

The broad runtime expansion for generic persistence/import/source-profile/CLI
families was tested and rejected for this slice because it regressed the corpus
ranking bar. The final implementation keeps the PRD-0046 runtime ranking shape
and ships the diagnostic layer that tells us which family to target next.

## Commands

- `npm test -- --run src/retrieve/code-family-evidence.test.ts src/retrieve/code-source-mix.test.ts src/eval/code-lane-comparison.test.ts src/eval/cross-repo-code-lane-comparison.test.ts src/eval/agent-completion-probe.test.ts src/eval/prd-0042-promotion-verdict.test.ts src/eval/task-success.test.ts src/mcp/presenter.test.ts src/mcp/schemas.test.ts`
- `npm run build:all`
- `rm -rf .contexttrail`
- `npm run eval:code-lane-comparison`
- `node --input-type=module -e 'import { buildPrd0042ValidationRepos } from "./dist/eval/prd-0042-promotion-verdict.js"; import { runCrossRepoCodeLaneComparison, renderCrossRepoCodeLaneComparison } from "./dist/eval/cross-repo-code-lane-comparison.js"; const report = await runCrossRepoCodeLaneComparison({ repos: buildPrd0042ValidationRepos(process.cwd()) }); process.stdout.write(renderCrossRepoCodeLaneComparison(report));'`
- `npm run eval:real-corpus`

The focused tests passed with 9 files and 136 tests. Build passed. The code-lane
and cross-repo eval commands completed successfully. The broad real-corpus eval
completed with the existing PRD-0016 release-gate failures listed below.

## Code-Lane Comparison

Baseline is `docs/evals/reports/prd-0046-promotion-verdict-2026-05-14.md`.

| Metric | PRD-0046 baseline | PRD-0047 final | Delta |
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

An intermediate runtime expansion regressed ranked code-file coverage to 53/66
and prompt variant top-3 to 23/42. That method is intentionally not promoted.

## Primary Residual Families

| Family | Files | Missing from ranked | Ranked below top 3 | Support missing | Body only |
| --- | ---: | ---: | ---: | ---: | ---: |
| persistence_substrate | 5 | 7 | 6 | 12 | 0 |
| import_workflow | 8 | 3 | 8 | 8 | 0 |
| source_profile_storage | 3 | 1 | 8 | 4 | 0 |
| other | 5 | 0 | 5 | 2 | 0 |
| cli_workflow | 1 | 1 | 0 | 1 | 0 |
| retrieval_index | 1 | 0 | 1 | 1 | 0 |

The highest-volume remaining gaps are persistence substrate, import workflow,
and source-profile storage. The diagnostics now make those misses visible as
families, not just scattered individual target files.

## Cross-Repo Holdout

Holdout repository: `Ralph`.

| Metric | Result |
| --- | ---: |
| Ranked code-file coverage | 3/9 (33.3%) |
| Code top-1 acceptable | 0/4 (0.0%) |
| Code ranked useful | 3/4 (75.0%) |
| Support-cluster useful | 0/4 (0.0%) |
| Prompt variant top-1 | 0/12 (0.0%) |
| Prompt variant top-3 | 0/12 (0.0%) |
| Prompt variant ranked | 3/12 (25.0%) |

| Family | Files | Missing from ranked | Ranked below top 3 | Support missing | Body only |
| --- | ---: | ---: | ---: | ---: | ---: |
| retrieval_index | 3 | 4 | 0 | 4 | 0 |
| other | 2 | 2 | 0 | 2 | 0 |
| cli_workflow | 3 | 0 | 3 | 3 | 0 |

The holdout confirms the diagnostics generalize, but it also confirms that
generic CLI workflow support should not be promoted without a narrower method:
Ralph still needs retrieval/artifact index companions plus runner/validator
support that can improve top-3 ordering, not just ranked recall.

## Real-Corpus Guardrail

The broad real-corpus verdict remains `FAIL` on the same PRD-0016 release gates
tracked before this slice:

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

PRD-0047 is complete as a diagnostics slice and preserves the PRD-0046 runtime
ranking bar. It is not a runtime-ranking promotion slice.

The next implementation slice should target one family at a time, starting with
persistence substrate or import workflow support, and require a code-lane eval
lift before broadening support admission.
