# ContextTrail MVP — 4-Week Build Plan

## Hypothesis to validate

> Agents perform meaningfully better on coding tasks when they receive a small, scoped Context Pack of accepted constraints and symbol notes before editing, vs. their default context.

That is the only thing v1 needs to prove. Everything else (bootstrap richness, drift detection, orchestration, decision cards, embeddings, LLM rerank, propose-loop) is downstream and explicitly deferred.

## Dogfood target

ContextTrail itself. As we build the TypeScript codebase, we accumulate real constraints (MCP tool input validation, card schema invariants, retrieval ranking rules), symbol notes, and evidence. We are both author and validator — weaker than dogfooding on a third-party codebase but honest enough for a first signal.

## Stack

- Node.js + TypeScript
- `@modelcontextprotocol/sdk` for MCP server
- `gray-matter` for card frontmatter
- `zod` for validation
- `better-sqlite3` for the rebuildable cache
- `commander` or `yargs` for CLI
- `vitest` for tests
- `tsup` or `unbuild` for packaging
- Distributed via npm (`npm i -g contexttrail`)

`ts-morph` is **not** in v1 — symbol extraction is a week-5+ concern (bootstrap).

## Card types in v1

Only three:

- `constraint` — "thou shalt not" rules
- `symbol_note` — local implementation knowledge tied to one symbol
- `evidence` — a command to verify behavior (test, static check)

Deferred: `requirement`, `decision`, `feature_intent`, `conversation_fragment`. See [VISION.md](VISION.md) for the full taxonomy.

## Week-by-week

### Week 1 — Markdown cards + manual authoring

**Goal:** Create accepted context manually and index it.

Build:

```
contexttrail init
contexttrail card add
contexttrail card list
contexttrail index
```

Storage:
- `.contexttrail/cards/**/*.md` — markdown source of truth (committed)
- `.contexttrail/cache/contexttrail.db` — rebuildable SQLite index (gitignored)
- `.contexttrail/config.yaml` — committed

No MCP, no retrieval, no lifecycle, no bootstrap, no embeddings, no LLM.

**Success criterion:** Author 10–20 accepted cards covering one active domain of ContextTrail itself.

### Week 2 — Deterministic retrieval + CLI

**Goal:** Given a task/files/symbols, return the right small Context Pack.

Build:

```
contexttrail context "task description" --files <paths> --symbols <names> --json
```

Retrieval signals:
- Exact symbol match
- File match
- Keyword match
- Card type priority
- **Constraint guaranteed-include** (matching accepted constraints are locked must_read)
- **Exact symbol_note guaranteed-include** (notes for an exact symbol in scope are locked must_read)
- Evidence linked to included cards is auto-attached

Output:

```json
{
  "must_read": [],
  "should_read": [],
  "evidence": [],
  "warnings": [],
  "omitted": [],
  "coverage": { "status": "partial", "missing": [] }
}
```

No LLM rerank. No embeddings. No graph sophistication.

**Success criterion:** For 5 real coding tasks against the ContextTrail codebase, the CLI returns a useful pack of ≤8 core cards.

### Week 3 — MCP server (read-only)

**Goal:** Agents retrieve Context Packs natively via MCP.

Build MCP tools:

- `retrieve_context_pack` — same shape as the CLI
- `get_card` — fetch one card by id
- `list_cards_for_scope` — all cards whose scope intersects given files/symbols

Read-only. No `propose_card`, no `accept_card`, no writes of any kind.

**Success criterion:** Claude Code can call `retrieve_context_pack` before editing ContextTrail source and the call returns a sensible pack.

### Week 4 — Dogfood + minimal lifecycle

**Goal:** Prove context actually changes agent behavior.

Build only the minimum lifecycle needed to keep cards honest:

```
contexttrail card mark-needs-review <id>
contexttrail card verify <id>
```

Skip AST fingerprinting unless retrieval is already clearly working. Manual `mark-needs-review` is fine for week 4.

Add lightweight retrieval logging:

```
.contexttrail/cache/retrieval-log.jsonl
  - timestamp
  - task
  - files / symbols
  - cards returned
  - agent_used_card (annotated post-hoc)
  - outcome (annotated post-hoc)
```

**Success criterion:**
> ≥3 specific moments in the dogfood week where the agent acted on a Context Pack card and avoided a mistake it would have made without it.

If yes → expand to week 5+. If no → revisit the hypothesis.

## What is explicitly cut from v1

- LLM bootstrap extraction
- LLM rerank
- Embeddings (deterministic only)
- Decision, feature_intent, requirement, conversation_fragment cards
- `propose_card` MCP tool — agents are read-only in v1
- AST fingerprint–based staleness detection
- Python or any non-TypeScript language support
- Multi-repo / monorepo handling
- Authority filtering modes (planning / audit)
- Evidence execution / pass-fail tracking
- Polished git workflow / branching
- A website, install docs beyond a README, examples gallery

## Week 5 priority (post-MVP, named now)

**Deterministic bootstrap (Tier 1).** This is the OSS-adoption killer feature — without it, strangers who `npm install` see an empty graph and bounce. Week 5 builds:
- ts-morph–based symbol/route extraction
- Test-name → requirement/evidence candidate generation
- Schema (Prisma / Drizzle / Zod) → constraint candidate generation
- Docstring/comment heuristic extraction (regex/pattern, no LLM)
- `contexttrail inbox` triage CLI

See [VISION.md](VISION.md) for the full bootstrap source list.
