# ContextTrail — Long-Term Product Vision

This document records the full product ContextTrail could grow into. The [MVP](MVP.md) deliberately ships a small slice; this is what the slice grows into.

The MVP validates one hypothesis: *do scoped Context Packs improve agent behavior?* The vision answers: *if yes, what does the fully furnished product look like?*

---

## Product framing

ContextTrail is **not** a drift detector. It is a **structured intent / context engine for AI software development**.

The core promise:

> Capture intent → structure it → retrieve the exact context needed for a specific agent task.

Three downstream applications fall out of the substrate:

```text
context engine → drift detection
context engine → agent orchestration
context engine → better code generation
context engine → better ticket execution
```

The integrity-layer pitch (the original framing) and the orchestration-layer pitch (the longer-term ambition) both depend on the context engine being real first.

---

## Three pitches, three time horizons

| Horizon | Pitch | Audience |
|---|---|---|
| Now (v1) | "Tell your AI agent what not to break." | Solo TypeScript devs |
| 6–12 mo | "Your team's coding rules, retrievable by AI agents." | Small AI-native teams (2–10 devs) |
| 12+ mo | "Shared memory layer for multi-agent coding." | Teams running parallel agents |

Each later pitch only earns the right to exist if the earlier one has real users.

---

## The seven Context Card types

V1 ships only `constraint`, `symbol_note`, and `evidence`. The full taxonomy:

### 1. Requirement

What the system must do. Behavioral claim.

```yaml
id: R17
type: requirement
title: Canceling paid order triggers refund
```

### 2. Decision

Why something is designed a certain way. Historical rationale.

```yaml
id: D04
type: decision
title: Refunds are async
body: Refund creation is queued because provider latency can exceed request timeout limits.
```

Critical for preventing agents from "simplifying" intentional complexity.

### 3. Constraint

What must not be violated. The "thou shalt not" layer.

```yaml
id: C09
type: constraint
title: Refunds require audit logging
```

Constraints get a **guaranteed-include path** in retrieval — they cannot be ranked out by an LLM if their scope matches.

### 4. Symbol note

Local implementation knowledge tied to one symbol.

```yaml
id: S22
type: symbol_note
title: RefundService.processRefund idempotency
symbols: [RefundService.processRefund]
```

Likely the highest-value card type for coding agents.

### 5. Feature intent

Multi-step flow / feature overview. Helps agents avoid tunnel vision.

```yaml
id: F03
type: feature_intent
title: Checkout cancellation flow
```

### 6. Evidence

How behavior is verified. Test, static check, contract check.

```yaml
id: E11
type: evidence
title: Refund cancellation test
command: npm test -- refund-cancel.test.ts
```

### 7. Conversation fragment

Useful prior discussion not yet formalized. Always `candidate` authority by default — never silently authoritative.

---

## Authority levels

| Level | Source | Used in retrieval? |
|---|---|---|
| `accepted` | Human-authored or human-confirmed | Yes (default) |
| `candidate` | Machine-generated, awaiting review | Only if `--include-candidates` or planning mode |
| `deprecated` | Human-marked obsolete | Excluded by default |

LLMs may suggest links, draft cards, summarize — but **LLM output never becomes `accepted` truth without human confirmation**.

---

## Freshness states

Beyond a simple `stale` boolean:

| State | Meaning |
|---|---|
| `verified` | Confirmed against current relevant code |
| `unverified` | Accepted but no current evidence/confirmation |
| `needs_review` | Linked meaningful/high-risk change likely affects this card |
| `maybe_affected` | Related change may affect card (lower confidence) |
| `potentially_superseded` | Decision-only — code/newer card may contradict historical rationale |
| `deprecated` | Human marked obsolete |

### Per-type lifecycle rules

- **Constraints**: meaningful linked change → `needs_review`. Healed by passing evidence or human confirm.
- **Symbol notes**: meaningful linked symbol change → `needs_review`.
- **Requirements**: high-risk change → `needs_review`. Meaningful change → `maybe_affected`.
- **Decisions**: never auto-stale. Contradictory code → `potentially_superseded`. Only humans deprecate.
- **Feature intent**: major flow entrypoint change → `needs_review`. Local change → `maybe_affected`.
- **Evidence**: covered surface changed → `stale_until_run`. Passing command at current SHA → `verified`.
- **Conversation fragments**: never authoritative; can be archived.

No TTL-based decay in v1 or vision. Time does not change truth.

---

## Cold-start: `contexttrail bootstrap`

The cold-start problem is existential. A new user with an empty graph has zero value. Bootstrap creates **candidate cards** from existing project residue.

### Bootstrap source priority

**Tier 1 — deterministic, no LLM (build first):**
- Code structure (files, modules, exports, classes, functions)
- Comments and docstrings
- Tests (names, describe blocks, commands)
- Schemas / types (Prisma, Drizzle, Zod, SQL migrations, OpenAPI, GraphQL, TS interfaces)
- Routes / API surfaces
- Docs (README, ADRs, markdown)
- Assertions and error messages (`throw`, `assert`, guard clauses)
- Config and environment files

**Tier 2 — LLM-assisted, optional (later):**
- Commit message interpretation
- Freeform prose summarization
- Conversation/ticket import
- Card body rewriting and deduplication

### The first 30 minutes

```
contexttrail init
contexttrail bootstrap --scope src/payments/**
contexttrail inbox          # triage 30+ candidates
drift accept <ids>
contexttrail context "task" --files X --symbols Y    # first Context Pack
```

User's first job is **triage**, not authoring.

---

## Storage model

**Markdown source-of-truth + SQLite cache.** This is non-negotiable architecture.

```
.contexttrail/
  cards/
    requirements/      # R001-*.md
    decisions/         # D001-*.md
    constraints/       # C001-*.md
    symbol-notes/      # S001-*.md
    evidence/          # E001-*.md
    candidates/        # X001-*.md (shared candidates)
  links/
    symbol-links.yaml  # accepted links if not in card frontmatter
  config.yaml
  cache/               # gitignored
    contexttrail.db
    embeddings/
  local/               # gitignored
    candidates/        # bootstrap spam, agent proposals pending review
    suggested-links.yaml
```

`.gitignore`:

```
.contexttrail/cache/
.contexttrail/local/
```

Why markdown:
- Diffable, reviewable, mergeable, portable
- Agents and humans can read without ContextTrail installed
- Acceptance is a real git change ("project knowledge becoming durable")
- One card per file → small merge-conflict surface

Why SQLite cache:
- Fast retrieval queries
- Rebuildable from markdown — never the source of truth
- Can be deleted and `contexttrail index` recovers everything

See [SCHEMA.md](SCHEMA.md) for exact frontmatter.

---

## Retrieval architecture

### Pipeline

```
1. Parse task (text + files + symbols + mode)
2. Hard scope filter (drop obvious non-matches)
3. Guaranteed include:
   - Accepted constraints whose scope overlaps
   - Accepted symbol_notes for exact-symbol matches
   - Stale overlapping cards → warnings (visible, not hidden)
4. Candidate expansion (~40–80 cards):
   - 1-hop graph walk
   - Embedding top-K (if available)
   - Feature/domain overlap
   - Linked evidence
5. Authority filter (accepted only by default)
6. Deterministic scoring (explainable)
7. Optional LLM rerank (agent mode default; --rerank for humans)
8. Context budget packing
9. Output Context Pack with why_included reasons
```

### Locks the LLM cannot override

- Accepted constraints with scope overlap → `must_read` (locked)
- Exact accepted symbol_notes → `must_read` (locked)
- Stale overlapping cards → `warnings` (locked, never silently dropped)

### Modes

| Mode | Default cards |
|---|---|
| `implementation` | Accepted only |
| `planning` | Accepted + candidates |
| `audit` | Accepted + stale + candidates + conflicts |

### Capability tiers

| Tier | Requires | Provides |
|---|---|---|
| `local-basic` | Nothing (default) | Deterministic structural retrieval, keyword, scope, constraint guarantee |
| `local-enhanced` | Tiny local embedding model (~25–100 MB, opt-in) | Semantic similarity, fuzzy task matching |
| `cloud-enhanced` | Anthropic / OpenAI API key (opt-in) | Better extraction, LLM rerank |

**No API key, no model download, still useful** is the contract.

---

## Agent interface

### MCP-first

Primary surface is an MCP server. CLI is fallback + human-facing.

#### Read tools (always available)

- `retrieve_context_pack`
- `get_card`
- `list_cards_for_scope`
- `list_warnings_for_scope`
- `explain_retrieval`

#### Candidate write tools (post-v1, before authoritative writes)

- `propose_card`
- `propose_link`
- `propose_evidence`
- `propose_card_update`
- `mark_context_gap` — agent says "I needed context here and didn't find it"

All proposals land in `.contexttrail/local/inbox/` (or shared if configured) as candidates.

#### Authoritative writes (not exposed to agents in v1 or v2)

- `accept_card`, `edit_accepted_card`, `mark_verified`, `deprecate_card`, `delete_card`

These remain human-only via CLI.

### Permission model

```yaml
mcp:
  tools:
    read: true
    propose: true              # post-v1
    authoritative_write: false # never default
```

Principle: **Agents contribute hypotheses. Humans promote truth.**

---

## CLI surface (full vision)

```bash
# Setup
contexttrail init
contexttrail scope add <pattern>
contexttrail bootstrap [--scope X]

# Cards
contexttrail card add
contexttrail card list
contexttrail card show <id>
contexttrail inbox
drift accept <id>
drift reject <id>
drift edit <id>
drift merge <id> <id>

# Retrieval
contexttrail context "task" --files X --symbols Y
drift warnings --files X
contexttrail explain <pack-or-card>

# Lifecycle
contexttrail index
contexttrail card mark-needs-review <id>
contexttrail card verify <id>
drift evidence run <id>
drift evidence run --affected
drift decision supersede <old> --with <new>

# Diagnostics
contexttrail doctor
contexttrail setup llm
contexttrail setup embeddings
```

---

## The capture loop (orchestration substrate)

This is the second hypothesis after MVP validation:

```
1. Agent retrieves Context Pack before task
2. Agent does work, observes new constraints/notes
3. Agent calls propose_card with what it learned
4. Candidate lands in human inbox
5. Human accepts/edits/rejects
6. Graph improves; next agent task gets richer context
```

This is the seed of the orchestration layer. Closed-loop context capture during real agent work is what makes parallel agent execution viable later.

---

## Distribution and ambition path

**Now:** OSS dev tool on npm. README hook: *"Tell your AI coding agent what not to break."* Single ICP: solo TypeScript developer using Claude Code / Cursor / Codex.

**6–12 months (if traction):** Team-mode features — shared candidate workflows, GitHub PR integration for card review, CI hook that fails when changes touch unverified critical constraints.

**12+ months (if commercial validates):** Hosted layer for multi-repo / multi-agent context sharing. Orchestration features: dispatch agents based on detected drift, parallel agent coordination via shared context, team analytics on context coverage.

The hosted layer is **never required**. Local-first is permanent.

---

## What this product is not

- Not a drift detector. Drift detection is a feature of the context engine.
- Not a CI tool. It runs locally first; CI is a possible later integration.
- Not a documentation system. Cards are operational context for agents, not human reference docs.
- Not a replacement for tests. Evidence cards point at tests; they do not replace them.
- Not an LLM wrapper. LLM features are optional accelerators, not the core.
- Not a requirements management tool. Requirement cards exist but are one of seven types and not the headliner.

---

## Falsification criteria

The product should be killed or redesigned if, after sustained dogfood and one external alpha:

- Agents do not measurably behave better with Context Packs vs. without
- Manually authoring cards feels worse than writing tests or comments
- Bootstrap candidates are mostly noise after Tier 1 implementation
- Users stop checking the inbox within 2 weeks
- Most "warnings" are obvious or irrelevant
- Setup takes more than 5 minutes for a useful first pack

---

## Foundational architecture: what scales into the bigger vision

ContextTrail v1 is a standalone product (docs-first context engine + cards overlay). The longer vision is **drift detection** and **multi-agent orchestration** built *on top of* the same substrate. For that to work, the v1 architecture has to be a real foundation, not a dead-end.

This section names what extends naturally, what needs real new architecture later, and what cheap "leave room for" decisions to make in v1.

### What extends naturally (forward-compatible by design)

| Design choice | Extends to |
|---|---|
| Markdown source + SQLite cache (D5) | New entity types are new file types — `tasks/`, `agent_runs/`, `dispatch_events/`. Same model. Git versions all of it. |
| MCP tool surface (D8) | Adding tools is non-breaking. `dispatch_task`, `claim_task`, `report_completion`, `query_drift_state` slot in alongside existing tools. |
| Two-primitive → N-primitive model (D15) | Cards + Chunks today. `+ Task`, `+ AgentRun`, `+ DispatchEvent`, `+ DriftSignal` later. Same retrieval pipeline, more types in the ranker. |
| Scope hierarchy (D17) | `company > team > project > module > symbol` is *already* designed for cross-repo. The schema doesn't change; storage location does. |
| Stable_key + version_id identity (D19) | Versioned identity is exactly what audit trails for orchestration need. Trivially extends to "the chunk version agent X saw at time T." |
| Card lifecycle states (D7, D19) | `verified / needs_review / potentially_superseded` is exactly the state machine drift detection needs. Drift detection is *additive*. |
| Locked-first packing (D18) | "Guarantee these things are in the agent's context, no matter what" is exactly what an orchestration layer needs to enforce policy across agents. |

### What won't scale (named honestly so we know what we're choosing not to solve)

**1. Single-process MCP server.** Today: one Node process per repo. For serious parallel-agent orchestration you need either a shared daemon mode, file-based locking + WAL-mode SQLite, or a process-level lock manager. **Real future architecture lift, ~2 weeks when needed.**

**2. One `.contexttrail/` per repo.** For cross-repo orchestration: where do shared company docs live? How does repo X import context from repo Y? How does drift in repo X notify a card in repo Y? Structural room exists (`company` scope layer); implementation does not.

**3. No event log / audit trail.** Orchestration needs systematic event sourcing: "agent X retrieved pack P at time T, made commit C, reviewed by human H." Cheap to add (a SQLite `events` table); needs forward-thought schema design.

**4. No agent identity.** "The agent" is anonymous — ContextTrail doesn't know if Claude Code or Codex is calling. Orchestration needs identity for tracking, claim arbitration, per-agent policies.

**5. No task/dispatch primitive.** No "task" entity that agents can claim, work on, and report against. Net-new infrastructure when needed.

### Cheap "leave room for" decisions to make in v1

These cost almost nothing now and unblock the future cleanly:

**1. Reserve a top-level `entities/` namespace in the storage layout.**
```
.contexttrail/
  cards/         # v1
  entities/      # reserved — tasks, agent_runs, dispatch_events go here later
  cache/
  config.yaml
```
Costs nothing now; means future entities don't require restructure.

**2. Make MCP tool input schemas extensible from day 1.**
Every tool input accepts an optional `metadata` object that gets recorded but doesn't currently affect behavior. Future fields like `agent_id`, `task_id`, `parent_pack_id` can be added without protocol breaks.

**3. Enable WAL mode on SQLite from day 1.**
One-line config: `PRAGMA journal_mode=WAL`. Costs nothing in single-process v1. Means concurrent reads work the day a daemon mode is added.

### The honest scalability ceiling

Where this product *as currently architected* hits a real wall, requiring net-new infrastructure (not patches):

- **~100 concurrent agents per repo:** SQLite + file-based MCP can't. Needs Postgres + distributed coordinator.
- **Cross-repo orchestration at company scale:** needs a shared service, possibly hosted. Local-first is permanent for the *core*; org-scale orchestration is a layer *above*.
- **Real-time agent coordination (sub-second):** file-based store has too much latency. Needs in-memory pub/sub.

The good news: each upgrade is needed only when traction justifies it. None invalidate the foundation; they sit on top.

### The strategic claim

The substrate is sound. The current design carries the bigger vision (drift detection + orchestration) as *additive* work, not *replacement* work — with the explicit exception of the five items above, which are honestly named. The "leave room for" decisions cost almost nothing now and protect the future.

This means ContextTrail v1 can be honestly pitched as both:
- A standalone product worth shipping on its own merits (docs-first context retrieval + cards overlay)
- The foundation for a larger system (drift detection, then orchestration) without requiring rewrites

That's the architectural test, and the design passes it on the load-bearing axes.
