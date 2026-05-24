# Runbook — Substrate migration (PRD-0002 / Checkpoint 3b)

This runbook describes the one-time, deterministic, single-transaction
transform from the **flat schema** (`doc_chunks` + `cards` + `card_anchors`
+ `card_links` + `code_anchors`) to the **substrate** (`context_objects` +
`doc_chunk_ext` + `card_ext` + `links` + `code_anchors_v2`).

The migration is gated by the two invariants in
[ADR-0009](../adr/0009-migration-verification-gate.md):

1. **Round-trip** — every Doc Chunk's `(content, stable_key, scope,
   code_anchors, version_id)` tuple is byte-identical pre/post; every
   Card's body, frontmatter, links, and `version_pin` survive.
2. **Identical-pack** — a predefined query set returns byte-identical Pack
   output (rendered text + structured JSON) when run against the
   pre-migration DB and the migrated DB.

## End-to-end procedure

### 1. Pre-flight: gate verification

```bash
# Run the invariant tests against the frozen fixture corpus.
npx vitest run src/store/migrate.test.ts
```

Both invariant suites must be green. The migration script refuses to run
against real data unless the caller passes `gate_passed: true` (or
`force: true`, which is reserved for the fixture round-trip itself).

### 2. Snapshot the real cache

```bash
cp .contexttrail/cache/contexttrail.db .contexttrail/cache/contexttrail.db.pre-migration
```

The pre-migration snapshot is your rollback path. Keep it until the
post-migration spot-check (step 5) succeeds.

### 3. Run the migration

```bash
# Programmatic invocation (preferred). Single SQLite transaction; failure
# rolls back atomically and leaves the cache untouched.
node -e "
  import('./dist/store/db.js').then(async ({ openDb, closeDb }) => {
    const { migrateFlatToSubstrate } = await import('./dist/store/migrate.js');
    const db = openDb('.contexttrail/cache/contexttrail.db');
    const r = migrateFlatToSubstrate(db, { gate_passed: true });
    console.log('migration report:', r);
    closeDb(db);
  });
"
```

Or via the CLI:

```bash
contexttrail migrate --gate-passed
```

The migration is idempotent: rerunning it on an already-migrated cache is a
no-op (`INSERT OR REPLACE`).

### 4. Post-migration verification

```bash
contexttrail verify
```

`contexttrail verify` walks the substrate-side data and asserts every integrity
invariant. Expect `contexttrail verify: OK`. Any failure means the migration
left the cache inconsistent — restore the snapshot and investigate before
proceeding.

### 5. Spot-check three real queries

Pick three representative `contexttrail context` queries you used before the
migration. Run each pre-migration (against the snapshot) and post-migration
and confirm the JSON Pack output is byte-identical:

```bash
diff <(contexttrail context "task A" --files src/x.ts --json) \
     <(BREADCRUMB_CACHE=.contexttrail/cache/contexttrail.db.pre-migration \
       contexttrail context "task A" --files src/x.ts --json)
```

Repeat for tasks B and C. All three diffs must be empty.

### 6. Archive the snapshot

Once steps 4 and 5 succeed:

```bash
mv .contexttrail/cache/contexttrail.db.pre-migration \
   .contexttrail/cache/archive/contexttrail.db.$(date +%Y%m%d-%H%M%S).pre-migration
```

Keep the archive at least until the next major refactor.

## Rollback

If any step fails:

```bash
mv .contexttrail/cache/contexttrail.db .contexttrail/cache/contexttrail.db.failed
mv .contexttrail/cache/contexttrail.db.pre-migration .contexttrail/cache/contexttrail.db
```

The migration creates substrate tables but never modifies flat tables, so
even a half-applied migration leaves the flat side reachable. The
single-transaction guarantee means partial substrate writes are rolled back
on any failure inside the migration.

## What changed structurally

| Flat (week 1–2)         | Substrate (week 3+)                          |
|-------------------------|----------------------------------------------|
| `doc_chunks`            | `context_objects` (kind=`doc_chunk`) + `doc_chunk_ext` |
| `cards`                 | `context_objects` (kind=`card`) + `card_ext` |
| `code_anchors` (chunk)  | `code_anchors_v2` (kind-generic)             |
| `card_anchors`          | `code_anchors_v2` (kind-generic)             |
| `card_links`            | `links` (typed; preserves `version_pin`)     |

The flat tables are intentionally **kept** after migration for backward
compatibility. v1 retrieval continues to read flat; substrate reads are
exposed via `listCurrentChunksFromSubstrate` / `listCardsFromSubstrate` for
phased rollout. A future release will drop the flat tables once every
caller has been ported.

## References

- [ADR-0005: two-phase schema (flat then substrate)](../adr/0005-two-phase-schema-flat-then-substrate.md)
- [ADR-0009: migration verification gate](../adr/0009-migration-verification-gate.md)
- [PRD-0002 § Checkpoint 3b](../prd/0002-week-3-cards-and-substrate.md)
