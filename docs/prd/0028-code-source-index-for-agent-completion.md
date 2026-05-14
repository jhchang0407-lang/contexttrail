# PRD-0028: Code-Source Index for Agent-Completion Assembly

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's twenty-eighth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADRs: [ADR-0014](../adr/0014-agent-assisted-setup-without-truth-promotion.md), [ADR-0019](../adr/0019-retrieval-architecture-rethink.md). Related PRDs: [PRD-0014](0014-retrieval-engine-v3-source-selection-and-aboutness.md), [PRD-0024](0024-import-time-evidence-extraction.md), [PRD-0027](0027-relational-source-level-metadata.md).
>
> Boundary rule: this PRD ships **code-source structural metadata** alongside the existing doc-source index. Code-source records carry path + exported symbols + JSDoc summary — **not full code bodies**. Code bodies are volatile and large; pointing the agent at the file is the deliverable. Fully deterministic; no AI required; no author-mandatory annotations.

## Problem Statement

The 2026-05-11 real-workflow eval loop measured two layered assembly metrics on the engine:

| metric | what it measures | value |
|---|---|---|
| top-5 single-doc retrieval (174-case OSS panel) | find the right doc | 96.0% |
| workflow-assembly source coverage (23 Linear tickets) | right docs in pack after link traversal | 95.7% |
| **agent-completion source-file coverage (3 shipped commits)** | **right `.ts` files in pack** | **18.8%** |

Workflow assembly is solved. The 18.8% number is the new ceiling: the engine indexes only markdown, so it physically cannot surface `.ts` files. PRDs mention some `.ts` paths in body text (which is how the 18.8% rises above zero) but rarely the new files created during implementation. An engineer picking up a ticket gets the right docs in front of them, then has to grep the codebase by hand to find the files they actually need to edit.

The 76-point gap between workflow-assembly and agent-completion is structurally what this PRD addresses.

## Solution

Two-slice extension that adds `code_source` as a peer kind alongside `doc_source` in the index. Per-file metadata extracted at import time:

- `file_path`: relative path from corpus root (e.g., `src/retrieve/source-rerank.ts`)
- `exported_symbols`: top-level exports — function names, type names, constants, classes
- `file_purpose`: file-level JSDoc / top-of-file comment block, when present
- `exported_signatures`: type-level shape for each export (function arg names + return type, type definitions)
- `imports`: relative imports of other code-sources (forms the code-side link graph, peer to the markdown link graph that PRD-0027 builds)

These records are inserted into the existing FTS index as a peer of doc-chunks. Source-rerank's existing scoring features (`title_token_coverage`, `path_token_coverage`, `heading_token_coverage`, `alias_hit_count`) consume them through the same paths: `filename_stem` becomes `title_token` substrate; `exported_symbols` become `heading_aliases` substrate (per the PRD-0024 24.1 pattern that delivered the only clean +1 win); JSDoc body becomes `intro` substrate.

**No new coefficients. No additive boosts. No code-body indexing.** The structural argument: a code file's identity is *paths + exported symbols + purpose comment* — the same shape as a doc's identity (path + title + heading outline + intro). The existing scoring features already know how to discriminate on that shape.

### Slice 28.1 — TypeScript AST symbol extractor

Walk every `*.ts` and `*.tsx` file in the configured `code_globs` once at import. For each file extract via TypeScript compiler API:

- The set of `export` declarations (function / class / type / interface / const / enum)
- For each export: name, kind, source-text signature (truncated at 240 chars)
- The file-level leading JSDoc or `/* */` comment block (when present, capped at 480 chars)
- The set of relative imports (resolved to corpus-relative file paths)

Output is a `CodeSourceFacts` record matching the shape source-rerank already consumes via the alias substrate. Synthetic property tests cover: representative export shapes (function vs type vs class vs default), files with no exports, files with no top comment, malformed source (extractor degrades to empty record, never throws).

**Universal pattern**: TypeScript AST + JSDoc is corpus-agnostic. Works on every TS project. No ContextTrail-specific heuristics.

### Slice 28.2 — Code-source storage + import-time wiring

Add `code_sources` table peer to `source_profiles`, FTS5 virtual table extension to index `path`, `exported_symbols`, `file_purpose`, `exported_signatures` as searchable fields with principled fixed BM25F weights:

| field | weight | rationale |
|---|---|---|
| `exported_symbols` | 2.5 | the canonical identifier surface — matches PRD-0027's nav-landing pattern |
| `file_path` | 2.5 | path tokens carry strong identity signal (parity with doc title weight) |
| `file_purpose` | 1.2 | JSDoc summary — parity with PRD-0025's section_intro weight |
| `exported_signatures` | 1.0 | body-equivalent for surface-form matches |

Importer adds a `code_globs` config field defaulting to `["src/**/*.ts", "src/**/*.tsx"]`. The default IS NOT all-encompassing — it explicitly skips `node_modules`, `*.test.ts`, and `*.d.ts`. Per-repo config can override.

Schema migration is idempotent ALTER-ADD. Existing imports without code sources continue to function (`code_sources` table empty, no behavioural change).

### Slice 28.3 — Retrieval mixing + agent-completion validation

Retrieve mixes code-source and doc-source candidates with the SAME source-rerank scoring pipeline. Code candidates appear in `ranked` with `kind: "code"` (peer to `"chunk"` and `"card"`).

Held-out gates (must pass before flag flip):

1. **Agent-completion source-file coverage** rises from 18.8% baseline to **≥75%** on the 3-ticket commit-grounded probe (`src/eval/agent-completion-probe.ts`).
2. **Workflow assembly** (23-ticket real-workflow probe) does NOT regress — stays at 95.7% or higher.
3. **Single-doc retrieval** (174-case real-corpus eval) does NOT regress on top-1 / top-3 / top-5 within ±1 case.

If gate 1 passes but 2 or 3 regresses, the flag stays off and we investigate which mixing strategy broke things rather than tuning to the case set.

**Slice 28.3 verdict (2026-05-11): parked at 62.5% — short of the 75% gate.** Documented in `.out-of-scope/prd-0028-slice-28-3-verdict.md`. The mixing path is sound; the cap is the symbol-name → file-path identity ceiling. Substrate files (`db.ts`, `chunks.ts`, etc.) get edited because of indirect dependencies and don't FTS-match natural-language ticket queries.

### Slice 28.4 — Code-import-graph traversal (resolves the slice-28.3 ceiling)

Structural parallel to PRD-0027's markdown link graph and the `expandLinksKHops` utility, but for TypeScript import statements. When a code-source surfaces via FTS, its imports are part of the assembly need. Slice 28.1's extractor already captures `imports[]` per file — slice 28.4 walks them at retrieval time.

Implementation: `src/retrieve/code-import-traversal.ts` (`expandCodeImportsKHops` — mirrors `expandLinksKHops`), wired into `buildCodeRankedEntries` so FTS-surfaced code candidates seed a K-hop traversal of their import graph. Default 2 hops. Imports that don't resolve to a known code-source (npm packages, `node:*` builtins) are silently filtered.

Same gates as 28.3, measured 2026-05-11 with traversal enabled:

| gate | threshold | result |
|---|---|---|
| 1. Agent-completion src/** | ≥75% | **93.8% (15/16)** ✅ |
| 2. Real-workflow assembly | ≥95.7% | 95.7% (22/23) ✅ |
| 3. 174-case top-1/top-3/top-5 | ±1 case | 82.8 / 94.3 / 96.0 — identical to baseline ✅ |

All three gates pass. `RETRIEVAL_CODE_SOURCE_INDEX` flag default flipped to `true`.

The single residual miss (`src/retrieve/structural-chunk-context-flag.ts` on THO-225) is a file with **no incoming or outgoing import edges in the current codebase** — structurally outside any import-graph lever. The 6.2-point residual gap is the floor of identity-plus-import-graph retrieval; closing it would need either reverse-import traversal at index time or query rewriting, both of which are separate levers.

> **2026-05-11 amendment ([PRD-0031](0031-reverse-import-traversal-structural-hypothesis.md) terminal state A).** The slice-28.4 verdict note above understated the shape. The PRD-0031 miss-shape audit (`docs/evals/prd-0031-miss-shape-audit.md`) re-classifies all current residuals — the 1 workflow miss + 4 agent-completion misses — and finds that **the missed targets are not in today's corpus at all** (rolled back in commit `1ca58c5` "Roll back PRD-0025 chunk-layer additions per verdict" and the PRD-0019 reorg). "No incoming or outgoing edges" was the downstream symptom of "file not in corpus." No code-import lever, forward or reverse, bounded or unbounded, can lift a target that isn't indexed. The 93.9% agent-completion / 95.7% workflow-assembly ceiling is the natural floor imposed by historical-commit-vs-current-corpus mismatch in the eval fixtures, not an engine deficit. Reverse-import bounded expansion (the PRD-0031 candidate lever) was correspondingly **not implemented** — PRD-0031 closes in terminal state A.

### Slice 28.5 — Multi-language extractors (Python, Go, Rust)

The `CodeSourceFacts` shape is language-agnostic — only the per-language parser differs. Slice 28.5 adds three regex-based extractors that emit the same record the TypeScript AST extractor produces, so the storage / FTS5 / source-rerank / import-graph traversal pipeline is unchanged for any of them.

Why regex, not native ASTs:

- **Python** would need a Python runtime or tree-sitter wasm; **Go** would need a Go toolchain; **Rust** would need `syn` or a rustc shim. The structural identity of a source file (top-level exported symbols + imports + module docstring/comment) is regex-tractable. Code bodies are explicitly out of scope (PRD-0028 boundary), so the regex extractors capture everything the source-rerank index actually consumes.

Per-language conventions honored:

- **Python**: leading-underscore = private (PEP 8). Top-level `def` / `async def` / `class` / `UPPER_SNAKE` constants extracted. PEP 613 `TypeAlias` declarations as `kind: "type"`. Module docstring (first triple-quoted block) → `file_purpose`. Relative imports (`from .x import y` / `from ..pkg import z`) resolved to corpus-relative paths.
- **Go**: capitalization = export. Functions / methods on receivers / structs (→ `class`) / interfaces / type aliases / `const` / `var`. Package-doc comment (`//` block immediately above `package X`) → `file_purpose`. Optional `module_prefix` resolves `example.com/repo/foo` → `foo` for in-module imports; stdlib imports kept verbatim.
- **Rust**: `pub` / `pub(crate)` = export. `struct` → `class`, `enum` → `enum`, `trait` → `interface`, `type X = Y` → `type`. `//!` inner module-doc block → `file_purpose`. `use crate::a::{b, c};` brace-expansion resolves to corpus-relative paths.

The dispatcher (`src/parse/code-source-dispatch.ts`) picks the right extractor from file extension. Unknown extensions return an empty `CodeSourceFacts` so callers never special-case missing extractors.

Default `code_globs` expanded to `*.ts / *.tsx / *.js / *.jsx / *.py / *.go / *.rs`. `code_ignore` expanded to skip `__pycache__/`, `test_*.py`, `*_test.go`, `target/`, `vendor/`.

Tests: 13 (Python) + 10 (Go) + 11 (Rust) + the dispatcher path covered by `code-source-mix.test.ts`.

## Out of scope

* **Full code-body indexing**. Bodies are too volatile and too large. Pointing the agent at the file is the deliverable; they read the file.
* **LLM-assisted code summarization**. JSDoc / docstring / package-doc / inner-module-doc is the source of truth for each language. LLM augmentation could come as a future slice once ADR-0014 setup-time-only AI assistance is more widely shipped, but it is not required for this PRD.
* **Test file indexing**. `*.test.ts`, `test_*.py`, `*_test.go` are explicitly excluded by the default `code_ignore` — tests are a different shape and would dilute the symbol substrate.
* **Native-AST Python / Go / Rust parsers**. The regex extractors capture everything `source-rerank` consumes. A native-AST upgrade is value-add (better signature precision, decorator semantics) but not gating.
* **Query-time graph traversal of imports**. Captured and traversed by slice 28.4 (`expandCodeImportsKHops` forward + reverse). Same boundary applies — no transitive multi-language path resolution.

## Risks

* **Symbol-name collision dilution**: in a TS codebase many files export `default`, `init`, `apply`. If every file with `apply()` becomes a candidate for "apply policy" queries, source-rerank's discrimination features need to do real work. Mitigation: the existing `title_path_agreement` and `owner_identity_score` features penalise generic-name-only matches. Slice 28.3 gate 3 (no single-doc regression) is the test.
* **Index size growth**: a TS codebase has more code files than markdown docs. A 79-doc corpus might have 200+ code files. FTS index size grows roughly linearly. Mitigation: `exported_signatures` cap (240 chars), `file_purpose` cap (480 chars), no full-body indexing.
* **Source-rerank scoring contexttrail**: code-sources score in the same space as doc-sources. A trivially-matching code source could displace a strong doc source. Mitigation: gate 3 protects against this; if it triggers, we investigate per-kind score floors before tuning weights.

## Acceptance — PRD-level

PRD is complete when all five slices have shipped and:

1. `npx tsx src/eval/agent-completion-probe.ts` reports ≥75% source-file coverage. **Measured: 93.9% (62/66 on the expanded 14-commit panel — held at 5x the original sample).** ✅
2. `npx tsx src/eval/real-workflow-probe.ts` reports ≥95% assembly (i.e., no workflow regression). **Measured: 95.7% (22/23).** ✅
3. The 174-case real-corpus eval shows no top-1 / top-3 / top-5 regression beyond ±1 case. **Measured: 82.8 / 94.3 / 96.0 — identical to baseline.** ✅
4. `RETRIEVAL_CODE_SOURCE_INDEX` flag default flips to `on`. **Flipped 2026-05-11.** ✅
5. Slice 28.5 ships multi-language extractor coverage for Python, Go, and Rust at the same `CodeSourceFacts` shape, with per-language unit-test gates. **34 tests across the three extractors; full suite 1531/1531.** ✅

PRD-0028 complete.

## Why structural, not data-fitting

| concern | mitigation |
|---|---|
| Tied to ContextTrail's TS code shape? | TypeScript AST + JSDoc is universal. Works on every TS project unchanged. |
| Will the 75% threshold be hit by overfitting to the 3-ticket eval? | The eval is grounded in **shipped commits** — it measures whether the pack mentions files that were *actually changed*. Overfitting requires a fix that mentions specific commits, which the extractor architecture can't do. |
| Will the BM25F weights be tuned to the eval? | Weights are principled fixed values (matching PRD-0025's pattern). Gate 3 (no single-doc regression) catches weight-tuning attempts that move one metric at the cost of another. |
| Could the link-traversal pattern (PRD-0027) replace this PRD? | No. PRD-0027 traverses markdown links among docs. Code files don't have markdown links; they have TypeScript imports. This PRD captures the code-side equivalent. |
