# PRD-0035: Sync Hygiene — Code-Source Tombstoning + Pre-Retrieve Freshness Check

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's thirty-fifth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md) — see `freshness check`. Governing ADRs: [ADR-0018](../adr/0018-inbox-backed-by-local-files-ui-through-agent-surface.md). Cross-references: [docs/OPEN.md](../OPEN.md) "File watcher mode" (records that PRD-0035 ships the detection half), [README.md](../../README.md) and [docs/CORE.md](../CORE.md) (one-line sync-model note for pilot users). Predecessor PRDs: [PRD-0028](0028-code-source-index-for-agent-completion.md) (introduced code-source index but no tombstoning), [PRD-0033](0033-setup-readiness-scan-and-confidence-report.md) (setup is now legible; sync is the next gap), [PRD-0034](0034-llm-assisted-clarification-generation.md) (closed the bootstrap quality gap; this closes the sync gap).
>
> Boundary rule: this PRD ships **two narrow sync-hygiene fixes**. It does NOT add a continuous file watcher, opt for always-auto-sync, or modify the existing `contexttrail import` / `contexttrail card import` flows. The watcher remains deferred per the OPEN.md "File watcher mode" item ("Implicit-on-retrieve covers v1 UX. Watcher is post-v1.").

## Problem Statement

`contexttrail import` indexes both markdown doc chunks and code-source metadata (PRD-0028) in one pass. `contexttrail index` re-scans imported sources and **tombstones doc chunks** whose source files have been deleted on disk. There is no equivalent for code-sources — a deleted or renamed `.ts` file leaves a ghost entry in the `code_sources` table indefinitely. The ghost entry continues to surface in `code_source` retrieval candidates, including via the import-graph traversal (PRD-0028 slice 28.4) where it remains a node in the graph even though its file no longer exists.

Separately, MCP `retrieve_context_pack` reads the SQLite cache without checking whether the underlying source files have changed since import. A pilot user who edits a doc, then asks the agent a question about it, gets stale retrieval output until they remember to run `contexttrail import` or `contexttrail index`. The current product surface assumes the user knows to sync; that assumption is fine for the maintainer but a real friction point for a stranger.

Both gaps were named explicitly in the 2026-05-11 review: *"The weak spot I'd fix before calling sync 'production-grade' is: code-source cleanup for deleted/renamed code files plus a simple watcher or pre-retrieve freshness check."*

OPEN.md's stance: implicit-on-retrieve covers v1 UX, watcher is post-v1. PRD-0035 picks the implicit-on-retrieve direction with a deliberate constraint — **detect staleness and warn**, but do NOT auto-reindex inline by default. Auto-reindex changes the latency profile of retrieval and competes with the "speed/predictability" property the maintainer named as intentional. Users who want auto-reindex can opt in via an env var; the default is "fast retrieval + honest freshness warnings."

## What is shipped today (do not duplicate)

- `contexttrail import` indexes both doc chunks and code-sources (`src/cli/import.ts`).
- `contexttrail index` re-scans and tombstones **doc chunks** whose source is gone (`src/cli/index-cmd.ts`). Code-sources are untouched.
- `deleteCodeSource(db, source_path)` exists in `src/store/code-sources.ts` — the storage primitive is there.
- MCP `retrieve_context_pack` reads the cache and returns pack with `coverage_confidence` + `warnings[]`. No freshness check today.

## Solution

Three slices, all AFK except the policy / docs update. No falsification gate — both problems are deterministically observable and the fix is structural, not hypothesis-driven.

### Slice 35.1 — Code-source tombstoning in `contexttrail index`

Extend `runIndex` (`src/cli/index-cmd.ts`) to also walk the code-source table, check whether each indexed `file_path` still exists on disk under the configured `code_globs`, and call `deleteCodeSource` for any whose file is gone.

The walk mirrors the existing doc-chunk tombstoning loop. Same shape, same idempotency guarantees, same summary-counter reporting (`tombstoned_code_sources: number` added alongside `tombstoned_chunks`).

Renamed files are handled by the natural delete-then-add pattern: a subsequent `contexttrail import` re-indexes the new path; `contexttrail index` tombstones the old. No special-case rename detection — `contexttrail index` only sees "this file_path is no longer matched by any glob and not on disk" and tombstones.

Affected surfaces:
- `runIndex` return type gains `tombstoned_code_sources: number`.
- CLI summary output extends from "X unchanged, Y reindexed, Z chunks tombstoned" to "... W code-sources tombstoned" when W > 0.
- The setup readiness scan (`src/setup/readiness-scan.ts`) is unaffected — it reads current indexed state, not historical.

### Slice 35.2 — Pre-retrieve freshness detection

Add `src/retrieve/freshness-check.ts` exporting a pure function `detectStaleSources(db, cwd)` that returns `{ stale_doc_sources: string[], stale_code_sources: string[], missing_sources: string[] }`. Staleness is detected per-source by comparing the on-disk content hash to the indexed `source_content_hash`. Missing means "indexed but no longer on disk."

The MCP `retrieve_context_pack` handler calls `detectStaleSources` once per request before assembling the pack. Results flow into the existing `pack.warnings[]` array:
- `pack.warnings: [{ kind: "stale_source", source_paths: [...], hint: "Run `contexttrail import` to refresh." }]`
- `pack.warnings: [{ kind: "missing_source", source_paths: [...], hint: "Run `contexttrail index` to tombstone gone sources." }]`

The freshness check is **detect-and-warn**, not detect-and-auto-reindex. Retrieval latency stays predictable. Pilot users see honest warnings; the maintainer's "speed/predictability" property is preserved.

Opt-in auto-reindex via env var `CONTEXTTRAIL_RETRIEVAL_AUTO_REINDEX=true`. When set, the MCP handler invokes `runImport` / `runIndex` inline for the stale set before assembling. Default off. The flag is documented in CONTEXT.md.

The check has a configurable inactivity threshold: if more than `N` (default 200) sources are indexed, the freshness check stat()s them in deterministic file-path order and stops at the first detected stale source (early-exit optimisation) — the warning fires regardless of how many are stale. This keeps the latency floor under ~10ms for typical corpora.

### Slice 35.3 — Docs + OPEN.md update + CONTEXT.md addition

- Add `freshness check` to the CONTEXT.md glossary as a load-bearing concept.
- Update OPEN.md "File watcher mode" item to record that pre-retrieve detection ships (PRD-0035) and the watcher remains a v1.5+ quality-of-life item.
- Add a one-line note in README + CORE.md mentioning the freshness warnings so pilot users see them in writing before they encounter them.

HITL because the OPEN.md + CORE.md updates require judgment about how much of the "sync model" framing to expose to readers.

## Non-goals (explicit)

* **Continuous file watcher** — `chokidar` / `fs.watch` / similar. Watcher is post-v1 per OPEN.md and stays that way.
* **Auto-reindex on retrieve by default**. The detect-and-warn pattern protects the maintainer's "speed/predictability" property. Auto-reindex is opt-in only.
* **Special-case rename detection**. Rename = delete-then-add. `contexttrail index` handles the delete side; `contexttrail import` handles the add side. No fancy heuristic.
* **Cross-repo sync coordination**. One repo, one cache.
* **Cache invalidation for transient changes**. The freshness check uses indexed content hash, not mtime — a save-without-change doesn't trigger a warning. This is intentional.
* **Notifying about cards / inbox staleness**. Cards have their own freshness model (`accepted` / `needs_review`); inbox is provisional by nature. Out of scope here.
* **Reindexing in a background worker**. The opt-in `CONTEXTTRAIL_RETRIEVAL_AUTO_REINDEX` runs inline on the request thread. Background reindexing is a watcher-shaped feature.

## Risks

* **Freshness check adds per-request latency**. Mitigated by the early-exit optimisation (stop at first stale detection) and content-hash-only comparison (avoid file read on every check — stat() first, only hash if size changed). Worst case for a clean 200-source corpus is bounded at ~10ms; typical case is sub-millisecond.
* **Tombstoning a renamed file mid-session**. If a user renames a file between `contexttrail import` and `contexttrail index`, the old entry tombstones and the new entry doesn't exist yet. A retrieval call in that window returns stale results with a `missing_source` warning. Acceptable: pilot users will see the warning and rerun import. Maintainer can document the import-then-index ordering.
* **Auto-reindex amplifies latency unpredictably when on**. Mitigated by the opt-in flag default off. Users who want auto-reindex accept the latency.
* **OPEN.md watcher item could be re-debated**. Mitigated by explicit framing: PRD-0035 ships *detection*, not *watching*. They're different mechanisms with different cost profiles. A watcher PRD is a separate future thing.

## Acceptance — PRD-level

PRD is complete when:

1. `runIndex` tombstones code-sources whose file is no longer on disk. Returns `tombstoned_code_sources: number` in the summary. CLI prints the count when non-zero.
2. Unit tests cover: code-source tombstoning happens; renamed file (old path deleted) gets tombstoned; existing doc-chunk tombstoning is unaffected; `contexttrail index` is idempotent.
3. `src/retrieve/freshness-check.ts` exports `detectStaleSources` as a pure function.
4. MCP `retrieve_context_pack` calls `detectStaleSources` before assembly and includes `stale_source` / `missing_source` warnings in `pack.warnings[]` when applicable.
5. Default behavior is detect-and-warn. `CONTEXTTRAIL_RETRIEVAL_AUTO_REINDEX=true` opts into inline reindex.
6. Early-exit optimisation: at first stale source detected, return; later sources are not checked (verified by unit test).
7. CONTEXT.md gains a `freshness check` glossary entry. OPEN.md "File watcher mode" item updated.
8. README + CORE.md include a one-line note that the engine warns about stale sources.

## Why structural, not data-fitting

| concern | mitigation |
|---|---|
| Will the early-exit threshold (200 sources) be tuned to pass a benchmark? | The threshold is a fixed structural choice driven by latency budget. The test suite asserts the early-exit behavior, not a specific number. Changing the threshold is one line in the source. |
| Could the freshness check be bypassed silently? | The MCP handler always calls `detectStaleSources` before assembly. There's no flag to skip it. The only knob is "warn vs auto-reindex" — both involve the check. |
| Why not auto-reindex by default? | Auto-reindex would change retrieval's latency contract from "deterministic" to "unbounded when stale." Per maintainer feedback, "speed/predictability" is a load-bearing property. Opt-in is the honest default. |
| Why no rename detection? | Renames are rare relative to deletes. Delete-then-add via two separate commands is structurally simpler and well-tested. Rename detection adds a heuristic surface (similarity threshold, scoring, ambiguity in many-to-many renames) without proportional value. |
| Will tombstoning break the code-import graph? | The graph is rebuilt from current code-source rows each retrieval pass (`buildImportersResolver` at retrieve time). A tombstoned entry naturally drops out of the graph; no special cleanup needed for traversal edges. |
