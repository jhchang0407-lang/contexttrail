# PRD-0025 Chunk-Layer Structural Indexing — Verdict and Rollback Decision

**Decision:** PRD-0025's chunk-layer field additions did not improve retrieval and introduced regressions. Roll back the BM25F field additions and FTS5 schema changes. Keep the monotonic-BM25 hardening (commit `67d08cc`) and the doc_purpose provenance trace (slice 25.1) — both are legitimate improvements independent of the chunk-layer hypothesis.

**Reason:** The signals added at the chunk layer (`doc_title`, `doc_purpose`, `section_intro`) duplicated information source-rerank already had at the source level. Adding them to chunk BM25F created index bloat without delivering new discrimination, and the symmetric-on-broad-docs failure mode reappeared (e.g., `turborepo-anchored-globs` regression: `configuration.md` displaced `globs.md` because the broader doc accumulated more matches per chunk via the repeated structural prefix).

## Three errors in PRD-0025's framing

The user's diagnosis after the implementation:

1. **Source-vs-chunk layer error.** `doc_title`, `doc_purpose`, `section_intro` already feed source-rerank's source-level features (via `SourceProfile`). Putting them on chunks via BM25F duplicated rather than added evidence. Source-rerank already knew the doc's title and purpose; giving the same information to chunk-level BM25 didn't tell the engine anything it didn't have.
2. **Bottleneck-recall framing error.** The eval data has shown for several PRDs that the accepted source is almost always already in top-5/top-10 candidates. Failing cases are sibling-discrimination problems, not candidate-recall problems. PRD-0025's lever was "find the source"; the actual problem is "choose among plausible siblings."
3. **Symmetry-on-broad-docs failure mode.** Every chunk in `configuration.md` got the same prefix tokens; whichever doc was broader (more chunks, more body text) accumulated more matches per chunk. The same surface-signal-symmetry trap that bit PRD-0023 path-topology, expressed at the chunk layer.

The monotonic-BM25 fix (`67d08cc`) made the implementation safe (structural context can add signal, cannot erase base-field evidence) but did not change the diagnosis: this lever is largely redundant with source-level signals.

## Exhaustive evaluation of remaining chunk-level deterministic options

Before recommending rollback, audited every chunk-level deterministic signal we could add:

| Chunk-level signal | Per-chunk vs per-doc? | Already captured? | New discrimination? |
|---|---|---|---|
| Doc-level fields (title, purpose, section intro) | per-doc | yes — via SourceProfile | **no** (PRD-0025's mistake) |
| Relative position in doc | per-chunk | no | marginal |
| Has-code vs prose ratio | per-chunk | implicit in BM25 | marginal |
| Code-fence languages in this chunk | per-chunk | source-level via PRD-0024 | small |
| Chunk-level entity subset | per-chunk | source-level only | redundant with body BM25 |
| Cross-chunk references | per-chunk | no | small |
| Chunk-level heading siblings | per-chunk | no | marginal |
| Chunk's local heading depth | per-chunk | yes — via heading_path | already there |
| Chunk's intra-doc IDF | per-chunk | implicit in BM25 | weaker than corpus IDF |
| Question-shaped headings | per-chunk | yes — `question_heading` candidate path | already there |

**No chunk-level deterministic signal carries new discrimination of meaningful magnitude.** Candidates are either redundant with what BM25 already does, redundant with source-level fields, or marginal.

## Rollback scope

**Revert:**
- BM25F field-weight additions (`doc_title`, `doc_purpose`, `section_intro`) — slice 25.3
- FTS5 virtual-table column additions for the three new fields — slice 25.2
- The `RETRIEVAL_STRUCTURAL_CHUNK_CONTEXT` flag and its wiring
- The five additive `doc_chunks` columns introduced in 25.2 (or keep them unused if removal is more disruptive than benefit; the columns being null is harmless beyond minor storage cost)

**Keep:**
- Monotonic-BM25 hardening (commit `67d08cc`) — legitimate safety improvement that prevents structural context from erasing base-field evidence; useful even if no structural context is being added today, in case a future PRD adds new BM25F fields safely.
- `doc_purpose` provenance trace from slice 25.1 — useful for explain output and the existing classifier transparency, even without indexing it as a BM25F field.

## Lessons banked

1. **Source-level signal extraction has been the productive lever**, but only when the signal is genuinely novel. Heading aliases (PRD-0024 slice 1, +1 clean) added new evidence; chunk-level structural context (PRD-0025) duplicated existing evidence.
2. **Sibling discrimination is the bottleneck**, not candidate recall. Top-3 at 97.5% means the right source is almost always in candidates; the gap is choosing between siblings.
3. **The repeated-prefix-on-broad-docs failure mode** is the chunk-layer cousin of PRD-0023's "every index.md gets the same boost." Both share the architecture of "more surface evidence symmetric across candidates promotes the bigger candidate." This pattern recurs whenever an additive signal is applied uniformly across chunk/source surface area.
4. **Deterministic chunk-layer signals are largely tapped out** for this corpus. The next productive direction is source-level relational signals (nav, link graph) where the discrimination lives at the layer where the bottleneck actually is.

## What's next

PRD-0027 will deliver source-level relational metadata: nav/sidebar parser + link-graph extractor. This is the audit's slices 4 and 5 from `.out-of-scope/source-profile-v2-miss-audit.md`, and was the originally-correct next lever before the chunk-layer detour.
