# PRD-0030: Token-Budget Pack-Quality Eval (Eval-Only)

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's thirtieth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADRs: [ADR-0017](../adr/0017-structural-assembly-rollout-contract.md), [ADR-0019](../adr/0019-retrieval-architecture-rethink.md), [ADR-0021](../adr/0021-gate-calibration-policy.md). Related PRDs: [PRD-0028](0028-code-source-index-for-agent-completion.md), [PRD-0029](0029-gate-calibration-tolerance-bands.md).
>
> Boundary rule: this PRD ships **measurement only**. No retrieval changes. No scoring changes. No new ranking levers. If the eval surfaces a named defect, the fix belongs in a *subsequent* PRD with its own gate.

## Problem Statement

Two assembly metrics measure pack composition today:

| metric | what it answers | budget posture |
|---|---|---|
| workflow-assembly source coverage (23 Linear tickets) | is the right *doc* in the pack? | runs at the default 6000-token budget |
| agent-completion source-file coverage (66 files / 14 commits) | is the right *code file* in the pack? | runs at the default 6000-token budget |

Neither measures whether the right *chunk* of the right doc survives truncation, and neither runs under varied budgets. With link + nav + code-import traversal enabled, the real-workflow probe surfaces a pack averaging **40+ entries per ticket** before token-budget truncation. The existing `src/eval/assembly-pressure-benchmark.ts` does pressure-test this — but on the **synthetic** fixture, not on real tickets, and it does not measure chunk-level relevance.

OPEN.md item 2 names the gap directly:

> *"Pack-quality vs pack-coverage is unmeasured. Today we measure 'is the right doc in the pack' — not 'is the right chunk of the doc the one that surfaces.'... Token-budget pressure under traversal is unmeasured. With link + nav + import traversal on, the pack averages 40+ surfaced sources per ticket. We have not stressed this against a 4k or 8k token budget."*

Three concrete questions are unanswered:

1. **Survival under small budgets.** When the agent runtime is 4k or 8k tokens (not the 6k default), does the right doc still appear in the rendered pack — or does post-rank truncation drop it?
2. **Chunk granularity.** When the right doc *is* in the pack, is the chunk the agent needs the one that survives? Or is the wrong chunk surviving because it scored higher despite being less topically relevant?
3. **Traversal-induced dilution.** With 40+ candidate entries and a small budget, does pack quality degrade non-linearly? I.e. is the issue that traversal-on packs are *worse* under pressure than traversal-off packs would be?

Per project convention (OPEN.md week-5 stance: *"evaluator-first, then production fixes only after the eval exposes a named defect"*), this PRD is eval-only.

## Solution

Extend the existing probes to accept a configurable budget knob, add minimum-viable chunk-level annotations to the 23-ticket fixture, and produce a budget-conditioned verdict that reports retention at three budget points. No production changes. No CI gates yet — calibration happens in a follow-up amendment to ADR-0021 once the baselines are measured.

### Slice 30.1 — Budget-conditioned real-workflow probe

`src/eval/real-workflow-probe.ts` already runs at the default 6000-token budget. Slice 30.1 adds a `--budget` flag (and a sweep mode `--budget-sweep 4096,8192,16384`) and produces a per-budget retention table:

```
budget   workflow_assembly   delta_vs_default
 4096    18 / 23  (78.3%)    -4 cases
 8192    21 / 23  (91.3%)    -1 case
16384    22 / 23  (95.7%)     baseline
```

Retention is measured against the existing `must_include_sources` annotations — no new ground truth needed for slice 30.1.

The single material change: replace the hard-coded `budget_tokens: 6000` site in the probe's MCP-handler invocation with a parameterized value. Probe contract for CI gating is unchanged (default budget, default verdict). Sweep mode is opt-in.

### Slice 30.2 — Budget-conditioned agent-completion probe

Same treatment for `agent-completion-probe.ts`: `--budget` and `--budget-sweep` flags, per-budget retention table for the per-file metric. Per-commit metric is reported alongside for context but the headline is per-file (it's the metric that should drop fastest under truncation since traversal-pulled code files cluster at the score floor).

### Slice 30.3 — Chunk-level annotations + eval (minimum-viable)

Slice 30.3 introduces chunk-level ground truth on the 23-ticket workflow fixture only. Format: an optional `must_include_chunks: [{ source, heading_path }]` field per ticket. Annotation is hand-authored — for each ticket, name the heading_path (or `<root>` for chunks above the first heading) of the chunk the engineer actually needed.

The eval reads `must_include_chunks` and reports a new metric: **workflow-assembly chunk coverage** — the right *chunk* of the right doc surviving in the rendered pack. Reported at each budget point alongside the existing doc-level metric.

Per ADR-0021, this is a **new metric**. It does NOT immediately become a gate. The first run establishes the baseline; calibration into ADR-0021 is a separate explicit commit.

If chunk annotation is too expensive for the full 23-ticket set in one pass, slice 30.3 ships annotations for the subset where the right doc has more than one chunk competing (the only cases where chunk-level can disagree with doc-level). Tickets where the right doc has one chunk are trivially chunk-equivalent to doc-level.

### Slice 30.4 — Report + named-defect classification

The new sweep runs produce three retention curves (workflow doc-level, workflow chunk-level, agent-completion file-level) at 4k / 8k / 16k. Slice 30.4 commits the first measured baselines under `docs/evals/prd-0030-budget-baselines.md` and classifies any drop below the default-budget number as one of:

1. **Truncation drop** — the right doc/chunk/file was ranked but post-rank truncation removed it under small budgets. Fix lives in pack-composition logic (locked-first ordering, score-floor pruning).
2. **Traversal dilution** — the right doc/chunk/file was *demoted* below the cut by lower-scoring traversal-pulled neighbors. Fix lives in source-rerank scoring or traversal policy.
3. **Always-missed** — the right doc/chunk/file was never in the pack even at 16k. Not a budget problem; orthogonal to this PRD.

Each named defect becomes a follow-up PRD candidate. PRD-0030 itself does not fix any of them.

## Out of scope

* **Any retrieval, scoring, or ranking change.** Eval-only.
* **New traversal levers** (reverse-import, query rewriting). Those are the signal_empty PRD's territory.
* **Calibrating the new chunk-level metric into a CI gate.** Per ADR-0021, that requires a deliberate ADR amendment after baseline observation. A separate commit, not part of this PRD.
* **Annotating chunk-level ground truth on the 66-file agent-completion fixture.** Code files don't have "chunks" in the same sense; the file *is* the unit. Per-file retention under budget is the right granularity there.
* **Pressure-testing under hypothetical 1k or 2k budgets.** No real agent runtime ships with budgets that small today, and at that scale the pack is too small for any policy to matter.
* **Replacing the synthetic `assembly-pressure-benchmark`.** It stays — slice 30.x adds *real-fixture* pressure measurement alongside, not instead.

## Risks

* **Annotation drift.** Hand-authored `must_include_chunks` annotations encode one engineer's reading of "the right chunk." If a doc's heading structure changes, annotations rot. Mitigation: annotate against `heading_path`, not chunk hashes — heading paths survive reformatting more often. Treat re-annotation as a normal cost of doc edits.
* **Chunk-level becomes a noise floor, not a signal.** If chunk-level coverage at default budget is e.g. 19/23 vs doc-level 22/23, that 3-case gap may reflect *fixture annotation taste* more than a real retrieval defect. Mitigation: slice 30.3 explicitly captures rationale per annotation so noise vs signal is debuggable.
* **Sweep cost.** Running both probes at three budgets is 6x the CI cost of the default run. Mitigation: sweep is opt-in and not part of the CI default run. The baseline file in slice 30.4 is updated by a manual `--budget-sweep` invocation, not by every PR.
* **Truncation policy is the only knob worth measuring.** If `retrieve_context_pack` already drops chunks deterministically by score and there's nothing more sophisticated to measure, the eval may produce uninteresting curves (monotone drop with budget). Mitigation accepted: even a boring curve is the right baseline, and the boring case is itself the verdict ("budget pressure is not currently a quality lever").

## Acceptance — PRD-level

PRD is complete when:

1. `src/eval/real-workflow-probe.ts` and `src/eval/agent-completion-probe.ts` accept `--budget` and `--budget-sweep` flags.
2. `tests/fixtures/real-workflows/*.yaml` (the 23-ticket panel) has `must_include_chunks` populated for every ticket where the right doc has more than one chunk. Tickets where the right doc is single-chunk may omit it.
3. The probes produce a chunk-coverage column alongside the existing source-coverage column.
4. `docs/evals/prd-0030-budget-baselines.md` exists and records measured baselines for workflow doc-level, workflow chunk-level, and agent-completion file-level retention at 4k / 8k / 16k.
5. Any retention drop below the default-budget number is classified per slice 30.4's taxonomy and linked to either a follow-up PRD or an explicit "tolerated for now" note with reason.
6. OPEN.md item 2 is updated to reference the measured baseline and the named follow-up PRD candidates.

## Why structural, not data-fitting

| concern | mitigation |
|---|---|
| Will the sweep budgets be tuned to make today's pack look good? | Budgets are the realistic runtimes agents actually ship with (Claude/Sonnet defaults, small-context configurations). They're not chosen to flatter the measurement. |
| Will chunk-level annotations encode the same engineer's taste that built the pack? | Slice 30.3 demands rationale per annotation. If two engineers would annotate the same chunk, the signal is durable; if they wouldn't, the metric is exposed as taste-dependent and reported as such. |
| Why no CI gate from day one? | Per ADR-0021 Rule 3, gates require baselines first. PRD-0030 produces the baselines. Wiring them as gates is a deliberate follow-up. |
| Could this be done as a single sweep run, no PRD? | The sweep run is the easy part. The hard part is committing the baselines, classifying defects, and resisting the temptation to fix them inside this PRD. The PRD shape is what enforces the boundary. |
