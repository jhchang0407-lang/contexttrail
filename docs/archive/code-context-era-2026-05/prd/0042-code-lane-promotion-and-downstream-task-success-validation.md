# PRD-0042: Code-Lane Promotion and Downstream Task-Success Validation

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's forty-second PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md) — see `Context Pack`, `pack entry`, `workflow assembly`, `agent-completion source-file coverage`, `coverage_confidence`, `pack_readiness`, and `query_mode`. Governing ADRs: [ADR-0014](../adr/0014-agent-assisted-setup-without-truth-promotion.md) (helpful assistance without silent truth promotion), [ADR-0019](../adr/0019-retrieval-architecture-rethink.md) (deterministic core first), [ADR-0021](../adr/0021-gate-calibration-policy.md) (measured floors), [ADR-0023](../adr/0023-chunk-first-code-retrieval-with-file-graph-late-augmentation.md) (chunk-first code retrieval), [ADR-0024](../adr/0024-code-must-compete-inside-the-core-pack-authority.md) (code participates inside the core pack authority), and [ADR-0025](../adr/0025-code-navigation-fields-and-get-code-chunk-are-first-class-mcp-contract.md) (first-class code navigation contract). Predecessor PRDs: [PRD-0029](0029-gate-calibration-tolerance-bands.md) (locked evaluation floors), [PRD-0036](0036-phase-0-exit-fixes.md) (pilot exit fixes), and [PRD-0041](0041-chunk-first-code-retrieval-lane.md) (chunk-first packed code lane).
>
> Boundary rule: this PRD does NOT redesign the chunk-first code lane. It validates, compares, and promotes it. The slice adds downstream task-success measurement, a second commit-grounded codebase, and explicit promotion gates from shadow behavior to live default behavior. It may deepen recovery behavior only when the validation harness proves a named failure shape. It does NOT add embeddings, runtime LLM judging, richer multi-language chunkers, or a second retrieval architecture.

## Problem Statement

PRD-0041 can make code a first-class chunk-sized retrieval lane, but that still leaves the biggest product claim unproved:

> does the new code lane actually help agents complete real work better, or does it only make retrieval outputs look more plausible?

Today the repo can measure:

- single-doc retrieval quality
- workflow assembly
- agent-completion source-file coverage
- token-budget composition

Those are necessary, but they are still upstream metrics. They answer:

- did the pack include the right files?
- did the pack include useful chunks?
- did the pack stay inside the budget honestly?

They do not yet answer:

- did an agent with the pack produce a better implementation outcome than before?
- did the chunk-first code lane beat the old file-card lane on the same real tasks?
- is the new lane good enough to become the default live behavior instead of a shadow path?
- does the quality hold outside the current repo and current 14-commit panel?

Without that proof, the code lane is still a validated technical shape, not yet a promoted product behavior.

## Solution

Add a follow-on validation and promotion slice for the new code lane.

The slice has four jobs:

1. Run the old file-card code path and the new chunk-first code path on the same tasks, budgets, and fixtures.
2. Extend the evaluation surface from "is the right code in the pack?" to "did the agent finish the task correctly with that pack?"
3. Add a second commit-grounded codebase so the result is not still one-engineer-on-one-repo evidence.
4. Define explicit promotion gates that decide whether the PRD-0041 lane remains shadow-only or becomes the default live code path.

The result is a narrow but load-bearing outcome:

- if the new lane improves downstream task success without breaking honesty or token discipline, promote it
- if it fails, keep it shadowed and fix the named failure shape rather than arguing from feel

## User Stories

1. As a maintainer, I want to compare the old file-card code path and the new chunk-first code path on the same tasks, so that gains and regressions are attributable.
2. As a maintainer, I want the new code lane judged by downstream task success, so that we do not promote a retrieval shape that only looks better upstream.
3. As a maintainer, I want the promotion decision to use explicit gates, so that the live default does not flip on taste or optimism.
4. As a maintainer, I want the new lane evaluated on a second commit-grounded repo, so that one-repo success does not overstate generality.
5. As a maintainer, I want file coverage to remain a primary gate, so that the downstream harness does not hide obvious retrieval misses.
6. As a maintainer, I want code-chunk usefulness to remain visible beside file coverage, so that “right file, wrong chunk” is still measurable.
7. As a maintainer, I want the validation harness to preserve the current honesty contract, so that `coverage_confidence`, `pack_readiness`, and `query_mode` are still part of the verdict.
8. As a maintainer, I want low-signal queries measured separately from anchored implementation tasks, so that recovery problems do not get blurred into code-lane ranking problems.
9. As a maintainer, I want the task-success harness to stay outside the runtime critical path, so that evaluation depth does not complicate normal retrieval.
10. As a maintainer, I want the evaluation oracle to be inspectable, so that a failing verdict can be debugged instead of hand-waved away.
11. As an eval author, I want a small task-success fixture layer above the existing commit-grounded cases, so that we can judge “usable implementation outcome” without rebuilding the whole corpus harness.
12. As an eval author, I want each case to compare old-vs-new pack behavior under the same budget, so that token economics stay part of the result.
13. As an eval author, I want a typed fixture format for downstream acceptance, so that cases remain stable and reviewable in git.
14. As an eval author, I want the harness to distinguish “agent reached the right files” from “agent produced an acceptable change,” so that retrieval and execution can be analyzed separately.
15. As an agent operator, I want the promoted code lane to remain small and honest, so that better implementation help does not come at the cost of prompt bloat.
16. As an agent operator, I want the old path retained as a comparison baseline until the new lane passes promotion gates, so that regression audits stay possible.
17. As a pilot coordinator, I want the second repo to come from a realistically unfamiliar codebase, so that the result says something about real deployment risk.
18. As a pilot coordinator, I want low-signal and `signal_empty` queries logged during validation, so that later recovery work is based on lived query shapes rather than guesswork.
19. As a future maintainer, I want the promotion verdict written down in the repo, so that later readers know why the code lane did or did not become default.
20. As a future maintainer, I want PRD-0042 to deepen only named failures, so that validation does not quietly turn into another architecture rewrite.

## Implementation Decisions

### Product shape

- This PRD is a promotion-and-validation slice, not a new retrieval architecture slice.
- PRD-0041 remains the canonical design for the code lane itself.
- PRD-0042 decides whether that lane is good enough to become the default live behavior.

### Evaluation strategy

- Keep the existing file-coverage and chunk-usefulness metrics.
- Add a downstream task-success harness above them.
- Compare the old file-card path and the new chunk-first path on the same tasks and budgets.
- Preserve paired old-vs-new reporting in the verdict output instead of only reporting the new path in isolation.

### Task-success harness

- The harness should stay small and explicit, not a giant autonomous benchmark.
- Cases should be grounded in real shipped tasks rather than synthetic prompts.
- Acceptance should be based on externally visible outcome criteria, not private implementation details.
- The harness may use an LLM judge in the evaluation layer, but never in the runtime retrieval path.
- If an LLM judge is used, its role is evaluation only and its prompts/results must be inspectable and replayable.

### Fixture model

- Build on the current commit-grounded agent-completion panel rather than replacing it.
- Add a typed fixture module for downstream task-success cases.
- Each case should carry:
  - task text
  - budget
  - expected changed files or file set
  - acceptable outcome notes
  - any required anchors
  - any low-signal / negative-case expectation
- Keep retrieval fixtures and downstream task-success fixtures adjacent but not conflated.

### Second-codebase validation

- Add one second commit-grounded repo as the minimum next confidence step.
- Prefer a repo that is operationally realistic and not just a second slice of the current maintainer’s habits.
- The second repo does not need full language coverage expansion; it needs a believable unfamiliar task panel.

### Promotion gates

- Promotion is conjunctive, not rhetorical.
- The new lane should remain shadowed unless all named gates pass.
- Gates should cover:
  - agent-completion source-file coverage
  - top-1 acceptable code chunk / ranked useful code chunk
  - downstream task-success outcome
  - token accounting and pack honesty
  - no regression on workflow assembly
- A failing gate should name the miss bucket so the next fix is obvious.

### Runtime rollout

- Keep the old file-card path available during validation.
- Flip the live default only after promotion gates pass.
- Promotion should be a deliberate contract decision, not an accidental env-var drift.

### Low-signal scope

- `signal_empty` and low-signal recovery remain separate from ordinary code-lane ranking.
- This PRD measures low-signal query behavior during validation.
- It only changes recovery behavior when the validation harness proves a concrete miss shape worth fixing.
- Broad low-signal recovery redesign remains a later focused PRD if the evidence says it is the next real bottleneck.

### Reporting

- Verdicts should report old-vs-new side by side.
- Reports should separate:
  - file coverage
  - code chunk usefulness
  - downstream task success
  - token economics
  - honesty/recovery states
- The promotion verdict should be durable in-repo output, not just a console anecdote.

### Deep modules

- Prefer a few deep modules over many one-off scripts:
  - a paired code-lane comparison harness
  - a downstream task-success evaluator
  - a typed multi-repo fixture layer
  - a promotion verdict/gate module
  - a pilot-query logging/reporting module for low-signal observations

## Testing Decisions

Good tests for this PRD should prove product behavior, not evaluator internals.

That means:

- test the verdicts and gates the maintainer actually uses
- test paired old-vs-new comparisons on the same fixtures
- test task-success case interpretation through visible outputs
- test that failure reports point at a named miss bucket rather than only returning a boolean
- test that runtime retrieval does not silently change before promotion

Tests should avoid locking down:

- the internal wording of LLM-judge prompts beyond the contractually important parts
- exact score arithmetic inside new verdict modules when only bucketed outcomes matter
- fixture ordering that does not change the visible verdict

Modules and behaviors that need coverage:

1. Paired old-vs-new code-lane comparison on the same task set.
2. Downstream task-success fixture interpretation and verdict reporting.
3. Promotion gate evaluation across file coverage, chunk usefulness, downstream success, and workflow regression.
4. Budget-sensitive reporting for the new code lane under the same task set.
5. Honest treatment of low-signal and `signal_empty` cases during validation.
6. Runtime default behavior staying unchanged while the new lane is still shadowed.
7. Promotion flip behavior once the named gates pass.

Prior art for these tests already exists in the repo and should be reused where possible:

- `agent-completion-probe`
- `real-workflow-probe`
- `graph-assembly-shadow`
- `localized-graph-assembly-shadow`
- `real-corpus-readiness`
- `confidence-policy` and `pack_readiness` tests
- PRD-0029 gate-band tests and verdict formatting

## Out of Scope

- Embeddings.
- Runtime LLM reranking.
- Broader low-signal recovery redesign.
- Rich first-slice chunkers for new languages.
- Chunk-to-chunk graph edges.
- Replacing the PRD-0041 chunk-first lane with a different architecture.
- UI/productization work beyond the verdict and reporting surfaces needed for promotion.
- A full autonomous benchmark farm.
- Broad pilot-program operations beyond the minimum second-repo validation needed for promotion confidence.

## Further Notes

PRD-0041 is where the code lane becomes possible.

PRD-0042 is where it becomes either:

- a promoted default behavior
- or a clearly-audited shadow experiment with named remaining defects

That distinction matters.

Without PRD-0042, the repo would know how to build a better code lane but not whether it has earned the right to replace the old one.
