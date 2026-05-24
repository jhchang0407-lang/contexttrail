# ContextTrail — What It Is

Read this first. Everything else is depth.

---

## The product, in one sentence

> A better way to give AI coding agents the right slice of existing project knowledge.

That's it.

---

## The product, in six verbs

```
docs → chunk → scope → index → retrieve → pack
```

You point ContextTrail at your existing markdown docs. It chunks them by heading, tags each chunk with scope (which project/module/symbol it belongs to), indexes them in a local SQLite cache, and serves a small Context Pack to the agent before it edits code.

That's the whole product.

---

## What the current system has proved

- A deterministic retrieval core produces strong first-read quality without requiring embeddings or LLM routing.
- Three structural assembly levers layered above retrieval — markdown link traversal, nav-graph traversal (with universal directory-grouping fallback), and code-import-graph traversal — close the gap between "find the right doc" and "assemble the docs and files an engineer needs for actual work."
- The pack stays small and stable under aggressive budget reduction; compression pressure is not the limiting factor.
- The architecture generalizes on the metrics we have: the same engine, with no per-corpus weight tuning, hits 93%+ on a corpus it was never built against.

Current eval checkpoint (2026-05-11):

| metric | value | what it measures |
|---|---|---|
| Top-5 single-doc retrieval (174-case OSS panel, 13 corpora) | **96.0%** | "find the right doc" |
| Workflow assembly — ContextTrail (23 Linear tickets) | **95.7%** | "assemble every doc an engineer needs to start a real ticket" |
| Workflow assembly — valibot (15-ticket untuned generalization test) | **93.3%** | same metric on a corpus ContextTrail was never tuned against |
| Agent-completion source-file coverage (14 commit-grounded cases) | **93.9%** | "is the file the engineer needs to *edit* in the pack" |

Code-source indexing supports TypeScript / JavaScript / Python / Go / Rust — same `CodeSourceFacts` shape, per-language extractor, no native toolchains required outside TypeScript.

What is *not* yet proved: agent task success downstream of the pack (LLM-judge harness unbuilt), `signal_empty` recovery on real engineering queries, pack quality under token-budget pressure with traversal on, and pilot usage on a second commit-grounded codebase. See [OPEN.md](OPEN.md) — the retrieval-engine-as-risk framing is closed, but the product is not done. The remaining work has shifted from core ranking to recovery, real-engineer-workflow validation, onboarding, and shipping posture.

---

## What v1 must still prove

> Does giving an agent a small, scoped slice of relevant docs result in better-or-equally-good behavior with materially less context than dumping whole docs?

If yes → keep building.
If no → the wedge isn't real and the rest doesn't matter.

---

## What v1 explicitly is NOT

ContextTrail v1 is **not**:

- a drift detection system
- an integrity layer
- an agent orchestration platform
- a knowledge graph
- a verification engine
- a spec management tool
- an LLM-powered anything

These are all interesting and may come later. None are required to prove the wedge.

The mistake to avoid: trying to solve the entire future system at once. Three valid products got compressed into one design and made v1 feel heavier than it is.

---

## The decision rules for adding anything to v1

Before adding any feature, mechanism, table, or tool, ask:

> Does this help the agent get better context for a task **right now**?

If no → cut it.

That includes my favorite ideas. Cut them.

And, for features that *seem* small but might be doing two jobs at once:

> If a feature removes setup friction, include it. If a feature generates new "truth," defer it.

Friction reduction is additive and changes nothing semantic. Truth generation is architecturally load-bearing — it alters what "accepted" means and adds a precision/recall optimization problem to the engine. The two impulses can hide inside the same surface (a wizard, an importer). Disentangle them before deciding. See [ADR-0001](adr/0001-wizard-a-deterministic-setup-only.md).

---

## The AI rule

The deterministic engine (BM25 + scope + heading-match + mention extraction) must function without any AI call. Specific enhancements may use AI when they close a concrete gap:

> AI should not be required for correctness, but should be available for quality.

Concrete test before adding any AI feature:

> *"If I remove this, does the system still function?"* — If **no**, it's over-dependent. If **yes**, it's doing it right.

v1 ships one AI-using feature that passes this test:

- **Card bootstrap** — `contexttrail card bootstrap` proposes constraint candidates from imported docs to a triage inbox. Closes the cold-start gap. Removing it leaves manual card authoring fully functional.

Forward-compatibility scaffolding (provider interfaces, `maybe*` hooks, telemetry tables) is **not** added speculatively. Each abstraction is introduced when the first real call site needs it — when LLM rerank lands, `LLMProvider` lands with it; not before. See [ADR-0004](adr/0004-bar-2-scope-with-embeddings-and-bootstrap.md) for the rationale.

> If context assembly only works when semantic search is on, you built a search engine. If the deterministic core stands on its own, you built a context engine.

---

## The build, in 8–9 weeks

```
Week 1: import markdown docs, chunk by heading, tag scope, extract mentions
Week 2: deterministic retrieval (BM25 + scope + heading + mention) + Context Pack CLI
Week 3: 3 card types (constraint, symbol_note, evidence) + locked-include + substrate migration
Week 4: MCP server (read-only)
Week 5: context assembly groundwork; prove structural assembly basics on anchored implementation tasks
Week 6: card bootstrap from imported docs + triage inbox CLI on top of that structural baseline
Week 7: dogfood + measurement (manual cards vs bootstrap; fact-finding quality vs structural-assembly pack usefulness)
Week 8: stabilization, packaging, README polish — and only broader assembly if week 7 proves the narrow slice first
Week 9: setup initialization + confidence-guided onboarding (post-v1 productization)
```

This is the [Bar 2 scope](adr/0004-bar-2-scope-with-embeddings-and-bootstrap.md): "visibly better than naive on someone else's repo." See [MVP.md](MVP.md) for the week-by-week detail.

What has effectively shipped from that plan already:

- docs import + chunking + scope
- deterministic retrieval
- card locking + evidence promotion
- MCP server
- one-time user-level MCP install for Codex, Claude Code, Claude Desktop, and Cursor: `contexttrail mcp install --client <client>` plus `contexttrail mcp doctor`
- one-command repo setup: `contexttrail setup quickstart` initializes local state, imports obvious docs, reports readiness, and returns setup questions
- recurring session sync: `contexttrail sync` / `sync_ledger` refresh changed docs and code-source metadata, tombstones missing indexed files, re-imports hidden Cards, and reports Card freshness transitions
- agent-guided setup questions: `contexttrail setup questions` / `propose_setup_questions` rank the next 1-3 setup decisions, and `contexttrail setup answer` / `answer_setup_question` preview operational commands or route clarification answers through inbox state
- retrieval eval gate
- context-assembly baseline
- pre-retrieve freshness check: every Context Pack runs a content-hash compare against the index and warns when files have drifted without a fresh `contexttrail import` / `contexttrail index`; `CONTEXTTRAIL_RETRIEVAL_AUTO_REINDEX=true` opts into inline reindex (PRD-0035)

The setup conversation is a friction reducer, not a truth generator. First setup starts with `contexttrail setup quickstart`; recurring sessions start with `contexttrail sync`. At session start, agents should call `sync_ledger` with the repo `cwd`, apply it only when writes are allowed (`sync_ledger` defaults to check mode over MCP), then call `propose_setup_questions`, present returned questions as multiple-choice prompts when the host UI supports it, and only call `retrieve_context_pack` for coding work after setup blockers are handled. Candidate Cards remain provisional until `contexttrail inbox accept`; accepted Cards are not edited by quickstart, sync, or setup answers. `contexttrail setup quickstart --bootstrap-candidates` and `contexttrail sync --refresh-candidates` are intentionally opt-in and write inbox drafts only.

Persistence is repo-local and hidden: imported chunks live in `.contexttrail/cache/contexttrail.db`, review items live in `.contexttrail/inbox/*.md`, and accepted Cards live in `.contexttrail/cards/*.md`. Quickstart and sync both re-import hidden Card files into the cache so accepted Cards survive restarts, setup reruns, and later coding sessions. Sync rematerializes freshness so Cards linked to changed chunks become explicit `needs_review` work instead of silently stale truth.

What still feels meaningfully open:

- better low-signal recovery behavior
- more realistic structural assembly expansion / sufficiency testing
- pilot usage on real large repos

Week-5 scope, in one line:

- start from one grounded source chunk and prove that parent context, selective siblings, and linked neighbors can add the minimum surrounding context needed for a safe implementation change

---

## The five mental layers (Layer 1 ships in v1; Layer 2 partially via cards)

```
Layer 1 — prove this:    Can we retrieve the right docs better than naive approaches?
Layer 2 — only if 1:     Can lightweight rules/constraints improve correctness?
Layer 3 — only if 2:     Can we detect when context is stale or violated?
Layer 4 — only if 3:     Can we coordinate agents using this context?
Layer 5 — only if 4:     Can we extend this to multi-agent orchestration at team scale?
```

Each layer earns the next. Don't skip ahead.

---

## When to read the deeper docs

| If you want to... | Read |
|---|---|
| Understand what v1 is | This file (CORE.md) |
| Look up canonical terms (contexttrail, drift response, authority, provenance, etc.) | [CONTEXT.md](CONTEXT.md) |
| Start building week 1 | [MVP.md](MVP.md) |
| Make a schema decision | [SCHEMA.md](SCHEMA.md) |
| Make an architectural choice that might affect future scaling | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Look up why a specific decision was made | [DESIGN.md](DESIGN.md), [adr/](adr/) |
| Ideate on the next phase (post-v1) | [VISION.md](VISION.md), [IDEAS.md](IDEAS.md) |
| See unresolved items | [OPEN.md](OPEN.md) |

If you're not making a schema or scaling decision **and** you're not ideating, you don't need to read the deeper docs. They are *forward-compatibility notes*, not v1 requirements.

---

## The one-line takeaway

> Build a system that works without AI, and gets better with it — not one that collapses without it.

That's the architecture. That's the product. That's v1.
