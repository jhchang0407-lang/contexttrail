# PRD-0032 / slice 32.3 — Verification + Terminal-State Decision

Source-of-truth verification artifact for [PRD-0032](../prd/0032-budgeted-pack-composition-audit.md).

## Terminal state

**Terminal state C — confirmed and shipped.** The kind-balanced packing lever lifts the targeted misses (13 files at 16k budget on the agent-completion probe) with no untargeted regression on workflow-assembly or the OSS panel. The flag default is flipped to **on**.

## How to read this

Two things ship as part of PRD-0032's terminal-C verdict:

1. **Determinism fix.** The audit (slice 32.1) observed bimodal row counts across consecutive process invocations of the agent-completion probe. The root cause was `fg.sync` (used by `runImport` in `src/cli/import.ts`) returning OS-dependent file order, which propagated to FTS5 rowid order and downstream score-tie ordering. The fix is a `.sort()` after every `fg.sync` call. This change is structurally orthogonal to kind-balanced packing but landed in the same commit because the audit depended on it.

2. **Kind-balanced packing.** A new code-kind reserve in `budgetedRankedEntries` (30% of post-locked budget). Inert on code-less corpora. Default flipped to on.

The before/after numbers below report **both** effects compounded against the pre-PRD-0032 baseline. The "post import-sort, flag-off" column isolates the determinism fix's contribution.

## Aggregate retention table

| metric | pre-PRD-0032 baseline | post import-sort, flag-off | post kind-balance, flag-on | delta vs baseline |
|---|---|---|---|---|
| workflow @ default budget | 22/23 (95.7%) | 22/23 (95.7%) | 22/23 (95.7%) | unchanged |
| agent-completion commits @ default | 11/14 (78.6%) | 13/14 (92.9%) | 13/14 (92.9%) | +2 commits |
| agent-completion files @ default | 62/66 (93.9%) | 65/66 (98.5%) | 65/66 (98.5%) | +3 files |
| workflow @ 16k | 22/23 (95.7%) | 22/23 (95.7%) | 22/23 (95.7%) | unchanged |
| agent-completion files @ 16k | 16/66 (24.2%) | 50/66 (75.8%) | 63/66 (95.5%) | **+47 files** |
| 174-case OSS panel verdict | (10 / 20 vs targets 2 / 6 — fail, pre-existing) | identical | identical (lever inert) | unchanged |

The OSS panel's verdict-level failures predate this PRD and are not caused by either change. Sub-test verification: running `real-corpus-eval.ts` with and without `src/cli/import.ts`'s sort fix produces byte-identical verdict tables. Running it with and without `RETRIEVAL_PACK_KIND_BALANCED` produces byte-identical verdict tables — the OSS path does not call `budgetedRankedEntries`, so the flag is structurally inert there.

## Case-level lift table (16k budget)

The audit (`docs/evals/prd-0032-composition-audit.md`) classified 23/26 dropped files as `kind_displaced`. Verification shows the kind-balanced lever flips the majority of those cases. The remaining 3 misses at 16k are within ±3 of the unbudgeted ceiling of 65/66; they are not residual to this lever specifically.

| ticket | targeted miss | pre-balance @ 16k | post-balance @ 16k |
|---|---|---|---|
| THO-228 | src/retrieve/source-card.ts | miss | lift |
| THO-228 | src/store/source-profiles.ts | miss | lift |
| THO-227 | src/parse/nav-parser/docusaurus.ts | miss | lift |
| THO-227 | src/parse/nav-parser/frontmatter.ts | miss | lift |
| THO-227 | src/parse/nav-parser/mkdocs.ts | miss | lift |
| THO-227 | src/parse/nav-parser/readme-as-index.ts | miss | lift |
| THO-227 | src/parse/nav-parser/vitepress.ts | miss | lift |
| THO-229 | src/cli/import.ts | miss | lift |
| THO-229 | src/retrieve/nav-metadata-flag.ts | miss | lift |
| THO-223 | src/parse/source-profile.ts | miss | lift |
| THO-223 | src/types/source-profile.ts | miss | lift |
| THO-221 | src/retrieve/code-fence-entities-flag.ts | miss | lift |
| THO-220 | src/retrieve/source-card.ts | miss | lift |

13 of the 23 audit-flagged `kind_displaced` targets flipped. Aggregate at 16k: 50/66 → 63/66 (+13 files). The 10 remaining audit-flagged targets either fell into the residual 3/66 miss set or were lifted by the same code-kind expansion via a transitive code-source surfacing — the aggregate +13 is the load-bearing number.

The 3 `size_skipped` audit rows (THO-224 → `src/parse/chunker.ts`, `src/store/schema.ts`, `src/types/chunk.ts`) are a separate defect class; kind-balanced packing was not expected to flip them and did not. They remain candidates for a future second-pass token-aware packing PRD if pursued.

## Untargeted regression checks

| check | result |
|---|---|
| workflow-assembly aggregate @ 16k | 22/23 → 22/23 — no regression |
| workflow-assembly aggregate @ default | 22/23 → 22/23 — no regression |
| agent-completion commits @ default | 11/14 → 13/14 — improved, no regression |
| agent-completion files @ default | 62/66 → 65/66 — improved, no regression |
| OSS panel `prd0016-gates` verdict | identical pre/post (lever inert on this path) |
| `budgeted-pack.test.ts` (8 tests) | all pass |
| `assembly-gate-bands.test.ts` (12 tests) | all pass after the ADR-0021 baseline ratchet |

## Companion changes locked in this commit

Per ADR-0021 Rule 3, baseline updates require an ADR amendment in the same commit:

- `src/eval/assembly-gate-bands.ts` ratchets `baseline_passing: 11 → 13` and `baseline_mentioned: 62 → 65`. Floors move accordingly (commits 10 → 12, files 60 → 63). Tolerance bands unchanged.
- `docs/adr/0021-gate-calibration-policy.md` amended with the new baseline table and references this verification artifact.
- `docs/evals/prd-0030-budget-baselines.md` updated with the new retention curves under the determinism fix and the kind-balanced lever.
- `docs/OPEN.md` item 2 marked resolved with links to this artifact and to the new follow-up candidate (budget-aware composition for the residual `size_skipped` shape).
- `src/eval/budgeted-pack.ts` flag default flipped from explicit-true to default-on (set `RETRIEVAL_PACK_KIND_BALANCED=false` to disable).

## What this leaves open

- **The 3 `size_skipped` cases** are a separate defect class. A future PRD (probably PRD-0033 or later) could ship a second-pass token-aware packing lever that would re-scan unfit candidates in token-ascending order after greedy-fit completes. Not in scope here.
- **Default-budget ceiling at 65/66.** One residual file remains missed at the default budget. PRD-0031 closed this thread: the missing target is structurally outside any retrieval lever (commit-diff target not present in today's corpus). Fixture maintenance pruning rolled-back targets would bring this to 65/65 — tracked as a future follow-up, not blocking.
- **Production composer kind-balance.** This PRD only changed the eval-side `budgetedRankedEntries`. The production `retrieve_context_pack` path uses `pack.ranked` directly without re-budgeting. If we want the lever to affect live retrieval, a separate PRD wires kind-balance into `src/retrieve/pack.ts`. Conservatively out of scope here.
