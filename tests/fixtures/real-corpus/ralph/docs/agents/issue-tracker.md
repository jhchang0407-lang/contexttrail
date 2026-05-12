# Issue tracker: Linear

Issues and PRDs for the Ralph repo live as Linear issues. This file is fully self-contained — agents reading this file should not need to look at any external skill installation. (Both Claude Code and the Pi agent read this same repo file.)

## Workspace identifiers

| Field                | Value                                                                |
| -------------------- | -------------------------------------------------------------------- |
| Workspace URL        | https://linear.app/thomaschang                                       |
| Team key             | `THO`                                                                |
| Team ID              | `d07a2557-7d09-4a77-83f2-9d31d12c4662`                               |
| Project name         | Ralph                                                                |
| Project ID           | `0325b01f-dfb3-4277-8f5a-bed13b5e9de9`                               |
| Project URL          | https://linear.app/thomaschang/project/ralph-9be4737b4600            |
| `needs-triage`       | label ID `7bcda881-c9fd-4c2d-ae14-e5b4e5b84b98`                      |
| `needs-info`         | label ID `98d40bd2-82e2-447a-96b4-a1c3412567dc`                      |
| `ready-for-agent`    | label ID `3bce02e6-e034-46c4-901c-ee9f002f4dcc`                      |
| `ready-for-human`    | label ID `1a136565-a8ff-4563-98cf-d37cc6d38afe`                      |
| `autonomous-ok`      | label ID `e2c7474d-91ff-476f-b12d-6234ae6baa92`                      |
| `blocked`            | label ID `13f5d74d-0fb7-4d08-b5cb-5edb3a9709a8`                      |
| `Ready for Agent`    | state ID `2a47a70e-2156-4f89-8673-39760353244e` (type `unstarted`)   |

Issue identifiers are `THO-<n>`. Use them in operator-visible output; use UUIDs only for API calls.

## When a skill says "publish to the issue tracker"

Create a Linear issue with:
- `teamId` = `d07a2557-7d09-4a77-83f2-9d31d12c4662`
- `projectId` = `0325b01f-dfb3-4277-8f5a-bed13b5e9de9`
- `labelIds` = `["7bcda881-c9fd-4c2d-ae14-e5b4e5b84b98"]` (the `needs-triage` label)

Return the `identifier` (e.g. `THO-12`) and `url` to the operator.

## When a skill says "fetch the relevant ticket"

The user will normally pass `THO-<n>` or a Linear URL. Extract the identifier and read both the issue description and its comments — Linear keeps long-form discussion in comments.

## Two execution paths

Prefer the MCP path; fall back to GraphQL only if MCP tools aren't loaded in the session.

### Path A — Linear MCP (preferred)

If `mcp__linear-server__*` tools are loaded, use them directly. Common operations:

- **Create an issue**: `mcp__linear-server__create_issue` with `{ title, description, teamId, projectId, labelIds }`
- **Read an issue**: `mcp__linear-server__get_issue` with `{ id }` (id may be `THO-12` style or UUID)
- **List issues**: `mcp__linear-server__list_issues` with filter args (e.g. `{ projectId, labels, state }`)
- **Comment**: `mcp__linear-server__create_comment` with `{ issueId, body }`
- **Apply / remove labels**: `mcp__linear-server__update_issue` with `{ id, labelIds: [...] }` (Linear replaces the full set; read existing first, then merge)
- **Move state**: `mcp__linear-server__update_issue` with `{ id, stateId }`

The exact tool names depend on which Linear MCP server is installed. Check `ToolSearch` with query `+linear` if you're not sure.

### Path B — GraphQL via `curl` (fallback)

When MCP tools aren't available, use the Linear GraphQL API directly. The user keeps `LINEAR_API_KEY` exported (typically in `~/.zshrc`); `source ~/.zshrc` first if `$LINEAR_API_KEY` is empty in the current shell.

- Endpoint: `https://api.linear.app/graphql`
- Auth header: `Authorization: $LINEAR_API_KEY` (raw key, **not** `Bearer ...` for personal API keys)

Build large payloads (>1KB) with Python and send via `curl --data-binary @file.json` rather than inline JSON to avoid shell-escaping pain on long descriptions.

Key mutations and queries:

- **Create issue**:
  ```graphql
  mutation { issueCreate(input: { title, description, teamId, projectId, labelIds }) {
    success issue { id identifier url }
  } }
  ```
- **Read issue**:
  ```graphql
  query { issue(id: "<UUID-or-THO-key>") {
    id identifier title description state { name }
    labels { nodes { name } }
    comments { nodes { body user { name } } }
  } }
  ```
- **List issues in project**:
  ```graphql
  query { issues(filter: { project: { id: { eq: "<project-id>" } } }) {
    nodes { id identifier title state { name } labels { nodes { name } } }
  } }
  ```
- **Comment**:
  ```graphql
  mutation { commentCreate(input: { issueId, body }) { success comment { id } } }
  ```
- **Update labels**: read the current `labels { nodes { id } }`, build the new set, then:
  ```graphql
  mutation { issueUpdate(id: "<id>", input: { labelIds: [...] }) { success } }
  ```
- **Move state**:
  ```graphql
  mutation { issueUpdate(id: "<id>", input: { stateId: "<state-id>" }) { success } }
  ```

## Ralph intake contract

This repo has `.pi/executor.yaml`, so `/to-issues` and `/triage` should run in **Ralph-mode**: they produce and gate tickets that Ralph can consume. Detection rule: presence of `.pi/executor.yaml` at the repo root.

### Body shape every Ralph-bound issue must carry

```markdown
## What to build
<narrative>

## Acceptance criteria
- [ ] criterion 1
- [ ] criterion 2

## Out of scope
- thing not to touch

## Notes for worker
- (optional)

<!-- EXECUTOR:START -->
schemaVersion: 1
repo: github.com/jhchang0407-lang/ralph
context_refs: []
adr_refs: []
prd_refs: []
validator_commands: []   # filled by Ralph normalization at queue time
overrides: {}
notes_for_worker: []
<!-- EXECUTOR:END -->
```

The Linear identifier (`THO-N`) is read directly from the issue and never duplicated inside the executor block. See [`docs/architecture/MACHINE_BLOCK_SCHEMA.md`](../architecture/MACHINE_BLOCK_SCHEMA.md) for full schema and validation rules.

### Producer/consumer split

| Skill / step              | Writes                                                          | Validates                                          |
| ------------------------- | --------------------------------------------------------------- | -------------------------------------------------- |
| `/to-issues`              | Issue body, executor block (refs populated, `validator_commands: []`), Linear native dependencies, `needs-triage` label | self-eligibility check before publishing            |
| `/triage` → ready-for-agent | `autonomous-ok` label, `Ready for Agent` state, Agent Brief comment, optional `notes_for_worker` / `overrides` patches inside the block markers | executor block exists, refs resolve, eligibility   |
| `/triage` → needs-info    | `needs-info` label, Triage Notes comment                        |                                                     |
| `/triage` → ready-for-human | `ready-for-human` label, `Todo` state, brief comment           |                                                     |
| `/triage` → wontfix       | `Canceled` state, close, `.out-of-scope/<concept>.md` for enhancements |                                              |
| Ralph normalization       | `validator_commands` materialized from `.pi/executor.yaml` defaults plus permitted overrides | full block schema, overrides within caps  |

`/triage` only **validates** the executor block; it never writes one. A missing or malformed block sends the issue to `needs-info` for `/to-issues` to fix.

### Lifecycle signal exclusivity

The `needs-info`, `in-progress`, `in-review`, and `blocked` signals are mutually exclusive. Whoever writes one removes the others. `autonomous-ok` is human-owned selection input; never mutate it during signal writes.

### Eligibility self-check (rejected before publish or promotion)

- Schema/infrastructure changes
- Doc-primary deliverables (e.g. "edit CONTEXT.md")
- Secret/manual credential steps
- Missing acceptance criteria
- Touches forbidden path classes
- Too large for one vertical slice

## Caveats specific to this workspace

- The team has only one project (`Ralph`) at the moment; new initiatives should default to that project unless the user specifies otherwise.
- Workflow states present: `Backlog`, `Todo`, `Ready for Agent`, `In Progress`, `In Review`, `Done`, `Canceled`, `Duplicate`. The `blocked` lifecycle signal is **label-mode** (`signals.blocked.mode: label`) — there is no `Blocked` state.
- Linear labels are team-scoped, not project-scoped — they're shared across all projects on the `THO` team.
- Markdown in issue descriptions renders well in Linear.
