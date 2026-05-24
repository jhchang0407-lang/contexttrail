# PRD-0002: Week 3 — Cards overlay, locked-include, substrate migration

> Source-of-truth canonical doc. Mirrored to issue tracker as the project's second PRD issue. Slices into independently-grabbable issues via `/to-issues`.
>
> Spec references throughout: `D{n}` = entry in [`docs/DESIGN.md`](../DESIGN.md); `ADR-NNNN` = [`docs/adr/`](../adr/). Glossary: [`docs/CONTEXT.md`](../CONTEXT.md). Predecessor: [PRD-0001](0001-weeks-1-2-foundation.md).
>
> **No schedule pressure.** Phase boundaries are checkpoints, not deadlines (see Further Notes → Checkpoint discipline).

## Problem Statement

Weeks 1–2 ship a deterministic Doc Chunk retrieval engine. It works — but every chunk is *imported reflection of source docs*. There is no place for *authored, scoped, version-pinned operational knowledge* that the agent must always see.

Real engineering pain that this gap creates today:

- A team rule like "all monetary math goes through `Money`, never raw floats" lives nowhere reliable. It might be in a `CLAUDE.md` (token-wasteful, unscoped), a Slack thread (invisible to the agent), or a stale ADR (silently drifted). When the agent edits payment code without that rule reaching it, it produces a regression that passes type checks and tests.
- A symbol-specific invariant like "`RefundService.processRefund` must be idempotent — providers may retry it" is unsignaled outside the implementer's head. Retrieval over docs may surface tangentially-relevant prose; the agent cannot see "this exact symbol has this exact contract."
- The author has no way to *guarantee* that a given hard rule reaches the agent for matching tasks — it competes with prose in the score-based ranker, and a strong-text Doc Chunk can outrank it on vocabulary alone.

The cache schema is also not yet ready for a second object kind. Per [ADR-0005](../adr/0005-two-phase-schema-flat-then-substrate.md) the substrate (`context_objects` + `doc_chunk_ext` + `card_ext` + `links`) was deferred until a real second kind exists. Week 3 is when that second kind arrives, so the substrate migration becomes the *demonstrably correct* shape rather than the speculative one.

## Solution

Week 3 introduces **Cards** — a second kind of Context Object — and a **locked-include** mechanism that takes matching Cards out of the score-based ranker and pulls them into every Pack as guaranteed must-read. Then it migrates the cache to the substrate so that future kinds (and the v1.5 drift detector) build on a unified shape.

Three checkpoints structure the work:

- **3a — Cards on flat schema.** Cards live alongside `doc_chunks` on the existing flat schema (a `cards` table next to it). All Card behavior — authoring, locked-include, type bias, linking, freshness — works here. Substrate is *not yet migrated*.
- **3b — Substrate migration.** Once 3a is hardened, run the substrate migration per [ADR-0009](../adr/0009-migration-verification-gate.md). Port retrieval implementation to read through the substrate. Re-run the entire week-2 + checkpoint-3a acceptance suite; assert zero regression.
- **3c — Robustness scaffolding.** `contexttrail verify`, golden corpus, snapshot tests on `contexttrail explain`, narrow property-based tests on chunker + scorer, end-to-end cold-install test. These do not gate the migration; they add the safety net every later phase will rely on.

The five things week 3 ships:

1. **Card storage and authoring** — markdown-with-frontmatter files under `.contexttrail/cards/`, three card types (`constraint`, `symbol_note`, `evidence`), CLI surface for add/list/show/link/unlink/verify/mark-needs-review.
2. **Locked-include retrieval** — `constraint` Cards lock under hierarchical-down scope match (D38, [ADR-0011](../adr/0011-locked-include-matching-rules.md)); `symbol_note` Cards lock under strict anchor equality (D39, ADR-0011); pack budget is a hard guarantee for locked content (D37, [ADR-0010](../adr/0010-locked-include-overflow-policy.md)); 1.2× type bias for non-locked Cards in the ranker (D42).
3. **Card-to-chunk linking** — author-declared via inline suggestions (D40, [ADR-0008](../adr/0008-card-linking-author-declared-with-suggest.md)); pinned `version_pin` powers freshness materialization (D41).
4. **Substrate migration** — flat `doc_chunks` + `indexed_doc_sources` → `context_objects` + `doc_chunk_ext` + `card_ext` + `links`. Gated by ADR-0009's fixture round-trip and identical-pack invariants.
5. **Robustness scaffolding** — `contexttrail verify` integrity command, expanded golden corpus (15–20 hand-curated cases), snapshot tests for `contexttrail explain`, narrow property-based tests, end-to-end cold-install test.

## User Stories

### Card authoring and types

1. As a developer with an invariant my team must never violate, I want to author a `constraint` Card under `.contexttrail/cards/` so that the rule lives next to the code it governs and is committed to git ([ADR-0002](../adr/0002-card-provenance-from-day-one.md), [SCHEMA.md](../SCHEMA.md)).
2. As a developer, I want each Card to be a single markdown file with YAML frontmatter so that diffs, blame, and merges work via standard git tooling ([D5](../DESIGN.md)).
3. As a developer, I want frontmatter to declare `id`, `type`, `title`, `authority`, scope (`project` / `module` / `files` / `symbols`), and an optional body so that the schema is small enough to remember without docs.
4. As a developer authoring a `symbol_note`, I want to declare one or more `symbol_anchors` in frontmatter so that the Card's locked-include matching is auditable from the file itself.
5. As a developer authoring an `evidence` Card, I want to declare a `command` field plus `covers:` references to the Cards it evidences so the structured-record pattern from [SCHEMA.md](../SCHEMA.md) holds.
6. As a developer, I want `contexttrail card add <type>` to scaffold a frontmatter template, open my `$EDITOR`, and save under `.contexttrail/cards/` with a generated `id` (`C001`, `S001`, `E001`) and kebab-cased filename.
7. As a developer, I want frontmatter validated by zod so a malformed Card fails on save with a clear error rather than producing weird retrieval behavior later.
8. As a developer, I want `contexttrail card list` to enumerate every Card with id, type, title, scope, freshness, and an `unlinked` flag for evidence Cards with zero links.
9. As a developer, I want `contexttrail card show <id>` to print the Card's full body, frontmatter, and linked-chunk contexttrails so I can audit before promoting to a wider scope.
10. As a developer, I want `contexttrail card link <card> <chunk>` and `contexttrail card unlink <card> <chunk>` so I can manage links outside the `add` flow without hand-editing frontmatter (D40).

### Locked-include matching (constraints)

11. As an author with a project-wide rule (`project: fundops`), I want my constraint to lock for any task whose inferred scope is `fundops` or any module within it (hierarchical-down per D38, ADR-0011).
12. As an author with a module-specific rule (`module: fundops/ledger`), I want my constraint to NOT lock for sibling-module tasks (`module: fundops/billing`) so module-specific rules don't leak.
13. As an author, I want a module-scoped constraint to NOT lock for project-level tasks so descendant rules don't leak upward.
14. As an author of a company-wide invariant ("never log PII"), I want my `company:`-scope constraint to lock universally and to be flagged with `broad_scope` in `contexttrail explain` so I can audit unintended over-broad locking.
15. As a developer running `contexttrail context` with `--files src/a/x.ts src/b/y.ts` spanning two modules, I want a constraint that is an ancestor of *either* request scope to lock (OR semantics, mirroring `scope_match`'s `max(...)` rule).

### Locked-include matching (symbol notes)

16. As an author of a symbol note about `LedgerEntry.post`, I want the Card to lock only when the query mentions `LedgerEntry.post` verbatim so the surgical signal stays surgical (D39, ADR-0011).
17. As an author who wants the same note to apply to both class-level and member-level queries, I want to declare both anchors in frontmatter (`symbol_anchors: [LedgerEntry, LedgerEntry.post]`) so the breadth is explicit and auditable.
18. As an author, I want NOT to get implicit chain matching (no fuzzy "class subsumes member" or "member subsumes class") so my locked-include behavior is predictable.
19. As a developer, I want symbol matching to be case-sensitive and exact-string so retrieval and locked-include agree on what counts as "the same symbol" (D32 anchor model).

### Pack policy and budget

20. As a developer running `contexttrail context`, I want every locked Card pulled into the Pack first regardless of total token cost, so "locked means locked" is unconditional (D37, ADR-0010).
21. As a developer, I want the global ranker to run under `remaining_budget = max(0, requested_budget − sum(locked_tokens))` so non-locked content competes for whatever the budget left.
22. As a developer who hits a pathological case where locked content alone exceeds the budget, I want a `locked_overflow` warning naming the deficit and per-card token costs so I can audit and tighten scope.
23. As a developer, I want the Pack response to surface `budget: { requested, used, locked_overhead }` so my agent can see exactly how much context window was consumed.
24. As a developer, I want non-locked Cards to receive a `1.2×` type-bias multiplier in the ranker so authored Cards win ties against ambient prose at equal relevance (D42).
25. As a developer, I want the type-bias to NOT apply to locked Cards (they bypass the ranker), so the multiplier has one meaning and tunes one knob.
26. As a developer, I want render order to be driven by section labels (`Locked rules` → `Symbol notes (locked)` → `Relevant docs` → `Evidence` → `Warnings` → `Omitted`), not by score arithmetic, so display ordering doesn't couple to ranker tuning (D42).

### Card-to-chunk linking

27. As an author saving a new Card, I want `contexttrail card add` to surface the top-N anchor- and scope-overlapping Doc Chunks at save time and let me accept them with one keystroke so cold-start linking is a keypress, not homework (D40, ADR-0008).
28. As an author, I want my selected chunks written into `linked_chunks:` frontmatter with their `version_pin` captured at link time so the freshness signal can detect drift later.
29. As an author who hasn't decided which chunks to link yet, I want to save a Card with zero links and revisit later — the save MUST NOT be gated.
30. As an author of an `evidence` Card with zero links, I want an `unlinked` cue surfaced in `contexttrail card list` and `contexttrail card show` so I can find it later without it being lost.
31. As an author, I want NO automatic link creation by anchor or scope overlap (per ADR-0008) so the freshness signal stays high-precision and `needs_review` is meaningful.

### Freshness materialization and manual review

32. As a developer, I want a Card whose linked chunk's `version_id` rotates to flip its `freshness_state` to `needs_review` automatically at index time so authored knowledge knows when its evidence drifts (D41).
33. As a developer, I want a linked chunk that gets tombstoned to flip the Card with a `tombstoned_link` reason in `contexttrail explain` so I can distinguish "edit contexttrail" from "section deleted" (D41).
34. As a developer, I want `freshness_state` to be reproducible from `(links.version_pin, current chunk version_ids, tombstones)` so the materialized column is rebuildable and `contexttrail verify` can assert the invariant (D41).
35. As a developer, I want NO code path other than the indexer to write `freshness_state` so the materialization stays canonical.
36. As a developer who has manually reviewed a Card and confirmed it's still correct, I want `contexttrail card verify <id>` to flip a separate `author_review_state` to `verified` without touching `freshness_state`.
37. As a developer, I want `contexttrail card mark-needs-review <id>` to flip `author_review_state` to `needs_review_manual` so I can flag a Card for review without waiting for a chunk edit.
38. As a developer, I want `contexttrail card list` and `contexttrail card show` to surface a unified freshness label combining `freshness_state` and `author_review_state` while `contexttrail explain` can decompose them when asked.
39. As a developer, I want a `needs_review` Card to remain locked-include eligible (per [ADR-0006](../adr/0006-authority-as-trust-freshness-as-verification.md)) with a freshness warning in the Pack — staleness must not silently demote a hard-rule Card.

### Substrate migration

40. As a developer running the substrate migration, I want the script to be a single transaction so a failed run leaves the cache untouched ([ADR-0009](../adr/0009-migration-verification-gate.md)).
41. As a developer, I want every Doc Chunk's `(content, stable_key, scope, code_anchors, version_id)` to round-trip byte-identically pre- and post-migration so existing retrieval behavior is preserved (ADR-0009).
42. As a developer, I want every Card's body, frontmatter, links (with `version_pin`), and freshness state to survive migration unchanged.
43. As a developer, I want a fixture corpus committed to the repo (built from real authored content at end of checkpoint 3a) so the migration test gate is repeatable and future schema changes can re-use it.
44. As a developer, I want an "identical-pack" invariant test that runs a predefined query set against pre- and post-migration databases and asserts byte-identical Pack output (rendered + structured) so user-visible retrieval doesn't shift.
45. As a developer, I want the migration script to refuse to run against real data unless the round-trip and identical-pack invariants pass on the fixture, so an irreversible operation can't proceed against an untested transform (ADR-0009).
46. As a developer, I want a documented runbook (snapshot → gate → migrate → verify → archive) so the steps are mechanical and auditable post-hoc.

### Robustness scaffolding

47. As a developer, I want `contexttrail verify` to assert: no orphan `links` rows, no stale `freshness_state` (rebuildable from canonical truth), no chunks with empty `stable_key`, no Cards referencing non-existent `version_pin`s, and no orphaned `code_anchors`. Exit non-zero on any failure.
48. As a developer, I want a hand-curated golden task corpus of 15–20 `(task, files, symbols) → expected pack` cases covering: empty query scope, multi-file query, locked-only Pack, no-matches, locked-overflow, hierarchical-down constraint match, exact symbol_note match, near-miss constraint with type-bias.
49. As a developer, I want `contexttrail explain` snapshot tests for every golden case so the explain format can't regress silently — explain is my main retrieval-debugging surface.
50. As a developer, I want narrow property-based tests for load-bearing invariants only: every locked Card appears in the Pack; chunker output's union reconstructs source minus whitespace; `final_score` is monotone in BM25 holding all else equal; `scope_match` is monotone in scope specificity.
51. As a developer, I want an end-to-end cold-install test (blank tempdir → `contexttrail init` → `contexttrail import` against fixture → `contexttrail card add` → `contexttrail context` → assert Pack shape and section presence) that runs in CI in <30 seconds.

### Glossary and authority surface

52. As a developer, I want every Card to have an `authority` field (`accepted | candidate | deprecated`) per [ADR-0006](../adr/0006-authority-as-trust-freshness-as-verification.md). v1 manually-authored Cards land at `accepted`; the term is reserved on the substrate for week-6 bootstrap (`candidate`) and post-v1 deprecation flows.
53. As a developer, I want `authority` and `freshness` to remain orthogonal: only humans change `authority` (accept / deprecate / mark candidate); the indexer changes `freshness_state` mechanically (ADR-0006, D41).
54. As a developer, I want every term used in the CLI and Pack output to come from [`CONTEXT.md`](../CONTEXT.md) — `Card`, `constraint`, `symbol_note`, `evidence`, `locked-include`, `freshness`, `author_review_state`, `link`, `version_pin`, `broad_scope`, `locked_overflow`. Banned terms: "status," "reference," "stored mention" (per CONTEXT.md flagged ambiguities).

## Implementation Decisions

### Architecture and scope

- **Two-phase schema** (per [ADR-0005](../adr/0005-two-phase-schema-flat-then-substrate.md)): cards land on the flat schema first (a `cards` table next to `doc_chunks`); substrate migration runs at the end of week 3 once the second object kind exists. The migration is gated by [ADR-0009](../adr/0009-migration-verification-gate.md)'s round-trip + identical-pack invariants.
- **Locked-include is a contract, not a tunable.** Locked Cards bypass the ranker entirely and are pulled into every Pack as a hard guarantee, even when this exceeds the requested token budget ([ADR-0010](../adr/0010-locked-include-overflow-policy.md)). Token budget is therefore a hard guarantee for locked content and a soft target for everything else.
- **Locked-include matching is asymmetric by design** ([ADR-0011](../adr/0011-locked-include-matching-rules.md)): hierarchical-down for constraint scope (a `project:` constraint locks for any module within it); strict anchor equality for symbol_notes (no fuzzy class/member chaining). The asymmetry mirrors that scope is a hierarchy and anchors are flat strings.
- **Card-to-chunk links are author-declared with inline suggestions** ([ADR-0008](../adr/0008-card-linking-author-declared-with-suggest.md)). The system never auto-derives links. `contexttrail card add` surfaces top-N anchor-overlapping Doc Chunks at save time for one-keystroke selection. Evidence Cards may save with zero links; an `unlinked` cue surfaces the gap rather than gating the save.
- **Freshness is a materialized view over canonical truth** (D41). The `freshness_state` column is written only by the indexer and MUST be reproducible from `(links.version_pin, current chunk version_ids, tombstones)`. Manual author review lives in a separate `author_review_state` column on `card_ext`; the two never overload.
- **Robustness over throughput.** No timeline pressure on this phase — checkpoint discipline (3a → harden → 3b → harden → 3c) takes precedence over moving fast. See Further Notes.

### Modules

The deep modules (encapsulated, isolatable, simple stable interface):

- **Card markdown loader.** Parses frontmatter + body via `gray-matter`; validates frontmatter against a zod schema specialized per `card_type`. Surface: `parse(source) → { id, type, title, frontmatter, body, anchors, scope }`. Rarely changes once card-type schemas stabilize.
- **Inline link suggester.** Given a Card's anchors and scope plus the chunk store, returns top-N candidate chunks ranked by `(anchor_overlap, scope_match)`. Pure function over the store. Surface: `suggest(card, store, n) → ChunkCandidate[]`.
- **Locked-include resolver.** Given a retrieval request and the card store, returns the locked Card set per ADR-0011 — constraints hierarchical-down (D38) and symbol_notes strict equality (D39). Surface: `resolve(request, store) → { locked: Card[], reasons: LockReason[] }`. The single most load-bearing module in week 3.
- **Freshness materializer.** Walks `links`, compares pinned `version_pin` to current chunk `version_id`, emits the `freshness_state` value (and the `tombstoned_link` reason when applicable). Pure function over `(links, chunks)`. Surface: `materialize(card, links, chunks) → freshness_state`. The invariant from D41 lives in this module.
- **Substrate migration script + invariants.** One-shot transformation from flat → substrate, runnable in a single transaction. Paired with two test fixtures (round-trip invariant and identical-pack invariant) per ADR-0009. Surface: `migrate(db) → MigrationReport`; tests assert `(content, stable_key, scope, code_anchors, version_id)` byte-identical pre/post and Pack output byte-identical pre/post for a fixed query set.
- **`contexttrail verify` integrity command.** Runs the schema integrity checks above. Pure read-side over the cache. Surface: `verify(db) → VerifyReport` with structured failure reasons.

The shallow modules (orchestration / glue):

- **Card storage layer** wraps SQLite with the flat-schema DDL extensions (`cards`, `card_anchors`, `card_links`) for checkpoint 3a, then the substrate extensions (`card_ext`, `links`, etc.) post-migration.
- **Pack policy update** (locked-first, soft-target budget) modifies the existing packer to honor D37; tested via the golden corpus.
- **Render update** (section labels for locked vs ranked) modifies the existing renderer to honor D42; tested via snapshots.
- **Explain trace update** surfaces locked status, lock reason, `broad_scope` flag, and freshness source decomposition.
- **CLI command files** (`card add`, `card list`, `card show`, `card verify`, `card mark-needs-review`, `card link`, `card unlink`, `verify`) — thin wrappers composing the deep modules. Covered via the cold-install E2E.

### Schema changes

**Checkpoint 3a (flat schema extensions):**

- New tables: `cards`, `card_anchors`, `card_links` (with `version_pin`).
- `cards` adds `freshness_state` and `author_review_state` columns.

**Checkpoint 3b (substrate migration target):**

- `doc_chunks` rows → `context_objects` (kind=`doc_chunk`) + `doc_chunk_ext` (type-specific fields).
- `cards` rows → `context_objects` (kind=`card`) + `card_ext` (carrying `card_type`, `title`, `body`, `command`, `author_review_state`).
- `card_anchors` + chunk anchors → unified `code_anchors` (single table, generic over object kind).
- `card_links` → `links` (typed table over all object kinds; preserves `version_pin`).

Canonical schema lives in [SCHEMA.md](../SCHEMA.md). The substrate-side `freshness_state` rule (materialized, never written outside the indexer) is documented inline in SCHEMA.md and CONTEXT.md.

### Config defaults (additive over PRD-0001)

- `retrieval.scoring.card_type_bias: 1.2` (D42) — tunable knob for non-locked Cards in the ranker.
- `cards.source_dir: .contexttrail/cards` (already in PRD-0001 config; remains).

### CLI contracts

- `contexttrail card add [type]` — opens editor, validates frontmatter on save, runs inline link suggestion, accepts selections with one keystroke, writes Card file + populates `card_links` rows.
- `contexttrail card list [--scope X] [--type T] [--needs-review]` — enumerates Cards with id, type, title, scope, freshness, manual-review state, link count, `unlinked` cue.
- `contexttrail card show <id>` — prints body + frontmatter + linked chunks (with contexttrails) + freshness decomposition.
- `contexttrail card verify <id>` / `contexttrail card mark-needs-review <id>` — flip `author_review_state` only; never touches `freshness_state`.
- `contexttrail card link <card> <chunk>` / `contexttrail card unlink <card> <chunk>` — manage links outside the `add` flow.
- `contexttrail verify` — integrity check; exits non-zero on failure.
- Existing `contexttrail context "task" --files X --symbols Y` extended: response surfaces locked Cards, `locked_overflow` warning when applicable, `budget.locked_overhead`, `broad_scope` flag in `--explain`.

### Glossary discipline

The CLI surface and prose use canonical terms from [`CONTEXT.md`](../CONTEXT.md):

- New terms in week 3: `Card`, `constraint`, `symbol_note`, `evidence`, `locked-include`, `card link`, `author_review_state`, `locked_overflow`, `broad_scope`, `version_pin`.
- Carried from PRD-0001: `Doc Chunk`, `Context Pack`, `Context Object`, `code anchor`, `mention extraction`, `link`, `scope`, `layer`, `query anchors`, `scope_match`, `mention_overlap`, `retrieval pipeline`, `retrieval request`, `retrieval`, `authority`, `freshness`.
- Banned: "status" (collapsed to `authority`), "reference" (ambiguous between `code anchor` and `link`), "stored mention" (use `code anchor`).

## Testing Decisions

Tests are written against module interfaces, not implementation. Deep modules (card loader, link suggester, locked-include resolver, freshness materializer, migration script, verify command) get exhaustive coverage; shallow modules (CLI, render, storage) get integration-level coverage where it adds signal. Final test scope is decided per-issue at `/to-issues` time.

What makes a good test in this codebase:

- **Tests assert external behavior, not internal state.** A locked-include resolver test asserts `(request, card_store) → locked_set` for each scope-match path; it does not inspect intermediate matching steps.
- **Tests are spec-driven.** Each branch of ADR-0011's matching rules gets a positive case and a negative (or near-miss) case. Each D37 budget interaction (under-budget, exact-budget, over-budget) gets a dedicated case.
- **Locked-include guarantee tests are property-based.** The invariant "every locked Card appears in the Pack" is asserted across generated `(card_set, request, budget)` triples, not just hand-picked examples.
- **Freshness materialization tests are state-transition tests.** Each transition (current → needs_review on chunk rotate, needs_review → current on chunk revert, current → needs_review with `tombstoned_link` reason on tombstone) gets a dedicated case.
- **Migration tests are invariant tests, not unit tests.** The `(content, stable_key, scope, code_anchors, version_id)` round-trip and identical-Pack outputs are asserted against a frozen fixture corpus. The fixture is built from real authored content at end of checkpoint 3a and committed to the repo so future schema changes can reuse it.
- **Golden corpus is hand-curated.** 15–20 `(task, files, symbols) → expected pack` cases cover empty query scope, multi-file query, locked-only Pack, no-matches, locked-overflow, hierarchical-down constraint match, exact symbol_note match, near-miss constraint with type-bias.
- **Snapshot tests guard the explain format.** Every golden case has a snapshot of `contexttrail explain` output. The explain trace is the primary debugging surface for retrieval; silent regressions there are dangerous.

Prior art: PRD-0001 establishes the pattern (vitest, colocated `*.test.ts`, table-driven cases for the mention-extraction regex). Week 3 adds the golden corpus + property-based tests + snapshot tests on top of the same conventions.

Modules nominally targeted for tests:

- **Card markdown loader** — exhaustive (every card-type frontmatter schema; every validation error path)
- **Inline link suggester** — moderate (deterministic ranking on fixture corpus; the "author authored a Card mentioning X surfaces chunks anchored to X" smoke test)
- **Locked-include resolver** — exhaustive (every scope-match path per ADR-0011, every anchor variant per D39, including company-scope `broad_scope` flag and multi-anchor symbol_notes)
- **Freshness materializer** — exhaustive (every state transition; tombstoned_link reason; round-trip rebuildability invariant)
- **Migration script** — invariants only (round-trip, identical-pack); no unit tests for the inner steps
- **`contexttrail verify`** — exhaustive (each integrity check has a positive fixture and a negative fixture)
- **Pack policy update** — covered by golden corpus + locked-overflow case
- **Render update** — covered by snapshot tests
- **Explain trace update** — covered by snapshot tests
- **CLI commands** — covered by cold-install E2E

## Out of Scope

- MCP server and any MCP tool — week 4 / [PRD-0003](0003-week-4-mcp-server.md)
- Embeddings (model load, BLOB population, cosine, weighted-sum blend) — week 5
- Card bootstrap (LLM-proposed candidates), inbox, triage CLI — week 6
- Dogfood + measurement protocol on fundops — week 7
- AST symbol resolution / rename tracking (`ts-morph`) — v1.5+
- AST fingerprinting; drift detection (`drift review` CLI; `list_drift` MCP) — v1.5+
- `propose_card` MCP tool — agents are read-only in v1
- Authority modes (planning / audit) — implementation mode only in v1
- Authority changes via CLI for Cards beyond `accepted` (the only authority value Cards land at in v1; `candidate` is week-6 bootstrap territory)
- File watcher mode — post-v1
- Multi-repo / monorepo cross-context — post-v1
- CI / GitHub PR integration — post-v1
- Decision and feature_intent card types — post-v1

## Further Notes

### Checkpoint discipline

Three checkpoints. Do not advance past a checkpoint until its acceptance is satisfied.

**Checkpoint 3a — Cards on flat schema. Done when:**

- 6–8 constraints, 4–6 symbol_notes, 2–3 evidence Cards authored against fundops dogfood docs (per [ADR-0003](../adr/0003-layered-dogfood-strategy.md)); committed to `.contexttrail/cards/`.
- Every authored constraint locks for ≥1 task in its scope subtree and does not lock for at least one task in a sibling scope. Verified by `contexttrail context --explain`.
- Every authored symbol_note locks for the exact symbol in `--symbols` and does not lock for the bare-class or member variants when authored without a multi-anchor list.
- A constructed locked-overflow case (8k tokens of locked content under a 6k budget) packs all locked Cards, emits `locked_overflow` warning, and surfaces `budget.locked_overhead` correctly.
- Linking via `contexttrail card add` inline suggestions produces ≥1 link per Card on real authoring; `linked_chunks:` is populated.
- A chunk edit that rotates `version_id` flips every linked Card's `freshness_state` to `needs_review` automatically; `contexttrail card verify` does NOT touch `freshness_state` but does flip `author_review_state`.
- `contexttrail explain` shows: locked status + reason, scope-match path or anchor match for locked Cards, `broad_scope` flag for company-locked Cards, `freshness_state` + source.
- The flat-schema golden corpus passes byte-identically after every change in 3a.

**Checkpoint 3b — Substrate migration. Done when:**

- Round-trip invariant test passes on the frozen fixture corpus.
- Identical-pack invariant test passes for the entire week-2 + checkpoint-3a acceptance query set.
- Migration runbook (snapshot → gate → migrate → verify → archive) is followed end-to-end on the real cache; snapshot is archived; spot-check on three real queries returns the same Pack pre and post.
- `contexttrail verify` passes against the migrated cache.

**Checkpoint 3c — Robustness investments. Done when:**

- `contexttrail verify` runs in the cold-install E2E test and passes.
- Golden task corpus has 15–20 cases; every case is covered by a snapshot-tested explain output.
- Property-based tests run in CI for ≥100 generated cases per property; no failures.
- E2E cold-install test runs end-to-end in <30 seconds.

### Dependencies

- [PRD-0001](0001-weeks-1-2-foundation.md) acceptance must hold throughout — no week-3 change degrades any week-1 or week-2 acceptance criterion.
- ADRs locked: [ADR-0005](../adr/0005-two-phase-schema-flat-then-substrate.md) (two-phase schema), [ADR-0006](../adr/0006-authority-as-trust-freshness-as-verification.md) (authority/freshness orthogonality), [ADR-0008](../adr/0008-card-linking-author-declared-with-suggest.md) (linking), [ADR-0009](../adr/0009-migration-verification-gate.md) (migration gate), [ADR-0010](../adr/0010-locked-include-overflow-policy.md) (locked overflow), [ADR-0011](../adr/0011-locked-include-matching-rules.md) (matching rules).
- DESIGN entries: D37–D42 inclusive.
- Memories: `feedback_usable_over_correct` (favor low-friction ergonomics over correctness-demo behavior); `contexttrail_project` (no schedule pressure; checkpoint discipline beats time-boxed cadence).

### How this PRD lands in code

After the PRD is accepted, `/to-issues` slices it into independently-grabbable tickets, one per module plus integration tickets for CLI commands. Expected slicing:

- ~10 tickets for checkpoint 3a (card schema, card markdown loader, inline link suggester, card authoring CLI, locked-include resolver, pack policy update, type-bias, freshness materializer, render update, explain trace update)
- ~6 tickets for checkpoint 3b (migration script, fixture build, round-trip invariant test, identical-pack invariant test, substrate retrieval port, runbook)
- ~6 tickets for checkpoint 3c (`contexttrail verify`, golden corpus, golden runner, explain snapshots, property tests, E2E cold-install)

### What "done" looks like

When this PRD is fully implemented:

- A user runs `contexttrail card add constraint`, drafts a rule in their editor, accepts inline link suggestions with one keystroke, and commits the Card file to git.
- They run `contexttrail context "task" --files X --symbols Y` and the Pack always includes the matching locked Cards as a hard guarantee, with `locked_overflow` warnings when content exceeds budget.
- They run `contexttrail card list` and see every authored Card with current freshness state and `unlinked` cues for evidence Cards.
- They edit a doc; the indexer flips linked Cards to `needs_review` automatically. They run `contexttrail card verify <id>` after manually re-checking; `author_review_state` flips while `freshness_state` is left untouched.
- They run the substrate migration; the fixture invariants pass; `contexttrail verify` passes against the migrated cache.
- The substrate readiness check from [`MVP.md` week 7 acceptance](../MVP.md) can be run mechanically.

Week 4 (MCP server) is unblocked.

### Triage label and routing

This PRD will be published with the `needs-triage` label per the project's `/to-prd` skill convention once the issue tracker is configured. After triage acceptance, the label flips to `Feature` and `/to-issues` slices the PRD into tickets. `/to-issues` runs only after this PRD is accepted, not before.

## Outcome

**Status (2026-05-06):** 3a, 3b, 3c all shipped. Architecture review follow-ups partially landed.

**Linear:** [THO-32](https://linear.app/thomaschang/issue/THO-32) (PRD), [THO-34](https://linear.app/thomaschang/issue/THO-34) (3a), [THO-35](https://linear.app/thomaschang/issue/THO-35) (3c), [THO-36](https://linear.app/thomaschang/issue/THO-36) (3b) — all `Done`.

**Commits on `main`:**

| Slice | Commit | Net |
|---|---|---|
| 3a — Cards overlay end-to-end on flat schema | `098e490` | +card schema, loader, locked-include, suggester, freshness, pack policy update, render labels, 7 CLI subcommands, 15 authored Cards in `.contexttrail/cards/` |
| 3c — Robustness scaffolding | `5bc8dbc` | +`contexttrail verify`, 17-case golden corpus, explain snapshots, property tests with `fast-check` (100 runs × 4 properties), cold-install E2E |
| 3b — Substrate migration + ADR-0009 gate | `0d704a9` | +substrate schema, single-transaction migration, round-trip + identical-pack invariant tests, substrate-side reads, [`docs/runbooks/substrate-migration.md`](../runbooks/substrate-migration.md) |
| Architecture review follow-up | `8f99870` | scope codec, Card discriminated union, freshness lookup keeper |

**Test surface delivered:**

| Surface | Count | Runtime |
|---|--:|--:|
| Total vitest cases | 211 | ~2.1 s |
| Golden corpus cases | 17 | — |
| Property-test runs (load-bearing invariants) | 400 | — |
| Cold-install E2E budget | <30 s | met |

Properties asserted (100 runs each): every locked Card always appears in the Pack; chunker output preserves source body content; `final_score` is monotone in BM25; `scope_match` is monotone in scope specificity.

**Bug surfaced *during* the work, fix landed in-slice:**

- Company-scope constraints failed to lock when `query_scopes` was empty (the for-over-empty short-circuited the universal-match path). Caught by golden case 1; fixed in [`src/cards/locked-include.ts`](../../src/cards/locked-include.ts).

**Architecture review (post-ship) — what landed, what didn't:**

Four deepening opportunities surfaced. Three landed in `8f99870`; one was deliberately deferred.

| # | Candidate | Status |
|---|---|---|
| 1 | Freshness rule single keeper | **Partial.** `buildFreshnessLookups` + `computeFreshness` now shared between freshness.ts and verify.ts. The label-side rule (`freshnessLabel` in render.ts vs `unifiedFreshness` in card-cmds.ts) was not unified — see deferred. |
| 2 | Scope codec (encode/decode `ChunkScope`) | **Done.** All four read paths now go through [`src/store/scope-codec.ts`](../../src/store/scope-codec.ts). |
| 3 | Card as discriminated union | **Done.** `Card = ConstraintCard \| SymbolNoteCard \| EvidenceCard`. `pack.ts` also split `PackedTrace` into `DocChunkPackedTrace \| CardPackedTrace \| LockedTrace` as a real sum. |
| 4 | Pre-sectioned pack output | **Deferred until week 4.** Second adapter (MCP wire) makes the seam concrete; speculation now would relocate complexity, not concentrate it. |

**Deferred / known follow-ups:**

- **Freshness label divergence (real behavioural bug).** [`render.ts::freshnessLabel`](../../src/retrieve/render.ts) and [`card-cmds.ts::unifiedFreshness`](../../src/cli/card-cmds.ts) encode different precedence rules: `card list` shows `needs_review_manual` when both flags are set; `contexttrail context --explain` shows `needs_review (version_drift)` and the manual flag is invisible. Fix is to consolidate the rule in `cards/freshness.ts` and import from both call sites.
- **`tsc --noEmit` widening errors in [`loader.ts:145`](../../src/cards/loader.ts).** `vitest` passes (uses `tsx`, no typecheck), so the suite stays green; a CI step that runs `tsc --build` would fail. Pin the literal types on the `base` object (`as const` on `freshness_state`, etc.).
- **Card-cmds DB lifecycle.** Each of the 8 `runCard*` functions opens and closes the DB independently. Not friction yet but a candidate for consolidation if a session-scoped admin module emerges.

**Out-of-scope observations surfaced during the work:**

- **`card_type_bias = 1.2` is rarely load-bearing in the current corpus.** Most authored Cards lock-include via D38/D39, bypassing the ranker entirely. The bias only matters for non-locked Cards competing against chunks — a small fraction of dogfood queries today. Worth instrumenting once a real measurement protocol lands (week 7) before tuning the constant.
- **Quality vs structure testing.** The 17-case golden corpus + 400 property runs verify the engine *does what the spec says*. They do not verify the spec *produces useful Packs on real corpora*. A dogfood loop on this repo's own docs (`contexttrail import "docs/**/*.md"` then realistic queries) is the highest-signal next test. Each surprise becomes a new golden case before the fix lands. PRD-0007 (week 7 — measurement protocol) is the formal home; the dogfood loop can start informally now.
- **The agent-facing wire (week 4).** `runContext` already returns a stable `ContextPackJson` that's the source of truth for the MCP `retrieve_context_pack` tool. The week-3 contract revision (added `locked`, `warnings`, `budget`, `kind` to JSON output) was deliberate forward-compat for week 4.

**Substrate readiness check** (per [MVP.md week 7 acceptance](../MVP.md)) is now runnable mechanically — `contexttrail verify` against a migrated cache passes; round-trip + identical-pack invariants are guarded by tests, not just runbook discipline.

Week 4 (MCP server, [PRD-0003](0003-week-4-mcp-server.md)) unblocked.
