# PRD-0050: Full-Panel Hybrid Rerank and Top-3 Context Assembly

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's fiftieth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md) -- see `Context Pack`, `pack entry`, `context assembly`, `code-source index`, `import graph`, `persistence substrate`, `support necessity`, `critical-source set`, `agent-completion source-file coverage`, and `retrieval pipeline`.
>
> Governing ADRs: [ADR-0021](../adr/0021-gate-calibration-policy.md), [ADR-0023](../adr/0023-chunk-first-code-retrieval-with-file-graph-late-augmentation.md), [ADR-0024](../adr/0024-code-must-compete-inside-the-core-pack-authority.md), [ADR-0025](../adr/0025-code-navigation-fields-and-get-code-chunk-are-first-class-mcp-contract.md), and [ADR-0026](../adr/0026-persistence-substrate-family-evidence.md).
>
> Predecessor PRDs: [PRD-0048](0048-targeted-code-lane-family-ranking-improvements.md) and [PRD-0049](0049-oss-code-context-method-adoption-spike.md).
>
> Boundary rule: this PRD targets top-3 context assembly quality through a full-panel shadow evaluation first. It does not ship a production retrieval rewrite until the method improves the existing code-lane panel, Ralph holdout, and real-corpus guardrails.

## Problem Statement

ContextTrail's code lane has crossed the first threshold: it can usually find the relevant code somewhere in the ranked slate. The current PRD-0048 baseline is:

- ranked code-file coverage: `54/66` (`81.8%`)
- code top-1 acceptable: `12/14` (`85.7%`)
- code ranked useful: `14/14` (`100.0%`)
- support-cluster useful: `14/14` (`100.0%`)
- prompt variant top-3: `26/42` (`61.9%`)
- tickets top-3 robust: `5/14`
- support file hits: `39/66`

That shape is not yet at the level the product should reach. The engine often knows the right files exist, but it does not consistently assemble the implementation owner plus necessary support files inside the first three code entries. For an AI coding agent, that is the difference between "can eventually find the answer" and "can start safely from the first Context Pack."

PRD-0049 confirmed that the best next candidate is a full-panel shadow evaluation of hybrid broad-recall/local-rerank, combined with repository-map owner retention. It also hardened the diagnostics so focused synthetic evidence cannot accidentally recommend production promotion.

The remaining problem is therefore concrete: prove whether hybrid rerank plus repository-map owner retention can move top-3 context assembly, especially for `persistence_substrate` and `import_workflow`, without weakening top-1 owner quality, support-cluster usefulness, payload size, or real-corpus retrieval behavior.

## Solution

Build a full-panel shadow evaluation and then, only if it earns promotion, wire the method into runtime code-lane ranking.

From the user's perspective, the next Context Pack should feel materially closer to how a strong engineer would gather code context. For a storage-backed retrieval task, it should surface the implementation owner plus schema/database/store support. For an import or reindex task, it should surface the command/workflow owner plus parser, chunking, index, and persistence support. The top-3 code entries should behave like a small task-specific bundle, not three isolated high-scoring files.

The solution has five parts:

1. Run the existing PRD-0049 shadow adapters across the full code-lane panel, not just focused synthetic cases.
2. Add a bundle-aware hybrid reranker that separates broad candidate generation from final top-3 assembly.
3. Add repository-map owner retention so support expansion cannot bury the primary implementation owner.
4. Add family-specific support lenses for `persistence_substrate` and `import_workflow`, using support necessity rather than broad token overlap.
5. Promote to runtime only when the full-panel report shows significant top-3/support lift and the real-corpus no-regression guardrails pass.

The desired movement is:

- prompt variant top-3 at or above `75%`
- tickets top-3 robust at or above `10/14`
- support file hits at or above `50/66`
- no regression below PRD-0048 on code top-1 acceptable, code ranked useful, support-cluster useful, payload size, and real-corpus guardrails

If the method improves support but not top-3, the report should treat that as a stepping stone, not production success.

## User Stories

1. As an agent operator, I want top-3 code context to be the primary promotion goal, so that the first Context Pack is actionable without follow-up searching.
2. As an agent operator, I want the implementation owner plus necessary support files in the first slate, so that an agent can start coding safely.
3. As an agent operator, I want hybrid rerank evaluated on the full code-lane panel, so that focused synthetic wins do not overstate production readiness.
4. As an agent operator, I want repository-map owner retention, so that support expansion does not hide the best starting file.
5. As an agent operator, I want persistence substrate support surfaced for schema-backed tasks, so that storage changes include database and schema context.
6. As an agent operator, I want import workflow support surfaced for import/reindex tasks, so that CLI, parser, chunking, and storage effects are visible together.
7. As an engineer, I want code context to read like a small implementation bundle, so that the top-3 files explain the likely change path.
8. As an engineer, I want exact navigation metadata preserved, so that every included code entry remains actionable.
9. As an engineer, I want trace reasons for rerank promotion and demotion, so that I can tell why a file entered or left the first slate.
10. As an engineer, I want passive reports, evals, examples, and fixtures demoted unless explicitly requested, so that implementation context stays focused.
11. As an engineer, I want graph neighbors to support the owner rather than dominate ranking, so that import edges add context without becoming graph-first retrieval.
12. As an engineer, I want payload size to stay bounded, so that better top-3 quality does not flood the prompt.
13. As a maintainer, I want candidate generation misses separated from rerank misses, so that the next failure mode is clear.
14. As a maintainer, I want owner, support, and full-set candidate recall tracked separately, so that support-generation misses cannot hide behind owner recall.
15. As a maintainer, I want family movement reported for `persistence_substrate`, `import_workflow`, `source_profile_storage`, `retrieval_index`, and `cli_workflow`, so that gains are explainable.
16. As a maintainer, I want the Ralph holdout included before promotion, so that local ContextTrail gains do not masquerade as generalization.
17. As a maintainer, I want real-corpus guardrails to remain unchanged, so that code-context gains do not degrade doc retrieval.
18. As a maintainer, I want any production promotion to be reversible behind the code-lane method boundary, so that regressions can be backed out cleanly.
19. As a maintainer, I want method names and trace reasons to stay stable, so that reports remain comparable across PRDs.
20. As a maintainer, I want no copied OSS code in this PRD, so that prior-art attribution remains method-level unless a later legal review permits reuse.
21. As an eval author, I want the full-panel shadow report to list top-3 robust tickets before and after, so that the headline metric is auditable.
22. As an eval author, I want per-ticket missing files preserved, so that improvements do not blur which files remain absent.
23. As an eval author, I want bundle-level top-3 scoring, so that files useful together are evaluated together.
24. As an eval author, I want support file hit movement reported separately from support-cluster usefulness, so that broad support usefulness does not hide missing exact files.
25. As an eval author, I want payload-size impact reported for each method, so that bigger slates cannot win silently.
26. As an eval author, I want focused synthetic tests to remain behavior-shaped, so that the full-panel work has a precise regression harness.
27. As a product owner, I want a significantly better first-slate experience, so that ContextTrail feels like a code context engine rather than a ranked search list.
28. As a product owner, I want the promotion threshold stated upfront, so that the team does not rationalize a small or ambiguous gain.
29. As a future contributor, I want hybrid candidate generation behind a small interface, so that alternate methods can be swapped into the same eval harness.
30. As a future contributor, I want bundle reranking behind a small interface, so that top-3 assembly can improve without rewriting candidate generation.
31. As a future contributor, I want support lenses to be independently testable, so that new implementation families can be added safely.
32. As a future contributor, I want rejected shadow methods documented, so that agents do not rediscover weak graph-first or support-only paths.
33. As a future contributor, I want the final report to explain remaining misses, so that the next PRD starts from evidence rather than speculation.
34. As a future contributor, I want the runtime method guarded by evals, so that future ranking changes cannot quietly lower the new bar.
35. As a user reviewing the result, I want the verdict to say whether production promotion is earned, so that the next action is obvious.
36. As a user reviewing the result, I want top-3 to remain the ultimate goal, so that support-only lift is not mistaken for completion.

## Implementation Decisions

- Treat top-3 context assembly as the north-star metric for this PRD.
- Keep chunk-first code retrieval as the production architecture unless the shadow report earns a runtime promotion.
- Keep the import graph as bounded late augmentation and support evidence, not as the primary retrieval unit.
- Extend the PRD-0049 shadow harness to run against the full code-lane panel and Ralph holdout.
- Model candidate generation and bundle reranking as separate deep modules with small testable interfaces.
- Use broad deterministic candidate generation across lexical, path, symbol, repository-map, and bounded graph/support signals.
- Use bundle-aware reranking for final top-3 selection, optimizing owner retention plus necessary support rather than independent file scores.
- Add repository-map owner retention as a hard safety property when the owner signal is clear.
- Add family-specific support lenses for persistence substrate and import workflow before adding broader family coverage.
- Treat support necessity as the decision boundary for support files: a file must be necessary for the current task, not merely related.
- Preserve exact navigation metadata and method trace reasons through candidate generation, rerank, and final pack entries.
- Keep passive reports, evals, examples, fixtures, and runner state demoted unless the retrieval request explicitly asks for those surfaces.
- Keep embeddings, hosted services, runtime LLM reranking, and copied OSS implementation code out of scope for this PRD.
- Promote to runtime only if top-3/support metrics improve meaningfully and no guardrail regresses.
- If promotion is not earned, leave the work as a shadow diagnostic method and write a verdict that names the next failure mode.

## Testing Decisions

- Good tests verify external retrieval behavior: owner retention, support inclusion, support exclusion, bundle top-3 usefulness, trace explainability, and guardrail preservation.
- Tests should not pin private score constants unless a score normalization contract is the behavior under test.
- Candidate-generation tests should prove owner, support, and full-set candidate recall separately.
- Bundle-rerank tests should prove the final top-3 can prefer owner plus necessary support over individually plausible but passive files.
- Repository-map tests should prove owner retention survives support expansion.
- Persistence substrate tests should prove schema/database/store support is admitted for persistence-shaped tasks and excluded elsewhere.
- Import workflow tests should prove command/parser/chunker/reindex/storage context is assembled without admitting passive reports.
- Graph support tests should prove bounded import and reverse-import evidence adds traceable support without graph-first promotion.
- Full-panel shadow tests should render comparable method summaries for the PRD-0048 baseline, repository-map, hybrid rerank, graph/xref, and the combined method.
- The final verdict should run focused tests, build, full test suite, paired code-lane comparison, cross-repo holdout comparison, and real-corpus eval.
- Production promotion requires no regression below PRD-0048 on code top-1 acceptable, code ranked useful, support-cluster useful, prompt ranked usefulness, and payload size.
- Production promotion requires meaningful lift toward the stated targets: prompt variant top-3 at or above `75%`, tickets top-3 robust at or above `10/14`, and support file hits at or above `50/66`.
- A support-only improvement may be kept as diagnostic substrate but should not be declared production success.
- A method that improves ContextTrail but worsens Ralph holdout should not be promoted without an explicit verdict explaining why.

## Out of Scope

- Replacing chunk-first code retrieval.
- Graph-first retrieval.
- Unbounded import or reference traversal.
- Embeddings, hosted services, required credentials, or runtime LLM reranking.
- Copying OSS code into the repo.
- Making code entries authority-bearing Context Objects.
- Changing the MCP contract.
- Redesigning document retrieval, query-mode honesty, or pack rendering.
- Hardcoding ticket IDs, commit IDs, expected files, holdout repository names, or corpus-specific aliases.
- Promoting a support-only improvement as if top-3 context assembly were solved.
- Ratcheting CI gates before a stable promoted baseline exists.

## Further Notes

PRD-0049 answered the "which prior-art method should we try next?" question. The answer is not a broad graph expansion and not another isolated family tweak. It is a full-panel hybrid rerank that starts wide, preserves the owner, then assembles a small top-3 bundle with necessary support.

The success bar should stay high. ContextTrail is already good enough to find many code files somewhere in the ranked list. PRD-0050 should make the first three code entries meaningfully better for real agent-completion work.
