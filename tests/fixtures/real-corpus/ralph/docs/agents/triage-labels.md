# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual Linear label strings used in this workspace.

| Canonical role       | Label in this workspace | Meaning                                  | Linear label ID                          |
| -------------------- | ----------------------- | ---------------------------------------- | ---------------------------------------- |
| `needs-triage`       | `needs-triage`          | Maintainer needs to evaluate this issue  | `7bcda881-c9fd-4c2d-ae14-e5b4e5b84b98`   |
| `needs-info`         | `needs-info`            | Waiting on reporter for more information | `98d40bd2-82e2-447a-96b4-a1c3412567dc`   |
| `ready-for-agent`    | `ready-for-agent`       | Fully specified, ready for an AFK agent  | `3bce02e6-e034-46c4-901c-ee9f002f4dcc`   |
| `ready-for-human`    | `ready-for-human`       | Requires human implementation            | `1a136565-a8ff-4563-98cf-d37cc6d38afe`   |
| `wontfix`            | (use `Canceled` state)  | Will not be actioned (no label needed)   | _state-only_                             |

## Ralph selection inputs

Ralph's queue picks tickets that simultaneously satisfy these:

| Selection input              | Linear ID                                | Mechanism      |
| ---------------------------- | ---------------------------------------- | -------------- |
| `autonomous-ok` label present | `e2c7474d-91ff-476f-b12d-6234ae6baa92`  | label          |
| `Ready for Agent` state      | `2a47a70e-2156-4f89-8673-39760353244e`   | workflow state |
| `blocked` label absent       | `13f5d74d-0fb7-4d08-b5cb-5edb3a9709a8`   | label          |
| `needs-info` label absent    | `98d40bd2-82e2-447a-96b4-a1c3412567dc`   | label          |

`/triage` applies the first two when promoting an issue to `ready-for-agent`. The latter two are written by Ralph (or `/triage`) as workflow signals.

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from the middle column. If the label has no UUID yet, create it on first use via `issueLabelCreate` (Linear MCP `create_issue_label` or the GraphQL mutation), then record its ID here.

## Important caveat for Ralph

This repo's `.pi/executor.yaml` defines a separate set of **workflow signals** that Ralph itself writes during execution: `needs_info`, `in_progress`, `in_review`, `blocked`. Those are different things from these triage labels:

- **Triage labels** are applied by humans (or `/triage`) to decide what should be picked up.
- **Workflow signals** are applied by Ralph as it processes a ticket.

In particular, `needs-info` appears in both worlds:
- The `needs-info` triage label means "the issue reporter needs to provide more info before we can act."
- The `needs_info` workflow signal in `executor.yaml` means "Ralph found the ticket's machine-owned block or context refs broken and bounced it."

The Linear label `needs-info` may be reused for both purposes (since the meaning overlaps — both are blocked on more info), but be precise about which actor is writing it.
