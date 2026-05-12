# Ralph Architecture

## Overview

Ralph is an external TypeScript CLI that is globally reusable across repositories and projects. Each run executes one selected named `QueueQuery` for one selected `LinearProject` in one checked-out repository, serially, using fresh Pi subprocesses.

## Runtime layers

1. **Operator entrypoint**
   - CLI first
   - later thin Pi wrapper command
   - invoked from within the target repository for a single-run scope
2. **Runner**
   - owns lock, queueing, normalization, preflight, packet generation, worker spawning, validation, retries, Linear updates, git operations
3. **Worker**
   - fresh `pi` subprocess per iteration
   - JSON mode in v1
   - TDD inside one bounded attempt
4. **Validator**
   - mechanical checks only

## Main loop

1. acquire repo lock
2. resume an existing compatible run or create a new run manifest
3. select next eligible ticket from the chosen `QueueQuery`
4. normalize ticket machine block
5. run deterministic preflight
6. generate resolved packet
7. create ticket branch from pinned `baseSha`
8. write required `in_progress` Linear signal
9. spawn worker subprocess
10. wait for `worker-result.json`
11. validate
12. if retriable failure, reset to checkpoint and retry with fresh worker
13. if success, create canonical commit and write required `in_review` Linear signal
14. if blocked/HITL, write handoff bundle, then write required `blocked` Linear signal, and stop run
15. if the `blocked` signal write fails, preserve the handoff bundle, classify a `signal_failure`, and abort the full run
16. if queue empty, finish run and release lock

## Invariants

Hardcoded in runner code:
- no push before canonical commit
- no schema/infra execution
- forbidden path classes are hard-fail
- dirty worktree rejected at fresh run start
- resume and takeover may repair dirty local state only through controlled reset rules before continuing
- one checkpoint max per worker iteration
- no known-failing checkpoint commits
- resume requires matching authored and resolved config fingerprints from the stored run manifest
- resume restarts the current ticket lifecycle from normalization
- resume uses the last known-good checkpoint only when the failure class and local state still justify trusting it; otherwise it restarts from the pinned base SHA
- serial execution only

## Configuration scope

- global user-level credentials live outside managed repositories, e.g. `~/.pi/credentials.yaml`
- per-repository authored config lives in `.pi/executor.yaml`
- per-repository resolved config lives in `.pi/executor.lock.yaml`
- each run binds to exactly one repository, one `LinearProject`, and one named `QueueQuery`

## State layout

```text
.pi/
  runner/
    lock.json
    active-run.json
    manifests/
  executions/
    ENG-123/
      normalized-ticket.json
      handoff.json
      iteration-01/
        packet.json
        worker-result.json
        validator-result.json
```

## Schemas

Versioned schemas:
- executor config
- machine block
- packet
- worker result
- validator result
- handoff

## Validator failure classes

- `policy_failure`
- `command_failure`
- `scope_failure`
- `artifact_failure`

These belong strictly to validator scope after worker output exists. Only command failures and some bounded scope/interface failures are retriable.

## Runner-stage failure categories

- `ticket_quality_failure` — normalization or packet resolution failure that triggers `needs_info`
- `signal_failure` — required Linear signal write failure that aborts the full run

These belong to runner lifecycle gates outside validator scope.

## Early-stage failure semantics

- normalization failure triggers the required `needs_info` Linear signal, drops the ticket from the current candidate set, and continues the run unless the signal write fails
- preflight failure is local-only, skips the ticket for the rest of the current run, and continues the run
- packet-resolution failure triggers the required `needs_info` Linear signal, drops the ticket from the current candidate set, and continues the run unless the signal write fails
- any required Linear signal write failure is treated as a systemic failure that aborts the full run after stage-appropriate rollback and artifact preservation

## Queue semantics

Each run is bound to one selected named `QueueQuery` and one selected `LinearProject`.

Order:
1. dependency order
2. Linear priority
3. stable tiebreaker

Recalculate the chosen `QueueQuery` result set between tickets, never during a ticket.

## Git model

- branch per ticket: `afk/<ticket-id>-<slug>`
- branch is created only after normalization, preflight, and packet resolution succeed
- worker writes local checkpoint commit after green
- wrapper validates
- wrapper amends/squashes into canonical final commit
- checkpoint commits never pushed

## Worker contract

Inputs:
- resolved packet file
- repo state / branch state
- Ralph-installed helper path for result serialization

Outputs:
- authoritative `worker-result.json`
- optional logs to stdout/stderr

## Validator contract

Checks:
- required commands
- global minimum defaults
- changed file policy
- forbidden path policy
- artifact/schema validity
- acceptance criteria coverage markers

## Human takeover

Blocked tickets produce:
- `handoff.json`
- retry history
- latest SHA
- branch ready for manual continuation
- required `blocked` Linear signal when the signal write succeeds

If the `blocked` signal write fails, the handoff bundle remains authoritative local evidence and the run aborts for later retry or explicit human intervention.
