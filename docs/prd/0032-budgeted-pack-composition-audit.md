# PRD-0032: Budgeted Pack-Composition Audit (Falsification-First)

> **Status (2026-05-11):** Terminal state C — confirmed and shipped. Audit at `docs/evals/prd-0032-composition-audit.md`; verification at `docs/evals/prd-0032-verification.md`. ADR-0021 ratcheted. Kind-balanced packing lever ships in `src/eval/budgeted-pack.ts` with default-on flag. Determinism companion change in `src/cli/import.ts` (sorted `fg.sync` output) shipped in the same commit.
>
> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's thirty-second PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADRs: [ADR-0017](../adr/0017-structural-assembly-rollout-contract.md), [ADR-0019](../adr/0019-retrieval-architecture-rethink.md), [ADR-0021](../adr/0021-gate-calibration-policy.md). Related PRDs: [PRD-0028](0028-code-source-index-for-agent-completion.md), [PRD-0029](0029-gate-calibration-tolerance-bands.md), [PRD-0030](0030-token-budget-pack-quality-eval.md), [PRD-0031](0031-reverse-import-traversal-structural-hypothesis.md).
>
> Boundary rule: this PRD ships an **audit** first. It does NOT assume the fix is kind-balanced packing, or any other composer change. The audit must permit "no composer fix is the right answer" as a valid terminal verdict.

## What PRD-0030 answered (and didn't)

PRD-0030 answered: "Do the right files survive under 4k / 8k / 16k budgets?"
Answer: mostly no for agent-completion (62/66 → 16/66 at 16k — a 70-point gap).

PRD-0030 did *not* answer: "Are the wrong things surviving instead, or is 16k simply too small?" Those are different defects with different fixes. PRD-0032 is the audit that partitions them.

## Hypothesis (audit-first, no preferred fix)

> For each dropped agent-completion target file at the 16k budget, exactly one of the following five classes applies. The class determines the lever; the audit determines the class.

| class | meaning | likely fix lever |
|---|---|---|
| `not_candidate` | file never appears even in unbudgeted candidate list | candidate generation / retrieval lever (not composer) |
| `ranked_below_cut` | file appears in the candidate list but only *after* the 16k budget is exhausted | ranking / per-kind score normalization / composer |
| `size_skipped` | file appears early enough rank-wise but is too large to fit while later cheaper entries fit | pack composer / token-aware packing |
| `kind_displaced` | file is dropped while doc-chunk or traversal-neighbor entries of lower task value consume the budget | kind-balanced packing |
| `budget_insufficient` | many right files are ranked reasonably, but the total useful evidence genuinely exceeds 16k | accept larger pack, summarize, or compress representations |

## Problem Statement

The PRD-0030 baseline (`docs/evals/prd-0030-budget-baselines.md`) recorded agent-completion file-level retention dropping from 62/66 (legacy unbudgeted candidate path) to 16/66 at 16k tokens. The drop is classified as a "truncation drop" with disposition "tolerated for now (PRD-0030 is eval-only)."

The composer behavior that drives this is structural and worth naming:

- `pack.ts` does locked-first packing followed by **greedy-fit by rank**: `if (used + c.token_count <= remaining_budget) { push; used += token_count }`. Candidates that don't fit are *skipped*, not *stopped at*. A smaller later candidate can win a slot after a larger earlier candidate is skipped — this is what makes the `size_skipped` class structurally possible.
- Doc-chunk and code-source entries score in the **same space**. Code-source entries (path + symbol list + JSDoc) tend to have less text body than doc-chunk entries (full markdown section), which biases BM25F-style scoring toward doc-chunks at fixed weights. Whether this bias is the cause of the 62/66 → 16/66 gap is unmeasured.
- Traversal-on packs (link / nav / forward-import / reverse-import on by default) average 40+ surfaced sources per ticket *before* truncation. The composer ranks all 40+ together; no kind-balance, no score-floor on traversal pulls, no preferential treatment for code-sources.

The fix space includes at least: kind-balanced quotas, per-kind score normalization, traversal score floors, token-aware packing that re-considers skipped candidates, and "the budget is too small, full stop." Picking a fix before the audit risks shipping a quota system that sacrifices good docs without recovering the dropped code files. PRD-0032's first slice is the audit; later slices are conditional.

## Solution

Three slices, falsification-first. The fix slice (32.2) does not specify *which* lever — it is gated on the audit choosing one. The verification slice (32.3) decides the terminal state.

### Slice 32.1 — Per-drop composition audit

For each of the **46 dropped agent-completion target files** at 16k (the 62/66 candidates minus the 16/66 survivors from PRD-0030), produce one row classifying the drop into exactly one of the five taxonomy classes above. The audit is a deterministic script under `src/eval/` writing to `docs/evals/prd-0032-composition-audit.md`.

The load-bearing measurement is **not** "where was the dropped file ranked." It is:

> For each dropped right file: what specific entries consumed the post-locked budget before it was reached, AND what specific entries continued to be admitted by greedy-fit *after* it was skipped?

Per-row columns:

| column | meaning |
|---|---|
| `ticket` | the agent-completion ticket / commit |
| `target_path` | the dropped target file |
| `class` | one of `not_candidate` / `ranked_below_cut` / `size_skipped` / `kind_displaced` / `budget_insufficient` |
| `rank_position` | the target's position in the unbudgeted ranked list (or `n/a` if `not_candidate`) |
| `tokens_required` | token count of the target's pack entry |
| `tokens_consumed_before` | sum of tokens of entries that fit before the target was reached |
| `displacing_entries` | for `kind_displaced` / `size_skipped`: the top entries (kind, path, tokens) that fit while the target did not |
| `class_rationale` | one-line evidence supporting the class assignment |

Classification rules (deterministic, applied in this order — first match wins):

1. **`not_candidate`**: target does not appear in the unbudgeted ranked list at all.
2. **`ranked_below_cut`**: target's `rank_position` is past the point where greedy-fit could have reached it given the budget. I.e., there is no token budget at which this file would have fit; it ranked too low.
3. **`size_skipped`**: target's `rank_position` is reached during greedy-fit, but `tokens_required` > remaining-budget-at-that-rank, AND at least one subsequently-ranked entry was admitted (greedy-fit's smaller-later-wins behavior).
4. **`kind_displaced`**: target is in the candidate list and would fit by size, but the post-locked budget is dominated (≥60% of consumed tokens) by entries of a different kind whose displacement is plausibly lower task value (e.g. traversal neighbors with score below the target's score).
5. **`budget_insufficient`**: target is in the candidate list, would fit by size, the budget is consumed by *high-value* entries (the engineer's commit-diff covers >16k of relevant material across many files), and no composer change at 16k could realistically have admitted it.

The rules are applied per-file. A 46-row table is the artifact.

#### Amendment (2026-05-11): rule order corrected during implementation

The drafted order above places `ranked_below_cut` before `kind_displaced`. The audit's first pilot run found this order systematically mislabeled cases where the budget was entirely consumed by a different kind before greedy-fit reached the target. Targets that should have been classified `kind_displaced` were instead labeled `ranked_below_cut` because their deep-tail rank position satisfied the rank-threshold rule first.

The shipped audit script applies rules in this corrected order:

1. `not_candidate`
2. `size_skipped` (greedy-fit's smaller-later-wins fired)
3. **`kind_displaced`** (different kind ≥60% of consumed pre-target budget — fires regardless of rank position)
4. **`ranked_below_cut`** (same kind dominates consumed pre-target budget — intra-kind ranking issue)
5. `budget_insufficient` (mixed kinds, no single dominator)

The decisive distinction: high rank position is the *consequence* of cross-kind budget exhaustion, not an independent shape. Putting `ranked_below_cut` first masked the underlying kind-displacement structure on most cases. The audit's `displacing_kinds` column makes this empirically visible.

#### Determinism companion fix (same commit)

During slice 32.1 the audit was observed to produce bimodal row counts (alternating 16 vs 26) across consecutive process invocations on the same corpus. Root cause: `fg.sync` in `src/cli/import.ts` returned OS-dependent file order, which propagated through FTS5 rowid insertion and surfaced as score-tie ordering drift. The fix is a `.sort()` after every `fg.sync` call. The change is structurally orthogonal to kind-balanced packing but landed in the same commit because the audit's PRD-0032 acceptance ("byte-identical re-runs") depended on it. The fix also incidentally raised the default-budget agent-completion gate from 62/66 → 65/66 files and 11/14 → 13/14 commits, which is locked into ADR-0021 via the same-commit amendment per Rule 3.

### Slice 32.2 — Conditional implementation (only after slice 32.1 produces a verdict)

Slice 32.2 does not pre-specify the lever. It branches on slice 32.1's majority class:

- **If majority is `kind_displaced`:** ship kind-balanced packing behind a flag. Code-source kind gets a reserved share of the post-locked budget (initial share chosen from the audit's evidence, not from aspiration). Default-off; behavior bit-identical to today when flag is off.
- **If majority is `size_skipped`:** ship a "second-pass packing" lever — after greedy-fit completes, re-scan unfit candidates in token-ascending order to fill residual slack. Default-off; behavior bit-identical to today when flag is off.
- **If majority is `ranked_below_cut`:** ship per-kind score normalization behind a flag — code-source candidates are ranked in their own space, then merged with doc-chunks by best-of-kind position rather than raw score. Default-off; behavior bit-identical to today when flag is off.
- **If majority is `not_candidate`:** slice 32.2 closes with verdict "not a composer problem." A different PRD (candidate generation) becomes the next target.
- **If majority is `budget_insufficient`:** slice 32.2 closes with verdict "no composer fix at 16k." A separate decision (representation compression, larger default budgets, or accepting the ceiling) becomes the next target.

The point of branching the slice description is to make the structure of "the audit chooses the fix, not the PRD author" load-bearing. If the audit produces a mixed distribution (no class commands a majority), slice 32.2 closes with verdict "compound defect" and the next PRD is a per-class strategy.

### Slice 32.3 — Case-level verification + flag flip / revert decision

Same shape as PRD-0031 slice 31.3:

- Run the verification table flag-off and flag-on for the chosen lever.
- The targeted misses must flip — aggregate movement without targeted lifts means scoring drift, not hypothesis confirmation.
- Workflow-assembly aggregate, agent-completion per-file aggregate, OSS top-5 174-case must all hold (no untargeted regression).
- Terminal A: audit-only falsified (no implementation possible). Terminal B: implementation-attempt falsified (flag stays off, code stays merged or reverts as maintenance). Terminal C: confirmed (flag flips, ADR-0021 amended with new baselines).

## Non-goals (explicit)

* **Pre-committing to kind-balanced packing.** The audit must permit verdicts that say "no composer fix is the right answer." Pre-specifying the lever would re-introduce the failure mode PRD-0031 review caught (assuming a fix before measuring whether the predicate holds).
* **Query rewriting.** Still a separate PRD if ever motivated. Not in scope here.
* **Changing the candidate-set generators** (FTS5 mixing, traversal levers). Those are upstream of the composer. The audit will flag if `not_candidate` is the majority class — at which point composer changes are off the table and a different PRD takes over.
* **Increasing default token budgets.** That is a posture choice for `terminal A: budget_insufficient`, not a composer change.
* **Compression / summarization of code-source representations.** Same — a posture choice for terminal A, not part of this PRD.
* **Fixture maintenance** (pruning rolled-back targets per the PRD-0031 audit) is a separate small slice tracked in OPEN.md, not bundled here. Note: if fixture maintenance ships first, the 46-row audit count drops to whatever number remains after pruning.

## Risks

* **Audit produces an ambiguous majority.** If `size_skipped` and `kind_displaced` are 18 and 19 of 46, neither is decisive. Mitigation: slice 32.2's "compound defect" branch explicitly handles this and surfaces it rather than forcing a choice.
* **Classification rules are mis-tuned.** The 60% threshold for `kind_displaced` is one specific cutoff. Mitigation: the per-row `displacing_entries` column is preserved regardless of class, so a future reader can re-classify under a different rule without re-running the audit.
* **The audit reveals the engine has multiple correlated problems.** The 70-point gap may be 30% kind-displacement + 30% size-skip + 30% budget-insufficient. That's a real-world possibility and the right surfacing of it. Don't pretend a single lever closes it if the audit says otherwise.
* **Kind-balance quota becomes a heuristic ceiling.** If we ship the kind-balanced lever and code-source quota is 30%, we may sacrifice good doc-chunks on tickets where the right answer is all docs. Mitigation: slice 32.3 verification requires both directions — agent-completion gains AND workflow-assembly holds.
* **The 46 number drops if PRD-0031 fixture maintenance ships first.** Audit numbers re-baseline. That's fine — the audit re-runs deterministically and produces a smaller artifact.

## Acceptance — PRD-level

PRD is complete when **one** of the following terminal states holds:

**A. Audit-only falsified (no production composer change ships).**
1. `docs/evals/prd-0032-composition-audit.md` classifies all 46 dropped files.
2. Majority class is `not_candidate`, `budget_insufficient`, or a `compound defect` distribution.
3. Slice 32.2 closes with the corresponding verdict; no code lands.
4. OPEN.md item 2 records the verdict and names the next PRD candidate (candidate-generation, default-budget posture, or representation compression).

**B. Implementation-attempt falsified (lever code merged, flag stays off).**
1. Audit produces a `ranked_below_cut` / `size_skipped` / `kind_displaced` majority.
2. Lever shipped behind opt-in flag per slice 32.2 branch.
3. Slice 32.3 verification shows zero targeted lifts, untargeted regression, or OSS regression.
4. Flag default stays false. PRD-0030 baseline doc + OPEN.md item 2 updated.

**C. Confirmed and shipped.**
1. Audit produces a definitive class majority.
2. Lever shipped per the matching slice-32.2 branch.
3. Slice 32.3 verification: at least one targeted lift, no untargeted regressions, OSS top-5 ≥96.0%.
4. Flag default flipped; ADR-0021 amended with new baselines in the same commit.

All three are valid terminal states. The PRD is structured to surface ground truth.

## Why structural, not data-fitting

| concern | mitigation |
|---|---|
| Will the audit's 60% kind_displaced threshold be tuned to make a kind-balance fix look needed? | The per-row `displacing_entries` column is preserved so a future reader can re-classify under a different rule without re-running. The threshold is one cut, not the data. |
| Could this become "try kind-balance; if it fails, try per-kind normalization; if that fails, try second-pass packing"? | Slice 32.2's branches are *mutually exclusive on majority class*. The audit picks one; we ship one and verify. No fallback pile-on. |
| Why not just lower the default candidate-set size (cap traversal) to reduce competition? | That's a candidate-generation change, not a composer change. The audit's `not_candidate` and `ranked_below_cut` classes specifically flag whether candidate generation is the right lever; if so, a different PRD owns it. |
| Will the chosen quota / threshold be tuned to the eval fixture? | Slice 32.3's case-level verification requires *named* misses to flip, not aggregate movement. Aggregate-only lift without specific case lifts is treated as scoring drift, not confirmation. |
| Why is `kind_displaced` defined by 60% and not, say, 50%? | A composer where 50% of the budget is one kind is balanced enough that displacement is debatable. 60% is the threshold where one kind clearly dominates. The threshold lives in the audit code and a future amendment can adjust it; the per-row evidence column makes the adjustment cheap. |
