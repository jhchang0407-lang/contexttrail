# PRD-0010: Retrieval Engine V2 Slice 0 ceiling probes

> Source-of-truth canonical doc. Intended to be mirrored to the issue tracker as the project's tenth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADR: [ADR-0020](../adr/0020-retrieval-engine-v2-source-first-ceiling-probes.md). Reference plan: [Retrieval Engine V2 Rework Plan](../plan/retrieval-engine-v2-rework-2026-05.md). Related PRDs: [PRD-0005](0005-retrieval-correctness-and-observability.md), [PRD-0006](0006-fact-finding-quality-and-context-assembly-bridge.md).
>
> **Sequencing rule:** Slice 0 is measurement-only. It must produce a branch decision before any source profiles, RRF, reranking, confidence-behavior changes, or MCP/CLI contract changes are implemented.

## Problem Statement

Week 7's broader real-corpus eval showed that the current retrieval pipeline is not reliable enough for high-stakes Context Pack assembly. Phase 8 artifacts showed:

| Surface | Cases | Top-1 acceptable | Top-3/source useful | Coverage honest |
|---|---:|---:|---:|---:|
| All Phase 8 artifacts | 42 | 22/42 | 25/42 | 35/42 |
| Answerable cases | 32 | 19/32 | 25/32 | 32/32 |
| Unsupported cases | 10 | 3/10 | 0/10 | 3/10 |

Those numbers are not enough for context assembly. If an assignment needs five or six retrieval decisions, even 90% per-retrieval accuracy compounds into a bad assignment-level outcome. The V2 north star is therefore **critical-source recall or honest abstention**, not top-1 accuracy.

The current eval output cannot yet answer the most important architectural question:

> Does today's retrieval scorer already have the required sources somewhere in its candidate set, or is candidate generation itself broken?

Without that answer, implementing SourceProfiles, RRF, or reranking would be premature. If the expected sources are absent pre-pack, reranking cannot recover them. If they are present but misordered, source-level reranking is justified. If unsupported cases look inseparable from supported misses, confidence/abstention is the first bottleneck.

PRD-0010 implements the measurement layer needed to make that decision mechanically.

## Solution

Add a Slice 0 ceiling-probe mode to the real-corpus eval and reporting system.

The solution has six parts:

1. **Pre-pack scored candidate capture.** Persist full scored Doc Chunk candidates after scoring and before `min_final_score`, budget packing, and structural assembly.
2. **Source aggregation.** Group scored chunks by `source_path`, dedupe sources, and rank sources by best contributing chunk rank.
3. **Critical-source metrics.** Treat `must_include_sources` as the critical-source set for answerable cases, while keeping `expected_top_source` / `acceptable_top_sources` as top-ranking targets.
4. **Post-hoc oracle analysis.** Estimate reranking ceiling without changing production retrieval behavior.
5. **Unsupported separability audit.** Compare supported and unsupported cases using only features available in Slice 0, while clearly labeling V2-only features as unavailable.
6. **Branch decision report.** Emit a machine-readable and human-readable decision: candidate generation/indexing first, source ranking/aboutness first, confidence/abstention first, or stop for synthetic regression.

This PRD deliberately does not implement V2 retrieval itself. It creates the evidence needed to choose the next PRD.

## User Stories

1. As a ContextTrail maintainer, I want to know whether required sources appear in the pre-pack scored candidate set, so that we can distinguish candidate-generation failures from ranking failures.
2. As a ContextTrail maintainer, I want source recall measured before `min_final_score`, budget packing, and structural assembly, so that packing behavior does not contaminate candidate-generation diagnosis.
3. As a ContextTrail maintainer, I want post-threshold and post-pack recall reported separately, so that I can see where candidates are lost after scoring.
4. As a ContextTrail maintainer, I want chunk candidates grouped into deduped source candidates, so that source-level recall is not guessed from top-3 contexttrails.
5. As a ContextTrail maintainer, I want source aggregation to use structured `source_path`, so that drift parsing is only a temporary reporter shim if structured data is unavailable.
6. As a ContextTrail maintainer, I want `must_include_sources` interpreted as the critical-source set for answerable cases, so that assembly coverage is measured separately from top-ranking quality.
7. As a ContextTrail maintainer, I want `expected_top_source` and `acceptable_top_sources` preserved as ranking targets, so that first-read quality is still visible.
8. As a ContextTrail maintainer, I want unsupported and `signal_empty` cases excluded from critical-source recall, so that empty-corpus honesty is judged by abstention and separability.
9. As a ContextTrail maintainer, I want locked Card correctness measured separately from doc source recall, so that authored operational knowledge does not hide doc retrieval failures.
10. As a ContextTrail maintainer, I want non-locked Cards to participate in ranked metrics without satisfying doc source recall unless a fixture explicitly declares a Card as critical.
11. As a ContextTrail maintainer, I want source-oracle analysis computed post-hoc, so that we can estimate reranking ceiling without building a reranker.
12. As a ContextTrail maintainer, I want oracle all-critical-source coverage, so that multi-source assignments are not reduced to a single top-1 question.
13. As a ContextTrail maintainer, I want unsupported separability features labeled as available-today vs V2-only, so that Slice 0 does not depend on future retrievers.
14. As a ContextTrail maintainer, I want the synthetic 126-case fixture to remain a hard regression gate, so that measurement work cannot accidentally break easy existing behavior.
15. As a ContextTrail maintainer, I want a combined real-corpus report across the Phase 8 repos, so that aggregate claims are mechanically generated rather than hand-summarized.
16. As a ContextTrail maintainer, I want answerable and unsupported cases reported separately, so that unsupported honesty is not hidden inside aggregate top-1.
17. As a ContextTrail maintainer, I want per-intent source recall, so that exact-symbol, broad-domain, decision-lookup, and file-anchored failures point to different next actions.
18. As a ContextTrail maintainer, I want candidate rank, contributing chunks, and score features in the JSON artifact, so that each miss can be diagnosed without rerunning the eval manually.
19. As a ContextTrail maintainer, I want Slice 0 to end with an explicit branch decision, so that the next PRD is based on evidence rather than optimism.
20. As a future V2 implementer, I want this PRD to avoid production retrieval changes, so that any later quality movement can be attributed to the correct implementation slice.

## Implementation Decisions

### Scope boundary

- PRD-0010 is measurement-only.
- It may change eval/reporting code and offline diagnostic artifacts.
- It must not change production retrieval behavior.
- It must not add source profiles, RRF, new scoring behavior, new confidence semantics, or MCP/CLI contract fields.
- It must not require network calls, LLM calls, embedding calls, or external services.

### Candidate capture point

- Capture scored candidates after `scoreCandidates` / `scoreCard` and before `packWithLocked`.
- The ceiling metric uses Doc Chunk candidates before:
  - `min_final_score`
  - budget packing
  - structural assembly
  - MCP presentation ordering
- Candidate rank for Slice 0 uses `final_score` descending, not `packing_score`.
- `packing_score` remains a packer concern and may be reported only as a loss diagnostic.
- If implementation exposes candidate traces by adding internal fields to `RetrievalResult`, those fields must not flow into MCP or CLI output.
- Prefer an eval-only diagnostic path if that keeps the production retrieval result cleaner.

### Source aggregation

For scored Doc Chunk candidates:

```ts
type Slice0ChunkCandidate = {
  rank: number;
  version_id: string;
  source_path: string;
  final_score: number;
  packing_score: number;
  bm25_norm: number;
  heading_match: number;
  scope_match: number;
  mention_overlap: number;
};

type Slice0SourceCandidate = {
  rank: number;
  source_path: string;
  best_chunk_rank: number;
  best_chunk_score: number;
  contributing_chunks: Array<{
    version_id: string;
    rank: number;
    final_score: number;
  }>;
};
```

Aggregation rules:

- Use structured `source_path` from the chunk row.
- ContextTrail parsing is acceptable only as a temporary reporter shim and should be called out in the report if used.
- Group by `source_path`.
- Compute `best_chunk_rank = min(chunk_rank)`.
- Compute `best_chunk_score = max(final_score)`.
- Sort source candidates by `best_chunk_rank`, with `best_chunk_score` as tie-breaker.
- Keep contributing chunk ids/ranks/scores for explainability.
- Ignore Cards for doc source recall unless the fixture explicitly declares a Card as a critical Context Object.

### Label semantics

- `must_include_sources` is the critical-source set for answerable cases.
- `expected_top_source` and `acceptable_top_sources` are top-ranking targets.
- Unsupported and `signal_empty` cases have no critical-source set.
- Locked Card correctness is measured through locked-include gates.
- Non-locked Card ranked usefulness remains visible but separate from doc source recall.

### Metrics

Candidate generation:

- expected source recall@10/@20/@50
- critical-source-set recall@10/@20/@50
- all-critical-sources-covered@10/@20/@50
- expected source candidate rank
- missing critical sources@10/@20/@50

Oracle analysis:

- oracle source top-1@50
- oracle all-critical-source coverage@50
- oracle answerable success@50
- oracle failure reason when expected source is absent

Post-scoring loss diagnostics:

- post-threshold critical-source-set recall@k
- post-pack critical-source-set recall@k
- source-to-threshold loss
- threshold-to-pack loss
- budget-loss source list

Unsupported separability:

- coverage confidence distribution
- query mode distribution
- warning kind distribution
- ranked count
- top-1 score
- top-1/top-2 margin
- top-1/top-3 margin
- provided vs recognized anchor count when `explain.query_compilation` is available
- per-candidate `bm25_norm`, `heading_match`, `scope_match`, `mention_overlap`, `final_score`
- important-token coverage in source path/title/heading/body when deterministically computable
- term rarity / IDF coverage if the reporter can export or recompute it deterministically

Explicitly unavailable in Slice 0:

- retriever agreement
- source alias hit count
- dense/sparse agreement
- generated-question agreement
- source-purpose compatibility from SourceProfiles

These must appear as unavailable, not as zero-valued features.

### Branch decision

The report must emit exactly one primary branch decision:

| Condition | Branch |
|---|---|
| synthetic fixture regresses | `stop_fix_regression` |
| critical-source-set recall@50 < 95% | `candidate_generation_or_indexing` |
| unsupported cases are not separable with available features | `confidence_or_abstention` |
| critical-source-set recall@50 >= 95% and source top-1/top-3 is weak | `source_ranking_or_aboutness` |
| critical-source-set recall@50 >= 95%, source top-3 is strong, unsupported separability is good | `ready_for_source_first_v2_prd` |

If multiple conditions apply, precedence is:

1. `stop_fix_regression`
2. `candidate_generation_or_indexing`
3. `confidence_or_abstention`
4. `source_ranking_or_aboutness`
5. `ready_for_source_first_v2_prd`

The report may also include secondary notes, but the primary branch must be unambiguous.

### CLI and artifact shape

Extend the existing real-corpus eval entrypoint:

```bash
npm run eval:real-corpus -- --ceiling-probes --json
```

Suggested artifact paths:

- `docs/evals/reports/retrieval-v2-slice0-YYYY-MM-DD.json`
- `docs/evals/reports/retrieval-v2-slice0-YYYY-MM-DD.md`

Only the Markdown summary is checked in by default. The full JSON report is a
local generated artifact because real-corpus traces can exceed GitHub's
per-file size limit.

The JSON artifact should include:

- generated timestamp
- repos included
- case count
- answerable/unsupported split
- per-case observations
- pre-pack chunk candidates
- deduped source candidates
- source recall metrics
- oracle metrics
- unsupported separability features
- synthetic regression status
- branch decision

The markdown artifact should include:

- executive summary
- branch decision
- headline metrics
- per-repo summary
- per-intent summary
- top misses table
- unsupported separability summary
- synthetic regression result
- recommended next PRD

## Acceptance Criteria

### Measurement boundary

- Slice 0 does not change MCP `retrieve_context_pack` output.
- Slice 0 does not change CLI `contexttrail context` output.
- Slice 0 does not change scoring, packing, structural assembly, locked-include, or confidence behavior.
- Slice 0 does not create `source_profiles` tables or SourceProfile runtime behavior.
- Slice 0 does not add RRF, dense retrieval, source aliases, generated questions, cross-encoder rerank, or LLM rerank.

### Candidate capture

- The eval captures all scored Doc Chunk candidates before `min_final_score`, budget packing, and structural assembly.
- Candidate rank is sorted by `final_score` descending.
- Each candidate includes enough data to map to `source_path` without drift parsing.
- If drift parsing is used temporarily, the report marks this as a diagnostic limitation.

### Source metrics

- The combined report includes expected source recall@10/@20/@50.
- The combined report includes critical-source-set recall@10/@20/@50.
- The combined report includes all-critical-sources-covered@10/@20/@50.
- The combined report includes expected source candidate rank.
- Metrics are reported for all repos together, per repo, and per query intent.
- Answerable and unsupported cases are reported separately.

### Oracle analysis

- Oracle source top-1@50 is computed post-hoc from enriched eval JSON.
- Oracle all-critical-source coverage@50 is computed post-hoc.
- Oracle analysis does not require any production reranker.
- Oracle failures identify whether the expected source was absent or present but misordered.

### Unsupported separability

- The unsupported audit compares supported and unsupported cases using available Slice 0 features.
- V2-only features are listed as unavailable, not silently omitted or filled with fake values.
- The report identifies false-confident unsupported cases.
- The report explains whether unsupported separability is sufficient, weak, or inconclusive.

### Regression safety

- The synthetic 126-case fixture remains a hard regression gate.
- A synthetic pass has no positive ship power.
- A synthetic regression forces branch decision `stop_fix_regression`.
- Existing real-corpus baseline metrics remain reproducible.

### Branch decision

- The report emits exactly one primary branch decision.
- The branch decision follows the precedence table in this PRD.
- The report names the recommended next PRD:
  - Candidate Generation / Indexing Rework
  - SourceProfile + Source Rerank
  - Confidence / Abstention Rework
  - Fix Slice 0 Regression
  - Full Source-First V2 Implementation

## Testing Decisions

- Add unit tests for source aggregation:
  - multiple chunks from one source dedupe into one source candidate
  - `best_chunk_rank` uses minimum rank
  - `best_chunk_score` uses maximum score
  - ordering uses `best_chunk_rank`, then `best_chunk_score`
- Add tests for label interpretation:
  - `must_include_sources` drives critical-source-set recall
  - `expected_top_source` drives ranking target metrics
  - unsupported cases skip critical-source recall
  - Cards do not satisfy doc source recall unless explicitly declared critical
- Add tests for oracle analysis:
  - expected source present at rank 20 counts for oracle@50
  - missing expected source fails oracle@50
  - all-critical-source oracle requires every critical source
- Add tests for branch decision precedence:
  - synthetic regression beats all other branches
  - low critical-source recall beats ranking/aboutness
  - unsupported inseparability beats ready branch
  - high recall plus weak top ranking produces source-ranking branch
- Add snapshot or golden tests for the human-readable report.
- Add schema tests for the JSON artifact shape.
- Run `npm test` and `npm run eval:real-corpus -- --ceiling-probes --json` before accepting the slice.

## Out Of Scope

- SourceProfiles implementation.
- `source_profiles` schema or FTS tables.
- RRF or multi-retriever fusion.
- Alias retrievers.
- Dense retrieval or embeddings.
- Cross-encoder or LLM reranking.
- Confidence behavior changes in production.
- New MCP or CLI contract fields.
- Pack verifier implementation.
- Context assembly loop changes.
- Setup confidence, bootstrap, inbox, or triage changes.
- New learned ranker or learning-to-rank training.
- Any rule special-cased to a repo, source path, fixture id, or case id.

## Open Implementation Notes

- The cleanest implementation is likely an eval-only diagnostic path that reuses the existing retrieval stages up through scoring and then stops before packing.
- If that causes too much duplication, adding internal candidate traces to `RetrievalResult` is acceptable only if MCP/CLI presentation ignores them and contract-equivalence tests prove no wire change.
- Source recall should prefer structured chunk rows over rendered contexttrails. ContextTrail parsing is acceptable only as a short-lived bridge.
- The existing real-corpus eval already has `must_include_sources`, `expected_top_source`, `acceptable_top_sources`, `expectation_kind`, and query intent labels. PRD-0010 should reuse those rather than inventing a new fixture schema for Slice 0.
- The current 42-case Phase 8 panel is enough for diagnosis, not training. No learned ranker is permitted from this PRD's output.

## Expected Outcome

PRD-0010 is successful when the team can answer, with artifacts rather than intuition:

1. Are required sources present in today's pre-pack candidate set?
2. Would perfect source reranking solve most answerable misses?
3. Are unsupported cases separable enough to support honest abstention?
4. Does measurement preserve the synthetic regression gate?
5. Which implementation PRD should come next?

The point is not to make retrieval better yet. The point is to make the next retrieval rework impossible to aim at the wrong bottleneck.
