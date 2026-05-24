# Triage Labels

Skills speak Linear's vocabulary verbatim. The four canonical triage roles map exact-string to existing Linear labels; the fifth (`wontfix`) is a workflow-state transition rather than a label.

## Triage role → Linear action

| Canonical role (in skills) | Linear action |
|---|---|
| `needs-triage` | Apply label `needs-triage` |
| `needs-info` | Apply label `needs-info` |
| `ready-for-agent` | Apply label `ready-for-agent` (typically combined with state transition to `Ready for Agent`) |
| `ready-for-human` | Apply label `ready-for-human` (typically combined with state transition to `Todo`) |
| `wontfix` | **No label.** Transition workflow state to `Canceled` instead. |

When a skill mentions a triage role (e.g. "apply the AFK-ready triage label"), use the corresponding Linear action above. For `wontfix`, transition state — do NOT create a `wontfix` label; the `Canceled` state covers the same intent and is more idiomatic Linear.

Label IDs and state IDs are in [`issue-tracker.md`](issue-tracker.md).

## Supplemental labels (used outside the triage state machine)

Linear has additional labels that are NOT triage roles. Skills may apply them in addition to triage labels:

| Label | When to apply |
|---|---|
| `Bug` | Issue describes a defect (something used to work, now broken; or behavior contradicts spec) |
| `Feature` | Issue describes new functionality. PRD-derived issues default to this. |
| `Improvement` | Issue describes a refinement of existing functionality (refactor, polish, perf, ergonomics) |
| `autonomous-ok` | Issue is fully specified — an AFK agent can pick it up with no human context. Often paired with `ready-for-agent`. |
| `blocked` | Issue cannot proceed due to an external dependency. Independent of triage role; can be set on issues at any state. |

## Workflow states (the lifecycle most skills care about)

```
Backlog → Todo → Ready for Agent → In Progress → In Review → Done
                                                          ↘ Duplicate / Canceled
```

`Ready for Agent` is the load-bearing state — it signals the issue is fully specified, has the `ready-for-agent` label (and usually `autonomous-ok`), and is safe for an AFK agent to grab.

## Triage state machine summary

For the `triage` skill processing an incoming issue (default state: `Backlog` + `needs-triage`):

1. Issue lacks information needed to act on it → apply `needs-info`, leave in `Backlog`, optionally comment requesting specifics.
2. Issue is fully specified for autonomous work → apply `ready-for-agent` (often `autonomous-ok` too), transition to `Ready for Agent`.
3. Issue is fully specified but requires human implementation → apply `ready-for-human`, transition to `Todo`.
4. Issue won't be actioned → transition to `Canceled` (no `wontfix` label).
5. Issue is a duplicate → transition to `Duplicate`, comment with the original issue ID.

Only ONE of `needs-info` / `ready-for-agent` / `ready-for-human` should be applied at a time. `needs-triage` is removed when any of the three is applied.
