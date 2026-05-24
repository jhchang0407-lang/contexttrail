# PRD-0031: Reverse-Import Traversal — Measure and Harden the Existing Lever

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's thirty-first PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADRs: [ADR-0017](../adr/0017-structural-assembly-rollout-contract.md), [ADR-0019](../adr/0019-retrieval-architecture-rethink.md), [ADR-0021](../adr/0021-gate-calibration-policy.md). Related PRDs: [PRD-0028](0028-code-source-index-for-agent-completion.md), [PRD-0029](0029-gate-calibration-tolerance-bands.md).
>
> Boundary rule: this PRD **does not add reverse-import traversal** — that lever is already shipped (`expandCodeImportsKHops` with `resolveImporters`, on by default at `maxHops = 2`). This PRD audits whether the residual misses are structurally reachable by the existing lever and, only if so, hardens the lever with bounded ordered expansion. Query rewriting is an explicit non-goal.

## Hypothesis (narrow, corrected)

> Given reverse-import traversal is already wired and on by default, the residual misses persist because (a) the missed target doesn't import any FTS-surfaced seed (reverse-unreachable), (b) it does but is out-ranked in the candidate set, or (c) it's reachable but reverse-expansion is producing hub dilution that pushes it below the cut. If (b) or (c), adding bounded ordered expansion to the existing traversal lifts the targeted misses.

The predicate that matters is **does the missed target T import any FTS-surfaced seed S for its ticket** — because reverse-from-S reaches files that import S. "T has incoming edges" is the wrong predicate (incoming edges to T would matter for reverse-from-T, not reverse-from-the-seed). This correction is structurally load-bearing — the audit's first column is built on it.

## Problem Statement

The current measured ceiling under traversal-on (link + nav + forward-import + reverse-import) is:

| metric | current | residual misses |
|---|---|---|
| workflow-assembly source coverage | 22/23 (95.7%) | THO-225 |
| agent-completion per-file coverage | 62/66 (93.9%) | 4 files (unclassified) |

The PRD-0028 slice-28.4 verdict says THO-225's missing file (`src/retrieve/structural-chunk-context-flag.ts`) has no incoming or outgoing import edges. If that still holds, *no* import-graph lever — forward or reverse, with or without bounds — can lift THO-225. The 4 agent-completion misses have not been classified.

The existing reverse-traversal implementation has three properties worth naming, because each is a potential failure mode:

1. **No per-seed cap.** A hub file imported by 50 sources would seed 50 reverse neighbors. Whether this is happening today is unmeasured.
2. **No deterministic sort.** Reverse neighbors are returned in the order their entries land in the inverse map. Two runs on the same data return the same list because Map iteration is insertion-ordered, but the order is not *structurally meaningful*.
3. **No same-package preference.** Cross-package reverse-edges expand symmetrically with same-package edges.

Whether any of these matters for the residual misses is what the audit slice answers.

## Solution

Three slices, falsification-first. The hardening slice does not ship unless the audit identifies cases where bounded ordered expansion could plausibly lift them.

### Slice 31.1 — Falsification audit (per-miss graph-shape classification)

For each of the five residual misses (THO-225 + the 4 agent-completion misses), compute and report:

| field | what it means |
|---|---|
| `target_imports_surfaced_seed` | does the missed target T import any FTS-surfaced seed S for its ticket? **This is the load-bearing predicate** — only if true can reverse-from-S reach T. |
| `seeds_reverse_visit_target` | run the actual `expandCodeImportsKHops` with seeds=FTS top-N and check whether the visited set contains T |
| `target_in_candidates` | does T appear in the ranked candidate list at all, just below the cut? |
| `hub_dilution_evidence` | for tickets where T is missed, did any seed produce >8 reverse neighbors? |
| `has_outgoing_imports` / `has_incoming_imports` / `has_symbols` | the basic graph shape, retained for diagnostic context |

Output: `docs/evals/prd-0031-miss-shape-audit.md` with one row per case.

The audit is the falsification gate. Slice 31.2 only proceeds for cases where **either**:

- `target_imports_surfaced_seed == true` AND `seeds_reverse_visit_target == false` (reachable in principle, expansion didn't follow the edge — likely because hop limit, cap absence, or sort order kept the seed busy elsewhere), OR
- `seeds_reverse_visit_target == true` AND `target_in_candidates == true` (visited and surfaced, but out-ranked — hardening can change neighbor selection to preserve the right candidates), OR
- `hub_dilution_evidence == true` for the seed set (the lever is over-expanding and could be productively bounded).

If **zero** cases match any of these, slice 31.2 is dropped. PRD-0031 closes terminal state **A** (audit-only falsified).

### Slice 31.2 — Conditional hardening of the existing reverse-traversal

Only proceeds if slice 31.1 produces at least one case in one of the three target shapes above.

The lever to harden is `expandCodeImportsKHops` itself — specifically, the reverse path (lines 71–78 of `code-import-traversal.ts`). Three structural caps, all applied to the reverse path only (forward path unchanged):

- **`MAX_REVERSE_NEIGHBORS_PER_SEED = 8`.** A seed with more than 8 incoming edges is a hub. Hub-driven over-expansion dilutes the candidate set. Cap and skip past 8.
- **Deterministic structural sort**: `(samePackage, pathLexicographic)`. Same-package importers first, then alphabetical within each bucket. Eliminates dependence on Map insertion order and gives the cap a principled selection rule.
- **K stays at 2 for reverse**, matching the current default. Lowering to K=1 is rejected unless slice 31.1 evidence specifically implicates depth-2 reverse expansion as the dilution source. Don't change two knobs at once.

The hardening lands **behind an opt-in flag** during measurement (`RETRIEVAL_REVERSE_IMPORT_BOUNDED`, default `false`). The flag default is flipped to `true` only in slice 31.3 and only if case-level verification passes.

`buildImportersResolver` is untouched. Caps and sort live in the consumer of its output, not in the resolver itself.

### Slice 31.3 — Case-level verification + flag flip (or revert)

Aggregate metrics alone are not the gate. The verification table must show, for each targeted case from slice 31.1:

| case | shape from 31.1 | before (flag off) | after (flag on) |
|---|---|---|---|
| THO-225 (workflow) | classified per 31.1 | miss / lift / unchanged | … |
| each of 4 missed agent-completion files | classified per 31.1 | miss / lift / unchanged | … |
| workflow-assembly aggregate | — | 22/23 | up to 23/23 |
| agent-completion per-file aggregate | — | 62/66 | up to 66/66 |
| OSS top-5 (174-case) | — | 96.0% | must remain ≥96.0%, no tolerance band |

Three terminal outcomes are possible at this slice:

- **Confirmed.** At least one targeted case flips, no untargeted regressions, OSS top-5 holds. Flag default is flipped to `true` in the same commit that amends ADR-0021 to record the new workflow-assembly / agent-completion baselines.
- **Implementation-attempt falsified.** Flag-on shows zero case-level lifts, OR untargeted cases regress, OR OSS top-5 drops. Flag default stays `false` — the bounded path remains opt-in for further investigation. The hardening *code* stays merged (it doesn't break anything off by default) but the production posture is "current unbounded reverse traversal is what ships."
- **Implementation-attempt falsified with revert.** If the bounded code shows up as a code-quality liability (e.g. confuses future readers because it's an unused branch), revert. This is a maintenance call, not a measurement call.

## Non-goals (explicit)

* **Query rewriting** (LLM-based, template expansion, or otherwise) is not a fallback inside this PRD. If reverse-import hardening produces zero lift, PRD-0031 closes with a falsified verdict and query rewriting is considered for a separate PRD with its own audit.
* **Broad signal_empty recovery on natural-language queries.** This PRD is specifically about code-source assembly. OPEN.md item 1 (the broad bucket) is *not* updated by this PRD — the update target is the PRD-0028 slice-28.4 residual-verdict note and OPEN.md item 5 (real-corpus eval residuals).
* **Adding reverse traversal.** Already shipped. This PRD's value-add is measurement and bounded selection.
* **Reverse traversal of the markdown link graph or nav graph.** Different shape, different precision surface; not part of this hypothesis.
* **Re-running the import extractor.** Reverse edges are derived from existing forward-edge data via `buildImportersResolver`.
* **Lowering K for reverse expansion** in slice 31.2. Don't change two knobs at once.

## Risks

* **Hub dilution mitigation may not be the actual lift mechanism.** It's plausible that bounded expansion changes which neighbors enter the pack without changing whether the *targeted* misses do. Mitigated by slice 31.3's case-by-case table — aggregate movement without targeted flips does not count as confirmation.
* **174-case OSS regression.** Same-package preference could displace a useful cross-package reverse neighbor that today contributes to a doc retrieval. Mitigated by the no-tolerance OSS gate.
* **The audit could be inconclusive.** If `target_imports_surfaced_seed == false` for all five misses, the audit produces a clean falsification — no hardening can help. That's the expected state for THO-225 given its known zero-edge shape. The audit doing its job *is* the artifact in terminal state A.
* **Bounded path code stays as dead branch under falsified terminal state.** Slice 31.3 explicitly allows revert-as-maintenance to keep this from accruing.

## Acceptance — PRD-level

PRD is complete when **one** of the following terminal states holds:

**A. Audit-only falsified (no production code lands).**
1. `docs/evals/prd-0031-miss-shape-audit.md` classifies all five residual misses by the audit fields.
2. Zero cases match the slice-31.2 proceed conditions.
3. PRD-0031 closes with verdict "residual misses are not in reachable-but-bounded shape." The PRD-0028 slice-28.4 verdict note and OPEN.md item 5 are updated to reflect the new known shape of the residual.

**B. Implementation-attempt falsified (bounded code merged, flag stays off).**
1. Audit completed; slice 31.2 shipped behind opt-in flag; slice 31.3 verification shows zero targeted lifts, untargeted regression, or OSS regression.
2. Flag default remains `false`. No ADR-0021 amendment. PRD-0028 verdict note updated to reflect that bounded reverse-expansion is implemented but not productive.

**C. Confirmed and shipped.**
1. Audit completed; bounded reverse expansion shipped behind the flag.
2. Case-level verification shows at least one targeted lift, no untargeted regression, OSS top-5 ≥96.0%.
3. Flag default flipped to `true` in the same commit that amends ADR-0021 with the new baselines.

All three are valid terminal outcomes. The PRD is structured to surface ground truth, not to ship a fix at all costs.

## Why structural, not data-fitting

| concern | mitigation |
|---|---|
| Will the predicate be redefined mid-flight if the audit looks unfriendly? | The predicate (`target_imports_surfaced_seed`) is fixed in this PRD and grounded in the actual edge direction of reverse traversal. Redefining it requires amending the PRD, not the audit. |
| Are the caps tuned to the eval? | `MAX_REVERSE_NEIGHBORS_PER_SEED = 8` matches the order-of-magnitude of "siblings" expansion already shipped. Same-package-preferred sort is the standard structural prior, not a per-case heuristic. K stays at 2 specifically to avoid two-knob tuning. |
| Could this turn into "try bounded; if zero lift, try X" pile-on? | The non-goals section forecloses query rewriting as a fallback. Falsified terminal states are legitimate outcomes, not failures to fix. |
| Why no `tolerance_cases` band on the OSS top-5 gate? | The 174-case eval is large-N and stable; any case-level move is signal. PRD-0029 Rule 1 names N=50 as the percentage-point transition, but moves at this stability are flagged regardless. |
| Why allow the bounded code to stay merged in terminal state B? | An off-by-default opt-in flag is auditable and doesn't accrue rot the way a dead unreachable branch does. The revert option in terminal state B is a maintenance call, not a measurement call. |
