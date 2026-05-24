# PRD-0046 prompt-invariant code first-slate verdict - 2026-05-14

This report records the local verification evidence for PRD-0046 after adding reusable code-family evidence, bounded first-slate reranking, support-cluster family evidence, and compact broad-query projection for oversized code chunks.

## Commands

- `npm test -- --run src/retrieve/code-family-evidence.test.ts src/retrieve/code-source-mix.test.ts src/eval/agent-completion-probe.test.ts src/eval/code-lane-comparison.test.ts src/eval/prd-0042-promotion-verdict.test.ts src/eval/task-success.test.ts src/mcp/presenter.test.ts src/mcp/schemas.test.ts`
- `npm run build`
- `npm run eval:code-lane-comparison`
- `npm run eval:real-corpus`

All commands completed successfully on 2026-05-14 in the local DriftLedger workspace.

## Code-Lane Comparison

Baseline is `docs/evals/reports/prd-0045-code-lane-baseline-2026-05-14.md`.

| Metric | PRD-0045 baseline | PRD-0046 result | Delta |
| --- | ---: | ---: | ---: |
| Ranked code-file coverage | 53/66 (80.3%) | 54/66 (81.8%) | +1 |
| Code top-1 acceptable | 12/14 (85.7%) | 12/14 (85.7%) | 0 |
| Code ranked useful | 14/14 (100.0%) | 14/14 (100.0%) | 0 |
| Support-cluster useful | 13/14 (92.9%) | 14/14 (100.0%) | +1 |
| Prompt variant top-1 | 19/42 (45.2%) | 20/42 (47.6%) | +1 |
| Prompt variant top-3 | 22/42 (52.4%) | 26/42 (61.9%) | +4 |
| Prompt variant ranked | 41/42 (97.6%) | 41/42 (97.6%) | 0 |
| Tickets top-3 robust | 2/14 | 5/14 | +3 |
| Tickets ranked robust | 13/14 | 13/14 | 0 |

## Real-Corpus Guardrail

The broad real-corpus verdict remains `FAIL` on the same PRD-0016 release gates tracked before this slice:

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

PRD-0046 is ready for review. The method improves prompt-variant top-3 usefulness and support-cluster usefulness while preserving ranked usefulness and the real-corpus no-regression guardrails.
