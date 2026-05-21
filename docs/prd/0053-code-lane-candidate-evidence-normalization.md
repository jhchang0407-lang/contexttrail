# PRD-0053: Code-Lane Candidate Evidence Normalization

> Source-of-truth canonical doc. Intended to be mirrored to Linear after review.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md) -- see `Context Pack`, `pack entry`, `context assembly`, `code-source index`, `import graph`, `persistence substrate`, `support necessity`, `critical-source recall`, `retrieval request`, `retrieval run`, and `retrieval pipeline`.
>
> Governing ADRs: [ADR-0023](../adr/0023-chunk-first-code-retrieval-with-file-graph-late-augmentation.md), [ADR-0024](../adr/0024-code-must-compete-inside-the-core-pack-authority.md), [ADR-0025](../adr/0025-code-navigation-fields-and-get-code-chunk-are-first-class-mcp-contract.md), and [ADR-0026](../adr/0026-persistence-substrate-family-evidence.md).
>
> Predecessor PRDs: [PRD-0051](0051-oss-code-lane-corpus-accuracy-improvement-plan.md) and [PRD-0052](0052-code-lane-method-integration-tightening.md).
>
> Boundary rule: this PRD normalizes and reports evidence from existing code-lane methods. It does not add a new retrieval source, does not promote broad non-dotted facets by default, and does not change release gates. The full OSS code-lane corpus remains the promotion benchmark.

## Problem Statement

The code lane now has several useful methods, but they still do not speak one common evidence language.

Current runtime behavior includes chunk FTS, source-facts FTS, exact-symbol fallback, path fallback, dotted query facets, file-level fusion, import graph support, code family evidence, support cluster admission, passive artifact filtering, and first-slate ordering. PRD-0052 added an explicit method-admission gate so dotted-identity facets can stay active while conventional-scope and code-identifier facets remain shadowed.

That was necessary, but not sufficient. The method-admission gate currently receives too little normalized evidence to safely answer the next question: when should a non-dotted facet, a path hint, a source-facts hit, or a family relationship be allowed to move a file into the first code slate?

The failure mode is visible in the eval history:

- Narrow dotted facets preserved the accepted full-corpus baseline: `4607 / 7360` prompt top-3 (`62.6%`).
- Broad facets looked good on smoke, but regressed the full corpus to `4475 / 7360` prompt top-3 (`60.8%`).
- An over-strict PRD-0052 admission variant regressed to `4588 / 7360` prompt top-3 (`62.3%`) before the full corpus caught it.

These failures were not caused by a lack of intuition. They were caused by a lack of structured, comparable, per-candidate evidence. The mixer knows scores, channels, priorities, source-fact coverage, and support-cluster details, but those signals are still scattered across local heuristics. A future agent trying to promote conventional-scope facets has to reconstruct "independent evidence" from private score math and channel ordering. That is exactly the confusion PRD-0052 warned against.

From the user's perspective, the next improvement should make the code lane inspectable and promotable without guessing. If a file enters the first slate, the engine should be able to say what evidence families agreed on it. If a file stays shadowed, the engine should be able to say which signal was missing. If a method improves recall but damages top-3, the eval should show where that happened.

Evidence normalization is therefore the next candidate. It is not expected to produce a large immediate accuracy jump by itself. Its job is to turn the existing method mix into a stable substrate for safe multi-signal promotion.

## Solution

Create a candidate evidence normalization layer for the code lane.

The layer should collect evidence emitted by existing candidate methods and normalize it into a small, stable, testable record that can be consumed by method admission, first-slate arbitration, support-cluster admission, and eval diagnostics.

The normalized evidence model should answer five questions for each candidate file:

1. **Who is the candidate?** The source identity and best actionable code chunk.
2. **Which method families found it?** Chunk text, source facts, exact symbol, path identity, query facet, import graph, code family evidence, or support cluster.
3. **What kind of evidence is it?** Owner evidence, support evidence, passive artifact evidence, anchor evidence, or shadow-only evidence.
4. **How independent is the agreement?** One weak signal, two independent method families, or multiple corroborating signals.
5. **What may it influence?** Direct owner ranking, support candidate ranking, shadow diagnostics, or nothing.

The solution should deepen the code lane in four steps:

1. Define the normalized evidence vocabulary.
2. Convert existing candidate channels into evidence records in shadow-compatible form.
3. Feed evidence records into method admission without broadening runtime promotion.
4. Add eval diagnostics that report method wins, losses, candidate flooding, and shadow-only opportunities.

The immediate product behavior should remain equivalent to the accepted PRD-0052 baseline unless a specific promotion change passes the full OSS corpus. The main output of this PRD is a safer foundation:

- conventional-scope facets can later require agreement from path identity, source facts, chunk text, or exact symbol evidence
- code-identifier facets can later require agreement from exact symbol or chunk-body identifier evidence
- support files can be admitted because they satisfy support necessity instead of merely sharing tokens
- passive artifacts can remain excluded unless explicit intent or support necessity overrides them
- eval reports can separate "method generated a useful candidate" from "method promoted a useful first-slate entry"

## User Stories

1. As an agent operator, I want every code-lane method to emit comparable evidence, so that method behavior is debuggable across the full corpus.
2. As an agent operator, I want normalized evidence before new method promotion, so that future runtime changes do not hide behind scattered ranking heuristics.
3. As an agent operator, I want evidence records to distinguish owner evidence from support evidence, so that support-only improvements do not mask weak implementation-owner retrieval.
4. As an agent operator, I want shadow evidence to be retained, so that rejected methods can be studied without changing production ranking.
5. As an agent operator, I want method wins and losses reported by channel, so that regressions can be traced to a specific evidence family.
6. As an agent operator, I want candidate flooding detected, so that a method that adds many low-quality candidates cannot quietly lower top-3 quality.
7. As an agent operator, I want full-corpus eval reports to include evidence diagnostics, so that smoke wins cannot masquerade as generalization.
8. As an engineer, I want exact file anchors to produce high-authority evidence, so that named files remain dominant.
9. As an engineer, I want exact symbol anchors to produce high-authority evidence, so that named declarations remain dominant.
10. As an engineer, I want chunk-body matches to be represented as owner evidence, so that implementation text remains the primary retrieval signal.
11. As an engineer, I want source-facts matches to be represented separately from chunk-body matches, so that file purpose and exported symbols do not blur into BM25 text.
12. As an engineer, I want path identity to be represented explicitly, so that path-like prompts can rescue owners even when body text is generic.
13. As an engineer, I want dotted identity facets to produce explicit facet evidence, so that proven wins like `vcs.root` remain explainable.
14. As an engineer, I want conventional commit scopes to produce shadow evidence, so that `fix(css_parser): ...` can be studied without unsafe promotion.
15. As an engineer, I want code-shaped identifiers to produce shadow evidence, so that symbol-like prompts can later promote only with corroboration.
16. As an engineer, I want import graph neighbors to produce support evidence, so that structurally related files do not compete as primary owners by accident.
17. As an engineer, I want code family evidence to remain bounded support evidence, so that persistence substrate files help without displacing owners.
18. As an engineer, I want passive artifact status recorded as evidence, so that examples, fixtures, reports, evals, generated files, and tests are excluded for understandable reasons.
19. As an engineer, I want explicit test/example/generated intent to be evidence too, so that those files can participate when the task asks for them.
20. As an engineer, I want first-slate entries to expose compact trace reasons, so that I can understand why a file appeared in the Context Pack.
21. As an engineer, I want omitted candidates to expose compact trace reasons when explain mode asks for them, so that I can see whether the right file was found but not admitted.
22. As an engineer, I want retrieval behavior to be stable under small wording changes, so that ticket robustness improves.
23. As an engineer, I want the Context Pack to keep actionable navigation metadata, so that every promoted candidate still points to a file and chunk.
24. As a maintainer, I want evidence normalization behind a small interface, so that the code-source mixer does not keep accumulating local conditionals.
25. As a maintainer, I want evidence records to be independent of private score constants, so that tests can survive scoring refactors.
26. As a maintainer, I want method admission to consume evidence rather than channel names alone, so that promotion rules can be expressed in domain language.
27. As a maintainer, I want first-slate arbitration to consume evidence summaries, so that owner retention, support necessity, and passive artifact handling use the same facts.
28. As a maintainer, I want evidence records to preserve channel rank and rough strength, so that useful ordering information is not lost.
29. As a maintainer, I want evidence records to preserve reason identifiers, so that eval reports can group wins and losses without reverse-engineering text.
30. As a maintainer, I want normalized evidence to support independent-evidence counting, so that non-dotted facets can require agreement across method families.
31. As a maintainer, I want independent evidence to mean method-family agreement, not duplicate hits from the same query path, so that fake corroboration does not promote weak candidates.
32. As a maintainer, I want candidate evidence to be generated before admission, so that all methods can run in shadow mode.
33. As a maintainer, I want candidate evidence to record both admissible and rejected signals, so that rejection reasons are auditable.
34. As a maintainer, I want passive artifact rejection to be expressed as admission evidence, so that future exceptions are narrow and testable.
35. As a maintainer, I want support necessity to be expressed as evidence, so that support files are not simply lower-scored direct owners.
36. As a maintainer, I want source-fact coverage to be normalized, so that path, symbol, purpose, and signature matches can be compared.
37. As a maintainer, I want exact-body identifier matches to be normalized, so that code-shaped identifiers can rely on stronger evidence than token overlap.
38. As a maintainer, I want file-level fusion to use normalized evidence, so that multi-signal agreement is explicit.
39. As a maintainer, I want duplicate evidence from one method to be collapsed, so that multiple chunks in the same file do not impersonate independent methods.
40. As a maintainer, I want declaration and orientation chunks to be represented without losing file-level identity, so that the best projection remains actionable.
41. As a maintainer, I want eval diagnostics to report candidates found but not admitted, so that recall@30 improvements are visible before top-3 promotion.
42. As a maintainer, I want eval diagnostics to report candidates admitted but not useful, so that flooding is visible.
43. As a maintainer, I want eval diagnostics to report candidates shadowed but useful, so that the next promotion target is data-driven.
44. As a maintainer, I want eval diagnostics to report useful candidates demoted by passive rules, so that over-filtering can be caught.
45. As a maintainer, I want eval diagnostics to report exact-anchor stability, so that evidence changes do not damage precise queries.
46. As a maintainer, I want evidence diagnostics by change type, so that parser, runtime, CLI, storage, API, configuration, UI, and build-tooling tasks can be studied separately.
47. As a maintainer, I want evidence diagnostics by language, so that Rust, Go, Python, JavaScript, and TypeScript behavior can diverge visibly.
48. As a maintainer, I want evidence diagnostics by cleanliness bucket, so that clean small tasks are not blurred with noisy sweeps.
49. As an eval author, I want the eval report to separate candidate generation from admission, so that we know whether a miss is a generation miss or a promotion miss.
50. As an eval author, I want method-level recall@10, recall@30, and recall@100, so that broad candidate gains are not confused with first-slate gains.
51. As an eval author, I want method-level top-3 contribution counts, so that accepted promotions can be quantified.
52. As an eval author, I want method-level displacement counts, so that regressions can be explained.
53. As an eval author, I want shadow-only useful-hit counts, so that future methods are chosen by measured opportunity.
54. As an eval author, I want rejected variants documented in eval notes, so that future agents avoid known traps.
55. As a product owner, I want this PRD to make the next accuracy lift safer, so that new methods compound instead of canceling out.
56. As a product owner, I want expected immediate lift to be honest, so that scaffolding work is not mistaken for product quality movement.
57. As a product owner, I want conventional-scope promotion to be the first downstream method, so that common OSS commit prompts can improve after evidence is normalized.
58. As a future contributor, I want a clear way to add evidence for a new method, so that experiments can run shadow-first.
59. As a future contributor, I want a clear way to promote evidence, so that production ranking changes are isolated and reviewable.
60. As a future contributor, I want evidence tests to be small and synthetic, so that behavior is portable and not corpus memorization.
61. As a future contributor, I want full-corpus eval notes checked in after promotion attempts, so that planning starts from measured history.
62. As a future contributor, I want no hidden ContextTrail-local assumptions, so that the code lane generalizes to unfamiliar repositories.

## Implementation Decisions

- Keep chunk-first retrieval as the architecture. Evidence normalization observes and organizes candidate signals; it does not make graph-first, map-first, or method-first retrieval the primary lane.
- Keep code entries inside the core pack authority. Evidence normalization must not introduce presenter-only side channels or post-pack code injection.
- Treat this PRD as a deep-module extraction. The evidence module should expose a small interface that accepts candidate identity plus method-specific evidence inputs and returns normalized file-level evidence summaries.
- The evidence module should be independent of the final scoring constants. It may preserve rough strength buckets, coverage values, channel rank, and reason identifiers, but admission tests should not depend on private score math.
- Evidence records should be file-centered. Chunk-level signals are preserved, but independent-evidence counting happens at the candidate file level.
- Evidence records should retain the best actionable projection: source identity, best chunk identity, symbol path when available, role, declaration kind, and navigation fields needed by code pack entries.
- Evidence records should distinguish `owner` evidence, `support` evidence, `artifact_policy` evidence, `anchor` evidence, and `shadow` evidence.
- Evidence records should distinguish method families, not only channel names. Initial families should include chunk text, source facts, exact symbol, path identity, query facet, import graph, code family evidence, and artifact policy.
- Query facet evidence should preserve facet reason. Dotted identity remains promotable; conventional scope and code identifier remain shadow-only unless later multi-signal admission proves full-corpus lift.
- Independent evidence should require agreement across distinct method families. Multiple chunks, multiple FTS hits, or repeated facets from one family should not count as independent agreement by themselves.
- The normalized evidence summary should include the count of independent owner evidence families and support evidence families.
- The normalized evidence summary should expose whether a candidate has exact file or exact symbol anchor evidence.
- The normalized evidence summary should expose whether a candidate is passive by default and whether explicit task intent makes that passive artifact admissible.
- The normalized evidence summary should expose whether a candidate is persistence substrate support under the bounded family-evidence rule.
- Existing file-level fusion should be gradually refactored to consume evidence summaries, while preserving current accepted runtime behavior during the first slice.
- Method admission should be updated to consume evidence summaries where practical, while preserving the PRD-0052 dotted-only baseline.
- First-slate arbitration should not be fully rewritten in this PRD. It should receive evidence summaries only where needed to make future extraction possible.
- Support-cluster admission should continue to preserve primary owner retention. Evidence normalization should make support reasons clearer without increasing support flooding.
- Eval diagnostics should consume normalized evidence and report method-level opportunity before runtime promotion.
- The first completed state of this PRD should be behavior-preserving against the accepted baseline: `4607 / 7360` prompt top-3, `257 / 736` ticket robust, and `133 / 2872` support hits on the full local OSS corpus.
- A behavior-preserving refactor is acceptable if it unlocks trustworthy method diagnostics. Any promoted behavior change must run the full OSS corpus and compare against the accepted baseline.
- The likely next promoted method after this PRD is multi-signal conventional-scope facet promotion. That method is not included by default in this PRD, but the evidence contract should be designed so it can be implemented without another broad mixer rewrite.
- Expected immediate product lift from this PRD is `0` to `+0.2 percentage points` prompt top-3 because the first slice should be behavior-preserving. Expected downstream lift from the first evidence-backed conventional-scope promotion is `+0.3` to `+1.0 percentage points` prompt top-3 if full-corpus diagnostics identify enough safe opportunities.
- Do not hardcode OSS corpus tickets, commits, repository names, file paths, or aliases.
- Do not promote broad conventional-scope or code-identifier facets from one signal alone.
- Do not weaken exact-anchor dominance to make shadow methods look better.
- Do not weaken passive artifact exclusion except through explicit task intent or support necessity.

## Implementation Steps

1. **Inventory Existing Signals**

   Audit every current code-lane candidate source and record what it already knows: channel, source path, chunk, score, channel rank, anchor priority, lexical priority, path priority, source-fact coverage, source-fact matches, exact-symbol matches, import relationship, family evidence, support role, and artifact policy.

2. **Define The Evidence Vocabulary**

   Define stable evidence families, evidence roles, admission targets, reason identifiers, and strength buckets. Keep the vocabulary small enough that future methods can use it without inventing new concepts for every heuristic.

3. **Add The Evidence Normalization Module**

   Add a deep module that accepts raw candidate signals and returns normalized evidence records and per-file evidence summaries. The module should be testable without a database and should not import the whole retrieval mixer.

4. **Write The First Red Test**

   Start with one TDD slice proving that two raw hits for one file from two distinct method families produce one file-level summary with two independent owner evidence families. Keep this test at the evidence module interface.

5. **Normalize Query Facet Evidence**

   Convert dotted, conventional-scope, and code-identifier facet output into evidence records. Dotted identity should be direct-owner eligible; conventional scope and code identifier should remain shadow-only until admission sees enough independent evidence.

6. **Normalize Chunk And Source-Facts Evidence**

   Convert chunk FTS and source-facts FTS hits into evidence records. Preserve body/text evidence separately from file-purpose, exported-symbol, exported-signature, and path evidence.

7. **Normalize Exact Symbol And Path Evidence**

   Convert exact-symbol fallback and path fallback into explicit evidence families. Exact-symbol evidence should carry stronger owner authority than generic symbol token overlap. Path identity should distinguish basename matches, ordered path alignment, and broad path-token overlap.

8. **Normalize Support And Family Evidence**

   Convert import graph, same-family support, persistence substrate family evidence, and support-cluster reasons into support evidence. Preserve support necessity separately from owner evidence.

9. **Normalize Artifact Policy Evidence**

   Convert passive artifact detection and explicit artifact intent into evidence. The summary should say whether a file is excluded by default, admitted by explicit intent, or eligible as support only.

10. **Wire Evidence Into Method Admission In Shadow-Compatible Form**

    Update method admission so it can use normalized evidence while preserving current PRD-0052 behavior. The first runtime result should still admit dotted identity facets and shadow non-dotted facets unless independent evidence is explicitly present.

11. **Add Retrieval Behavior Tests**

    Add public retrieval tests proving that evidence normalization does not regress exact file anchors, exact symbol anchors, dotted identity recovery, passive artifact exclusion, and owner retention when support candidates exist.

12. **Add Eval Diagnostics**

    Extend the OSS code-lane eval report to include evidence-family recall, useful shadow candidates, admitted useless candidates, displacement counts, and candidate flooding by method family.

13. **Run Focused Tests And Build**

    Run evidence module tests, code query facet tests, code source mixer tests, parser/import tests touched by evidence conversion, and the full TypeScript build.

14. **Run The Full OSS Code-Lane Eval**

    Run the full local OSS code-lane corpus with the same manifest and prompt count used by the accepted dotted-only baseline. The first pass must preserve baseline quality or document and reject the regression.

15. **Write The Eval Report**

    Check in an eval note recording whether behavior stayed at baseline, which evidence families found useful shadow candidates, which methods flooded, and which downstream promotion looks safest.

16. **Prepare The Next Promotion PRD**

    Use the normalized evidence report to design the next runtime promotion. The expected first candidate is multi-signal conventional-scope facet promotion, because conventional scopes are common in OSS commit-style prompts but unsafe as single-signal owner evidence.

## Testing Decisions

- Use TDD with vertical slices. One behavior test should fail, then the minimal evidence implementation should make it pass before adding the next behavior.
- Good evidence tests should exercise the public evidence module interface, not private helper functions or score constants.
- Good retrieval tests should exercise public retrieval behavior through the code-source lane, not direct mutation of internal mixer state.
- Evidence module tests should cover file-level summary aggregation, independent-family counting, duplicate-family collapse, owner/support separation, shadow-only evidence, anchor evidence, passive artifact evidence, and persistence substrate support evidence.
- Method admission tests should cover dotted identity admission, non-dotted facet shadowing, non-dotted facet admission with independent evidence, exact file/symbol anchor dominance, and artifact rejection.
- Retrieval behavior tests should cover exact file anchors, exact symbol anchors, dotted identity recovery, conventional-scope shadow behavior, code-identifier shadow behavior, passive artifact exclusion, explicit artifact intent, and support-cluster owner retention.
- Eval diagnostics tests should prove that reports include method-family recall, useful shadow candidates, admitted useless candidates, candidate flooding, and displacement summaries.
- Existing code-source mixer tests are prior art for public retrieval behavior.
- Existing query facet and method admission tests are prior art for deep module interfaces.
- Existing parser/import tests are prior art for proving chunk identity through observable output rather than private parser internals.
- The smoke OSS corpus may be used as a plumbing check, but it cannot promote behavior.
- The full OSS corpus must run before accepting any runtime behavior change. Compare against the accepted PRD-0052 baseline: `4607 / 7360` prompt top-3, `257 / 736` ticket robust, `133 / 2872` support hits.
- If evidence normalization is behavior-preserving, an unchanged full-corpus score is acceptable and expected.
- If evidence normalization changes behavior, it must not regress prompt top-3, ticket robustness, support hits, recall@10, recall@30, exact-anchor behavior, or passive artifact behavior without an explicit documented tradeoff.
- Full `npm test` may still include unrelated synthetic eval threshold failures. Focused code-lane tests and full OSS code-lane eval are the acceptance signals for this PRD unless those unrelated tests are repaired separately.

## Out of Scope

- Promoting broad conventional-scope facets by default.
- Promoting broad code-identifier facets by default.
- Adding repository-map candidate generation.
- Adding package/module relationship expansion beyond normalizing existing support evidence.
- Adding set-level bundle reranking.
- Replacing chunk-first code retrieval.
- Graph-first retrieval.
- Runtime LLM reranking or judging.
- Embeddings or hosted search services.
- Changing the MCP contract.
- Making code entries authority-bearing Context Objects.
- Redesigning document retrieval.
- Weakening exact file or exact symbol anchor dominance.
- Weakening passive artifact exclusion without explicit intent or support necessity.
- Hardcoding OSS corpus cases, commits, file paths, repository names, or aliases.
- Treating smoke-corpus gains as promotion proof.
- Ratcheting certification gates before a new stable improved baseline exists.

## Further Notes

This PRD is intentionally a scaffolding PRD. That is not a retreat from accuracy work; it is the next practical step toward safe accuracy work.

The code lane currently has useful signals but no shared evidence contract. Without that contract, every new method has to be wired directly into ranking, and every regression becomes a mystery of ordering, score constants, and channel side effects. Evidence normalization should make the next method boring in the best sense: the conventional-scope promotion rule should be expressible as "promote only when a conventional-scope facet agrees with at least one independent owner evidence family and no stronger anchor or artifact policy rejects it."

The expected next method after this PRD is therefore:

1. use normalized evidence diagnostics to identify useful shadow conventional-scope hits
2. require independent agreement from path identity, source facts, exact symbol, chunk body, dotted identity, or family evidence
3. promote only direct-owner candidates, not support-only candidates
4. reject passive artifacts unless explicit intent admits them
5. run smoke as plumbing only
6. run the full OSS corpus and compare against `4607 / 7360`

If the diagnostics show that conventional-scope opportunities are too sparse or too noisy, the next method should not be forced. The evidence report should then redirect to the strongest measured shadow opportunity, likely code-identifier promotion with exact-body corroboration or path/source-facts fusion for recall@30.
