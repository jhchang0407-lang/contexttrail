# PRD-0012: SourceProfile and deterministic source rerank

> Source-of-truth canonical doc. Intended to be mirrored to the issue tracker as the project's twelfth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADR: [ADR-0020](../adr/0020-retrieval-engine-v2-source-first-ceiling-probes.md). Reference plan: [Retrieval Engine V2 Rework Plan](../plan/retrieval-engine-v2-rework-2026-05.md). Related PRDs: [PRD-0010](0010-retrieval-engine-v2-slice-0-ceiling-probes.md), [PRD-0011](0011-confidence-abstention-rework.md).
>
> **Sequencing rule:** this PRD comes after Slice 0 proved `critical-source-set recall@50 = 100%` and Slice 1 reduced false-confident unsupported cases to `0`. It must improve source ranking/aboutness without changing candidate generation architecture or weakening honest abstention.

## Problem Statement

Slice 0 and Slice 1 changed the shape of the retrieval problem:

| Metric | Current Result |
|---|---:|
| critical-source-set recall@50 | 100.0% |
| oracle answerable success@50 | 100.0% |
| false-confident unsupported | 0 |
| actual top-1 acceptable | 62.5% |
| actual top-3 acceptable | 87.5% |
| synthetic regression | passed |
| active branch | `source_ranking_or_aboutness` |

Candidate generation is no longer the first bottleneck on the Phase 8 panel. The engine can find the required sources, and it can abstain honestly on unsupported cases. The remaining problem is ordering: the right source is often present, but the chunk-first ranker still puts migration guides, broad references, or incidental mentions above the source that is actually about the user's task.

That ranking weakness is dangerous for context assembly. A context pack can contain the right source somewhere in the candidate set and still be weak if the assembled pack puts a distracting or secondary source first. For multi-step tasks, the engine needs to prefer canonical, purpose-compatible sources before selecting chunks.

## Solution

Build deterministic `SourceProfile` metadata and use it for source-level reranking over the candidate set that already exists today.

This PRD introduces a source-first ranking layer, but not the full Retrieval Engine V2 candidate-generation stack. The implementation should:

1. create deterministic profiles for imported markdown sources
2. classify source purpose and source aliases without index-time LLM calls
3. aggregate current chunk candidates into source candidates
4. compute explainable source-level ranking features
5. rerank sources before chunk selection and presentation
6. preserve Cards, locked-include, confidence policy, and source recall gates
7. extend Slice 0 reports so ranking movement is measurable and attributable

The target is not to make every query magically obvious. The target is to lift canonical source ranking while preserving the hard-won floors:

- keep `critical-source-set recall@50 = 100%`
- keep `false-confident unsupported = 0`
- keep synthetic regression passing
- improve answerable top-1 from `62.5%` to at least `75.0%`
- improve answerable top-3 from `87.5%` to at least `93.8%`

Stretch targets are `81.3%` top-1 and `96.9%` top-3 on the 32 answerable Phase 8 cases.

## User Stories

1. As a ContextTrail maintainer, I want each imported source to have deterministic retrieval metadata, so that source ranking does not depend only on accidental chunk term density.
2. As a ContextTrail maintainer, I want SourceProfiles to be rebuildable index metadata, so that final Context Packs still cite Doc Chunks and Cards as authority.
3. As a ContextTrail maintainer, I want source purpose classified separately from doc role, so that canonical authority and document format do not get blurred.
4. As a ContextTrail maintainer, I want deterministic summaries based on title, H1, and intro text, so that source profiles do not require index-time model calls.
5. As a ContextTrail maintainer, I want heading outlines captured in source profiles, so that topic coverage can be judged at source level.
6. As a ContextTrail maintainer, I want title, path, heading, symbol, route, package, and filename aliases extracted deterministically, so that exact source matches can lift canonical docs.
7. As a ContextTrail maintainer, I want question-shaped headings captured when present, so that source profiles can represent the questions a source already answers.
8. As a ContextTrail maintainer, I want source candidates built from current chunk candidates, so that this slice improves ranking without introducing a new candidate-generation stack.
9. As a ContextTrail maintainer, I want source-level feature vectors to be explainable, so that every rerank decision can be debugged from deterministic evidence.
10. As a ContextTrail maintainer, I want source purpose compatibility to influence ranking, so that migration, changelog, and broad reference pages stop beating concept or quick-start docs when they are merely incidental mentions.
11. As a ContextTrail maintainer, I want exact-symbol and path-like queries to prefer source aliases and source paths, so that small canonical API docs are not drowned out by large general references.
12. As a ContextTrail maintainer, I want decision and tradeoff queries to prefer ADRs, concepts, guides, and runbooks, so that explanatory sources beat procedural side notes.
13. As a ContextTrail maintainer, I want broad domain queries to prefer concepts, quick starts, guides, and readmes, so that first-read sources become easier to find.
14. As a ContextTrail maintainer, I want source rerank to select chunks inside chosen sources, so that final packs still contain authoritative source text rather than profile metadata.
15. As a ContextTrail maintainer, I want locked Cards to bypass source rerank exactly as they do today, so that authored operational truth remains stable.
16. As a ContextTrail maintainer, I want non-locked Cards to keep current ranking and `card_type_bias` semantics, so that source-first doc ranking does not rewrite the Cards contract.
17. As a ContextTrail maintainer, I want explain output to distinguish source candidates from chunk candidates, so that source-first behavior is inspectable.
18. As a ContextTrail maintainer, I want the real-corpus report to show source-rerank movement, so that top-1/top-3 gains are attributable to aboutness rather than hidden side effects.
19. As a ContextTrail maintainer, I want the eval to fail on recall or abstention regressions, so that ranking work cannot break the floors established by Slices 0 and 1.
20. As a ContextTrail maintainer, I want this slice to avoid RRF, dense retrieval, cross-encoder reranking, and LLM reranking, so that we can measure the deterministic source-rerank ceiling first.
21. As a ContextTrail maintainer, I want source-rerank thresholds and feature weights to be explicit and testable, so that future learning-to-rank work has a clean feature surface.
22. As a future V2 implementer, I want this deterministic scorer shaped like a feature vector, so that a later learned ranker can reuse the interface once enough labels exist.
23. As a ContextTrail maintainer, I want no learning-to-rank training in this slice, so that a 42-case panel does not lead to overfit ranking behavior.
24. As a context assembly user, I want canonical sources to appear earlier in the pack, so that downstream assignments start from the most relevant project knowledge.
25. As a context assembly user, I want the engine to remain honest when ranking evidence is weak, so that better ranking does not become overconfidence.

## Implementation Decisions

- This is a **source ranking/aboutness slice**, not a candidate-generation slice.
- This slice may add SourceProfiles and deterministic source-level reranking.
- This slice must not add RRF, multi-retriever fusion, dense retrieval, cross-encoder reranking, LLM reranking, or learning-to-rank.
- `SourceProfile` is rebuildable retrieval index metadata, not a new Context Object kind.
- Final Context Packs continue to cite Doc Chunks and Cards only.
- SourceProfiles may influence source ranking, diagnostics, and source-scoped chunk selection.
- SourceProfiles must be deterministic in v1. No index-time LLM calls are allowed.
- `summary` is deterministic: frontmatter title or H1 plus first non-empty intro paragraph, capped to a stable budget.
- `questions_answered` is optional and deterministic: only question-shaped headings are extracted.
- `doc_role` remains the existing authority/demotion role.
- `doc_purpose` is a new deterministic source format classifier. It answers what kind of source this is, not whether it is authoritative.
- `doc_purpose` should include at least: `concept`, `api_reference`, `guide`, `quick_start`, `migration`, `changelog`, `release_note`, `runbook`, `adr`, `prd`, `readme`, `package_readme`, `example`, and `unknown`.
- Purpose classification order is: frontmatter override, config pattern, path/title rules, content-structure rules, then `unknown`.
- Source alias extraction should cover path aliases, title aliases, heading aliases, symbol aliases, route aliases, package aliases, and filename aliases where deterministic evidence exists.
- Source candidates are aggregated from current chunk candidates using structured source paths.
- Source candidate ranking should keep contributing chunk ranks and scores for explainability.
- The source reranker should consume query intent, query mode, SourceProfile fields, source candidate features, and current chunk evidence.
- The source reranker should produce an explainable feature vector and a final deterministic source score.
- The first production integration should rerank sources over today's candidate set, then select or order chunks within the selected source order.
- Locked Cards bypass source rerank, chunk scoring, and source-scoped chunk selection exactly as today.
- Non-locked Cards remain ranked Context Objects and keep existing `card_type_bias` semantics.
- Evidence Cards promoted by locked-card coverage remain governed by the existing locked-card rules.
- The confidence policy from PRD-0011 remains authoritative for `coverage_confidence`.
- Ranking improvements must not change the public MCP response schema unless an explicit follow-up decision approves a new field.
- Explain and eval diagnostics may add internal/source-rerank detail as long as the stable MCP contract remains compatible.
- Real-corpus reporting should include before/after source rank, source-rerank score, source-rerank reason features, and top-1/top-3 movement.
- The primary success gate is measured on the Phase 8 real-corpus panel.
- Synthetic regression remains a hard floor.
- No learning-to-rank training should happen until there are at least 200 judged cases across at least 8 corpora, including unsupported and ambiguous cases.

## Testing Decisions

- Good tests should verify external ranking behavior and source-profile semantics, not private implementation shape.
- SourceProfile builder tests should cover deterministic title/H1 extraction, headingless docs, heading outlines, aliases, summary provenance, question-heading extraction, and purpose classification.
- Source candidate aggregation tests should verify source grouping, contributing chunk traces, stable ordering, and Card separation.
- Source reranker tests should pin representative source-ranking decisions:
  - canonical quick-start beats incidental migration mention
  - concept or ADR source beats broad reference for decision queries
  - exact symbol source beats sprawling general reference when alias evidence is strong
  - migration or changelog stays competitive when the query asks for migration, upgrade, version, or breaking changes
  - locked Cards remain unaffected
- Presenter or retrieval integration tests should verify final ranked chunks follow source-rerank order while preserving the MCP response shape.
- Slice 0 report tests should verify source-rerank diagnostics and before/after movement are emitted deterministically.
- Real-corpus regression tests should enforce:
  - `critical-source-set recall@50 = 100%`
  - `false-confident unsupported = 0`
  - synthetic regression passes
  - answerable top-1 meets the Slice 2 floor
  - answerable top-3 meets the Slice 2 floor
- Snapshot refreshes are acceptable only when ranking movement is intentional and explained by the source-rerank diagnostics.
- Prior art already exists in source aggregation tests, Slice 0 report tests, presenter tests, MCP schema tests, chunker tests, and real-corpus fixture tests.

## Out of Scope

- Multi-retriever candidate generation
- RRF fusion
- Dense source or chunk retrieval
- Cross-encoder reranking
- LLM pairwise reranking
- Learning-to-rank training
- Full source-first V2 pack verifier
- Assignment-level context assembly verification
- New authoritative Context Object kinds
- Changing locked Card inclusion semantics
- Weakening the PRD-0011 confidence policy
- Repo-specific hard-coded ranking rules

## Further Notes

- This PRD intentionally starts with deterministic source reranking because Slice 0 proved the expected sources are already present. The engine does not need a bigger candidate net yet; it needs better source ordering.
- The highest-risk failure mode is overfitting to the 42-case Phase 8 panel. Feature weights must remain general and explainable across repos.
- The expected next branch after this PRD depends on results. If deterministic source rerank clears the floor but not the ceiling, the next PRD can consider multi-retriever/RRF or optional heavier reranking. If it fails to improve source ordering, we should inspect whether SourceProfile fields are too weak before adding neural machinery.
