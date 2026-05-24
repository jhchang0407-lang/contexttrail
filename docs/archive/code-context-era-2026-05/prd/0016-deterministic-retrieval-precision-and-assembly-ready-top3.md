# PRD-0016: Deterministic retrieval precision and assembly-ready top-3

> Source-of-truth canonical doc. Intended to be mirrored to the issue tracker as the project's sixteenth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADRs: [ADR-0020](../adr/0020-retrieval-engine-v2-source-first-ceiling-probes.md), [ADR-0015](../adr/0015-task-readiness-gates-authority-not-access.md), [ADR-0007](../adr/0007-hybrid-scoring-additive-text-multiplicative-structure.md). Related PRDs: [PRD-0012](0012-source-profile-and-source-rerank.md), [PRD-0014](0014-retrieval-engine-v3-source-selection-and-aboutness.md), [PRD-0015](0015-source-scoped-chunk-selection-and-pack-readiness.md).
>
> **Sequencing rule:** this PRD comes after PRD-0015 proved that source-scoped chunk selection can improve internal sufficiency diagnostics, but broad reranking experiments did not move top-line accuracy. PRD-0016 must separate metrics first, then improve deterministic precision through explicit retrieval primitives. It must not become another coefficient-tuning pass.

## Problem Statement

ContextTrail's retrieval engine is now in an awkward but promising state.

The latest real-corpus eval covers 148 cases across bun, drizzle, hono, prisma, ralph, tanstack, trpc, turborepo, vitest, and zod.

The headline metrics are:

| Metric | Result |
|---|---:|
| combined top-1 acceptable | 131/148 |
| combined ranked useful | 118/148 |
| query mode correct | 107/148 |
| coverage honest | 148/148 |
| agent answer pass | 147/148 |
| chunk correct, scored subset | 3/3 |

Those numbers are easy to misread. `top1Acceptable` currently mixes two different concepts:

- answer-bearing top-1 retrieval quality
- signal-empty honesty for unsupported cases

`rankedUseful` is closer to top-3 source usefulness, but it does not count signal-empty honesty the same way.

When the eval is split correctly, the shape is:

| Metric | Result |
|---|---:|
| answer-bearing cases | 122 |
| answer top-1 | 105/122 = 86.1% |
| answer top-3 | 118/122 = 96.7% |
| signal-empty cases | 26 |
| signal-empty coverage honest | 26/26 = 100.0% |
| true answer-bearing top-3 misses | 4 |
| top-3 hit but top-1 miss | 13 |

This means the engine usually finds the truth, but often does not put it first.

That is a different problem from early retrieval. Candidate recall and top-3 answer recall are strong enough to be meaningful. But top-1 precision is still too low for compact deterministic Context Packs, and compactness matters:

- Smaller packs reduce agent distraction.
- First-ranked context strongly shapes model behavior.
- Context assembly should not need to compensate for avoidable first-position errors.
- Future LLM reranking is allowed, but the deterministic floor should be strong enough to stand on its own.

Recent reverted attempts showed that broad changes are dangerous:

| Attempt | Hypothesis | Result |
|---|---|---:|
| V5.8 | Apply V3 selection when V3 differs from V2.5 by coverage/rank | 131 -> 112 |
| V5.9 | Trust file/symbol anchor intent for intent-only recognition | 131 -> 130 |
| V5.11 | Treat `index.md` as directory-level parent | 131 -> 121 |
| V5.12 | Narrower V3 apply gate | 131 -> 116 |

Those failures are useful evidence. The remaining work is not "try another global boost." The engine needs explicit deterministic modules for the situations where top-3 contains truth but top-1 chooses an adjacent, broader, narrower, or incidental source.

The current product gap is:

> ContextTrail has strong answer-bearing top-3 retrieval, but top-1 precision is not yet good enough for compact assembly. The engine needs deterministic, inspectable source precision primitives that can turn top-3 truth into top-1 truth without damaging unsupported honesty or increasing setup burden.

## Solution

Build a deterministic precision layer over the existing source-first retrieval architecture.

This PRD introduces six connected capabilities:

1. **Metric split and failure taxonomy**
2. **Phrase and proximity scoring**
3. **Source role and canonicality modeling**
4. **Source-family clustering**
5. **Pairwise source adjudication**
6. **Ambiguity-aware packing**

These capabilities should build on the current substrate:

- SourceProfiles
- SourceCards
- source-first candidate generation
- source rerank
- source selection and aboutness
- source-scoped chunk selection
- pack readiness diagnostics
- coverage honesty and fail-closed signal-empty behavior

The intended behavior is:

- If the right answer source is in top-3, the engine should usually promote it to top-1 through a deterministic pairwise decision.
- If a source is adjacent but not answer-shaped, the engine should label it as adjacent rather than silently rewarding it.
- If several top candidates are genuinely plausible and related, the pack should include them compactly instead of pretending certainty.
- If the corpus does not support the task, the engine should remain honest.
- If setup or source metadata is incomplete, the engine should degrade gracefully without demanding deep manual curation from the user.

This PRD does not require LLM or embedding reranking. It should leave room for those as later optional adapters, but the default path remains deterministic.

### Success Criteria

This PRD ships only when deterministic precision improves without safety regression.

| Gate | Required |
|---|---:|
| answer top-1 | improve from 105/122 to at least 112/122 |
| answer top-3 | remain at least 118/122 |
| true answer-bearing top-3 misses | reduce from 4 to at most 2 |
| top-3 hit but top-1 miss | reduce from 13 to at most 6 |
| signal-empty coverage honest | remain 26/26 |
| combined coverage honest | remain 148/148 |
| agent answer pass | remain at least 147/148 |
| query mode correct | no regression from 107/148 |
| chunk correctness, scored subset | remain 3/3 or improve as more scored cases are added |
| payload size | no material average increase without explicit pack-readiness benefit |
| synthetic regression | passed |

### Structural Gates

- No repo-specific rules.
- No expectation weakening.
- No default LLM dependency.
- No default embedding dependency.
- No broad coefficient pass without a named failure class and ablation.
- No manual setup burden beyond existing lightweight source import and profiles.
- No top-1 improvement that hides top-3 recall or signal-empty honesty regression.
- No context pack bloat accepted as a substitute for better precision.
- No public MCP response-shape expansion unless separately approved.
- No feature that requires users to hand-label document roles before ordinary retrieval works.

### Deep Modules

1. **Retrieval metric splitter**
   - Separates answer-bearing retrieval quality from signal-empty honesty.
   - Reports answer top-1, answer top-3, MRR, top-3 miss count, top-3-hit/top-1-miss count, signal-empty honesty, and combined pass metrics.
   - Makes the eval readable enough that future work does not optimize a mixed metric by accident.

2. **Failure taxonomy classifier**
   - Classifies misses into true recall miss, top-3 ordering miss, canonicality miss, source-role miss, phrase/proximity miss, source-family miss, query-mode miss, and pack-shape miss.
   - Emits stable reason codes in reports.
   - Gives each implementation slice a measurable target.

3. **Phrase and proximity feature extractor**
   - Detects exact phrases, near phrases, ordered token windows, source-title phrase hits, heading phrase hits, path phrase hits, and body-only phrase hits.
   - Treats source-level phrase evidence as stronger than scattered body density.
   - Handles filename/topic forms such as `browser mode`, `error handling`, `eslint plugin`, `shadow database`, `router`, `snapshot`, and `typescript`.

4. **Source role and canonicality classifier**
   - Classifies sources by deterministic metadata and structure: overview, guide, reference, API, config, concept, decision, changelog, migration, troubleshooting, example, child detail, parent container.
   - Infers roles from path, title, H1, headings, and SourceProfile fields.
   - Produces confidence and provenance so uncertain roles do not overrule stronger evidence.

5. **Source-family graph**
   - Groups related sources into families using path hierarchy, index/overview relationships, basename relationships, linked references, title similarity, and shared source-profile aliases.
   - Distinguishes parent, child, sibling, and cousin relationships.
   - Allows assembly to include a compact family pack when top candidates are related and ambiguous.

6. **Pairwise source adjudicator**
   - Compares two top candidate sources for a specific task and query intent.
   - Uses phrase/proximity, source role, canonicality, family relationship, source aboutness, anchor provenance, task need, and coverage evidence.
   - Emits a deterministic winner, confidence, margin, and reason codes.
   - Runs only on bounded top-N candidates and close-call pairs.

7. **Ambiguity-aware pack planner**
   - Uses adjudicator output and source-family data to decide when to trust top-1 and when to include a compact top-3 family.
   - Keeps the pack small by preferring one strong chunk per family member before adding lower-value detail.
   - Feeds pack readiness so ambiguity is visible rather than hidden.

8. **Precision eval harness**
   - Tracks the 4 true top-3 misses and 13 top-3-hit/top-1-miss cases as named cohorts.
   - Adds MRR and source-family coverage.
   - Supports slice-by-slice gates so accepted changes are committed only when metrics improve without safety regression.

## User Stories

1. As a ContextTrail maintainer, I want answer retrieval and signal-empty honesty reported separately, so that I can understand whether retrieval is finding truth or merely abstaining honestly.
2. As a ContextTrail maintainer, I want answer top-1, answer top-3, and MRR in the real-corpus report, so that ranking quality is measured without metric mixing.
3. As a ContextTrail maintainer, I want top-3 misses listed separately from top-3-hit/top-1-miss cases, so that recall work and ordering work do not get conflated.
4. As a ContextTrail maintainer, I want signal-empty honesty to remain visible as its own safety metric, so that safety cannot be traded away for top-1 wins.
5. As a ContextTrail maintainer, I want the engine to preserve answer top-3 while improving top-1, so that precision work does not damage recall.
6. As a ContextTrail maintainer, I want the 4 true answer-bearing top-3 misses treated as recall failures, so that the engine learns where candidate discovery is still insufficient.
7. As a ContextTrail maintainer, I want the 13 top-3-hit/top-1-miss cases treated as ordering failures, so that we target the actual precision bottleneck.
8. As a ContextTrail maintainer, I want phrase and proximity scoring, so that exact concepts such as `browser mode`, `shadow database`, and `error handling` beat scattered term density.
9. As a ContextTrail maintainer, I want phrase hits in titles and headings to be stronger than phrase hits in bodies, so that source aboutness wins over incidental mention frequency.
10. As a ContextTrail maintainer, I want near-phrase windows to matter, so that relevant docs still win when wording varies slightly.
11. As a ContextTrail maintainer, I want path phrase matches to be exposed separately, so that canonical files can be recognized without treating every body mention as equal.
12. As a ContextTrail maintainer, I want phrase/proximity features to be deterministic and explainable, so that every promotion can be debugged.
13. As a ContextTrail maintainer, I want source role classification, so that an overview task can prefer an overview and an API task can prefer an API reference.
14. As a ContextTrail maintainer, I want source role confidence, so that inferred roles do not become hard truth.
15. As a ContextTrail maintainer, I want canonicality modeled explicitly, so that parent guides and concept docs can beat narrow child pages when the task calls for a first-read source.
16. As a ContextTrail maintainer, I want child-detail pages to remain eligible for exact tasks, so that canonicality does not become a blunt parent-page boost.
17. As a ContextTrail maintainer, I want changelog and release sources recognized, so that release-intent queries do not drift into generic README or migration docs.
18. As a ContextTrail maintainer, I want decision and concept sources recognized, so that why/tradeoff questions get explanatory sources instead of procedural leaves.
19. As a ContextTrail maintainer, I want source families, so that related top-3 results can be assembled as a compact unit instead of fought over as isolated chunks.
20. As a ContextTrail maintainer, I want parent/child/sibling relationships represented, so that `mocking.md` and `mocking/modules.md` are understood as related but not equivalent.
21. As a ContextTrail maintainer, I want source-family grouping to be deterministic, so that family membership is inspectable and testable.
22. As a ContextTrail maintainer, I want source-family grouping to use existing path and SourceProfile data, so that users do not need to hand-maintain family metadata.
23. As a ContextTrail maintainer, I want a pairwise source adjudicator, so that close-call ranking is handled by an explicit comparator rather than a global score tweak.
24. As a ContextTrail maintainer, I want the adjudicator to compare answer shape, not only lexical strength, so that adjacent docs stop winning because they mention more terms.
25. As a ContextTrail maintainer, I want adjudicator decisions to emit reason codes, so that a wrong top-1 can be fixed by understanding the evidence, not by guessing weights.
26. As a ContextTrail maintainer, I want the adjudicator bounded to top candidates, so that precision work does not add unbounded cost.
27. As a ContextTrail maintainer, I want the adjudicator to run only when useful, so that obvious wins remain simple.
28. As a ContextTrail maintainer, I want ambiguity-aware packing, so that the engine includes multiple compact sources when the top candidates are genuinely close and related.
29. As a ContextTrail maintainer, I want ambiguity to lower confidence or readiness when appropriate, so that the engine does not pretend a close call is certain.
30. As a ContextTrail maintainer, I want ambiguity-aware packs to stay small, so that top-3 usefulness does not become context bloat.
31. As a ContextTrail maintainer, I want one representative chunk per selected family member before extra detail chunks, so that compact packs preserve source coverage.
32. As a ContextTrail maintainer, I want pack readiness to consume ambiguity diagnostics, so that readiness reflects unresolved source choice.
33. As a ContextTrail maintainer, I want setup burden to stay low, so that users do not need to classify every doc manually.
34. As a ContextTrail maintainer, I want optional source-profile hints to improve precision when available, so that better setup helps without being mandatory.
35. As a ContextTrail maintainer, I want LLM rerank left as a future optional adapter, so that deterministic retrieval remains the product floor.
36. As a ContextTrail maintainer, I want embedding rerank left as a future optional adapter, so that native dependencies and model access are not required for correctness.
37. As a future LLM-rerank implementer, I want the deterministic adjudicator's feature shape to be reusable, so that model-assisted rerank can compare the same source evidence.
38. As a future learning-to-rank implementer, I want pairwise judgments and feature traces stored in eval output, so that a later model can train on stable examples.
39. As an agent consuming a Context Pack, I want the top entry to be the most answer-shaped source, so that I start from the right document.
40. As an agent consuming a Context Pack, I want related supporting sources included only when they add useful coverage, so that I am not distracted by a large pack.
41. As an agent consuming a Context Pack, I want the engine to admit ambiguity, so that I can ask a follow-up question instead of acting on a false top-1.
42. As a user, I want the engine to work without deep manual setup, so that retrieval improves adoption rather than creating a documentation labeling project.
43. As a user, I want the engine to ask questions only when uncertainty is real and actionable, so that clarification feels useful rather than tedious.
44. As a user, I want top-3 truth to matter, so that the engine can still answer when the world is ambiguous.
45. As a user, I want top-1 truth to improve, so that small packs are trustworthy enough for routine coding work.
46. As a maintainer reviewing a regression, I want reports to show which precision primitive moved a case, so that accepted changes are attributable.
47. As a maintainer reviewing an improvement, I want reports to show whether a top-1 win came from phrase evidence, source role, family structure, or pairwise adjudication, so that future work can build on the right layer.
48. As a maintainer reviewing a failed slice, I want the eval to prove whether the failure was recall, ordering, safety, query-mode, or pack shape, so that failed work still teaches us something.

## Implementation Decisions

- PRD-0016 is a deterministic retrieval precision PRD, not a context assembly PRD and not a model-rerank PRD.
- The first slice must fix metric reporting before production ranking behavior changes.
- The eval report must split answer-bearing quality from signal-empty honesty.
- `rankedUseful` should either be renamed or supplemented with an explicit answer top-3 metric.
- MRR should be added for answer-bearing cases.
- Top-3 miss and top-3-hit/top-1-miss cohorts should be listed in every real-corpus report.
- Each production slice must target a named failure cohort.
- Phrase/proximity features should be calculated as structured features, not hidden inside ad hoc score math.
- Phrase/proximity should distinguish title, H1, heading, path, intro, and body evidence.
- Source role should be inferred from deterministic metadata and structure.
- Source role inference must carry provenance and confidence.
- Source role inference must not require manual labels for ordinary retrieval.
- Source-family clustering should use path hierarchy, source profile links, title similarity, heading relationships, and known index/overview conventions.
- Source-family clustering should expose parent, child, sibling, and cousin relationships.
- Pairwise adjudication should consume feature records, not raw strings.
- Pairwise adjudication should emit winner, confidence, margin, and reason codes.
- Pairwise adjudication should be bounded to top-N and close-call scenarios.
- Ambiguity-aware packing should not blindly include all top-3 entries.
- Ambiguity-aware packing should include a compact family set only when the candidates are related or independently necessary.
- Pack readiness should consume ambiguity and family coverage diagnostics when available.
- Accepted slices must pass focused tests, full tests, typecheck, and real-corpus gates.
- A slice may be accepted when answer top-1 improves with no safety regression, or when top-1 is unchanged but a targeted cohort improves with no safety regression.
- A slice must not be accepted if signal-empty honesty or coverage honesty regresses.

## Testing Decisions

- Tests should focus on observable behavior and stable module outputs, not incidental implementation details.
- The metric splitter needs unit tests that prove top-1, top-3, MRR, and signal-empty honesty cannot be mixed accidentally.
- The failure taxonomy classifier needs fixture tests for recall miss, ordering miss, source-role miss, canonicality miss, phrase/proximity miss, source-family miss, query-mode miss, and pack-shape miss.
- Phrase/proximity needs synthetic probes for exact phrase, near phrase, scattered terms, title phrase, heading phrase, path phrase, intro phrase, and body-only phrase.
- Source role needs synthetic probes for overview, guide, reference, API, config, concept, decision, changelog, migration, troubleshooting, example, child detail, and parent container.
- Source-family clustering needs synthetic probes for parent/child/sibling/cousin relationships.
- Pairwise adjudication needs focused tests for known top-3-hit/top-1-miss patterns:
  - parent overview vs child detail
  - canonical guide vs API reference
  - decision/concept vs procedural leaf
  - exact path/title phrase vs body-density distractor
  - changelog/release source vs README or migration source
- Ambiguity-aware packing needs tests showing that related close-call sources are compactly retained, while unrelated noise is not added.
- Real-corpus reporting must include answer top-1, answer top-3, MRR, signal-empty honesty, top-3 misses, top-3-hit/top-1-miss cases, and cohort deltas.
- The real-corpus gate must be run after every accepted slice.
- Full synthetic regression must remain part of the gate.
- Snapshot updates are acceptable only when they reflect intentional wire or ordering changes and are reviewed against the PRD's success criteria.

## Out of Scope

- Making LLM reranking part of the default path.
- Making embedding reranking part of the default path.
- Training a learned ranking model on the current 148-case corpus.
- Requiring users to hand-label document roles before retrieval works.
- Adding repo-specific exceptions.
- Weakening `expected_top_source`, `acceptable_top_sources`, or `must_include_sources`.
- Hiding signal-empty failures inside answer-bearing metrics.
- Replacing SourceProfiles, source rerank, or source selection wholesale.
- Shipping a public `task_readiness` contract expansion.
- Treating larger packs as success without compactness and readiness evidence.

## Further Notes

The important strategic lesson is that top-3 truth is real product signal. On answer-bearing cases, ContextTrail is already at 118/122 top-3. That means deterministic retrieval is not hopeless, and context assembly can use top-3 when ambiguity is genuine.

The equally important warning is that top-1 is still not good enough. A compact pack wants the first source to be right most of the time. The next improvements should therefore be architectural and diagnostic, not broad weight tuning.

This PRD should be implemented in small eval-gated slices. Each accepted slice should say which cohort moved and whether it improved answer top-1, answer top-3, MRR, signal-empty honesty, or pack compactness.
