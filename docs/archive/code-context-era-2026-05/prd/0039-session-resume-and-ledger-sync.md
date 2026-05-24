# PRD-0039: Session Resume and Ledger Sync

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's thirty-ninth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADRs: [ADR-0014](../adr/0014-agent-assisted-setup-without-truth-promotion.md), [ADR-0018](../adr/0018-inbox-backed-by-local-files-ui-through-agent-surface.md), [ADR-0022](../adr/0022-setup-readiness-policy.md). Predecessor PRDs: [PRD-0035](0035-sync-hygiene-code-source-tombstoning-and-freshness-check.md) (pre-retrieve freshness detection), [PRD-0037](0037-agent-assisted-setup-conversation.md) (setup questions), and [PRD-0038](0038-one-time-mcp-install-and-one-command-setup.md) (one-command setup and global MCP routing).
>
> Boundary rule: this PRD adds a session-start sync loop for existing repos. It may refresh cache state, re-import hidden Card files, rematerialize Card freshness, and create or surface review work. It does NOT silently edit accepted Card bodies, accept candidate Cards, or promote provisional context into truth.

## Problem Statement

PRD-0038 made first setup much smoother, but recurring use still has a rough edge. A real user will come back to the same repo across many coding sessions. Between sessions, docs change, code changes, files are renamed, candidate inbox items accumulate, and accepted Cards may no longer match the chunks they were originally linked to.

Today the pieces exist, but the experience is not yet a single habit:

- `contexttrail setup quickstart` can be rerun, but it still feels like setup rather than session resume.
- `retrieve_context_pack` warns when indexed sources contexttrail, but the user still has to know which repair command to run.
- `contexttrail card import` rematerializes freshness, but it is not presented as part of a normal session-start ritual.
- Accepted Cards persist, but the user does not get a clear "these accepted Cards now need review" workflow when their linked chunks changed.
- Setup questions can guide the user, but they do not yet distinguish first-run setup questions from new questions caused by repo drift.

The product should feel like:

```text
open repo
sync the Ledger
answer only the new high-leverage questions
start coding with fresh context
```

The current product is close, but a user can still reasonably wonder whether they need to initialize again, rerun quickstart, re-answer setup questions, or manually inspect stale Cards after every repo change.

## Solution

Add a first-class **Ledger sync** workflow for recurring sessions.

The CLI command is:

```bash
contexttrail sync
```

The MCP tool is:

```text
sync_ledger
```

Both surfaces run the same deterministic sync engine:

1. Resolve the workspace and initialize local ContextTrail state if needed.
2. Detect stale doc sources, stale code sources, and missing indexed files.
3. Refresh stale sources and tombstone missing indexed state.
4. Re-import accepted Card files from the hidden repo-local Card directory.
5. Rematerialize Card freshness from linked chunk pins.
6. Report Card freshness transitions, especially newly `needs_review` Cards.
7. Recompute setup readiness and return only relevant next questions.

The sync engine treats ContextTrail state as three different layers:

| layer | sync behavior |
|---|---|
| cache | safe to refresh mechanically |
| inbox | safe to update or add provisional review work |
| accepted Cards | safe to re-import and mark `needs_review`; never silently rewrite accepted prose |

### What Should Feel Different

At the start of a normal session, an MCP-connected agent should call:

```text
sync_ledger
propose_setup_questions
retrieve_context_pack
```

If nothing meaningful changed, the user should not be interrupted. If source drift created new review work, the agent should ask targeted questions about that delta.

Example CLI output:

```text
ContextTrail sync

docs: 3 changed, 0 missing
code: 12 changed, 1 missing
cards: 18 imported, 3 newly need review
inbox: 7 pending candidate cards, 2 clarification needs

next:
- Review 3 accepted Cards marked needs_review.
- Answer 1 clarification caused by changed docs.
```

## User Stories

1. As a returning ContextTrail user, I want one session-start command, so that I do not repeat first-run setup.
2. As a returning ContextTrail user, I want changed docs to refresh the cache automatically during sync, so that retrieval does not use stale chunk bodies.
3. As a returning ContextTrail user, I want changed code-source metadata to refresh during sync, so that code-location retrieval does not surface stale files.
4. As a returning ContextTrail user, I want deleted or renamed indexed files to be tombstoned during sync, so that ghosts do not remain in retrieval.
5. As a maintainer, I want accepted Cards to survive sync unchanged, so that durable repo truth is never silently rewritten.
6. As a maintainer, I want accepted Cards whose linked chunks changed to become `needs_review`, so that stale truth becomes explicit review work.
7. As a maintainer, I want to see which Cards newly became `needs_review`, so that I can focus on fresh drift rather than old unresolved work.
8. As a maintainer, I want sync to re-import hidden Card files, so that Card edits made outside the cache are picked up on the next session.
9. As a maintainer, I want sync to preserve manual author review state, so that human verification is not erased by mechanical refresh.
10. As a pilot user, I want the agent to ask only new high-leverage questions after sync, so that every session does not feel like onboarding again.
11. As a pilot user, I want existing unresolved review work to remain visible, so that sync does not hide stale Cards just because they were already known.
12. As an MCP agent operator, I want `sync_ledger` to accept the same workspace argument as retrieval tools, so that global MCP mode works across repos.
13. As an MCP agent operator, I want `sync_ledger` to be safe on session start, so that agents can call it before coding.
14. As an MCP agent operator, I want the sync response to be compact, so that "is the repo fresh?" does not consume more context than manual checks.
15. As a CLI-first user, I want `contexttrail sync --check` to show what would change, so that I can inspect sync without writes.
16. As a CLI-first user, I want `contexttrail sync --json`, so that the session-start behavior is scriptable and testable.
17. As a cautious user, I want sync to report every write category, so that hidden cache mutation remains understandable.
18. As a cautious user, I want sync to avoid running candidate bootstrap by default, so that provisional work does not balloon every session.
19. As a maintainer, I want optional candidate refresh to update provisional inbox work after doc contexttrail, so that not-yet-accepted candidates can improve without touching accepted truth.
20. As a future contributor, I want sync planning and sync application separated, so that detection can be tested without filesystem mutation.
21. As a future contributor, I want Card freshness transitions reported as data, so that setup questions and UI surfaces can compose with the same result.
22. As a future contributor, I want sync to reuse existing import, index, Card import, and freshness modules, so that it does not become a parallel setup engine.
23. As a project maintainer, I want tests proving repeated sync is idempotent, so that recurring sessions stay boring when nothing changed.
24. As a project maintainer, I want tests proving accepted Card prose is unchanged by sync, so that the authority boundary remains protected.
25. As a project maintainer, I want docs to describe the session-start contract, so that users know when to run quickstart versus sync.

## Implementation Decisions

### Decision 1: Add a Ledger Sync Planner

Add a deep module that computes a sync plan without applying writes. The plan should report:

- workspace initialization state
- stale doc sources
- stale code sources
- missing indexed sources
- changed hidden Card files where detectable
- existing pending inbox counts
- existing Card freshness counts
- the actions sync would apply

This planner should reuse the existing freshness detector and storage read models rather than duplicating source scanning logic.

### Decision 2: Add a Ledger Sync Executor

Add a sync executor that consumes the plan and applies only deterministic repairs:

- initialize missing ContextTrail local state
- import stale or likely docs through the normal import path
- refresh code-source metadata through the normal code-source import path
- tombstone missing indexed state through the normal index path
- import hidden Card files through the normal Card import path
- rematerialize Card freshness through the existing freshness materializer

The executor should return before/after counters and Card freshness transitions. It should not directly edit accepted Card markdown bodies.

### Decision 3: Make `contexttrail sync` the Recurring Session Command

`contexttrail setup quickstart` remains the first-run command. `contexttrail sync` is the recurring command for already-used repos.

The CLI should support:

- default apply mode
- `--check` for plan-only output
- `--json` for structured output
- `--explain` for verbose details

### Decision 4: Add `sync_ledger` MCP Tool

Add an MCP tool that runs the same sync engine as the CLI. It should accept a workspace argument, return structured sync data, and present compact model-visible text.

Tool descriptions should tell agents to call `sync_ledger` at session start before setup questions and retrieval.

### Decision 5: Integrate Sync With Setup Questions

Setup questions should distinguish:

- first-run setup gaps
- recurring session drift
- newly stale accepted Cards
- old unresolved review work

Newly stale Cards should produce a high-priority review question. Existing stale Cards may be summarized without re-asking the same thing as if it were new.

### Decision 6: Keep Accepted Truth Read-Only During Sync

Sync may re-import accepted Cards and update materialized freshness columns. It must not rewrite accepted Card prose, silently verify Cards, accept candidate Cards, or convert provisional answers into authority.

If a Card needs substantive updating, sync should route the user to review or create provisional inbox work.

### Decision 7: Candidate Refresh Is Explicit

Refreshing provisional candidate Cards after source drift is useful, but it can create a lot of review churn. Candidate refresh should be explicit through a flag or follow-up question, not part of default sync.

### Decision 8: Sync Is Not a Watcher

This PRD adds a session-start command and MCP tool, not a background daemon. Continuous file watching remains a later quality-of-life feature.

## Testing Decisions

Tests should verify observable CLI and MCP behavior, not implementation details.

Required coverage:

1. Sync check reports stale docs, stale code sources, and missing indexed files without writes.
2. Sync apply refreshes changed docs and code-source metadata.
3. Sync apply tombstones missing indexed state.
4. Sync apply re-imports hidden Card files.
5. Sync apply rematerializes freshness and reports Cards newly marked `needs_review`.
6. Sync does not change accepted Card markdown bodies.
7. Sync preserves manual author review state.
8. Sync is idempotent when run twice without intervening changes.
9. `contexttrail sync --json` validates against the same shape used by MCP.
10. `sync_ledger` validates against MCP schema and accepts explicit workspace cwd.
11. `sync_ledger` returns compact model-visible text.
12. Setup questions prioritize newly stale accepted Cards after sync.
13. Setup questions do not repeat first-run import/bootstrap prompts when the repo is already ready.
14. Optional candidate refresh writes only provisional inbox items.
15. Existing quickstart, setup questions, retrieve freshness warnings, Card import, and freshness tests keep passing.

Useful prior art:

- PRD-0035 freshness detection and auto-reindex tests.
- PRD-0037 setup question planner and MCP schema tests.
- PRD-0038 quickstart tests.
- Card freshness materializer tests.
- Cold-install and MCP workspace routing tests.

## Acceptance

PRD is complete when:

1. A sync planner returns a deterministic plan for stale docs, stale code, missing indexed state, Card import state, Card freshness counts, and proposed actions.
2. A sync executor applies deterministic cache and freshness repairs without editing accepted Card prose.
3. `contexttrail sync` exists with default apply mode, `--check`, `--json`, and `--explain`.
4. `sync_ledger` MCP tool exists and shares the same sync engine as the CLI.
5. Sync reports newly stale accepted Cards separately from already-known stale Cards.
6. `propose_setup_questions` can route post-sync users to stale Card review without repeating first-run setup prompts.
7. Optional candidate refresh is explicit and writes only provisional inbox items.
8. README or CORE documents the session-start contract: quickstart first, sync thereafter.
9. Tests cover stale source refresh, missing-source tombstoning, Card freshness transitions, accepted Card immutability, idempotency, CLI/MCP schema validation, and setup-question integration.

## Out of Scope

- Continuous file watching.
- Background daemons.
- Silent accepted Card rewrites.
- Automatic candidate Card acceptance.
- Automatic stale Card verification.
- LLM-authored authoritative Card updates.
- Cross-repo synchronization.
- Git hook installation.
- CI enforcement of stale Card review.
- Perfect semantic change detection for code.
- Rename similarity detection beyond existing delete-then-add behavior.

## Risks

| risk | mitigation |
|---|---|
| Sync becomes "quickstart again" | Keep first-run setup and recurring sync as separate surfaces; sync asks only delta questions when possible. |
| Sync hides authority changes behind automation | Accepted Card prose stays read-only; freshness transitions are reported as review work. |
| Sync adds latency to every agent session | Make sync explicit at session start, compact in MCP output, and idempotent on clean repos. |
| Candidate refresh creates review noise | Keep candidate refresh opt-in and report provisional writes clearly. |
| Freshness transitions become noisy after harmless doc edits | Use existing linked chunk pins; only linked Card freshness changes create accepted Card review work. |
| Users ignore stale Cards if warnings repeat every session | Report newly stale separately from already-known stale Cards and route only new high-priority review questions by default. |

## Further Notes

PRD-0035 made stale state visible. PRD-0039 makes it recoverable as a normal session-start habit.

The desired mental model:

```text
quickstart is for first setup
sync is for every later session
accepted Cards are durable truth
freshness tells you when durable truth needs another look
```
