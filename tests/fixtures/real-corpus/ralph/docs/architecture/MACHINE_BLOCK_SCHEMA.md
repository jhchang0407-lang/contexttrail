# Machine Block Schema

Use a machine-owned block inside the Linear ticket body.

```md
<!-- EXECUTOR:START -->
schemaVersion: 1
repo: github.com/thomaschang/ralph
context_refs:
  - auth/session-state
adr_refs:
  - ADR-012
prd_refs: []
validator_commands: []   # filled by Ralph normalization at queue time
overrides:
  max_files_changed: 6
  retry_budget: 2
  time_budget_minutes: 20
notes_for_worker:
  - Preserve existing session timeout semantics.
  - Do not touch OAuth flow.
<!-- EXECUTOR:END -->
```

The Linear ticket identifier (e.g. `THO-12`) is read directly from the issue's `identifier` field; it is not duplicated inside the executor block.

## Fields

- `schemaVersion`: integer, required
- `repo`: string, required normalized managed-repository slug
- `context_refs`: string array, required, may be empty
- `adr_refs`: string array, required, may be empty
- `prd_refs`: string array, required, may be empty
- `validator_commands`: string array, required; may be empty `[]` when written upstream and is materialized by normalization at queue time
- `overrides`: object, optional, but only for a constrained schema-defined set of known override keys
- `notes_for_worker`: string array, optional

## Rules

- Linear native dependency fields are authoritative.
- The machine-owned block does not mirror dependency state.
- `repo` is the explicit repo binding and must match the normalized slug derived from repo-local config before execution may begin.
- `validator_commands` are materialized by Ralph normalization from repo/project defaults plus permitted ticket overrides; upstream skills (`/to-issues`) write the field as `[]` and Ralph fills it just before queue execution.
- Execution reads `validator_commands` directly from the machine-owned block after normalization, without further policy lookup.
- Dependency snapshots, when needed for audit, belong in run artifacts rather than the ticket body.
- Empty refs must be explicit: `[]`.
- Only machine-owned block content may be regenerated.
- `overrides` is not a free-form bag; only schema-defined override fields are allowed.
- Any `overrides` field must be explicitly overridable in `.pi/executor.yaml` and stay within caps.
- Unknown override keys cause normalization failure.
- Ticket identity comes from Linear's `identifier` field (e.g. `THO-12`); never duplicate it inside the block.

## Validation outcomes

Normalization fails if:
- block missing
- YAML invalid
- required fields missing
- override not permitted
- override exceeds cap
- validator command materialization fails (e.g. config defaults missing)
