# PRD-0048: Targeted Code-Lane Family Ranking Improvements

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's forty-eighth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md) -- see `Context Pack`, `pack entry`, `context assembly`, `agent-completion source-file coverage`, `code-source index`, `import graph`, `SourceProfile`, `source card`, `fact-finding quality`, `pack readiness verifier`, and `retrieval pipeline`.
>
> Governing ADRs: [ADR-0021](../adr/0021-gate-calibration-policy.md), [ADR-0023](../adr/0023-chunk-first-code-retrieval-with-file-graph-late-augmentation.md), [ADR-0024](../adr/0024-code-must-compete-inside-the-core-pack-authority.md), and [ADR-0025](../adr/0025-code-navigation-fields-and-get-code-chunk-are-first-class-mcp-contract.md).
>
> Predecessor PRD: [PRD-0047](0047-code-lane-residual-miss-generalization.md).
>
> Boundary rule: this PRD does not replace chunk-first code retrieval, add embeddings, introduce runtime LLM ranking, add unbounded graph traversal, or tune for one fixture. It converts PRD-0047's residual family diagnostics into narrow, family-gated runtime improvements that must prove eval lift before promotion.

## Problem Statement

The user wants ContextTrail's code retrieval to match the outcome of the stronger text retrieval process: an agent should receive the implementation owner plus the support files needed to complete the task, early enough in the Context Pack to act on them.

PRD-0047 added the right diagnostic surface, but it also exposed the next architectural constraint. A broad generic family-support expansion was tried and rejected because it regressed the corpus ranking bar:

- ranked code-file coverage fell from `54/66` to `53/66`
- prompt variant top-3 usefulness fell from `26/42` to `23/42`
- ticket top-3 robustness fell from `5/14` to `4/14`

The final PRD-0047 implementation therefore preserved the PRD-0046 runtime ranking bar and shipped diagnostics instead of promoting that runtime method.

The new diagnostic output shows that the remaining misses are not random. They cluster into residual implementation families:

- `persistence_substrate`: storage schema, database, chunk storage, and shared persistence substrate files are often missing from ranked results or support clusters.
- `import_workflow`: command, import, reindex, parser, chunker, and index-storage files are often ranked too low or absent from support.
- `source_profile_storage`: SourceProfile parser, type, store, and schema files are visible, but ordering and support inclusion remain inconsistent.
- `retrieval_index` and `cli_workflow` on the Ralph holdout: artifact/index and runner/validator support is not yet useful in top-3 or support clusters.

The problem is no longer "do we have diagnostics?" We do. The problem is how to turn those diagnostics into runtime ranking improvements without repeating the PRD-0047 mistake of broadening support admission too aggressively.

## Solution

Add a targeted, eval-gated family-ranking improvement process for the code lane.

From the user's perspective, each improvement should make one residual family noticeably better while preserving the current global code-lane bar. If the task is about persistence substrate, the pack should surface the implementation owner plus relevant storage/schema/database support. If the task is about import workflow, the pack should surface the command or owner plus the parser, chunking, reindex, and storage support files that shape the implementation.

The solution has six parts:

1. Treat PRD-0047 diagnostics as the runtime improvement backlog, not as a runtime method by itself.
2. Build a small family-targeted evidence seam that can score one implementation family at a time.
3. Start with `persistence_substrate`, because it has the highest support-missing score in the PRD-0047 verdict.
4. Add `import_workflow` next, because it has the largest ranked-below-top-3 pressure and affects end-to-end implementation paths.
5. Keep `source_profile_storage`, `retrieval_index`, and `cli_workflow` as explicit follow-on families, but do not promote them through a broad shared expansion until they have family-specific tests and eval lift.
6. Gate every runtime change on focused behavior tests, paired code-lane comparison, cross-repo diagnostics, and the broad real-corpus no-regression guardrail.

This should produce a repeatable loop:

1. Pick one residual family.
2. Add behavior tests that describe the desired external retrieval outcome.
3. Implement the smallest family-specific method.
4. Run the eval.
5. Keep the method only if it improves the targeted family without regressing global ranking quality.

## User Stories

1. As an agent operator, I want persistence substrate files to appear earlier for schema-backed implementation work, so that an agent can complete changes that touch storage behavior.
2. As an agent operator, I want database and schema companions to appear as support only when the task points at persistence work, so that common infrastructure does not flood unrelated packs.
3. As an agent operator, I want import workflow tasks to include command, parser, chunking, reindex, and storage companions, so that the full implementation path is visible.
4. As an agent operator, I want SourceProfile storage tasks to stay stable without reviving broad source-card promotion, so that the pack improves without repeating the PRD-0047 regression.
5. As an agent operator, I want Ralph-style runner and validator workflows to be diagnosed separately from ContextTrail-specific import workflows, so that holdout failures produce portable methods.
6. As an engineer, I want the primary owner to stay first when the owner is clear, so that support promotion does not hide the best starting point.
7. As an engineer, I want the first code slate to include more of the implementation family, so that I can start coding without manually searching the repo.
8. As an engineer, I want support files to be bounded by count and token budget, so that the Context Pack stays compact.
9. As an engineer, I want passive reports, eval files, fixtures, and examples to stay out of implementation support unless requested, so that retrieved code remains action-oriented.
10. As an engineer, I want the ranking trace to explain why a support file was admitted, so that I can trust the context rather than guessing.
11. As an engineer, I want schema, database, and chunk-storage files to be treated as substrate for persistence tasks, so that storage changes do not miss hidden coupling.
12. As an engineer, I want import and reindex tasks to surface both command entrypoints and downstream storage effects, so that changes do not stop at the CLI layer.
13. As an engineer, I want equivalent prompts to produce similar support clusters, so that small wording differences do not change whether the task is workable.
14. As a maintainer, I want each residual family to have its own tests, so that one broad method cannot accidentally trade away top-3 quality.
15. As a maintainer, I want family evidence to be reusable but not overgeneral, so that new families can be added without weakening existing ones.
16. As a maintainer, I want family scoring to use stable code-source facts, query anchors, and chunk evidence, so that the method is not tied to ticket IDs or expected-file lists.
17. As a maintainer, I want support-cluster admission to consume the same family evidence as first-slate ranking, so that ranking and support behavior stay coherent.
18. As a maintainer, I want the global PRD-0046 bar to remain protected, so that local family wins do not reduce aggregate usefulness.
19. As a maintainer, I want cross-repo diagnostics to remain in the promotion report, so that ContextTrail does not overfit itself.
20. As a maintainer, I want a rejected-method note in the verdict when an attempted family method regresses, so that future agents do not rediscover the same bad path.
21. As an eval author, I want residual miss counts by family to be compared before and after each method, so that we can see whether the intended family improved.
22. As an eval author, I want `missing_from_ranked`, `ranked_below_top3`, `support_missing`, and `body_only` to remain separate, so that the fix targets the actual miss shape.
23. As an eval author, I want prompt top-1, top-3, ranked, and support usefulness to stay separate, so that ranked recall cannot hide first-slate weakness.
24. As an eval author, I want ticket robustness to stay visible, so that a method that only helps one prompt variant is not overstated.
25. As an eval author, I want the real-corpus guardrail to run after runtime ranking changes, so that document retrieval quality is protected.
26. As a product owner, I want code-lane improvements to be significant enough to matter to agent completion, so that the project is not merely fitting eval tables.
27. As a product owner, I want methods to be promoted only after measured lift, so that the repo keeps a high-confidence baseline.
28. As a product owner, I want the next PRD to be sliceable into AFK-agent issues, so that implementation can proceed in focused vertical increments.
29. As a future contributor, I want a deep family-evidence module with a small interface, so that new families can be tested in isolation.
30. As a future contributor, I want a separate family verdict report, so that implementation decisions are grounded in observed results.
31. As a future contributor, I want rejected broad expansion tests to remain as guardrails, so that future changes do not reintroduce the same regression.
32. As a future contributor, I want synthetic tests to avoid copying eval fixture paths, so that the implementation proves a portable behavior.
33. As a future contributor, I want integration tests to assert observable ranked/support outcomes instead of score constants, so that ranking internals can evolve.
34. As a future contributor, I want cross-repo holdout gaps to inform new methods, so that ContextTrail improves outside its own corpus.
35. As a user reviewing the PRD, I want clear out-of-scope boundaries, so that this stays a runtime ranking improvement rather than another retrieval architecture rewrite.
36. As a user reviewing the result, I want a final report that says which family improved and which families still need work, so that the next planning step is obvious.

## Implementation Decisions

- The first implementation target is `persistence_substrate`, because PRD-0047 showed it has the highest combined miss pressure.
- The second implementation target is `import_workflow`, because PRD-0047 showed it is frequently ranked below top-3 or missing from support.
- `source_profile_storage` remains a target family, but broad source-card/source-profile expansion is not accepted without family-specific proof.
- `retrieval_index` and `cli_workflow` are holdout-informed follow-on families rather than part of the first runtime promotion.
- The code lane remains chunk-first. File graph and family evidence are late augmentation and ranking support, not the primary retrieval unit.
- Family methods must preserve the primary owner unless there is stronger existing owner evidence.
- Family methods must admit support files because they are implementation substrate for the current task, not because they share generic tokens.
- Family evidence must be explainable with named reasons that can appear in diagnostics and tests.
- Family evidence must use stable code-source facts, query anchors, chunk roles, import relationships, and task wording.
- Family evidence must not use ticket IDs, commit IDs, expected-file lists, holdout repository names, or fixture-specific aliases.
- Passive measurement and tooling artifacts remain excluded from implementation support unless the query explicitly asks for measurement or tooling.
- Each family method should be independently revertible if it regresses global code-lane quality.
- The final verdict should compare the new result against the PRD-0047 final baseline, not against the rejected intermediate experiment.
- Linear follow-up issues should be vertical slices: one family, one method, one eval verdict.

## Testing Decisions

- Good tests verify external retrieval behavior: owner retention, support inclusion, support exclusion, top-3 usefulness, and diagnostic reporting.
- Tests should not pin private score constants or exact full ranking snapshots unless full ordering is the behavior under test.
- The persistence substrate tests should prove that schema/database/storage companions can be admitted for persistence tasks without admitting unrelated storage files.
- The import workflow tests should prove that command/parser/chunking/reindex/storage companions can appear for import tasks without admitting passive reports.
- The SourceProfile follow-on tests should prove stable parser/type/store/schema support without broad source-card promotion.
- The holdout diagnostics tests should continue to render residual family buckets for unfamiliar repos.
- The family-evidence module should have unit tests over synthetic code facts that do not copy corpus fixture paths.
- The retrieval integration tests should use synthetic files to verify top-slate and support-cluster behavior at the pack-entry level.
- The eval tests should keep residual family diagnostics visible in paired code-lane and cross-repo reports.
- The verification sequence for any runtime method should include focused unit/integration tests, build, paired code-lane comparison, cross-repo comparison, and the broad real-corpus guardrail.
- A method is not accepted if it improves one family while lowering ranked code-file coverage, prompt top-3 usefulness, or ticket top-3 robustness below the PRD-0047 final baseline.
- A method is not accepted if it only improves body-only mentions or lower-ranked recall while making first-slate usefulness worse.
- A method may be accepted with neutral aggregate metrics only if the targeted family miss score improves and no guardrail regresses.

## Out of Scope

- Replacing chunk-first code retrieval.
- Graph-first retrieval.
- Unbounded import traversal.
- Embeddings or semantic vector search.
- Runtime LLM reranking or judging.
- Corpus-specific aliases, ticket-specific hints, or hardcoded expected files.
- Broad source-card promotion.
- Broad source-profile family expansion without targeted eval lift.
- Document-ranking redesign.
- Query-mode honesty redesign.
- MCP contract redesign.
- Pack rendering or compression redesign.
- CI gate ratcheting before a stable new baseline is demonstrated.
- Declaring Ralph solved; Ralph is a holdout diagnostic surface for this PRD, not the sole acceptance target.

## Further Notes

PRD-0047 gave us the right map. The mistake would be to treat that map as the method. The broad runtime attempt already showed that generic family broadening can make the pack worse even when the family labels look plausible.

The next improvement should feel more like the earlier text retrieval eval loop: add sharper diagnostics, pick one failure class, implement a narrow method, run the eval, and only then promote. This PRD exists to keep that discipline intact while moving from diagnostics to runtime ranking quality.

The desired outcome is a code lane whose first implementation slate is better because it understands a real task family, not because it was nudged toward a known corpus row.
