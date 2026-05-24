# PRD-0051: OSS Code-Lane Corpus Accuracy Improvement Plan

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's fifty-first PRD issue after review.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md) -- see `Context Pack`, `pack entry`, `context assembly`, `code-source index`, `import graph`, `persistence substrate`, `support necessity`, `agent-completion source-file coverage`, `critical-source recall`, and `retrieval pipeline`.
>
> Governing ADRs: [ADR-0021](../adr/0021-gate-calibration-policy.md), [ADR-0023](../adr/0023-chunk-first-code-retrieval-with-file-graph-late-augmentation.md), [ADR-0024](../adr/0024-code-must-compete-inside-the-core-pack-authority.md), [ADR-0025](../adr/0025-code-navigation-fields-and-get-code-chunk-are-first-class-mcp-contract.md), and [ADR-0026](../adr/0026-persistence-substrate-family-evidence.md).
>
> Predecessor PRDs: [PRD-0048](0048-targeted-code-lane-family-ranking-improvements.md), [PRD-0049](0049-oss-code-context-method-adoption-spike.md), and [PRD-0050](0050-full-panel-hybrid-rerank-and-top3-context-assembly.md).
>
> Boundary rule: this PRD is a design and evaluation plan before implementation. It uses the large OSS code-lane corpus eval as the benchmark. It does not rely on ContextTrail's own setup state or ContextTrail MCP retrieval as evidence, and it does not promote runtime retrieval changes until the corpus eval proves lift.

## Problem Statement

ContextTrail's document retrieval lane is strong enough that it is no longer the limiting factor for a cohesive context engine. The current concern is the code lane. The large OSS code-lane corpus eval shows that the code lane is still far from the accuracy required for general use:

- corpus size: `16` repos, `781` cases, `7,810` prompt variants, `5` languages
- prompt top-3 useful: `3,522 / 7,610` (`46.3%`, lower99 `44.8%`)
- ticket top-3 robust: `130 / 761` (`17.1%`, lower99 `13.9%`)
- ranked useful: `3,522 / 7,610` (`46.3%`, lower99 `44.8%`)
- support file hits: `145 / 4,033` (`3.6%`, lower99 `2.9%`)

The diagnosis is not that the benchmark is entirely unfair. Oracle noise exists, especially around generated files, examples, tests, large sweeps, and broad mechanical commits. But even clean small implementation targets were only around `46.8%` prompt top-3 useful. That means the code lane has a real candidate generation and ranking problem.

The current engine already has a chunk-first code lane, code-source facts, code chunks, exact-symbol fallback, path fallback, source-facts FTS, import graph support, and family evidence. The problem is therefore not a missing first slice. The problem is that the current candidate generation and first-slate assembly do not generalize well enough from weak, commit-like prompts across unfamiliar repositories and languages.

The user-facing impact is severe. When code top-3 is around `50%`, an agent cannot reliably start from the Context Pack. It still has to search the repo manually, and code context feels disconnected from the strong document chunk lane.

## Solution

Build a measured, staged improvement plan that uses the OSS code-lane corpus eval as the promotion benchmark.

The solution has two tracks that must stay separate:

1. **Measurement repair and ceiling diagnosis.** First prove whether failures are candidate-generation misses, reranking misses, pack-admission misses, or noisy oracle cases.
2. **Engine improvements.** Then add general code-owner and support-discovery methods that improve top-3 accuracy without overfitting to ContextTrail's local corpus.

The expected path is:

| Stage | Method | Expected prompt top-3 lift |
| --- | --- | ---: |
| 0 | Full candidate-ceiling instrumentation and target-family reporting | `0 pp` product lift; required to avoid blind tuning |
| 1 | Repository-map and path/facts candidate generator | `+8` to `+12 pp` |
| 2 | Deterministic multi-query decomposition and file-level fusion | `+6` to `+10 pp` |
| 3 | Richer Rust, Go, and Python declaration chunks | `+3` to `+7 pp` aggregate |
| 4 | Package/module relationship graph support | `+4` to `+8 pp`, with larger support-file movement |
| 5 | Intent-aware tests/examples/generated participation | `+2` to `+5 pp` measured lift and cleaner reports |
| 6 | Set-level top-3 bundle reranker | `+8` to `+15 pp` if recall@30 is high |

The target progression is:

- first milestone: `46%` to `58-62%` prompt top-3
- second milestone: `62-70%` prompt top-3
- third milestone: `70-76%` prompt top-3
- stretch target: `78%+` raw prompt top-3, so the lower-confidence promotion gate can plausibly clear a `75%` floor

Support-file coverage should improve, but it should not be the first production goal. The first product goal is reliable implementation-owner presence in the first slate. Support tuning becomes useful only after owner candidate generation is strong.

## User Stories

1. As an agent operator, I want the OSS code-lane corpus eval to be the benchmark, so that code-lane quality is judged on broad unfamiliar repositories.
2. As an agent operator, I want ContextTrail's own setup state excluded from this evaluation, so that product dogfood does not bias the code-lane verdict.
3. As an agent operator, I want prompt top-3 usefulness to be the headline metric, so that the first code slate is judged by agent usefulness.
4. As an agent operator, I want ticket top-3 robustness to remain visible, so that small prompt wording changes cannot hide instability.
5. As an agent operator, I want support-file hits reported separately from owner top-3, so that exact support misses do not blur owner discovery.
6. As an engineer, I want the implementation owner to appear in the first three code entries, so that I can start from the right file quickly.
7. As an engineer, I want code context to work for weak commit-style prompts, so that natural engineering tasks do not require perfect symbol names.
8. As an engineer, I want path-like terms to retrieve likely owners even when chunk body text points at neighbors, so that file identity can rescue lexical misses.
9. As an engineer, I want symbol-like terms to retrieve private and public declarations, so that implementation tasks can target internal code.
10. As an engineer, I want workflow verbs such as import, parse, validate, build, cache, route, and migrate to expand into useful local retrieval facets, so that behavior-shaped prompts find owners.
11. As an engineer, I want Rust, Go, and Python files to have declaration-level chunks, so that non-TypeScript repositories do not collapse into generic file cards.
12. As an engineer, I want package/module relationships to surface nearby implementation owners, so that related files are found by structure rather than wording alone.
13. As an engineer, I want tests and examples excluded from ordinary implementation-owner gates, so that passive artifacts do not consume top-3 slots.
14. As an engineer, I want tests, examples, fixtures, snapshots, and generated files admitted when the query explicitly asks for them, so that test and generation tasks remain supported.
15. As an engineer, I want the top-3 code entries to behave like a small implementation bundle, so that owner and necessary support files appear together.
16. As an engineer, I want passive reports, benchmarks, evals, and examples demoted unless requested, so that implementation context stays focused.
17. As an engineer, I want code entries to retain exact navigation metadata, so that every hit is actionable.
18. As an engineer, I want trace reasons for candidate generation and reranking, so that I can understand why a file appeared.
19. As a maintainer, I want candidate recall measured before pack admission, so that we can tell whether misses are generation, ranking, or budget failures.
20. As a maintainer, I want recall@10, recall@30, and recall@100 reported for owners and support files, so that the ceiling is explicit.
21. As a maintainer, I want path cleanliness and target size reported, so that noisy cases are visible without weakening the benchmark.
22. As a maintainer, I want change-type slices reported, so that parser, storage, CLI workflow, API, runtime, and build-tooling failures can be targeted separately.
23. As a maintainer, I want language slices reported, so that non-TypeScript chunking gaps are measured directly.
24. As a maintainer, I want repository-map candidate generation behind a small interface, so that it can be tested and replaced independently.
25. As a maintainer, I want multi-query decomposition behind a small interface, so that query expansion can evolve without rewriting retrieval.
26. As a maintainer, I want package/module graph support behind a bounded relationship interface, so that graph expansion does not become graph-first retrieval.
27. As a maintainer, I want bundle reranking behind a small interface, so that top-3 assembly can improve without changing candidate generation.
28. As a maintainer, I want support necessity to remain distinct from family evidence, so that related files are not automatically treated as necessary files.
29. As a maintainer, I want every runtime method evaluated against the full OSS corpus, so that local ContextTrail gains do not masquerade as generalization.
30. As a maintainer, I want the broad real-corpus document guardrail to remain separate, so that code-lane tuning does not damage document retrieval.
31. As a maintainer, I want no runtime promotion from smoke-panel evidence alone, so that small samples are used only for plumbing and calibration.
32. As a maintainer, I want large sweep commits and generated-output commits reported as their own task families, so that the benchmark stays interpretable.
33. As an eval author, I want one target-file policy shared by manifest mining and scoring, so that the denominator is consistent.
34. As an eval author, I want missing-at-HEAD and excluded path buckets recorded, so that impossible targets do not silently count as retrieval misses.
35. As an eval author, I want prompt variants preserved, so that methods cannot overfit one phrasing.
36. As an eval author, I want representative misses in the report, so that failures remain debuggable.
37. As an eval author, I want ranked useful to mean something deeper than top-3, so that candidate ceiling is not collapsed into first-slate quality.
38. As an eval author, I want support metrics redesigned around necessary companions, so that every changed source file is not treated as context a small pack must include.
39. As a product owner, I want the code lane to converge toward the document lane's reliability, so that ContextTrail becomes a cohesive context engine.
40. As a product owner, I want expected percentage lift stated before implementation, so that progress can be judged honestly.
41. As a product owner, I want the first milestone to focus on owner discovery, so that the engine improves the most important failure first.
42. As a product owner, I want support-only wins treated as stepping stones, so that the product does not declare success before top-3 context is useful.
43. As a future contributor, I want rejected methods documented, so that agents do not repeat support floods or graph-first expansions.
44. As a future contributor, I want deep modules with stable interfaces, so that the code-lane engine can improve one capability at a time.
45. As a future contributor, I want test fixtures to be synthetic where possible, so that tests prove portable retrieval behavior rather than corpus memorization.
46. As a future contributor, I want final reports checked into the repo, so that future planning starts from measured evidence.

## Implementation Decisions

- Treat the large OSS code-lane corpus eval as the promotion benchmark for this PRD family.
- Treat smoke corpus runs as plumbing checks only; they cannot justify runtime promotion.
- Keep chunk-first code retrieval as the architecture. This PRD improves candidate generation, candidate fusion, structural support, and first-slate assembly without replacing the code lane.
- Keep code entries as pack entries, not authority-bearing Context Objects.
- Keep import graph expansion bounded and late. Relationship edges support candidates after owner evidence exists; they do not become the primary retrieval mechanism.
- Stage 0 is mandatory before tuning. The full corpus report must expose recall@10, recall@30, recall@100, owner file hits, support file hits, pack-admitted hits, target cleanliness, target size, language, change type, and representative misses.
- Use one shared target-file policy for manifest mining and scoring. It should require current files, use add/copy/modify/rename/type-change diffs, exclude default passive artifacts, and record every exclusion bucket.
- Split the benchmark into task families: source-owner discovery, support-companion discovery, tests/examples, generated-output/source-owner pairing, and large mechanical sweeps.
- Add a repository-map and path/facts candidate generator as the first engine method. It should generate candidates from normalized path tokens, file identity, exported and private symbols, file purpose, package/module identity, and code roles.
- Add deterministic multi-query decomposition as the second engine method. It should decompose task text into subject terms, domain nouns, symbol-like tokens, path-like tokens, conventional-commit scope, and workflow verbs, then fuse candidates by file.
- Add richer non-TypeScript declaration chunks as the third engine method. Rust, Go, and Python should emit declaration chunks for top-level functions, types, classes, methods where practical, constants, and other implementation-relevant declarations.
- Add package/module relationship graph support as the fourth engine method. It should cover Rust modules, Go package-local peers, Python package/module resolution, TypeScript barrels/re-exports, generated/source-owner pairing, and same-directory feature clusters where deterministic.
- Add intent-aware participation rules for tests, examples, fixtures, snapshots, and generated outputs. Default implementation-owner queries should exclude them; explicit test/example/generated queries should admit them.
- Add set-level top-3 bundle reranking only after candidate recall is known. The reranker should score the first slate as a bundle: owner retained, required support diversity, passive artifact penalty, no duplicate role slots, bounded token cost, and exact navigation preserved.
- Treat support necessity as a first-class decision. A support file should enter because the task needs it, not because it merely shares tokens, import edges, or family labels.
- Preserve trace reasons through every stage: candidate channel, query facet, path/fact match, symbol match, package/module relation, support necessity, rerank promotion, and rerank demotion.
- Report expected lift by stage and compare actual lift against the forecast. A method that underperforms its expected range should be kept shadow-only unless it unlocks a later measured gain.
- Do not add embeddings, hosted services, runtime LLM judging, or copied OSS implementation code in this PRD.
- Do not hardcode ticket IDs, commit IDs, expected source files, repository names, or corpus-specific aliases.
- Do not ratchet CI promotion floors until a new stable corpus baseline exists.

## Testing Decisions

- Good tests verify external retrieval behavior: candidate recall, owner retention, first-slate usefulness, support necessity, passive artifact exclusion, intent-aware artifact admission, and trace explainability.
- Tests should not pin private score constants unless score normalization itself becomes a public contract.
- The Stage 0 eval tests should assert that the full corpus report includes candidate recall, target diagnostics, diagnostic slices, miss taxonomy, weakest repos, representative misses, and gate results.
- The target-file policy tests should prove that manifest mining and scoring classify files the same way.
- The target-file policy tests should cover root and nested tests, examples, fixtures, docs, build outputs, dependency outputs, generated files, snapshots, declarations, missing-at-HEAD files, and ordinary source files.
- The repository-map candidate generator should have unit tests over synthetic code facts that prove path-token, symbol, basename, package/module, and role-based candidate generation.
- The multi-query decomposition module should have unit tests that prove stable query facets for conventional commits, path-like prompts, symbol-like prompts, workflow verbs, and vague natural-language prompts.
- The candidate fusion tests should prove that independent weak signals can lift a file into recall@30 without requiring a single high BM25 score.
- The non-TypeScript declaration chunker tests should verify Rust, Go, and Python declaration chunks by observable chunk identity, role, symbol path, and navigation fields.
- The package/module graph tests should verify bounded structural relations without allowing unbounded graph traversal.
- The intent-aware artifact tests should verify that tests/examples/generated files are excluded by default and admitted only for explicit task intent.
- The bundle reranker tests should verify that the final top-3 can prefer owner plus necessary support over three individually plausible but redundant files.
- The support necessity tests should verify that schema/store/parser/CLI support is admitted for relevant task families and rejected for unrelated tasks.
- The smoke OSS corpus run should remain a fast plumbing test, not a promotion test.
- The full OSS corpus run is the acceptance test for product lift. It should be run after each stage that claims product movement.
- The broad real-corpus eval remains a no-regression guardrail for document retrieval and coverage honesty.
- A method is not promotable if it improves support-file hits while lowering prompt top-3 owner usefulness.
- A method is not promotable if it only improves recall@100 while leaving recall@30 and top-3 unchanged.
- A method is not promotable if it improves ContextTrail-local panels but fails the OSS corpus or damages non-TypeScript repositories.
- Final verification should include focused unit tests, build, smoke corpus, full OSS corpus, and broad real-corpus guardrails.

## Out of Scope

- Replacing chunk-first code retrieval.
- Graph-first retrieval.
- Unbounded import, reference, package, or directory traversal.
- Embeddings or semantic vector search.
- Runtime LLM reranking or judging.
- Hosted services, required credentials, or paid APIs.
- Copying OSS code into the project.
- Making code entries authority-bearing Context Objects.
- Changing the MCP contract.
- Redesigning document retrieval.
- Weakening document retrieval guardrails to make code-lane metrics look better.
- Treating all changed files in broad sweep commits as equally necessary support context.
- Hardcoding expected source files, ticket IDs, commit IDs, repository names, or corpus-specific aliases.
- Promoting a support-only improvement as if top-3 code context were solved.
- Ratcheting release gates before a stable improved baseline exists.

## Further Notes

The current full-corpus diagnosis says two things at once:

1. The benchmark has noise that should be reported more clearly.
2. The code lane has a real generalization problem even on clean small implementation targets.

Both are true, and the plan must respect both. Eval repair is not an excuse to lower the bar. Engine tuning is not useful until we can tell whether failures are candidate-generation misses, reranking misses, pack-admission misses, or noisy oracle cases.

The most likely high-ceiling sequence is:

1. measure full-corpus candidate ceiling
2. improve owner candidate generation with repository-map/path/facts signals
3. add deterministic multi-query fusion
4. improve non-TypeScript declaration chunks and package/module relationships
5. apply bundle-aware top-3 reranking once recall@30 is high enough

The desired product outcome is a code lane that approaches the document lane's reliability: the agent receives a compact, source-backed Context Pack where document chunks explain the work and code entries point at the implementation owner plus necessary support.
