# PRD-0045: Bounded Code Support-Cluster Retrieval

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's forty-fifth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md) — see `fact-finding quality`, `query_mode`, `Context Pack`, `pack entry`, `agent-completion source-file coverage`, `code-source index`, `import graph`, `coverage_confidence`, `pack readiness verifier`, and `workflow assembly`. Governing ADRs: [ADR-0019](../adr/0019-retrieval-architecture-rethink.md) (deterministic core first), [ADR-0021](../adr/0021-gate-calibration-policy.md) (measured gates and locked baselines), [ADR-0023](../adr/0023-chunk-first-code-retrieval-with-file-graph-late-augmentation.md) (chunk-first code retrieval), [ADR-0024](../adr/0024-code-must-compete-inside-the-core-pack-authority.md) (code competes inside the real pack), and [ADR-0025](../adr/0025-code-navigation-fields-and-get-code-chunk-are-first-class-mcp-contract.md) (structured code navigation contract). Predecessor PRDs: [PRD-0041](0041-chunk-first-code-retrieval-lane.md), [PRD-0042](0042-code-lane-promotion-and-downstream-task-success-validation.md), [PRD-0043](0043-code-aware-real-corpus-eval-hardening.md), and [PRD-0044](0044-query-mode-honesty-canonical-ranking-and-code-support-file-coverage.md).
>
> Boundary rule: this PRD does NOT introduce another retrieval architecture, another eval architecture, embeddings, runtime LLM judging, deeper graph traversal, or more canonical doc-ranking work. It takes the post-PRD-0044 state as given and narrows to the remaining downstream code usefulness gap: once the primary code winner is known, the engine still does not surface enough of the implementation support cluster around it.

## Problem Statement

From the user's perspective, the system now often gets *close* on coding work but still does not give enough nearby implementation context to actually finish the change safely.

As of **May 14, 2026**, the broad retrieval surface is no longer the main problem:

- broad real-corpus top-1 is `148/176`
- broad real-corpus top-3 is `167/176`
- query-mode correctness is `190/202`

Those numbers match the stable post-PRD-0044 snapshot. So the upstream doc-and-ranking engine is not the thing that apparently regressed.

The real remaining problem is downstream code usefulness.

After fixing the commit-grounded eval contamination bug that let the code lane retrieve `src/eval/**` measurement files, the paired code-lane panel improved materially:

- source-file coverage moved from `15/66` to `25/66`
- code top-1 acceptable moved from `1/14` to `5/14`
- code ranked useful moved from `2/14` to `8/14`

That was an important correction, but it also clarified the true residual gap:

- the broad panel stayed unchanged
- the code lane got better
- the commit-grounded downstream gates still fail badly

The dominant residual misses are not “wrong canonical doc” and not “the code lane never finds the owner file.” They are:

1. the engine often finds a reasonable primary file or chunk
2. but it does not surface enough of the nearby support files
3. so the pack points at one entrypoint instead of the real implementation cluster

In practical terms, the user still lands without enough surrounding code from the schema layer, DB layer, shared types, source-profile substrate, or related implementation helpers to complete the work confidently.

This is the next logical slice because the broad truth surface is already stable enough to tell us the remaining problem is not general retrieval. It is **bounded support-cluster coverage around already-correct code winners**.

## Solution

Add a bounded support-cluster retrieval step to the code lane that runs **after** the primary code winner is chosen.

From the user's perspective, the effect should be:

- the engine still stays small and selective
- the first code entry is still the likely owner
- but the pack now also contains the few nearby implementation files that are actually needed to do the work

The intended shape is:

1. choose the primary code file or chunk as today
2. build a small support-cluster candidate set around that winner
3. admit only the most implementation-relevant support files
4. keep the cluster bounded by count and token budget
5. measure the change on commit-grounded downstream code usefulness, not just on broad retrieval metrics

The support-cluster step should be deliberately narrower than generic graph expansion:

- it should not dump a neighborhood
- it should not compete before the owner is known
- it should not become a second broad retrieval system

The success condition is not “more code was returned.” It is:

- commit-grounded code file coverage improves materially
- top-1 acceptable and ranked-useful code cases improve materially
- the broad real-corpus panel does not regress
- prompt size remains bounded and explainable

## User Stories

1. As an engineer using the code lane, I want the pack to include the nearby support files around the primary implementation file, so that I can actually make the change instead of just locating one entrypoint.
2. As an engineer, I want the support cluster to stay small, so that useful code context does not turn into prompt bloat.
3. As an engineer, I want the system to prefer implementation-relevant support files over random neighbors, so that the extra code actually helps me work.
4. As an engineer fixing a schema-backed behavior, I want the pack to include the schema and data-layer support files that materially shape the change, so that I can trace the implementation path quickly.
5. As an engineer changing source-profile or retrieval substrate behavior, I want the pack to surface the related substrate files near the winning file, so that I can understand the full implementation cluster without repo wandering.
6. As an engineer, I want the support cluster to be chosen after the primary code winner is known, so that it stays centered on the right owner instead of broadening too early.
7. As an engineer, I want support files to appear as real code entries, not just hints, so that I can reason from actual code immediately.
8. As an engineer, I want the code lane to avoid unrelated measurement or tooling files, so that retrieved support context stays product-relevant.
9. As a maintainer, I want this slice to improve the commit-grounded downstream gates, so that the code lane becomes more trustworthy for real implementation work.
10. As a maintainer, I want the broad real-corpus panel to remain stable while we deepen support coverage, so that downstream gains do not come from upstream regressions or accidental drift.
11. As a maintainer, I want support-cluster selection to reuse existing file identity and import-graph substrate where possible, so that we do not reinvent the code lane again.
12. As a maintainer, I want support-cluster admission to be bounded by explicit count and token limits, so that the behavior stays predictable and debuggable.
13. As a maintainer, I want the code lane to improve recurring support-file miss classes like schemas, DB layers, shared types, and source-profile substrate files, so that the slice attacks the real downstream bottleneck.
14. As a maintainer, I want support-cluster logic to be attributable in the evals, so that wins and losses stay tied to a named behavior rather than just aggregate score movement.
15. As an eval author, I want the commit-grounded panel to distinguish “right owner, missing support files” from “wrong owner entirely,” so that the next tuning loop stays sharp.
16. As an eval author, I want support-cluster improvements to be judged by file coverage and code usefulness, so that success is defined by actual coding help rather than intuition.
17. As a product owner, I want the next code slice to follow the same disciplined pattern as the text engine, so that we keep improving one real miss class at a time.
18. As a future contributor, I want this PRD to make clear that the next runtime problem is support-cluster retrieval, not another broad doc-ranking or query-mode rewrite, so that effort stays focused.
19. As a future contributor, I want the support-cluster module to be a deep, testable seam, so that later tuning does not leak heuristics all over retrieval.
20. As a future contributor, I want this slice to preserve the chunk-first code lane model, so that later improvements compose with the current architecture instead of fighting it.

## Implementation Decisions

### Product shape

- This is a **downstream code usefulness** slice, not a general retrieval slice.
- The broad real-corpus panel is treated as stable input for this PRD, not the target of major change.
- The primary evaluation target is the commit-grounded paired code-lane surface and its related downstream gates.
- The support-cluster step runs only after the primary code winner is chosen.

### Deep modules

- Introduce or deepen a **support-cluster candidate builder** whose job is to enumerate a small set of plausible support files around a winning code file or chunk.
- Introduce or deepen a **support-cluster adjudicator** whose job is to admit only the most implementation-relevant support files from that candidate set.
- Introduce or deepen a **bounded code-lane allocator** whose job is to reserve a small portion of code-lane budget for support entries without letting them swamp the owner file.
- Keep a **support-cluster reporting seam** that makes support-cluster wins and misses visible in commit-grounded evaluation output.

### Support-cluster retrieval

- Support-cluster selection must start from the already-chosen primary code winner.
- The cluster should prefer files that materially support implementation, such as:
  - directly connected substrate files
  - closely related shared-type or schema files
  - tightly coupled persistence or profile-layer files
  - other structurally adjacent implementation files that are needed to complete the change
- The cluster should not admit neighbors merely because they are graph-adjacent; they must look implementation-relevant for the current winner.
- The cluster should surface support files as real `code` entries, not as file cards or opaque hints.
- The cluster should not be a second owner-selection step. The owner must already be known first.

### Budget and bounds

- Support-cluster coverage must stay bounded by both:
  - a count cap
  - a token cap
- The primary winner must remain first-class; support entries are companions, not replacements.
- Support entries should consume only a small reserved share of the code lane after primary coverage is satisfied.
- If no support entry clears the relevance bar, the engine should prefer returning fewer code entries rather than padding the cluster.

### Structural signals

- Reuse existing code-file identity, chunk identity, and file-graph substrate before inventing any new retrieval substrate.
- Start with direct or near-direct structural relationships around the winner.
- Do not introduce deeper graph traversal by default in this slice.
- Do not introduce chunk-to-chunk graph edges in this slice.
- Do not introduce embeddings or opaque semantic judges in this slice.

### Support-cluster quality bar

- A support file is valuable only if it increases the chance that the engineer can complete the change.
- The cluster should therefore favor files that participate in the same implementation cluster as the winner, not files that merely share vocabulary.
- The cluster should avoid self-referential measurement, tooling, or unrelated helper files that happen to mention the same concepts.
- The slice should specifically improve the recurring “right owner, missing support files” miss pattern visible in the commit-grounded panel.

### Evaluation contract

- Broad real-corpus metrics from PRD-0043 remain the upstream non-regression surface.
- Paired code-lane comparison remains the primary improvement surface.
- Agent-completion source-file coverage remains the primary commit-grounded coverage surface.
- Downstream task-success and promotion-facing verdicts remain non-regression surfaces.
- No support-cluster change is accepted unless:
  - paired code-lane file coverage improves materially
  - code top-1 acceptable and ranked useful improve materially
  - the broad panel does not regress
  - code-lane token usage stays bounded and explainable

### Sequencing

- Start by making the support-cluster candidate set explicit and measurable.
- Then add support-cluster admission and budget behavior.
- Then tune relevance within that bounded shape using the commit-grounded misses.
- Stop once the support-cluster cohort improves materially; do not let this PRD sprawl into broader ranking or honesty work.

## Testing Decisions

Good tests for this PRD should verify **support-cluster behavior at the external retrieval boundary**, not internal scoring details.

A good test in this slice:

- proves that once the primary code winner is correct, the pack now includes a support file that was previously missing
- proves that the added support file is implementation-relevant, not just graph-adjacent
- proves that support-cluster admission stays bounded by count and token budget
- proves that the owner file remains present and prioritized
- proves that broad real-corpus behavior does not regress

Tests should avoid:

- snapshotting large incidental ranked slates when only support-cluster behavior matters
- pinning exact heuristic weights or incidental ordering among weak candidates
- turning one ticket’s local path pattern into general engine law without a stable miss cohort behind it

Modules and behaviors that need coverage:

1. Support-cluster candidate construction from a winning code file or chunk.
2. Support-cluster admission behavior under count and token caps.
3. Preference for implementation-relevant support files over merely adjacent neighbors.
4. No-regression behavior for primary owner retention and code-lane boundedness.
5. Commit-grounded improvement on the support-file miss cohort.
6. Non-regression on the broad real-corpus panel and downstream task-success surfaces.

Prior art for tests already exists and should be reused where possible:

- code-lane comparison
- agent-completion source-file coverage
- task-success evaluation
- support-file-oriented commit-grounded misses already visible in the paired code-lane panel
- code-source mixing tests and pack tests that already cover bounded code-entry behavior

## Out of Scope

- Another query-mode honesty slice.
- Another canonical doc/source ranking slice.
- Embeddings or hybrid semantic retrieval.
- Runtime LLM judging or LLM reranking.
- Deeper graph traversal or graph-first retrieval.
- Chunk-to-chunk graph edges.
- Another code-lane substrate redesign.
- Multi-language chunker expansion.
- Broad prompt-compression or pack-shaping redesign.
- Replacing the broad real-corpus or downstream task-success harnesses.

## Further Notes

The important clarification from **May 14, 2026** is that the apparent regression was not a broad retrieval collapse. It was partly an eval contamination bug and partly a real remaining downstream product gap.

Once the contamination bug was removed, the numbers improved substantially, which means the chunk-first code lane is not fundamentally broken. But the improvement also exposed the next true bottleneck more sharply:

- the engine often identifies the right implementation center
- then fails to provide enough of the surrounding implementation cluster

So PRD-0045 should be treated as the first slice that directly attacks **support-cluster usefulness** as its own runtime problem.

This is also where copying the general coding-engine pattern is appropriate without overcomplicating the system:

- owner first
- bounded support context second
- no neighborhood dumping
- measure everything against real implementation work

The expected output of PRD-0045 is not “perfect code retrieval.” It is a code lane that more often gives the engineer enough surrounding implementation context to finish the job once the right owner is already in view.
