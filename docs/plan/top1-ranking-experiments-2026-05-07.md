# Top-1 Ranking Experiments — 2026-05-07

Baseline checkpoint:
- overall `Top-1 acceptable`: `61.5%`
- anchored `Top-1 acceptable`: `87.7%`
- `cross_module_boundary Top-1 acceptable`: `68.4%`
- overall `ranked useful`: `91.0%`
- anchored `ranked useful`: `98.5%`
- `cross_module_boundary ranked useful`: `100.0%`

Guardrails:
- keep all retrieval gates green
- do not regress overall or anchored `ranked useful`
- do not worsen distractor resistance

## Leaderboard

| Method | Status | Overall Top-1 | Anchored Top-1 | Cross-module Top-1 | Ranked useful | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Source-support sibling inheritance | reject | 61.5% | 87.7% | 68.4% | 91.0% | Safe but inert on the real fixture; did not move live cross-module misses. |
| Representative chunk selection | reject | 60.7% | 86.2% | 63.2% | 91.0% | Front-door chunk shaping hurt first-read quality across anchored cross-module cases. |
| Anchor-kind precedence | keep | 62.3% | 89.2% | 73.7% | 91.0% | Module-level anchor support was the first clean lift on the real fixture. |
| Module specificity precedence | reject | 61.5% | 87.7% | 68.4% | 91.0% | No Top-1 lift; slightly weakened `Must@3` coverage and existing presenter expectations. |
| Fallback contributor promotion | keep | 63.9% | 92.3% | 84.2% | 91.0% | File anchors that only contributed cards now promote the best matching module chunk, which fixed the earlier auth three-file shape. |
| File-only strong-score override | reject | 63.9% | 92.3% | 84.2% | 91.0% | Fixed one billing miss but broke another; no net benchmark lift. |
| Earlier file-anchor precedence | keep | 64.8% | 93.8% | 89.5% | 91.0% | Best overall result so far. For all-file multi-scope anchored queries, earlier explicit file anchors now break first-read ties before weaker contributor heuristics. |
| Route-over-symbol module support | keep | 65.6% | 95.4% | 94.7% | 91.0% | Best result so far. For pure symbol-plus-route anchored queries, route-backed modules get stronger first-read support than symbol-backed siblings, which fixes the last real cross-module auth miss without touching file-based cases. |

## Notes

- Test one method at a time from the clean baseline.
- Roll back immediately if a method regresses the fixture.
- Current best checkpoint leaves only one cross-module Top-1 miss:
  - `anchored-billing-large`
- `anchored-billing-large` is a large-budget ambiguous case, so the practical cross-module Top-1 work is effectively complete on the current fixture.
