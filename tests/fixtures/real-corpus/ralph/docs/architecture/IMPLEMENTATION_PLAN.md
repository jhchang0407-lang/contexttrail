# Phased Implementation Plan

## Phase 1: static foundations

Deliverables:
- `ARCHITECTURE.md`
- `.pi/executor.yaml`
- `.pi/executor.lock.yaml`
- schema definitions
- artifact path helpers
- authored/resolved config loader

Acceptance:
- authored and resolved config parse
- config fingerprint verification works
- schemas validate sample payloads
- artifact directories can be created deterministically

## Phase 2: dry-run normalization pipeline

Deliverables:
- Linear setup sync for resolving names to IDs into `.pi/executor.lock.yaml`
- Linear ticket fetch
- machine block parser/regenerator
- deterministic preflight
- selected `QueueQuery` discovery and ordering
- immutable run manifest revisions
- CLI `dry-run`

Acceptance:
- can resolve configured Linear names to IDs and verify them
- can inspect eligible tickets for one selected `LinearProject` and named `QueueQuery`
- can explain rejections explicitly
- writes preview/manifests without spawning workers

## Phase 3: single-ticket execution loop

Deliverables:
- branch creation from base SHA
- packet generation
- fresh Pi JSON worker spawn
- result helper + `worker-result.json`
- validator command runner
- retry loop with checkpoint reset
- canonical commit creation

Acceptance:
- one eligible ticket from the selected `QueueQuery` can complete end-to-end
- retriable failure loops correctly
- non-retriable failure produces handoff bundle

## Phase 4: serial queue runner

Deliverables:
- execute-until-empty mode
- stop-on-blocked behavior
- required Linear workflow signal updates plus optional advisory comments
- guarded auto resume with config snapshot checks
- repo lock

Acceptance:
- one invocation can process multiple serial tickets
- blocked ticket stops run cleanly
- interrupted run resumes safely only when stored config snapshots still match and the ticket lifecycle can restart from normalization deterministically

## Phase 5: operator polish

Deliverables:
- `setup`, `resume`, `reset`, `takeover` commands
- markdown summaries derived from JSON artifacts
- config fingerprinting
- normalized ticket snapshots

Acceptance:
- operator can inspect, resume, reset, or take over without manual file surgery

## Phase 6: future upgrades

Later, not v1:
- RPC worker mode
- LLM scout veto path
- parallel execution workflow
- Pi command wrapper like `/afk-run`
- shared helper package extraction
