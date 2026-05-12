# PRD: Ralph v1

Status: needs-triage
Date: 2026-05-05

## Problem Statement

Teams using Pi (Claude Code's headless subprocess) to work through a Linear backlog face a fragmented, manual workflow: tickets must be hand-selected, branches created by hand, Linear state updated manually, and retry/escalation context assembled from scratch every time something fails. There is no systematic way to run through a full queue of AFK-ready tickets with bounded autonomy, consistent Linear state truth, and a structured handoff when human intervention is needed.

## Solution

Ralph is a globally-installed TypeScript CLI that automates the full autonomous ticket lifecycle against a single checked-out Managed Repository per Run. It selects eligible Linear tickets from a configured Queue Query, normalizes each ticket's machine-owned execution block, resolves context refs into a compact worker packet, spawns a fresh Pi subprocess per iteration, validates results mechanically, retries bounded failures, writes all required Linear Workflow Signals as execution truth, and produces a complete Handoff Bundle when escalation is needed.

## User Stories

1. As an operator, I want to run a single command that processes all AFK-ready tickets in a Queue Query, so that I don't have to manually select and execute each one.
2. As an operator, I want Ralph to select from exactly one named Queue Query per Run, so that I always know which work is being executed.
3. As an operator, I want Ralph to auto-select the LinearProject and Queue Query when only one is configured, so that simple repos require no extra flags.
4. As an operator, I want Ralph to fail loudly on ambiguous LinearProject/Queue Query selection and require explicit choice, so that I never accidentally run the wrong queue.
5. As an operator, I want to run `ralph dry-run` to see which tickets would be selected and why, without executing anything, so that I can validate queue state before committing.
6. As an operator, I want dry-run to explain explicitly why each ticket is rejected, so that I can fix ticket-quality issues before running for real.
7. As an operator, I want Ralph to process tickets serially, so that the repo state is always deterministic and git conflicts are impossible.
8. As an operator, I want Ralph to stop the entire Run when a required Linear Workflow Signal write fails, so that Linear never silently diverges from actual execution state.
9. As an operator, I want Ralph to stop the entire Run when a ticket becomes blocked after exhausting retries, so that unresolved work doesn't get silently skipped.
10. As an operator, I want a complete Handoff Bundle written locally whenever a ticket is escalated, so that I can pick up exactly where Ralph left off.
11. As an operator, I want the Handoff Bundle to include retry history, files changed, commands run, and suggested next actions, so that I have full context without reading logs.
12. As an operator, I want to run `ralph resume` to continue an interrupted Run, so that I don't lose progress on a partial queue.
13. As an operator, I want resume to refuse if the authored or resolved config has changed since the Run started, so that I never continue against stale configuration.
14. As an operator, I want to run `ralph reset` to clear a stale Repo Lock and start fresh, so that I can recover from crashed runs without manual file surgery.
15. As an operator, I want to run `ralph takeover` on a blocked or in-progress ticket, so that I can continue autonomously or hand off to deliberate human-steered mode.
16. As an operator, I want takeover to inherit the autonomous retry budget from the prior Run, so that I can't accidentally reset budget limits by restarting.
17. As an operator, I want takeover to reuse the same branch when possible, so that PR history is preserved.
18. As an operator, I want a Repo Lock that prevents concurrent Ralph activity in the same checkout, so that two invocations never corrupt each other.
19. As an operator, I want to run `ralph setup` to resolve Linear label and state names to IDs and write `.pi/executor.lock.yaml`, so that production runs are always deterministic.
20. As an operator, I want setup to fail on ambiguity rather than guessing, so that misconfigurations surface immediately.
21. As an operator, I want both `.pi/executor.yaml` and `.pi/executor.lock.yaml` committed to git, so that every Run is reproducible from history.
22. As an operator, I want Ralph to refuse `dry-run` and `execute` when authored and Resolved Config fingerprints don't match, so that I'm always prompted to run Setup Sync first.
23. As a repo maintainer, I want to define Queue Queries as named filters in `.pi/executor.yaml`, so that queue logic is version-controlled and not implicit.
24. As a repo maintainer, I want Queue Queries to reference named Linear Constants rather than raw IDs, so that config is human-readable.
25. As a repo maintainer, I want validator commands, retry budgets, and scope limits to be declared per-repo with optional per-LinearProject overrides, so that each project gets appropriate defaults.
26. As a repo maintainer, I want certain Execution Policy fields to be marked non-overridable, so that tickets cannot bypass critical safety rules.
27. As a repo maintainer, I want overridable fields to have caps, so that tickets can tune within bounds but never exceed them.
28. As a ticket author, I want Ralph to normalize the Machine-owned Ticket Block automatically, so that I don't have to manually sync command lists with repo config.
29. As a ticket author, I want Normalization to regenerate validator commands from repo defaults and my permitted overrides, so that the block always reflects actual Execution Policy.
30. As a ticket author, I want Normalization failures to trigger the `needs_info` Workflow Signal, so that I can see exactly which tickets have quality issues.
31. As a ticket author, I want Packet Resolution to collect all missing refs in a single failure rather than failing one by one, so that I can fix all issues at once.
32. As a ticket author, I want the worker to receive the actual text of referenced context sections, not just IDs, so that it can work without reading every document.
33. As a ticket author, I want my Acceptance Criteria to outrank ADRs, `CONTEXT.md`, and PRD text when there's a conflict, so that my intent is always honored.
34. As a ticket author, I want explicitly empty ref arrays (`[]`) to be valid with a warning, so that tickets without context refs are not silently broken.
35. As a worker subprocess, I want a Ralph-installed helper CLI to serialize my result file, so that the interface is always schema-valid.
36. As a worker subprocess, I want the packet to include base SHA, retry context, and forbidden action list, so that I have everything I need without reading the full repo.
37. As a worker subprocess, I want to create exactly one local Checkpoint Commit after reaching green, so that my progress is preserved before canonical validation.
38. As a worker subprocess, I want my Checkpoint Commit to be local-only and never pushed, so that no half-validated work escapes to remotes.
39. As the validator, I want to check required commands, file scope, forbidden paths, and schema validity, but not re-architect the solution, so that my role is mechanical and unambiguous.
40. As the validator, I want to classify failures as `policy_failure`, `command_failure`, `scope_failure`, or `artifact_failure`, so that the runner knows which failures are retriable.
41. As the runner, I want to spawn a fresh Pi subprocess for each iteration, so that no state leaks between retries.
42. As the runner, I want to pass the full prior packet plus validator failure summary on each retry, so that the worker has complete context.
43. As the runner, I want per-ticket retry budgets of up to 3 cycles by default (capped at 5), so that transient failures don't exhaust the queue.
44. As the runner, I want non-retriable policy failures to stop immediately without consuming retry budget, so that prohibited operations are never retried.
45. As the runner, I want to write `in_progress` only after Normalization, Preflight, Packet Resolution, and branch creation all succeed, so that Linear state is never optimistically wrong.
46. As the runner, I want to write `in_review` only after the Canonical Commit is created, so that the review state is always backed by real code.
47. As the runner, I want to re-execute the selected Queue Query between tickets to pick up contexttrail, but never change the query definition mid-Run, so that the queue is live but the selection rules are frozen.
48. As the runner, I want the branch name to be `afk/<ticket-key>-<slug>`, so that branches are human-readable and ticket-traceable.
49. As the runner, I want branch creation to freeze the Repo Binding, so that a ticket can never retarget a different repo mid-execution.
50. As the runner, I want to amend/squash the Checkpoint Commit into a Canonical Commit before writing `in_review`, so that the final commit is clean and attributed correctly.

## Implementation Decisions

### Modules to build

- **Schema Library** — versioned schemas for Machine-owned Ticket Block, Packet, Worker Result, Validator Result, Handoff, authored config, and Resolved Config. Pure parse functions with no I/O. The foundation all other modules depend on.

- **Config Loader** — loads `.pi/executor.yaml` and `.pi/executor.lock.yaml`, verifies fingerprint compatibility, exposes a single merged execution view. Encapsulates YAML parsing, schema validation, fingerprint checking, and LinearProject override merging behind one `loadConfig(repoRoot)` interface.

- **Artifact Store** — deterministic path generation and typed serialization for all runtime state: Repo Lock, active Run, Run Manifests, normalized ticket snapshots, iteration packets, Worker Results, Validator Results, Handoff Bundles, run-abort records, signal-error records. All artifact I/O goes through this module.

- **Linear Client** — typed wrapper over the Linear SDK covering ticket fetch, Machine-owned Ticket Block writes (inside owned markers only), Workflow Signal application with label/state mode handling, and Advisory Comments. Encapsulates pagination, retries, and API detail.

- **Setup Sync** — resolves configured label/state names to Linear IDs, writes them into the lock file, and verifies the result. Handles interactive and non-interactive modes. Must fail explicitly on ambiguity.

- **Ticket Normalizer** — parses and regenerates the Machine-owned Ticket Block from the current ticket body. Validates schema, materializes validator commands from repo/LinearProject defaults plus permitted overrides, enforces cap constraints. Pure given ticket body + merged config.

- **Queue Discovery** — builds the ordered eligible ticket set for a given Queue Query: filters by LinearProject membership, label/state criteria, and dependency/blocker state; orders by dependency graph, priority, then stable tiebreaker. Returns an immutable Run Manifest revision.

- **Preflight** — deterministic local go/no-go checks against a normalized ticket and current repo state: Repo Binding match, forbidden path scan, Acceptance Criteria presence, worktree cleanliness. No Linear side effects. Pure artifact output.

- **Packet Builder** — resolves context refs, ADR refs, and optional PRD refs into excerpt text assembled for worker input. Collects all missing refs and fails once with the complete set. Preserves authored ref order. Builds the versioned Packet artifact.

- **Git Operations** — branch creation from a pinned base SHA, Checkpoint Commit creation, Canonical Commit creation/squash, worktree state inspection, and controlled SHA-based reset. Encodes all safety invariants (no push before canonical, no known-failing checkpoints).

- **Worker Spawner** — launches a fresh Pi subprocess in JSON mode with the resolved Packet, waits for `worker-result.json` to appear within the configured time/turn budget, returns the result. Handles timeout and subprocess failure.

- **Validator** — runs required commands, checks changed file count and path scope, verifies forbidden paths, validates result schema, checks Acceptance Criteria coverage markers. Returns a typed Validator Result with classified failure codes.

- **Workflow Signal Writer** — applies lifecycle signals (`needs_info`, `in_progress`, `in_review`, `blocked`) idempotently with label vs. state mode, clears superseded lifecycle labels in label mode, tracks prior state for `needs_info` recovery in local artifacts. Always a hard stop on write failure.

- **Runner Orchestrator** — thin serial loop that acquires the Repo Lock, creates or resumes a Run Manifest, drives one ticket at a time through the full lifecycle by delegating to the above modules. Owns retry logic, failure classification, and Run abort/resume semantics.

- **CLI** — command parsing and operator-facing output for `setup`, `dry-run`, `execute`, `resume`, `reset`, `takeover`. Thin wrapper over Runner Orchestrator.

### Key interface contracts

- All inter-module data is schema-validated at boundaries using the Schema Library.
- Worker input is always a versioned Packet file on disk, never injected via stdin or env.
- Worker output is always `worker-result.json`; stdout is logs only.
- The Validator never reads the Packet or makes Linear calls; it only checks the Worker Result against config.
- The Workflow Signal Writer owns all Linear lifecycle mutation; no other module writes lifecycle state.

### Configuration architecture

- `.pi/executor.yaml` — human-authored intent: Queue Queries, Linear Constants, Execution Policy defaults, LinearProject overrides, overridable flags and caps.
- `.pi/executor.lock.yaml` — generated Resolved Config: Linear IDs and config fingerprints. Committed to git. Written only by Setup Sync.
- Normal execution fails on authored/resolved fingerprint drift.
- Safety invariants (forbidden paths, no push before canonical, no schema/infra execution) are hardcoded in runner code, not configurable.

### Failure semantics

- Normalization failure → `needs_info` signal + drop ticket + continue Run (unless signal write fails).
- Preflight failure → skip ticket for current Run + continue Run (no Linear side effects).
- Packet Resolution failure → `needs_info` signal + drop ticket + continue Run (unless signal write fails).
- Required signal write failure → abort full Run after stage-appropriate rollback.
- Validator `policy_failure` → non-retriable, immediate escalation.
- Validator `command_failure` / `scope_failure` / `artifact_failure` → retriable within budget.

## Testing Decisions

**What makes a good test:** verify external behavior — what the module returns or writes given specific inputs — not how it does it internally. Do not assert on private state, intermediate calls, or implementation order.

### Unit tests (pure or near-pure modules)

- **Schema Library** — parse valid and invalid payloads for each schema; check version rejection.
- **Config Loader** — load valid configs; verify fingerprint mismatch detection, LinearProject override merging, cap enforcement.
- **Ticket Normalizer** — normalize well-formed tickets, reject invalid blocks, verify command materialization, verify override cap enforcement.
- **Queue Discovery** — order tickets correctly by dependency graph, priority, and tiebreaker; verify drift acceptance between tickets; verify frozen query definition.
- **Preflight** — accept and reject tickets based on Repo Binding, forbidden paths, Acceptance Criteria presence.
- **Packet Builder** — resolve all ref types; fail with complete missing-ref set; preserve authored ref order.
- **Validator** — pass and fail each failure class independently; verify non-retriable classification.
- **Workflow Signal Writer** — verify idempotency, label/state mode branching, stale lifecycle label clearing.

### Integration tests (real I/O in temp environments)

- **Artifact Store** — write and read back each artifact type in a real temp directory; verify deterministic paths.
- **Git Operations** — create branches, Checkpoint Commits, and Canonical Commits in a real temp git repo; verify push-prevention invariants.
- **Config Loader** — load real YAML files from disk; verify fingerprint generation and verification.

### End-to-end tests

- **Runner Orchestrator** — run a full single-ticket cycle against a Linear sandbox project and a temp git repo; verify Linear state transitions, artifact output, and Canonical Commit creation.
- **Resume** — interrupt a Run and resume it; verify config snapshot matching and ticket-lifecycle restart from Normalization.

## Out of Scope

- Multi-repo or multi-Queue Query Runs in a single invocation.
- Parallel ticket execution.
- Webhook-driven invocation (polling/operator-driven only in v1).
- LLM scout veto path (deferred; mechanical Preflight only in v1).
- RPC worker mode (file-based JSON Worker only in v1).
- Pi command wrapper like `/afk-run` (CLI entrypoint only in v1).
- Shared helper package extraction.
- Provider abstraction for non-Linear ticket sources.
- Doc-primary deliverables — Ralph does not edit `CONTEXT.md`, ADRs, or PRDs as part of normal execution.
- Schema or infrastructure changes inside worker tickets.
- Auto-clearing of `blocked` Workflow Signal — human-cleared in v1.
- Concurrent runs against the same Managed Repository (a single Repo Lock is required and exclusive).

## Further Notes

- Implementation order follows the phased plan in `docs/architecture/IMPLEMENTATION_PLAN.md`: foundations → dry-run pipeline → single-ticket loop → serial queue → operator polish.
- The first implementation cut is `config`, `schemas`, `artifacts`, then `linear/setup-sync`, `linear/workflow-signals`, `queue`, `preflight`, then `git`, `packet`, then `worker`, `validate`, then `runner`, `cli`.
- Acceptance Criteria from each ticket are the highest-priority truth; ADRs, `CONTEXT.md`, and PRD excerpts are inputs.
- This PRD itself is documentation context for future Ralph tickets, but Ralph workers should never edit it as part of normal execution.
- Before scaling to additional providers, validate the v1 surface against a real Linear workspace end-to-end to ensure the assumed shared abstraction boundary is honest.
