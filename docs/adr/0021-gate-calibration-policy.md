# ADR-0021: Gate calibration policy for small-N assembly probes

**Status:** Accepted
**Date:** 2026-05-11

> Governs: [PRD-0029](../prd/0029-gate-calibration-tolerance-bands.md). Related: [PRD-0016](../prd/0016-deterministic-retrieval-precision-and-assembly-ready-top3.md), [ADR-0009](0009-migration-verification-gate.md), [ADR-0017](0017-structural-assembly-rollout-contract.md).

## Context

The 2026-05-11 assembly pass produced three named, measured metrics on real corpora:

| metric | sample | value | source |
|---|---|---|---|
| workflow-assembly source coverage | 23 Linear tickets | 22/23 = 95.7% | `src/eval/real-workflow-probe.ts` |
| agent-completion per-commit | 14 commits | 11/14 = 78.6% | `src/eval/agent-completion-probe.ts` |
| agent-completion per-file | 66 src files | 62/66 = 93.9% | `src/eval/agent-completion-probe.ts` |

Only the PRD-0016 174-case panel is wired as a CI gate today. The new metrics are reported but ungated because nobody has decided what counts as a regression. Two unresolved questions block CI promotion:

1. **Small-N regression bands.** A single missed ticket on the 23-case workflow probe is a 4.3-point swing. Percentage-point thresholds are misleading at N=23 and at N=14 commits; case-count bands are more honest.
2. **Absolute floor vs no-regression-from-baseline.** PRD-0016 uses both, depending on the metric. The new metrics inherit neither convention by default; without an explicit policy, the first regression run produces ambiguous "is this a bug?" debate.

[OPEN.md](../OPEN.md) item 5 named this directly: *"Gate calibration policy is still unclosed... otherwise the same 'catches broken but not regressed' problem repeats on a new axis."*

## Decision

Three rules, each locked. Each is necessary and the failure modes that motivate them are named alongside.

### Rule 1 — Case-count bands for small-N probes

For probes with N ≤ 50 cases, the tolerance is expressed in **cases**, not percentage points.

- `workflow-assembly` (N=23): tolerance **±1 case** from baseline.
- `agent-completion` per-commit (N=14 commits): tolerance **±1 commit**.
- `agent-completion` per-file (N=66 files): tolerance **±2 files**.

Rationale: at small N, percentage swings overstate signal. A 1-case miss on a 23-case probe is a 4.3-point delta; treating that as "noise" would hide real regressions. Case-count bands track the underlying truth: *did we lose a real example?*

### Rule 2 — Absolute floors are derived from measurement, not aspiration

The locked floor for each metric is the measured baseline minus the Rule 1 tolerance. No aspirational floors. No round-number floors.

| metric | baseline (2026-05-11, post-PRD-0032 amendment) | tolerance | locked floor |
|---|---|---|---|
| `workflow-assembly` | 22/23 (95.7%) | ±1 case | 21/23 (91.3%) |
| `agent-completion` commits | 13/14 (92.9%) | ±1 commit | 12/14 (85.7%) |
| `agent-completion` files | 65/66 (98.5%) | ±2 files | 63/66 (95.5%) |

#### PRD-0032 amendment (2026-05-11)

The original baseline locked `agent-completion commits` at 11/14 and `files` at 62/66. PRD-0032's slice-32.1 audit discovered that `fg.sync` in the import path returned OS-dependent file order, which introduced FTS5 rowid drift and bimodal probe row counts across process invocations. Sorting `fg.sync` output stabilized the measurement at the higher values shown above (13/14 commits, 65/66 files). The ratchet is captured here per Rule 3 — the measurement change required this amendment in the same commit as the import-sort fix. The verification artifact is `docs/evals/prd-0032-verification.md`.

Rationale: aspirational floors create false alarms on day one. The floor's job is to catch regression from a known-good state, not to encode a target. Target-setting is a separate decision belonging to a forward-looking PRD, not to the calibration ADR.

### Rule 3 — Baseline updates require ADR amendment, not silent CLI override

Locked floors live in code (`src/eval/assembly-gate-bands.ts` — `ASSEMBLY_GATE_BANDS`) and are version-controlled. Updating a floor is a deliberate diff against the table in Rule 2, written as an amendment to this ADR in the same commit. Floors are not passed as CLI flags or read from a baseline JSON; that pattern (used by PRD-0016 today) makes baseline drift invisible.

Rationale: a baseline that auto-updates is a baseline that ratchets quietly downward on every flaky run. Making the floor a code constant means *someone has to write a commit message saying why it moved* — the same accountability we apply to ADR amendments. Future PRDs that change these floors **must amend ADR-0021 in the same commit.**

The locked baseline includes the denominator as well as the numerator. A run that reports `21/24` workflow tickets or `60/80` agent-completion files fails the gate; the sample shape itself changed and therefore requires the same explicit ADR amendment as a floor change.

#### Worked example — PRD-0032 baseline ratchet

PRD-0032 shipped a determinism fix in `src/cli/import.ts` that stabilized the measured baselines at higher values than the original lock. The amendment in this same commit:

1. Updates the Rule 2 table verbatim (commits 11 → 13, files 62 → 65).
2. Updates `ASSEMBLY_GATE_BANDS` in `src/eval/assembly-gate-bands.ts` to the matching values.
3. References `docs/evals/prd-0032-verification.md` as the evidence trail.

The floor changes (commits 10 → 12, files 60 → 63) are derived mechanically from the baseline + tolerance; they are not separately decided.

## N=50 transition point

Rule 1's case-count bands are deliberately scoped to N ≤ 50. When the 174-case PRD-0016 panel grows, or when the workflow probe expands past 50 tickets, the band switches to percentage points. PRD-0016's existing gate module is the destination pattern. This ADR names that transition explicitly so future PRDs do not re-debate it.

## Why this and not alternatives

- **Why not statistical thresholds (CI bounds, sequential testing)?** At N ∈ {14, 23, 66}, the only honest statement is "we lost a case or we didn't." Confidence intervals at this N are wider than the metric range.
- **Why three rules and not one?** Rule 1 picks the right *unit*. Rule 2 picks the right *origin*. Rule 3 picks the right *update process*. Collapsing any pair re-introduces a known failure mode (percentage drift at low N, aspirational floors blocking day-one CI, or invisible baseline ratcheting).
- **Why not per-corpus floors on the 174-case panel?** Out of scope. The panel is a single aggregate gate; per-corpus floors invite corpus-specific tuning, which is the failure mode PRD-0016 was written to prevent.

## Consequences

- The probes (`real-workflow-probe.ts`, `agent-completion-probe.ts`) print verdict blocks and exit non-zero on gate failure; CI wires them alongside `prd0016-gates` in [`.github/workflows/assembly-gates.yml`](../../.github/workflows/assembly-gates.yml).
- Each future improvement that raises the metric will look like a "stale floor" until an ADR amendment ratchets the floor up. The pressure valve is intentional — false negatives from a stale floor are recoverable; false positives from an over-eager floor block merges.
- Multi-metric correlated regressions (one case lost on each of three probes simultaneously) pass each gate individually but show up as "3 probes each lost 1 case" in the aggregated CI block. Manual judgment, not automated.
