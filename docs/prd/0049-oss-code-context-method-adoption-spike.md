# PRD-0049: OSS Code-Context Method Adoption Spike

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's forty-ninth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md) -- see `Context Pack`, `pack entry`, `context assembly`, `code-source index`, `import graph`, `persistence substrate`, `support necessity`, `agent-completion source-file coverage`, and `retrieval pipeline`.
>
> Governing ADRs: [ADR-0021](../adr/0021-gate-calibration-policy.md), [ADR-0023](../adr/0023-chunk-first-code-retrieval-with-file-graph-late-augmentation.md), [ADR-0024](../adr/0024-code-must-compete-inside-the-core-pack-authority.md), [ADR-0025](../adr/0025-code-navigation-fields-and-get-code-chunk-are-first-class-mcp-contract.md), and [ADR-0026](../adr/0026-persistence-substrate-family-evidence.md).
>
> Predecessor PRDs: [PRD-0047](0047-code-lane-residual-miss-generalization.md) and [PRD-0048](0048-targeted-code-lane-family-ranking-improvements.md).
>
> Boundary rule: this PRD does not assume ContextTrail must invent code-context retrieval from scratch. It evaluates and adapts proven OSS and research methods under ContextTrail's stricter Context Pack, authority, budget, readiness, and eval contracts.

## Problem Statement

The user wants ContextTrail's code retrieval to reach the kind of practical implementation context quality that existing code assistants and code search systems already target. PRD-0048 improved the discipline around residual-family diagnostics, but the return was modest: aggregate code-lane metrics held steady and `persistence_substrate` support misses improved only from `12` to `11`.

That result is useful, but it also reveals a planning smell. The broader industry has already converged on several code-context patterns: hybrid keyword/vector retrieval, reranking top-N candidates to top-K context, repository maps built from parsed symbols, source-code cross-reference indexes, and code-graph based context expansion. ContextTrail should not rediscover those methods slowly through one hand-authored family heuristic at a time.

The next problem is therefore not "what local heuristic should we tweak?" The problem is: which proven code-context method family best improves ContextTrail's measured code-lane outcomes while preserving its product constraints?

The current eval tells us what to look for:

- ContextTrail still misses or under-orders `persistence_substrate`, especially schema/db/store/chunk support.
- `import_workflow` files are often ranked below top 3 or missing from support.
- Ralph holdout gaps remain around `retrieval_index` and `cli_workflow`.
- Real-corpus release gates still fail on true top-3 misses and top-3-hit/top-1-miss ordering, even though no no-regression guardrail failed.

## Solution

Run an OSS code-context method adoption spike that compares known method families against ContextTrail's existing evals before choosing a production path.

The user-facing goal is simple: ContextTrail should surface the implementation owner plus the support files that a real agent needs, early enough in the Context Pack to act. The implementation path should be less about inventing new scoring folklore and more about adapting proven methods to ContextTrail's domain model.

The spike compares at least four method families:

1. **Aider-style repository map**: parsed symbol extraction plus repository-level map/context ordering.
2. **Continue-style hybrid retrieval and reranking**: broad initial candidate retrieval, then top-N to top-K reranking.
3. **Sourcegraph/Cody-style multi-source code context**: keyword search, code graph relationships, and code intelligence surfaces working together.
4. **OpenGrok-style source search and cross-reference**: fast lexical search plus cross-reference/navigation indexes.

The spike may also inspect repository-level code completion research such as REPOFUSE, especially where it evaluates fused repository context instead of isolated chunks.

The work should produce:

1. A small prior-art matrix with licensing, method shape, implementation fit, and expected eval impact.
2. A common adapter interface for offline shadow evaluation of candidate methods.
3. At least two runnable method adapters behind flags, starting with repository map and hybrid rerank.
4. A comparison report over the existing code-lane, cross-repo holdout, and real-corpus guardrails.
5. A promotion recommendation: adopt one method, combine parts of several methods, or reject all runtime promotion until more evidence exists.

## User Stories

1. As an agent operator, I want ContextTrail to borrow proven code-context methods, so that code retrieval improves faster than hand-tuned heuristics alone.
2. As an agent operator, I want candidate methods compared against the same evals, so that promotion decisions are evidence-based.
3. As an agent operator, I want top-3 usefulness to remain the ultimate goal, so that support-only improvements do not become the finish line.
4. As an engineer, I want the implementation owner to stay visible, so that added repository context does not hide the best starting file.
5. As an engineer, I want schema, database, store, parser, CLI, and index support files to appear when they are necessary, so that implementation work is not blocked by missing substrate.
6. As an engineer, I want code context to include symbol and reference relationships, so that related files are discovered by structure rather than wording alone.
7. As an engineer, I want support files to be ranked by implementation necessity, so that related-but-unnecessary files do not consume the first slate.
8. As an engineer, I want retrieved code entries to keep exact navigation metadata, so that I can jump to the right file, symbol, and lines.
9. As an engineer, I want the Context Pack to stay bounded, so that better recall does not flood the prompt.
10. As an engineer, I want explanations for why a code file was included, so that I can distinguish direct hits from graph/rerank/support additions.
11. As a maintainer, I want prior-art licensing checked before code reuse, so that attribution is correct and incompatible code is not copied.
12. As a maintainer, I want method adapters to run in shadow before production, so that risky retrieval changes can be evaluated without changing user behavior.
13. As a maintainer, I want method adapters to be independently removable, so that a failed method does not entangle the code lane.
14. As a maintainer, I want the spike to compare methods rather than enshrine a favorite, so that we do not cargo-cult OSS architecture.
15. As a maintainer, I want each method to state its dependency footprint, so that local/offline and CI requirements remain explicit.
16. As a maintainer, I want the code-source index to remain the stable file-identity layer, so that new methods augment rather than replace existing contracts.
17. As a maintainer, I want code entries to remain pack entries, not authority-bearing Context Objects, so that code retrieval does not break the trust model.
18. As a maintainer, I want any embedding or model-based reranking path to have an offline/local fallback or explicit operational boundary, so that ContextTrail does not silently gain brittle external dependencies.
19. As a maintainer, I want cross-repo holdout results in the report, so that a method that only helps ContextTrail is not overstated.
20. As a maintainer, I want the PRD-0048 rejected broad-family expansion to stay rejected unless a new method beats it under eval, so that old mistakes are not relabeled as prior art.
21. As an eval author, I want the spike to track recall@N before rerank and top-K after rerank, so that we know whether misses are candidate-generation or ordering failures.
22. As an eval author, I want set-level context quality measured, so that files that are only useful together are not judged as isolated chunks.
23. As an eval author, I want per-family movement for persistence, import workflow, SourceProfile storage, retrieval index, and CLI workflow, so that method wins are explainable.
24. As an eval author, I want no-regression guardrails to run unchanged, so that code-context gains do not degrade document retrieval quality.
25. As an eval author, I want candidate-method traces recorded, so that future agents can see why a method won or lost.
26. As a product owner, I want ContextTrail to learn from OSS systems without becoming a clone of any one of them, so that its authority and Context Pack model stay differentiated.
27. As a product owner, I want a clear promotion recommendation, so that the next implementation PRD is based on measured upside.
28. As a future contributor, I want a method matrix and adapter interface, so that new code-context techniques can be evaluated without rewriting eval plumbing.
29. As a future contributor, I want rejected methods documented, so that the team does not repeat the same spike.
30. As a future contributor, I want source links and attribution notes, so that borrowed ideas and copied code are handled responsibly.

## Implementation Decisions

- Treat PRD-0049 as a spike and method-comparison PRD, not a production rewrite by default.
- Keep ContextTrail's chunk-first code lane and core pack authority intact unless a candidate method earns a later architecture decision.
- Evaluate known method families before adding more bespoke family heuristics.
- Start with methods that can run locally and deterministically: repository map and lexical/symbol hybrid retrieval.
- Treat embeddings and model reranking as candidate methods, not assumptions. They must report dependency, cost, latency, and offline behavior.
- Build a common shadow-eval adapter interface that can return candidate code entries, support candidates, trace reasons, and method metadata.
- Compare methods on owner/support/full-set candidate recall, top-3 usefulness, ranked usefulness, support-cluster usefulness, ticket robustness, payload size, and real-corpus no-regression gates.
- Add set-level diagnostics for context assemblies where files are useful together, not just individual file hits.
- Prefer method adaptation over code copying. If code is copied or ported, record source, license, attribution, and compatibility.
- Do not hardcode fixture paths, ticket IDs, holdout repository names, expected-file hints, or corpus-specific aliases.
- Do not promote broad graph expansion unless it improves top-3/support usefulness without lowering the PRD-0048 baseline.
- Keep code entries explainable with trace reasons such as lexical hit, symbol map hit, reference edge, import edge, rerank promotion, or support necessity.
- If the spike identifies a materially different production architecture, write a new ADR before implementation.

## Testing Decisions

- The spike begins by freezing the current PRD-0048 baseline commands and outputs.
- Each method adapter gets focused unit tests over synthetic repos that prove external behavior rather than private score constants.
- Repository-map tests should prove symbol extraction, exported symbol ranking, centrality/reference signals, and budgeted map rendering.
- Hybrid retrieval tests should prove candidate-generation recall@N improves before reranking and that reranking improves top-K ordering.
- Code-graph tests should prove typed relationships improve support without unbounded traversal.
- Licensing/attribution tests can be checklist-style report assertions rather than runtime tests.
- The comparison report must include `npm test`, `npm run build:all`, paired code-lane comparison, cross-repo comparison, and `npm run eval:real-corpus`.
- A method is promotable only if it improves targeted code-lane outcomes and no real-corpus no-regression guardrail fails.
- A method that improves ranked recall but worsens top-3 usefulness is not promotable as-is.
- A method that only improves support-cluster lift may be accepted as a stepping stone, but the report must name top-3 usefulness as the ultimate target.

## Out of Scope

- Replacing ContextTrail with an OSS code assistant.
- Shipping a production rewrite before the spike report.
- Copying license-incompatible code.
- Adding hosted services, paid APIs, or required credentials without an explicit follow-up decision.
- Making code entries authority-bearing Context Objects.
- Removing the Context Pack budget, omission, readiness, or explainability contracts.
- Weakening PRD-0016, PRD-0042, PRD-0047, or PRD-0048 guardrails to make a method look better.
- Hardcoding corpus-specific aliases or expected-file hints.
- Treating attribution as a substitute for license compatibility.
- Declaring top-3 solved from support-only improvements.

## Further Notes

Useful prior art to inspect:

- Sourcegraph/Cody context sources: keyword search, Sourcegraph search, and code graph relationships.
- Continue codebase awareness: hybrid keyword/vector retrieval and reranking from a larger initial candidate set.
- Aider repository map: parsed-symbol repository context from Tree-sitter.
- OpenGrok: source search plus cross-reference/navigation.
- REPOFUSE: fused repository-level context for code completion.

The desired outcome is not a literature review. The desired outcome is a measured recommendation for which proven method should become ContextTrail's next production code-context improvement.
