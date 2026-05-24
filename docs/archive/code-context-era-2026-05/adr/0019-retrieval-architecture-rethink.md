# ADR-0019: Retrieval architecture rethink — deterministic-core deepening before any LLM/embedding layer

**Status:** Superseded by ADR-0020 for high-ceiling Retrieval Engine V2 work
**Date:** 2026-05-08

> Supersession note: this ADR remains historical context for deterministic retrieval hardening and the `coverage_confidence` split. ADR-0020 governs the next retrieval architecture phase because the product question shifted from pilot-readiness to high-reliability Context Pack and context assembly support.

## Context

Week 7's real-corpus eval revealed a much larger gap than the synthetic 126-case fixture had suggested. On the frozen seeds:

- Ralph (small, self-authored, layered): top-1 acceptable = 50%, query mode correct = 40%, signal_empty honesty = 40%.
- Prisma (large OSS framework docs): top-1 acceptable = 30%, query mode correct = 70%, signal_empty honesty = 70%.

The synthetic fixture has been scoring 95.7% top-1 on anchored cases for weeks. A cross-week invariance experiment (replaying the real-corpus eval against week 4, week 5, and week 7 commits via git worktrees) confirmed that the retrieval pipeline is byte-identical across all three points — same per-case top-1 docs, same mode labels. The synthetic-vs-real gap is not a regression; it has always been there. The synthetic fixture has been too kind to the engine.

The retrieval audit ([docs/plan/week-7-retrieval-audit-2026-05.md](../plan/week-7-retrieval-audit-2026-05.md)) inventoried what the deterministic-core retrieval pipeline does today and mapped each component to the observed failures. The most load-bearing finding: `query_mode` reports anchor-recognition state ("did caller-supplied anchors resolve?"), not corpus-coverage state ("does the corpus support this query?"). This explains both observed dishonesty patterns and is unfixable by tuning — it is an architectural mismatch between what mode reports and what consumers read.

Other deterministic gaps named in the audit:

- BM25 query is OR-joined prefix matches over a single FTS5 column (no phrase / proximity / AND / fielded BM25F).
- `query_intent` is part of the eval taxonomy but the scorer does not consume it; same scoring profile for decision-lookup vs exact-symbol vs cross-module vs broad-domain.
- Tokenization is the SQLite default; heading-match Jaccard adds a trivial trailing-`s` stemmer and a 19-word stop list. Question words ("what", "why", "how") are content tokens.
- Pre-amble (content above the first heading) is dropped at chunk time per ADR-D30 — load-bearing for docs whose canonical summary lives above the first heading.
- There is no min-confidence threshold on the resulting top-1; every query that produces any FTS5 match gets ranked output, even when the top score reflects scattered string-similarity rather than topical relevance.

Production search systems (Lucene/Elasticsearch, Google web search, Amazon product search, ad ranking) hit very high accuracy on much harder corpora than ours, deterministically. The gap is not "we need embeddings." The gap is that ContextTrail's deterministic-core implementation is missing standard production-search techniques. Reaching for an LLM/embedding layer before fixing the foundations would paper over the real problem; if the deterministic substrate is weak, an embedding re-rank just hides it.

This ADR locks the structure of the work, the priority order, and the threshold at which an enhancement layer is considered.

## Decision

Retrieval correctness is the headline focus of the rest of week 7 (and into week 8 as needed). Other named experiments — evidence card candidates, code/test-driven bootstrap, query_mode first-classing as a separate effort — become consequences of or post-rethink work, not parallel headline experiments.

**The work is structured in four phases. Phase A (hardening of existing primitives) precedes Phase B (wiring existing taxonomy through). Phase C is one architectural surface fix. Only after A+B+C are exhausted are new primitives (Phase D) considered, and Phase D items are themselves gated by a measured threshold.**

The motivation for this ordering is diagnostic. If we add new primitives on top of an under-implemented foundation and the result still misses the threshold, we cannot tell whether the new primitive is wrong, the foundation was always too weak, or the combination does not compose. By making the existing primitives genuinely robust first, every later experiment has a clean attribution: the new technique either moves the seed scores against a real baseline, or it doesn't.

### Phase A — Harden existing primitives

These are improvements to scoring components that *already exist*. None introduces a new architectural surface; each closes a known weakness in an existing one.

- **A1. Real tokenization + stemming.** Replace the trivial trailing-`s` stemmer (in `score.ts`) and the SQLite-default tokenization (in FTS5 indexing) with Snowball / Porter stemming, a real stop-word list, and code-identifier awareness (camelCase / snake_case splits, kept whole as alternates). Same component, far less lossy.
- **A2. Fielded BM25F.** Replace the single `doc_chunks_fts` column with separate FTS5 fields for `title` (frontmatter or H1), `heading_path` (joined section drift), and `body`. Per-field IDF tables; per-field weights configured. Same retrieval primitive (BM25), correctly applied to fielded text rather than a token bag.
- **A3. AND-with-OR-fallback query construction.** Replace the OR-only token query with AND-required tokens that fall back to OR when AND yields no matches. Doc-with-all-query-terms outranks doc-with-any-query-term. Same FTS5 surface, correct query semantics.
- **A4. IDF-weighted heading match.** Replace the Jaccard heading match (which weighs every word equally) with an IDF-weighted overlap so rare heading terms count more than common ones. Same component, weighted correctly.
- **A5. Path-similarity in mention overlap.** Replace the strict `kind::value` equality with normalized-path matching (strip leading `src/`, suffix-match, basename-equal). Same component, correct generalization.
- **A6. Pre-amble retention.** Reverse the D30 drop-pre-amble policy for v1. Index pre-amble under a synthetic "intro" heading attached to the source path. Same chunker, recovers data that was previously discarded.
- **A7. Section position decay.** Add a per-chunk multiplier that down-weights chunks deep in a long heading hierarchy or late in a doc, since canonical content tends to live near the top. Same scoring formula, position-aware.

These are deliberately scoped as "make existing techniques robust." None requires new contract surface, new query understanding, or new stages.

### Phase B — Wire existing taxonomy through

These connect existing typed information that the engine already has but ignores at scoring time.

- **B1. Per-intent scoring profiles.** `query_intent` is already in the eval taxonomy (`exact_symbol`, `decision_lookup`, `cross_module`, `broad_domain`, `signal_empty`, etc.). Pass it to `scoreChunk` and `scoreCard`. Define per-intent weight tables (decision-lookup boosts ADR/concept docs; exact-symbol boosts reference docs; cross-module rewards multi-module mentions). The intent classifier itself is deterministic (rule-based on task text + anchor shape), not LLM. This is wiring, not a new primitive.
- **B2. Doc-role expansion + per-intent role weighting.** The existing `doc_role` enum is small (`archive`, `ideation`, `example`, `canonical`). Expand to include `reference`, `concept`, `guide`, `runbook`, `decision` so the per-intent profiles in B1 have role distinctions to weight against. Roles are derived deterministically from path/heading patterns at index time.
- **B3. Soft anchor handling.** When binary anchor lookup fails, fall through to graduated path-component scope inference (e.g., `src/linear/normalize-ticket.ts` → consider scopes mentioning "linear"). The query-mode resolution stops being binary; partial-anchor confidence becomes a real signal rather than a hard 0/1.

### Phase C — Architectural fix: corpus-coverage as a real signal

- **C1. Min-confidence abstention + `coverage_confidence` field.** Introduce a post-scoring confidence floor. Below it, the engine reports honest corpus-coverage failure rather than ranking noise. `query_mode` retains its current semantics (anchor-recognition state) for back-compat. A new field `coverage_confidence` reports honest corpus-coverage state with values `confident` / `uncertain` / `empty`. This is the architectural fix for the dishonest-`signal_empty` failures and the only contract-surface change in the rethink.

### Phase D — New primitives (gated)

These are run only if Phases A+B+C together do not hit the threshold. None ships unless the threshold check explicitly justifies it.

- **D1. Phrase / proximity scoring.** A phrase-bigram index (or FTS5 phrase queries) plus a proximity component to text scoring. New primitive on top of fielded BM25F.
- **D2. Re-rank stage.** A top-N candidate re-rank between the first-pass ranker and packing. Lets richer features apply only to a small candidate set rather than the full corpus.
- **D3. Embeddings re-rank.** A vector embedding model layered as a re-rank inside D2. Stays an *enhancement*, never substrate, per the deterministic-core principle. Last in the order.

### Threshold

The threshold for moving from Phase A+B+C to Phase D is **≥75% top-1 acceptable on the Ralph and Prisma frozen seeds combined**, with `coverage_confidence` honesty ≥85% on both repos. (Honesty is measured as: signal_empty cases correctly report `coverage_confidence=empty`, anchored cases that returned a valid top-1 correctly report `confident`.)

If Phase A+B+C lands at or above this threshold, v1 ships without any enhancement layer. If Phase A+B+C caps out below it, Phase D is justified — items D1, D2, D3 in that order, each with its own threshold check before progressing.

The 75% / 85% thresholds are deliberately lower than the synthetic fixture's 95.7%. They reflect actual-corpus difficulty, not the synthetic fixture's flattering shape, and they are the bar at which ContextTrail is honestly pilot-ready on a documented TS codebase.

### Why hardening before new primitives

Two reasons.

First, **diagnostic clarity.** If we ship a new primitive on a weak foundation and the result misses the threshold, we have three indistinguishable hypotheses: the new primitive is wrong, the foundation was always too weak, or the combination doesn't compose. Hardening first eliminates two of those branches up front. Every later experiment has a clean attribution.

First-and-a-half corollary: until existing primitives are optimized, we cannot honestly say "we exhausted the deterministic budget" — and that's the load-bearing claim that justifies considering an embedding layer.

Second, **most production search systems get to high accuracy through the items in Phase A.** Real BM25F, real stemming, real query construction, position-aware scoring — these are the techniques that deliver. Phrase scoring and re-rank stages add real value, but only after the fielded substrate is solid. Embedding re-rank without solid deterministic foundations is the textbook way to mask a weak retrieval implementation.

### `query_mode` reframe (contract change)

`query_mode` retains its current semantics for backward compatibility — it continues to report anchor-recognition state (`unanchored` / `signal_empty` / `anchored`).

A new contract field is added to the `retrieve_context_pack` response: `coverage_confidence`. It reports honest corpus-coverage state for the resulting top-1, with values:

- `confident` — top-1 final_score is well above the abstention threshold.
- `uncertain` — top-1 is above threshold but only marginally; agents should treat as plausible-but-not-locked.
- `empty` — top-1 is below threshold; the engine is reporting that the corpus does not have a good answer for this query.

Min-confidence abstention (item 2) drives `coverage_confidence`. Together with `query_mode`, the response now distinguishes "did anchors resolve?" from "is the result trustworthy?" — the conflation of the two was the architectural root cause of the dishonesty findings.

### Process

Each item in Phases A, B, and C is a discrete experiment with the per-experiment writeup template from [week-7 plan §Per-experiment writeup template](../plan/week-7-baseline-and-experiments-2026-05.md#per-experiment-writeup-template). Each must move targeted cells positively on Ralph or Prisma frozen seed without regressing the synthetic 126-case eval gates and without regressing the regression-detector cells in the seeds. Two attempts to converge before parking. Each ships in its own commit referencing a Linear ticket per the agent code-change discipline.

After Phases A+B+C complete, the threshold check runs against the frozen Ralph + Prisma baselines. If the threshold is met, v1 ships at that engine state. If missed, Phase D items are run sequentially (D1, then if needed D2, then if needed D3), each with its own intermediate threshold check.

Items in Phase D are gated experiments — not run unless the threshold check above explicitly justifies them.

The frozen Ralph + Prisma baselines (`docs/evals/baselines/real-corpus/{ralph,prisma}-2026-05-08.json`) are the comparison surface. The synthetic 126-case fixture remains a hard regression gate but is not the primary surface for measuring this work.

## What stays locked

These are not reopened by this ADR:

- Deterministic-core principle: AI may be available for quality, never required for correctness. v1 ships without AI in the retrieval critical path.
- Markdown source + SQLite cache (D5).
- v1 supports markdown doc sources only (D19).
- BM25 substrate as the first-pass scoring foundation (`(0.7 BM25 + 0.3 heading) × scope_boost × mention_boost × specificity` — items above add components to this; they do not replace it).
- Heading-based chunking with size cap (D16).
- Locked-include semantics (D38/D39, ADR-0011).
- Card type bias (D42, 1.2× for non-locked cards in the global ranker).
- Three card types in v1 (D10, D20).
- Agent interface MCP-first, read-only retrieval (D8, D20).

## What this ADR does not commit

- It does not commit specific scoring weights, thresholds, or intent-classification rules. Those are tuned per experiment against the seeds.
- It does not commit a specific embedding model. If item 8 lands, the model selection is its own ADR.
- It does not commit a structure for the LLM-augmented agent task pack — that remains the post-v1 question OPEN.md flags about agent task success.
- It does not retire the existing Phase 3.x experiments (evidence cards, code/test bootstrap, signal_empty recovery as a separate experiment). They are reordered behind retrieval correctness; they may become moot if items 1–6 close the relevant gaps; or they may be reframed once retrieval correctness is on solid ground.

## Why

Four reasons this ordering is right.

First, **production search systems hit very high accuracy deterministically.** Lucene-based stacks, e-commerce ranking, ad serving — all do this without LLMs in the relevance path. Their accuracy comes from the techniques in Phase A (real fielded BM25F, real tokenization and stemming, real query construction, position-aware scoring), plus the wiring in Phase B and the contract honesty in Phase C. If we can't get there deterministically on a 64-document Prisma subset, that is a foundation problem, not an "we need embeddings" problem.

Second, **diagnostic clarity comes from hardening first.** If we ship new primitives on weak foundations and miss the threshold, we cannot attribute the failure cleanly. By exhausting Phase A first, every later experiment can be attributed: the new technique either moves the seed scores against a known-robust baseline, or it doesn't. This is what "we don't know where we went wrong" feels like in practice — and the only honest defense against it is to make the existing surface as good as it can be before adding to it.

Third, **embeddings are an enhancement, not a substrate** per the long-standing deterministic-core principle (OPEN.md). Adding them before the deterministic budget is exhausted would invert that principle and create a permanent maintenance liability: every quality investigation downstream would have to disambiguate "is this a deterministic-core problem or an embedding-layer problem?" The threshold check is what makes the principle measurable rather than aspirational.

Fourth, **the audit identified specific, named techniques mapped to specific, named failures.** Phase A2 (fielded BM25F) closes the Prisma cross-module distractor failures because the canonical concept doc has the query terms in its title and heading_path, while reference pages have them only in body prose. Phase A3 (AND-with-OR-fallback) closes the same class of failure by requiring both terms instead of either. Phase B1 (per-intent scoring) closes the Prisma decision-lookup miss because the intent already exists in the taxonomy and the scorer is the only thing not consuming it. Phase C1 (coverage_confidence) closes the dishonest-signal_empty pattern at the right architectural layer. None of these requires guessing about whether the technique would work; they are well-known and well-understood, and they are mechanically grounded in the failure analysis.

Once Phase A+B+C lands, the threshold check answers a clean question: are deterministic foundations enough? If yes, ship v1 without enhancement. If no, add the enhancement layer with a clear baseline showing what the deterministic core can and cannot do — no ambiguity about which layer is doing what work.

## Consequences

### Positive

- Real-corpus eval becomes the primary truth check for retrieval, replacing the synthetic 126-case fixture's role of measuring quality (it remains the regression gate).
- The architectural mismatch between `query_mode` and consumer expectations is fixed by adding `coverage_confidence` rather than reinterpreting an existing field.
- Each deterministic deepening is a discrete experiment with the writeup template already established; the work product is durably reviewable.
- The deterministic-core principle is honored, not just claimed — items 7–8 are gated, not assumed.
- Items previously planned as Phase 3 experiments (evidence cards, signal_empty recovery, query_mode first-classing) become measurable consequences of foundational fixes rather than competing parallel efforts.

### Accepted costs

- The MCP `retrieve_context_pack` response adds a new field (`coverage_confidence`). Existing fields preserved; consumers reading the response shape need to be tolerant of additive change.
- Items 6–8 are real engineering work; the v1 ship date depends on how far items 1–5 carry the seed scores.
- The synthetic 126-case fixture's gates may need to be re-examined as items land — they may be too lax for the new architectural layer.
- The frozen seed baselines may need to be expanded to score the new per-intent and per-coverage axes; per-intent metrics already exist in the runner output but the seeds may need additional per-cell coverage.
- The deferred Phase 3 experiments (evidence cards, code/test bootstrap, etc.) slip out of the immediate retrieval-correctness window. They are not killed; they are deprioritized until retrieval correctness clears the threshold.

### Constraints imposed on the future

- Any retrieval-pipeline change ships behind a Linear ticket and a per-experiment writeup that reports per-surface deltas (synthetic, Ralph, Prisma) and a ship/rollback/park decision per the week-7 plan's bar-by-experiment-type rule.
- Items 7–8 are gated — they cannot ship just because they're available. The threshold check is the gate.
- The frozen Ralph and Prisma seeds (or extended successor seeds) are the comparison surface for any future retrieval claim. Synthetic-only quality claims require explicit framing as "passes the regression gate" rather than "engine is good."

## References

- [Week 7 plan — baseline + experiments](../plan/week-7-baseline-and-experiments-2026-05.md)
- [Week 7 retrieval audit](../plan/week-7-retrieval-audit-2026-05.md)
- [Phase 1.3 baselines (Ralph + Prisma)](../plan/week-7-baseline-and-experiments-2026-05.md#per-experiment-sub-sections)
- [Cross-week invariance experiment](../plan/week-7-baseline-and-experiments-2026-05.md#phase-1-sidebar--cross-week-retrieval-invariance-check-2026-05-08)
- [ADR-0011 (locked-include matching rules)](0011-locked-include-matching-rules.md) — preserved
- [ADR-0017 (structural assembly rollout contract)](0017-structural-assembly-rollout-contract.md) — preserved; assembly remains post-ranking
- [OPEN.md — deterministic-core principle](../OPEN.md) — preserved
