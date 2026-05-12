# PRD-0026: AI Contextual Augmentation (paper-only — MOOT in current form)

> **Status: paper-only, MOOT in current form (post PRD-0025 verdict).** PRD-0025 measured the deterministic chunk-layer floor and found that adding more chunk text — whether structural or AI-generated — duplicates source-level signal and hits the broad-doc-symmetry failure mode. Adding LLM-generated chunk-level context would hit the same wall at extra cost. **Do not implement PRD-0026 in its current form.** AI augmentation might still apply at the *source* level (LLM-proposed canonical-for-topic / relationship metadata reviewed once at setup), but that's a different PRD architecture than this doc describes. See `.out-of-scope/prd-0025-chunk-layer-verdict.md` for the diagnosis. The original paper-only framing below is preserved for reference; treat it as historical context, not as a path forward.
>
> ---
>
> **Original status (preserved for reference):** This PRD documents the architecture for AI-augmented contextual indexing on top of PRD-0025's structural floor. It is not filed to Linear and no implementation work is scheduled. Sequencing: PRD-0025 ships and is measured first; PRD-0026 lands as additive logic if structural CI plateaus before the 97/99 retrieval targets.
>
> Source-of-truth canonical doc when promoted. Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADRs: [ADR-0002](../adr/0002-card-provenance-from-day-one.md), [ADR-0014](../adr/0014-agent-assisted-setup-without-truth-promotion.md), [ADR-0019](../adr/0019-retrieval-architecture-rethink.md). Related PRDs: [PRD-0025](0025-structural-contextual-indexing.md).
>
> Boundary rule: AI runs **once at setup time** and produces durable per-chunk metadata that retrieval consumes deterministically. The LLM is a draft author at index time, not a query-time ranker. ADR-0014 explicitly authorizes this shape; ADR-0002 explicitly authorizes the persistence pattern (cards / per-chunk metadata with provenance from day one).

## Problem Statement

PRD-0025 ships **structural contextual indexing**: every chunk gains BM25F fields for `doc_title`, `doc_purpose`, `section_intro` extracted deterministically from the markdown AST. Estimated lift: 60–70% of full LLM-based contextual retrieval's value on well-structured corpora.

The remaining 30–40% lives in chunks where the structural fields are thin:
- Long flat sections with weak heading hierarchies
- Chunks in the middle of a section whose topical identity isn't carried by the section's intro
- Documents where `doc_purpose` is genuinely ambiguous (e.g., a `README.md` that's part guide, part API reference, part changelog)
- Chunks whose body uses domain-specific shorthand that the structural fields don't expand

These chunks need **synthesis** — a natural-language description of what the chunk is actually about, drawing on its body and surrounding context. Structural extraction can't produce synthesis; an LLM can.

The honest concern about AI in ContextTrail has always been **query-time non-determinism** ("ballistic machine"). PRD-0026 sidesteps that concern entirely by confining AI to **one-time generation at setup**, persisted as durable per-chunk metadata, deterministic at every subsequent query.

## Solution

Add an `ai_context` field to each chunk's BM25F index. The field is populated by **one autonomous LLM pass at setup time**:

```
contexttrail init / drift refresh
  ├─ phase 1: structural analysis (deterministic — PRD-0025)
  ├─ phase 2: ambiguity-resolution wizard (user input — separate workflow)
  ├─ phase 3: AI contextualization (autonomous — this PRD)
  │            per-chunk LLM call producing 50–100 token context
  │            output persisted as durable per-chunk metadata with provenance
  │            cached by (chunk_content_hash, model_version, prompt_version)
  └─ phase 4: BM25F index build
              indexes structural fields + ai_context together
              query time: zero LLM calls, fully deterministic
```

### What is and isn't user-gated

The user-question wizard (phase 2) resolves things the system can't infer — parent/child canonicality, package-vs-version disambiguation, project-specific vocabulary. Those *require* user input.

AI contextualization (phase 3) summarizes what each chunk is about, drawing only on inputs the system already has (chunk body + surrounding doc + document title). **It does not require user input** — there's nothing for the user to disambiguate. The user *can* override an individual context if they review one and disagree, but it's not part of the required flow.

The card/persistence pattern is reused not for acceptance gating but for:
- **Durability**: contexts persist across imports; query-time has no LLM dependency
- **Cache key**: same chunk content + same model + same prompt = use stored output, no regeneration
- **Provenance**: model version, prompt version, generation timestamp captured per chunk so the team can audit what was indexed
- **Optional override**: user can edit any individual context (re-uses the existing card-edit UX); reindex picks up the override

### What this preserves vs full Anthropic-style contextual retrieval

The variability concern with AI contextual retrieval has always been about *re-imports producing different indexed text*. PRD-0026's design bounds that concern:

| Variability source | PRD-0026's mitigation |
|---|---|
| Re-running on unchanged corpus | Cache by `chunk_content_hash` — no regeneration → byte-identical output |
| Same content, same model, same prompt, different API run | `temperature=0`; backend non-determinism is rare and bounded; cache absorbs the first generation |
| Model version change | Pinned `model_version` in the cache key; upgrading the model is an explicit migration, not a silent shift |
| Prompt revision | Pinned `prompt_version` in the cache key; updating the prompt is an explicit migration |
| Provider change | Cache key includes `provider`; switching providers is an explicit migration |

The result: **same corpus, same code, same model/prompt versions → byte-identical retrieval behavior**. Upgrading any of those is an explicit migration that re-runs the affected chunks. The team's git history (cards committed as durable artifacts) captures the truth; the LLM is a draft author whose work becomes durable on persistence.

This is materially stronger than Anthropic's blog-post implementation, which doesn't typically include explicit pin/migration tracking. The improvement comes from leaning into ADR-0002's "card provenance from day one" — every AI-generated context is a card with provenance, not loose state.

## User Stories

1. As a ContextTrail maintainer, I want AI to summarize each chunk's content at setup time, so that chunks with thin structural metadata gain natural-language discriminating signal that BM25F can match against.
2. As a ContextTrail maintainer, I want AI contextualization to run autonomously without user gating, so that it doesn't add 5000 review steps to the setup flow.
3. As a ContextTrail maintainer, I want the AI's output persisted as durable per-chunk metadata with full provenance (model, prompt version, timestamp), so that re-imports don't regenerate unchanged chunks and the audit trail is complete.
4. As a ContextTrail maintainer, I want the cache key to include model and prompt versions, so that upgrading either is an explicit migration that re-runs the affected chunks rather than a silent behavior shift.
5. As a ContextTrail maintainer, I want users to be able to edit any individual context if they catch a bad one, reusing the existing card-edit UX, so that overrides don't require new tooling.
6. As a ContextTrail maintainer, I want a `--skip-ai-context` flag on `contexttrail init` so that users who don't want LLM cost can opt out and run with structural CI only.
7. As a ContextTrail maintainer, I want prompt caching used aggressively (whole document as cached prefix; per-chunk part is small), so that cost on large corpora drops 10x+ vs naive per-chunk prompts.
8. As a ContextTrail maintainer, I want `ai_context` indexed as a separate BM25F field with its own weight, so that structural and AI signals can be tuned independently and ablated cleanly.
9. As a ContextTrail maintainer, I want PRD-0026 to be additive on top of PRD-0025: the BM25F machinery, persistence schema, and chunk-context extractor stay; AI augmentation slots into a parallel field, not a replacement for the structural fields.
10. As a future implementer, I want the prompt to be small, deterministic in shape, and explicitly versioned, so that prompt revisions are tracked the same way code revisions are.
11. As a future implementer, I want the LLM output to be bounded in length (50–100 tokens hard cap), so that BM25F length-normalization stays sensible.
12. As a future implementer, I want a fallback path that degrades to structural CI when the LLM call fails or rate-limits, so that imports never block on AI availability.

## Implementation Decisions

### LLM-augmented field on the existing six-field BM25F shape

PRD-0025's BM25F fields stay unchanged:

| Field | Source | Default weight |
|---|---|---:|
| title | chunk's local heading title | 2.5 |
| heading_path | full drift | 1.5 |
| body | chunk text | 1.0 |
| doc_title | parent doc's title | 2.0 |
| doc_purpose | classified value | 1.0 |
| section_intro | first 300 chars of containing-section intro | 1.2 |

PRD-0026 adds **one new field**:

| Field | Source | Default weight |
|---|---|---:|
| **`ai_context`** | LLM-generated 50–100 token summary | **1.3** |

Weight `1.3` slots between `section_intro` (1.2) and `heading_path` (1.5): higher than structural intro (synthesis is more discriminating per token) but lower than the verbatim heading drift (which is structurally guaranteed). Principled fixed value.

### Persistence shape

PRD-0025 (slice 25.2) added these chunk-table columns: `doc_title`, `doc_purpose_value`, `doc_purpose_provenance`, `doc_purpose_confidence`, `section_intro`. PRD-0026 adds:

```sql
ALTER TABLE doc_chunks ADD COLUMN ai_context TEXT;
ALTER TABLE doc_chunks ADD COLUMN ai_context_model_version TEXT;
ALTER TABLE doc_chunks ADD COLUMN ai_context_prompt_version TEXT;
ALTER TABLE doc_chunks ADD COLUMN ai_context_generated_at INTEGER;  -- unix ms
ALTER TABLE doc_chunks ADD COLUMN ai_context_overridden INTEGER DEFAULT 0;  -- bool
```

The FTS5 virtual table (`doc_chunks_fts`) gains one new column: `ai_context`. **Recreate-and-rebuild** migration, same shape as PRD-0025's FTS migration. (Pre-allocating this column in PRD-0025 would avoid a second FTS rebuild; see "Open question for PRD-0025" below.)

### Cache semantics

The cache key for AI generation is the tuple `(chunk_content_hash, model_version, prompt_version, provider)`. On every import:

- For each chunk, look up the cache. Hit → reuse existing `ai_context`.
- Miss → call the LLM, store output. Atomic write (cache row + `ai_context` field updated together).
- `ai_context_overridden = true` chunks are never regenerated even on cache miss; the user's override is sticky.

Re-imports of unchanged corpora produce zero LLM calls. Imports of corpora with edits produce LLM calls only for chunks whose content changed. Migration to a new model version produces LLM calls for every chunk (an explicit, opt-in operation triggered by `drift refresh --upgrade-model`).

### Prompt shape

The prompt is **small, deterministic in shape, explicitly versioned**:

```
System: You are summarizing a single chunk from a documentation corpus
to help a search system route queries to the right chunk. Output 50–100
tokens describing what the chunk is about. No filler. No "this chunk
discusses". Just the substance.

User: Document title: {doc_title}
Document purpose: {doc_purpose}
Heading path: {heading_path}

Chunk content:
{chunk_body}
```

The prompt itself is versioned (string identifier like `prompt_v1`). Revisions to the prompt produce a new identifier; the cache invalidates the affected chunks, and the next import regenerates them.

### Prompt caching

Anthropic's prompt-caching API is used to amortize cost. The system prompt + the document-level fields (`doc_title`, `doc_purpose`) are cached as the prefix; only the per-chunk part (heading path + chunk body) is uncached. For a typical 5000-chunk import, this drops cost ~10x vs naive per-chunk calls.

### Setup flow integration

`contexttrail init` and `drift refresh` gain an AI-contextualization phase that runs after structural analysis:

- Default: AI contextualization runs autonomously, batched in groups, with a progress indicator.
- Flag `--skip-ai-context`: skip the phase entirely; corpus indexes with structural CI only.
- Flag `--ai-context-budget=N`: cap the number of LLM calls (useful for partial cost-bounded runs).
- Failure mode: if any LLM call fails or rate-limits, that chunk gets `ai_context = null` and falls back to structural-only retrieval. Subsequent runs retry the failed chunks.

### Authority boundary preserved

Per ADR-0014:

- AI runs at setup time only. **Zero LLM calls at query time.**
- AI output is captured as a card-shaped artifact (provenance + content + version) and committed to the chunk store.
- Retrieval consumes the persisted text deterministically.
- User can override any individual `ai_context` via the existing card-edit UX. Override is sticky.

Per ADR-0002:

- Every `ai_context` carries provenance from day one (model, prompt version, generation timestamp).
- Re-runs are reproducible: same content + same model + same prompt → same cache hit → same indexed text.
- Migrations (model upgrade, prompt revision) are explicit and traced.

## Testing Decisions

### Synthetic property tests

- **Cache idempotence**: same chunk content + same model + same prompt version → cache hit → byte-identical `ai_context`. Lower-95 ≥ 99% (this should be 100%; 99% is the floor for "no flakes").
- **Override stickiness**: a chunk with `ai_context_overridden = true` is never regenerated even on cache miss.
- **Length boundedness**: `ai_context` is always within 50–100 token range (hard fail on out-of-bound output; truncate to limit).
- **Migration path**: changing model_version invalidates the cache for affected chunks; changing prompt_version invalidates similarly.
- **Failure isolation**: an LLM failure for chunk N does not block chunks N+1..M.

### Adversarial coverage

- Empty / whitespace-only chunks (LLM should not be called; degrade gracefully)
- Chunks containing only code (LLM produces a useful description; verified via fixture-based smoke test)
- Very long chunks (>4k tokens) — handled by prompt-truncation strategy with documented behavior
- Chunks in non-English content — out of scope for v1; documented as a known limitation
- LLM produces a context that's identical to the chunk body (the model giving up) — detected and treated as "no augmentation" rather than indexed verbatim (would dilute the body field's signal)

### Real-corpus discipline

The same gate framing as PRD-0025: candidate-generation first.

- **Primary**: `accepted_in_top_5` improves by ≥ 3 cases beyond PRD-0025's structural-only ceiling
- **Primary**: avg structurally-unrelated candidates in top-5 does not increase
- **Secondary**: top-1 ≥ post-PRD-0025 baseline (no regression)
- per-case `regressions == 0` against post-PRD-0025 baseline
- At least one addressed miss explained by the AI context specifically (commit must call out the case + the chunk's `ai_context` text)

The bar is sharper than PRD-0025's because PRD-0025 establishes the floor; PRD-0026 must produce additive lift to justify its cost.

## Promotion Gates

Conjunctive — every gate must pass before AI contextualization is enabled by default in `contexttrail init`:

- `npm test` passes
- `npx tsc --noEmit` passes
- All synthetic property tests pass at lower-95 ≥ 99%
- Cache-idempotence tests pass at 100% (no flakes acceptable)
- Real-corpus eval (AI-context populated, BM25F includes `ai_context` field):
  - `accepted_in_top_5` improves by ≥ 3 cases vs post-PRD-0025 baseline
  - top-1 ≥ post-PRD-0025 baseline (no regression)
  - top-3 ≥ 118; coverage_honest 148/148; agent_answer ≥ 147/148; chunk_correctness ≥ 3/3
  - per-case `regressions == 0`
- LLM cost on the test corpora is documented and within order-of-magnitude expectations (~$X per 5000-chunk import after prompt caching)
- All addressed cases attributable to `ai_context` are verified
- All unpredicted flips reviewed and classified before acceptance

## Out of Scope

- AI at query time. Hard rule. AI runs at setup; retrieval is deterministic.
- Multilingual contexts (v1 is English-only)
- Cross-doc context synthesis (each chunk's context draws only from its own doc)
- Automatic prompt tuning / A-B testing of prompt variants
- Streaming or incremental context generation per query (not needed; setup-time pass)
- Dense / embedding-based retrieval (separate architectural decision)
- New score-component coefficients in source-rerank
- Re-litigating parked PRD-0022 / PRD-0023 ranking-time boost lanes

## Open question for PRD-0025

Should PRD-0025's slice 25.2 **pre-allocate** the `ai_context*` columns on `doc_chunks` and the `ai_context` FTS5 column? Adding them in 25.2 (unused, populated only when PRD-0026 ships) avoids:

- A second FTS5 virtual-table rebuild (FTS5 doesn't support ALTER; adding a column means recreating the table)
- A second migration of the `doc_chunks` table

Cost of pre-allocating: minimal — just empty / null columns sitting on each row until PRD-0026 populates them. The migration cost is paid once during PRD-0025's deployment instead of twice (once for 25.2, once for PRD-0026's persistence step).

**Recommendation: yes, pre-allocate.** This is a one-liner addition to PRD-0025's slice 25.2 spec. It commits no implementation work to PRD-0026; it just leaves the door open so the future migration is purely additive logic.

## Further Notes

This PRD documents the architecture for AI contextual augmentation as a deliberate future option, not a committed near-term project. Sequencing:

1. **PRD-0025 ships** with structural contextual indexing on the new BM25F fields. Eval measures the structural floor.
2. **If the structural floor closes the 97/99 retrieval gap**, PRD-0026 stays paper-only — no need to add LLM dependency.
3. **If the structural floor delivers but plateaus**, PRD-0026 lands as additive logic on top of the existing PRD-0025 plumbing.
4. **If the structural floor under-delivers**, PRD-0026 still applies but the architectural reading shifts: chunk-layer richness alone may not be the bottleneck, and the project re-evaluates the retrieval architecture more fundamentally.

The reason to draft PRD-0026 now is to **shape PRD-0025's persistence design** so it doesn't paint us into a corner. Specifically: pre-allocate the `ai_context*` columns. This is the only PRD-0025 design decision that's affected; everything else in PRD-0025 stands on its own.

The variability-concern framing the team has held since PRD-0019 is honored: AI does not see candidate slates, does not rank, does not declare truth. AI's role is "summarize what's already in this chunk so structured search can find it." That role is exactly what ADR-0014 designed the agent-assisted-setup boundary for.
