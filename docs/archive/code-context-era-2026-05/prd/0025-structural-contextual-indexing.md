# PRD-0025: Structural Contextual Indexing

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's twenty-fifth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADRs: [ADR-0007](../adr/0007-hybrid-scoring-additive-text-multiplicative-structure.md), [ADR-0014](../adr/0014-agent-assisted-setup-without-truth-promotion.md), [ADR-0019](../adr/0019-retrieval-architecture-rethink.md). Related PRDs: [PRD-0014](0014-retrieval-engine-v3-source-selection-and-aboutness.md), [PRD-0016](0016-deterministic-retrieval-precision-and-assembly-ready-top3.md), [PRD-0024](0024-import-time-evidence-extraction.md). Parked context: [.out-of-scope/source-rerank-tiebreakers-architecture.md](../../.out-of-scope/source-rerank-tiebreakers-architecture.md), [.out-of-scope/source-profile-v2-miss-audit.md](../../.out-of-scope/source-profile-v2-miss-audit.md).
>
> Boundary rule: this PRD shifts the lever from **source-level signal extraction** (PRD-0023 path topology, PRD-0024 heading aliases / code-fence entities) to **chunk-level structural indexing**. Each chunk's indexed text is augmented at import time with deterministically-computed structural context. **Fully deterministic, no AI, no LLM calls.** AI augmentation stays explicitly out of scope; if structural CI plateaus, an AI layer can be added later as an opt-in strict-superset signal.

## Problem Statement

Source-rerank now has access to richer source-level metadata than ever (path topology, heading aliases, code-fence entities). But four PRDs of source-level extraction have produced a cumulative net top-1 lift of **+1** on the 122-case real corpus:

| PRD | Lever | Top-1 Δ | Production state |
|---|---|---:|---|
| PRD-0022 close-call tiebreakers | Post-sort surface symmetric swap | −1 (parked) | flag off |
| PRD-0023 path-topology unconditional | Always-on additive boost | 0 (parked) | flag off |
| PRD-0023 conditional gate | Conditional additive boost | +3 / honesty regression (parked) | flag off |
| PRD-0024 slice 1 (heading aliases) | New evidence consumed by existing features | **+1** (clean) | flag on |
| PRD-0024 slice 2 (code-fence entities) | Same shape, broader entities | 0 / wash (parked) | flag off |

The signal-volume failure mode keeps recurring at the source layer: a doc with more entities/aliases out-weights the more specific doc on broader queries, and a doc with fewer specific entities loses to a doc with broader content surface. **Source-level features are running out of differentiating power on this corpus.**

Inspection of the failing cohort shows a recurring shape: **the doc that should win has the right answer in its heading hierarchy or section intro, but the chunk-level retrieval pipeline doesn't see those structural fields per-chunk.** Source-level rerank uses doc title + heading_outline; chunk-level retrieval (BM25 over chunk text) sees only the chunk's body text, which often doesn't repeat the parent heading prominently.

The retrieval ceiling is **not the rerank function** (we've now confirmed this empirically). It's **what the chunk-level index has access to.** Chunks today carry their text and minimal metadata; they don't carry the structural drift that would let lexical retrieval differentiate `Routers > Defining` from `Validators > Schema validation` when the query token is "router".

## Solution

At chunk-creation time, augment each chunk's *indexed representation* (the data that BM25 and any future dense retrieval read against) with structural context **stored as separate BM25F fields, not as a concatenated prefix.** Display text is unchanged. Every field is deterministic, traceable to a markdown-AST node, with provenance/confidence captured for any field that has more than one possible inference path.

### Why fielded, not prefix-prepended

BM25 with a long repeated prefix has two failure modes:
- **Length normalization punishes longer docs** disproportionately because the prefix inflates document length without proportional discriminating-token gain.
- **Heading / title terms can dominate** the term-frequency profile, drowning out body-specific tokens that should differentiate close calls.

ContextTrail already runs **BM25F** (fielded BM25) with three fields today: `title` (weight 2.5), `heading_path` (1.5), `body` (1.0). Adding structural context as new fields plays to the existing infrastructure: per-field weights handle the "how much should this matter" question explicitly, and length-normalization is computed per-field, not over a smashed-together blob.

### Field-level shape

The chunk's existing BM25F fields are extended to **six fields total**:

| Field | Existing? | Source | Default weight | Notes |
|---|---|---|---:|---|
| `title` | yes | chunk's local heading title | 2.5 | unchanged |
| `heading_path` | yes | full H1 → H2 → … drift | 1.5 | unchanged |
| `body` | yes | chunk text | 1.0 | unchanged |
| **`doc_title`** | **new** | parent doc's title (denormalized per-chunk) | **2.0** | doc-level identity tokens carried into chunk-level retrieval |
| **`doc_purpose`** | **new** | parent doc's purpose enum value | **1.0** | categorical signal — single token, low weight |
| **`section_intro`** | **new** | first 300 characters of the chunk's containing-section intro paragraph | **1.2** | mid-weight; richer context but lower than chunk title |

Weights are principled fixed values (not tuned against the failing cohort): the new fields slot between the existing `body` (1.0) and `heading_path` (1.5) on importance, with `doc_title` slightly above `heading_path` because doc-level identity is the most discriminating non-chunk-local signal we have.

### `doc_purpose` provenance and confidence

`doc_purpose` is a categorical signal already classified deterministically from path/nav/frontmatter/heading heuristics (existing `SourceProfile.doc_purpose`). PRD-0025 surfaces the **trace** of that classification per-chunk so eval can attribute lift to specific provenance paths and so the field can be inspected without re-running the classifier:

```ts
type DocPurposeTrace = {
  value: DocPurpose;             // existing enum: "guide" | "concept" | ...
  provenance: string[];          // ["path: /guide/", "h1: 'Mocking Guide'"]
  confidence: "high" | "medium" | "low";
};
```

`doc_purpose` is indexed at the **value** field. The `provenance` and `confidence` fields are stored alongside on the chunk record (or via a denormalized lookup on the source profile) so eval explain output can show which signal produced the classification. **No silent semantic invention** — every classification has a documented signal trail.

### Why this is candidate-generation first, not a ranking boost

The primary lever is **what enters the source-card slate**, not how the rerank scores within the slate. The chunk-level BM25 score feeds the `lexical_chunk` candidate-generation path. Today, a chunk in `routers.md` whose body doesn't repeat the word "router" prominently can lose lexical retrieval to a chunk in `validators.md` whose body has dense `router`-adjacent vocabulary. With structural CI, the routers.md chunks index against `doc_title="tRPC"` and `heading_path="Routers > Defining"` — query token "router" surface-matches via the heading_path field at weight 1.5, surfacing more routers.md chunks into the lexical_chunk candidate set.

**The eval question is "does the accepted source land in the candidate slate more often, with fewer competing distractors?"** not "does top-1 jump." Source-rerank's existing source-level scoring then consumes the better slate without any rerank-side change.

### What this fixes (predicted addressable cohort)

The PRD-0024 slice 24.2 diagnosis localized two recurring failure modes:

- **Volume gap**: e.g., `validators.md` (130 entities) beats `routers.md` (28 entities) on query "router" because validators.md has broader content surface. With structural CI, every chunk in `routers.md` indexes against text including the drift token `Routers`. Query token `router` surface-matches via drift regardless of validators.md's entity volume. Validators.md's chunks have contexttrails like `Validators > Defining` — no "router" token in the drift at all.
- **Extraction gap**: e.g., `ERROR_HANDLING.md` only had 3 symbols extracted (`z` × 3) because the doc uses `error instanceof ZodError` patterns the symbol extractor doesn't capture. With structural CI, the H1 "Error Handling" and section intros prepend to every chunk in that doc. Query token "errors" surface-matches via drift regardless of whether `ZodError` was ever extracted as a code-fence entity.

Both patterns are addressed by **giving chunks access to their structural drift at index time** — which is what every Anthropic-blog-shaped contextual-retrieval implementation does, just produced from markdown AST instead of an LLM.

### Why deterministic instead of LLM-based contextual retrieval

Cost is acceptable (~5000 LLM calls/import), but reliability is not. AI-generated context is a "ballistic machine" — same chunk content can produce different context across runs, model versions, prompt revisions. That non-determinism violates ContextTrail's index-time stability contract: a corpus imported today should produce the same retrieval behavior as the same corpus imported next month. Reproducibility, audit trails, and incident debugging all depend on this.

Structural CI gives most of the lift (estimate: 60–70% of full LLM-CI's effect on well-structured corpora) at zero AI cost and full reproducibility. AI augmentation stays available as a future opt-in strict-superset layer if structural CI plateaus before the 97/99 targets.

### What this does NOT change

- Source-rerank's source-level scoring features and coefficients
- Heading aliases / code-fence entities from PRD-0024 (those operate at source-card level; this operates at chunk-text level — they compose, not conflict)
- Chunk *display* — the prefix is only on the indexed form
- The MCP response shape — Context Pack continues to cite chunks by their original text
- Schema versioning at the public-contract layer (additive optional fields only)

## User Stories

1. As a ContextTrail maintainer, I want every chunk's indexed text to include its full heading-path drift at import time, so that BM25 chunk-level retrieval can differentiate chunks by their structural location, not just their body text.
2. As a ContextTrail maintainer, I want the chunk's containing-section intro paragraph prepended to its indexed text, so that chunks in the middle of a long section gain the section's topical context.
3. As a ContextTrail maintainer, I want the doc title and doc-purpose prepended to every chunk's indexed text, so that chunks in topically-narrow sections still carry their parent doc's identity in lexical retrieval.
4. As a ContextTrail maintainer, I want the augmentation to be 100% deterministic at import time, so that the same corpus produces byte-identical indexed text across runs / machines / time.
5. As a ContextTrail maintainer, I want the original chunk body preserved separately from the indexed text, so that display-time citations and Context Pack output remain unchanged.
6. As a ContextTrail maintainer, I want the structural context prefix to be bounded in length, so that long chunk content doesn't have its term-frequency profile diluted by the prefix.
7. As a ContextTrail maintainer, I want this PRD to make zero changes to source-rerank's source-level scoring features or coefficients, so that we test the chunk-level lever cleanly without entangling source-level changes.
8. As a ContextTrail maintainer, I want a feature flag controlling whether the prefix is used at retrieval time, so that the lift can be validated against the displayed baseline before becoming default.
9. As a ContextTrail maintainer, I want the BM25 index to rebuild when the prefix is enabled or disabled, so that consistency between flag state and indexed content is enforced.
10. As a ContextTrail maintainer, I want each component of the prefix (title, purpose, heading-path, intro) to be independently traceable in eval explain output, so that lift attribution is clear.
11. As a ContextTrail maintainer, I want acceptance to require at least one addressed miss explained by the structural prefix, so that the lever is shown to be doing real work.
12. As a future implementer, I want AI augmentation to remain explicitly out of scope for this PRD, so that the deterministic floor is measured before optional AI layers are added.

## Implementation Decisions

### Per-chunk structural context fields

Three new fields on the chunk record, each populated deterministically from existing inputs:

```ts
type DocPurposeTrace = {
  value: DocPurpose;             // existing enum
  provenance: string[];          // ["path: /guide/", "h1: 'Mocking Guide'"]
  confidence: "high" | "medium" | "low";
};

type StructuralChunkContext = {
  doc_title: string;             // SourceProfile.title (already extracted)
  doc_purpose: DocPurposeTrace;  // value + trace, traceable to specific signals
  section_intro: string;         // first 300 chars of containing-section intro paragraph
};
```

Field rules:
- `doc_title`: from `SourceProfile.title`. No transformation beyond tokenization.
- `doc_purpose.value`: from existing `SourceProfile.doc_purpose` classifier. The classifier already runs deterministically off path / nav / frontmatter / heading heuristics — PRD-0025 doesn't change the classifier; it surfaces the trace.
- `doc_purpose.provenance`: an ordered list of strings naming the signals that contributed to the classification (e.g., `["path: /guide/", "h1: 'Mocking Guide'"]`). Generated by extending the existing classifier to record what it considered.
- `doc_purpose.confidence`: `high` when ≥2 corroborating signals agree; `medium` when 1 strong signal; `low` when only soft heuristics fired.
- `section_intro`: first paragraph of the chunk's most-specific containing section, truncated at the **300th character**, snapping to the nearest word boundary. If the chunk *is* the first paragraph (would duplicate body), the field is empty.

### New module: `src/parse/chunk-structural-context.ts`

Exports a single pure function:

```ts
buildChunkStructuralContext(args: {
  source_profile: SourceProfile;
  heading_path: string[];
  section_intro: string | null;
  containing_section_chunk_index: number;
  this_chunk_index: number;
}): StructuralChunkContext;
```

### `doc_purpose` classifier extension

The existing classifier is extended to **return its provenance trace**, not just the value. No new heuristics, no new signals — just exposing what the classifier already considered:

```ts
classifyDocPurpose(args): DocPurposeTrace
```

This is a strictly-additive change: existing callers that read only the `value` keep working; eval and explain paths consume the new fields.

### Chunk persistence changes

The `doc_chunks_fts` virtual table gains three new columns: `doc_title`, `doc_purpose`, `section_intro`. **FTS5 virtual tables can't be ALTERed** in SQLite, so the migration recreates the FTS table. The migration:

1. Detect FTS schema mismatch at import startup
2. Drop and recreate `doc_chunks_fts` with the new column list
3. Rebuild the FTS index from `doc_chunks` rows (one-time cost)

The non-FTS `doc_chunks` table gains:
- `doc_title TEXT` (denormalized per-chunk for FTS write path)
- `doc_purpose_value TEXT`, `doc_purpose_provenance TEXT` (JSON), `doc_purpose_confidence TEXT`
- `section_intro TEXT`

All additive via `ALTER TABLE IF NOT EXISTS`. No `schema_version` bump.

### BM25F field-weight changes

Extending `FieldWeights`:

```ts
const DEFAULT_FIELD_WEIGHTS: FieldWeights = {
  title: 2.5,           // unchanged
  heading_path: 1.5,    // unchanged
  body: 1.0,            // unchanged
  doc_title: 2.0,       // NEW — between heading_path and title
  doc_purpose: 1.0,     // NEW — categorical signal, body-equivalent weight
  section_intro: 1.2,   // NEW — between body and heading_path
};
```

Weights are principled fixed values, not tuned. If they don't deliver, we revisit the principle, not the values.

### Source-rerank changes

**None.** Source-rerank still scores docs from `SourceProfile`. The lift comes from the chunk-level BM25F producing a better candidate slate that the lexical_chunk candidate-generation path feeds into source-rerank. `lexical_chunk_score` (the existing feature) reflects the new BM25F score automatically. No new coefficient. No new feature.

### Feature flag

- `RETRIEVAL_STRUCTURAL_CHUNK_CONTEXT=on|off` (default off until promotion gates pass).
- The flag controls whether the BM25 indexer reads `indexed_text` or chunk body. When the flag flips, the BM25 index must rebuild to match the flag state.
- Reindexing scripts gain a flag-aware mode so the dev workflow can compare flag-on / flag-off cleanly.

### What's explicitly out of scope

- AI / LLM-generated chunk context (the "ballistic machine" concern). May be revisited as a future opt-in strict-superset layer.
- Dense / embedding-based retrieval. The prefix benefits dense retrieval too, but PRD-0025 is BM25-only. Dense retrieval is a separate architecture decision (PRD-0018 era prototype, parked).
- New source-rerank coefficients or features.
- Changes to chunk display, Context Pack output, MCP response shape.
- Schema-version bumps at the public-contract layer.
- Tuning prefix component lengths against the failing cohort. Lengths are principled fixed values; if they don't deliver, we revisit the principle.

## Testing Decisions

### Synthetic property tests

In `src/eval/synthetic/chunk-structural-context.test.ts`:

- **Determinism**: 200 random heading-path / intro / chunk inputs ⇒ same input always produces byte-identical prefix. Lower-95 ≥ 99% (this should be 100%; 99% is the property-test floor for "no flakes").
- **Bounded length**: prefix is at most `<title> + <purpose> + <contexttrail> + 280-char intro + 4 newlines`. Asserted across 200 random inputs.
- **Heading-path correctness**: nested H1→H2→H3 inputs produce the right drift in order.
- **Intro extraction**: chunks at the start of a section have empty intro; chunks later in the section get the section's first paragraph.
- **Empty fields**: missing title / purpose / headings degrade gracefully (empty lines, not undefined-strings).

### Adversarial coverage

- Chunks at the very top of a doc (before any H1) — gracefully degraded, no drift.
- Chunks in headingless docs — degraded to title + purpose only.
- Section intros containing markdown link syntax / code spans / unicode.
- Very long section intros (truncated at word boundary, asserted).
- Chunks whose body is shorter than the prefix — prefix doesn't dominate via repetition (single occurrence each).
- Recursive heading shapes: H1 → H3 → H2 — drift skipped levels handled deterministically.

### Real-corpus discipline — candidate-generation framing

The primary metric is **candidate-slate composition**, not top-1 lift. Specifically:

1. **`accepted_in_top_N` recall**: across answer-bearing cases, how often does the accepted source land in the top-N candidate slate that source-rerank receives? Measured at N=10 (current slate size) and N=5 (tighter cut).
2. **Slate-distractor count**: among the top-5 candidates, how many are structurally unrelated to the accepted source? (Approximated by source-family cluster diversity.)
3. **Top-1 lift** is a *secondary* metric. We expect it to follow from better slate composition, but it's not how we judge whether structural CI worked.

Predicted addressable cohort (from the failing-case audit, prioritized by which depend on chunk-level structural context that's currently missing):

- **High confidence** (heading_path field already exists; new fields directly disambiguate):
  - `trpc-anchored-router` (`doc_title=tRPC` + `heading_path=Routers > …` discriminates from `validators.md`'s heading_path)
  - `zod-anchored-error-handling` (`doc_title=Zod` + section intro mentioning ZodError disambiguates from package README)
  - `vitest-anchored-mocking` (parent vs child differentiated by `heading_path` depth + `section_intro` for the parent overview)
  - `hono-anchored-validation` (`doc_title=Hono` + `heading_path` containing "Validation" surfaces the guide)
- **Medium confidence** (section intro carries the topical signal):
  - `prisma-cross-module-migrate-vs-schema` (mental-model section's intro is conceptually framed; query "how does X work" matches conceptual prose)
  - `vitest-anchored-snapshot` (already addressed by PRD-0024 slice 1 — must not regress)

Conservative target on the primary metric: **`accepted_in_top_5` improves by at least 4 cases** (from current ~107 to ≥ 111). Stretch: 6+. The gate framing is "did the slate get better," not "did the rerank score change."

Per-case identity verification + zero-regression discipline carry forward from PRD-0024.

## Promotion Gates

Conjunctive — every gate must pass before the feature flag flips to `on`:

- `npm test` passes
- `npx tsc -p tsconfig.json --noEmit` passes
- All synthetic property tests pass at lower-95 ≥ 99% (determinism is the load-bearing property)
- Adversarial suites pass
- Real-corpus eval (flag on, BM25 reindexed):
  - **Primary**: `accepted_in_top_5` improves by ≥ 4 cases vs current displayed baseline
  - **Primary**: slate-distractor count (avg structurally-unrelated candidates in top-5) does not increase
  - **Secondary**: top-1 ≥ 107/122 (no regression vs current baseline; lift is a bonus, not a gate)
  - top-3 ≥ 118/122 (no regression)
  - coverage_honest stays 148/148
  - agent_answer ≥ 147/148
  - chunk_correctness ≥ 3/3
  - per-case `regressions == 0` against current displayed baseline
  - At least one addressed miss explained by which **field** carried the new evidence (commit must call out: which case + which field — `doc_title` / `doc_purpose` / `section_intro` — surfaced the chunk into the slate)
- All predicted addressable cases verified or explained
- All unpredicted flips reviewed and classified before acceptance

**Why the gate is candidate-recall first:** If structural CI improves the slate but source-rerank's existing scoring doesn't tip the right candidate to top-1, that's a separate problem (one we've spent four PRDs on). PRD-0025's hypothesis is "the chunk index is starved of context" — its acceptance bar should reflect that hypothesis, not a downstream-of-rerank metric. Top-1 stays a regression guard, not a promotion driver.

## Out of Scope

- LLM / AI-generated chunk context (deferred; future opt-in layer if structural CI plateaus)
- Dense / embedding-based retrieval (PRD-0018-era prototype; separate decision)
- New source-rerank features or coefficients
- Changes to chunk display, Context Pack output, or MCP response shape
- Tuning prefix component lengths against the failing cohort (principled fixed values)
- Multiple competing prefix shapes (one shape ships; revisit later if needed)
- Backfill of `indexed_text` for previously-imported corpora — reindex on next import
- Re-litigating the parked PRD-0022 / PRD-0023 ranking-time boost lanes

## Further Notes

This PRD is the architectural shift the project has been pointing at for several iterations. After four PRDs of source-level signal extraction producing +1 cumulative top-1, the chunk layer is the unexplored lever. Structural CI is the chunk-layer equivalent of what PRD-0024 did at the source layer: enrich what the existing scoring sees, no new coefficients.

The deterministic-only constraint is non-negotiable for this PRD. AI-based context extraction is a real option, but it violates the index-time stability contract: same corpus, same imports, must produce the same retrieval behavior across runs and across model versions. The user's "ballistic machine" concern is precisely correct.

If structural CI delivers 3+ clean wins and clears all gates, the chunk-layer lever is validated and future work along this axis is justified (e.g., dense retrieval over the augmented text, glossary cross-reference resolution prepending, link-graph context carried through). If structural CI delivers fewer than 3 wins or introduces regressions, the project knows the chunk-layer lever has the same ceiling as the source-layer one and the next architectural decision is explicit (AI-augmented contextual indexing as opt-in, dense retrieval as a separate axis, or accept the ceiling).

The slicing for this PRD is intentionally simpler than PRD-0024's: the work is one extractor + one persistence change + one BM25 indexer change + the feature flag + the eval. Three slices: extractor + persistence (23.5 day), BM25 wiring (1 day), validation + flag flip (1 day). Estimated total: ~3–4 days. Significantly smaller than the AI-CI alternative would be.
