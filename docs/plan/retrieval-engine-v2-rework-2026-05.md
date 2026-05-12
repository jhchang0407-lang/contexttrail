# Retrieval Engine V2 Rework Plan - 2026-05

> Status: **proposed architecture rework**
>
> Source: [Week 7 session summary](week-7-session-summary-2026-05.md), Phase 8 real-corpus baselines under `docs/evals/baselines/real-corpus/*-2026-05-08-phase8.json`, and a research pass over classic IR, neural reranking, RAG evaluation, hierarchical retrieval, and repository-level code retrieval.
>
> Governing decision: [ADR-0020](../adr/0020-retrieval-engine-v2-source-first-ceiling-probes.md).
>
> Decision frame: ADR-0019 remains historical context for deterministic hardening. Retrieval Engine V2 supersedes it for the high-ceiling source-first architecture path.

## Executive Summary

The Week 7 engine is not failing because one or two weights are wrong. It is failing because the retrieval architecture is still **chunk-first**:

```text
query -> chunk BM25F -> chunk score -> pack
```

That architecture cannot reliably tell the difference between:

- a doc that **mentions** a topic in a migration guide, changelog, or reference page
- a doc that **is about** the topic and should be the canonical first read

The rework should move to a multi-stage retrieval cascade:

```text
query understanding
-> multi-retriever candidate generation
-> source-level reranking
-> chunk selection within selected sources
-> pack coverage verification
-> fail closed or ask for anchors when confidence is weak
```

The core bet is that ContextTrail needs to retrieve and rank **sources first**, then select chunks. Chunk-level scoring remains useful, but only after the engine has identified which docs are truly about the task.

Cards are not replaced by this architecture. V2 preserves the existing Cards contract:

- locked Cards still bypass scoring and packing competition
- non-locked Cards still compete with docs, with `card_type_bias` applied as today
- source-first retrieval extends the ranked-doc path; it does not weaken locked-include guarantees

This is worth doing because the current eval already shows latent recoverability:

| Surface | Cases | Top-1 acceptable | Top-3/source useful | Coverage honest |
|---|---:|---:|---:|---:|
| All Phase 8 artifacts | 42 | 22/42 | 25/42 | 35/42 |
| Answerable cases | 32 | 19/32 | 25/32 | 32/32 |
| Unsupported cases | 10 | 3/10 | 0/10 | 3/10 |

The answerable top-3 gap says the right material is often present but misordered. The unsupported-query result says confidence is still not calibrated. Both are architectural, not merely tuning problems.

## Why The Current Architecture Has A Ceiling

### Compounding Reliability

Context assembly will often use 5-6 retrieval decisions for one assignment. If each retrieval is only 90% reliable and all are required:

```text
0.90^6 = 53%
0.95^6 = 74%
0.98^6 = 89%
0.99^6 = 94%
```

So "90% retrieval accuracy" is not an acceptable production substrate. For assembly, the target is not top-1 perfection alone. The target is:

- near-perfect **critical-source recall**
- strong **pack-level all-needed-source coverage**
- low-noise ranking
- honest abstention when the corpus cannot support the task

### Normalized Scores Are Not Confidence

The current confidence model still leans on displayed score thresholds. But final scores are query-local and partly normalized, so a bad unsupported query can still produce a high "confident" score if one irrelevant candidate is the strongest irrelevant match. This is exactly why unsupported cases like Kubernetes, Redis, CLI support, and Android deployment can appear confident.

Coverage confidence must be based on raw evidence quality, retriever agreement, source-purpose compatibility, query-term coverage, and top-result margin, not just normalized final score.

### Chunk-First Retrieval Loses Aboutness

Chunk ranking rewards local term density. That is enough for many exact searches, but weak for docs with multiple doc types:

- migration guide: mentions many topics
- changelog: mentions many changed features
- reference page: mentions many API nouns
- concept page: explains one topic
- quick start: covers onboarding intent

The current engine scores chunks, then tries to infer usefulness from chunk-level features. It needs to decide source-level aboutness first.

## Research Findings

### 1. BM25F Is A Strong First Stage, Not A Complete Ranking System

Robertson, Zaragoza, and Taylor's BM25F work exists because structured documents need field-aware scoring, but it remains a first-stage lexical ranking method. Robertson and Zaragoza's later overview explicitly covers BM25, BM25F, feedback, metadata, positional information, and parameter optimization as parts of a broader IR system.

Implication for ContextTrail:

- Keep BM25F.
- Use it for high-recall candidate generation.
- Do not expect BM25F alone to solve canonical-source ranking or confidence.

Sources:

- [The Probabilistic Relevance Framework: BM25 and Beyond](https://www.nowpublishers.com/article/Details/INR-019)
- [Simple BM25 extension to multiple weighted fields](https://www.researchgate.net/publication/221613382_Simple_BM25_extension_to_multiple_weighted_fields)

### 2. Rank Fusion Is A Robust Way To Combine Different Retrieval Signals

Reciprocal Rank Fusion (RRF) is a simple unsupervised method for combining rankings from multiple systems, and the SIGIR 2009 paper reports it outperforming individual rankers and Condorcet-style fusion on TREC-style settings.

Implication for ContextTrail:

- Do not hand-blend every retriever score into one fragile scalar.
- Generate several ranked candidate lists, then fuse them.
- Use fused rank for candidate recall, then rerank with richer features.

Source:

- [Reciprocal Rank Fusion outperforms Condorcet and Individual Rank Learning Methods](https://research.google/pubs/reciprocal-rank-fusion-outperforms-condorcet-and-individual-rank-learning-methods/)

### 3. Dense Retrieval Helps Recall, But Dense-Only Is Not Safe Enough

DPR reported large top-20 retrieval gains over a strong BM25 baseline on open-domain QA, but later benchmark work like BEIR shows retrieval model performance varies under domain shift. SPLADE and related learned sparse models are also attractive because they keep inverted-index behavior while adding learned expansion.

Implication for ContextTrail:

- Add dense retrieval as one candidate generator, not the substrate.
- Keep sparse lexical matching, path/symbol aliases, and source metadata.
- Prefer hybrid retrieval plus fusion over dense-only ranking.

Sources:

- [Dense Passage Retrieval for Open-Domain Question Answering](https://aclanthology.org/2020.emnlp-main.550/)
- [BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models](https://huggingface.co/papers/2104.08663)
- [SPLADE v2](https://europe.naverlabs.com/research/publications/splade-v2/)

### 4. Cross-Encoders And LLM Rerankers Are The Precision Layer

BERT passage reranking significantly improved MS MARCO/TREC-CAR ranking quality. RankT5 and pairwise LLM ranking continue the same theme: once candidate recall is good, expensive rerankers can produce large top-rank precision gains.

Implication for ContextTrail:

- Use deterministic source reranking as the baseline.
- Add an optional cross-encoder or LLM pairwise reranker for top-N sources when local model/runtime policy allows it.
- Use it after candidate recall is high, not as a replacement for candidate generation.

Sources:

- [Passage Re-ranking with BERT](https://huggingface.co/papers/1901.04085)
- [RankT5](https://research.google/pubs/rankt5-fine-tuning-t5-for-text-ranking-with-ranking-losses/)
- [Large Language Models are Effective Text Rankers with Pairwise Ranking Prompting](https://aclanthology.org/2024.findings-naacl.97/)

### 5. Hierarchical Retrieval Addresses The Chunk-Only Blind Spot

RAPTOR retrieves over a tree of summaries to capture multiple abstraction levels. GraphRAG builds graph/community summaries for broad corpus-level questions. Both respond to a common RAG failure: short chunks alone do not represent whole-document or whole-corpus meaning well.

Implication for ContextTrail:

- Add source-level profiles and summaries.
- Use source-level retrieval for "what is this about?" and "which doc should I read first?"
- Use chunk-level retrieval for the precise section once the source is chosen.

Sources:

- [RAPTOR](https://proceedings.iclr.cc/paper_files/paper/2024/hash/8a2acd174940dbca361a6398a4f9df91-Abstract-Conference.html)
- [From Local to Global: A Graph RAG Approach to Query-Focused Summarization](https://www.microsoft.com/en-us/research/publication/from-local-to-global-a-graph-rag-approach-to-query-focused-summarization/)

### 6. Repository-Level Code Retrieval Benefits From Iteration And Selectivity

RepoCoder improves repository-level code completion with iterative retrieval-generation. Repoformer argues unconditional retrieval can be harmful and proposes selective retrieval.

Implication for ContextTrail:

- Context assembly should not blindly run six independent retrieval calls.
- It should decompose tasks, retrieve candidates, verify coverage, and optionally run targeted follow-up retrieval.
- It should skip or fail closed when retrieval is likely harmful.

Sources:

- [RepoCoder](https://huggingface.co/papers/2303.12570)
- [Repoformer](https://huggingface.co/papers/2403.10059)

### 7. RAG Evaluation Must Separate Retrieval, Context Relevance, And Task Success

ARES evaluates context relevance, answer faithfulness, and answer relevance. RAGAS similarly separates context precision/recall and generation quality. This matches ContextTrail's problem: top-1 retrieval is not enough to judge context assembly.

Implication for ContextTrail:

- Track candidate recall, source ranking, pack coverage, abstention, and agent-task success separately.
- Use top-1 only as a diagnostic.
- Add assignment-level eval before calling the engine production-ready.

Sources:

- [ARES](https://aclanthology.org/2024.naacl-long.20/)
- [RAGAS](https://huggingface.co/papers/2309.15217)

## Why This Should Yield Better Results

| Observed failure | Current cause | V2 change |
|---|---|---|
| TanStack TypeScript canonical doc loses to migration guide | chunk-level term density in migration guide beats canonical source | source-purpose classification + source-level aboutness rerank demotes migration for concept/API queries |
| TanStack Devtools canonical doc loses to migration guide | migration guide mentions devtools as one changed feature | source aliases and source-purpose compatibility prefer `devtools.md` |
| Prisma shadow database concept loses to baselining workflow | workflow page discusses shadow DB heavily | decision/concept intent reranks source type and title/path aboutness over body density |
| Prisma generator doc loses to broad schema reference | reference page has many schema terms | source-level canonical topic matching lifts `generators.md` |
| Bun exact symbols miss small API docs | source/chunk lexical score diluted or wrong source wins | exact alias/symbol retriever plus source reranking |
| Unsupported queries return confident docs | confidence uses relative score, not corpus support | confidence model uses raw coverage, retriever agreement, unsupported detection, and abstention |
| Multi-hop assembly compounds errors | independent top-1 calls have multiplicative failure | pack verifier checks all required subgoals before returning "ready" |

The key improvement is that V2 optimizes for **critical-source recall or honest abstention**, not only chunk top-1. Top-1 remains a ranking diagnostic, but the assembly-safe outcome is either "all required sources are covered" or "the engine refuses to claim readiness."

## Accuracy Floor And Ceiling

These are estimates, not guarantees. They are framed as operational bands so we can decide whether the rework is paying for itself.

### Current Phase 8 Artifact Baseline

| Metric | Current |
|---|---:|
| All-case top-1 acceptable | 22/42 = 52.4% |
| Answerable top-1 acceptable | 19/32 = 59.4% |
| Answerable top-3/source useful | 25/32 = 78.1% |
| Unsupported honesty | 3/10 = 30.0% |

### Conservative Floor After Complete V2

This is the result I would expect if source-level candidate generation and deterministic reranking work, but no neural reranker is strong enough to trust by default.

| Metric | Floor |
|---|---:|
| Answerable source recall@20 | 90-95% |
| Answerable top-1 source acceptable | 78-85% |
| Answerable top-3/source useful | 90-95% |
| Unsupported honesty | 80-90% |
| Pack all-critical-source coverage | 80-90% |

If we do not clear this floor, the rework is underbuilt or the candidate generator is still broken.

### Expected Outcome With Hybrid Retrieval + Source Rerank + Verifier

This is the target range for a solid V2 without requiring an always-on remote LLM.

| Metric | Expected |
|---|---:|
| Answerable source recall@20 | 95-98% |
| Answerable top-1 source acceptable | 85-92% |
| Answerable top-3/source useful | 95-98% |
| Unsupported honesty | 90-96% |
| Pack all-critical-source coverage | 90-96% |

This still may not be enough for unattended production context assembly, but it is a meaningful jump from the current engine and should make assignment-level verification feasible.

### Ceiling With Optional Cross-Encoder/LLM Rerank + More Labels

This is the practical ceiling I believe is reachable if we add an optional heavier reranker and expand eval labels beyond the current 42-case panel.

| Metric | Ceiling |
|---|---:|
| Critical-source recall@50 | 98-99%+ |
| Answerable source recall@20 | 97-99% |
| Answerable top-1 source acceptable | 92-96% |
| Answerable top-3/source useful | 97-99% |
| Unsupported honesty | 97-99% |
| Pack all-critical-source coverage with fail-closed behavior | 95-98% |

The important nuance: we should not expect 99% top-1 on every ambiguous natural-language query. The production goal should be 99% **critical-source recall or honest abstention**, not pretending every query has one obvious top answer.

### What Determines Whether The Ceiling Is High

The ceiling depends on where the current misses happen:

| Slice 0 finding | Meaning | Ceiling implication |
|---|---|---|
| Expected source is already in deduped source top-50 on 97-99% of answerable cases | candidate generation has enough raw signal | V2 can plausibly reach the high-ceiling band through source reranking, chunk selection, and verification |
| Expected source is in top-50 on only 85-90% of answerable cases | reranking cannot recover enough failures | V2 must prioritize candidate generation and query expansion before reranking |
| Oracle source rerank reaches 95%+ answerable success | ranking is the main bottleneck | source profiles and deterministic rerank are worth the rework |
| Oracle source rerank remains below 90% | even perfect ordering of current candidates is insufficient | chunk production, source mapping, anchors, or corpus coverage are broken |
| Unsupported cases separate cleanly on available raw features | abstention can be reliable without a model | high confidence ceiling is realistic |
| Unsupported cases look identical to supported misses | confidence requires stronger retrieval features or a verifier | top-1 may improve, but unattended assembly remains unsafe |

### No-Go Thresholds

Stop and rethink again if any of these are true after ceiling probes:

- Expected source is absent from candidate source top-50 on more than 5% of answerable cases.
- Oracle source reranking cannot reach at least 95% answerable success.
- Unsupported queries remain inseparable from supported queries using raw evidence features.
- Pack verifier cannot detect missing critical subgoals on multi-source tasks.

## Implementation Plan

### Phase 0 - Measurement And Ceiling Probes

Goal: prove whether V2 can reach the desired ceiling before doing the full rework.

Boundary:

- Slice 0 is measurement-only.
- It may change eval/reporting code and offline diagnostic artifacts.
- It must not change production retrieval behavior.
- It must not add source profiles, RRF, new scoring behavior, new confidence semantics, or MCP/CLI contract fields.
- Its source-recall ceiling metric is measured after scoring and before `min_final_score`, budget packing, and structural assembly.
- It may additionally report post-threshold and post-pack recall as loss diagnostics.

Implementation:

- Add a combined real-corpus reporter for all repos.
- Report answerable and unsupported cases separately.
- Interpret labels as:
  - `must_include_sources` is the critical-source set for answerable cases
  - `expected_top_source` and `acceptable_top_sources` are top-ranking targets
  - unsupported / `signal_empty` cases have no critical-source set and are scored on honest abstention and separability
- Add source aggregation over today's chunk-ranked output:
  - extract `source_path` from each ranked chunk, preferably from structured chunk metadata; drift parsing is acceptable only as a temporary reporter shim
  - ignore Cards for source-recall metrics unless the case explicitly expects a Card; real-corpus Phase 8 is docs-only
  - measure locked Cards through locked-include correctness gates, not source recall
  - allow non-locked Cards in ranked metrics, but do not let them satisfy doc source recall unless a fixture explicitly declares a Card as a critical Context Object
  - group by `source_path`
  - compute `best_chunk_rank = min(chunk_rank)` for each source
  - compute `best_chunk_score = max(chunk_score)` for diagnostics
  - keep contributing chunk ids/ranks/scores so the aggregation is explainable
  - order deduped sources by `best_chunk_rank`, with `best_chunk_score` only as a tie-breaker
- Add pre-pack candidate dumps to the eval JSON for:
  - full scored chunk candidates, not just top-3 packed output
  - deduped source candidates
  - candidate source recall@10/@20/@50
  - expected source rank
  - oracle source top-1
  - raw confidence features available today
- Add source-oracle evaluation:
  - first implement as post-hoc analysis on enriched eval JSON, not score-time injection
  - if the expected source is present anywhere in deduped candidate source top-N, force that source to rank 1 and score the case
  - for multi-source `must_include_sources`, report both top-1 oracle and all-required-source oracle coverage
  - this estimates the maximum value of reranking without changing candidate generation
- Add unsupported separability audit:
  - compare supported and unsupported cases using features available today
  - keep future V2-only signals in a separate "not available yet" column

Source aggregation pseudocode:

```ts
type ChunkCandidate = {
  rank: number;
  id: string;
  kind: "chunk" | "card";
  source_path?: string;
  contexttrail: string;
  score: number;
};

type SourceCandidate = {
  rank: number;
  source_path: string;
  best_chunk_rank: number;
  best_chunk_score: number;
  contributing_chunks: Array<{ id: string; rank: number; score: number }>;
};

function aggregateSources(chunks: ChunkCandidate[]): SourceCandidate[] {
  const bySource = new Map<string, SourceCandidate>();
  for (const chunk of chunks) {
    if (chunk.kind !== "chunk") continue;
    const sourcePath = chunk.source_path ?? parseSourceFromContextTrail(chunk.contexttrail);
    if (!sourcePath) continue;
    const existing = bySource.get(sourcePath);
    if (!existing) {
      bySource.set(sourcePath, {
        rank: 0,
        source_path: sourcePath,
        best_chunk_rank: chunk.rank,
        best_chunk_score: chunk.score,
        contributing_chunks: [{ id: chunk.id, rank: chunk.rank, score: chunk.score }],
      });
      continue;
    }
    existing.best_chunk_rank = Math.min(existing.best_chunk_rank, chunk.rank);
    existing.best_chunk_score = Math.max(existing.best_chunk_score, chunk.score);
    existing.contributing_chunks.push({ id: chunk.id, rank: chunk.rank, score: chunk.score });
  }
  return [...bySource.values()]
    .sort((a, b) => a.best_chunk_rank - b.best_chunk_rank || b.best_chunk_score - a.best_chunk_score)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}
```

Unsupported separability features for Slice 0:

| Signal | Available today? | Source |
|---|---|---|
| `coverage_confidence` | yes | response |
| `query_mode` | yes | response |
| warning kinds | yes | response |
| ranked count | yes | response |
| top-1 score | yes | ranked output |
| top-1/top-2 margin | yes, if full ranked list is persisted | ranked output |
| top-1/top-3 margin | yes | top-3 output |
| provided vs recognized anchor count | yes, if `explain.query_compilation` is persisted | explain output |
| per-candidate `bm25_norm`, `heading_match`, `scope_match`, `mention_overlap`, `final_score` | yes, if `explain.per_chunk` is persisted | explain output |
| query important-token coverage in top source path/title/heading/body | yes, but reporter must compute it deterministically | eval reporter + source/chunk text |
| term rarity / IDF coverage | partial; only after reporter exports or recomputes FTS stats | eval reporter |
| retriever agreement | no | requires Slice 2 multi-retriever lists |
| alias hit count | partial; `mention_overlap` exists, source alias hits require Slice 1/2 |
| dense/sparse agreement | no | requires optional dense retriever |

Acceptance gates:

- Combined report is generated mechanically, not hand-summarized.
- Every Phase 8 case has candidate recall diagnostics.
- Source recall is computed from deduped chunk output using `source_path`, not by eyeballing top-3 contexttrails.
- Oracle rerank ceiling is computed post-hoc from enriched eval JSON before any production reranker exists.
- Unsupported separability report labels which features are available today vs V2-only.
- We know whether current retrieval already contains enough signal to rerank, or whether candidate generation itself must be rebuilt first.

### Phase 1 - Source Profiles As First-Class Retrieval Index Metadata

Goal: stop treating docs as accidental aggregates of chunks.

New concept:

```text
SourceProfile
```

A `SourceProfile` represents one imported markdown source. It is not authoritative prose; it is a retrieval index object.

It is not a new Context Object kind. Agents do not cite `SourceProfile` content as authority, locked Cards do not link to it, and final Context Packs continue to contain Doc Chunks and Cards. Source profiles are rebuildable cache/index metadata used to rank sources and explain why a source entered the candidate set.

Suggested fields:

- `source_path`
- `title`
- `h1`
- `intro`
- `heading_outline`
- `doc_role` - existing authority/demotion role
- `doc_purpose` - new format/purpose classifier
- `path_aliases`
- `title_aliases`
- `heading_aliases`
- `symbol_aliases`
- `route_aliases`
- `package_aliases`
- `summary`
- `questions_answered`
- `summary_source`
- `questions_answered_source`
- `chunk_count`
- `token_count`
- `source_content_hash`
- `indexed_at`

Important split:

- `doc_role` answers: "is this source trusted/canonical/archive/example?"
- `doc_purpose` answers: "what kind of document is this?"

Suggested `doc_purpose` enum:

- `concept`
- `api_reference`
- `guide`
- `quick_start`
- `migration`
- `changelog`
- `release_note`
- `runbook`
- `adr`
- `prd`
- `readme`
- `package_readme`
- `example`
- `unknown`

Classification order:

1. frontmatter override
2. config pattern
3. path/title deterministic rules
4. content-structure rules
5. default `unknown`

Do not use source-specific if statements. Rules must generalize across corpora.

Deterministic provenance rules:

- `summary` in V2 v1 is deterministic: title/H1 plus first non-empty intro paragraph, capped to a fixed character/token budget.
- `summary_source` records `deterministic_intro`, `frontmatter`, or `empty`.
- `questions_answered` is optional in V2 v1. If present, it is extracted only from headings that are already question-shaped, such as headings ending in `?` or starting with `how`, `why`, `what`, `when`, `where`, `which`, `can`, `should`, `do`, `does`, `is`, or `are`.
- `questions_answered_source` records `heading_question_extraction` or `empty`.
- No LLM call is required at index time for source profiles. Any LLM-generated summary or generated-question field is a later, separately gated enhancement.

### Phase 1.5 - Cards In The Source-First Flow

Goal: keep the Cards story intact while source-first retrieval improves docs.

Rules:

- Locked Cards are resolved before ranked retrieval exactly as D37, D38, D39, and D43 specify.
- Locked Cards bypass source scoring, chunk scoring, `card_type_bias`, RRF, and neural rerank.
- Locked Cards consume `locked_overhead` exactly as today; V2 cannot evict them to make source ranking prettier.
- Non-locked Cards participate in ranked retrieval as first-class context objects.
- For retrieval purposes, a non-locked Card gets a `CardProfile` analogous to `SourceProfile`: card id, card file path, card type, title, body excerpt, scope, symbol anchors, linked source paths, freshness, and authority.
- Non-locked Cards keep the D42 `card_type_bias` after their relevance score is computed.
- Evidence Cards promoted by one-hop locked-card coverage remain locked; otherwise they are normal non-locked ranked candidates.
- The pack verifier treats locked Cards as already-satisfied hard rules, but still verifies whether the selected doc chunks provide enough implementation evidence when the task needs code/doc semantics.

Acceptance gates:

- Existing locked-include tests still pass byte-for-byte unless a deliberate contract ADR changes them.
- `card_type_bias` applies only to non-locked Cards.
- A V2 source rerank cannot demote, drop, or reorder locked Cards out of their rendered locked sections.
- Explain output clearly separates `locked_card`, `ranked_card`, `source_candidate`, and `chunk_candidate`.

### Phase 2 - Multi-Retriever Candidate Generation

Goal: maximize recall before any precision reranking.

Candidate generators:

- Source BM25F over title, path, headings, intro, deterministic summary, and deterministic questions_answered when present.
- Chunk BM25F over title, heading_path, body.
- Exact alias retriever for symbols, code identifiers, path segments, package names, filenames.
- Purpose-aware path retriever for docs like `quick-start.md`, `typescript.md`, `glob.md`, `shadow-database.md`.
- Dense source embedding retriever.
- Dense chunk embedding retriever.
- Optional generated-question retriever: index "questions this doc answers" as a field.

Fusion:

- Use RRF to combine ranked lists from each candidate generator.
- Keep per-generator ranks for explainability.
- Do not prematurely collapse everything into one opaque score.

Output:

```text
CandidateSet {
  source_candidates: SourceCandidate[]
  chunk_candidates: ChunkCandidate[]
  diagnostics: RetrieverContribution[]
}
```

Acceptance gates:

- Answerable expected source recall@50 >= 95%.
- No single retriever is required for all cases.
- Candidate generation is explainable by retriever contributions.

Implementation slices inside Phase 2:

- 2a: source BM25F plus today's chunk-to-source aggregation.
- 2b: exact alias and purpose-aware path retrievers.
- 2c: RRF fusion with per-retriever contribution traces.
- 2d: optional dense source/chunk retrievers behind a flag.

Slice 0 does not require this infrastructure. Slice 0 measures the current substrate and oracle ceiling first; Phase 2 is where the multi-retriever work begins.

### Phase 3 - Source-Level Reranking

Goal: choose the best doc/source before choosing the best chunk.

Feature groups:

#### Lexical Features

- source BM25F score
- max chunk BM25F score within source
- query-token coverage in title/path/H1
- phrase/proximity match in title/heading
- exact alias hit count
- filename/parent-dir overlap

#### Aboutness Features

- all important query terms in source aliases
- title/path matches query subject
- H1 matches query subject
- heading outline contains topic as primary heading
- source intro/summary matches query
- doc is concise and topic-specific rather than sprawling

#### Purpose/Intent Compatibility

- `decision_lookup` prefers `adr`, `concept`, `runbook`
- `exact_symbol` prefers `api_reference`, source alias hits, symbol hits
- `broad_domain` prefers `concept`, `quick_start`, `guide`, `readme`
- `file_anchored` prefers exact path/scope/symbol support
- `signal_empty` does not prefer any source unless corpus support is clear

#### Distractor Penalties

- migration/changelog/release notes demoted unless query asks for migration, upgrade, changelog, version, breaking changes
- reference pages demoted for "why/what problem/tradeoff" queries unless exact API symbol intent is present
- sprawling docs demoted when a concise source matches title/path/alias
- package README demoted when a more specific doc has exact alias support

#### Semantic Features

- dense source similarity
- dense chunk max similarity
- optional cross-encoder score for top-N sources
- optional LLM pairwise preference for close-call top sources

Implementation detail:

- Start with a deterministic feature-based scorer.
- Log every feature per source candidate.
- Keep the scorer shaped like a learning-to-rank feature vector even before training a model.
- Do not train a ranker until there are enough labels. With 42 cases, training would overfit.
- Do not train or tune LTR until there are at least 200 judged cases across at least 8 corpora, including unsupported and ambiguous cases.

Acceptance gates:

- Every source-rerank decision can be explained.
- Source-level top-1 improves without hiding source recall regressions.
- Migration/reference distractor cases improve as a class, not one by one.

### Phase 4 - Chunk Selection Inside Selected Sources

Goal: once the engine knows which source is about the task, pick the right sections.

Selection strategy:

1. Choose top source candidates.
2. Within each selected source, rank chunks using:
   - chunk BM25F
   - heading relevance
   - section position
   - intro/overview preference
   - exact heading/alias match
   - neighboring section usefulness
3. Include a small number of chunks per source:
   - primary chunk
   - optional intro/overview
   - optional sibling/neighbor if needed for assembly

Key rule:

- Do not let a wrong-source chunk beat a right-source doc just because the chunk has high local lexical density.

Acceptance gates:

- Top source and top chunk are evaluated separately.
- A source can be correct even if the first chunk needs tuning.
- Chunk selection does not regress source-level recall.

### Phase 5 - Pack Coverage Verifier

Goal: context assembly should fail closed when it lacks required context.

Verifier inputs:

- original task
- inferred query intent
- requested anchors
- selected sources
- selected chunks
- source profiles
- warnings
- confidence features

Verifier responsibilities:

- Decompose the task into required context needs.
- Check whether each need is supported by at least one selected source/chunk.
- Detect unsupported queries or missing source coverage.
- Return an assembly readiness state.

Suggested readiness states:

- `ready`
- `partial`
- `needs_anchors`
- `unsupported`
- `low_confidence`

For v1 of the verifier, use deterministic decomposition:

- file/symbol/route anchors
- query intent
- domain nouns
- decision/rationale markers
- exact API/class/function symbols

Optional later:

- LLM verifier for complex multi-hop tasks.
- The LLM verifier may judge coverage but must cite selected sources/chunks.

Acceptance gates:

- Unsupported cases no longer return confident packs.
- Multi-source tasks expose missing required sources.
- The engine can say "I do not have enough grounded context" without treating that as failure.

### Phase 6 - Confidence Model Rework

Goal: make `coverage_confidence` an evidence-quality result, not a score threshold.

Features:

- source candidate recall strength
- source top margin
- retriever agreement count
- exact alias hits
- title/path/H1 coverage
- important-token coverage
- dense/sparse agreement
- doc-purpose compatibility
- unsupported-domain indicators
- whether selected chunks support all required subgoals

Suggested output:

```text
coverage_confidence:
  state: confident | uncertain | empty
  reason_codes:
    - strong_alias_match
    - multi_retriever_agreement
    - weak_query_coverage
    - unsupported_domain_terms
    - missing_required_source
    - low_top_margin
```

Important:

- Confidence is not "top score > threshold."
- Confidence should be calibrated against unsupported negative cases.
- "uncertain" is a successful outcome for many unsupported or under-anchored queries.

Acceptance gates:

- Unsupported honesty >= 90% before calling V2 useful.
- False-confident unsupported cases are treated as release blockers.
- Confidence reason codes are visible in `explain`.

### Phase 7 - Optional Neural Rerank Layer

Goal: use model-based ranking only where it has the right shape and enough candidate recall.

Options:

- local cross-encoder rerank for top 20 sources
- LLM pairwise rerank for top 5-10 close-call sources
- source-summary rerank instead of full-doc rerank for speed

Rules:

- Never use neural rerank before candidate generation is high recall.
- Keep deterministic rank and neural rank separately visible.
- Neural rerank must be intent-gated.
- Neural rerank must not override unsupported-query abstention.
- Cache source embeddings and source summaries at index time.

Acceptance gates:

- Neural rerank improves held-out real-corpus source top-1 by a meaningful margin.
- It does not reduce unsupported honesty.
- It has an opt-out path for local-first users.

### Phase 8 - Iterative And Selective Retrieval For Context Assembly

Goal: do not build context assembly as "run six independent retrievals and hope."

Assembly loop:

```text
task -> decompose needs
-> retrieve high-recall source candidates per need
-> fuse and rerank sources
-> select chunks
-> verify coverage
-> if missing and recoverable, issue targeted follow-up retrieval
-> if still missing, fail closed or ask for anchors
```

Selective behavior:

- If task is already anchor-complete, do not broaden unnecessarily.
- If retrieval is low-confidence, ask for anchors or return partial.
- If a follow-up query is needed, it should target a missing need, not rerun the whole query.

Acceptance gates:

- Assignment-level eval reports all-required-source coverage.
- Follow-up retrieval improves missing coverage without exploding noise.
- The verifier can stop the assembly loop.

## Data Model Sketch

Possible additive tables:

```sql
CREATE TABLE source_profiles (
  source_path TEXT PRIMARY KEY,
  source_content_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  h1 TEXT,
  intro TEXT,
  heading_outline TEXT NOT NULL,
  doc_role TEXT NOT NULL,
  role_source TEXT NOT NULL,
  doc_purpose TEXT NOT NULL,
  purpose_source TEXT NOT NULL,
  summary TEXT,
  summary_source TEXT NOT NULL,
  questions_answered TEXT,
  questions_answered_source TEXT NOT NULL,
  chunk_count INTEGER NOT NULL,
  token_count INTEGER NOT NULL,
  indexed_at TEXT NOT NULL
);

CREATE TABLE source_aliases (
  source_path TEXT NOT NULL,
  alias_kind TEXT NOT NULL,
  alias_value TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (source_path, alias_kind, alias_value)
);

CREATE VIRTUAL TABLE source_profiles_fts USING fts5(
  title,
  source_path,
  heading_outline,
  intro,
  summary,
  questions_answered,
  content='source_profiles',
  content_rowid='rowid'
);
```

Embedding storage can be additive:

```sql
ALTER TABLE source_profiles ADD COLUMN embedding BLOB;
ALTER TABLE source_profiles ADD COLUMN embedding_model TEXT;
```

Do not remove chunk embeddings. Source embeddings and chunk embeddings answer different questions.

## Evaluation Plan

### Metrics To Add

Candidate generation:

- expected source recall@10/@20/@50
- critical-source-set recall@10/@20/@50
- expected source candidate rank
- all-critical-sources-covered@k
- oracle source top-1
- oracle all-critical-source coverage
- retriever contribution counts

Source ranking:

- source top-1 acceptable
- source nDCG@10
- source MRR
- answerable source top-3
- distractor class performance

Card correctness:

- locked Cards present
- forbidden Cards absent
- evidence provenance correct
- non-locked Card ranked usefulness
- explicit Card-as-critical-Context-Object coverage

Chunk selection:

- correct source but wrong chunk
- correct chunk within selected source
- source-to-chunk loss rate

Coverage and confidence:

- unsupported honesty
- false-confident unsupported rate
- uncertain precision/recall
- reason-code distribution
- calibration by confidence bucket

Context assembly:

- all-required-source coverage
- critical-source recall@k
- noise ratio
- assignment-level readiness
- fail-closed correctness
- agent-task success

### Eval Surfaces

Keep:

- synthetic fixture as hard regression gate only
- real-corpus panel as primary retrieval truth

Synthetic gate rule:

- V2 changes must not regress the 126-case synthetic fixture.
- A synthetic pass has no positive ship power because the fixture is known to be too forgiving.
- A synthetic regression is still a hard red flag because it means the engine broke behavior that was already easy.

Add:

- combined Phase 8 report
- held-out real-corpus repos
- adversarial unsupported queries
- assignment-level multi-source tasks
- wild-query review sample

Minimum expansion:

- keep current 5 repos
- add 2-3 held-out repos not used during tuning
- add at least 30 unsupported/adversarial queries
- add at least 20 context-assembly assignments with 2-6 required sources

### Decision Gates

Phase 0 gate:

- if critical-source-set recall@50 < 95%, candidate generation/indexing is the bottleneck; do not build reranker first
- if critical-source-set recall@50 >= 95% but source top-1/top-3 remains weak, ranking/aboutness is the bottleneck; proceed to SourceProfiles and source-level rerank
- if unsupported cases are not separable with available raw features, confidence/abstention is the bottleneck; do not claim V2 readiness even if answerable recall improves
- if the synthetic fixture regresses, stop and fix the instrumentation or accidental behavior change before interpreting real-corpus movement

V2 readiness gate:

- answerable source recall@20 >= 95%
- answerable source top-1 >= 85%
- answerable source top-3 >= 95%
- unsupported honesty >= 90%
- no false-confident unsupported class remains unexplained

Context assembly readiness gate:

- critical-source recall@20 >= 98%
- pack all-required-source coverage >= 95% or fail closed
- unsupported/partial tasks do not produce confident ready packs
- agent-task eval shows measurable reduction in context mistakes

## Work Breakdown

### Slice 0 - ADR And Eval Instrumentation

Deliverables:

- ADR for Retrieval Engine V2.
- Combined real-corpus reporter.
- Candidate recall diagnostics.
- Oracle source rerank mode.
- Unsupported separability report.
- Full ranked candidate persistence for source aggregation.
- Post-hoc source-oracle analysis.
- A "feature availability" table for unsupported separability so V2-only features are not counted as Slice 0 evidence.

No implementation beyond measurement should happen before this.

### Slice 1 - Source Profile Schema And Indexing

Deliverables:

- `source_profiles` storage.
- `source_aliases` storage.
- source FTS table.
- deterministic source profile builder.
- tests for purpose classification and alias extraction.

### Slice 2 - Multi-Retriever Candidate Generator

Deliverables:

- source BM25F retriever.
- alias retriever.
- chunk-to-source aggregation.
- optional dense source retriever behind a flag.
- RRF fusion.
- explain output for retriever contributions.

### Slice 3 - Deterministic Source Reranker

Deliverables:

- source rerank feature extraction.
- intent/purpose compatibility matrix.
- distractor demotion rules.
- source ranking explain rows.
- source top-1/top-3 eval metrics.

### Slice 4 - Source-Scoped Chunk Selector

Deliverables:

- chunk selector that operates inside selected sources.
- source-to-chunk loss metric.
- assembly expansion rules adjusted to source-first flow.

### Slice 5 - Confidence And Verifier

Deliverables:

- raw evidence confidence model.
- readiness states.
- coverage reason codes.
- unsupported negative eval gates.
- fail-closed behavior in MCP/CLI presentation.

### Slice 6 - Optional Neural Rerank

Deliverables:

- source embedding cache.
- top-N cross-encoder or LLM pairwise rerank interface.
- intent gating.
- local-first opt-out.
- latency and quality report.

### Slice 7 - Assignment-Level Context Assembly Eval

Deliverables:

- multi-source task fixtures.
- all-required-source coverage scoring.
- fail-closed scoring.
- initial agent-task-success harness.

## No-Half-Measures Checklist

Do not ship V2 work if any of these are missing:

- Source ranking and chunk ranking are evaluated separately.
- Candidate recall is measured before reranking claims.
- Source recall is computed by grouped `source_path` candidates, not by top-3 drift inspection.
- Oracle rerank ceiling is computed post-hoc before production reranking work begins.
- Unsupported queries are a first-class eval, not folded into aggregate top-1.
- Unsupported separability reports distinguish available-today features from V2-only features.
- Confidence uses raw evidence features, not normalized top score alone.
- Source profiles distinguish `doc_role` from `doc_purpose`.
- Source summaries and `questions_answered` are deterministic in V2 v1; LLM-generated profile fields are separate gated enhancements.
- Cards preserve D37/D38/D39/D42/D43 behavior: locked bypass scoring, non-locked retain `card_type_bias`.
- Reranker feature vectors are logged and explainable.
- No learned ranker before 200+ judged cases across 8+ corpora.
- No rules special-case a repo, source path, or fixture id.
- Neural rerank is optional, measured, and explainable as a separate layer.
- The pack verifier can say `partial`, `unsupported`, or `needs_anchors`.
- Context assembly has assignment-level metrics before production-readiness claims.
- The 126-case synthetic fixture remains a hard regression gate even though it has no positive ship power.

## Risks And Mitigations

### Risk: More Architecture Without Enough Labels

Mitigation:

- Do ceiling probes first.
- Use source-oracle tests to separate recall from reranking.
- Expand eval with held-out repos before training any learned ranker.

### Risk: Source Summaries Hallucinate

Mitigation:

- Build v1 summaries deterministically from title/H1/intro text.
- Treat summaries as retrieval features only.
- Never cite summaries as authority.
- Final packs cite actual chunks and cards.
- Put any LLM-generated summaries behind a separate ADR and quality gate.

### Risk: `questions_answered` Quietly Requires An LLM

Mitigation:

- Leave `questions_answered` empty in V2 v1 unless question-shaped headings exist.
- Record `questions_answered_source`.
- Treat generated questions as an optional later retriever, not as part of the deterministic core.
- Reject any Slice 1 implementation that makes index-time model calls mandatory.

### Risk: Multi-Retriever Work Becomes The Whole Project

Mitigation:

- Slice 0 uses current scored candidates plus source aggregation only.
- Phase 2 is split into 2a/2b/2c/2d so source BM25F and alias retrieval can land before dense retrieval.
- Dense retrieval stays behind a flag until it proves quality lift.
- RRF contribution traces are required so each retriever's value can be measured.

### Risk: Neural Rerank Adds Latency And Dependency Weight

Mitigation:

- Keep deterministic V2 as the default floor.
- Cache source embeddings at index time.
- Run neural rerank only for close calls or high-stakes assembly.
- Preserve local-first opt-out.
- Do not train learned ranking until the eval set has at least 200 judged cases across 8+ corpora.

### Risk: RRF And Multi-Retriever Fusion Become Opaque

Mitigation:

- Store per-retriever ranks and contributions.
- Explain why each source entered the candidate set.
- Keep fusion before rerank, not as the only relevance explanation.

### Risk: Context Assembly Still Compounds Errors

Mitigation:

- Assembly must verify all required subgoals.
- Missing coverage returns `partial` or `needs_anchors`.
- Assignment-level success becomes the production gate.

## Recommended Next Step

Implement [PRD-0010](../prd/0010-retrieval-engine-v2-slice-0-ceiling-probes.md): Retrieval Engine V2 Slice 0 ceiling probes.

Do not start source profiles yet. First answer:

1. Is expected source recall@50 already high?
2. What is the oracle source rerank ceiling?
3. Are unsupported queries separable from supported ones?
4. What assignment-level coverage does current retrieval achieve?
5. Does the source aggregation reporter preserve synthetic gates while exposing real-corpus candidate recall?

If the ceiling probes show high recall and separable confidence, proceed with Source Profiles and V2. If they do not, the first rework target must be candidate generation, not reranking.

That is the guardrail that keeps this from becoming another pleasant but shallow tuning pass.
