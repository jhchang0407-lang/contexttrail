# PRD-0029: Gate Calibration — Tolerance Bands for Assembly Metrics

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's twenty-ninth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADRs: [ADR-0009](../adr/0009-migration-verification-gate.md), [ADR-0017](../adr/0017-structural-assembly-rollout-contract.md), [ADR-0019](../adr/0019-retrieval-architecture-rethink.md), [ADR-0021](../adr/0021-gate-calibration-policy.md). Related PRDs: [PRD-0016](0016-deterministic-retrieval-precision-and-assembly-ready-top3.md), [PRD-0028](0028-code-source-index-for-agent-completion.md).
>
> Boundary rule: this PRD locks **tolerance bands**, not new metrics. The metrics already exist and are measured. What is missing is the explicit "what counts as a regression" definition that makes them safe to wire as CI gates.

## Problem Statement

The 2026-05-11 assembly pass produced three named, measured metrics on real corpora:

| metric | sample | current value | source |
|---|---|---|---|
| workflow-assembly source coverage | 23 Linear tickets | 95.7% (22/23) | `src/eval/real-workflow-probe.ts` |
| agent-completion source-file coverage | 14 commits / 66 files | 93.9% (62/66) | `src/eval/agent-completion-probe.ts` |
| 174-case OSS top-5 | 174 cases / 13 corpora | 96.0% | `src/eval/real-corpus-eval.ts` |

Only the third is wired as a CI gate today, via the PRD-0016 verdict module (`src/eval/prd0016-gates.ts`). The first two are reported but not gated, because nobody has decided what counts as a regression. Two unresolved questions block CI promotion:

1. **Small-N regression bands.** A single missed ticket on the 23-case workflow probe is a 4.3-point swing. Percentage-point thresholds are misleading at N=23 and at N=14 commits; case-count bands are more honest but have no precedent in the existing gate module.
2. **Absolute floor vs no-regression-from-baseline.** PRD-0016 uses both: an absolute floor on some metrics (`ANSWER_TOP_3_FLOOR`) and a never-below-baseline check on others. The new metrics inherit neither convention by default. Without an explicit policy, the first regression run produces ambiguous "is this a bug?" debate.

OPEN.md item 5 names this directly: *"Gate calibration policy is still unclosed... otherwise the same 'catches broken but not regressed' problem repeats on a new axis."*

## Solution

Lock a single calibration policy in an ADR, then extend the existing verdict module to enforce it on the two unwired metrics. No new metrics. No new probes. No new infrastructure.

The policy has three rules; each is justified below.

### Rule 1 — Case-count bands for small-N probes

For probes with N ≤ 50 cases, the tolerance is expressed in **cases**, not percentage points. Specifically:

- `workflow-assembly` (N=23): tolerance is **±1 case** from baseline. Drop to 21/23 fails.
- `agent-completion` per-commit (N=14 commits): tolerance is **±1 commit** from baseline. Drop to 9/14 fails.
- `agent-completion` per-file (N=66 files): tolerance is **±2 files** from baseline. Drop to 59/66 fails.

Rationale: at small N, percentage swings overstate signal. A 1-case miss on a 23-case probe is a 4.3-point delta; treating that as "noise" hides real regressions. Conversely, a 0.5-point delta on a 174-case probe is a single case and is genuinely noise. Case-count bands track the underlying truth: *did we lose a real example?*

### Rule 2 — Absolute floors are derived from current measurement, not aspiration

The absolute floor for each new metric is set at the measured baseline minus the Rule 1 tolerance. No aspirational floors. No round-number floors.

| metric | baseline (2026-05-11) | tolerance | locked floor |
|---|---|---|---|
| `workflow-assembly` | 22/23 (95.7%) | ±1 case | 21/23 (91.3%) |
| `agent-completion` commits | 11/14 (78.6%) | ±1 commit | 10/14 (71.4%) |
| `agent-completion` files | 62/66 (93.9%) | ±2 files | 60/66 (90.9%) |

Rationale: aspirational floors create false alarms on day one. The floor's job is to catch regression from a known-good state, not to encode a target. Target-setting is a separate decision belonging to the next forward-looking PRD, not to the calibration PRD.

### Rule 3 — Baseline updates require ADR amendment, not silent overwrite

The current PRD-0016 pattern allows callers to pass a fresh baseline JSON every run. That makes baseline drift invisible. For PRD-0029 metrics, the locked floors live in code (`src/eval/assembly-gate-bands.ts`) and are version-controlled. Updating a floor is a deliberate diff against this PRD's table, not a CLI flag.

Rationale: a baseline that auto-updates is a baseline that ratchets quietly downward on every flaky run. Making the floor a code constant means *someone has to write a commit message saying why it moved* — the same accountability we apply to ADR amendments.

Corollary: the measurement totals are locked alongside the floors. A run that reports `21/24` workflow tickets or `60/80` agent-completion files does **not** satisfy the `21/23` or `60/66` floor; it fails until ADR-0021 is amended with the new baseline table.

### Slice 29.1 — Locked-band module

Add `src/eval/assembly-gate-bands.ts` exporting:

- `ASSEMBLY_GATE_BANDS` — frozen object with the per-metric floors and tolerance-as-cases values from Rule 2.
- `evaluateAssemblyGates(current: AssemblyMeasurement): AssemblyVerdict` — pure function. No IO. Same shape as `Prd0016Verdict`.

The verdict shape mirrors `Prd0016Verdict` exactly so consumers can render both with one template.

### Slice 29.2 — Wire probes to the verdict

`src/eval/real-workflow-probe.ts` and `src/eval/agent-completion-probe.ts` both end by calling `evaluateAssemblyGates` and printing the verdict block. Non-zero exit on failure. This is what makes them CI-gateable; today they print percentages and exit zero unconditionally.

Slice 29.2 changes only the trailing-block of each probe — no measurement-logic changes, no scoring changes. Existing tests stay green by construction.

### Slice 29.3 — ADR-0021 lock

Write ADR-0021 ("Gate calibration policy for small-N assembly probes") capturing Rules 1–3 verbatim, the baseline table from Rule 2, and the explicit decision that *future PRDs that change these floors must amend ADR-0021 in the same commit*. This is the audit trail the OPEN.md item demands.

### Slice 29.4 — CI integration

The probes already run under `tsx`. Slice 29.4 adds them to the existing CI job that runs `prd0016-gates`. No new infra; just three more invocations and three more verdicts in the run output.

Failure mode is identical to PRD-0016 today: the run fails with a named gate, the PR is blocked, the author either fixes the regression or writes the ADR-0021 amendment.

## Out of scope

* **Setting new aspirational targets.** PRD-0029 locks floors at *measured* values. Future PRDs (the LLM-judge harness, the second corpus, signal_empty recovery) may propose higher targets — that proposal goes in those PRDs, not this one.
* **Reworking the PRD-0016 verdict module.** Its pattern is fine; PRD-0029 sits alongside it, not on top of it.
* **Tolerance bands for as-yet-unbuilt metrics.** The LLM-judge harness (next PRD) has no measurement yet, so it has no calibratable baseline. It will need its own ADR amendment once measured.
* **Per-corpus floors on the 174-case panel.** The panel is a single aggregate gate today; that's intentional. Per-corpus floors invite corpus-specific tuning, which is the exact failure mode PRD-0016 was written to prevent.
* **Statistical significance testing.** With N=14 commits there is no power to detect anything subtler than ±1. Pretending otherwise via t-tests would launder noise as rigor.

## Risks

* **Locked floor becomes a ceiling.** If the floor is set at baseline, every improvement raises the floor on the next ADR amendment — but only if someone remembers to amend. Mitigation: Slice 29.3 makes the amendment a per-commit responsibility. If improvements ship without floor updates, the next regression will silently fit under the old floor. Tradeoff accepted: false negatives from a stale floor are recoverable; false positives from an over-eager floor block merges.
* **The "±1 case" rule does not generalise to N≥50.** When the 174-case panel grows or the workflow probe expands past 50 tickets, the band needs to switch to percentage points. Mitigation: ADR-0021 names this explicitly as a known transition point. PRD-0016's existing pattern is the destination.
* **Multi-metric correlated regressions.** A change that loses 1 case on each of three probes passes all three gates individually but is collectively a real signal. Mitigation: Slice 29.1's verdict includes the per-probe cases-lost counts; the aggregated CI block will show "3 probes each lost 1 case" even if no individual gate failed. Manual judgment, not automated.

## Acceptance — PRD-level

PRD is complete when:

1. `src/eval/assembly-gate-bands.ts` exists and exports the frozen `ASSEMBLY_GATE_BANDS` constant + `evaluateAssemblyGates` pure function.
2. `real-workflow-probe.ts` and `agent-completion-probe.ts` print verdict blocks and exit non-zero on gate failure.
3. ADR-0021 is written and locked, capturing Rules 1–3 and the baseline table verbatim.
4. CI runs both probes alongside PRD-0016 gates; a deliberate regression test (drop one workflow case, drop below the agent-completion commit floor) fails the build as expected.
5. The OPEN.md "gate calibration policy" bullet flips from open to resolved with a link to PRD-0029 and ADR-0021.

## Why structural, not data-fitting

| concern | mitigation |
|---|---|
| Will the case-count bands be tuned to make today's numbers pass? | The floors *are* today's numbers minus a fixed ±1/±1/±2. They cannot be tuned tighter without an ADR-0021 amendment, which leaves an audit trail. |
| Could a future PRD ratchet floors down to avoid blocking merges? | Yes, by ADR-0021 amendment. That is the intended pressure valve, and the amendment commit is the accountability mechanism. The failure mode is *visible*, not *silent*. |
| Why not statistical thresholds (CI bounds, sequential testing)? | At N∈{14, 23, 66}, the only honest statement is "we lost a case or we didn't." Confidence intervals at this N are wider than the metric range. |
| Why three rules and not one? | Rule 1 picks the right *unit*. Rule 2 picks the right *origin*. Rule 3 picks the right *update process*. Collapsing any pair re-introduces a known failure mode (percentage drift at low N, aspirational floors blocking day-one CI, or invisible baseline ratcheting). |
