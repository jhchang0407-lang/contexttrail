# PRD-0052: Code-Lane Method Integration Tightening

> Source-of-truth canonical doc. Intended to be mirrored to Linear after review.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md) -- see `Context Pack`, `pack entry`, `context assembly`, `code-source index`, `import graph`, `persistence substrate`, `support necessity`, `agent-completion source-file coverage`, `critical-source recall`, and `retrieval pipeline`.
>
> Governing ADRs: [ADR-0023](../adr/0023-chunk-first-code-retrieval-with-file-graph-late-augmentation.md), [ADR-0024](../adr/0024-code-must-compete-inside-the-core-pack-authority.md), [ADR-0025](../adr/0025-code-navigation-fields-and-get-code-chunk-are-first-class-mcp-contract.md), and [ADR-0026](../adr/0026-persistence-substrate-family-evidence.md).
>
> Predecessor PRD: [PRD-0051](0051-oss-code-lane-corpus-accuracy-improvement-plan.md).
>
> Boundary rule: this PRD tightens the integration of existing code-lane methods before adding new retrieval methods. The full OSS code-lane corpus remains the promotion benchmark. Smoke corpus wins are not enough.

## Problem Statement

The code lane has improved from the original OSS baseline, but the current method mix is not airtight enough to safely add more methods.

Recent work proved both sides of the problem:

- Richer non-TypeScript declaration chunks lifted full-corpus prompt top-3 to `4577 / 7360` (`62.2%`).
- A narrow dotted-identity facet integration lifted full-corpus prompt top-3 to `4607 / 7360` (`62.6%`) and ticket robustness to `257 / 736` (`34.9%`).
- A broad facet integration looked strong on smoke, but regressed the full corpus to `4475 / 7360` (`60.8%`), so it was rejected.

This means ContextTrail is leaving useful signal on the table, but the danger is no longer simply "missing a method." The danger is that every new method can flood the candidate pool, displace the primary implementation owner, or improve one task family while damaging another. If we add repository maps, package/module relationships, or set-level rerankers now without tightening method admission, future failures will be hard to diagnose.

From the user's perspective, the next improvement should make the code lane more trustworthy, not merely more complicated. A retrieved Context Pack should not depend on accidental ordering between FTS, path fallback, source facts, exact-symbol fallback, facets, support clusters, and family evidence. Each method should have a clear admission rule, explainable evidence, and a full-corpus promotion story.

## Solution

Create a tighter method-integration layer for the code lane.

The goal is not to add another broad retrieval method. The goal is to make the existing methods compete through a shared, explainable, testable interface:

1. Candidate methods may generate evidence freely in shadow mode.
2. Runtime promotion into the first code slate requires an explicit admission decision.
3. Admission decisions must distinguish owner discovery from support necessity.
4. Exact file and symbol anchors must remain dominant unless a method is specifically allowed to participate.
5. Dotted-identity facets remain active because they proved full-corpus lift.
6. Conventional-scope and code-identifier facets stay shadowed until multi-signal admission makes them promotable without regression.
7. The full OSS corpus is the acceptance test after every promoted tightening.

The deepening opportunity is to extract a small set of modules with stable interfaces:

- A **query facet module** that only knows how to decompose task text into candidate facets.
- A **candidate evidence module** that records what each method claims about a file.
- A **method admission module** that decides whether evidence may influence direct owner ranking, support ranking, shadow reporting, or nothing.
- A **first-slate arbitration module** that keeps primary owner retention, support necessity, passive artifact penalties, and exact navigation fields coherent.
- An **eval diagnostics module** that reports method wins and losses by channel and task family.

This turns a shallow in-place mix of ranking heuristics into deeper modules: callers get leverage through small interfaces, while locality improves because method behavior, admission rules, and eval reporting are no longer scattered across the retrieval lane.

## User Stories

1. As an agent operator, I want code-lane methods to be integrated through explicit admission rules, so that a new method cannot silently damage full-corpus quality.
2. As an agent operator, I want full-corpus lift to be required before runtime promotion, so that smoke-panel wins do not masquerade as generalization.
3. As an agent operator, I want rejected method variants documented, so that future agents do not repeat broad-facet regressions.
4. As an agent operator, I want candidate channels to report their own wins and losses, so that regressions are debuggable by method.
5. As an agent operator, I want method admission to distinguish owner discovery from support necessity, so that support-only improvements do not hide weak top-3 owner context.
6. As an engineer, I want exact file anchors to remain dominant, so that named files are not displaced by weak inferred signals.
7. As an engineer, I want exact symbol anchors to remain dominant, so that named declarations are not displaced by broad path or facet signals.
8. As an engineer, I want weak commit-style prompts to benefit from dotted identities, so that terms like `vcs.root` find implementation owners.
9. As an engineer, I want conventional commit scopes to remain useful but safe, so that `fix(css_parser): ...` helps only when it agrees with other evidence.
10. As an engineer, I want code-shaped identifiers to remain useful but safe, so that symbol-like words do not flood the first slate.
11. As an engineer, I want passive docs, reports, evals, tests, fixtures, and examples to stay out of ordinary implementation owner slots, so that first-slate code context remains actionable.
12. As an engineer, I want passive artifacts admitted only by explicit intent or support necessity, so that test and generated-output tasks still work.
13. As an engineer, I want the primary implementation owner retained when support files are found, so that useful support does not push out the file I probably need to edit.
14. As an engineer, I want support files admitted because the task needs them, so that related-but-unnecessary files do not consume Context Pack budget.
15. As an engineer, I want persistence substrate files to remain support by default, so that schema and database files help without displacing the owner.
16. As an engineer, I want first-slate ordering to be stable under small prompt wording changes, so that ticket robustness improves.
17. As an engineer, I want code entries to keep exact navigation metadata, so that every promoted candidate is actionable.
18. As an engineer, I want the Context Pack to show a compact owner-focused slate, so that I can start implementation without manual repo search.
19. As a maintainer, I want each candidate method to emit structured evidence, so that promotion decisions can be tested without inspecting private score math.
20. As a maintainer, I want candidate evidence to be separable from admission, so that new methods can run in shadow mode before influencing ranking.
21. As a maintainer, I want method admission to be a deep module, so that the code-source mixer does not accumulate fragile in-place ranking conditionals.
22. As a maintainer, I want first-slate arbitration to be a deep module, so that owner retention and support ordering can be tested together.
23. As a maintainer, I want the query facet module to stay narrow, so that decomposition can evolve without changing retrieval ranking directly.
24. As a maintainer, I want conventional-scope facets to stay shadowed until multi-signal admission proves lift, so that the previous regression does not return.
25. As a maintainer, I want code-identifier facets to stay shadowed until multi-signal admission proves lift, so that generic identifier overlap does not over-promote.
26. As a maintainer, I want method-specific trace reasons, so that eval reports can show why a file was promoted or demoted.
27. As a maintainer, I want per-channel eval slices, so that a method can be accepted for one task family and shadowed for another.
28. As a maintainer, I want path, source-facts, chunk, exact-symbol, facet, import-graph, and family-evidence signals represented consistently, so that future tuning is comparable.
29. As a maintainer, I want admission tests to exercise public retrieval behavior, so that tests survive internal refactors.
30. As a maintainer, I want unit tests at deep module interfaces, so that edge cases can be covered without large corpus fixtures.
31. As a maintainer, I want full-corpus eval notes checked into the repo, so that future agents inherit the real history.
32. As a maintainer, I want broad rejected methods to remain available in shadow mode, so that we can learn from them without product risk.
33. As a maintainer, I want recall@10 and recall@30 reported alongside top-3, so that candidate-generation improvements are not confused with first-slate wins.
34. As a maintainer, I want support file hits reported separately, so that exact support misses do not blur owner-discovery progress.
35. As a maintainer, I want candidate flooding detected, so that a method cannot lower top-3 while increasing broad recall.
36. As a maintainer, I want the retrieval lane to preserve ADR-0023's chunk-first shape, so that graph-first or method-first retrieval does not creep in.
37. As a maintainer, I want code entries to stay inside the core pack authority, so that budget and omission behavior remain coherent.
38. As a maintainer, I want no corpus-specific aliases or ticket hacks, so that full-corpus lift reflects general behavior.
39. As an eval author, I want smoke evals to remain plumbing checks, so that they catch obvious regressions without driving promotion.
40. As an eval author, I want full evals to compare against the last accepted baseline, so that small changes are judged honestly.
41. As an eval author, I want rejected broad-facet behavior preserved in notes, so that future reports can explain why runtime facets are narrow.
42. As a product owner, I want the next improvement to reduce confusion before adding methods, so that future method additions are easier to reason about.
43. As a product owner, I want the code lane to climb from `62-63%` toward `70%` through disciplined integration, so that gains compound instead of canceling out.
44. As a future contributor, I want a clear seam for adding a method in shadow mode, so that experimentation does not require editing first-slate ranking directly.
45. As a future contributor, I want a clear seam for promoting a method, so that production behavior changes are isolated and reviewable.
46. As a future contributor, I want a clear seam for reporting method evidence, so that debugging does not require reconstructing private scoring decisions.

## Implementation Decisions

- Keep chunk-first code retrieval as the architecture. Candidate methods may add evidence, but direct code chunks remain the primary retrieval unit and file graph expansion remains late.
- Keep code entries inside the core Context Pack authority. Tightening must not introduce presenter-only code injection or post-pack side channels.
- Keep dotted-identity facets active because they proved full-corpus lift.
- Keep conventional-scope facets shadowed until multi-signal admission proves full-corpus lift.
- Keep code-identifier facets shadowed until multi-signal admission proves full-corpus lift.
- Build or deepen a query facet module with a small interface: task text in, normalized facets with reasons out. The module should not decide ranking or promotion.
- Build or deepen a candidate evidence module with a small interface: candidate file plus method evidence in, normalized evidence record out. The module should preserve channel, facet reason, path/fact/symbol matches, and whether the evidence is owner-shaped or support-shaped.
- Build a method admission module with a small interface: evidence plus request shape in, admission decision out. Decisions should include at least `direct_owner`, `support_candidate`, `shadow_only`, and `reject`.
- Build or deepen first-slate arbitration so that owner retention, support necessity, passive artifact penalties, and duplicate-role avoidance are decided in one place.
- Keep exact file and exact symbol anchors as high-authority request evidence. Facet channels should normally be disabled or heavily constrained when explicit anchors are present.
- Require non-dotted facet promotion to have independent evidence. A single conventional-scope or code-identifier facet should not move a file into top-3 by itself.
- Define independent evidence as agreement across at least two method families, such as path identity, source facts, chunk body, exact symbol, dotted identity, conventional scope, code identifier, import graph, or family evidence.
- Treat first-slate promotion more strictly than recall expansion. A method may improve recall@30 in shadow mode before it is allowed to affect top-3.
- Treat support necessity as separate from owner evidence. Support files can be admitted to the support cluster without competing as primary owners.
- Preserve passive artifact exclusion by default. Tests, fixtures, examples, generated outputs, docs, passive reports, evals, and benchmarks require explicit task intent or support necessity.
- Preserve persistence substrate behavior from ADR-0026. Schema/database/store files may be support through bounded family evidence, but should not displace primary implementation owners without direct evidence.
- Add method-level trace reasons to the retrieval explain path where available. Trace reasons should be stable enough for eval diagnostics, but tests should not depend on private score constants.
- Add full-corpus eval reporting for method wins and losses before promoting broad non-dotted facets. Reports should distinguish smoke-only wins from full-corpus lift.
- Record rejected method variants in eval notes. The broad facet attempt is the canonical example: it improved smoke and regressed the full corpus, so future work should not repeat it without a stricter admission rule.
- Do not add repository-map retrieval, package/module relationship expansion, or set-level bundle reranking in this PRD. Those become safer after method admission is deepened.
- Do not ratchet release gates in this PRD. The current goal is integration quality and measured incremental lift.

## Testing Decisions

- Good tests verify public retrieval behavior and deep module interfaces, not private score constants.
- The query facet module should have unit tests for dotted identities, conventional commit scopes, code-shaped identifiers, deduplication, and generic stopwords.
- The candidate evidence module should have unit tests proving that path, source facts, chunk body, symbol, facet, import, and family evidence normalize into comparable records.
- The method admission module should have unit tests proving that exact anchors dominate, dotted identities can promote, non-dotted facets remain shadow-only without independent evidence, and passive artifacts are rejected by default.
- First-slate arbitration tests should verify primary owner retention, support candidate admission, passive artifact demotion, duplicate-role avoidance, and persistence substrate behavior.
- Retrieval behavior tests should use synthetic fixtures that resemble OSS prompts without hardcoding corpus tickets, commit IDs, or source files as product logic.
- Existing code-source mixer tests are the closest prior art for public retrieval behavior.
- Existing code-source parser tests are prior art for testing deep modules through stable observable chunk identity rather than private parsing internals.
- The smoke OSS corpus should run after every integration tightening, but should remain a plumbing check only.
- The full OSS corpus should run before promoting any runtime admission change.
- The full OSS corpus result should be compared against the last accepted baseline: dotted-only facets at `4607 / 7360` prompt top-3 unless a newer accepted baseline supersedes it.
- A method is not promotable if it improves smoke but regresses the full corpus.
- A method is not promotable if it improves support-file hits while lowering owner top-3.
- A method is not promotable if it improves recall@100 but leaves recall@30 and top-3 unchanged.
- A method is not promotable if it destabilizes exact-symbol or exact-file anchored retrieval.
- Eval reports should include prompt top-3, ticket robustness, support file hits, recall@10, recall@30, recall@100, weakest repos, representative misses, and method-specific win/loss notes when available.

## Out of Scope

- Adding repository-map candidate generation.
- Adding package/module relationship support.
- Adding set-level bundle reranking.
- Replacing chunk-first code retrieval.
- Graph-first retrieval.
- Unbounded import, reference, directory, package, or module traversal.
- Runtime LLM reranking or judging.
- Embeddings or hosted search services.
- Changing the MCP contract.
- Making code entries authority-bearing Context Objects.
- Redesigning document retrieval.
- Weakening support-file reporting to make owner metrics look better.
- Hardcoding OSS corpus tickets, commits, file paths, repository names, or path aliases.
- Promoting broad conventional-scope or code-identifier facets without full-corpus proof.
- Treating smoke-corpus gains as production proof.
- Ratcheting certification gates before a stable improved baseline exists.

## Further Notes

The most important finding from the current work is that smoke can lie. Broad query facets lifted the smoke corpus, including the representative Biome `vcs.root` case, but regressed the full local OSS corpus. Narrow dotted-identity facets kept the targeted win and produced a small full-corpus lift.

That is exactly why this PRD exists. The next progress should not come from stacking methods. It should come from deepening the integration seams so every method has a clear lifecycle:

1. generate evidence
2. run in shadow mode
3. report wins and losses
4. earn admission through multi-signal rules
5. prove full-corpus lift
6. only then affect first-slate ranking

Once this integration is tight, the next PRD can safely return to larger methods such as repository-map candidate generation, package/module relationship support, and bundle-aware top-3 arbitration.
