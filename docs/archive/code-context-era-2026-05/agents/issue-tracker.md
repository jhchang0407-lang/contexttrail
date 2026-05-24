# Issue Tracker

Issues for this repo live in **Linear**.

## Workspace identifiers

| Field | Value |
|---|---|
| Team key | `THO` |
| Team name | ThomasChang |
| Team ID | `d07a2557-7d09-4a77-83f2-9d31d12c4662` |
| Project name | `ContextTrail v1` |
| Project ID | `fcf9dc57-a8db-4580-a6a7-24e13b814d23` |

Every issue created by a skill for this repo MUST be filed against this team and this project.

## Authentication

Linear API access uses a personal API key exported in the user's shell as `LINEAR_API_KEY`:

```sh
# already in ~/.zshrc
export LINEAR_API_KEY="lin_api_..."
```

Skills MUST read the key from the environment at runtime. Never hard-code, never log, never commit.

If a skill is invoked in a shell that hasn't sourced `~/.zshrc`, the variable may be unset. Source it explicitly:

```sh
source ~/.zshrc
```

## How skills should publish to Linear

Prefer a **generated Python script** for any skill that creates or updates Linear issues (matches the convention in `/to-issues` and `/to-prd`). Save the script to `/tmp/linear-publish-<unix_ts>.py` and keep it for re-runs / inspection.

Minimal Python skeleton (uses the GraphQL API directly; no SDK install required):

```python
import os, json, urllib.request

LINEAR_API_KEY = os.environ["LINEAR_API_KEY"]
TEAM_ID    = "d07a2557-7d09-4a77-83f2-9d31d12c4662"
PROJECT_ID = "fcf9dc57-a8db-4580-a6a7-24e13b814d23"

def linear(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(
        "https://api.linear.app/graphql",
        data=body,
        headers={"Authorization": LINEAR_API_KEY, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())
```

To create an issue, use the `issueCreate` mutation:

```graphql
mutation IssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { id identifier title url } }
}
```

with input containing at minimum `{ teamId, projectId, title, description, labelIds }`.

## Common label IDs (for `labelIds` input)

| Label | ID |
|---|---|
| `needs-triage` | `7bcda881-c9fd-4c2d-ae14-e5b4e5b84b98` |
| `needs-info` | `98d40bd2-82e2-447a-96b4-a1c3412567dc` |
| `ready-for-agent` | `3bce02e6-e034-46c4-901c-ee9f002f4dcc` |
| `ready-for-human` | `1a136565-a8ff-4563-98cf-d37cc6d38afe` |
| `autonomous-ok` | `e2c7474d-91ff-476f-b12d-6234ae6baa92` |
| `blocked` | `13f5d74d-0fb7-4d08-b5cb-5edb3a9709a8` |
| `Bug` | `c7c5ad7a-daae-42d5-992e-f294090fb20a` |
| `Feature` | `a88ee52b-db90-4cbc-8d6b-0f4a4b0d001b` |
| `Improvement` | `215ee558-71c6-4eb1-a3f4-8c0fa65e643e` |

## Workflow state IDs (for `stateId` transitions)

| State | Type | ID |
|---|---|---|
| `Backlog` | backlog | `c94e48ab-c8bb-4e37-99e3-9ad06828cb5b` |
| `Todo` | unstarted | `8a0031b5-9064-499a-9b5b-0a07dac69da1` |
| `Ready for Agent` | unstarted | `2a47a70e-2156-4f89-8673-39760353244e` |
| `In Progress` | started | `cf752374-9fec-4edd-958c-9d7ee5c27cd7` |
| `In Review` | started | `c3e20fab-1e85-4024-b5ed-c440cfe1746c` |
| `Done` | completed | `c3a7f89a-9212-45fe-bce4-d039f594a45a` |
| `Duplicate` | canceled | `6f17b122-fd31-472c-86dc-dfe2488bea0b` |
| `Canceled` | canceled | `4ab18ad2-a605-444f-9c70-38726e9b13aa` |

## Conventions

### PRDs

The repo's PRDs ([`docs/prd/`](../prd/)) are the source-of-truth canonical docs. Each PRD is mirrored to Linear as one issue tagged `Feature` + `needs-triage` (until triage moves it forward). The Linear issue body should link back to the canonical PRD path in the repo, not duplicate the full prose.

Filename → title convention: `0002-week-3-cards-and-substrate.md` → Linear title `PRD-0002: Week 3 — Cards overlay, locked-include, substrate migration`.

### Issues sliced from a PRD

`/to-issues` slices an accepted PRD into independently-grabbable tickets. Each ticket:

- Title prefix references its PRD: `[PRD-0002 / 3a.5] Locked-include resolver`.
- Body links back to the PRD section in the repo.
- Carries `Feature` (or `Bug` / `Improvement` as appropriate) + `needs-triage` until triaged.
- May carry `autonomous-ok` if the PRD's deliverable is fully specified for an AFK agent to grab.

### Bugs and follow-up work

Issues filed outside a PRD flow (bug reports, polish items, follow-ups from `/spawn_task`) carry `Bug` or `Improvement` + `needs-triage` and land in `Backlog`. They go through the same triage state machine as PRD-derived issues.

### Never commit secrets

`LINEAR_API_KEY` lives in `~/.zshrc` only. It MUST NOT appear in: this repo's git history, generated scripts saved under `/tmp/`, issue bodies, or any committed file. If a script needs the key, it reads it from the environment at runtime.
