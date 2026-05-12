# Week 7 — Retrieval Architecture Audit

**Read-only.** No code changes. This document inventories what the retrieval pipeline does today, maps each component to the failure modes the real-corpus eval surfaced, and identifies the deterministic techniques that could close the gap. It is the input to ADR-0018 (retrieval architecture rethink), which will be drafted next.

Anchored from [week-7 plan](week-7-baseline-and-experiments-2026-05.md). Companion to the [Phase 1.3 Ralph + Prisma baselines](week-7-baseline-and-experiments-2026-05.md#phase-13--ralph-baseline-frozen-2026-05-08) and the [cross-week invariance sidebar](week-7-baseline-and-experiments-2026-05.md#phase-1-sidebar--cross-week-retrieval-invariance-check-2026-05-08).

## Pipeline at a glance

```
import → chunk (heading-based, atomic-preserving)
        ↓
        FTS5 index (whole-chunk body)
        ↓
retrieve_context_pack:
  1. eligibility filter (status='current')
  2. compile query scopes:
       - look up cards/chunks by anchor → derived scopes
       - fall back to code_scopes config rules → fallback scope
       - if 0 anchors provided → query_mode='unanchored'
       - if anchors provided but 0 recognized → query_mode='signal_empty'
       - if ≥1 recognized → query_mode='anchored'
  3. resolve locked cards (ADR-0011, locked-include / D38/D39)
  4. score chunks via BM25Norm × hybrid formula
  5. score non-locked cards via same formula × 1.2× type bias
  6. pack: locked first, then candidates by packing_score within budget
  7. structural assembly expansion (parent / siblings / linked_neighbor) [week-5]
  8. presentation (week-7 view + render refactor)
```

## Component-level inventory

### 1. Indexing (`src/parse/chunker.ts`, FTS5 in `src/store/`)

**What it does:**
- Markdown is parsed via `remark`. AST is walked top-level only.
- Sections are heading-scoped: each heading starts a new chunk; content under that heading is the body.
- **Pre-amble (content before the first heading) is dropped** (ADR-D30).
- Atomic types (code blocks, tables, lists, blockquotes) preserved as units; oversized atomic content emits a warning rather than splitting.
- Greedy-fill packing within `target_tokens` / `max_tokens` budget.
- Stable key = hash(source_path + heading_path + chunk_index_within_section).

**Indexing into FTS5:** chunk body text is dumped into a single `doc_chunks_fts` virtual table column. **No fielded indexing** — title, headings, body all go into one bag of tokens. SQLite FTS5's default tokenizer (Unicode, lowercase) handles word-splitting; no custom stemmer, no synonym map.

**What's missing:**
- **No fielded BM25.** Title, heading_path, and body all share one IDF table. A query term appearing in a heading scores the same as the same term buried in body prose.
- **No phrase/shingle index.** Two-word phrases like "shadow database" can't be matched as bigrams; only as independent unigrams.
- **No stemmer beyond default Unicode tokenization.** "deploy" / "deployment" / "deployed" are different tokens; no merging.
- **No section-position metadata.** Once the chunk is split out, there's no signal for "this is the first section of the doc vs the last."
- **Pre-amble loss is load-bearing.** Many docs put the most important summary/abstract above the first heading. ContextTrail currently drops that text entirely.

### 2. BM25 query path (`src/retrieve/bm25.ts`)

**What it does:**
- Tokenize the user's task: lowercase → split on `/[^a-z0-9]+/` → drop tokens of length ≤1.
- **No stop word filter at the BM25 stage.** Tokens like "is", "the", "what", "why", "how" all go through.
- **No real stemming.** The trailing-`s` stripper from `score.ts` is *not* applied at the BM25 stage; it's applied only to heading-match Jaccard.
- Each token is wrapped with FTS5 prefix matching: `"token"*`.
- All tokens are joined with **`OR`** — never `AND`.
- The `OR`-joined expression is the FTS5 `MATCH` query. SQLite returns BM25 raw scores (negative; lower is better).
- Scores are normalized to [0, 1] by dividing by the max raw across all matching docs for that query.

**What's missing:**
- **No phrase matching.** "shadow database" as a multi-word phrase doesn't get any bonus when it appears as a phrase. Same score whether the words are adjacent or 800 tokens apart.
- **No proximity scoring.** No bonus for terms appearing close together.
- **No AND-required tokens.** Every token is OR'd, so a doc matching only one common token like "database" is in the candidate pool with as much chance as a doc matching "shadow" + "database" + "migrate".
- **No query understanding.** No intent classification (decision-lookup vs symbol-lookup vs broad-domain). No query parsing (no recognition of phrases, code identifiers, or operators).
- **No synonym / stem expansion.** "deploy" doesn't expand to "deployment", "migrate", etc.
- **No min-score threshold.** Whatever the lowest scoring doc is gets normalized to a non-zero value (since normalization divides by max). Every query that produces *any* match gets a top-1.

### 3. Hybrid scoring (`src/retrieve/score.ts`)

**What it does:**

```
text_score = w_bm25 * bm25_norm + w_heading * heading_match
final_score = text_score
            * (1 + w_scope * scope_match)
            * (1 + w_mentions * mention_overlap)
            * specificity
            * role_multiplier
            * structural_multiplier
packing_score = final_score / sqrt(token_count)
```

**Defaults from `src/config/defaults.ts`:**
- `w_bm25 = 0.70`, `w_heading = 0.30`
- `w_scope = 0.70`, `w_mentions = 0.80`
- `card_type_bias = 1.20`
- `specificity_weight`: module=1.4, project=1.2, decision=1.1, team=1.0, company=0.9, unknown=1.0
- `min_final_score` exists in config (used by `pack.ts`) — current default not inspected here, but it gates whether candidates make it into the pack at all.

**Component behaviors:**

- **`heading_match`** = Jaccard(tokenSet(query), tokenSet(heading_path joined by space)).
  - Stemmer is *one line:* lowercase, strip trailing 's' if word length > 3. So "deployment" doesn't match "deploy", but "tasks" does match "task".
  - Stop word list is **19 English words** (`a, an, the, and, or, but, of, to, in, on, for, is, be, are, was, with, by, as, at`). Question words "what", "why", "how", "when" pass through as content tokens.

- **`scope_match`** is a graduated step function: module exact match (with project agreement) = 1.0; project match = 0.6; team or company = 0.3; nothing = 0. Multi-scope OR returns the max over candidate query scopes.

- **`mention_overlap`** = `matched_query_anchors / provided_query_anchors`. Strict equality on `kind::value` strings — `"src/payments/refund.ts"` doesn't match `"payments/refund.ts"`. No path-similarity backoff. **No anchors → 0** (neutral, doesn't penalize).

- **`specificity`** is a per-scope-layer multiplier (module 1.4 > project 1.2 > decision 1.1 > team 1.0 > company 0.9 > unknown 1.0). Applies regardless of how the chunk was scoped.

- **`role_multiplier`** (doc role weighting):
  - `archive` → 0.3 (penalty regardless of mode)
  - `ideation` → 0.5 *only* in `anchored` or `signal_empty` mode
  - `example` → 0.4 *only* in `anchored` or `signal_empty` mode
  - `canonical` → 1.0 (default)
  - **No per-query-intent doc-role weighting.** A `decision_lookup` query and an `exact_symbol` query both get the same role multipliers.

- **`structural_multiplier`** (anchored-mode only):
  - `scope_match > 0` → 1.0
  - mention-only match → 0.15
  - lexical-only match → 0.10

So in anchored mode, a chunk that's only matched by raw text (no scope, no mention) is multiplied to 10% of its score — a heavy penalty designed to stop lexical noise from beating anchored matches. This *is* a form of mode-aware scoring, but it's narrow: it punishes lexical-only matches in anchored mode; it doesn't reward decision/symbol/cross-module differently.

### 4. Query mode resolution (`src/retrieve/query-scope.ts`)

**The load-bearing finding from this audit:** `query_mode` answers a different question than the consumers think it answers.

```typescript
const query_mode: QueryMode =
  provided.length === 0
    ? "unanchored"
    : recognized_anchor_count === 0
      ? "signal_empty"
      : "anchored";
```

The mode is **anchor-recognition state**:
- `unanchored` = caller provided no anchors
- `signal_empty` = caller provided anchors, none of them resolved to indexed cards/chunks/scope rules
- `anchored` = caller provided anchors and ≥1 resolved

Notice what the mode is **not**:
- It is *not* a "this corpus has nothing to say about your query" honesty signal.
- It is *not* a confidence assessment of the resulting top-1.
- It is *not* a query-intent classification.

This is exactly why both observed dishonesty patterns happen:

| Failure | Cause in this code |
|---|---|
| Ralph file_anchored cases got `signal_empty` mode | Ralph has no `src/`, so `files: ["src/...ts"]` resolved to no card and no chunk. Code-scopes-fallback fired against ContextTrail's *own* code_scopes config, which doesn't match Ralph's paths either. → 0 recognized anchors → mode = `signal_empty`. Even though task-text retrieval found the right doc. |
| Ralph + Prisma signal_empty queries (kubernetes / blockchain / etc.) got `unanchored` mode + arbitrary top doc | Caller provided no anchors. → mode = `unanchored`. The mode says "no anchor info" but the consumer reads it as "engine is confident in this answer." It isn't — the engine just always ranks something. |

**There is no path in the current code for "we ranked but the top result is below confidence."** No min-confidence-after-scoring threshold that would convert a low-quality `unanchored` retrieval into an honest `signal_empty`. The `min_final_score` config exists but it gates *packing* (whether to include in the pack), not the *mode label*.

### 5. Locked-include and Cards (`src/cards/locked-include.ts`, scoreCard in score.ts)

**What it does:**
- Constraint cards lock-include hierarchically-down on scope match (D38).
- Symbol_note cards lock-include on strict anchor equality (D39).
- Evidence cards can lock when `expected_evidence_covers_locked` requests cover (D24).
- Locked cards bypass scoring; they're always in the pack within budget.
- Non-locked cards score under the same hybrid formula × `card_type_bias = 1.2` and compete with chunks in the global ranker.

**Relevance to real-corpus failures:** mostly orthogonal. External repos have no Cards yet. The locked-include path doesn't fire for Ralph or Prisma seed queries.

### 6. Pack & assembly (`src/retrieve/pack.ts`, `src/retrieve/assembly.ts`)

**What pack does:** locked entries first; remaining candidates ordered by `packing_score` (final_score / sqrt(tokens)); fill until budget exhausted; track omitted.

**What assembly does (week 5 addition):** structural expansion ladder `primary_only → parent → siblings → linked_neighbor`. Conservative — only widens when the primary chunk's heading isn't sufficient on its own. Does **not** rerank top-1.

**Relevance to top-1 / mode failures:** none. Assembly fires after ranking is done, never changes the chosen top-1 doc. Confirmed by the cross-week invariance result.

## Failure-mode → component map

| Observed failure | Root cause in current pipeline |
|---|---|
| Prisma `decision_lookup`: "why does prisma migrate need a shadow database" → CLI reference page instead of concept doc | No per-intent scoring profile. `decision_lookup` intent exists in the eval taxonomy but isn't passed to `scoreChunk`. Concept docs get no boost over reference pages for "why" questions. |
| Prisma `prisma-anchored-many-to-many` → MongoDB-specific page beats canonical concept | No "canonical doc" boost when the query has no DB-specific anchor. `doc_role` only knows `canonical`/`ideation`/`example`/`archive`/`reference`; no notion of "this is the canonical doc for this concept and there are several adjacent variants." |
| Prisma cross-module miss (`prisma-cross-module-migrate-vs-schema`) → unrelated reference filter section | OR-joined BM25 with no proximity/phrase scoring lets a reference page that mentions both "schema" and "migrate" beat a concept doc where the relationship is the actual subject. |
| Ralph file_anchored top-1 misses on 2/4 cases | Anchor mention_overlap is binary (`src/linear/normalize-ticket.ts` doesn't appear in any chunk's anchors → 0). `structural_multiplier` then penalizes lexical-only matches *across all chunks*, including the canonically-correct doc. The right doc still appears in top-3 (via task text), but other docs win top-1 because the multiplier hurts them less. |
| Both signal_empty cases on Ralph → `unanchored` mode + arbitrary top doc | No corpus-coverage signal. `min_final_score` gates packing but not the mode label. The engine *can't* report "we couldn't find anything good" today; it only knows whether anchors resolved. |
| Ralph anchored top-1 mode = `signal_empty` despite finding the right doc | Mode resolution is anchor-recognition state. When anchors don't resolve and there's no fallback scope match, the mode is set even though task-text retrieval actually worked. |

## Production search techniques ContextTrail doesn't have

Ranked by leverage on the observed failures (high → low):

1. **Per-intent scoring profiles.** Different queries need different scoring weights. Decision-lookup queries should boost ADR / concept docs and downweight reference pages. Symbol queries should boost reference pages. Cross-module queries should boost docs that mention multiple modules. The `query_intent` taxonomy already exists in the eval; the scorer ignores it.

2. **Phrase / proximity scoring.** Two-word phrases like "shadow database" should score docs containing the phrase higher than docs containing both words scattered. Standard in Lucene as `match_phrase` / `match_phrase_prefix` and slop-based proximity.

3. **Min-confidence abstention.** A real corpus-coverage threshold: if the top-1 final_score < threshold, the engine reports `signal_empty` honestly rather than ranking noise. This converts the mode label from "anchor-recognition state" to "useful output state."

4. **Soft anchor handling.** When a provided file path doesn't resolve to any indexed chunk's anchors and code_scopes config has no match, fall through to scope inference based on path components (e.g., `src/linear/normalize-ticket.ts` → consider scopes mentioning "linear" or "normalize"), or down-weight gracefully rather than falling into `signal_empty` mode.

5. **Field-level BM25F.** Index title, heading_path, body as separate fields with their own IDF tables and per-field weights. A term hit in the title weighs more than the same term in body prose. Currently everything is one bag of tokens.

6. **Better tokenization + stemming.** Real Porter or Snowball stemmer (not "strip trailing s"). Compound stemming for code identifiers (camelCase / snake_case awareness). Real stop word list per intent (some queries should keep "what/why/how" as signal).

7. **Section position decay.** Earlier-in-doc sections weigh more; deep nested headings less. Recognizes that intro/abstract sections often hold the canonical answer.

8. **Pre-amble retention.** The dropped pre-amble can hold the most important content. Either index it under a synthetic "intro" heading, or attach it to the first real heading's chunk.

9. **AND/required-token constraints.** Currently every token is OR'd. Allowing certain query terms to be required (or scoring AND-matches higher) directly addresses the cross-module distractor failures.

10. **Re-rank stage.** Cheap retrieval (BM25 + scope) produces top-N candidates; a richer second pass (with phrase scoring, intent-aware weighting, etc.) re-orders them. Lets expensive features apply only to the small N candidates rather than the full corpus.

Items 1–4 are highest-leverage and lowest-risk. Items 5–9 are real engineering work but each closes a specific failure mode named above. Item 10 is the architectural pattern that lets us add several of the others without bloating the cheap first-pass cost.

## What to lock vs revisit

**Lock (don't reopen):**
- Markdown source + SQLite cache (D5)
- BM25 substrate (`(0.7 BM25 + 0.3 heading) × scope_boost × mention_boost × specificity` is the foundation; the additions above build on it, not replace it)
- Heading-based chunking with size cap (D16)
- Deterministic-core principle (no required AI for correctness)

**Revisit explicitly in ADR-0018:**
- Whether `query_mode` should report anchor-recognition state, corpus-coverage state, or both (with separate fields).
- Whether `query_intent` becomes a first-class scoring input (yes, almost certainly).
- Whether to add a re-rank stage (likely yes, because items 1, 2, 7, 9 all benefit from a structured second pass).
- Whether pre-amble retention is in scope for v1 (small change, real value).
- Whether to extend FTS5 indexing to fielded BM25F (bigger refactor, bigger gain).

## Recommendation for ADR-0018

Lock the priority order *before* writing code:

1. **Per-intent scoring profiles** — leverage on the most prominent failure (Prisma decision_lookup), mechanically simple.
2. **Min-confidence abstention** — fixes signal_empty honesty at the right architectural layer (post-scoring, not pre-resolution).
3. **Phrase / proximity scoring** — fixes the cross-module distractor failures.
4. **Soft anchor handling** — fixes the Ralph file_anchored mode issue.
5. **Pre-amble retention** — small, defensible win on doc role weighting.
6. **Field-level BM25F + section position decay** — bigger refactor; most ambitious deterministic step.
7. **Re-rank stage** — *if* items 1–6 don't reach the threshold (target: ≥75% top-1 acceptable on Ralph and Prisma seeds).
8. **Embeddings re-rank layer** — only if 7 caps out below threshold. Stays an enhancement per the deterministic-core principle.

Each step is a discrete experiment, scored against the frozen Ralph + Prisma baselines using the per-experiment writeup template from the week-7 plan.

## Things explicitly out of scope for this audit

- The card lifecycle, freshness, and review state (orthogonal to retrieval correctness).
- The substrate / store schema (locked in week 3).
- The MCP wire contract (week 4 / week 7 view refactor stable).
- The bootstrap / inbox pipeline (week 6, post-retrieval).
- The current synthetic 126-case fixture — it remains a regression gate but won't be expanded for measuring the architecture rethink. The frozen real-corpus seeds are the primary surface.
