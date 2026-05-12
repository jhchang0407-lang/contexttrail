# ADR-0005: Two-phase schema — flat in weeks 1–2, substrate in week 3

**Status:** Accepted
**Date:** 2026-05-05

## Context

[ARCHITECTURE.md](../ARCHITECTURE.md) defines a substrate model where every retrieval unit is a `ContextObject` with type-specific extension tables (`doc_chunk_ext`, `card_ext`, `links`, `code_anchors`). The substrate is the long-term forward-compatible base — future kinds (`spec_atom`, `task`, `change_event`, `agent_run`) plug in without core schema migration.

The natural impulse on day 1 is to ship the substrate immediately so that there is exactly one schema to learn. The grilling session on 2026-05-05 pushed back: in weeks 1–2 there is exactly one object kind (Doc Chunk). The substrate's `context_objects` indirection abstracts over a set of size one. The motivational cost of building scaffolding around an empty room is large, and CORE.md's decision rule is explicit: *Does this help the agent get better context for a task right now? If no, cut it.*

## Decision

v1 ships the cache schema in two phases.

- **Weeks 1–2 — flat schema.** `doc_chunks` (with all chunk fields inline) + `indexed_doc_sources` + `code_anchors` + `doc_chunks_fts`. WAL pragma. Nullable `embedding` BLOB column from day 1 so week-5 doesn't require migration. One object kind, one table, no indirection.

- **Week 3 — substrate migration.** When the second object kind (Card) lands, migrate `doc_chunks` into `context_objects` + `doc_chunk_ext`, add `card_ext` and `links`, and rename or fold `code_anchors` to be generic over object kind. One-time, deterministic, scripted; the migration is documented in week-3 deliverables and tested.

The flat schema names fields so they map cleanly to the substrate (`doc_chunks.body` → `doc_chunk_ext.body`; `doc_chunks.scope_data` → `context_objects.scope_data`). No throwaway names.

## Considered alternatives

- **Just substrate from day 1.** Rejected: the abstraction has nothing to abstract over in week 1, and building it before the second kind lands is the canonical premature-architecture failure mode. CORE.md's rule applied at the schema level.
- **Just flat forever.** Rejected: works in v1 but blocks every post-v1 feature that adds new object kinds (drift detection adds `change_event`, orchestration adds `agent_run`, verification adds `evidence_run`). Each would need a parallel ALTER-heavy fork. The substrate exists for a reason.

## Consequences

### Positive
- Week 1 ships a Context Pack against real docs in days, not weeks. The "aha" moment happens before infrastructure work compounds.
- The substrate migration in week 3 has a real second kind (Card) to motivate it — the abstraction earns its keep on arrival.
- Field names align across phases so the migration is structural, not a rename pass.

### Negative
- One planned migration must be written and tested. ~half a day in week 3.
- Anyone reading SCHEMA.md sees two schemas side by side. The doc must be explicit about which is the week-1–2 target and which is the week-3+ target — already noted in SCHEMA.md's preamble.
- A future contributor who jumps in mid-week-2 must read both sections and understand the phasing to avoid implementing against the wrong shape.

## References

- [SCHEMA.md week-1–2 section](../SCHEMA.md#sqlite-cache-schema--week-12-flat) and [substrate section](../SCHEMA.md#sqlite-cache-schema--week-3-substrate-model)
- [DESIGN.md D29](../DESIGN.md) — schema phasing decision in dependency order
- [ARCHITECTURE.md](../ARCHITECTURE.md) — the substrate model itself
- [CORE.md](../CORE.md) — "Don't build the abstraction until there are at least two things to abstract over" (the operating principle)
