# Runner Module Layout

## Package layout

```text
src/
  cli/
    main.ts
    commands/
      setup.ts
      dry-run.ts
      execute.ts
      resume.ts
      reset.ts
      takeover.ts
  config/
    load-authored-config.ts
    load-resolved-config.ts
    merge-config.ts
    verify-config-fingerprint.ts
    config-schema.ts
  linear/
    client.ts
    tickets.ts
    normalize-ticket.ts
    workflow-signals.ts
    advisory-comments.ts
    setup-sync.ts
  queue/
    discover-eligible.ts
    sort-tickets.ts
    manifests.ts
  git/
    worktree-check.ts
    branches.ts
    commits.ts
    diff.ts
    reset.ts
  runner/
    lock.ts
    run-state.ts
    execute-run.ts
    execute-ticket.ts
    resume-run.ts
    takeover-run.ts
    classify-stage-failure.ts
  preflight/
    deterministic-preflight.ts
    policy-checks.ts
  packet/
    resolve-context.ts
    resolve-adrs.ts
    resolve-prd.ts
    build-packet.ts
    fingerprint.ts
  worker/
    spawn-pi-json.ts
    result-helper.ts
    wait-for-result.ts
  validate/
    validate-worker-result.ts
    run-validator-commands.ts
    classify-failure.ts
  artifacts/
    paths.ts
    write-json.ts
    write-markdown.ts
    handoff.ts
    run-abort.ts
    signal-error.ts
  schemas/
    machine-block.ts
    packet.ts
    worker-result.ts
    validator-result.ts
    handoff.ts
    authored-config.ts
    resolved-config.ts
  types/
    index.ts
```

## Suggested execution flow by module

- `cli/main.ts` parses mode and delegates.
- `cli/commands/setup.ts` resolves Linear names to IDs and writes `.pi/executor.lock.yaml`.
- `config/*` loads `.pi/executor.yaml` and `.pi/executor.lock.yaml`, verifies fingerprint compatibility, and presents a merged execution view.
- `runner/execute-run.ts` owns the top-level serial loop for one repo, one `LinearProject`, and one named `QueueQuery`.
- `queue/*` builds the eligible ticket list from the selected queue query and manifest revision.
- `linear/normalize-ticket.ts` regenerates the machine-owned block without mirroring dependency state.
- `linear/workflow-signals.ts` applies and reconciles required lifecycle signals separately from advisory comments.
- `preflight/*` rejects malformed or risky tickets deterministically with no Linear side effects.
- `packet/*` resolves excerpts and writes packet artifacts only.
- `worker/spawn-pi-json.ts` launches a fresh Pi subprocess.
- `validate/*` runs required checks and returns validator failure classes only.
- `runner/classify-stage-failure.ts` classifies non-validator lifecycle failures such as `ticket_quality_failure` and `signal_failure`.
- `git/commits.ts` manages checkpoint and canonical commit handling.
- `artifacts/*` persists run aborts, signal failures, handoff bundles, and resume state.

## First implementation cut

1. `config`, `schemas`, `artifacts`
2. `linear/setup-sync`, `linear/workflow-signals`, `queue`, `preflight`
3. `git`, `packet`
4. `worker`, `validate`
5. `runner`, `cli`
