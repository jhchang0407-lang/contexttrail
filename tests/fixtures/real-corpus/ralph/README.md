# Ralph

Blueprint repo for an autonomous serial ticket executor for Pi + Linear.

## Purpose

Ralph is a globally reusable wrapper-driven workflow that, per run:
- selects one named `QueueQuery` for one `LinearProject` in one repository
- normalizes eligible Linear tickets
- builds a minimal execution packet from ticket + context/ADR refs
- spawns a fresh Pi worker subprocess per iteration
- validates results mechanically
- loops with bounded retries
- escalates to HITL with a full handoff bundle when needed

## Where things live

- `research/BLUEPRINT.md` — original planning blueprint
- `docs/architecture/ARCHITECTURE.md` — architecture spec
- `docs/architecture/MACHINE_BLOCK_SCHEMA.md` — ticket machine-block contract
- `docs/architecture/RUNNER_MODULE_LAYOUT.md` — code/module layout
- `docs/architecture/IMPLEMENTATION_PLAN.md` — phased implementation plan
- `docs/adr/` — durable ADRs when they are created
- `CONTEXT.md` — canonical glossary/domain language for Ralph
- `.pi/executor.yaml` — human-authored repo-local runner config
- `.pi/executor.lock.yaml` — generated committed resolved repo-local config

## Status

Blueprint, architecture docs, and canonical glossary captured and refined from the design conversation on 2026-05-04.
