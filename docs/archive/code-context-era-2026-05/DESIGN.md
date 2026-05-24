# ContextTrail — Design Decisions

Each section records a locked decision, the alternatives considered, and the reasoning. Decisions are listed in dependency order — earlier decisions are upstream of later ones. If you reopen an early decision, downstream decisions may need revisiting.

---

## D1. Product framing: context engine, not drift detector

**Decision:** ContextTrail is a structured intent / context engine for AI software development. Drift detection and orchestration are downstream features.

**Alternatives considered:**

- **Drift detector first** (the original framing): start with semantic change detection, layer requirements on top.
- **Orchestration platform first**: build the parallel-agent execution layer.

**Why context engine wins:** Drift detection only works if there's well-structured intent to compare against. Orchestration only works if agents have reliable context. The context engine is the substrate both depend on. Inverting this order leads to building features whose foundation does not exist.

**Implication:** The first valuable behavior is _retrieve precise context for an agent task_, not _detect that code changed_.

---

## D2. Atomic unit: Context Card (7 types)

**Decision:** The atomic unit of context is a **Context Card**, not a requirement atom. Seven card types: `requirement`, `decision`, `constraint`, `symbol_note`, `feature_intent`, `evidence`, `conversation_fragment`.

**Why not requirement atoms only:** Agents need more than expected behavior. They need:

- _Why_ a choice was made (decisions)
- What must not be violated (constraints)
- Local symbol semantics (symbol notes)
- Multi-step flows (feature intent)
- How to verify (evidence)
- Unresolved discussion (conversation fragments)

A single "requirement" type collapses all these into something too narrow.

**Highest-value types for agent mistake prevention:** `constraint`, `symbol_note`, `evidence`. These ship in v1.

---

## D3. Retrieved unit: Context Pack

**Decision:** Agents retrieve a **Context Pack** — a bundled set of cards categorized as `must_read` / `should_read` / `evidence` / `warnings` / `omitted`, with explainable inclusion reasons.

**Why not one card at a time:** Agents do not know which cards exist. The system must decide what is relevant for a specific task and pre-package it.

**Pack budget (defaults):**

```yaml
max_must_read: 8
max_should_read: 8
max_evidence: 6
max_candidates: 5
max_total_tokens: 6000
```

When too many constraints match, do not silently drop them. Surface omissions explicitly.

---

## D4. Cold-start: bootstrap is existential (but not v1)

**Decision:** A `contexttrail bootstrap` command extracts candidate cards from existing project residue. The user's first job is **triage**, not authoring. **However**, bootstrap is deferred to week 5 in the MVP because the first hypothesis to validate is _does retrieval help?_, not _can we extract cards cheaply?_

**Why deferred from v1:** Manually authoring 10–20 cards is acceptable for validating the core hypothesis. Trying to prove both retrieval value and cheap extraction in 4 weeks risks proving neither.

**Why bootstrap matters for B (OSS adoption):** A stranger who installs the tool and sees an empty graph bounces in 90 seconds. Bootstrap is the difference between "tool I install" and "tool I read about."

**Bootstrap source priority (Tier 1, deterministic):** Code structure, comments, tests, schemas, routes, docs, assertions, config. **Tier 2 (LLM-assisted):** commit messages, prose summarization, conversation import.

---

## D5. Storage: markdown source-of-truth + SQLite cache

**Decision:** Cards live as markdown files with YAML frontmatter, one card per file, committed to git. SQLite is a rebuildable local cache, gitignored.

**Alternatives considered:**

- **A — Single SQLite committed to git:** merge-conflict catastrophe on binary blobs.
- **B — Local-only SQLite, gitignored:** every machine starts cold; agents on different machines can't share.
- **C — Remote service:** lost local-first, requires accounts.
- **D — Markdown source + SQLite cache:** ✅ chosen.

**Why D wins:** Diffable, reviewable, mergeable, portable. Cards are operational project knowledge that _should_ live with code. Git handles merging. Acceptance becomes a meaningful commit. SQLite stays disposable.

**MVP simplification:** Use markdown-source from day one but keep the implementation barebones. No fancy folder taxonomy yet. Just frontmatter + body.

See [SCHEMA.md](SCHEMA.md) for the exact format.

---

## D6. Retrieval: hybrid + optional LLM rerank

**Decision:** Deterministic hybrid retrieval (scope filter + symbol-graph + keyword + constraint guarantee) is the default. LLM rerank is opt-in for agents and `--rerank` for humans. Embeddings are optional enhancement.

**Alternatives considered:**

- **A — Symbol-graph only:** misses cards not yet linked (most of them during bootstrap).
- **B — Pure embeddings:** "topical similarity" ≠ "applicability." Returns refund-soup.
- **C — Hybrid + LLM rerank:** ✅ chosen, with deterministic as the always-available baseline.

**Locks the LLM cannot override:**

- Accepted constraints with scope overlap → `must_read`
- Exact accepted symbol_notes → `must_read`
- Stale overlapping cards → `warnings`

**Why constraints are locked:** "Thou shalt not" rules are exactly where AI mistakes happen. They cannot be ranked out by a model whose judgment we don't fully trust.

---

## D7. Lifecycle: code-change-based staleness + evidence-based restoration

**Decision:** Cards become `needs_review` when linked code changes meaningfully. Cards return to `verified` when linked evidence passes against the current SHA, or when a human confirms. **No TTL-based decay.**

**Per-type rules** (full table in [VISION.md](VISION.md)):

- Constraints, symbol notes: aggressive `needs_review` on meaningful linked change.
- Requirements: `needs_review` on high-risk change, `maybe_affected` on meaningful change.
- Decisions: never auto-stale. May become `potentially_superseded`. Only humans can deprecate.
- Feature intent: `needs_review` only on major flow entrypoint changes.
- Evidence: `stale_until_run` when covered surface changes.

**Why no TTL:** Time does not change truth. A constraint about idempotency does not become wrong because 90 days passed. Time-based staleness trains users to ignore staleness.

**The semantic change detector's new role:** The fingerprinting work from the original spec is not dead — it becomes the **freshness signal generator** for the context engine, not the product itself.

---

## D8. Agent interface: MCP server primary, CLI fallback

**Decision:** MCP server is the primary agent-facing surface. CLI is a thin wrapper over the same core, used by humans and agents that don't speak MCP.

**Alternatives considered:**

- **CLI subprocess only:** slow, no persistent index, agents must parse JSON.
- **Library/SDK:** requires per-language bindings; doesn't help cloud agents.
- **MCP + CLI:** ✅ chosen.

**Why MCP-first:** Native to Claude Code, Cursor, Codex. Persistent process keeps the index hot. Typed tools are agent-discoverable. Distribution piggybacks on MCP-host adoption.

### Permission model

| Tool class                                                           | v1 default              | Notes                               |
| -------------------------------------------------------------------- | ----------------------- | ----------------------------------- |
| Read (`retrieve_context_pack`, `get_card`, `list_cards_for_scope`)   | Always allowed          |                                     |
| Candidate write (`propose_card`, `propose_link`, `mark_context_gap`) | **Deferred to post-v1** | Lands in inbox, never authoritative |
| Authoritative write (`accept_card`, `mark_verified`, `delete_card`)  | **Never default**       | Human-only via CLI, even later      |

**Principle:** Agents contribute hypotheses. Humans promote truth.

---

## D9. LLM/embedding dependency: tiered, deterministic-first

**Decision:** The product works fully offline with no API key, no model download, in `local-basic` mode. LLM and embedding features are explicit opt-in tiers.

| Tier             | Requires                                | Default?                            |
| ---------------- | --------------------------------------- | ----------------------------------- |
| `local-basic`    | Nothing                                 | ✅ default                          |
| `local-enhanced` | Tiny local embedding model (~25–100 MB) | Opt-in via `contexttrail setup embeddings` |
| `cloud-enhanced` | Anthropic / OpenAI key                  | Opt-in via `contexttrail setup llm`        |

**Provider abstraction:** Design a `LLMProvider` and `EmbeddingProvider` interface even if v1 ships with one provider. Future providers (Ollama, etc.) become adapters, not rewrites.

**Critical contract:**

> The product only deserves to call itself local-first if deterministic-only mode is useful, supported, and not treated as a broken fallback.

---

## D10. MVP scope: validate retrieval, defer everything else

**Decision:** 4-week MVP is markdown cards + deterministic retrieval + MCP read-only + dogfood. No bootstrap, no LLM, no embeddings, no decision/feature/requirement cards, no propose-loop, no AST fingerprints, no Python.

**Hypothesis being validated:**

> Agents perform meaningfully better with a small scoped Context Pack of accepted constraints and symbol notes vs. their default context.

**Deferred — and why each deferral is safe:**

- Bootstrap: 10–20 hand-authored cards is enough to test retrieval value.
- LLM rerank: deterministic retrieval should be good enough to validate the hypothesis.
- Embeddings: scope + keyword + symbol match cover most agent needs.
- Decision/feature cards: constraints + symbol notes + evidence cover ~80% of mistake-prevention value.
- Propose-loop: read-only validates retrieval value; capture-loop is a second hypothesis.
- AST fingerprints: manual `mark-needs-review` is enough for week 4.

See [MVP.md](MVP.md) for the week-by-week plan.

---

## D11. Tech stack: Node.js + TypeScript

**Decision:** Node.js + TypeScript, distributed via npm.

```
@modelcontextprotocol/sdk   # MCP server
gray-matter                 # frontmatter parsing
zod                         # validation
better-sqlite3              # cache
ts-morph                    # symbol extraction (week 5+)
commander or yargs          # CLI
vitest                      # tests
tsup or unbuild             # packaging
```

**Why Node:** MCP TypeScript SDK is the most mature. ts-morph for TypeScript indexing requires Node anyway. transformers.js for future local embeddings runs in Node. npm is the dev-tool standard. Bun OK for development; Node is the supported user runtime.

**Rejected:**

- Python: weaker MCP story, would need to shell out to Node for ts-morph anyway.
- Rust / Go: best for single-binary later, premature now. Bottleneck is product clarity, not throughput.

---

## D12. Dogfood target: ContextTrail itself

**Decision:** The week-4 dogfood codebase is ContextTrail itself.

**Why:** No other actively-edited TypeScript codebase qualifies (Ape Axiom is dormant). Building ContextTrail generates real constraints, symbol notes, evidence as a side effect. The author becomes the validator.

**Limitation:** Author == validator means the "did context prevent a mistake" measurement is weak (n=1, biased). But it's better than no dogfood, and it forces the team-of-one to live with the tool's defaults.

**Mitigation for OSS validation:** Week 5+ should recruit one external alpha user before declaring product-market fit signal.

---

## D13. Ambition: OSS dev tool, with commercial upside

**Decision:** Build for adoption (B). Commercial (C) is upside if traction validates.

**Why not personal tool (A):** No external forcing function → endless redesign.

**Why not commercial first (C):** Cannot validate paid demand without first proving the tool works on someone else's codebase.

**Implication for week 5–8:** ~30% of effort goes to adoption ergonomics — bootstrap, install polish, docs, one external alpha — that a personal tool wouldn't need.

---

## D14. ICP and positioning: solo TS dev frustrated by agent mistakes

**Decision:** v1 ICP is **solo TypeScript developers using Claude Code / Cursor / Codex on real apps with project-specific business rules.**

**Headline:** _"Tell your AI coding agent what not to break."_

**Rejected positioning:**

- _"Local-first context engine for AI-assisted software development"_ — accurate, but nobody feels it.
- _"Shared context for parallel AI agents"_ — strategically correct but audience is too small in 2026.
- _"Your team's coding rules, retrievable by AI agents"_ — better B2B pitch but team adoption needs bottom-up pull first.

**Why C wins for v1:** Every Claude Code user has had the "agent broke X because it didn't know Y" moment in the last week. The hook lands in 5 seconds.

**Cost:** Defensive positioning ("don't break things") is harder to monetize than enabling positioning ("ship faster"). Acceptable trade for adoption velocity.

---

---

> ⚠️ Sections below (Round 2 and Round 3) document the architectural framing that v1 ships _underneath_ — not features v1 ships _visibly_. v1 is six verbs (`docs → chunk → scope → index → retrieve → pack`). The substrate decisions (D15–D26) keep that simple product from becoming a dead-end. Read [CORE.md](CORE.md) for the simple version; read these for schema/scaling decisions.

---

# Round 2 — The Docs-First Reframing

A second grilling round (after round 1 locked the cards-first design) reframed the product around the user's original mental model: _agents drown in layered company/team/project/module documentation; the win is retrieving the right slice of existing prose, with cards as the structured overlay._

The decisions below supersede or extend round-1 decisions where noted. Round-1 decisions that were not contradicted remain locked.

## D15. Product reframing: docs-first with cards as overlay

**Decision:** ContextTrail's primary primitive is the **Doc Chunk** (imported from existing markdown docs). The **Context Card** is a structured overlay for hard rules. Both flow into the same Context Pack but appear in distinct sections.

**Why this supersedes D1 (which framed the product around cards):** Round 1 assumed structured knowledge had to be authored. The user's actual pain is _existing_ documentation that the agent can't navigate efficiently. Cards-first has an authoring tax that defeats adoption when teams already have docs, specs, ADRs, READMEs.

**The clean architecture:**

```
docs = breadth (cold-start solved by existing prose)
cards = control (precision, authority, locked include)
```

**ICP shifts from D14:**

> Developers on documented TypeScript codebases using AI coding agents, where important context is scattered across specs, ADRs, READMEs, team guidance, and module docs.

**README headline shifts from D14:**

> _Stop dumping entire docs into your AI coding agent. ContextTrail retrieves the exact project context it needs for the task._

Card framing becomes the second sentence, not the lead.

---

## D16. Chunking: heading-based with size cap

**Decision:** Doc Chunks are heading-scoped sections, capped by a token budget. Sections exceeding the cap are split by paragraph (preserving code blocks, tables, and lists intact). Sections under a floor are merged with siblings.

**Defaults:**

```yaml
chunking:
  strategy: heading_with_cap
  target_tokens: 500
  max_tokens: 900
  overlap_tokens: 80
  split_by: paragraph
  preserve_blocks: [code_fence, table, list]
```

**Why not pure heading-based (A):** real docs have wildly variable section sizes; a single H3 might be 30 paragraphs.

**Why not fixed-window (B):** loses semantic boundaries; agent doesn't know what section a chunk belongs to.

**Why not whole-doc (D):** defeats the entire scoping product.

**Chunk identity uses two keys:**

- `stable_key = hash(source_path + heading_path + chunk_index)` — survives content edits
- `version_id = hash(stable_key + chunk_content_hash)` — pins exact content

This lets cards link to a section in a way that survives minor edits but flags content drift.

**Each chunk carries its heading_path as first-class scope metadata** — `Refund Spec > Partial Refunds > Edge Cases` is a strong retrieval signal, not just decorative.

---

## D17. Scope tagging: layered precedence with mention extraction

**Decision:** A chunk's scope is computed by precedence:

```
1. Frontmatter scope (overrides everything)
2. Config glob rules in .contexttrail/config.yaml
3. Built-in path inference defaults
4. Mention extraction (augments code-level anchors only — never overrides layer)
5. Unknown
```

**Layered scope schema** introduces hierarchy that flat file/symbol scope didn't have:

```
company > team > project > feature > module > symbol
```

Specificity boosts retrieval ranking (`module > project > team > company`) but doesn't hard-filter — a company-level security doc can still surface for a payments task if it's clearly relevant.

**Default `doc_scopes` rules ship in v1:**

```yaml
doc_scopes:
  - pattern: "docs/**/*.md"           → layer: project
  - pattern: "README.md"              → layer: project
  - pattern: "src/**/README.md"       → layer: module
  - pattern: "packages/*/README.md"   → layer: module (monorepo)
  - pattern: "**/{adr,decisions}/**/*.md" → layer: decision
```

Anything fancier is user config. Defaults stay minimal to avoid magic.

**Mention extraction is conservative:** explicit file paths, exact symbols, routes, env vars, test names. No aggressive semantic inference (`"refund service"` → `RefundService`) — that's embedding/LLM territory in v1.5+.

**Mention confidence is stored per-anchor** (`high` / `medium` / `low` / `ambiguous`). Retrieval uses confidence as a signal weight, not a hard cutoff.

**`contexttrail scope inspect` is mandatory.** Without it, users can't debug why retrieval missed a doc.

---

## D18. Packing: locked-first, then global ranker

**Decision:** Context Pack is built in this order:

```
1. Locked items (accepted constraints with scope overlap, exact accepted symbol_notes)
2. Linked evidence for locked items
3. Stale overlapping cards as warnings (capped)
4. Global ranker fills remaining budget across all remaining cards + chunks
5. Sectioned output for agent readability
6. Explicit "omitted N items" tagging
```

**Why not fixed quotas (A):** arbitrary; some tasks need 8 constraints, some need 0 cards.

**Why not tiered floors (C):** unnecessary complexity; locked guarantee + global ranker covers the cases that matter.

**Card type bias:** accepted cards get a small (1.2x) multiplier over doc chunks at equal relevance score. Reasoning: human curation is a real signal worth respecting, but not enough to swamp a clearly-better chunk.

**Packing score formula:**

```
packing_score = relevance_score
              × type_bias
              × authority_weight
              × freshness_weight
              / sqrt(token_count)
```

`sqrt(token_count)` penalizes huge chunks without over-rewarding micro-chunks.

**Default budget: 6,000 tokens.** Presets:

- `small`: 4,000
- `default`: 6,000
- `large`: 10,000

Configurable via `--budget` CLI flag and `max_tokens` MCP parameter.

**Output is sectioned** even though ranking is global:

```
Context Pack
  Locked rules
  Symbol notes
  Relevant docs
  Evidence
  Warnings
  Omitted (with counts)
```

Agent treats sections semantically: locked rules are _instructions_, doc chunks are _context_.

**`contexttrail explain` is required, not optional.** Global ranking is harder to debug than quotas; without per-item explain, users won't trust the system.

---

## D19. Doc lifecycle: snapshot + content-hash + implicit-on-retrieve

**Decision:** Imported doc sources are tracked with mtime + size + content-hash. On every retrieval (default), ContextTrail fast-paths a stat check on indexed sources, computes content-hash for any whose mtime changed, and re-parses changed docs inline before retrieval.

```yaml
indexing:
  mode: implicit # default. Alternative: 'manual' for large repos
```

**Doc chunks themselves do not have rich freshness states.** They are either `current` or `tombstoned`. They are _current indexed views of source_, not truth objects with their own lifecycle.

**Card-to-chunk links are protected via version_id capture.** When a chunk's content changes:

1. Old chunk → tombstoned
2. New chunk → current (same `stable_key`, new `version_id`)
3. Any card that linked to the old `version_id` → `needs_review`
4. System emits a loud warning naming the affected cards

This separates _"imported prose was edited"_ (always a chunk replacement, not a stale state) from _"a curated commitment now references something that drifted"_ (the card, not the chunk, becomes stale).

**Tombstones retained until manual cleanup** (`contexttrail index vacuum` post-v1). Keeps retrieval logs interpretable when re-reading old packs.

**Retrieval logs reference `version_id`, not `stable_key`** — so historical packs remain debuggable even after content drift.

**Two staleness axes coexist:**

| Axis                         | Trigger                         | Affects                                                 |
| ---------------------------- | ------------------------------- | ------------------------------------------------------- |
| Code change (existing model) | Linked symbol meaningful change | Cards → `needs_review`                                  |
| Doc change (new)             | Linked chunk version changed    | Cards → `needs_review` (chunks themselves just replace) |

**No file watcher in v1.** Implicit-on-retrieve covers the UX. Watcher is v1.5+.

**No external doc sources in v1.** Notion / Confluence / Google Docs / PDF defer to post-MVP. Each requires its own design pass (auth, API, delta sync, format conversion).

---

## D20. MVP plan v2: 5-week docs-first build

**Decision:** The cards-first 4-week plan from D10 is replaced by a 5-week docs-first plan. The original plan is preserved in [archive/v1-cards-first-mvp.md](archive/v1-cards-first-mvp.md).

```
Week 1: Doc import + chunking + scope rules
Week 2: Deterministic retrieval + Context Pack CLI
Week 3: Cards overlay + locked guarantee
Week 4: MCP server (read-only)
Week 5: Dogfood + measurement
```

**Why +1 week:** The product surface is meaningfully larger (two primitives, layered scope, mention extraction, lifecycle for both). Pretending the same 4 weeks covers both shapes is dishonest scheduling.

**Hypothesis being validated** (replaces D10's narrower hypothesis):

> Can ContextTrail retrieve the right slice of an existing layered documentation set — better and more efficiently than the agent loading whole docs — while guaranteeing that authored hard-rule cards are always included?

See [MVP.md](MVP.md) for the full week-by-week.

---

## D21. Dogfood: split between implementation and validation repos

**Decision:** ContextTrail's own repo is **insufficient** for validating the docs-first hypothesis. Dogfood splits:

| Repo                                                          | Role                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **ContextTrail**                                               | Implementation dogfood. Validates that import works, MCP works, schemas hold, packing runs. |
| **Ralph** (or fallback: a real OSS TS repo with layered docs) | Product hypothesis dogfood. Has the layered context pain the product is designed to solve.  |

**Why ContextTrail alone fails the test:** its docs were just authored by the user, with full context. The "agent drowning in unfamiliar layered docs" pain doesn't exist there.

**Ralph qualifies because:** it has `CLAUDE.md`, `CONTEXT.md`, `docs/agents/*`, ADRs, architecture docs, PRDs — the exact layered structure the product needs to validate against. The user actively maintains it but isn't in deep context with it constantly.

**Fallback if Ralph fails the criteria** (not TS, not actively edited, no real layers): adopt a real OSS TypeScript repo with substantial docs for the dogfood week.

---

## D22. Success criteria: layered (token efficiency + subjective + behavior parity)

**Decision:** Replaces D10's single "≥3 mistakes prevented" criterion. The docs-first hypothesis is broader and needs three measurement layers:

**Layer A — Token efficiency:**
For each task, compare ContextTrail pack vs. naive doc dump.
Target: ≥50% average reduction.

**Layer B — Subjective correctness:**
Human scores each pack 1–5: _"Did this contain what I would have shown the agent? What was missing? What was noise?"_
Target: ≥7/10 packs score 4 or 5.

**Layer C — Behavior parity / lift:**
For ≥3 hard tasks: run agent with vs without ContextTrail pack; compare outcomes.
Target: ≥1 clear demonstration of parity-with-fewer-tokens or strictly-better behavior.

**Headline week-5 success:**

```
≥10 real Ralph tasks evaluated
≥7/10 packs score 4 or 5
average token reduction ≥50%
≥1 behavior-parity or behavior-lift demonstration
```

If headline misses → docs-first hypothesis didn't hold OR retrieval ranking needs work. Both worth knowing.

---

## What round 1 decisions remain locked

These survived round 2 unchanged:

- **D5 (Storage):** markdown source-of-truth + SQLite cache. Now applies to both cards AND doc chunks (chunks cached in SQLite, source markdown is the truth).
- **D8 (MCP-first):** primary surface stays MCP. CLI is fallback. New tools added: `get_doc_chunk`, `list_context_sources`.
- **D9 (Tier model):** local-basic remains the default. Embeddings still opt-in (BM25 covers v1; embeddings are a v1.5 quality boost, not a necessity for docs-first because heading + scope + code-mention signals are strong).
- **D11 (Stack):** Node.js + TypeScript + npm distribution. Unchanged.
- **D13 (Ambition):** OSS dev tool first, commercial upside if traction.

## What round 1 decisions are superseded

- **D1 (Product framing):** superseded by D15. Context engine is still the substrate, but the primary unit shifts from card to doc chunk.
- **D2 (Atomic unit):** extended by D15. Cards are no longer the only atomic unit; Doc Chunks are co-equal.
- **D10 (MVP scope):** superseded by D20. 4 weeks → 5 weeks; cards-first → docs-first with cards overlay.
- **D12 (Dogfood):** extended by D21. ContextTrail alone is insufficient; second repo (Ralph) added for product validation.
- **D14 (ICP and positioning):** extended by D15. ICP broadens from "solo TS dev frustrated by agent mistakes" to "developer on documented TS codebase where context is scattered across layers." New headline.

## Open / unresolved

See [OPEN.md](OPEN.md). The biggest open items now:

1. The real "agent broke X" story (still load-bearing for cards demo, less critical for docs-first hook)
2. Confirmation that Ralph qualifies as the validation dogfood repo (TypeScript? actively edited? has layered docs?)
3. Whether the +1 week (4 → 5) is acceptable or whether further scope cuts are needed

---

# Round 3 — The Substrate Model

A third round of architectural framing established that ContextTrail v1 should be built as a **layered context substrate**, not a narrow CLI. The wedge ships small (docs-first retrieval); the substrate carries every future feature (drift detection, verification, orchestration, multi-agent coordination) as additive work.

The full architecture is in [ARCHITECTURE.md](ARCHITECTURE.md). The decision below captures the commitment that ripples through every other v1 schema and design choice.

## D23. Build v1 as a substrate, not a narrow CLI

**Decision:** v1 implements the four-layer substrate model from [ARCHITECTURE.md](ARCHITECTURE.md):

```
Layer 4: Applications (v1 ships one: Context Pack for coding agents)
Layer 3: Retrieval engine
Layer 2: Context graph / index
Layer 1: Source ingestion
```

The five (six) durable primitives must be stable from day one: `ContextObject`, `Source`, `Scope`, `Authority`, `Link`, `Freshness/version`.

**Concrete schema implications** (extends [SCHEMA.md](SCHEMA.md)):

1. **Unified `context_objects` core + type-specific extension tables.** Replaces the separate-tables-per-type approach from rounds 1 and 2. DocChunks and Cards are both `kind` values in the core; their type-specific fields live in `doc_chunk_ext` and `card_ext`. New ContextObject kinds (SpecAtom, Task, ChangeEvent, AgentRun, EvidenceRun, VerificationResult) just add new extension tables — the core never changes.

2. **Discriminated `sources` table.** Every ContextObject traces back to a Source. Source has a kind: `markdown_file | card_file | future:notion | future:git_diff | future:test_run | future:ticket | future:agent_run`. v1 only handles two kinds; the abstraction is in place for the rest.

3. **Single typed `links` table.** Replaces per-type link tables. Schema: `(from_kind, from_id, to_kind, to_id, type, confidence, source, version_pin, created_at)`. Forward-compatible with every future relationship without schema migration.

4. **Generic `code_anchors` table.** File/symbol/route/env_var/test mentions live in one table indexed across all ContextObject kinds. Lets future drift detection traverse the same anchor graph.

5. **Authority enum at the object level.** Every ContextObject carries `authority: 'accepted' | 'imported' | 'candidate' | 'inferred'`. This is what prevents the system from becoming AI-generated mush at any scale.

6. **Freshness fields on every object.** Even if v1 only uses them lightly (chunks are `current` / `tombstoned`; cards have rich states), every object has `version_id`, `content_hash`, `freshness_state`, `last_verified_sha?`. Drift detection (later) flips states; nothing changes at the schema level.

7. **WAL mode SQLite from day one.** `PRAGMA journal_mode=WAL`. Costs nothing in single-process v1; enables concurrent reads when daemon mode arrives.

**Why this supersedes round-2 schema choices:** round 2 had separate `cards`, `doc_chunks`, `indexed_doc_sources`, `chunk_code_mentions`, `card_chunk_links` tables. That was a conceptual sketch. The substrate model unifies them under `context_objects` + extensions, which is what makes future kinds _additive_ instead of _replacement_. The legacy schema is preserved in [SCHEMA.md](SCHEMA.md) for historical reading; the substrate is what v1 implements.

**Cost in v1:** ~1 day of additional schema work in week 1.

**Cost avoided later:** weeks of rework when adding drift detection (need to retrofit ChangeEvents into a card-only schema), then more weeks for orchestration (need to retrofit Tasks, AgentRuns into a fragmented model).

---

## D24. The one design rule

**Decision:** Every architectural decision is testable against this rule:

```
ContextTrail never asks agents to trust ungrounded AI summaries.
It routes agents to source-grounded context and clearly separates
imported docs, accepted rules, candidates, and verified evidence.
```

Anything that violates this rule (silently accepting LLM output as authoritative, hiding source of inference, blurring authority levels) is rejected regardless of convenience.

**Why this is in DESIGN, not just ARCHITECTURE:** it is the failure mode that kills products in this category. Generic "AI knowledge graphs" become vaporware because they can't tell users which knowledge is real. ContextTrail's authority discipline is what makes it different.

This rule applies forever. It is what protects the substrate from sliding into "another LLM-derivative tool you can't trust."

---

## D25. The architectural test

**Decision:** Before any v1 design decision is locked, it must pass:

1. **Does it serve the wedge?** (docs-first context retrieval for coding agents)
2. **Does it preserve the substrate?** (six primitives stay forward-compatible)
3. **Does it respect the design rule?** (D24 — never ungrounded AI summaries)
4. **Does it avoid the bake-too-deep list?** (no implementation details promoted to abstractions; see ARCHITECTURE.md)
5. **Is it the smallest version that could work?** (no premature generalization beyond the six primitives)

Decisions that pass all five are good. Decisions that fail #2, #3, or #4 should be rejected even if they're convenient.

**This test supersedes ad-hoc evaluation of design decisions.** Apply it to every D26+ proposal.

---

## D26. AI placeholders in v1: ready-in-practice, not ready-in-principle

**Decision:** v1 ships with no AI features but adds explicit placeholders so AI integrations in v1.5+ are _drop-in_, not _retrofit_. The cost in v1 is ~half a day of week-1 scaffolding.

The full set of placeholders is documented in [ARCHITECTURE.md](ARCHITECTURE.md#ai-insertion-points-and-v1-placeholders). Summary:

1. **Provider interfaces with `NoneProvider`.** `LLMProvider` and `EmbeddingProvider` interfaces, with v1 shipping only `NoneProvider` (no-op identity). Every AI-eligible call site goes through these.
2. **`maybe*` pipeline hooks.** Every AI insertion point in code is a named method (`maybeExtractCandidates`, `maybeRerank`, `maybeSummarize`, `maybeClassifyChange`). v1 implementations call `NoneProvider`. v1.5 swaps providers without finding call sites.
3. **`extraction_runs` SQLite table.** Records every AI invocation with provider, model, prompt version, cost, duration, affected objects. Empty in v1; schema in place.
4. **Forward-compatible enums.** `Source.kind` includes `'llm_extraction'`; `Link.source` includes `'llm_extraction' | 'embedding_similarity' | 'agent_observation'`; `Authority` includes `'inferred'`. v1 doesn't create these values; the system recognizes them.
5. **`.contexttrail/prompts/` directory.** Empty in v1. Prompts live as versioned data (referenced by `extraction_runs.prompt_version`), not hardcoded strings.
6. **`contexttrail doctor` reports AI tier.** Even in v1: "AI features: disabled (provider=none). To enable: contexttrail setup llm." Sets the expectation that AI is opt-in.
7. **MCP tools accept optional AI parameters as no-ops.** `retrieve_context_pack({ ..., use_rerank?: boolean })` ignored in v1; honored in v1.5+. No protocol breaks.
8. **AI telemetry from day one.** `NoneProvider` logs "AI call would have happened here" with input hash, call site, estimated cost. After 4 weeks of dogfood, telemetry tells you _empirically_ where AI would help most. v1.5 priorities are data-driven, not guessed.

### Authority discipline (carries from D24)

> AI output is `candidate` or `inferred` — never `accepted`. The user's act of acceptance is what makes a knowledge object authoritative. AI never elevates authority on its own.

This is non-negotiable. It is what protects ContextTrail from becoming AI mush at any AI-augmentation level.

### What this means for week 1

Week 1's schema work expands by ~half a day to include:

- `extraction_runs` table created (empty)
- `LLMProvider` and `EmbeddingProvider` TypeScript interfaces defined
- `NoneProvider` class implemented (returns identity / [] / no-op for every method)
- Pipeline scaffolding has `maybe*` methods that call `NoneProvider`
- `.contexttrail/prompts/` directory created (empty, with a README explaining future use)
- `contexttrail doctor` includes AI tier section showing "disabled"
- MCP tool input schemas include optional AI parameters (validated but ignored)
- Telemetry logger writes `NoneProvider` invocations to `ai-telemetry.jsonl`

Week-1 deliverable doesn't change in user-facing behavior. The substrate just becomes AI-ready in practice.

### The principle (worth repeating)

> AI is a power feature, not a foundation. Build the foundation deterministically; add AI as opt-in middleware that respects authority discipline.

> ⚠️ **Superseded for v1 by D27 + ADR-0004.** D26's specific placeholder list (provider interfaces, `maybe*` hooks, `extraction_runs` table, prompts directory, AI telemetry) is **cut from v1**. Per [ADR-0004](adr/0004-bar-2-scope-with-embeddings-and-bootstrap.md) and the round-3 grilling, those abstractions are introduced when their first real call site lands — not pre-emptively. The _principle_ of D26 (deterministic foundation, AI as opt-in middleware, authority discipline) survives. The _implementation pre-work_ does not.

---

## D27. Bar 2 scope: embeddings + bootstrap in v1

**Decision:** v1 scope is "Bar 2" — visibly better than naive on someone else's repo. Embeddings (opt-in) and card bootstrap are pulled into v1; calendar grows to 7–8 weeks. See [ADR-0004](adr/0004-bar-2-scope-with-embeddings-and-bootstrap.md) for the full reasoning and rejected alternatives (Bar 1, Bar 3).

**Why now:** Author has no time pressure. The relevant question is "what bar must v1 clear to be worth showing anyone?" — not "what fits in 5 weeks?" Bar 1 was easy to dismiss as "BM25 + a CLI"; Bar 3 is the right ambition for v1.5+ but premature.

**Critical principle:** the deterministic core (BM25 + scope + heading + mention) must work _without_ embeddings. Embeddings are an enhancement layer. Week-7 dogfood includes a no-embeddings run.

> If embeddings are required, you built a search engine. If embeddings are optional, you built a context engine.

---

## D28. Tokenizer and markdown parser

**Decision:** `gpt-tokenizer` with `cl100k_base` encoding for token counting. `remark` + `unified` + `remark-gfm` + `gray-matter` for markdown parsing.

**Why `gpt-tokenizer` over `tiktoken`:** pure JS, no native binary, clean `npm install` for OSS users. Accuracy matches `tiktoken`. The 50% reduction success-criterion claim stays defensible because token counts use the same encoding agents use.

**Why `remark` over `markdown-it` / `marked`:** real `mdast` AST with `node.position` for line ranges; heading-tree construction trivial; `preserve_blocks` for code/table/list is a tree walk, not stream manipulation. Cost: ~200KB of deps. For a CLI, irrelevant.

---

## D29. Schema phasing: flat in weeks 1–2, substrate in week 3

**Decision:** v1 ships in two schema phases. Weeks 1–2 use flat `doc_chunks` + `indexed_doc_sources`. Week 3 migrates to the substrate (`context_objects` + `doc_chunk_ext` + `card_ext` + `links`) when cards land.

**Why:** the substrate is conceptually right but premature in week 1 — only one object kind exists, so the abstraction has nothing to abstract over. Migration is one-time, deterministic, scripted; the cost is small and the motivational benefit of seeing first-Context-Pack quickly is large.

**Guardrail:** name fields in the flat schema so they map cleanly to the substrate (e.g., `doc_chunks.body` → `doc_chunk_ext.body`, `doc_chunks.scope_data` → `context_objects.scope_data`). No throwaway names.

---

## D30. Chunking algorithm specifics

**Decision:**

- `merge_adjacent_sections: false` (heading is the unit of meaning)
- `oversized_atomic_blocks: preserve_and_warn` (never split code/table/list)
- `context_header: true` / `overlap_tokens: 0` (drift replaces prose-tail overlap)
- Section over `max_tokens` → greedy-fill to target

**Why no overlap:** prose-tail overlap is a RAG-pipeline crutch for embeddings. With BM25 + heading-context trail, it's redundant and creates duplicated tokens, messier citations, and complicates chunk identity. If embeddings underperform later, prose-tail overlap can be added behind a flag.

**Why preserve oversized atomic blocks:** splitting a 1500-token code fence into two 750-token halves destroys the chunk's value. Better one fat valid chunk + a warning encouraging the doc author to break it up.

---

## D31. Chunk identity: intra-section index

**Decision:** `stable_key = hash(source_path + heading_path + chunk_index_within_section)`; `version_id = hash(stable_key + content_hash)`.

**Why intra-section instead of global `chunk_index`:** global chunk_index causes false-stale cascades when a heading is inserted above (every downstream chunk's stable_key dies). Intra-section index survives insertions and reorders. Heading rename still invalidates — that's tolerable for v1 because heading is part of chunk meaning and renames are rarer than insertions.

**Deferred:** fuzzy supersedes-on-rename detection. Adds AI-shaped complexity v1 doesn't need; revisit when card-to-chunk linking pain becomes real.

---

## D32. Code anchors via mention extraction: precision-first regex table

**Decision:** ship a single regex table with explicit confidence levels per pattern; no AST resolution (`ts-morph` deferred to v1.5); no LLM extraction.

| Kind      | Pattern                                          | Confidence |
| --------- | ------------------------------------------------ | ---------- |
| `file`    | backticked path with extension + slash           | high       |
| `file`    | unbacked path with extension + slash             | medium     |
| `symbol`  | backticked PascalCase.member chain               | high       |
| `symbol`  | backticked single PascalCase/camelCase           | medium     |
| `symbol`  | unbacked PascalCase.member chain                 | low        |
| `route`   | backticked path with `:` or 2+ segments          | high       |
| `route`   | backticked `METHOD /path`                        | high       |
| `env_var` | `[A-Z][A-Z0-9_]{3,}` containing underscore       | medium     |
| `test`    | `*.test.ts` / `*.spec.ts` / `*_test.py` filename | high       |

**Explicitly skipped:** unbacked bare PascalCase identifiers (too noisy — collides with English words), unbacked routes (ambiguous), short uppercase identifiers (`API`, `HTTP`).

**Safety valve:** `contexttrail scope inspect` shows extracted mentions per chunk. False-positive rates audited on real docs in week 1; regex table tuned before retrieval depends on them in week 2.

---

## D33. Scope tagging precedence and inheritance

**Decision:**

- Frontmatter overrides config rules **per-field** (not wholesale replace)
- No automatic project name from `docs/<segment>` (e.g., `docs/architecture/foo.md` does NOT get `project=architecture`); explicit derivation requires explicit config rule
- `module_from_path_after: src` → single segment (`src/payments/internal/x.ts` → `module=payments`); nested modules are v2
- File-level scope inherits to all chunks in the file
- Mention extraction augments per-chunk `code_anchors` only; does not change `layer` / `project` / `team` / `module`

**Why no auto-derive of project:** `docs/<segment>` is often a folder category (architecture, adr, guides), not a project name. Auto-derivation creates fake specificity that pollutes scope_match retrieval signals.

---

## D34. Scoring formula (deterministic core)

**Decision:**

```
text_score = 0.70 × BM25_norm + 0.30 × heading_match_score

final_score = text_score
            × (1 + 0.70 × scope_match_score)
            × (1 + 0.80 × mention_overlap_score)
            × specificity_weight(scope_layer)

packing_score = final_score / sqrt(token_count)
```

- `min_final_score = 0.05` (drops tiny irrelevant chunks regardless of cheapness)
- All weights in `config.yaml` from day 1, tunable without code edits
- Multi-scope queries (`--files src/a/x.ts src/b/y.ts`) OR'd via `max(...)` over scope matches
- Missing query scope/anchors → 0 (neutral, not 1; otherwise everything gets a free boost)

**Why hybrid (additive text + multiplicative structural) instead of fully multiplicative on BM25:** fully multiplicative buries chunks where BM25 is weak (vocabulary mismatch) but file/symbol/scope match is strong. The hybrid says "structure can rescue near-misses on text" — exactly the failure mode embeddings address later, but without requiring embeddings to ship.

**`contexttrail explain`** is mandatory from day 1; shows BM25, heading_match, scope_match, mention_overlap, specificity, text_score, final_score, token_count, packing_score, and inclusion reason.

---

## D35. Embeddings: opt-in, eager, BLOB, weighted-sum

**Decision (deferred implementation):**

- Model: choose a small local model when the feature resumes; do not ship a model runtime dependency before then.
- Compute: eager when enabled (`contexttrail import --embed` or `contexttrail embed`), never lazy at retrieval time.
- Storage: `BLOB` column on `doc_chunks` (week 1–2 schema) / `context_objects` (week 3+ substrate). No vector index, no `sqlite-vec`, no native dependency.
- Combine: weighted sum, default α=0.5, configurable.

**Why opt-in (not default):** preserves the local-basic first-run promise — `npm install` → `contexttrail init` → `contexttrail import` → `contexttrail context` works with no model download, no surprise CPU spike.

**Why eager (not lazy):** lazy makes the first `contexttrail context` call surprisingly slow, killing the "aha" moment.

**Why BLOB (not vector index):** real codebases have hundreds-of-thousands of chunks, not millions. Linear cosine over 384-float vectors at this scale is ~3ms. Vector indexes only matter at v2 scale and add native binary deps that break OSS install.

**Why weighted sum (not RRF or rerank-pipeline):** explainable. `contexttrail explain` can show both component scores. RRF and rerank are v2 territory once tuning data exists.

---

## D36. Project scaffold: single package, commander, domain folders

**Decision:**

- Single npm package, `bin: contexttrail`
- CLI framework: `commander`
- Source layout by domain (parse, scope, extract, store, retrieve, embed, bootstrap, config, types) mirroring the six verbs (`docs → chunk → scope → index → retrieve → pack`)
- Tests colocated as `*.test.ts` (vitest convention)
- `src/types/` for shared types (avoids circular imports)

**Why single package over monorepo:** no second consumer exists. Monorepo is a mid-game move when a separate MCP server / core library appears as a real consumer. Right now there isn't.

**Why `commander` over `yargs`:** simpler subcommand API, well-typed, less boilerplate. Extra `yargs` features don't apply to the v1 command set.

**Why domain folders over layer folders (models/services/controllers):** the codebase legibility comes from mirroring the product description. Each folder maps directly to a step in the pipeline.

---

## D37. Locked-include overflow: hard guarantee for locked, soft target for the rest

**Decision:**

The token budget is a **hard guarantee** for locked-include content: matching constraints, matching symbol_notes, and one-hop evidence promoted from already-locked cards per D38 / D39 / D43. Everything else remains under a soft target.

The packer:

1. Pulls every locked Card into the pack first, regardless of total token cost.
2. Computes `remaining_budget = max(0, requested_budget − sum(locked_tokens))`.
3. Runs the global ranker (Doc Chunks + non-locked Cards) under `remaining_budget` only.
4. If `sum(locked_tokens) > requested_budget`, emits a `locked_overflow` warning naming the deficit and the per-card token costs. Doc chunks may be packed for zero tokens (none included).

The pack's `budget` block surfaces `{ requested, used, locked_overhead }` so the agent and `contexttrail explain` can see exactly how much of the actual context window was consumed.

**Why locked must win:** the product promise is "authored hard-rule cards always reach the agent." Silent truncation of a locked Card would break the most load-bearing trust contract ContextTrail makes. Authors must be able to say "this constraint was authored, therefore it was shown" without footnotes.

**Why budget stays a soft target (not a hard ceiling that evicts locked):** a hard ceiling either lies to the author (silent drop) or refuses the call (hostile UX during the cold-start week when authors are still scoping). Soft target + loud warning is honest: the agent's actual context consumption may exceed the requested budget, but it never exceeds without a structured signal saying so.

**Why not (a) hard-truncate locked Cards by score:** breaks the core promise.
**Why not (c) silently expand budget to fit locked + original docs budget:** hides the cost. Agents that asked for 6k get 14k without knowing why.
**Why not (d) refuse with an error when locked exceeds budget:** punishes the dogfood phase when locked-overflow is expected and informative, not a configuration error.

**Authoring counter-pressure:** ADR-0006 already specifies that stale (`needs_review`) locked Cards remain locked-include with a freshness warning. D37 extends the same principle to budget: locked is locked. If users discover authoring patterns where locked-overflow is chronic, the fix is in scope rules (D38) or authoring discipline, not in the pack policy.

**See also:** [ADR-0010](adr/0010-locked-include-overflow-policy.md) for the full trade-off analysis and rejected alternatives.

---

## D38. Constraint locked-include: hierarchical-down scope match

**Decision:**

A `constraint` Card is **locked-include** when its `scope` matches the retrieval request's inferred scope under hierarchical-down semantics:

- **Match** when the card's scope is the request's scope or any **ancestor** of it. A `project: fundops` constraint locks for any task whose inferred scope is `fundops` or any module/symbol within fundops.
- **No match** when the card's scope is a **sibling** or **descendant** of the request scope. A `module: fundops/ledger` constraint does **not** lock for `module: fundops/billing`. A `module: fundops/ledger` constraint also does **not** lock for a `project: fundops`-level task (descendant cannot lock for ancestor — would leak module-specific rules to project-wide work).
- **Company-scope constraints lock universally.** This is intended: company-level invariants ("never log PII," "all monetary math goes through Money") should reach every retrieval. To prevent quiet over-broad locking, `contexttrail explain` surfaces a `broad_scope` reason on each company-locked Card so authors can audit whether the broad lock is deliberate.

This is the same hierarchy as the retrieval `scope_match` signal (D34), binarized: locked-include is the boolean version of "card's scope subsumes request's scope."

**Why hierarchical-down (not exact-only):** authoring "this applies to all of fundops" is the most natural statement. Exact-match would force authors to duplicate the same constraint per module, which is the kind of friction that kills the cold-start week.

**Why not bidirectional:** a `module: ledger` constraint must not fire on `module: billing` work. That's not a guarantee, that's a leak. Sibling matches break trust faster than missing matches.

**Edge case — multi-anchor query scopes:** a request whose `--files` span two modules infers a multi-scope. A constraint locks if its scope is an ancestor of **any** request scope (`OR` semantics, mirroring D34's `max(...)` rule for scope_match).

**See also:** [ADR-0011](adr/0011-locked-include-matching-rules.md) for the full trade-off analysis and the asymmetry rationale (constraint hierarchical vs symbol_note strict).

---

## D39. Symbol_note locked-include: strict anchor equality

**Decision:**

A `symbol_note` Card is **locked-include** when **any** of the card's `symbol_anchors` is a member of the retrieval request's `query_anchors` under **strict string equality** on the full anchor (case-sensitive, including any `Class.member` chain).

- A card anchored to `LedgerEntry.post` locks **only** when the query mentions `LedgerEntry.post` verbatim. A query for `LedgerEntry` alone does **not** lock it.
- A card anchored to `LedgerEntry` locks **only** for queries with `LedgerEntry` (the bare class). A query for `LedgerEntry.post` does **not** lock it.
- Authors who want both class-level and member-level coverage declare **both anchors explicitly** in frontmatter: `symbol_anchors: [LedgerEntry, LedgerEntry.post]`. Multi-anchor declaration is the supported breadth escape hatch — there is no implicit prefix or chain matching.

**Why strict equality:** symbol_notes are the most surgical card type. Loosening matching dilutes signal — a note about `LedgerEntry.post`'s rounding rule should not auto-fire on every `LedgerEntry` query unrelated to posting. The rule mirrors how the mention-extraction regex table in D32 already treats bare `PascalCase` and `PascalCase.member` as **distinct anchors**; locked-include matching at the same granularity keeps retrieval and locking consistent.

**Why multi-anchor lists (not fuzzy chain matching):** explicit and auditable. A symbol_note that fires for both class and member is an authoring decision visible in the frontmatter, not a hidden product behavior. When the v1.5 AST resolver lands and renames are tracked, multi-anchor declaration becomes the maintenance unit; fuzzy matching would have to be deprecated.

**Acceptable v1 cost:** silent staleness on rename. A card anchored to `LedgerEntry.post` becomes inert when the symbol is renamed to `LedgerEntry.record`. v1 has no AST resolution, so the `mark-needs-review` / `verify` commands plus the mention-extraction surface in `contexttrail scope inspect` are the coping mechanisms. This is documented in MVP.md week-3 acceptance.

**See also:** [ADR-0011](adr/0011-locked-include-matching-rules.md) — paired with D38, makes the constraint-hierarchical / symbol_note-strict asymmetry the load-bearing design choice.

---

## D40. Card-to-chunk linking: author-declared with inline suggestions

**Decision:**

Card-to-chunk links live in the `links` table (`from_object_id = card_id`, `to_object_id = chunk_version_id`, `link_type ∈ {covers, evidences, mentions}`). **All links are author-declared.** The system does **not** auto-derive links from anchor or scope overlap.

The authoring UX:

1. `contexttrail card add <type>` opens an editor for the card body.
2. On save, the CLI runs an in-process search using the card's anchors and scope to surface up to N candidate chunks (ranked by anchor overlap then scope_match).
3. The CLI prints each candidate with its drift and offers `[1,2,3,a=all,n=none]` selection. Selected chunk `version_id`s are written into the card's `linked_chunks:` frontmatter.
4. If the author selects `n=none`, the card saves with zero links. **No card type is gated on having links.** Evidence cards with zero links surface an `unlinked` cue in `contexttrail card list` and `contexttrail card show` so the author can revisit later, but the save itself is never blocked.
5. Authors can edit `linked_chunks:` directly in the markdown frontmatter at any time. `contexttrail card link <card> <chunk>` and `contexttrail card unlink <card> <chunk>` exist as helpers.

**Why author-declared (not auto-derive):** the `links` table powers the `needs_review` freshness signal (D41). That signal is only useful at high precision. Auto-derivation by anchor overlap would link every card to dozens of tangentially-related chunks; when any of those chunks rotated `version_id`, the card would flip `needs_review` for reasons unrelated to the card's actual claim. The signal becomes noise within a week.

**Why inline suggestions (not pure manual lookup):** zero-link cold-start is homework. The whole reason to suggest at authoring time is that the chunks the author _just read_ are the chunks they want to link to — surfacing those as one-keystroke choices makes the deliberate-linking model feel effortless instead of pedantic.

**Why no save gate on evidence cards:** even though `evidence` is the card type whose semantics most demand a link (it points at the source it evidences), forcing a link before save creates a false binary. Authors triage evidence cards in batches; an "unlinked" cue is enough surface to revisit without blocking the save loop.

**Anti-patterns this decision exists to block:**

- "Auto-link by anchor overlap and rely on the author to delete bad links." Inverts the work in the wrong direction; the author has to audit O(N) silent links instead of approve O(K) explicit ones.
- "Require evidence cards to declare at least one link." Punishes the common authoring rhythm of writing a batch of cards then linking in a follow-up pass.
- "Use a separate `auto_links` table alongside `links` to keep the staleness signal precise." Two link tables means two places `needs_review` must be computed; the seam is a bug factory.

**References:** ADR-0008 (this decision as ADR), [feedback memory: usable over correct](../.claude/projects/-Users-thomaschang-Repos-ContextTrail/memory/feedback_usable_over_correct.md).

---

## D41. Freshness materialized as a stored view over `links` + `version_id`

**Decision:**

`context_objects.freshness_state` is a **materialized** column written by the indexer, not computed at retrieval time. The materialization rule is:

- A Card transitions to `needs_review` when **any** of its outgoing `links` rows references a chunk whose current `version_id` differs from the link's pinned `to_object_id`. (Pinned `version_id` is captured at link creation time.)
- A Card transitions to `current` (or `verified` if explicitly verified by `contexttrail card verify`) when no links are stale and no manual `mark-needs-review` flag is set.
- A Card whose `to_object_id` references a tombstoned chunk transitions to `needs_review` with a distinct `tombstoned_link` reason surfaced in `contexttrail explain`.

**Two-flag model.** Freshness materialization is one signal; manual author review is another:

- `freshness_state` (materialized, derived from links): mechanically updated by the indexer.
- `author_review_state` (stored, manual): toggled only by `contexttrail card mark-needs-review` and `contexttrail card verify`.

`contexttrail card list` and the Context Pack render combine both signals into a single user-visible freshness label, with `contexttrail explain` decomposing them when asked.

**The invariant:** `freshness_state` MUST be reproducible from `(links.version_pin, current chunk version_ids, tombstones)`. If the materialized column ever disagrees with what the rule would compute, the materialization is wrong and the indexer is buggy. `contexttrail verify` (PRD-0002 deliverable) checks this invariant on every run.

**Why materialized (not computed at retrieval time):**

- The `freshness_state` column already exists in [SCHEMA.md](SCHEMA.md) as part of the substrate design. Treating it as derived would orphan the column.
- `contexttrail card list` and the indexer's freshness-bias multiplier (per CONTEXT.md `freshness` entry) are hot paths that benefit from a stored column.
- Manual `mark-needs-review` / `verify` is real stored state that has to live somewhere. Splitting "materialized derivation" from "manual override" into two columns keeps each lossless.

**Why rebuildable-from-canonical-truth:** the failure mode of materialization is silent drift between the column and the rule. The discipline that prevents this: never write `freshness_state` from any code path other than the indexer's link-walk. No CLI command, no migration, no future feature should mutate `freshness_state` directly. If you want to flip a card's review status, write to `author_review_state`.

**References:** ADR-0006 (authority/freshness orthogonality), [SCHEMA.md `freshness_state` column](SCHEMA.md), CONTEXT.md `freshness` entry.

---

## D42. Card type bias (1.2×) applies to non-locked Cards only

**Decision:**

The card type bias multiplier (default `1.2`, configurable as `retrieval.scoring.card_type_bias`) applies during the global ranker stage, **only** to Cards that did **not** lock-include via D38, D39, or D43. Locked-include Cards bypass the ranker entirely and are not subject to scoring at all.

Concretely, the scoring pipeline is:

1. Compute D38 / D39 locked-include set from matching constraints + symbol_notes. Then add any one-hop evidence promoted per D43. Pull this full locked set into the pack first (D37 budget rules).
2. For every remaining candidate (Doc Chunks + non-locked Cards), compute `final_score` per D34.
3. Multiply non-locked Cards' `final_score` by `card_type_bias` before greedy packing by `final_score / sqrt(token_count)`.

**Render order is driven by section labels, not by score arithmetic.** The Context Pack always renders sections in this order: `Locked rules` → `Symbol notes (locked)` → `Relevant docs` → `Evidence` → `Warnings` → `Omitted`. The multiplier is a ranking knob, never a presentation knob.

**Why non-locked-only:**

- Locked Cards are already in the pack by guarantee. Applying a score boost to something that's already included is mathematically meaningless and confusing in `contexttrail explain`.
- The bias exists to nudge non-locked Cards above Doc Chunks "at equal relevance" — it's a competitive signal, not a presentation signal. Conflating the two muddles tuning.

**Why one knob with one meaning:** when week-7 dogfood tunes `card_type_bias`, the question is "do authored Cards win ties against ambient prose?" That's testable. If the same number also affected locked-card rendering order, every tuning change would have a hidden second effect and tuning would be impossible to reason about.

**Edge case worth pinning:** a near-miss card — one that _would_ be locked if its scope matched, e.g. a `module: ledger` constraint when the request is `module: billing` — is non-locked under D38 and therefore _does_ receive the 1.2× bias in the ranker. This is intentional: "an authored constraint we trust, but slightly outside the request scope" still deserves a competitive edge over equally-scoring ambient prose, just not the lock-include guarantee.

---

## D43. Anchor-derived query scope inference with config fallback

**Decision:**

Request-level scope inference for explicit file anchors is driven by **anchored truth-bearing objects first**, with config conventions used only as fallback. The rule is:

1. For each requested file, gather candidate scopes from cards and chunks anchored to that file.
2. Filter obviously stale contributors before scope extraction when that signal is cheaply available.
3. Dedupe candidate scopes by canonical scope tuple.
4. Keep up to 10 unique scopes per file.
5. Only when anchor-derived inference returns **zero** scopes for a file may `code_scopes` config rules contribute fallback scopes for that file.
6. If both are empty, the file contributes no inferred scope.

This is the policy: **anchors are truth, config is fallback, empty is honest.**

**Why not config-first:** path conventions are useful, but they are not the same thing as authored or imported knowledge. Making them primary would let stale config override the substrate's actual anchored truth.

**Why not merge into one synthetic scope:** multiple cards/chunks can legitimately anchor a single file with different scopes. Retrieval already accepts `QueryScope[]` and resolves scope with OR semantics; preserving multiple candidate scopes is both simpler and more honest than inventing a merged scope.

**Why cap per file:** popular files can accumulate many anchors. The cap keeps observability readable and prevents inference bloat without changing retrieval semantics meaningfully.

**Implication:** `signal_empty` becomes a meaningful diagnosis rather than a silent degradation path. A user can provide structured signals, get no inferred scope, and be told that the failure is in grounding, not in ranking.

---

## D44. Evidence linked from locked cards is itself locked

**Decision:**

Evidence cards whose `covers:` list references an already-locked card are promoted into the `locked` set under a new lock reason:

- `evidence_covers_locked`

The traversal is intentionally bounded:

1. Resolve primary locked cards via D38 and D39.
2. Follow `covers:` links **one hop forward** from those primary locked cards to evidence cards.
3. Filter out `authority: deprecated` and `freshness_state: potentially_superseded`.
4. Rank remaining evidence deterministically.
5. Keep at most 2 evidence cards per primary locked card.
6. Dedupe promoted evidence across primaries.
7. Carry `derived_from: card_id[]` provenance on the lock reason.

**Why evidence belongs in locked:** if an evidence card is the concrete proof or test that justifies a locked rule, letting the ranker cut it defeats the purpose of authoring the `covers:` linkage in the first place. It is part of the same connected explanation.

**Why one hop only:** multi-hop evidence closure quickly turns into graph expansion instead of context selection. One hop is explainable, deterministic, and enough to solve the current "evidence buried at rank 65" failure mode.

**Why bounded fan-out:** evidence is helpful, but it is still additive locked overhead. A per-primary cap keeps the guarantee honest without requiring opaque per-pack arbitration across unrelated locked cards.

**See also:** [ADR-0011](adr/0011-locked-include-matching-rules.md) for the matching-rule amendment and [ADR-0010](adr/0010-locked-include-overflow-policy.md) for the budget consequences once evidence joins the locked tier.

---

## D45. Doc-role-aware demotion for anchored retrieval

**Decision:**

Doc chunks carry a `doc_role` that can affect ranking:

- `canonical`
- `ideation`
- `example`
- `archive`

Role precedence is:

1. frontmatter `doc_role`
2. path-pattern `doc_roles` config match
3. default `canonical`

The role multiplier applies to the chunk's final score after the existing scoring chain:

- `canonical`: `1.0`
- `ideation`: `0.5`
- `example`: `0.4`
- `archive`: `0.3`

`ideation` and `example` demotion apply only when **structured retrieval signals are present**. `archive` is always demoted.

**Why this exists:** ContextTrail's own docs contain many illustrative mentions of the same symbols and phrases that appear in implementation queries. Without a deterministic demotion path, example-heavy prose crowds out more useful operational context.

**Why not content heuristics:** content-based role inference is exactly the kind of silent, hard-to-audit behavior that deterministic retrieval is supposed to avoid. Role comes from authored metadata or explicit path rules, not latent interpretation.

**Why not demote ideation on broad natural-language queries:** when a query is genuinely broad and unanchored, ideation docs may still be the best available context. The demotion is a correction for anchored implementation queries, not a blanket judgment that ideation docs are low-value everywhere.

---

## D46. Retrieval query modes and observability split

**Decision:**

Every retrieval is classified into one of three query modes:

- `anchored`
- `signal_empty`
- `unanchored`

Definitions:

- `anchored` — structured retrieval signals are present and at least one inferred scope is recognized
- `signal_empty` — structured retrieval signals are present but no inferred scope is recognized
- `unanchored` — no structured retrieval signals are present

Always-on response fields carry only behavior-shaping diagnostics:

- top-level `query_mode`
- warnings (including `anchors_unrecognized`)

Deep observability remains behind `explain: true`, including:

- `query_compilation`
- `lock_failures`
- role-aware `per_chunk` traces

**Why split the surface this way:** production agents need to know when to react differently (`signal_empty` should prompt better anchors; `anchored` should trust demotion behavior), but they do not need the full debugging trace on every call. The current `warnings` + opt-in `explain` pattern already establishes this division of labor.

**Why `signal_empty` is first-class:** "the user gave no structure" and "the user gave structure but ContextTrail failed to ground it" are different failure modes. Collapsing them would hide the most actionable diagnosis in the current dogfood eval.

**Implication:** broad-query widening can be deferred cleanly. `unanchored` requests are explicitly tagged as such, so future work can improve them without mixing them into anchored correctness gates.

---

## D47. Anchored ranked precision separates relevance from packing density

**Decision:**

When a retrieval is `anchored`, non-locked candidates are adjusted by their structural support:

- `scope_match > 0`: multiplier `1.0`
- `scope_match = 0` and `mention_overlap > 0`: multiplier `0.15`
- `scope_match = 0` and `mention_overlap = 0`: multiplier `0.10`

This is a demotion, not a hard filter. A candidate that mentions the exact symbol/file/route still beats a pure lexical match, but anchored retrieval trusts matching scope more than example prose that happens to mention the same code string.

Packing still uses `packing_score = final_score / sqrt(token_count)` to fit useful context into the budget, but rendered / wire `ranked` output is displayed by relevance (`final_score`, then structural tie-breaks), not by packing density.

**Why this exists:** post-PRD-0005 dogfood eval showed that short canonical meta-doc chunks can win top-3 display positions by matching query words such as "refund", "audit", "Money", or "idempotency" while carrying no structural relationship to the provided file/symbol/route anchors. Anchored retrieval should trust structure enough to push those lexical-only matches down without hiding them entirely.

**Why not a hard filter:** lexical-only chunks can still be useful, especially when authored scope is sparse. Demotion preserves recall and omitted-summary observability while improving the first things an agent sees.

**Observability:** `explain.per_chunk.structural_multiplier` surfaces whether anchored structural demotion affected a candidate. Normal response schema is unchanged; the field is additive inside the opt-in explain block.

**Why separate display from packing:** packing density is a budget optimization, not an answer-quality claim. A short chunk may be cheap enough to include, but the `ranked` surface should present the highest-relevance included items first.

**Out of scope:** this does not change `unanchored` broad-query behavior, locked-include semantics, or the MCP response contract.

---

## D-week4-1. `retrieve_context_pack` MCP response shape

**Decision:**

The MCP tool `retrieve_context_pack` returns a structured response with the following fields, validated by the canonical zod schema at [`src/mcp/schemas.ts`](../src/mcp/schemas.ts) and JSONSchema-derived for the wire:

- `rendered_text?: string` — sectioned markdown matching the CLI's `contexttrail context` output (Locked rules → Symbol notes → Relevant docs → Evidence → Warnings → Omitted) **only when the caller opts in with `include_rendered_text: true`**. When present, bytes are identical between the two surfaces by construction; the contract equivalence test asserts it. The opt-in rule is the post-dogfood payload revision captured in [ADR-0012](adr/0012-retrieve-context-pack-rendered-text-opt-in.md).
- `locked: Array<LockedEntry>` — every locked-include Card with full `body`, `contexttrail`, `scope`, `tokens`, `card_type`, `lock_reason` (`constraint_scope_match` | `symbol_note_exact`), `broad_scope`, `freshness_state`, `freshness_warnings[]`. Bodies are inline; the agent never has to follow up with `get_doc_chunk` / `get_card` for the universal "give me everything in the pack" case.
- `ranked: Array<RankedEntry>` — Doc Chunks and non-locked Cards that won space in the budget, with `kind: "chunk" | "card"`, `score`, `tokens`, `scope`, `body`, `contexttrail`, `type_bias_applied`. Order is the renderer order (section-grouped, then by packing score within section, per D42).
- `omitted: { total, by_reason, top, truncated }` — summary metadata for omitted candidates. `total` is the full omitted count, `by_reason` is a reason histogram, `top` is the first bounded slice of omitted entries, and `truncated` flags that the full omitted list was longer than `top`. This is always present, even when `total = 0`. `by_reason` behaves like a sparse map on the wire: missing keys imply zero. The summary shape is the post-dogfood payload revision from [PRD-0004](prd/0004-mcp-payload-size.md): agents still need to know what _almost_ made it, but the wire no longer serializes hundreds of omitted entries by default.
- `warnings: Array<{ kind, message, hint? }>` — kinds enumerated in the schema (`no_matches`, `no_sources`, `locked_overflow` in v1; future kinds added by ADR).
- `budget: { requested, used, locked_overhead }` — `locked_overhead` surfaces the deficit when locked content exceeds the requested budget (D37, ADR-0010).
- `explain?: { per_chunk: [...] }` — only when `explain: true` is in the request; otherwise the field is absent so the wire stays small.

**Alternatives considered:**

- **Rendered-only (drop the structure).** Return only `rendered_text`. Loses the structural fields agents need to reason about _what_ they received vs. just paste it blind.
- **Structured-only (drop the rendering entirely).** Rejected for now. Forces every consumer to write a renderer and removes a useful debug/paste surface. The payload fix is to make `rendered_text` opt-in, not to forbid it.
- **Lazy bodies (return ids, agents fetch via `get_doc_chunk`).** Adds a round trip per included entry; turns the "give me everything in the pack" universal case into N+1 calls.
- **Unbounded `omitted` array.** Rejected after dogfood. It preserved full diagnostic fidelity but let response size grow with corpus size, which directly undermined the product promise of reducing context pressure.

**Why this shape wins:** structured fields remain the primary interface, bodies inline keeps the universal case a single round trip, and callers that truly want a ready-made dump can still opt into `rendered_text`. `omitted` remains a first-class signal, but in bounded summary form so "should I retry with a larger budget?" stays mechanical without making payload size scale with corpus size.

**Implication:** The week-4 contract remains locked, but payload-motivated revisions now live behind explicit contract records: [ADR-0012](adr/0012-retrieve-context-pack-rendered-text-opt-in.md) for `rendered_text` opt-in and [PRD-0004](prd/0004-mcp-payload-size.md) for omitted-summary follow-through. Any further breaking response-shape change still requires its own ADR (same discipline PRD-0001 applied to `contexttrail context --json`).

**Cross-refs:** [`src/mcp/schemas.ts`](../src/mcp/schemas.ts) is the canonical artifact; [`src/mcp/transform.ts`](../src/mcp/transform.ts) is the only place that maps internal pipeline shapes to wire shapes; the contract equivalence test at [`src/mcp/contract-equivalence.test.ts`](../src/mcp/contract-equivalence.test.ts) is the regression gate.

---

## D-week4-2. MCP no-matches semantics: valid result, structured warnings

**Decision:**

A retrieval that returns no matching content is a **valid result**, not an error. `retrieve_context_pack` returns:

- `locked: []`
- `ranked: []`
- `omitted: { total, by_reason, top, truncated }` (always present; populated with a bounded summary of the candidates that fell below threshold)
- `warnings: [{ kind: "no_matches", message, hint }]`
- `budget: { requested: N, used: 0, locked_overhead: 0 }`

When _no doc sources have been imported at all_ (the cache is empty), the warning kind is `no_sources` instead, with a `hint: "run contexttrail import docs <glob>"`. `no_sources` takes precedence over `no_matches` — if there's nothing to search, "nothing matched" is the wrong diagnosis.

**Locked-include is a hard guarantee independent of doc availability.** When matching constraints / symbol_notes exist but no Doc Chunks clear threshold, the response carries those locked Cards in `locked[]` and a `no_matches` warning to flag the absence of supporting docs. The locked-include semantics from D37 / D38 / D39 / ADR-0011 do not weaken under no-matches.

**Alternatives considered:**

- **Throw an MCP error.** Forces every agent to wrap retrieval in try/catch. The "no relevant context" case is an _outcome_, not a fault, and should propagate as data through the same channel as a successful retrieval.
- **Empty response without warnings.** Saves a few bytes but agents lose the signal to surface "no relevant context" to the user, and they have no hint to fix the configuration when the cause is `no_sources`.
- **String-typed warnings.** Lets us add new kinds without ceremony but defeats programmatic switching. Agents that want to surface a different message for `no_sources` vs. `no_matches` would parse free-form strings.

**Why structured warnings win:** the warning kind is the affordance the agent reasons over (`no_sources` → "tell user to run import"; `no_matches` → "tell user the budget might be too small or the task is off-scope"). Free text in `message` is for humans; the kind is for code. The omitted summary carries the extra quantitative detail (how much was left out, and why) without forcing the agent to ingest every omitted row.

**Implication:** `no_matches` and `no_sources` join `locked_overflow` as the v1 enumerated wire warning kinds. Internal-only pipeline warnings (`freshness`, `tombstoned_link`) are filtered at the MCP boundary; `freshness` information surfaces via the `freshness_warnings[]` field on each locked Card instead.

**Cross-refs:** edge-case fixtures at [`src/mcp/`](../src/mcp/) (added in PRD-0003 / 4c.1) lock the wire shape for each warning kind. The schema enum at [`src/mcp/schemas.ts`](../src/mcp/schemas.ts) is the source of truth for what kinds are legal.
