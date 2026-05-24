# PRD-0046: Prompt-Invariant Code First-Slate Ranking

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's forty-sixth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md) — see `Context Pack`, `pack entry`, `context assembly`, `agent-completion source-file coverage`, `code-source index`, `import graph`, `source card`, `critical-source recall`, `fact-finding quality`, and `pack readiness verifier`.
>
> Governing ADRs: [ADR-0021](../adr/0021-gate-calibration-policy.md), [ADR-0023](../adr/0023-chunk-first-code-retrieval-with-file-graph-late-augmentation.md), [ADR-0024](../adr/0024-code-must-compete-inside-the-core-pack-authority.md), and [ADR-0025](../adr/0025-code-navigation-fields-and-get-code-chunk-are-first-class-mcp-contract.md).
>
> Predecessor PRD: [PRD-0045](0045-bounded-code-support-cluster-retrieval.md).
>
> Boundary rule: this PRD does not replace the chunk-first code lane, add embeddings, introduce runtime LLM reranking, or tune for a single corpus fixture. It adds reusable code-family evidence and bounded first-slate ordering so files the engine already finds can become useful in the first implementation slate across prompt variants.

## Problem Statement

The user wants ContextTrail's code retrieval to match the outcome of the current text retrieval process: strong, repeatable context assembly that helps an agent complete real implementation work rather than merely finding a plausible entrypoint.

After the PRD-0045 diagnostic hardening, the code-lane baseline shows a sharper problem than broad recall:

- The new chunk-first code lane finds a useful ranked code result for `41/42` prompt variants.
- Ticket-level ranked usefulness is `14/14`.
- Ranked code-file coverage is `53/66`.
- But prompt-variant top-3 usefulness is only `22/42`.
- Only `2/14` tickets are top-3 robust across their prompt variants.

This means the system usually has the right files somewhere in the ranking, but the first slate an agent actually reads is too sensitive to prompt wording. The result is a brittle implementation experience: one query lands on the right cluster, another equivalent query leaves core support files below the fold or out of the support cluster.

The recurring misses are not random. They cluster around implementation families such as:

- SourceProfile type, parser, store, schema, source-card, and import wiring.
- Store schema, database, chunk persistence, and migration/reindex substrate.
- CLI import/reindex flow connected to chunking and retrieval index storage.
- Source-card and retrieval-support substrate that is implementation-relevant but not always lexically dominant.

The current first slate is therefore underusing real code-family relationships. It treats closely related implementation files as separate lexical competitors instead of as members of a bounded implementation family that should support each other once query evidence points at the family.

## Solution

Add a prompt-invariant first-slate ranking layer for the code lane.

From the user's perspective, equivalent prompts should now produce a more stable top-3 implementation slate. If a prompt names `SourceProfile`, another names `buildSourceProfile`, and a third describes import-time wiring, the pack should still surface the same core implementation family instead of scattering the relevant files across lower ranked positions.

The solution has four parts:

1. Add reusable code-family evidence that recognizes implementation relationships from stable code facts rather than fixture-specific aliases.
2. Add a bounded first-slate reranker that uses direct query evidence plus code-family evidence to lift already-found files into the first code slate.
3. Feed the same family evidence into bounded support-cluster inclusion so the companion files are implementation-relevant, not merely graph-adjacent.
4. Gate the change with prompt-variant diagnostics, commit-grounded code-lane evaluation, and the broad real-corpus guardrail.

This is intentionally a ranking and bounded-support improvement, not a recall redesign. The baseline says ranked recall is already strong. The target is to make the first useful slate less prompt-fragile without increasing prompt bloat or damaging document retrieval behavior.

## User Stories

1. As an engineer using ContextTrail for implementation work, I want equivalent prompts to produce similar top-3 code slates, so that small wording differences do not change whether I can start the task.
2. As an engineer, I want the top code slate to include the implementation family around the winning concept, so that I can see the owner and the core support files together.
3. As an engineer, I want SourceProfile-related work to surface the type, parser, persistence, schema, and presentation support when those are relevant, so that I do not have to manually rediscover the substrate.
4. As an engineer, I want schema-backed work to surface storage and database companions near the primary owner, so that implementation changes do not miss persistence requirements.
5. As an engineer, I want import and reindex work to surface CLI, chunking, schema, and index-storage companions when the query points there, so that the change path is visible from the first pack.
6. As an engineer, I want support-cluster files to be real code entries with navigation metadata, so that I can act on them immediately.
7. As an engineer, I want the first slate to stay bounded, so that I get more useful context without drowning in a file neighborhood.
8. As an engineer, I want the primary owner to remain visible and prioritized, so that support-file promotion does not hide the best starting point.
9. As an engineer, I want the pack to avoid eval artifacts and corpus-specific hint files, so that retrieved code remains implementation context rather than measurement leakage.
10. As a maintainer, I want first-slate ranking to use reusable code-family evidence, so that the improvement generalizes beyond the current fixture.
11. As a maintainer, I want code-family evidence to be explainable, so that I can debug why a file was promoted or left below the first slate.
12. As a maintainer, I want prompt-variant robustness reported separately from ticket-level union coverage, so that broad ranked recall cannot hide top-slate brittleness.
13. As a maintainer, I want the reranker to only promote files that have both task evidence and family evidence, so that vague family membership does not become a ranking hack.
14. As a maintainer, I want the real-corpus guardrail to remain part of the acceptance bar, so that code-lane improvements do not damage document ranking.
15. As a maintainer, I want payload size to remain bounded, so that better ranking does not quietly become prompt bloat.
16. As an eval author, I want diagnostics to distinguish missing-from-ranked, ranked-below-top-3, support-missing, and body-only hits, so that each failure class points to the correct method.
17. As an eval author, I want per-prompt variant output to show top-1, top-3, ranked, support, and ranked-file hits, so that we can identify prompt-sensitive cases quickly.
18. As an eval author, I want code-family improvements to be judged against shipped commits, so that the score reflects real files engineers changed.
19. As a future contributor, I want a deep, testable code-family module, so that family evidence can evolve without spreading heuristics across retrieval.
20. As a future contributor, I want a small, testable first-slate reranking seam, so that ranking policy can be adjusted without rewriting code recall.
21. As a future contributor, I want support-cluster admission to consume the same evidence vocabulary as first-slate ranking, so that ranking and support behavior stay coherent.
22. As a future contributor, I want acceptance criteria stated in case-count and prompt-variant terms, so that small-N changes are interpreted honestly.
23. As a product owner, I want this slice to improve code retrieval the way prior text retrieval work improved docs retrieval, so that ContextTrail becomes more reliable for agent-completion workflows.
24. As a product owner, I want the implementation to avoid corpus gaming, so that gains survive the next validation repository or Linear panel.
25. As an agent operator, I want the first pack to be good enough to start coding, so that I spend less time asking follow-up retrieval questions before making a safe change.
26. As an agent operator, I want residual misses to be reported in plain language, so that I can choose the next method instead of guessing from aggregate percentages.
27. As an agent operator, I want code-family evidence to strengthen support inclusion only when the prompt is actually about that family, so that unrelated files do not appear just because they are common infrastructure.
28. As an engineer reviewing the retrieval trace, I want to see whether a promotion came from symbol evidence, path/family evidence, import/storage evidence, or support-cluster evidence, so that I can trust the ranking decision.
29. As an engineer working on a multi-file feature, I want the pack to include enough of the implementation cluster to avoid blind edits, so that the agent's first patch is closer to complete.
30. As a maintainer, I want this PRD to end with a ratchetable baseline report, so that future ranking work starts from a better locked point.

## Implementation Decisions

- The primary improvement target is prompt-invariant top-3 code usefulness, not raw ranked recall.
- The ranking process should add a deep code-family evidence module with a small public interface that can score or annotate implementation-family relationships.
- Code-family evidence should come from stable code facts such as symbols, file identity, imports, shared concepts, persistence roles, and query anchors.
- Code-family evidence must not use ticket IDs, fixture-specific aliases, hardcoded expected paths, or eval-only body hints.
- A bounded first-slate reranker should operate after chunk-first recall has produced candidate code entries.
- The reranker should lift already-found implementation-relevant files into the first slate only when direct query evidence and family evidence agree.
- The reranker should preserve the primary owner and avoid broad neighborhood dumping.
- Support-cluster admission should reuse the same evidence vocabulary so first-slate ranking and support inclusion make compatible decisions.
- The first-slate logic should be explainable in eval and trace output with named evidence reasons rather than opaque score movement.
- The code lane should continue to compete inside the core pack authority, budget, omission, readiness, and MCP presentation contracts.
- The first implementation family to exercise should be the SourceProfile family because it recurs across the current diagnostic target set and represents a real product substrate.
- The second implementation family should cover store, schema, database, chunks, and reindex-style persistence work because it is a repeated support-missing class.
- The third implementation family should cover import, chunking, and index-building workflow relationships because those tasks require several files that are often already ranked but not first-slate robust.
- Acceptance should compare against the 2026-05-14 baseline rather than against historical contaminated measurements.
- The broad real-corpus release verdict remains a guardrail; the code-lane method must not worsen broad document retrieval behavior.
- The implementation should prefer small vertical slices: add one failing behavior test, implement the smallest deep-module change, run focused tests, then run the relevant evals.

## Testing Decisions

- Tests should verify external retrieval behavior and eval-visible behavior, not private scoring constants.
- Good tests should describe the desired outcome in domain terms: stable first slate, implementation family promotion, bounded support inclusion, and no owner displacement.
- The first unit-level tests should cover code-family evidence using synthetic code facts and queries, proving that related implementation files are recognized without fixture-specific aliases.
- The first integration-style retrieval tests should verify that a SourceProfile-shaped query can surface the owner plus relevant family members in the top slate or support cluster.
- A second integration slice should verify that persistence-shaped work can include schema and database support without admitting unrelated storage files.
- A third integration slice should verify that import/reindex-shaped work can include CLI, chunking, and index-storage companions under bounds.
- Eval tests should keep prompt-variant robustness separate from ticket-level union coverage.
- Diagnostics tests should preserve the miss taxonomy for missing-from-ranked, ranked-below-top-3, support-missing, and body-only file hits.
- Tests should avoid snapshotting whole ranked slates when the behavior under test is only first-slate inclusion or bounded support.
- Tests should not pin exact numeric weights unless those weights are part of an explicit public contract.
- Regression testing should include the focused eval test files for agent-completion probing, code-lane comparison, real-corpus metrics, cross-repo code-lane comparison, and promotion verdict rendering.
- Verification should run the code-lane comparison eval after each meaningful method slice.
- Verification should run the real-corpus eval before accepting the method so broad retrieval remains protected.
- If a slice improves the small panel but worsens real-corpus gates, the method should be treated as suspect until the failure is diagnosed.

## Out of Scope

- Replacing chunk-first code retrieval.
- Graph-first code retrieval.
- Deeper unbounded import traversal.
- Embeddings or semantic vector search.
- Runtime LLM reranking or judging.
- Corpus-specific aliases, ticket-specific hints, or hardcoded expected files.
- Broad document-ranking work unrelated to code first-slate robustness.
- Query-mode honesty redesign.
- MCP contract redesign beyond existing structured code navigation.
- Prompt compression or pack rendering redesign.
- Expanding the eval corpus before the current diagnostic loop has produced a method improvement.
- Ratcheting CI floors before a stable improvement has been demonstrated and documented.

## Further Notes

The 2026-05-14 baseline is the key product clue: ranked recall is already high, while first-slate robustness is not. That makes this a ranking and bounded-support problem, not a discovery problem.

The intended architectural move is to teach the code lane about real implementation families in a reusable way. A good method should make `SourceProfile`, persistence, and import/reindex tasks more stable because those are genuine code relationships, not because the current eval happens to mention them.

The expected end state is a code lane whose first slate is noticeably more useful across multiple prompt phrasings, with diagnostic output clear enough to choose the next method after this one.
