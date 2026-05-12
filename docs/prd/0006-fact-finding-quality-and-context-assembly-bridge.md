# PRD-0006: Fact-finding quality and context assembly bridge

> Source-of-truth canonical doc. Mirrored to issue tracker as the project's sixth PRD issue.
>
> Glossary: [`docs/CONTEXT.md`](../CONTEXT.md). Predecessor: [PRD-0005](0005-retrieval-correctness-and-observability.md). Related ADRs: [ADR-0007](../adr/0007-hybrid-scoring-additive-text-multiplicative-structure.md), [ADR-0011](../adr/0011-locked-include-matching-rules.md), [ADR-0013](../adr/0013-retrieve-context-pack-omitted-becomes-summary.md), [ADR-0014](../adr/0014-agent-assisted-setup-without-truth-promotion.md), [ADR-0015](../adr/0015-task-readiness-gates-authority-not-access.md).
>
> **Sequencing rule:** harden fact-finding quality before setup intelligence, task readiness, or full Context Pack assembly. If ContextTrail cannot reliably identify the right Context Objects with curated substrate, later assembly and setup layers will only hide retrieval defects.

## Problem Statement

PRD-0005 and the expanded fixture eval show that ContextTrail's retrieval pipeline can already perform well when Cards, scopes, anchors, and Doc Chunks are curated. The remaining product risk is not simple "can it search text?" It is whether the engine can reliably identify the right authoritative and canonical Context Objects across many query shapes, while avoiding plausible but wrong objects.

The current eval is useful, but it still mixes several concerns:

- fact finding: did the retrieval pipeline identify the right objects?
- Context Pack assembly: did the final pack include enough surrounding context without overstuffing?
- agent usefulness: did an agent perform better with the pack?
- setup quality: did users create the right substrate in the first place?

Those layers must be separated. The next engine-hardening slice should focus on **fact-finding quality with curated substrate**. It should also create a bridge to future Context Pack quality by labeling every eval case with the query intent and the future assembly need it represents.

The user needs confidence that improvements made today will not become ranking hacks that future Context Pack assembly has to undo. PRD-0006 therefore defines a reusable measurement substrate, not just a larger test list.

## Solution

PRD-0006 introduces an eval-first fact-finding quality layer.

The solution has four parts:

1. **Eval taxonomy.** Every fixture case carries reusable labels: `query_intent`, `assembly_need`, `expectation_kind`, and capability coverage.
2. **Strict object-level relevance judgments.** Cases declare expected and forbidden locked Cards, expected canonical top sources, forbidden top-3 distractors, expected warnings, and ambiguity status.
3. **Intent/need reporting.** The eval report breaks pass/fail down by query intent, assembly need, retrieval mode, and named fact-finding capability.
4. **Defect-only production fixes.** Production retrieval changes are allowed only when the taxonomy exposes a named fact-finding capability defect.

The named fact-finding capabilities are:

- anchor recognition
- scope inference
- locked authority retrieval
- over-lock prevention
- canonical source ranking
- distractor resistance
- signal-empty honesty
- ambiguity labeling
- explainability

The immediate deliverable is not full Context Pack assembly. The bridge is the `assembly_need` taxonomy: it records what kind of surrounding context future pack assembly should eventually provide once fact finding is stable.

## User Stories

1. As an agent operator, I want fact-finding quality measured separately from setup quality, so that I can tell whether a failure came from the engine or from missing substrate.
2. As an agent operator, I want fact-finding quality measured separately from Context Pack assembly, so that ranking and packing failures do not get blurred together.
3. As an agent operator, I want fact-finding quality measured separately from agent task success, so that I can debug retrieval before debugging agent behavior.
4. As a ContextTrail maintainer, I want every eval case labeled with a query intent, so that failures can be grouped by the kind of query the engine is handling.
5. As a ContextTrail maintainer, I want every eval case labeled with an assembly need, so that today's fact-finding cases become tomorrow's Context Pack assembly cases.
6. As a ContextTrail maintainer, I want every eval case labeled as deterministic, ambiguous, or signal-empty, so that the eval does not pretend every query has one objectively correct top source.
7. As a ContextTrail maintainer, I want deterministic cases to require perfect contract behavior, so that exact retrieval semantics do not regress quietly.
8. As a ContextTrail maintainer, I want ambiguous cases documented outside deterministic gates, so that broad or multi-anchor queries are still visible without forcing fake precision.
9. As a ContextTrail maintainer, I want expected locked Cards to remain a first-class assertion, so that authoritative constraints and symbol_notes are guaranteed to surface.
10. As a ContextTrail maintainer, I want forbidden locked Cards to remain a first-class assertion, so that sibling or cross-domain over-locking is caught.
11. As a ContextTrail maintainer, I want expected evidence provenance asserted explicitly, so that `evidence_covers_locked` remains observable and does not become inferred from output shape.
12. As a ContextTrail maintainer, I want forbidden top-3 distractor assertions, so that term-overlapping but non-authoritative docs cannot crowd out canonical sources.
13. As a ContextTrail maintainer, I want signal-empty cases to assert query mode and warning behavior, so that ungrounded anchors are surfaced honestly.
14. As a ContextTrail maintainer, I want query-mode exactness to be a 100% gate, so that anchored, unanchored, and signal-empty behavior stays mechanically trustworthy.
15. As a ContextTrail maintainer, I want anchor-recognition cases across files, symbols, and routes, so that all query-anchor kinds are covered.
16. As a ContextTrail maintainer, I want source-code-anchor cases, not only Card-anchor cases, so that the engine is tested against imported Doc Chunk code anchors too.
17. As a ContextTrail maintainer, I want cross-module anchored cases, so that multi-scope queries do not collapse into one module or over-lock siblings.
18. As a ContextTrail maintainer, I want cross-domain distractor docs, so that plausible but wrong docs are used as hard negatives.
19. As a ContextTrail maintainer, I want deprecated and stale Card cases, so that non-applicable Cards do not lock or rank as authoritative.
20. As a ContextTrail maintainer, I want budget-pressure cases preserved, so that locked guarantees and omission summaries remain correct under small budgets.
21. As a ContextTrail maintainer, I want eval output grouped by retrieval mode, so that anchored, unanchored, and signal-empty behavior can be judged separately.
22. As a ContextTrail maintainer, I want eval output grouped by query intent, so that exact-symbol failures are not averaged together with broad-domain failures.
23. As a ContextTrail maintainer, I want eval output grouped by assembly need, so that future Context Pack assembly work can inherit the same cases.
24. As a ContextTrail maintainer, I want eval output grouped by named capability, so that each failure points to the likely engine seam.
25. As a ContextTrail maintainer, I want machine-readable eval JSON to include taxonomy fields, so that CI and future dashboards can consume the same report.
26. As a ContextTrail maintainer, I want a concise terminal table for humans, so that local failures are easy to interpret without reading JSON.
27. As a ContextTrail maintainer, I want misses to show expected source, actual top-3, forbidden hits, warning misses, and notes, so that debugging a failure is mechanical.
28. As a ContextTrail maintainer, I want the eval reference doc updated, so that future contributors understand what the gate measures.
29. As a ContextTrail maintainer, I want production changes tied to named capability defects, so that passing the fixture does not encourage one-off ranking hacks.
30. As a ContextTrail maintainer, I want arbitrary scoring-weight tweaks out of scope, so that ranking changes must be justified by a capability failure.
31. As a ContextTrail maintainer, I want setup intelligence out of scope, so that fact-finding work is not mixed with candidate Cards, DomainRegistry, or adaptive questions.
32. As a ContextTrail maintainer, I want task readiness out of scope, so that the MCP runtime contract does not change before the engine is hardened.
33. As a ContextTrail maintainer, I want full Context Pack assembly out of scope, so that this PRD does not optimize surrounding-context sufficiency before object identification is stable.
34. As a future Context Pack assembly implementer, I want each fact-finding case to declare its assembly need, so that I can later define pack sufficiency per intent.
35. As a future Context Pack assembly implementer, I want exact-symbol cases to declare local-semantics assembly needs, so that future packs can include symbol notes, nearest constraints, evidence, and canonical symbol docs.
36. As a future Context Pack assembly implementer, I want cross-module cases to declare boundary-context assembly needs, so that future packs can balance context across touched modules.
37. As a future Context Pack assembly implementer, I want decision-lookup cases to declare decision-rationale assembly needs, so that future packs can include ADR context without drowning implementation docs.
38. As a future Context Pack assembly implementer, I want symptom-debugging cases to declare debugging-evidence assembly needs, so that future packs can include tests, evidence, warnings, and diagnostic docs.
39. As a future setup-intelligence implementer, I want fact-finding gates to be stable first, so that setup failures are not confused with engine failures.
40. As a future setup-intelligence implementer, I want setup-derived retrieval accuracy to remain a separate metric, so that messy setup does not lower the bar for curated-substrate engine quality.
41. As an evaluator, I want deterministic top-source cases to remain strict, so that high-confidence queries prove the engine can find the canonical source.
42. As an evaluator, I want ambiguous cases to remain counted and reported, so that hard cases are not hidden merely because they are excluded from deterministic top-source gates.
43. As an evaluator, I want forbidden top-3 distractor cases to remain exact, so that hard negatives are not normalized as acceptable noise.
44. As an evaluator, I want expected warning cases to remain exact, so that recovery signals are preserved even when ranked output is empty or exploratory.
45. As an evaluator, I want the eval harness to fail loudly when case count, taxonomy coverage, or gate coverage changes accidentally, so that the fixture remains a controlled instrument.
46. As a ContextTrail maintainer, I want fragile adversarial passes reported separately, so that a case that passes because corpus statistics shifted is not mistaken for a solved engine behavior.
47. As a ContextTrail maintainer, I want unanchored lexical-distractor cases to stay on the watchlist, so that dense release notes, glossaries, and style guides cannot quietly regain top-3 placement.
48. As a ContextTrail maintainer, I want middle-ground vague queries to produce a low-confidence recovery signal when ranked content is non-empty but weak, so that agents are not tricked by low-quality matches.
49. As a ContextTrail maintainer, I want stale/freshness semantics to be settled end-to-end, so that filters do not exist without a writer path and tests do not assert unreachable states.
50. As a ContextTrail maintainer, I want code-anchor coverage labeled precisely, so that doc-frontmatter code anchors are not confused with real source-code import support.

## Implementation Decisions

- PRD-0006 is **eval-first**. The primary deliverable is a reusable measurement substrate for fact-finding quality.
- Production retrieval changes are permitted only when a failing or newly added case exposes a named fact-finding capability defect.
- The eval case schema gains taxonomy fields:
  - `query_intent`
  - `assembly_need`
  - `expectation_kind`
  - capability coverage labels
- Initial `query_intent` values:
  - `exact_symbol`
  - `file_anchored`
  - `route_anchored`
  - `cross_module`
  - `broad_domain`
  - `decision_lookup`
  - `symptom_debugging`
  - `signal_empty`
- Initial `assembly_need` values:
  - `local_semantics`
  - `domain_constraints`
  - `cross_module_boundary`
  - `decision_rationale`
  - `debugging_evidence`
  - `setup_recovery`
  - `none`
- Initial `expectation_kind` values:
  - `deterministic`
  - `ambiguous`
  - `signal_empty`
- Deterministic cases participate in strict top-source and forbidden-object gates.
- Ambiguous cases remain in reports but do not force a single expected top source when the task legitimately spans multiple canonical objects.
- Signal-empty cases assert grounding behavior and warning behavior; they do not need meaningful ranked content.
- The eval report should include both human-readable terminal output and machine-readable JSON.
- The report should group by retrieval mode, query intent, assembly need, and capability coverage.
- The report should preserve the existing high-level bucket rows while adding taxonomy rows.
- The eval should keep object-level relevance judgments: expected locked, forbidden locked, expected evidence, expected top source, forbidden top-3, expected warning kinds, must-include sources.
- The eval should keep adversarial hard negatives: general docs, release notes, style guides, cross-domain distractors, deprecated Cards, and stale/overflow cases.
- The eval should distinguish **fragile passes** from solved behaviors. A fragile pass is a historically failing or corpus-sensitive adversarial case that currently passes but could flip because BM25/IDF statistics changed.
- Unanchored lexical-distractor resistance is a named hardening target. The current adversarial summary shows that dense `general/` docs can contest top-3 placement when no anchors are provided, even if anchored distractor resistance is strong.
- Middle-ground vague-query recovery is a named hardening target. `no_matches` covers truly empty ranked results; PRD-0006 should add or evaluate an additive `low_confidence`-style signal for non-empty but weak matches.
- Freshness-state semantics must be settled before stale-card evals are treated as complete. Either the card pipeline must support writing `freshness_state: potentially_superseded`, or the dead filter/design should be removed or renamed.
- Code-anchor coverage should be formalized so fact-finding is not tested only through Card anchors. In v1 this means doc-frontmatter `scope.symbols` / `scope.files` / `scope.routes` that populate code anchors; real `.ts` source import remains out of scope.
- Explainability is a named fact-finding capability. If a failure cannot be diagnosed from current output, adding diagnostic trace data is allowed.
- Scoring changes must be justified by a named capability and a failing adversarial or deterministic case.
- Weight tuning that merely improves aggregate numbers without explaining which capability improved is out of scope.
- Special-casing individual paths, docs, case ids, or fixture strings is out of scope.
- Weakening expectations to pass the eval is out of scope unless the case is explicitly reclassified from deterministic to ambiguous with a note explaining why no single answer is objectively correct.
- Setup confidence, DomainRegistry, SetupDecisionLog, adaptive questions, candidate Cards, and task readiness are out of scope.
- Full Context Pack assembly algorithms are out of scope. This PRD creates the bridge taxonomy and reports that later assembly work will use.

## Testing Decisions

- Tests must verify external behavior through the eval CLI, MCP handler behavior, and schema-visible outputs. Do not test private helper internals unless they are extracted as stable deep modules.
- Good tests should read like retrieval contract specifications: "cross-domain symbol query does not lock sibling module constraints," not "function X calls helper Y."
- The eval fixture is the main integration test surface. It should exercise the real import, Card import, retrieval pipeline, MCP transformation, and explain output.
- The taxonomy validator should be tested as a deep module if extracted. Its interface should answer whether every case is fully labeled and whether labels are valid.
- The report renderer should be tested as a deep module if extracted. Its interface should turn an eval report into stable human-readable and JSON output.
- The case loader should validate taxonomy fields and fail fast on unknown values, duplicate ids, missing notes, missing expectation kind, or missing capability coverage.
- The eval should include regression tests for:
  - query mode exactness
  - locked correctness
  - forbidden locked absence
  - forbidden top-3 absence
  - evidence provenance
  - expected warning kinds
  - baseline ranked usefulness
  - agent-answer source inclusion
  - omitted summary usefulness
  - fragile-pass watchlist reporting
  - low-confidence vague-query signaling
  - freshness writer/filter reachability
  - taxonomy completeness
  - report breakdown completeness
- Existing prior art includes:
  - the retrieval fixture eval harness
  - MCP contract equivalence tests
  - MCP schema tests
  - payload-size snapshot tests
  - query-scope and locked-include tests
- Production fixes discovered by the eval should get targeted regression tests at the highest stable interface that exposes the behavior.
- The eval should remain CI-friendly and deterministic. No network calls, no LLM calls, no dependence on the live `.contexttrail` cache.

## Out of Scope

- Setup intelligence and adaptive setup questions.
- DomainRegistry and SetupDecisionLog.
- Candidate Card generation or triage UX.
- Task readiness in `retrieve_context_pack`.
- Full Context Pack assembly or surrounding-context expansion algorithms.
- Agent task-success or HITL coding evaluations.
- LLM reranking or embedding changes.
- Arbitrary score-weight tuning.
- Special-case ranking rules for individual fixture docs or paths.
- External docs sources such as Notion, Confluence, Google Docs, PDFs.
- Changing locked-include semantics from ADR-0011.
- Changing the MCP wire contract except for additive explain/reporting data required to diagnose named fact-finding capability failures.

## Further Notes

The search-company lesson imported here is not "copy a search box." It is the evaluation discipline behind serious search systems:

- label query intent
- maintain relevance judgments
- use hard negatives
- separate deterministic cases from ambiguous cases
- report quality by query class instead of only aggregate score

For ContextTrail, those lessons translate into fact-finding quality with curated substrate. Context Pack quality comes next, once the engine has proven it can reliably identify the right Context Objects.

PRD-0006 should make future context assembly easier, not harder. The bridge is the `assembly_need` taxonomy: it lets future work define sufficiency per query type without rebuilding the fact-finding eval.

## Adversarial Eval Review

The post-PRD-0005 adversarial eval summary adds three concrete requirements to PRD-0006:

1. **Track fragile passes.** `adv-distractor-refund-unanchored` currently passes, but the summary records that it previously failed and then flipped after an unrelated corpus change shifted BM25/IDF statistics. PRD-0006 should report this as a watchlist item, not as ordinary solved quality.
2. **Add a low-confidence recovery signal.** `no_matches` only fires when `ranked` is empty. That is correct but insufficient: vague queries can still produce weak non-empty matches. PRD-0006 should evaluate whether an additive `low_confidence` warning or equivalent explain metric is needed.
3. **Settle stale/freshness reachability.** Evidence promotion filters out `freshness_state: potentially_superseded`, but the normal card pipeline does not write that state. PRD-0006 should either wire the authoring path or remove the unreachable state before treating stale-card coverage as real.

The same summary also confirms several areas PRD-0006 already covers well: over-lock prevention, forbidden top-3 distractors, deprecated authority filtering, locked-overflow warnings, doc-frontmatter code-anchor recognition, and signal-empty honesty.

## Post-PRD-0006 architecture follow-ups

Implementing PRD-0006 surfaced architectural friction in adjacent code that PRD-0006 itself does not change but that future fact-finding and Context Pack assembly work will land into. That follow-up plan lives at [`docs/plan/architecture-deepening-2026-05.md`](../plan/architecture-deepening-2026-05.md) and ships as separate PRs after PRD-0006 merges.

The deepening covers:
- **Card-locking consolidation** — single owner for which Cards lock, why, and the wire-shape `lock_reason`.
- **`PackPresentation`** — one resolved internal representation for the three Context Pack projections (MCP wire, CLI markdown, CLI JSON).
- **Scope concerns split by purpose** — recorded as ADR-0016; rejects a consolidation that would have collapsed assignment, inference, ranking-signal, and lock-eligibility into one module.
- **`TestCorpus`** — shared fixture-setup module replacing the `mkdtemp + init + runImport` boilerplate duplicated across 10+ test files.

The plan does not change PRD-0006's wire contract, eval taxonomy, or fact-finding gates.
