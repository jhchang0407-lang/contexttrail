# PRD-0014: Retrieval Engine V3 source selection and aboutness

> Source-of-truth canonical doc. Intended to be mirrored to the issue tracker as the project's fourteenth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADR: [ADR-0020](../adr/0020-retrieval-engine-v2-source-first-ceiling-probes.md). Related PRDs: [PRD-0010](0010-retrieval-engine-v2-slice-0-ceiling-probes.md), [PRD-0011](0011-confidence-abstention-rework.md), [PRD-0012](0012-source-profile-and-source-rerank.md), [PRD-0013](0013-v2-holdout-hardening-and-fail-closed-retrieval.md).
>
> **Sequencing rule:** this PRD comes after PRD-0013 parked deterministic V2.5 behind a measured ceiling. V2.5 fixed safety, not accuracy: unsupported honesty is now strong, candidate recall is nearly saturated, and the remaining bottleneck is source selection/aboutness. V3 must target the measured source-selection losses directly, not tune V2.5 thresholds.

## Problem Statement

PRD-0013 moved Retrieval Engine V2.5 from an unsafe system to a safe but still materially inaccurate system.

The latest combined report covers 148 cases across bun, drizzle, hono, prisma, ralph, tanstack, trpc, turborepo, vitest, and zod:

| Metric | Result |
|---|---:|
| answerable cases | 122 |
| unsupported cases | 26 |
| critical-source-set recall@50 | 99.2% |
| post-threshold critical recall@50 | 100.0% |
| post-pack critical recall@50 | 99.2% |
| wire top-1 acceptable | 71.3% |
| wire top-3 acceptable | 91.0% |
| false-confident unsupported | 0 |

The holdout verdict is also clean:

| Metric | Holdout Result |
|---|---:|
| answerable cases | 90 |
| unsupported cases | 16 |
| candidate recall@50 | 98.9% |
| wire top-1 | 70.0% |
| wire top-3 | 88.9% |
| unsupported honesty | 100.0% |
| false-confident unsupported | 0 |

The V2.5 ceiling decision is `source_scoring`:

| Failure layer | Cases |
|---|---:|
| none | 106 |
| outside_top50 | 1 |
| display_loss | 13 |
| not_imported | 0 |
| absent_from_candidates | 0 |
| below_threshold | 0 |
| pack_loss | 0 |

This tells us the next problem is not safety, not import coverage, not thresholding, and not budget packing. The engine usually finds the right source, and unsupported cases now fail closed. It still often chooses the wrong source among already visible candidates.

That is dangerous for context assembly. A context assembly request may use several retrievals. If each retrieval has the critical source somewhere in the candidate set but chooses a distracting source for the first read, downstream planning compounds errors while looking superficially grounded.

The current ranking objective is also too weak for assembly. Some cases are counted as top-3 acceptable because a sibling source is useful, while the declared `must_include_sources` entry is absent from displayed top-3. For assembly, "an acceptable nearby source appeared" is not enough. The pack must preserve the critical source set or say it cannot.

The 13 source-selection losses and the single candidate-recall outlier are:

| Case | Intent | Required source | Displayed top sources | Interpretation |
|---|---|---|---|---|
| hono-decision-middleware-design | decision_lookup | docs/concepts/middleware.md | builtin middleware leaves, create guide | parent concept loses to leaf docs |
| ralph-anchored-setup-sync | file_anchored | docs/adr/0004-authored-and-lock-config-split.md | context/glossary and architecture docs | critical ADR missing despite acceptable backstop |
| trpc-unanchored-overview | broad_domain | docs/server/overview.md | client utility and server adapter leaves | server overview loses to leaf implementation docs |
| trpc-unanchored-authorization | broad_domain | docs/server/authorization.md | metadata, procedures, headers | canonical authz doc loses to related mechanisms |
| trpc-decision-rpc-vs-rest | decision_lookup | docs/further/rpc.md | adapters and SSR docs | decision doc loses to procedural docs |
| trpc-cross-module-nextjs | cross_module | docs/server/adapters/nextjs.md | client Next.js starter and adapter siblings | server adapter missing despite acceptable sibling |
| turborepo-anchored-globs | file_anchored | docs/reference/globs.md | configuration/package/task docs | exact reference topic loses to broad reference docs |
| turborepo-unanchored-getting-started | broad_domain | docs/getting-started/installation.md | add-existing plus tool guides | one candidate recall outlier |
| turborepo-decision-package-types | decision_lookup | docs/core-concepts/package-types.md | index, caching, TypeScript guide | concept doc loses to broad/adjacent docs |
| vitest-anchored-cli | file_anchored | docs/guide/cli.md | API/feature/advanced docs | CLI guide loses to broad API docs |
| vitest-unanchored-projects | broad_domain | docs/guide/projects.md | advanced API and config docs | guide loses to config/API references |
| vitest-decision-pool-tradeoffs | decision_lookup | docs/guide/improving-performance.md | pool config and lifecycle docs | acceptable top-3 but critical explanatory guide absent |
| vitest-cross-module-browser-mode | cross_module | docs/guide/browser/index.md | component/why/comparison leaves | browser overview loses to leaf docs |
| zod-unanchored-changelog | broad_domain | packages/docs-v3/CHANGELOG.md | readmes and optionality wiki | release/changelog intent is misread |

The implementation risk is clear: a working agent could treat this as another coefficient pass. That would be the wrong project. V3 must introduce a source-selection primitive that explains why one source is about the task and another source is only adjacent.

## Solution

Build Retrieval Engine V3 as a source-selection/aboutness layer over the V2.5 candidate substrate.

V3 does not replace V2.5. It consumes the V2.5 candidate set, SourceProfiles, multi-path fusion, coverage verifier, and fail-closed confidence policy. Its job is narrower and sharper:

1. Make source-selection losses measurable as first-class failures.
2. Represent top-N candidate sources in a stable, comparable source-card shape.
3. Verify aboutness across top-N candidates, not just coverage on the top source.
4. Select the source or critical-source set that is actually about the task.
5. Preserve selected critical sources through packing and display.
6. Keep unsupported honesty and locked Card semantics untouched.
7. Leave an optional heavier reranker interface behind explicit gates, without making neural or LLM reranking required infrastructure.

The target behavior is:

- If the corpus supports the task and the critical source is in the candidate set, the selected/displayed sources should include the critical source.
- If a sibling source is useful but not sufficient, it may be displayed, but it must not hide the missing `must_include_sources` failure.
- If the top candidates are all adjacent but not actually about the task, the engine should remain uncertain rather than producing a confident wrong pack.
- If a heavier reranker is enabled, it may break close-call ties, but it must not override fail-closed coverage or locked Card guarantees.

### Success Criteria

This PRD ships only when the new source-selection layer clears gates without safety regressions.

| Gate | Required |
|---|---:|
| combined false-confident unsupported | 0 |
| holdout unsupported honesty | 100.0% |
| combined critical-source-set recall@50 | >= current 99.2%, no regression |
| holdout candidate recall@50 | >= current 98.9%, no regression |
| combined wire top-1 acceptable | >= 75.0% |
| combined wire top-3 acceptable | >= 93.8% |
| holdout wire top-1 acceptable | >= 75.0% |
| holdout wire top-3 acceptable | >= 93.8% |
| source-selection display losses | <= 5 |
| `must_include_sources` missing from displayed top-3 | reduced by at least 60% |
| synthetic regression | passed |

### Structural Gates

- No V2.5 threshold-only ship. Every scoring change must map to a named source-selection invariant.
- No repo-specific or fixture-specific rules.
- No expectation weakening. Required sources stay required.
- No hiding must-include failures behind broader `acceptable_top_sources`.
- No confidence regression. Unsupported cases must remain uncertain/empty/unsupported, never confidently wrong.
- No locked Card regression. Locked Cards still bypass source selection and remain guaranteed-included.
- No MCP contract churn unless a separate decision approves it.
- No always-on neural/LLM dependency in this PRD.

### Deep Modules

V3 should be implemented through deep modules with narrow interfaces, not scattered ranking heuristics.

1. **Source-selection eval harness**
   - Computes `must_include_top3`, source-selection loss type, full top-N source movement, pairwise expected-vs-winner diagnostics, and source-selection gates.
   - Treats acceptable top-3 and critical-source coverage as separate facts.

2. **Source card builder**
   - Converts each top-N source candidate into a stable comparable record.
   - Includes source identity, SourceProfile signals, intent, candidate-path contributions, top chunk evidence, coverage decision, token coverage, source purpose, source role, and relationship hints.
   - Does not become a Context Object and is never cited as authority.

3. **Source relationship classifier**
   - Classifies candidate relationships that matter for source choice: parent vs leaf, overview vs topic guide, guide vs API/config reference, decision source vs procedural source, release/changelog vs migration/readme, and exact topic vs broad container.
   - Uses deterministic source metadata and path/title/heading structure.

4. **Top-N aboutness verifier**
   - Runs across candidate sources, not only the first source.
   - Emits whether each candidate `covers`, is `partial`, is an `adjacent_distractor`, is `too_broad`, is `too_narrow`, or is `unsupported`.
   - Produces structured reason codes that can be ablated and tested.

5. **Source selection decision**
   - Chooses selected sources from the top-N source-card set.
   - Emits selected source ranks, reason codes, score/margin diagnostics, critical-source preservation status, and fail-closed status.
   - Has a deterministic default path.

6. **Optional rerank adapter**
   - Allows a local cross-encoder or LLM pairwise reranker to compare close-call source cards only when explicitly enabled.
   - Returns structured preferences and reasons.
   - Is measured as an ablation and cannot be required for the default deterministic floor.

7. **Pack/display integration**
   - Feeds source selection rank into chunk selection, packing, and rendered ranked order.
   - Ensures one chunk from each selected critical source is preserved when budget allows.
   - Keeps Cards, locked-include, and confidence policy behavior unchanged.

## User Stories

1. As a ContextTrail maintainer, I want V3 to target the measured V2.5 `source_scoring` bottleneck, so that the work solves the actual remaining failure mode.
2. As a ContextTrail maintainer, I want the PRD to forbid threshold-only V2.5 tuning, so that implementation energy goes into source-selection primitives.
3. As a ContextTrail maintainer, I want source-selection failures reported separately from candidate recall, threshold, pack, and display failures, so that future agents can see where the engine is failing.
4. As a ContextTrail maintainer, I want `must_include_sources` coverage measured independently from `acceptable_top_sources`, so that useful sibling docs do not hide missing critical sources.
5. As a ContextTrail maintainer, I want a `must_include_top3` metric, so that context assembly can judge whether the critical source set survived into the visible pack.
6. As a ContextTrail maintainer, I want the 13 V2.5 display/source-selection losses carried into V3 diagnostics, so that improvements are tied to known loss modes.
7. As a ContextTrail maintainer, I want the single outside-top-50 case tracked but not allowed to dominate V3, so that one recall outlier does not distract from the larger source-selection problem.
8. As a ContextTrail maintainer, I want every top-N source candidate represented as a comparable source card, so that deterministic and optional heavier rerankers consume the same evidence shape.
9. As a ContextTrail maintainer, I want source cards to include SourceProfile data, so that source selection can use title, H1, purpose, role, headings, aliases, questions, and intro evidence.
10. As a ContextTrail maintainer, I want source cards to include candidate-path contributions, so that independent agreement is visible and testable.
11. As a ContextTrail maintainer, I want source cards to include top chunk evidence, so that source-level decisions remain grounded in citable Doc Chunks.
12. As a ContextTrail maintainer, I want source cards to stay rebuildable metadata, so that final Context Packs still cite Doc Chunks and Cards only.
13. As a ContextTrail maintainer, I want top-N aboutness verification, so that the engine can compare the best candidate with nearby alternatives rather than trusting the current top source.
14. As a ContextTrail maintainer, I want candidate sources labeled as covering, partial, adjacent, too broad, too narrow, or unsupported, so that source-selection errors become debuggable.
15. As a ContextTrail maintainer, I want parent overview docs to compete correctly against leaf docs, so that middleware, server overview, browser mode, and similar first-read sources are not buried by narrow subpages.
16. As a ContextTrail maintainer, I want decision and rationale docs to beat procedural or adapter docs for decision queries, so that tradeoff questions get explanatory sources.
17. As a ContextTrail maintainer, I want anchored file/topic queries to prefer the exact source that owns the topic, so that broad reference pages do not crowd out the declared source.
18. As a ContextTrail maintainer, I want release/changelog intent recognized, so that changelog queries do not get misclassified as generic broad-domain queries.
19. As a ContextTrail maintainer, I want source role and source purpose used separately, so that authority and document format do not collapse into one score.
20. As a ContextTrail maintainer, I want source granularity represented, so that concise topic docs can beat sprawling docs when both mention the query terms.
21. As a ContextTrail maintainer, I want path hierarchy used as a general structural signal, so that parent/child/sibling relationships are available without repo-specific rules.
22. As a ContextTrail maintainer, I want exact alias, title, heading, and intro matches separated, so that a body mention does not look as strong as source-level aboutness.
23. As a ContextTrail maintainer, I want source selection to preserve selected critical sources through packing, so that a correct source decision is not lost before display.
24. As a ContextTrail maintainer, I want the display order to reflect selected source relevance, so that the user sees the source the engine actually believes is the best first read.
25. As a ContextTrail maintainer, I want selected source chunks to remain budget-aware, so that preserving a source does not silently break Context Pack size guarantees.
26. As a ContextTrail maintainer, I want fail-closed confidence to remain authoritative, so that better ranking cannot reintroduce confident unsupported cases.
27. As a ContextTrail maintainer, I want unsupported and signal-empty cases to stay in the eval, so that source-selection work cannot regress abstention.
28. As a ContextTrail maintainer, I want optional heavier reranking behind a flag, so that we can measure precision gains without making model access required.
29. As a ContextTrail maintainer, I want optional pairwise rerank to consume source cards, so that deterministic and model-assisted paths stay comparable.
30. As a ContextTrail maintainer, I want optional rerank limited to close calls, so that cost and nondeterminism do not spread across ordinary retrieval.
31. As a ContextTrail maintainer, I want optional rerank results logged as an ablation, so that a model-assisted gain cannot be confused with deterministic floor movement.
32. As a ContextTrail maintainer, I want no learned ranking training in this PRD, so that a 148-case panel does not become an overfit model.
33. As a future learning-to-rank implementer, I want source-selection features shaped like stable feature vectors, so that future training can reuse judged examples.
34. As a context assembly user, I want critical sources in the displayed top-3, so that an agent starts from the right project knowledge.
35. As a context assembly user, I want overview and concept sources when asking first-read questions, so that the pack starts at the right abstraction level.
36. As a context assembly user, I want leaf/API/config sources when asking exact implementation questions, so that the pack is specific when specificity is needed.
37. As a context assembly user, I want decision/rationale sources for tradeoff questions, so that the pack explains why a path exists rather than only how to call an API.
38. As an agent consuming `retrieve_context_pack`, I want missing critical sources to be visible in diagnostics, so that I can ask for anchors or broaden the search before acting.
39. As an agent consuming `retrieve_context_pack`, I want source-selection reasons in explain output, so that I can understand whether a top source is canonical or merely adjacent.
40. As a ContextTrail maintainer, I want source-selection ablations grouped by intent and repo, so that improvements generalize across documentation shapes.
41. As a ContextTrail maintainer, I want README-heavy, API-heavy, guide-heavy, and mixed-doc corpora to remain visible in reports, so that one doc shape cannot hide another doc shape's failures.
42. As a ContextTrail maintainer, I want synthetic regression to remain a hard gate, so that source-selection work does not destabilize the smaller deterministic fixture.
43. As a ContextTrail maintainer, I want locked Cards to remain outside source selection, so that accepted operational knowledge is never demoted by a source reranker.
44. As a ContextTrail maintainer, I want non-locked Cards to keep current ranking semantics, so that doc source selection does not rewrite the Cards contract.
45. As a working agent, I want the PRD to name the modules, loss cases, gates, and non-goals, so that I can build robustly without asking the user to re-explain the session.

## Implementation Decisions

- This is Retrieval Engine V3, not another V2.5 hardening slice.
- V3 consumes the V2.5 candidate substrate. It should not rebuild import coverage, basic candidate generation, or fail-closed confidence as its first move.
- The primary work is source selection/aboutness over an already high-recall candidate set.
- The first implementation slice must be eval-first: add source-selection diagnostics and gates before production ranking behavior changes.
- The eval must distinguish `acceptable_top_sources` from `must_include_sources`.
- The eval must report whether every required source reached displayed top-3.
- The eval must classify source-selection losses with stable categories, including parent-vs-leaf, decision-vs-procedural, anchored-exact-vs-broad, overview-vs-reference, adjacent-sibling, changelog/release-intent, and candidate-recall-outlier.
- The eval should persist enough top-N source data to debug why the expected source lost, not only the final displayed top-3.
- The source card builder is a deep module. Its public interface should take a query, intent, candidate source, source profile, top chunk evidence, candidate-path evidence, and coverage evidence, then return a stable source-card record.
- Source cards are retrieval metadata, not Context Objects.
- Source cards must not be cited as final authority.
- Source cards should be serializable in eval and explain output so failing cases are inspectable.
- The source relationship classifier is a deep module. It should infer general relationships from source metadata and hierarchy rather than from repo-specific paths.
- The top-N aboutness verifier is a deep module. It should score or classify each candidate source against the query and produce structured reasons.
- The source selection decision is a deep module. It should consume source cards and verifier outputs, then return selected source order, reason codes, margins, and fail-closed status.
- Source selection should run before chunk packing/display ordering for doc chunks.
- Source selection must preserve Card behavior: locked Cards bypass selection; non-locked Cards keep existing Card ranking semantics unless a future PRD explicitly changes them.
- Source selection should initially remain deterministic.
- A pairwise rerank adapter may be introduced only behind an explicit flag and only as an ablation layer.
- Optional pairwise rerank must compare source cards, not raw full documents.
- Optional pairwise rerank must be close-call scoped. It should not run on every source for every retrieval.
- Optional pairwise rerank must not override unsupported, partial, or needs-anchors confidence into confident.
- Optional pairwise rerank must not become a ship requirement for the deterministic V3 floor.
- No learned ranker should be trained in this PRD.
- No generated source summaries or generated questions should become required index-time fields in this PRD.
- No source path, repo name, or fixture id may appear in production ranking logic.
- Weight changes are allowed only when attached to a named source-selection invariant and ablated.
- Display/packing integration should preserve at least one chunk from each selected critical source when budget permits.
- If budget prevents preservation of a selected critical source, the omission must be visible as a coverage or readiness diagnostic.
- Confidence policy remains fail-closed. Source-selection improvements must not make unsupported cases confident.
- The public MCP schema should remain stable unless a separate decision approves a new field.
- Explain/eval diagnostics may add internal fields for source cards, source-selection reasons, and selection decisions.
- The one outside-top-50 case should be tracked as a candidate recall outlier, but V3 should not start by overfitting candidate generation to it.
- If after source selection the 13 display/source-selection losses do not fall meaningfully, the next PRD should consider heavier reranking or expanded judged labels, not more deterministic coefficient passes.

## Testing Decisions

- Good tests should verify observable source-selection behavior, not private arithmetic.
- Tests should pin source-selection invariants by scenario class rather than fixture id.
- The source-selection eval harness should have tests for `must_include_top3`, acceptable-vs-required separation, failure-layer classification, and top-N source diagnostics.
- The source card builder should have tests for stable serialization, query-token evidence, SourceProfile evidence, candidate-path evidence, top chunk evidence, coverage evidence, and missing-profile behavior.
- The source relationship classifier should have tests for parent-vs-leaf, overview-vs-leaf, guide-vs-reference, decision-vs-procedural, changelog/release intent, and broad-container-vs-specific-topic relationships.
- The top-N aboutness verifier should have tests that classify covering, partial, adjacent, too broad, too narrow, and unsupported candidates.
- The source selection decision module should have tests for choosing a critical source over an adjacent sibling, choosing a decision source over a procedural source, choosing an exact anchored topic over a broad reference, preserving changelog/release sources when the query asks for changes, and failing closed when all candidates are weak.
- Integration tests should verify that selected source order influences doc chunk packing/display without changing locked Card behavior.
- Integration tests should verify that non-locked Cards keep current ranking semantics.
- Confidence regression tests should verify unsupported cases remain non-confident after V3 source-selection changes.
- Real-corpus regression should run combined, dev, and holdout panels and enforce the V3 gates.
- Ablation tests should compare V2.5 baseline, deterministic V3 source selection, and optional pairwise rerank when enabled.
- Synthetic regression should remain a required gate for every implementation slice.
- Snapshot updates are acceptable only when source-selection reasons explain the movement.
- Prior art exists in the current source-rerank tests, fused source-candidate tests, coverage-verifier tests, confidence-policy tests, Slice 0 report tests, failure-layer tests, ablation tests, and real-corpus eval runner.

## Out of Scope

- More V2.5 threshold tweaking as a ship strategy.
- Repo-specific source path rules.
- Weakening expected sources, acceptable sources, or unsupported labels.
- Changing locked Card inclusion semantics.
- Changing non-locked Card type-bias semantics.
- Rebuilding the import surface as the primary V3 task.
- Dense retrieval as required infrastructure.
- Always-on cross-encoder reranking.
- Always-on LLM reranking.
- Learning-to-rank training.
- Index-time LLM summaries or generated questions as required fields.
- New authoritative Context Object kinds.
- Public MCP schema changes unless separately approved.
- Full context assembly redesign.
- Task execution or answer generation changes.

## Further Notes

The safest implementation order is:

1. Add source-selection diagnostics and gates.
2. Build source cards.
3. Build deterministic top-N aboutness verification.
4. Build deterministic source selection decision.
5. Integrate selected source order into pack/display.
6. Run real-corpus and synthetic gates.
7. Only then evaluate optional pairwise rerank as an ablation.

Working agents should treat the V2.5 report as the acceptance fixture, not as a tuning surface. The goal is to reduce a class of source-selection losses while preserving recall and abstention floors.

ADR-0020 already permits this source-first path. A new ADR is only needed if implementation decides to make a boundary change such as required model access, required embeddings, generated index metadata, a public MCP schema change, or changed Card semantics.
