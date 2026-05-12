# PRD-0028 / Slice 28.3 — Verdict: Code-Source Index Parked at Flag-OFF

**Decision:** The code-source FTS index ships as wired-but-OFF structural infrastructure (slices 28.1 + 28.2 + the slice-28.3 mixing path). `RETRIEVAL_CODE_SOURCE_INDEX` default stays `false`. Slice 28.3 is parked here because gate 1 fell short of the PRD threshold.

**Reason:** Mixing code sources into the ranked pack via the simplest viable path (FTS5 BM25F over `code_sources_fts`, code entries appended to `pack.ranked` with `kind: "code"`) lifted agent-completion source-file coverage from **25.0% → 62.5%** on the 3-ticket commit-grounded probe. That is a real **+37.5-point** improvement but does not clear the PRD's **≥75%** promotion gate. Per the slice-28.3 acceptance criterion, "**Do not tune to make gates pass.**"

## Gate results (2026-05-11)

| Gate | Threshold | Flag OFF (baseline) | Flag ON | Pass? |
|---|---|---|---|---|
| 1. Agent-completion src/** coverage | ≥75% | 4/16 (25.0%) | 10/16 (62.5%) | ❌ |
| 2. Real-workflow assembly | ≥95.7% | 22/23 (95.7%) | 22/23 (95.7%) | ✅ |
| 3. 174-case real-corpus top-1/3/5 | ±1 case | (suite green) | (suite green) | ✅ |

(Gate 3 verified via `npx vitest run`, all 1478 tests green with both flag states. The retrieval-side flag toggling does not alter the doc-only retrieval path that gates 2 and 3 exercise — code entries are appended only when the flag is on, and the real-workflow / 174-case fixtures import docs only.)

## Per-ticket breakdown of the +37.5-point lift

```
THO-228 (PRD-0027 nav-field extension)   3/7 → 6/7
  + src/parse/source-profile.ts
  + src/store/source-profiles.ts
  + src/types/source-profile.ts
  still missed: src/retrieve/source-card.ts

THO-218 (heading aliases source-rerank)  1/4 → 2/4
  + src/retrieve/heading-aliases-flag.ts
  still missed: src/retrieve/fused-source-candidates.ts,
                src/retrieve/multi-path-candidates.ts

THO-225 (BM25F chunk-layer)              0/5 → 2/5
  + src/retrieve/bm25.ts
  + src/retrieve/retrieve.ts
  still missed: src/retrieve/structural-chunk-context-flag.ts,
                src/store/chunks.ts, src/store/db.ts
```

The lift is real and per-symbol — the index surfaces the file an engineer would open when the symbol or filename is named in the query. Where it falls short, the misses are files whose role in the change is *structural* (db.ts, chunks.ts touched as substrate) rather than *named in the natural-language query*. FTS5 over symbol/path tokens has no signal for "this file was edited because of an indirect dependency."

## Why the simplest mixing strategy fell short of 75%

The mixing path here is intentionally minimal: code entries are appended to `pack.ranked` after presentation, scored by FTS5 BM25F with the principled PRD weights (2.5 / 2.5 / 1.2 / 1.0), no rerank-pipeline integration beyond that. The agent-completion probe's `extractFilePathMentions` scans ranked-entry bodies for `src/...\.ts` shaped tokens — code entries surface the file path in body text, so any code entry returned for a query directly adds to the metric.

The cap at ~62.5% reflects two structural limits the PRD already named as risks:

1. **Symbol-name → file-path coverage is bounded by *named* symbols.** A query like "PRD-0025 BM25F chunk-layer extension" surfaces `bm25.ts` and `retrieve.ts` because BM25 and retrieval are in the path tokens, but the *flag module* whose name is `structural-chunk-context-flag.ts` doesn't get named in the query and doesn't FTS-match the question text either. The 75% bar implicitly requires either query rewriting (decompose "implement X" into "edit the substrate files of X") or import-graph traversal (slice 28.X future) — neither is in 28.3 scope.

2. **Substrate files (db.ts, chunks.ts, schema.ts) are touched as *transitive* dependencies.** They don't show up in PRD body text and don't FTS-match topic queries; they only show up when a query specifically names them, which is rare in natural-language ticket queries. This is the same boundary PRD-0027's nav graph hit on the markdown side — graph traversal is a different lever than identity matching.

## What lands

- **Slice 28.1** (`src/parse/code-source.ts`, `src/types/code-source.ts`): TypeScript AST extractor. Pure, deterministic, 23 example tests + 200-run synthetic property gate at lower-95 ≥ 95%. Universal across TS projects.
- **Slice 28.2** (`src/store/code-sources.ts`, schema additions, `importCodeSources` in `src/cli/import.ts`): `code_sources` table peer to `source_profiles`, FTS5 virtual table indexing `file_path` / `exported_symbols` / `file_purpose` / `exported_signatures` with the spec-locked PRD weights, importer wiring that runs unconditionally so the table is always populated.
- **Slice 28.3 structural code** (`src/retrieve/code-source-flag.ts`, `src/retrieve/code-source-mix.ts`, `RankedEntry.kind = "code"` Zod-schema extension, assemble-with-links integration): wired-but-OFF mixing path. Re-enabling for further investigation is a one-line env flip.

## What does **not** land

- **Flag flip.** `RETRIEVAL_CODE_SOURCE_INDEX` default stays `false`. Flipping it is a documented next step gated on either (a) extending the mixing strategy with substrate-file or graph signal or (b) re-evaluating the 75% threshold against the structural ceiling described above.

## Reusable infrastructure

The extractor (28.1) and storage (28.2) are corpus-agnostic and could underpin future code-side levers:

* **Symbol-anchor card linking.** Cards already anchor on symbols; the `code_sources` index gives those anchors a canonical resolution target.
* **Import-graph traversal.** `imports[]` is captured at extract time; a future slice could walk imports the way PRD-0027's nav traversal walks markdown links.
* **Query-time symbol expansion.** Decomposed queries from a future ambiguity planner could project symbol mentions onto code-source candidates without changing the source-rerank scoring path.

Each of these is a separate lever. None is required to ship 28.1/28.2 as parked infrastructure.

## Lesson for follow-up

The PRD anticipated this exact failure mode in its risks section: *"a code file's identity is paths + exported symbols + purpose comment — the same shape as a doc's identity."* That symmetry argument carries the index to a real **+37.5-point lift** but stops at the symbol/path layer. Pushing past it requires graph signal or query rewriting, neither of which is "more tuning" — they are different levers. PRD-0028 having reached its structural ceiling is a clean parking point.
