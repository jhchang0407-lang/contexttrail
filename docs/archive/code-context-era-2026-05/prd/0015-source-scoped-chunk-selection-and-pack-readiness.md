# PRD-0015: Source-scoped chunk selection and pack readiness

> Source-of-truth canonical doc. Intended to be mirrored to the issue tracker as the project's fifteenth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADRs: [ADR-0020](../adr/0020-retrieval-engine-v2-source-first-ceiling-probes.md), [ADR-0015](../adr/0015-task-readiness-gates-authority-not-access.md). Related PRDs: [PRD-0008](0008-week-5-structural-assembly-basics.md), [PRD-0011](0011-confidence-abstention-rework.md), [PRD-0014](0014-retrieval-engine-v3-source-selection-and-aboutness.md).
>
> **Sequencing rule:** this PRD comes after Retrieval Engine V3 proved that candidate recall is high, unsupported honesty is strong, and source selection can improve first-read quality, but the product still lacks a robust source-scoped chunk selector and a pack-level readiness verifier. This PRD must not reopen broad retrieval tuning as its first move.

## Problem Statement

ContextTrail's retrieval engine is no longer primarily failing because it cannot find relevant sources.

The current combined real-corpus result on 148 cases is:

| Metric | Result |
|---|---:|
| top-1 acceptable | 131/148 = 88.5% |
| ranked useful | 118/148 = 79.7% |
| query mode correct | 107/148 = 72.3% |
| coverage honest | 148/148 = 100.0% |
| agent answer pass | 147/148 = 99.3% |

That is a very different shape from the earlier V2 problem. The engine usually finds a useful source, and it is now honest about unsupported retrieval. The remaining product risk is that retrieval quality is still being judged too much by source order alone.

For real-world context assembly, two unresolved questions remain:

1. Once the engine has selected the right source, which chunks from that source, and which immediate structural neighbors, should actually enter the Context Pack?
2. How should the engine decide whether the returned pack is truly sufficient for the task, rather than merely plausible?

Today, those decisions are still relatively shallow:

- source order influences packing, but chunk choice inside selected sources is still weakly modeled
- the engine may return a useful source without explicitly deciding whether the returned chunks cover the task
- answerable tasks can pass because the right source is somewhere in the pack even when the pack is missing the best explanatory section, setup section, overview section, or required sibling
- the agent answer surface is strong partly because the current corpus often tolerates extra inference, not because the pack readiness decision is explicit

That is not enough for the product we are trying to build. ContextTrail needs to become excellent at **critical-source recall or honest abstention**, then excellent at **source-scoped chunk selection and pack readiness**, before broader context assembly can be trusted.

This matters especially under the product's setup and UX constraints:

- users cannot be asked to do deep manual curation to rescue ordinary retrieval
- the engine must preserve truthfulness instead of hiding uncertainty behind a polished pack
- questioning should be a targeted recovery path for named missing needs, not a default burden placed on every task

The current product gap is therefore:

> ContextTrail can often find the right source, but it still lacks a deep, explicit module that turns selected sources into a minimal sufficient pack and then says whether that pack is ready, partial, needs anchors, or unsupported.

## Solution

Build the next retrieval-to-assembly bridge as two deep modules:

1. a **source-scoped chunk selector**
2. a **pack readiness verifier**

The source-scoped chunk selector is responsible for turning selected sources into the right retrieved evidence:

- pick the primary chunk within a selected source
- optionally add source intro, overview, parent, sibling, or directly linked chunks when they materially improve sufficiency
- preserve the distinction between source correctness and chunk correctness
- keep budget behavior explicit and testable

The pack readiness verifier is responsible for deciding whether the returned Context Pack is actually sufficient for the task:

- decompose the task into deterministic context needs
- check whether each need is satisfied by the selected locked Cards and ranked doc chunks
- emit a readiness state such as `ready`, `partial`, `needs_anchors`, or `unsupported`
- keep fail-closed behavior: if the pack is missing critical context, the engine should say so rather than sound more confident than the evidence warrants

This PRD is deliberately not a broad new retrieval rewrite. It should reuse the current V2.5 and V3 substrate:

- SourceProfiles
- multi-path source candidates and fused source signals
- deterministic source rerank
- source cards and aboutness signals
- fail-closed coverage confidence
- structural assembly groundwork where it is already proven

The target behavior is:

- if the selected source is correct, the pack should include the right source-local chunk set rather than whichever chunk happened to rank highest lexically
- if the task requires multiple source-local needs, the verifier should know which are covered and which are missing
- if the pack is missing a required need that could be recovered with better anchors or a follow-up retrieval, the engine should expose that specifically
- if the pack is truly unsupported, the engine should remain honest
- if the pack is sufficient, the engine should be able to say that clearly without needing manual user rescue

### Success Criteria

This PRD ships only when chunk-selection and readiness movement are measurable and improve the actual product surface.

| Gate | Required |
|---|---:|
| combined top-1 acceptable | no regression from current 131/148 |
| combined ranked useful | improve from current 118/148 |
| combined coverage honest | remain 148/148 |
| combined agent answer pass | remain >= current 147/148 |
| named source-correct but chunk-weak cases | reduced materially |
| named pack-sufficiency misses | reduced materially |
| false-confident unsupported | remain 0 |
| synthetic regression | passed |

### Structural Gates

- No reopening broad source-ranking coefficient work as the primary implementation.
- No repo-specific chunk-selection rules.
- No weakening of unsupported honesty or fail-closed confidence.
- No public MCP contract expansion to a full `task_readiness` field unless a separate decision explicitly approves it.
- No pretending a pack is `ready` just because top-1 looks good.
- No shifting manual burden onto the user for ordinary successful cases.
- No using questioning as a substitute for missing deterministic pack logic.

### Deep Modules

This PRD should be implemented through deep modules with stable interfaces rather than scattered heuristics.

1. **Source-scoped chunk selector**
   - Input: selected sources, query/task signals, source-local chunk candidates, and current structural context.
   - Output: ordered chunk selections plus structured reasons.
   - Responsibility: choose the best source-local evidence set while staying budget-aware and grounded.

2. **Task-need extractor**
   - Input: task text, query mode, recognized anchors, selected sources, and query intent.
   - Output: deterministic context needs such as exact symbol behavior, overview/explanation need, setup/install need, decision/rationale need, sibling comparison need, or linked operational rule.
   - Responsibility: make pack readiness about explicit needs rather than gut feel.

3. **Pack readiness verifier**
   - Input: task needs, locked Cards, selected chunks, selected sources, warnings, and confidence/coverage evidence.
   - Output: readiness state, missing needs, satisfied needs, and fail-closed reasons.
   - Responsibility: decide whether the pack is sufficient, partial, needs anchors, or unsupported.

4. **Readiness-aware assembly orchestrator**
   - Input: retrieval result plus source-scoped chunk-selection and readiness-verifier outputs.
   - Output: final pack ordering, diagnostics, and internal readiness result.
   - Responsibility: keep chunk selection, readiness, and presentation from drifting apart.

5. **Eval and observability harness**
   - Input: fixtures and real-corpus cases.
   - Output: source-correct-vs-chunk-wrong metrics, need coverage metrics, readiness-state diagnostics, and agent-answer deltas.
   - Responsibility: make the new modules measurable before broader context assembly claims are made.

## User Stories

1. As a ContextTrail maintainer, I want the next PRD to target the measured post-V3 gap, so that implementation effort moves into pack construction rather than circling retrieval tuning.
2. As a ContextTrail maintainer, I want source correctness and chunk correctness measured separately, so that we can tell whether a miss came from the wrong source or the wrong section inside the right source.
3. As a ContextTrail maintainer, I want the engine to choose chunks within selected sources intentionally, so that a dense incidental section does not beat the section that actually answers the task.
4. As a ContextTrail maintainer, I want a deep module for source-scoped chunk selection, so that source-local assembly logic is testable and does not get buried in ranking or presentation code.
5. As a ContextTrail maintainer, I want source-scoped chunk selection to preserve source-first behavior, so that the engine does not regress into chunk-first accidental ranking.
6. As a ContextTrail maintainer, I want pack readiness to be a first-class decision, so that a plausible-looking pack is not automatically treated as sufficient.
7. As a ContextTrail maintainer, I want pack readiness to be computed by a standalone module, so that the product can reason about sufficiency consistently across eval, MCP, and future workflows.
8. As a ContextTrail maintainer, I want readiness to be based on named task needs, so that the engine can explain what is missing instead of only reporting a low score.
9. As a ContextTrail maintainer, I want the verifier to distinguish `ready`, `partial`, `needs_anchors`, and `unsupported`, so that recovery paths are precise.
10. As a ContextTrail maintainer, I want questioning to be a recovery mechanism for specific missing needs, so that we preserve low-friction UX.
11. As a ContextTrail maintainer, I want ordinary successful cases to avoid extra questions, so that users are not punished when the engine already has enough grounded context.
12. As a ContextTrail maintainer, I want the pack readiness verifier to stay fail-closed, so that missing evidence lowers authority instead of getting glossed over.
13. As a ContextTrail maintainer, I want current unsupported honesty preserved, so that chunk-selection work cannot reintroduce false confidence.
14. As a ContextTrail maintainer, I want the PRD to explicitly reject more broad rerank tweaking as the primary path, so that we do not relive the reverted V5.8, V5.9, and V5.11 attempts.
15. As a ContextTrail maintainer, I want source-sibling, parent, intro, and linked-neighbor additions treated as chunk-selection evidence, so that they are chosen because they satisfy a need, not because they are nearby.
16. As a ContextTrail maintainer, I want the engine to know when a source intro or overview is needed, so that first-read questions land on the right section instead of only the densest leaf.
17. As a ContextTrail maintainer, I want setup and installation questions to include the structurally right neighboring chunks when needed, so that onboarding packs do not miss prerequisite steps.
18. As a ContextTrail maintainer, I want decision and rationale questions to preserve the explanatory sections inside the right source, so that the pack answers why as well as what.
19. As a ContextTrail maintainer, I want cross-module questions to preserve boundary-defining chunks rather than only the highest lexical hit, so that the pack reflects the real seam between modules.
20. As a ContextTrail maintainer, I want file-anchored questions to prefer exact source-local ownership evidence, so that broad overview chunks do not crowd out the exact section that owns the file/topic.
21. As a ContextTrail maintainer, I want broad-domain questions to allow an overview chunk plus one or two supporting chunks when needed, so that first-read packs are coherent.
22. As a ContextTrail maintainer, I want exact-symbol questions to avoid unnecessary broadening, so that the pack remains precise when the task is precise.
23. As a ContextTrail maintainer, I want chunk selection to remain budget-aware, so that contextual improvement does not silently explode payload size.
24. As a ContextTrail maintainer, I want the selector to be able to preserve one representative chunk from each selected critical source, so that multi-source packs stay grounded.
25. As a ContextTrail maintainer, I want omitted-but-needed chunk diagnostics, so that pack insufficiency is visible when budget forces a tradeoff.
26. As a ContextTrail maintainer, I want readiness to consume locked Card presence and freshness signals where appropriate, so that authoritative operational knowledge remains part of the sufficiency story.
27. As a ContextTrail maintainer, I want readiness to remain distinct from authority, so that useful exploratory packs are not mislabeled as authoritative truth.
28. As a ContextTrail maintainer, I want this PRD to stop short of the full public `task_readiness` contract, so that we can prove the substrate before committing the external surface.
29. As a ContextTrail maintainer, I want internal readiness states and reason codes in explain/eval first, so that we can learn before freezing public API shape.
30. As a ContextTrail maintainer, I want the source-scoped chunk selector to have stable reason categories, so that future debugging is about concepts rather than ad hoc score spelunking.
31. As a ContextTrail maintainer, I want the task-need extractor to use deterministic signals already present in the engine, so that this slice does not introduce a new model dependency.
32. As a ContextTrail maintainer, I want the task-need extractor to recognize setup/install, overview, decision/rationale, exact symbol, boundary, and sibling-support needs, so that the verifier has the right language to reason with.
33. As a ContextTrail maintainer, I want chunk-selection improvements to register in real-corpus agent-answer pass and ranked usefulness, so that this work moves real outcomes rather than only internal elegance.
34. As a ContextTrail maintainer, I want at least one metric for "source was correct but pack was insufficient," so that the next bottleneck is no longer hidden.
35. As a ContextTrail maintainer, I want at least one metric for "pack included extra chunks past minimal sufficiency," so that bloated packs do not count as wins.
36. As a ContextTrail maintainer, I want minimal-sufficiency evaluation to remain part of the product discipline, so that context assembly stays constrained.
37. As a ContextTrail maintainer, I want source-scoped chunk selection to reuse the week-5 structural assembly groundwork where it is already right, so that we build on proven structure instead of replacing it casually.
38. As a ContextTrail maintainer, I want chunk selection to go beyond the narrow week-5 prototype, so that real-corpus packs are judged by need coverage rather than only structural stage labels.
39. As a ContextTrail maintainer, I want the new modules to be reusable for later context assembly loops, so that future iterative retrieval has a solid deterministic core.
40. As a ContextTrail maintainer, I want the readiness verifier to expose missing-need categories that a follow-up retrieval could target, so that later selective retrieval can be precise.
41. As a ContextTrail maintainer, I want the engine to know when additional retrieval would be harmful, so that the future assembly loop can stop instead of broadening blindly.
42. As a ContextTrail maintainer, I want the PRD to preserve the deterministic-core principle, so that embeddings or LLM rerank remain optional future layers rather than required correctness infrastructure.
43. As a ContextTrail maintainer, I want no repo-specific fixes hidden inside chunk selection, so that gains generalize across corpora.
44. As a ContextTrail maintainer, I want evaluation to keep unsupported and answerable cases separate, so that readiness work does not blur safety and utility.
45. As a ContextTrail maintainer, I want current source-retrieval modules to remain intact while chunk selection is improved, so that attribution stays clean.
46. As a ContextTrail maintainer, I want the selector to support exact chunk reasons such as intro chosen, parent chosen, sibling chosen, linked-neighbor chosen, or exact heading chosen, so that packing behavior is inspectable.
47. As a ContextTrail maintainer, I want the verifier to name which task need is unsatisfied, so that the engine can say "needs install/setup context" or "needs rationale source" rather than only "uncertain."
48. As a ContextTrail maintainer, I want the engine to preserve truthfulness under ambiguity, so that a pack may remain exploratory even when it is still useful.
49. As a ContextTrail maintainer, I want the PRD to improve the user experience without demanding exhaustive setup, so that the product still feels lightweight to adopt.
50. As a ContextTrail maintainer, I want the questioning path to stay shallow and high-leverage, so that users answer only when the engine can justify the question.
51. As an agent consuming `retrieve_context_pack`, I want the pack to contain the right section inside the right source, so that I can start acting without immediately chasing missing local context.
52. As an agent consuming `retrieve_context_pack`, I want the engine to tell me when the returned pack is only partial, so that I can switch into clarification or follow-up retrieval mode safely.
53. As an agent consuming `retrieve_context_pack`, I want the engine to tell me when it specifically needs anchors, so that I can ask the user for the smallest useful correction.
54. As an agent consuming `retrieve_context_pack`, I want the engine to preserve useful overview chunks for orientation tasks, so that I do not begin from an incidental subsection.
55. As an agent consuming `retrieve_context_pack`, I want exact implementation tasks to remain tight, so that contextual improvements do not create noise.
56. As a user of ContextTrail, I want setup and getting-started questions to surface the prerequisite context automatically when the corpus supports it, so that I do not have to manually hunt for the neighboring install page.
57. As a user of ContextTrail, I want tradeoff and architecture questions to surface the rationale chunks that actually explain the decision, so that the pack feels trustworthy.
58. As a user of ContextTrail, I want the engine to admit when it does not yet have enough context, so that I do not get a polished but misleading answer.
59. As a future implementer of public readiness APIs, I want this PRD to produce a stable internal readiness substrate first, so that later API design is grounded in real behavior.
60. As a future context-assembly implementer, I want chunk selection and readiness verification to exist as separate deep modules, so that iterative retrieval, follow-up questioning, and final assembly can compose cleanly.

## Implementation Decisions

- This PRD is the bridge from retrieval quality into assembly-safe Context Pack quality.
- The primary work is not candidate generation and not broad source reranking. It is source-scoped chunk selection plus pack readiness verification.
- The PRD should reuse the current Retrieval Engine V2.5 and V3 substrate rather than replacing it.
- The first implementation slice should be eval-first. Add metrics and diagnostics for chunk correctness and readiness sufficiency before large production behavior changes.
- The source-scoped chunk selector is a deep module and should own source-local chunk choice.
- The selector should consume selected sources, query/task signals, source-local chunk candidates, source-local structure, and budget constraints.
- The selector should produce ordered chunk choices plus structured reasons.
- The selector should prefer explicit source-local evidence over accidental lexical density.
- The selector may choose among source intro, overview, exact heading, parent, sibling, and directly linked neighbor chunks when they satisfy a named task need.
- The selector must remain deterministic in this PRD.
- The selector must not become a semantic graph walk or open-ended broadening engine.
- The task-need extractor is a deep module and should infer deterministic task needs from existing signals.
- Task needs should be expressed in stable concepts rather than repository-specific language.
- The first task-need vocabulary should cover exact-symbol behavior, overview/orientation, setup/install, decision/rationale, cross-module boundary, and sibling-support needs.
- The pack readiness verifier is a deep module and should consume task needs plus pack contents.
- The verifier should return a readiness result with structured satisfied needs, missing needs, and reason codes.
- The verifier should support at least `ready`, `partial`, `needs_anchors`, and `unsupported` as internal states.
- This PRD should keep internal readiness separate from the deferred public `task_readiness` contract in ADR-0015.
- Public MCP changes should be additive and conservative. The default plan is to surface richer readiness detail in explain/eval first.
- Locked Cards remain outside source-scoped chunk competition, but their presence and freshness may contribute to pack sufficiency.
- Non-locked Cards retain current retrieval semantics unless a later PRD explicitly changes them.
- Current fail-closed confidence remains authoritative for unsupported honesty.
- Readiness verification may lower authority or request follow-up, but it must not override unsupported honesty into confidence.
- Structural assembly from PRD-0008 remains prior art, but this PRD generalizes beyond a narrow stage ladder into need-aware chunk selection.
- Structural neighbors should be chosen because they satisfy a need, not merely because they exist.
- Budget behavior must remain explicit. If a needed chunk is omitted for budget reasons, that omission should be visible in diagnostics.
- The eval harness should add source-correct-vs-chunk-wrong reporting and readiness-state reporting.
- Real-corpus evaluation should explicitly track cases where source selection is acceptable but the chosen chunk set is weak.
- Agent-answer pass and ranked usefulness are the most likely first external metrics to move.
- Query-mode accuracy is still a real problem in the system, but this PRD should not turn into a broad query-compilation rewrite unless a concrete readiness dependency forces it.
- No repo-specific path rules or fixture-id rules may appear in production chunk-selection or readiness logic.
- No neural rerank, embeddings, or LLM-based verifier should be required in this PRD.
- Optional later questioning should be framed as a recovery seam from `partial` or `needs_anchors`, not as a replacement for deterministic retrieval.

## Testing Decisions

- Good tests should verify observable behavior and stable decision surfaces, not private scoring arithmetic.
- Source-scoped chunk selector tests should assert which chunk set is chosen for a task and why, not how an internal helper arrived there.
- Pack readiness verifier tests should assert returned readiness state, satisfied needs, and missing needs for representative task shapes.
- Task-need extractor tests should verify deterministic classification of need shapes from realistic queries and anchors.
- Integration tests should verify that a correct source can still fail due to insufficient chunk selection, so the new eval axis is real.
- Integration tests should verify that improved chunk selection can lift ranked usefulness or agent-answer outcomes without regressing coverage honesty.
- Structural-neighbor tests from the existing assembly groundwork should be reused where they remain valid as prior art.
- Presenter and MCP contract tests should confirm that any new explain/readiness diagnostics remain compatible with current response shape unless an explicit contract change is approved.
- Real-corpus regression tests should remain the primary decision surface for this PRD.
- Synthetic regression stays a hard floor, but it should not be treated as positive evidence that readiness is solved.
- Modules that deserve focused tests are:
  - source-scoped chunk selector
  - task-need extractor
  - pack readiness verifier
  - readiness-aware assembly orchestration
  - eval/report surfaces for chunk-correctness and readiness-state metrics
- Prior art in the codebase includes:
  - structural assembly tests
  - source-rerank and source-selection tests
  - coverage verifier and confidence policy tests
  - real-corpus fixture and report tests
  - MCP presenter, schema, and snapshot tests
- Tests should prefer representative behavioral fixtures such as onboarding, overview, decision/rationale, cross-module boundary, and exact-symbol cases rather than one-off micro-cases that only pin a coefficient.

## Out of Scope

- Replacing the current candidate-generation stack
- Broad source-ranking retuning as the main work
- Dense retrieval
- Embedding-based retrieval or reranking
- LLM-based pack verification
- Public `task_readiness` contract finalization
- Setup initialization redesign
- Broad interactive questioning flows
- Multi-turn orchestration UX
- Repo-specific workaround rules
- Weakening unsupported honesty or fail-closed confidence
- Learned ranking or learned verification

## Further Notes

- The important insight from the last round of experiments is that broad ranking interventions were fragile, while narrow context-preservation interventions were useful. This PRD follows that evidence instead of fighting it.
- The user-experience constraint is load-bearing. ContextTrail should not solve this problem by making the user do deep manual work. The engine should become better at naming what it is missing.
- This PRD is also the cleanest bridge into later iterative retrieval. Once the engine can say which need is missing, a follow-up retrieval or question can be precise instead of generic.
- If this PRD succeeds, the next product question becomes whether to expose internal readiness as a public `task_readiness` contract, not whether retrieval still needs another general-purpose ranking tweak.
