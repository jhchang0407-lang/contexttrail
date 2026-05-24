# ADR-0009: Substrate migration is gated on fixture round-trip and identical-pack invariants

**Status:** Accepted
**Date:** 2026-05-06

## Context

Per [ADR-0005](0005-two-phase-schema-flat-then-substrate.md), the v1 schema migrates from flat `doc_chunks` + `indexed_doc_sources` to the substrate model (`context_objects` + `doc_chunk_ext` + `card_ext` + `links`) once cards exist as a second object kind. The migration is a one-time, deterministic transformation — but it touches every chunk, every scope tag, every code anchor, and (after cards land) every card and link.

It is also effectively irreversible. Once the migration runs against the real cache and `contexttrail index` proceeds against the substrate schema, rolling back means re-importing every doc and re-authoring every card. A subtly wrong migration — one that drops a column, shifts a `stable_key`, truncates a scope tag, or perturbs the `freshness_state` materialization — will not surface as a crash. It will surface weeks later as "retrieval feels off" while the user is mid-flight on week-4 MCP work, by which point the corrupted data is the ground truth.

The grilling session on 2026-05-06 (Q9, robustness reframe) had to pick a verification stance. With no schedule pressure, the gate is set to where it does the most work: at the point of first contact with real data.

## Decision

**The migration script does not run against real data until it has passed a fixture-based test gate.** The gate has two invariants, both must hold:

1. **Round-trip invariant.** For a frozen fixture corpus (`tests/fixtures/migration/`), every Doc Chunk's `(content, stable_key, scope, code_anchors, version_id)` tuple is byte-identical pre- and post-migration. Every Card's `(body, frontmatter, linked_chunks, freshness_state)` survives. Every `links` row preserves its pinned `version_id`.
2. **Identical-pack invariant.** A predefined set of retrieval queries (the same set used for week-2 acceptance, plus targeted card-locked queries) returns byte-identical Context Pack output (rendered text + structured JSON) when run against the pre-migration DB and against the migrated DB.

The fixture corpus is the docs and cards the user has actually authored by end of week 3 — not synthetic data. The fixture is committed to the repo so future schema changes can re-run the same gate without re-curating fixtures.

The migration script (`migrate_v1_to_v2.ts`) takes a SQLite path, runs the transformation in a single transaction, and exits non-zero on any post-migration assertion failure. The runbook is:

1. Freeze the fixture corpus from real authored content.
2. Implement the migration.
3. Run `vitest tests/migration.test.ts` — both invariants must pass.
4. Snapshot the real cache (`cp contexttrail.db contexttrail.db.pre-migration`).
5. Run `migrate_v1_to_v2.ts` against the real cache.
6. Re-run the identical-pack queries against the migrated real cache; spot-check.
7. Only after step 6 succeeds: keep the migrated DB, archive the snapshot.

## Considered alternatives

- **Test-driven migration without the identical-pack invariant.** Rejected. Round-tripping every column is necessary but not sufficient — a migration can preserve every cell and still alter retrieval output (e.g., if a join changes evaluation order or `freshness_state` materialization shifts when chunks are re-keyed). The user-visible invariant is "same query, same pack." That has to be in the gate.
- **Dual-write (run both schemas in parallel for several days, diff results, switch over when clean).** Rejected. Operationally heavier than the problem deserves — dual-write infrastructure is more code than the migration itself, and the two code paths can share bugs that produce false-clean diffs. Pays off for systems with users who can't tolerate downtime; here, the only "user" is the author.
- **Snapshot the DB, run the migration, spot-check by hand.** Rejected. The cost of "subtly wrong migration discovered two weeks later" is not "rerun for a few hours" — it is debugging "why does retrieval feel off" while the corrupted data is canonical. Solo dev time is the constrained resource; spending one day on a fixture gate avoids spending five days re-deriving lost ground.

## Consequences

### Positive

- The migration is provably safe before it touches real data. The fixture suite is reusable for any future schema change (post-v1 expansions, the v1.5 AST resolver, etc.).
- The identical-pack invariant becomes a permanent regression test. If a future refactor accidentally changes pack output, the suite catches it.
- The snapshot before step 5 is a real recovery path. The "irreversibility" is operational, not technical.

### Negative

- The fixture corpus has to be curated and frozen. ~half a day of work to set up, mostly mechanical.
- The fixture must be updated whenever the canonical input format changes (e.g., a new card type lands). This is intentional — schema changes deserve fixture refresh.

### What is *not* required

- Performance benchmarking of the migration. v1 scale is small; even a slow migration completes in seconds.
- Cross-platform verification. The migration runs once on the user's machine.

## References

- [DESIGN.md D9 / SCHEMA.md week 1–2 vs substrate sections](../DESIGN.md) — schema shapes
- [ADR-0005](0005-two-phase-schema-flat-then-substrate.md) — why migration happens in week 3, not week 1
- [PRD-0002](../prd/0002-week-3-cards-and-substrate.md) — week 3 plan including the gate as an acceptance criterion
- Feedback memory: `contexttrail_project` (robustness over throughput nuance)
