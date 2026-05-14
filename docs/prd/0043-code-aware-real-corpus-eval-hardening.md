# PRD-0043: Code-Aware Real-Corpus Eval Hardening

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's forty-third PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md) — see `fact-finding quality`, `Context Pack`, `pack entry`, `workflow assembly`, `agent-completion source-file coverage`, `coverage_confidence`, `pack readiness verifier`, and `low-signal recovery`. Governing ADRs: [ADR-0019](../adr/0019-retrieval-architecture-rethink.md) (deterministic core first), [ADR-0021](../adr/0021-gate-calibration-policy.md) (measured floors and locked gates), [ADR-0023](../adr/0023-chunk-first-code-retrieval-with-file-graph-late-augmentation.md) (chunk-first code retrieval), [ADR-0024](../adr/0024-code-must-compete-inside-the-core-pack-authority.md) (code must participate inside the core pack authority), and [ADR-0025](../adr/0025-code-navigation-fields-and-get-code-chunk-are-first-class-mcp-contract.md) (structured code navigation contract). Historical predecessor PRDs: [PRD-0015](0015-source-scoped-chunk-selection-and-pack-readiness.md) (pack-readiness and chunk-correctness language), [PRD-0041](0041-chunk-first-code-retrieval-lane.md) (chunk-first code lane), and [PRD-0042](0042-code-lane-promotion-and-downstream-task-success-validation.md) (promotion and downstream task-success validation).
>
> Boundary rule: this PRD extends the existing hardened real-corpus eval structure to coding applications with the same anti-overfitting discipline, explicit oracle shape, and cross-repo confidence bar that the doc/text panel already carries. It does NOT redesign runtime retrieval, weaken existing doc gates, replace commit-grounded downstream task-success validation, or substitute fuzzy code judgments for explicit fixtures.

## Problem Statement

ContextTrail already has a strong broad-corpus truth-check for doc retrieval and workflow assembly.

That matters because the real-corpus panel is not just a convenience script. It is the main reason the repo can believe a retrieval improvement is real rather than overfit:

- multiple OSS repos
- locked fixtures
- explicit expected outcomes
- stable miss buckets
- reusable reports and baselines

The code lane does not yet enjoy that same level of hardness.

Today the repo can measure code quality through:

- agent-completion source-file coverage
- code-lane promotion verdicts
- commit-grounded downstream task-success probes

Those are valuable, but they do not yet provide the same broad multi-repo retrieval-confidence surface that the real-corpus eval already provides for docs.

The gap is structural, not philosophical:

- the existing larger corpus eval is still doc-shaped
- its oracle still reasons mainly about doc chunks and source docs
- its positive expectations are not yet expressed in code-file or code-chunk terms
- some of its truth checks still depend on doc-oriented assumptions such as heading correctness or `contexttrail` parsing

That means the repo can build a code lane, compare it in narrow probes, and even run promotion logic, but it still cannot say with the same confidence:

> this code-retrieval behavior generalizes across OSS repos, is not overfit to one panel, and is safe to tune case by case without accidentally making the benchmark easier.

Without that harder eval surface, code-retrieval iteration will drift toward feel, local fixes, or single-repo optimization. That is exactly what the broader real-corpus system was designed to prevent.

## Solution

Extend the existing real-corpus eval into a code-aware, mixed-surface retrieval truth-check while preserving the same integrity rules that made the doc/text panel trustworthy.

The new shape is:

1. Keep the existing multi-repo real-corpus harness, repo snapshots, import flow, baseline freezing, and report discipline.
2. Extend the fixture schema so a case can explicitly declare whether it is judging doc retrieval, code retrieval, or a mixed doc+code Context Pack.
3. Add code-specific expectations for files and chunks using structured code-entry fields rather than doc-oriented string scraping.
4. Add code-aware metrics and failure taxonomy without weakening or replacing the current doc metrics.
5. Keep the broad real-corpus panel as the retrieval truth-check, and keep PRD-0042's commit-grounded task-success harness as the downstream execution truth-check.
6. Use this hardened code-aware panel as the eval-first driver for future code-lane accuracy work, one miss class at a time.

The result should feel like a natural extension of the current real-corpus program, not a new benchmark family:

- same anti-overfitting posture
- same explicit fixtures
- same cross-repo pressure
- same baseline discipline
- same rule that production changes follow named failing cases rather than intuition

## User Stories

1. As a maintainer, I want code retrieval judged across multiple OSS repos, so that code-lane tuning is not overfit to one repo or one commit panel.
2. As a maintainer, I want the broad real-corpus eval to extend naturally to code, so that the repo keeps one hardened retrieval-confidence program instead of separate inconsistent benchmarks.
3. As a maintainer, I want the same integrity bar for code that we already have for docs, so that a passing code result means something durable.
4. As a maintainer, I want doc-only cases to stay intact while code-aware cases are added, so that broadening the panel does not silently make the original truth-check easier.
5. As a maintainer, I want code retrieval scored with explicit file and chunk expectations, so that we do not replace hard judgments with vibes.
6. As a maintainer, I want code and docs to be judged together on mixed tasks, so that implementation-shaped requests can prove both retrieval surfaces work together.
7. As a maintainer, I want mixed-surface misses attributed clearly, so that I can tell the difference between wrong-file, wrong-chunk, and doc-starvation failures.
8. As a maintainer, I want code-lane token economics and honesty to stay visible in the broader eval, so that retrieval wins do not hide prompt bloat or dishonest confidence.
9. As a maintainer, I want low-signal code requests tracked separately from anchored implementation requests, so that recovery problems do not get blurred into ordinary ranking misses.
10. As a maintainer, I want broad real-corpus retrieval accuracy kept separate from downstream task-success evaluation, so that each surface keeps a clear job.
11. As a maintainer, I want future runtime fixes to be driven by named failures in this panel, so that code-lane accuracy work stays eval-first.
12. As an eval author, I want to declare whether a case is `docs`, `code`, or `mixed`, so that the oracle knows what kind of truth it is responsible for.
13. As an eval author, I want to declare acceptable top code files explicitly, so that code-file truth is reviewable in git.
14. As an eval author, I want to declare acceptable top code chunks semantically, so that chunk-level truth survives normal edits better than line-based expectations.
15. As an eval author, I want code judgments to use structured fields such as file path, symbol path, and code role, so that the oracle does not depend on parsing human-readable strings.
16. As an eval author, I want mixed-surface expectations to express both doc and code truth, so that a case cannot pass just because one side happened to be good.
17. As an eval author, I want explicit distractor-sensitive cases for code too, so that term overlap and utility-file gravity stay visible as named miss classes.
18. As an eval author, I want stable failure taxonomy for code retrieval, so that regressions land in buckets we can reason about over time.
19. As an eval author, I want code fixtures to remain hand-authored and explicit, so that the oracle stays inspectable and reviewable.
20. As an eval author, I want reusable report output and frozen baselines, so that improvements and regressions are diffable rather than anecdotal.
21. As a future contributor, I want the broad code panel to show top-1, top-3, MRR, and chunk-usefulness style metrics, so that the retrieval surface is measurable from multiple angles.
22. As a future contributor, I want the panel to report misses by repo, surface type, query intent, and failure class, so that the next fix is obvious.
23. As a pilot operator, I want the code-aware panel to include unfamiliar OSS repos with different repo shapes, so that passing results mean the engine generalizes beyond our habits.
24. As a product owner, I want the code-aware real-corpus panel to be hard enough that a pass gives strong confidence, so that later promotion decisions are built on a trustworthy upstream surface.

## Implementation Decisions

### Product shape

- This PRD is an eval-hardening slice, not a runtime retrieval redesign.
- The existing real-corpus eval remains the primary broad retrieval truth-check.
- The code-aware extension is additive and must preserve the current doc-side integrity rather than replacing it.
- PRD-0042 remains the downstream task-success and promotion surface; PRD-0043 strengthens the upstream multi-repo retrieval truth-check that PRD-0042 depends on.

### Core principle

- The code-aware panel must inherit the same anti-overfitting posture as the current doc/text panel:
  - locked fixtures
  - explicit expected outcomes
  - stable miss buckets
  - cross-repo diversity
  - no lowering the oracle just to make scores rise
- Code evaluation should be harder because it is more precise, not easier because it is more ambiguous.

### Harness reuse

- Reuse the existing real-corpus lab workflow:
  - repo snapshot layout
  - import/setup flow
  - baseline freezing
  - report generation
  - cohort summaries
- Do not fork a separate “code benchmark” framework unless the existing real-corpus machinery proves structurally incapable, which is not the current belief.

### Fixture model

- Extend the case schema with an explicit surface selector such as:
  - `docs`
  - `code`
  - `mixed`
- Preserve the current doc expectation fields for doc cases.
- Add code-aware expectation fields for code and mixed cases, including:
  - acceptable top code files
  - must-include code files
  - acceptable top code chunks
  - must-include code chunks
- Code-chunk selectors should be semantic rather than line-based, using a stable combination such as:
  - file path
  - symbol path
  - code role
- The schema may also admit explicit code distractor expectations for adversarial cases where utility-file gravity or broad term overlap is a known risk.

### Truth source for code judgments

- Code judgments must use structured ranked-entry fields rather than scrape human-readable `contexttrail` text.
- Structured code fields such as source path, symbol path, code role, and line range should be treated as authoritative for the eval layer.
- The eval may still render human-readable `contexttrail` for reports, but report text is not the oracle.
- The code-aware panel should not infer truth from whether a file path happened to appear in a code body string.

### Mixed-surface contract

- A mixed case may require both doc and code evidence.
- Mixed cases should declare explicitly whether both surfaces are required or whether one surface is only supportive.
- Code top-1 correctness in mixed cases should be judged against the first code entry rather than the absolute first ranked entry overall.
- A mixed case should not pass merely because doc retrieval was strong if the code expectation failed, or vice versa, unless the fixture explicitly says the missing surface was optional.

### Metrics

- Preserve current doc-side retrieval metrics and summaries.
- Add code-aware metrics that mirror the same discipline, including:
  - code-file top-1
  - code-file top-3
  - code-file mean reciprocal rank
  - code-chunk top-1 acceptable
  - code-chunk ranked useful
- Keep shared honesty and pack-quality metrics visible where relevant, including:
  - `query_mode`
  - `coverage_confidence`
  - `pack_readiness`
  - token usage / budget behavior
- Group summaries should remain explorable by repo, query intent, expectation kind, and eval surface.

### Failure taxonomy

- Introduce stable code-aware failure classes rather than collapsing all misses into “wrong result.”
- The taxonomy should distinguish at least:
  - wrong file / file recall miss
  - right file, wrong chunk
  - mixed-surface starvation where one surface crowds out the other
  - query-mode miss
  - `signal_empty` dishonesty
  - confidence or readiness dishonesty
  - pack-shape or budget miss
- Failure classes should be durable enough to support baseline diffs, issue creation, and miss-by-miss tuning over time.

### Cross-repo hardness

- The code-aware panel must cover multiple heterogeneous OSS repos before it is treated as a promotion-grade truth surface.
- Repo selection should deliberately vary shape, for example:
  - class-heavy vs function-heavy codebases
  - sparse-doc vs rich-doc repos
  - library vs service vs CLI layouts
  - config-heavy or generated-adjacent layouts
- The panel should favor diversity over raw query count concentrated in one repo.
- No single repo should become the silent proxy for “code retrieval quality.”

### Snapshot policy

- Reuse the existing snapshot discipline rather than live-cloning moving upstream repos at eval time.
- Extend selected real-corpus snapshots to include the code needed for code-aware retrieval judgments.
- Code snapshots should stay narrow enough to remain reviewable and stable, but broad enough that code retrieval is honest to the original repo shape.
- Fixture authors should prefer explicit, inspectable snapshots over large opaque dumps.

### Relationship to runtime retrieval

- This PRD does not itself change the live code-lane behavior except where small eval-facing contract completion is required.
- The panel exists to expose named retrieval defects.
- Future ranking, packing, or recovery changes should be justified by failing code-aware real-corpus cases rather than local intuition.
- The eval layer must not smuggle in runtime-only heuristics that do not exist in the product.

### Relationship to downstream evaluation

- The broad real-corpus code-aware panel remains the retrieval truth-check.
- Commit-grounded task-success evaluation remains the downstream execution truth-check.
- These surfaces are complementary, not redundant:
  - broad panel answers “does retrieval generalize?”
  - downstream harness answers “did the agent finish the task acceptably?”
- Neither should be weakened to compensate for gaps in the other.

### Reporting and baselines

- Baseline JSON and markdown reporting should remain first-class outputs.
- Reports should render doc, code, and mixed cohorts separately and together.
- Case-level reports should surface the exact expectation that failed and the assigned miss bucket.
- Promotion or tuning discussions should be able to cite a stable report artifact rather than rerunning an ad hoc command and paraphrasing the result.

### Deep modules

- Prefer a few deep reusable eval modules over scattered case-specific logic:
  - a code-aware fixture schema and validator
  - a semantic code expectation matcher
  - a mixed-surface outcome classifier
  - a stable failure-taxonomy mapper
  - a cross-repo code-aware report/baseline module
- Avoid distributing code-truth logic across many unrelated reporters or bespoke scripts.

## Testing Decisions

Good tests for this PRD should prove externally visible eval behavior, not private implementation details.

That means:

- test whether fixtures are interpreted correctly
- test whether code expectations are matched against the right structured fields
- test whether doc-only behavior stays intact
- test whether mixed-surface cases classify correctly
- test whether failure classes are assigned to the right user-visible miss shape
- test whether reports and baselines preserve the important comparison surface

Tests should avoid locking down:

- incidental internal helper decomposition
- exact private scoring arithmetic when only the visible bucket or metric matters
- fixture ordering unless ordering is part of the rendered contract
- string formatting that is not semantically important to the report

Modules and behaviors that need coverage:

1. Fixture-schema validation for `docs`, `code`, and `mixed` cases.
2. Code-file expectation matching from structured ranked-entry fields.
3. Code-chunk semantic selector matching.
4. Mixed-surface classification when both doc and code expectations are present.
5. Failure-taxonomy assignment for wrong-file, wrong-chunk, starvation, and honesty defects.
6. Summary aggregation for code top-1, top-3, MRR, and chunk-usefulness metrics.
7. Preservation of existing doc-only real-corpus behavior and scores.
8. Baseline/report rendering for mixed-surface output.
9. Snapshot/import flow for code-bearing real-corpus repos.
10. Separation between broad real-corpus retrieval truth and downstream task-success evaluation.

Prior art for these tests already exists and should be reused where possible:

- real-corpus fixture and report tests
- context-assembly eval and report tests
- agent-completion probe tests
- task-success eval tests
- promotion verdict tests
- readiness and confidence-policy tests
- source-selection and chunk-correctness tests

## Out of Scope

- Redesigning the chunk-first code lane itself.
- Embeddings.
- Runtime LLM reranking or LLM judging in the retrieval path.
- Replacing the broad real-corpus eval with a brand-new benchmark framework.
- Replacing PRD-0042's downstream task-success harness.
- Relaxing doc-side gates to make mixed-surface reporting easier.
- Fuzzy overlap-only code judgments with no explicit fixture truth.
- Automatic code-fixture generation from git diffs alone.
- Rich new multi-language chunker work beyond what is needed to seed honest code-aware cases.
- UI or product-surface changes unrelated to eval/reporting.

## Further Notes

The important thing here is not inventing a new testing philosophy for code.

It is carrying forward the one the repo already trusts:

- hard fixtures
- multiple OSS repos
- explicit truth
- named failures
- baselines that can veto bad ideas

The text/doc side earned credibility because the eval got hard before the tuning got aggressive.

Code needs the same progression.

PRD-0041 made it possible to retrieve code as real pack entries.

PRD-0042 started measuring whether that lane helps enough to promote.

PRD-0043 makes the broader retrieval truth-check for code hard enough that future accuracy work can proceed the same way the doc engine matured: one named miss class at a time, without confusing local wins for general progress.
