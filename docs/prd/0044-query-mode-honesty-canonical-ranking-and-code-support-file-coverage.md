# PRD-0044: Query-Mode Honesty, Canonical Ranking, and Code Support-File Coverage

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's forty-fourth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md) — see `fact-finding quality`, `query_mode`, `signal_empty honesty`, `Context Pack`, `context assembly`, `workflow assembly`, `agent-completion source-file coverage`, `code-source index`, `import graph`, `coverage_confidence`, `pack readiness verifier`, and `low-signal recovery`. Governing ADRs: [ADR-0019](../adr/0019-retrieval-architecture-rethink.md) (deterministic core first), [ADR-0021](../adr/0021-gate-calibration-policy.md) (measured gates and locked baselines), [ADR-0023](../adr/0023-chunk-first-code-retrieval-with-file-graph-late-augmentation.md) (chunk-first code retrieval), [ADR-0024](../adr/0024-code-must-compete-inside-the-core-pack-authority.md) (code participates inside the core pack authority), and [ADR-0025](../adr/0025-code-navigation-fields-and-get-code-chunk-are-first-class-mcp-contract.md) (structured code-navigation contract). Predecessor PRDs: [PRD-0041](0041-chunk-first-code-retrieval-lane.md) (chunk-first code lane), [PRD-0042](0042-code-lane-promotion-and-downstream-task-success-validation.md) (paired validation and promotion), and [PRD-0043](0043-code-aware-real-corpus-eval-hardening.md) (code-aware broad retrieval truth surface).
>
> Boundary rule: this PRD does NOT invent a new retrieval architecture. It operationalizes the miss taxonomy now visible in the hardened eval surfaces. The shape is already known from strong coding engines: grounded anchor honesty first, canonical source selection second, bounded support context third. This slice fixes accuracy defects in the current deterministic engine; it does NOT add embeddings, runtime LLM judging, deeper graph traversal, broader pack-sizing work, or another code-lane substrate redesign.

## Problem Statement

From the user's perspective, the problem is not that ContextTrail lacks retrieval machinery. It is that the system is still too inaccurate to trust for coding work.

The broad and downstream evals now make that concrete.

As of `2026-05-13`, the main broad retrieval panel shows:

- `146/176` answer-bearing top-1 (`83.0%`)
- `166/176` answer-bearing top-3 (`94.3%`)
- `26/26` signal-empty honesty

Those top-line numbers look respectable until the miss taxonomy is unpacked:

- `34` `query_mode_miss`
- `20` `answer_ordering_miss`
- `9` `answer_recall_miss`
- `1` `pack_shape_miss`
- `1` `code_chunk_miss`

The code and downstream surfaces are weaker still:

- paired code-lane file coverage is only `15/66`
- paired code top-1 acceptable is only `1/14`
- paired code ranked useful is only `2/14`

The broad context-assembly surface is comparatively healthy:

- top-5 full coverage is `166/175`
- only `9` top-5 assembly misses remain across the broad panel

So the main problem is not pack sizing or assembly mechanics. It is earlier in the pipeline:

1. Anchored implementation-shaped requests are still being labeled as `signal_empty` or otherwise assigned the wrong `query_mode`.
2. Broad-domain and cross-module requests often retrieve the right neighborhood but rank the wrong canonical source first.
3. The code lane still fails to surface the support files around the winning file/chunk cluster often enough for real implementation work.

The result is a system that can look plausible in retrieval output while still failing the real product question:

> does the pack put the engineer or agent on the right implementation path quickly enough to work safely?

The user has already lived this pattern in the text system: first harden the eval, then attack one miss class at a time until confidence is high enough that changes generalize across OSS repos. PRD-0043 gives us the eval hardness. PRD-0044 is the first runtime accuracy-hardening slice driven by that evidence.

## Solution

Fix the three dominant miss classes in priority order, using the hardened eval surfaces as the gate for every change:

1. **Query-mode honesty**
   - anchored file and symbol asks must stop collapsing into `signal_empty` when the engine actually has grounded evidence
   - `signal_empty` should remain fail-closed and honest, but not over-fire on implementation-shaped requests

2. **Canonical source ranking**
   - when the right family of docs is already in the candidate set, broad-domain and cross-module queries must rank the canonical source above plausible adjacent siblings, changelogs, utility pages, and broad container docs

3. **Code support-file coverage**
   - once the engine finds the primary file or chunk, the code lane must surface the bounded support cluster around it often enough to point the engineer at the actual implementation set rather than just one entrypoint

The runtime shape should stay simple:

- anchor honesty decides the correct `query_mode`
- canonical source selection decides which doc or file family is actually about the task
- support-file coverage adds a bounded set of necessary neighboring files after the winners are known

The success condition is not “the metrics went up somewhere.” It is:

- the dominant miss buckets shrink materially on the broad real-corpus panel
- the paired code-lane comparison improves file coverage and code usefulness
- the downstream validation surfaces do not regress

## User Stories

1. As an engineer asking an anchored coding question, I want the engine to recognize that my file or symbol anchor is real, so that it does not shrug and treat my request as `signal_empty`.
2. As an engineer, I want implementation-shaped requests to stay grounded when relevant code or docs clearly exist, so that I do not lose time fighting false low-signal behavior.
3. As an engineer asking a broad domain question, I want the most canonical source ranked first, so that I land on the right answer rather than a plausible but secondary page.
4. As an engineer asking a cross-module question, I want the engine to choose the right foundational source family before expansion, so that support context is assembled around the right center.
5. As an engineer using the code lane, I want the pack to include the supporting implementation files around the winning file, so that I can actually complete the change rather than just identify one entrypoint.
6. As an engineer, I want support-file coverage to stay bounded, so that better code usefulness does not become a prompt-bloat regression.
7. As a maintainer, I want the next runtime slice to follow the hardened miss taxonomy instead of intuition, so that accuracy work is reproducible and anti-overfit.
8. As a maintainer, I want query-mode fixes to preserve honest abstention on truly unsupported requests, so that improving anchored behavior does not collapse back into overconfident nonsense.
9. As a maintainer, I want canonical ranking fixes to prefer authoritative and relevant sources for the right reasons, so that broad-domain wins do not come from brittle hacks.
10. As a maintainer, I want support-file coverage to use existing file identity and import-graph substrate where possible, so that we do not redesign the code lane again.
11. As a maintainer, I want the code lane to help with real implementation clusters like schemas, DB layers, and source-profile substrate files, so that downstream usefulness rises meaningfully.
12. As a maintainer, I want the next slice to be measurable on the broad real-corpus panel, so that success is not defined by one repo or one ticket.
13. As a maintainer, I want the next slice to be measurable on paired code-lane comparison, so that I can see whether file coverage and code usefulness actually moved.
14. As a maintainer, I want workflow assembly to remain stable while we improve accuracy, so that code-lane fixes do not accidentally break doc-side sufficiency.
15. As a maintainer, I want downstream task-success evidence to remain non-regressing, so that upstream retrieval gains do not hide a worse execution experience.
16. As an eval author, I want each runtime fix to map to a named miss bucket, so that reports stay interpretable over time.
17. As an eval author, I want miss cohorts to remain separated into query-mode, ordering, recall, pack-shape, and code-chunk failures, so that different fixes do not blur together.
18. As an eval author, I want code-support improvements judged by file coverage and code usefulness rather than vibes, so that “helpful enough to code” stays explicit.
19. As a future contributor, I want this PRD to make clear that the current bottleneck is not context packing, so that future work does not waste time optimizing the wrong layer.
20. As a future contributor, I want the deep modules in this slice to be stable seams for future tuning, so that later accuracy work composes instead of scattering knobs everywhere.
21. As a product owner, I want the path to higher confidence to resemble the hardened text-system process, so that the coding engine earns trust the same way: broad eval first, then systematic miss-by-miss improvement.
22. As a product owner, I want improvements to follow known strong coding-engine patterns without blindly copying their internals, so that ContextTrail stays deterministic and explainable while still learning from proven shapes.

## Implementation Decisions

### Product shape

- This is an **accuracy-hardening slice**, not a new retrieval-engine architecture slice.
- The slice consumes PRD-0043’s code-aware real-corpus panel and PRD-0042’s paired/downstream surfaces as its gates.
- The order of work is explicit:
  1. query-mode honesty
  2. canonical ranking
  3. code support-file coverage
- Work should stop after each sub-slice if the named eval cohort does not improve.

### Deep modules

- Introduce or deepen a **query-scope honesty module** whose job is to decide when anchors are genuinely grounded, when they are weak, and when `signal_empty` is truly warranted.
- Introduce or deepen a **canonical source adjudication module** whose job is to choose the right primary doc or source family when the candidate neighborhood is already approximately correct.
- Introduce or deepen a **code support-coverage module** whose job is to add a bounded support cluster around a winning file or chunk without exploding prompt size.
- Keep a small **accuracy cohort reporting seam** that maps runtime deltas back onto the named eval buckets rather than relying on ad hoc before/after reading.

### Query-mode honesty

- Anchored file and symbol requests must be fail-closed but not prematurely empty.
- The engine should distinguish:
  - truly unrecognized anchors
  - recognized but weak anchors
  - recognized anchors with real supporting evidence
- `signal_empty` remains correct only when the request is genuinely unsupported or ungrounded, not when the engine already has plausible grounded sources.
- Anchored implementation requests should prefer `anchored` or, when truly necessary, `unanchored` over false `signal_empty`.
- Signal-empty behavior for broad unsupported asks must remain honest and preserved by regression tests.

### Canonical ranking

- Broad-domain and cross-module misses should be treated primarily as **ordering** and **source adjudication** defects, not assembly defects.
- Ranking should prefer canonical sources over:
  - changelog fragments
  - broad container pages
  - near-sibling docs with overlapping terms
  - utility/reference pages that mention the concept but do not own it
- The ranking layer should use deterministic structural signals already available in the engine wherever possible rather than introducing opaque semantic judges.
- The canonical-source fix should be evaluated against the existing broad-domain and cross-module miss cohorts before expanding scope.

### Code support-file coverage

- The first goal is not “retrieve more code everywhere.” It is “retrieve the right support files when a primary file or chunk already won.”
- Support coverage should stay bounded and deliberate:
  - one winning file or chunk does not justify dumping the whole neighborhood
  - neighboring files should be admitted because they materially support the implementation cluster
- The module should be able to surface recurring support-file classes visible in the current misses, such as substrate schema, DB, shared type, and source-profile support files.
- Existing file identity and graph substrate should be reused before introducing any new graph depth or exotic retrieval unit.
- Support-file coverage must be evaluated on the commit-grounded paired code-lane panel, because that is where the current misses are most obvious.

### Evaluation contract

- PRD-0043 broad real-corpus metrics remain the upstream truth surface.
- PRD-0042 paired code-lane comparison and downstream task-success remain the downstream validation surface.
- No runtime fix in this PRD is accepted unless it improves the targeted miss cohort on the broad panel and does not regress the downstream surfaces.
- Improvements should be attributable to a named miss bucket, not just an aggregate score bump.

### Sequencing

- Start with the dominant miss bucket first:
  - `query_mode_miss` (`34` current misses)
- Then address canonical ranking:
  - `answer_ordering_miss` (`20` current misses)
  - `answer_recall_miss` (`9` current misses) when ranking fixes clearly expose remaining recall problems
- Only then deepen code support coverage, because current evidence says the main global bottleneck is still upstream of pack assembly.

### Known reference pattern

- Strong coding engines already suggest the correct overall pattern:
  - grounded anchors first
  - correct owner/canonical source next
  - bounded support context after the owner is known
- This PRD adopts that pattern deliberately, but preserves ContextTrail’s deterministic and inspectable architecture.
- The slice should not attempt to mimic external products by smuggling in hidden semantic judges, embeddings, or opaque ranking steps.

## Testing Decisions

Good tests for this PRD should verify **external accuracy behavior** against the named miss cohorts, not lock down implementation details like coefficient values or helper ordering.

A good test in this slice:

- proves that a previously failing anchored query no longer misreports `signal_empty`
- proves that a canonical source now ranks above the wrong sibling or changelog page
- proves that the code lane surfaces the right support-file cluster on a commit-grounded task
- proves that signal-empty honesty for truly unsupported asks still holds
- proves that broad doc/context assembly and downstream task-success did not regress

Tests should avoid:

- pinning specific internal scoring constants
- snapshotting large incidental ranked slates when only the relevant behavioral outcome matters
- turning one repo’s exact path patterns into general engine law without a named eval cohort to justify it

Modules and behaviors that need coverage:

1. Query-mode honesty classification for anchored file and symbol asks.
2. Query-mode fail-closed behavior for truly unsupported signal-empty asks.
3. Canonical source adjudication for broad-domain and cross-module miss cohorts.
4. Code support-file coverage around winning files/chunks on commit-grounded tasks.
5. No-regression coverage for workflow assembly and downstream task success.
6. Cohort reporting that attributes wins and losses to the intended miss bucket.

Prior art for tests already exists and should be reused where possible:

- the code-aware real-corpus panel from PRD-0043
- context-assembly evaluation and top-5 miss cohorts
- paired code-lane comparison
- agent-completion source-file coverage
- PRD-0042 promotion verdict and downstream task-success evaluation
- `query_mode`, `coverage_confidence`, and `pack_readiness` honesty tests

## Out of Scope

- Embeddings or hybrid semantic retrieval.
- Runtime LLM judging or LLM reranking.
- Another code-lane substrate redesign.
- Deeper graph traversal, chunk-to-chunk graph edges, or graph-first retrieval.
- Broad prompt-packing or compression work as the primary solution.
- Multi-language chunker expansion.
- UI or MCP contract redesign beyond what is required for correctness.
- Replacing the broad real-corpus or downstream task-success harnesses.
- “General retrieval cleanup” that is not tied to a named miss cohort.

## Further Notes

The deepest lesson from the current eval run is that **context assembly is not the main bottleneck**.

The top-5 full-coverage assembly surface is already strong. The system is mostly losing earlier:

- it sometimes tells the wrong truth about how grounded the query is
- it sometimes ranks the wrong canonical source first
- and it still does not surface enough implementation support files once code retrieval starts

That means this PRD should not sprawl into another architecture rewrite. It should behave like the mature text-system process:

1. trust the hardened eval
2. pick the biggest named miss bucket
3. fix it cleanly
4. remeasure broadly
5. repeat

The expected output of PRD-0044 is not “perfect code retrieval.” It is a more trustworthy engine and a cleaner next miss shape for the slice after it.
