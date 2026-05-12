# ContextTrail

**Alpha.** Repo-local context retrieval for agentic coding. It imports your docs, scopes them to the task, and delivers a small, source-grounded Context Pack so the agent sees the right material without reading the whole repo.

**Stop dumping entire docs into your AI coding agent.**

ContextTrail is a repo-local context engine that retrieves the _exact slice_ of your existing documentation that an agent needs for a specific coding task — your company guidance, team norms, project specs, and module READMEs — and lets you layer hard-rule **Context Cards** on top so non-negotiables are always included.

The pain it solves:

> Real codebases have layered documentation — company guidelines, team conventions, project specs, ADRs, module READMEs. AI agents either miss critical context or get crushed trying to hold all of it at once. ContextTrail retrieves the right slice, scoped to the file/symbol/task at hand, and pins constraints so the agent can't quietly violate them.

Why it exists:

Most coding agents are only as good as the context they receive. If you paste an entire repo, the model may exceed its context window, bury the important rule under unrelated prose, or hallucinate from stale priors. If you paste too little, it misses the project-specific decision that matters.

ContextTrail sits in the middle. It builds a compact Context Pack, currently **6,000 tokens by default**, from the docs and code metadata already in your repo. The goal is not to summarize your project or replace human documentation. The goal is to hand the agent the smallest useful set of source-backed trails before it edits.

Use ContextTrail when:

- your repo has useful docs, ADRs, PRDs, runbooks, or module READMEs, but they are scattered
- your agent keeps missing project-specific conventions or architectural decisions
- your context window is precious and whole-doc loading is too expensive
- you want hard rules, such as security or money-handling constraints, to be locked into every relevant pack
- you want a local-first workflow that does not require an embedding model or API key for core retrieval

ContextTrail is **not** an answer engine. It is a context assembly layer. The agent still reasons, writes, and verifies; ContextTrail tries to make sure it starts from the right source material.

Two primitives:

- **Doc Chunk** — imported from your existing markdown docs. Indexed, scoped, ranked. The breadth.
- **Context Card** — curated constraint, symbol note, or evidence pointer authored by you. Structured, locked-include for hard rules. The control.

Both flow into a single **Context Pack** delivered to the agent via MCP before it edits code.

## What ContextTrail does

ContextTrail turns a repo's scattered written knowledge into a compact, ranked, source-backed packet of context for an AI coding agent.

In practice, it helps when:

- a repo has too much documentation to paste into a model directly
- a smaller context window needs only the most relevant docs, not the whole corpus
- architectural rules, security constraints, or product decisions live across ADRs, PRDs, READMEs, and runbooks
- an agent needs to start a task with evidence instead of guessing from its pretraining
- teams want a local-first retrieval layer that works before adding embeddings, remote services, or API keys

The default Context Pack target is **6,000 tokens**. That number is intentionally small: the point is to preserve room for the user's task, the agent's reasoning, code snippets, terminal output, and follow-up tool calls.

What ContextTrail returns:

- ranked source references from imported docs
- optional curated Context Cards for hard rules and project-specific constraints
- freshness warnings when indexed files changed or disappeared
- coverage/confidence signals so the caller can tell the difference between "use this" and "I do not have enough evidence"
- MCP tools that let agents fetch exact chunk/Card bodies only when needed

What ContextTrail does not do:

- it does not write code for the agent
- it does not prove the final answer is correct
- it does not silently turn weak matches into confident answers
- it does not require an LLM call for the core retrieval path

## Quick start

Three steps from a blank repo to assembled context in your agent:

```bash
# 1. Install (requires Node.js ≥ 20)
npm install -g contexttrail

# 2. Install the MCP server once at user level
contexttrail mcp install --client claude-code
contexttrail mcp doctor --client claude-code

# 3. Initialize this repo, import obvious docs, and see setup questions
cd ~/your-project
contexttrail setup quickstart
```

Supported installer clients today: `codex`, `claude-code`, `claude-desktop`, `cursor`, and `opencode`.

That's it. `contexttrail setup quickstart` is the first-run command. For later sessions in the same repo, use sync:

```bash
contexttrail sync
contexttrail sync --check
contexttrail sync --explain
```

`contexttrail sync` refreshes changed docs/code-source metadata, tombstones deleted indexed files, re-imports hidden accepted Cards, and rematerializes Card freshness. It does not rewrite accepted Card prose or accept provisional candidates. Candidate Card drafting is opt-in:

```bash
contexttrail setup quickstart --bootstrap-candidates
contexttrail sync --refresh-candidates
```

Those candidate commands write provisional review items into `.contexttrail/inbox/`; they do not create or edit accepted Cards.

For other agent harnesses (Claude Desktop, Cursor, Codex, Cline, Continue, Zed) see [the per-harness configs below](#wiring-contexttrail-into-your-agent-mcp).

## Agent-guided setup

If you are not sure what to do after quickstart, ask ContextTrail for the next setup questions:

```bash
contexttrail setup questions
contexttrail setup questions --json
```

The planner returns at most three questions, ranked by setup leverage: MCP wiring, missing imports, pending inbox review, card bootstrap, scope recovery, then context validation. To answer an operational question without running the command automatically:

```bash
contexttrail setup answer import-docs --choice docs_glob
```

MCP agents get the same flow through `sync_ledger`, `get_setup_readiness`, `propose_setup_questions`, and `answer_setup_question`. `sync_ledger` defaults to check mode over MCP; pass `check: false` only when the user wants writes. `answer_setup_question` previews operational commands and can answer clarification inbox items, but it does **not** accept candidate Cards, edit accepted Cards, or promote provisional context into truth. Card acceptance still goes through `contexttrail inbox accept`.

Agent startup contract:

1. At the start of a returning repo session, call `sync_ledger` with the repo `cwd`.
2. If sync reports stale or missing sources, apply it with `check: false` when the user/session policy allows writes.
3. Call `propose_setup_questions` with the repo `cwd`.
4. If questions are returned, present them to the user as multiple-choice prompts when the host UI supports it.
5. Apply setup answers through `answer_setup_question` or explicit CLI commands.
6. Only then call `retrieve_context_pack` for the coding task.

Persistence model:

- Imported Doc Chunks are stored in `.contexttrail/cache/contexttrail.db`.
- Provisional candidate Cards and clarification questions are stored in `.contexttrail/inbox/*.md`.
- Accepted Cards are stored in `.contexttrail/cards/*.md` and imported into the cache.
- `contexttrail setup quickstart` re-imports existing hidden Card files, so restarting ContextTrail or rerunning setup picks them back up.
- `contexttrail sync` is the recurring-session refresh that picks up hidden Card edits and marks linked Cards `needs_review` when their source chunks drift.

## Status

Working engine measured on **four layered evals**:

| metric                                                                                      | value     | what it measures                                                                    |
| ------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------- |
| Top-5 single-doc retrieval (174-case OSS panel)                                             | **96.0%** | "find the right doc" — across 13 corpora incl. valibot, biome, effect, hono, prisma |
| Workflow assembly — ContextTrail (23-ticket Linear panel)                                    | **95.7%** | "assemble every doc an engineer needs to start a real ticket"                       |
| Workflow assembly — valibot (15-ticket library-user panel, **untuned generalization test**) | **93.3%** | same metric on a corpus ContextTrail was never tuned against                         |
| Agent-completion source-file coverage (14 commit-grounded cases)                            | **93.9%** | "is the file the engineer needs to _edit_ in the pack"                              |

How to read those numbers:

- They measure whether the right source material appears in the pack, not whether an AI agent completes the coding task perfectly.
- The strongest current signal is Top-5 / Context Pack inclusion, because the product is designed to give the agent a small set of useful sources rather than pretend one document always contains the answer.
- The workflow numbers are promising, but still alpha-stage: the public claim is "high source coverage on current evals," not "solves every repo."
- The right expectation is that ContextTrail improves the agent's starting context and reduces hallucinated repo assumptions. The agent still has to inspect code, run tests, and make good changes.

## Honest Failure Behavior

ContextTrail is designed to fail closed when it cannot find enough evidence.

When retrieval is weak, it should surface that honestly through empty packs, low/uncertain coverage, or warnings instead of stuffing the budget with unrelated docs. Common cases:

- `no_sources`: nothing has been imported yet, so there is no corpus to search
- `no_matches`: sources exist, but the query does not match them strongly enough
- `signal_empty`: the query appears unsupported by the indexed corpus
- `stale_source` / `missing_source`: a previously indexed file changed or disappeared
- `locked_overflow`: always-include Cards exceeded the requested budget

That behavior is deliberate. A low-confidence or empty result is useful because it tells the agent to ask for anchors, broaden the search, import more docs, or inspect the repo directly instead of inventing an answer.

What's inside, in plain terms:

- **Retrieval** (BM25F + source-rerank + alias substrate + close-call tiebreakers) finds the right docs.
- **Markdown link traversal** walks `[text](path)` references — closes the foundational-chain gap on link-rich corpora (ContextTrail 95.7%).
- **Nav-graph traversal** (PRD-0027) walks vitepress / mkdocs / docusaurus nav structure, with a universal directory-grouping fallback — closes the same gap on framework-driven corpora (valibot 73.3% → 93.3%).
- **Code-source index** (PRD-0028) extracts paths + exported symbols + summary comments for `.ts` / `.js` (TypeScript compiler API), `.py` / `.go` / `.rs` (regex-based, no extra toolchain). `import` graph traversal (forward + reverse) brings the substrate files into the pack.

The core retrieval path is deterministic and ADR-clean. Optional setup-time LLM augmentation can help draft inbox candidates, but correctness never depends on an AI call.

**What is NOT yet proved.** Agent task success downstream of the pack (LLM-judge harness unbuilt), `signal_empty` recovery on real engineering queries, pack quality under token-budget pressure with traversal on, and pilot usage on a second commit-grounded codebase. The retrieval-engine-as-risk framing is closed; the product is not yet "done-done." See [docs/OPEN.md](docs/OPEN.md) for the honest gap list.

**Alpha note.** This repo is being validated in small cohorts first. Expect the CLI and MCP surfaces to work, but treat the product as evolving until the cohort and recovery benchmarks are fully widened.

## The product, in six verbs

```
docs → chunk → scope → index → retrieve → pack
```

That's it. Read [docs/CORE.md](docs/CORE.md) for the one-page version. Everything else is depth.

## The two rules

> **AI rule:** AI should not be required for correctness, but should be available for quality. v1's retrieval engine is deterministic; optional LLM bootstrap only drafts reviewable inbox items.

> **Authority rule:** ContextTrail never asks agents to trust ungrounded AI summaries. It routes agents to source-grounded context and clearly separates imported docs, accepted rules, candidates, and verified evidence.

## Documents

Read on demand:

| If you want to...                                             | Read                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| Understand what v1 is (start here)                            | [docs/CORE.md](docs/CORE.md)                                     |
| Start building week 1                                         | [docs/MVP.md](docs/MVP.md)                                       |
| Make a schema decision                                        | [docs/SCHEMA.md](docs/SCHEMA.md)                                 |
| Make an architectural choice that might affect future scaling | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                     |
| Look up why a specific decision was made                      | [docs/DESIGN.md](docs/DESIGN.md)                                 |
| Ideate on the next phase (post-v1)                            | [docs/VISION.md](docs/VISION.md), [docs/IDEAS.md](docs/IDEAS.md) |
| See unresolved items                                          | [docs/OPEN.md](docs/OPEN.md)                                     |
| See where this came from                                      | [docs/archive/](docs/archive/)                                   |

If you're not making a schema or scaling decision **and** you're not ideating, you don't need to read the deeper docs. They are _forward-compatibility notes_, not v1 requirements.

## ICP

Developers on documented codebases — TypeScript, Python, Go, or Rust — using Claude Code / Cursor / Codex, where important context is scattered across specs, ADRs, READMEs, team guidance, and module docs. The agent either misses critical context or gets crushed by too much of it. Code-source indexing supports `.ts` / `.tsx` / `.js` / `.jsx` (TypeScript compiler API), `.py` / `.go` / `.rs` (regex-based — no native toolchain required for any of them).

## Stack

Node.js + TypeScript, distributed via npm. MCP server primary, CLI fallback.

## Evaluation

Core commands:

```bash
npm run eval:retrieval
npm run eval:compression
npm run eval:assembly-pressure
```

What they mean:

- `eval:retrieval` is the contract gate
- `eval:compression` tests how smaller budgets affect the current fixture
- `eval:assembly-pressure` stress-tests the ranked pack under synthetic surrounding-context expansion

Current benchmark read:

- the engine is already very compact
- raw budget compression barely moves quality on the current fixture
- even the heavier assembly-pressure benchmark stays strong, which suggests the ranked surface is stable under much richer context expansion than we expected
- the next assembly step is structural, not semantic: parent sections, selective siblings, and linked neighbors on a narrow anchored-task slice

Reference docs:

- [Retrieval quality checklist](docs/evals/post-prd-0005-quality-checklist.md)
- [Week 5 context assembly groundwork](docs/plan/week-5-context-assembly-groundwork-2026-05.md)

## Wiring ContextTrail into your agent (MCP)

ContextTrail speaks the [Model Context Protocol](https://modelcontextprotocol.io/) over stdio. **The contract is universal: any MCP-aware agent harness over stdio works. Only the config file format differs across harnesses.**

The server is the same `contexttrail mcp` subprocess in every case. Prefer the installer when your client is supported:

```bash
contexttrail mcp install --client codex
contexttrail mcp install --client claude-code
contexttrail mcp install --client claude-desktop
contexttrail mcp install --client cursor
contexttrail mcp install --client opencode
```

Use `contexttrail mcp doctor --client <client>` to confirm the config exists and the `contexttrail` command resolves on the harness `PATH`.

The installer writes user-level config, so you do not have to edit MCP settings every time you change repos. ContextTrail tools accept an optional `cwd` field for global routing; project-local calls still work when no `cwd` is provided.

If your harness is not supported by the installer yet, pick the manual snippet below.

### Claude Code

User-level (applies to every project): edit `~/.claude.json`.

Project-level (applies only to this repo): create `.mcp.json` in the repo root.

```json
{
  "mcpServers": {
    "contexttrail": {
      "command": "contexttrail",
      "args": ["mcp"]
    }
  }
}
```

Restart Claude Code. The ContextTrail tools (`retrieve_context_pack`, `get_doc_chunk`, `get_card`, `list_context_sources`, `get_setup_readiness`, `propose_setup_questions`, `answer_setup_question`, `sync_ledger`) appear in the MCP panel.

`retrieve_context_pack` is token-disciplined on the MCP wire: the model-visible
tool text is a compact ranked reference list. Exact chunk and Card bodies remain
available through structured output and follow-up `get_doc_chunk` / `get_card`
calls, so agents can fetch only the sources they actually use.

### Claude Desktop

Edit `claude_desktop_config.json` (location depends on OS — see [Anthropic's docs](https://modelcontextprotocol.io/quickstart/user)):

```json
{
  "mcpServers": {
    "contexttrail": {
      "command": "contexttrail",
      "args": ["mcp"]
    }
  }
}
```

Restart Claude Desktop.

### Cursor

User-level: `~/.cursor/mcp.json`. Project-level: `.cursor/mcp.json` in the repo root.

```json
{
  "mcpServers": {
    "contexttrail": {
      "command": "contexttrail",
      "args": ["mcp"]
    }
  }
}
```

Restart Cursor (or toggle the MCP server off/on in Settings → MCP).

### Codex CLI

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.contexttrail]
command = "contexttrail"
args = ["mcp"]
```

Restart Codex.

### Other MCP-aware harnesses

### OpenCode

User-level: `~/.config/opencode/opencode.json`. Project-level: `opencode.json` in the repo root.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "contexttrail": {
      "type": "local",
      "command": ["contexttrail", "mcp"]
    }
  }
}
```

Restart OpenCode, or run `opencode mcp list` to inspect the configured server.

### Other stdio MCP harnesses

Continue.dev, Cline, Zed, and any other MCP client that supports stdio servers will work — consult the harness's docs for where its MCP server config lives. The fields are usually the same shape: command `contexttrail`, args `["mcp"]`. If `contexttrail` is not on the harness's `PATH`, use the absolute path to the binary (or `npx contexttrail mcp`).

Pi does not currently ship MCP in core. ContextTrail can still work there if the user installs or writes a Pi extension/package that launches stdio MCP servers; until then, there is no safe config file for `contexttrail mcp install` to edit.

### Performance

Typical retrieval target: **≤2 seconds** end-to-end on a repo with a few hundred Doc Chunks and a few dozen Cards. If you see consistently slower retrieval, check that you ran `contexttrail index` after large doc edits (the cache may be stale).

ContextTrail does **not** auto-watch the filesystem. Every `retrieve_context_pack` call runs a pre-assembly freshness check and emits a `stale_source` / `missing_source` warning in the Context Pack when an indexed file has changed or been deleted without a fresh `contexttrail import` / `contexttrail index`. Set `CONTEXTTRAIL_RETRIEVAL_AUTO_REINDEX=true` to opt into inline reindex of the stale set before assembly — trade-off is latency stops being predictable on stale corpora.

### Troubleshooting

These are harness-agnostic — they apply whether you're on Claude Code, Cursor, Codex, or anything else.

**Server didn't start.** The harness shows ContextTrail as failed/disconnected.

- Check `contexttrail mcp` runs from the same shell the harness uses: `contexttrail mcp` should hang waiting for input on stdin (that's correct — it's listening for MCP messages). Type `<Ctrl-C>` to exit.
- If `contexttrail: command not found`, the binary isn't on `PATH`. Either run `npm install -g contexttrail`, or use the absolute path / `npx contexttrail mcp` form.

**No tools listed.** The server connected but `tools/list` returns nothing.

- Verify the server name in your config matches what the harness expects.
- Some harnesses require an explicit "enable" toggle for newly-added MCP servers; check the MCP panel for a disabled state.

**Retrieval returned `no_sources`.** Tools listed and callable, but every `retrieve_context_pack` call returns an empty pack with `warnings: [{ kind: "no_sources" }]`.

- ContextTrail needs `contexttrail import docs <glob>` to populate the cache. The agent has no docs to retrieve from. Run `contexttrail import docs/**/*.md` (or whatever your docs glob is) from the repo root, then retry.

**Retrieval returned `no_matches`.** Tools work, sources exist, but every call returns an empty pack with `warnings: [{ kind: "no_matches" }]`.

- The query doesn't match the imported corpus. Try a broader budget (`budget: "large"`), passing relevant `files`/`symbols` as anchors, or rephrasing the task.
- If a Card was supposed to lock for this query, check `contexttrail card list` and confirm its scope matches the request scope (constraints lock hierarchically-down per [D38](docs/DESIGN.md#d38-constraint-locked-include-hierarchical-down-scope-match); symbol_notes need strict anchor equality per [D39](docs/DESIGN.md#d39-symbol_note-locked-include-strict-anchor-equality)).

**Retrieval returned `locked_overflow`.** The pack shipped, but `budget.locked_overhead > 0` and a `locked_overflow` warning fired.

- Locked Cards exceeded the requested budget. Either increase the budget (`budget: "large"`) or trim the locked Cards (split a long constraint into multiple narrower ones, scoped more tightly).

## License

MIT. See [LICENSE](LICENSE).
