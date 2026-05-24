# PRD-0038: One-Time MCP Install and One-Command Setup

> Source-of-truth canonical doc. Intended to be mirrored to Linear as the project's thirty-eighth PRD issue.
>
> Glossary: [docs/CONTEXT.md](../CONTEXT.md). Governing ADRs: [ADR-0001](../adr/0001-wizard-a-deterministic-setup-only.md), [ADR-0014](../adr/0014-agent-assisted-setup-without-truth-promotion.md), [ADR-0022](../adr/0022-setup-readiness-policy.md). Predecessor PRDs: [PRD-0033](0033-setup-readiness-scan-and-confidence-report.md) (setup readiness), [PRD-0036](0036-phase-0-exit-fixes.md) (pilot setup fixes), [PRD-0037](0037-agent-assisted-setup-conversation.md) (agent-assisted setup questions).
>
> Boundary rule: this PRD removes setup friction. It may install MCP config, route MCP calls to a workspace, initialize local ContextTrail state, import deterministic docs, and write provisional inbox items when explicitly requested. It does NOT let agents accept Cards, edit accepted Cards, or promote candidate context into truth.

## Problem Statement

PRD-0037 made setup conversational, but the first-run experience still has two adoption-killing seams.

First, MCP wiring is too repo-specific. Today a user may need to add or edit MCP configuration every time they move to another repo. That makes ContextTrail feel like a per-project integration chore instead of an installed developer tool. A user should be able to install ContextTrail's MCP server once at user scope and use it from any repo.

Second, repo setup still feels too much like a command recipe. A new user has to know which sequence matters: initialize, import docs, check readiness, maybe bootstrap candidates, inspect inbox, then validate context. The agent can now ask setup questions, but the CLI still exposes the setup path as several separate commands.

The product promise should be:

```text
install ContextTrail once
open any repo
run one safe setup command, or let the agent guide the same flow
start asking for context
```

The current product is close, but not yet that smooth.

## Solution

Add two setup simplification layers:

1. **One-time MCP install** — a user-level installer writes or updates MCP client configuration once. The installed server can serve multiple repos by resolving a workspace per request.
2. **One-command safe setup** — a repo-level setup command performs the deterministic, non-authoritative first-run work in one pass and then hands off to setup questions for any remaining decisions.

The intended happy path:

```bash
contexttrail mcp install --client codex
cd ~/some-repo
contexttrail setup quickstart
```

Then, inside an MCP-connected agent:

```text
Call propose_setup_questions with the repo cwd.
Ask the user the highest-leverage question.
Call answer_setup_question with the explicit answer.
Never accept Cards directly.
```

### What Should Feel Different

The user should not have to remember whether `.mcp.json`, `~/.codex/config.toml`, Cursor user settings, or Claude Code project settings are the right file for this repo. ContextTrail should know the supported client config locations and write the correct user-level snippet with backup / no-clobber behavior.

The user should also not need to run three or four terminal commands before setup can say something useful. `contexttrail setup quickstart` should get the repo into the first useful state, then print the remaining setup questions or validation command.

## User Stories

1. As a new ContextTrail user, I want to install the MCP server once, so that I do not edit MCP config for every repo.
2. As a user with multiple repos, I want ContextTrail MCP calls to target the repo I am currently working in, so that one global server can support many workspaces.
3. As a Codex user, I want `contexttrail mcp install --client codex` to write the correct user-level config, so that I do not hand-edit TOML.
4. As a Claude Code user, I want a supported install command for user-level and project-level config, so that I can pick the right scope intentionally.
5. As a Cursor user, I want ContextTrail to support the user-level MCP config path, so that I do not need a repo-local config file.
6. As a cautious user, I want MCP install to avoid clobbering existing MCP servers, so that ContextTrail does not break my other tools.
7. As a cautious user, I want MCP install to create a backup or print an exact diff before destructive changes, so that setup is reversible.
8. As a user whose global config already has ContextTrail, I want install to be idempotent, so that rerunning it is safe.
9. As a user whose shell PATH differs from the agent PATH, I want MCP install or doctor to detect whether `contexttrail` is executable, so that the client does not fail mysteriously.
10. As a user setting up a fresh repo, I want one command to initialize ContextTrail state, so that I do not need to remember `contexttrail init`.
11. As a user with normal markdown docs, I want one command to import likely docs, so that I get to readiness faster.
12. As a user with unusual docs layout, I want quickstart to show what it intends to import before or while doing safe work, so that I can correct bad assumptions.
13. As a user with an already-initialized repo, I want quickstart to be idempotent, so that it can be rerun after docs change.
14. As a user with low card coverage, I want quickstart to optionally generate provisional inbox candidates, so that I can get to review without memorizing `contexttrail card bootstrap`.
15. As a maintainer, I want candidate generation to remain provisional, so that quickstart never creates accepted Cards.
16. As a maintainer, I want quickstart to never edit accepted Cards or accepted truth, so that the trust model remains intact.
17. As an agent operator, I want every MCP setup tool to accept a repo workspace argument, so that global MCP mode is reliable.
18. As an agent operator, I want missing workspace errors to explain how to pass cwd or run project-local mode, so that failures are actionable.
19. As a future contributor, I want workspace resolution to live behind a small module, so that MCP handlers do not each grow bespoke path logic.
20. As a future contributor, I want MCP client install logic to live behind a small module, so that adding another client is a data/config addition, not a copy-paste command.
21. As a documentation reader, I want the README quick start to show the simple path first, so that the advanced per-client snippets become fallback reference.
22. As a pilot user, I want a doctor command to verify global MCP install and repo readiness, so that I can diagnose setup without knowing internals.
23. As a CLI-first user, I want the same setup simplification without MCP, so that ContextTrail still works in terminal-only workflows.
24. As a project maintainer, I want tests proving global MCP and project-local MCP both work, so that simplification does not regress existing users.

## Implementation Decisions

1. Add a user-level MCP install command with explicit client selection.

   Supported initial clients should include Codex, Claude Code, Claude Desktop, and Cursor. The installer should know the default user-level config path and config shape for each supported client. Unsupported clients should receive a clear manual snippet instead of a broken write.

2. Keep project-local MCP as a fallback, but stop presenting it as the primary path.

   Existing project-local MCP config remains useful for clients or teams that prefer repo-scoped config. The docs and setup flow should lead with user-level install, then describe project-level config as an advanced fallback.

3. Add workspace-aware MCP routing.

   Global MCP mode needs a way for each request to identify the target repo. The backwards-compatible path is to add an optional `cwd` / workspace field to MCP tool inputs and resolve all repo-local config, database, and filesystem reads through that workspace. If no workspace is provided, the server may fall back to its process cwd for project-local mode.

4. Centralize workspace resolution.

   Workspace validation should live behind a small module that can answer: resolved cwd, whether ContextTrail is initialized there, cache path, and actionable error hints. MCP handlers should not duplicate this logic.

5. Add a safe repo quickstart command.

   The quickstart command should be idempotent and deterministic. It should ensure local ContextTrail directories/cache exist, import likely markdown docs, run setup readiness, and print the remaining setup questions. It may optionally generate provisional inbox candidates behind an explicit flag.

6. Do not make quickstart accept truth.

   Quickstart may write cache state, config scaffolding, and provisional inbox review items. It must not write accepted Cards from candidates, edit accepted Cards, or mark candidate context authoritative.

7. Add install / setup doctor behavior.

   A doctor command should check: whether the chosen MCP client config contains ContextTrail, whether the configured command is executable, whether a workspace is initialized, whether docs are imported, and what the next setup question is.

8. Preserve PRD-0037 setup conversation.

   `propose_setup_questions` and `answer_setup_question` remain the agent conversation surface. PRD-0038 makes them easier to reach from any repo and gives users a one-command local bootstrap before the conversation.

9. Make all simplification additive and backwards-compatible where possible.

   Existing `contexttrail mcp`, `contexttrail init`, `contexttrail setup`, `contexttrail import`, `contexttrail card bootstrap`, and project-local MCP configs should continue to work unless explicitly deprecated in a later PRD.

## Testing Decisions

Tests should verify external behavior through CLI and MCP boundaries, not internal helper structure.

Required coverage:

1. MCP install writes the expected user-level config for at least Codex without clobbering existing config.
2. MCP install is idempotent when ContextTrail is already present.
3. MCP install reports a useful error or preview for unsupported clients.
4. MCP doctor detects a missing or non-executable `contexttrail` command in the configured client entry.
5. Global MCP mode can call a read tool against an explicit workspace cwd.
6. Global MCP mode returns an actionable error when no workspace can be resolved.
7. Project-local MCP mode still works with no explicit workspace argument.
8. `contexttrail setup quickstart` initializes an empty repo and runs setup readiness.
9. `contexttrail setup quickstart` imports likely markdown docs through real import paths.
10. `contexttrail setup quickstart` is idempotent on a rerun.
11. Candidate bootstrap from quickstart is opt-in and writes only provisional inbox items.
12. Quickstart never creates accepted Cards.
13. Setup questions still cap and rank correctly after quickstart.
14. README or quick-start docs describe one-time MCP install before project-local fallback.

Useful prior art:

- PRD-0033 setup readiness tests for repo-level readiness.
- PRD-0037 setup question tests for CLI/MCP equivalence and authority boundaries.
- Cold-install MCP subprocess tests for real MCP client wiring.
- Config init tests for no-clobber filesystem writes.

## Out of Scope

- Auto-detecting every MCP client on every operating system.
- GUI installers.
- Continuous background repo watching.
- Accepting candidate Cards automatically.
- Editing accepted Cards from MCP.
- LLM-generated setup questions.
- Automatically importing private external docs outside the repo.
- Solving multi-repo monorepo semantics beyond explicit workspace selection.
- Removing project-local MCP config support.

## Further Notes

This PRD is the natural follow-up to PRD-0037. PRD-0037 made setup ask better questions. PRD-0038 makes it easier to reach those questions without knowing how MCP config and first-run command sequencing work.

The north star is simple:

```text
Install ContextTrail once. Open any repo. Let setup guide itself.
```
