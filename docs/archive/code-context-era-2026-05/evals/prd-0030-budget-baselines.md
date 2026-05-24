# PRD-0030 Budget Baselines

> **2026-05-11 amendment (PRD-0032 closure).** The retention numbers below have been re-measured after two structural changes shipped:
> 1. `src/cli/import.ts` now sorts `fg.sync` output, which stabilizes FTS5 insertion order across runs. This change alone raised the 16k file-level retention from 16/66 to 50/66 — the original baseline was masking a non-determinism artifact, not measuring engine ceiling.
> 2. `src/eval/budgeted-pack.ts` ships a kind-balanced packing lever (`RETRIEVAL_PACK_KIND_BALANCED`, default **on**) that reserves 30% of the post-locked budget for `code` kind entries. This lifts 16k file-level retention from 50/66 to 63/66.
>
> See `docs/evals/prd-0032-composition-audit.md` (the audit that justified the lever) and `docs/evals/prd-0032-verification.md` (the verification artifact).

Measured on 2026-05-11 from `/Users/thomaschang/Repos/ContextTrail`.

Commands:

- `npx tsx src/eval/real-workflow-probe.ts --budget-sweep=4096,8192,16384`
- `npx tsx src/eval/agent-completion-probe.ts --budget-sweep=4096,8192,16384`
- Reference default-budget runs: `--budget=6000` for both probes.

Boundary: PRD-0030 is eval-only. The defects below are named and classified, but intentionally not fixed here.

## Retention Curves (original, masked by non-determinism)

These were the original PRD-0030 baseline numbers. They are preserved here as the historical record of what the gate looked like before the PRD-0032 import-sort fix and kind-balanced lever shipped.

| budget | workflow doc-level | workflow chunk-level | agent-completion file-level |
|---:|---:|---:|---:|
| 4096 | 18/23 (78.3%) | 14/22 (63.6%) | 8/66 (12.1%) |
| 8192 | 22/23 (95.7%) | 17/22 (77.3%) | 12/66 (18.2%) |
| 16384 | 22/23 (95.7%) | 21/22 (95.5%) | 16/66 (24.2%) |
| 6000 reference | 17/23 (73.9%) | 15/22 (68.2%) | 9/66 (13.6%) |

## Retention Curves (post-PRD-0032)

After the determinism fix and kind-balanced packing lever. Agent-completion file-level retention is the headline change — at 16k it now exceeds the legacy unbudgeted ceiling of 62/66 (now ratcheted to 65/66 in ADR-0021) by 63/66 (95.5%). Workflow numbers are unchanged.

| budget | workflow doc-level | agent-completion file-level (post import-sort, flag-on) |
|---:|---:|---:|
| 16384 | 22/23 (95.7%) | 63/66 (95.5%) |
| default (6000) | 22/23 (95.7%) | 65/66 (98.5%) — legacy unbudgeted path |

The legacy default gate (CI's assembly-gates.yml job) uses `pack.ranked` directly without `--budget`. It now measures 65/66 files / 13/14 commits — ratcheted into ADR-0021 baselines. The kind-balanced flag is structurally inert on this path because no budget re-truncation runs.

## Classification

| defect | metric | classification | evidence | disposition |
|---|---|---|---|---|
| PRD30-D1: low-budget workflow support docs fall out | workflow doc-level | truncation drop | 4096 serves 18/23; 8192 and 16384 serve 22/23. The extra 4096 misses are THO-227, THO-203, THO-204, and THO-211; THO-185 is the known missing-source stub. | Tolerated for now. Follow-up candidate: budget-aware support-doc preservation. |
| PRD30-D2: workflow chunk coverage needs larger budgets | workflow chunk-level | truncation drop | 4096 covers 14/22 chunks; 8192 covers 17/22; 16384 covers 21/22. THO-223, THO-216, THO-203, THO-207, THO-226, THO-211, and PRD-0026-stub recover only at larger budgets. | Tolerated for now. Follow-up candidate: chunk-aware packing under traversal. |
| PRD30-D3: THO-214 chunk is missed even at 16k | workflow chunk-level | always-missed | The PRD-0023 boost-composition annotation is still 0/1 at 16384. | Tolerated for now. Follow-up candidate: source-local chunk selector audit for source-rerank tickets. |
| PRD30-D4: agent-completion files are mostly trimmed from budgeted final packs | agent-completion file-level | truncation drop | Budgeted survival reaches only 16/66 at 16384, while the legacy unbudgeted pack mentions 62/66. This means most code-file evidence exists in the assembled candidate list but does not survive the measured token budget. | **Resolved 2026-05-11 by PRD-0032.** The audit (`docs/evals/prd-0032-composition-audit.md`) classified 88.5% as `kind_displaced`. The kind-balanced packing lever ships in `src/eval/budgeted-pack.ts` and raises 16k file-level retention to 63/66 (95.5%). Verification at `docs/evals/prd-0032-verification.md`. |
| PRD30-D5: four source files remain absent from the legacy unbudgeted agent metric | agent-completion file-level | always-missed | Legacy no-budget path misses the structural chunk-context flag, CLI reindex command, store reindex helper, and chunk-structural-context parser module. The literal file paths are intentionally omitted here so this report does not contaminate the path-mention eval fixture. | Tolerated for now. Not a token-budget defect. |

No standalone traversal-dilution defect is claimed from this run. The observed PRD-0030 drops are monotone with budget or remain missed at 16k; a traversal-on versus traversal-off paired eval would be needed to isolate dilution separately.
