# PRD-0047: Code-Lane Residual Miss Generalization

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's forty-seventh PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md) — see `Context Pack`, `pack entry`, `code-source index`, `import graph`, `source card`, `agent-completion source-file coverage`, `fact-finding quality`, `pack readiness verifier`, and `retrieval pipeline`.
>
> Governing ADRs: [ADR-0021](../adr/0021-gate-calibration-policy.md), [ADR-0023](../adr/0023-chunk-first-code-retrieval-with-file-graph-late-augmentation.md), [ADR-0024](../adr/0024-code-must-compete-inside-the-core-pack-authority.md), and [ADR-0025](../adr/0025-code-navigation-fields-and-get-code-chunk-are-first-class-mcp-contract.md).
>
> Predecessor PRD: [PRD-0046](0046-prompt-invariant-code-first-slate-ranking.md).
>
> Boundary rule: this PRD does not replace chunk-first code retrieval, add embeddings, introduce runtime LLM judging, or tune against one fixture. It turns the post-PRD-0046 diagnostics into reusable ranking methods for residual implementation-family misses and second-repo robustness.

## Problem Statement

The user wants ContextTrail's code retrieval to feel as reliable as the stronger text retrieval path: when an agent asks for implementation context, the first pack should contain the files needed to start and complete the change, not just a plausible owner.

PRD-0046 made the first slate better:

- ranked code-file coverage improved to `54/66`
- support-cluster usefulness improved to `14/14`
- prompt-variant top-3 usefulness improved to `26/42`
- ranked-below-top-3 misses dropped to `0/14`

That is real progress, but the residual diagnostics now show where the next architectural work belongs. The remaining misses concentrate around persistence substrate, schema/database companions, source-profile storage, import/reindex workflow files, and cross-repo generalization. The ContextTrail panel is improving, while the Ralph holdout still shows weak top-3 and support-cluster usefulness.

The problem is no longer "can the code lane find code at all?" The problem is whether the ranking process can generalize implementation-family evidence beyond the specific families already exercised by PRD-0046.

## Solution

Add a second generalization pass for code-lane ranking that turns residual miss classes into reusable methods.

From the user's perspective, a query about a schema-backed change, import/reindex workflow, source-profile persistence, or unfamiliar TypeScript CLI should produce a more complete first pack. The engine should surface the owner plus the relevant implementation support files without admitting passive eval artifacts or broad neighborhood noise.

The solution has five parts:

1. Preserve the PRD-0046 baseline as the comparison point for residual miss work.
2. Extend code-family evidence to recognize persistence, schema, database, source-profile storage, import workflow, and index-building relationships from stable code facts.
3. Improve support-cluster admission so support files are chosen because they are implementation substrate for the current task, not merely nearby files.
4. Add second-repo diagnostics that make unfamiliar-repo failures actionable instead of hiding them inside aggregate promotion output.
5. Produce a PRD-0047 verdict report that explains improvements, regressions, and the next target families.

This should remain a bounded ranking and support-cluster improvement. The answer is not more files by default. The answer is better evidence for which companion files matter.

## User Stories

1. As an agent operator, I want schema-backed code work to surface the database and persistence companions, so that the first pack supports a complete implementation.
2. As an agent operator, I want import and reindex tasks to surface workflow, chunking, and index-storage companions, so that the agent can trace the end-to-end path.
3. As an agent operator, I want source-profile storage tasks to surface parser, type, store, schema, and source-card support when relevant, so that the implementation family is visible.
4. As an engineer, I want the primary owner to remain visible while support files improve, so that ranking does not trade one failure mode for another.
5. As an engineer, I want support files to be bounded and explainable, so that extra context remains trustworthy.
6. As an engineer, I want passive eval, report, benchmark, and fixture files to stay out of implementation support unless explicitly requested, so that the pack remains action-oriented.
7. As a maintainer, I want residual miss diagnostics grouped by implementation family, so that each next method has a clear target.
8. As a maintainer, I want second-repo holdout results to be visible in the verdict, so that local corpus gains do not masquerade as generalization.
9. As a maintainer, I want code-family evidence to use stable facts such as exported symbols, file purpose, declarations, imports, and query anchors, so that it is not tied to ticket IDs.
10. As a maintainer, I want each method slice to be testable without pinning private numeric weights, so that ranking can evolve safely.
11. As an eval author, I want prompt-variant top-1, top-3, ranked, and support usefulness to stay separate, so that aggregate ranked recall cannot hide first-slate weakness.
12. As an eval author, I want support-cluster file hits to be reported by target family, so that support improvements are attributable.
13. As an eval author, I want the Ralph holdout failures to identify missed support families, so that unfamiliar-repo generalization has concrete work items.
14. As a future contributor, I want a deep evidence module with a stable interface, so that adding a new implementation family does not require rewriting retrieval.
15. As a future contributor, I want support-cluster admission to consume the same evidence vocabulary as first-slate ranking, so that the ranking model stays coherent.
16. As a future contributor, I want the final verdict to record commands, metrics, and residual misses, so that the next improvement loop starts from a durable baseline.
17. As a product owner, I want the method to improve usefulness rather than only matching the eval corpus, so that ContextTrail gets better for real agent-completion work.
18. As a product owner, I want the broad real-corpus guardrail to remain protected, so that code-lane gains do not damage document retrieval.
19. As an agent, I want unfamiliar TypeScript repos to benefit from the same ranking evidence, so that a second repo does not require bespoke aliases.
20. As an agent, I want the first pack to make implementation paths obvious, so that fewer follow-up retrieval calls are needed before coding.

## Implementation Decisions

- Treat PRD-0046 as the starting baseline, not as the final promotion state.
- Keep chunk-first recall, first-slate reranking, and bounded support-cluster retrieval as the governing architecture.
- Add or deepen implementation-family evidence for persistence, schema/database, source-profile storage, import workflow, and index-building relationships.
- Use stable code facts and query anchors as inputs to evidence scoring.
- Do not use ticket IDs, fixture-specific path aliases, expected-file lists, or generated eval text as ranking signals.
- Preserve the primary winner at the front of the implementation slate unless a stronger existing owner signal already exists.
- Prefer support entries that explain a concrete implementation dependency over broad same-folder or same-token neighbors.
- Keep passive measurement/tooling artifacts excluded unless the query explicitly asks for measurement or tooling.
- Make second-repo diagnostics first-class in the verdict output, not an afterthought.
- Accept small, honest gains if they generalize and do not regress guardrails; reject local gains that worsen the holdout or broad real-corpus behavior.
- Keep Linear issues as vertical slices that can be implemented by AFK agents with focused tests and eval confirmation.

## Testing Decisions

- Tests should verify observable ranking and support-cluster behavior, not private score constants.
- Code-family evidence tests should use synthetic code facts that represent implementation relationships without copying eval fixture paths.
- Retrieval integration tests should assert owner retention, relevant support inclusion, and passive-neighbor exclusion.
- Persistence-family tests should cover schema/database/storage support behavior.
- Import-workflow tests should cover command, chunking, indexing, and storage support behavior.
- Cross-repo tests should verify that second-repo diagnostics identify useful next targets and do not require ContextTrail-specific aliases.
- Eval tests should continue to separate prompt-level robustness from ticket-level union coverage.
- The final verification pass should run focused unit tests, build, paired code-lane comparison, PRD promotion verdict, and the real-corpus guardrail.
- The final report should list improvements and residual miss families rather than only declaring pass/fail.

## Out of Scope

- Replacing chunk-first code retrieval.
- Graph-first retrieval.
- Unbounded import traversal.
- Embeddings or vector search.
- Runtime LLM reranking or judging.
- Corpus-specific aliases or ticket-specific hints.
- Broad document-ranking redesign.
- Query-mode honesty redesign.
- MCP contract redesign.
- Prompt compression or pack-rendering redesign.
- CI gate ratcheting before the new baseline is proven.

## Further Notes

PRD-0046 showed that the ranking architecture is moving in the right direction. PRD-0047 should avoid the temptation to overfit the last few ContextTrail misses. The higher-value target is a more portable evidence vocabulary: persistence substrate, workflow substrate, and unfamiliar-repo implementation families.

The desired end state is not perfect scores. The desired end state is a clearer, more general ranking process with eval output that tells us whether the next improvement should be evidence, recall, support admission, or corpus expansion.
