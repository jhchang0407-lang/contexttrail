# ADR-0007: Hybrid scoring — additive text base, multiplicative structural boosts

**Status:** Accepted
**Date:** 2026-05-05

## Context

The retrieval engine produces a Context Pack by scoring every candidate Doc Chunk against the retrieval request and packing the highest-scoring chunks until the token budget is exhausted. The grilling session on 2026-05-05 had to pin down the *shape* of the score, not just its weights. Three real failure modes had to be dodged:

1. **Vocabulary mismatch buries exact matches.** A chunk for a task on `RefundService.processRefund` may use the words "Stripe retry safety" instead of "refund" or "idempotent." If the score is purely BM25 (or fully multiplicative on BM25), the chunk's strong file/symbol/scope signals can't rescue it from a near-zero text match.
2. **Strong text drowns out structural mismatch.** A chunk packed with the task's keywords but tagged for a different module should still rank below a structurally-aligned chunk with weaker keyword overlap. Pure additive scoring lets a single dominant signal win regardless of the others.
3. **Tiny irrelevant chunks slip in cheap.** Packing by `score / sqrt(token_count)` rewards small chunks; a 50-token chunk with score 0.05 can outrank a 600-token chunk at score 0.4 if the threshold is unbounded.

## Decision

The score has two parts that compose hybrid:

```
text_score    = w_bm25 · BM25_norm + w_heading · heading_match_score
final_score   = text_score
              · (1 + w_scope    · scope_match_score)
              · (1 + w_mentions · mention_overlap_score)
              · specificity_weight(scope_layer)
packing_score = final_score / sqrt(token_count)
```

Defaults: `w_bm25=0.70`, `w_heading=0.30`, `w_scope=0.70`, `w_mentions=0.80`. `specificity_weight` ranges from 0.9 (company) to 1.4 (module). `min_final_score=0.05` filters tiny irrelevant chunks before packing.

Three structural choices are load-bearing:

- **Additive on text.** BM25 and heading-match are both lexical signals over the same body of words. Adding them lets a strong heading match compensate for weak BM25 (or vice versa) without either being able to zero the other out. Failure mode 1 is rescued because heading match alone can keep a chunk afloat when BM25 misses on vocabulary.
- **Multiplicative on structural boosts.** Scope alignment and code-anchor overlap are *categorical* signals — a chunk either matches the query's module or it doesn't. Multiplicative boosts let zero structural alignment leave the text score unchanged (boost factor = 1.0) while strong alignment scales it meaningfully. Failure mode 2 is rescued because a chunk in a wrong module never multiplicatively beats one in the right module at equal text strength.
- **Min final score threshold.** Failure mode 3 is rescued by gating cheap chunks on absolute relevance, not just relevance-per-token.

All weights live in `config.yaml` from day 1. Tuning is a config edit, not a code change.

## Considered alternatives

- **Pure multiplicative on BM25.** Rejected because failure mode 1 is exactly the kind of vocabulary mismatch embeddings will later address. The deterministic core has to handle near-misses on text by *structure*, or it cannot stand alone (a load-bearing principle from [ADR-0004](0004-bar-2-scope-with-embeddings-and-bootstrap.md)).
- **Pure additive across all signals.** Rejected because failure mode 2 — a strong-text chunk in the wrong scope drowning out a weaker-text chunk in the right scope — is a common retrieval pathology. Additive structural signals are tunable into irrelevance but never into rejection.
- **Reciprocal rank fusion (RRF).** Considered for combining BM25 with future cosine. Rejected for v1 because it's harder to explain ("why is this chunk ranked #4?") and `contexttrail explain` needs to surface per-signal contributions clearly. Weighted-sum + multiplicative boosts are decomposable in the explain trace.
- **Rerank pipeline (BM25 → top-50 → second-stage rerank).** Rejected for v1 because it adds a stage and a tuning surface for no demonstrated gain at v1 scale. Revisit if week-7 measurement shows a gap.

## Consequences

### Positive
- Exact-match-but-different-vocabulary cases (which embeddings will later address) are *also* rescued by structural boosts — the deterministic core is more robust than a pure-text baseline.
- `contexttrail explain` can show every component contribution because the formula decomposes cleanly.
- Tuning during dogfood is config-only.

### Negative
- The formula has more knobs than a pure additive or pure multiplicative baseline. The defaults must be reasonable on real data; bad defaults look like bad retrieval.
- Multi-scope queries require an explicit OR rule (`max(...)` over scope matches) to avoid penalizing legitimate cross-module work — added in D34 and tested.

### Anti-patterns this ADR exists to block
- "BM25 should be the only relevance signal; everything else is a tiebreaker." No — structural rescue is a deliberate behavior.
- "Just use embeddings to fix vocabulary mismatch." Embeddings are an enhancement layer ([ADR-0004](0004-bar-2-scope-with-embeddings-and-bootstrap.md)); the deterministic core must stand alone, and that requires structural rescue in the score itself.
- "Make scoring more multiplicative — it's principled." It punishes near-misses too hard; failure mode 1 returns.

## References

- [DESIGN.md D34](../DESIGN.md) — full formula and defaults in dependency order
- [SCHEMA.md retrieval block](../SCHEMA.md) — config shape and tunable weights
- [MVP.md week 2 deliverables](../MVP.md) — implementation breakdown
- [ADR-0004](0004-bar-2-scope-with-embeddings-and-bootstrap.md) — the "deterministic core stands alone" principle that motivates structural rescue
