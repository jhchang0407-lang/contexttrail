# ContextTrail MVP — 7–8 Week Build Plan (Bar 2)

> ⚠️ Read [CORE.md](CORE.md) first if you haven't. The product is simple. This file is the week-by-week build of that simple product.
>
> History: this plan supersedes (1) a round-1 cards-first plan (preserved in [archive/v1-cards-first-mvp.md](archive/v1-cards-first-mvp.md)), and (2) a round-2 5-week docs-first plan that scoped to "Bar 1." The current plan keeps card bootstrap in v1, puts context assembly groundwork into week 5, and treats embeddings as optional later work rather than a v1 checkpoint.

## The product (recap)

```
docs → chunk → scope → index → retrieve → pack
```

Six verbs. That's the whole product. Everything below is how to build those six verbs in 5 weeks.

## Hypothesis to validate

> Given a coding task, can ContextTrail retrieve the right slice of an existing layered documentation set — better and more efficiently than the agent loading whole docs — while guaranteeing that authored hard-rule cards (constraints, symbol notes) are always included?

Three sub-hypotheses tested in week 7 dogfood:

1. **Token efficiency**: Context Pack uses ≥50% fewer tokens than naively dumping relevant docs.
2. **Subjective correctness**: ≥7/10 packs score 4 or 5 ("would I have shown the agent these chunks?").
3. **Behavior parity / lift**: ≥1 demonstration where the agent succeeded with ContextTrail's pack and would have failed (or used much more context) without it.

## Dogfood split

| Repo | Role |
|---|---|
| **ContextTrail** | Implementation dogfood. Validates engineering loop: import works, MCP works, schema holds. |
| **Ralph** (or fallback: a real OSS TypeScript repo with layered docs) | Product hypothesis dogfood. Has the layered context pain the product solves. |

ContextTrail alone is **insufficient** for the docs-first hypothesis — its docs were just authored by you, with full context. The pain doesn't exist there.

## Stack

Unchanged from round 1:

- Node.js + TypeScript
- `@modelcontextprotocol/sdk` (MCP server)
- `gray-matter` (frontmatter)
- `zod` (validation)
- `better-sqlite3` (rebuildable cache)
- `commander` or `yargs` (CLI)
- `vitest` (tests)
- `tsup` or `unbuild` (packaging)
- npm distribution

`ts-morph` deferred to v1.5+ (used for symbol extraction during card bootstrap).

## What ships in v1

### Doc Chunks (primary)
- Import markdown docs by glob (`contexttrail import docs <glob>...`)
- **Markdown parser:** `remark` + `unified` + `remark-gfm` + `gray-matter` (D28)
- **Tokenizer:** `gpt-tokenizer` with `cl100k_base` encoding — same as GPT-4 family, defensible token counts (D28)
- **Heading-based chunking** with cap (target 500 / max 900 tokens, no overlap):
  - `merge_adjacent_sections: false` — heading is the unit of meaning
  - `oversized_atomic_blocks: preserve_and_warn` — don't split code fences/tables/lists; emit oversized chunk + warning
  - `context_header: true` / `overlap_tokens: 0` — drift (`Source: ... > Section: A > B > C > Part: 2/3`) replaces prose-tail overlap (D30)
  - Section over max → greedy-fill to target (e.g., 1200 tokens → 500/500/200)
- **Chunk identity:** `stable_key = hash(source_path + heading_path + chunk_index_within_section)`; `version_id = hash(stable_key + content_hash)`. Insertions and reorders survive; rename of a heading invalidates (acceptable v1 cost) (D31)
- Snapshot in SQLite cache + content-hash change detection
- Implicit-on-retrieve re-indexing (with manual mode for large repos)
- **Layered scope:** `company > team > project > module > symbol > decision`. Scope tagging precedence: frontmatter (per-field override) > config glob rules > built-in path inference > unknown. No automatic project name from `docs/<segment>` (D33)
- **Code anchors via mention extraction (precision-first regex table):** explicit file paths (high if backticked), PascalCase.member chains (high if backticked), backticked routes with `:` or 2+ segments, env vars (`[A-Z][A-Z0-9_]{3,}` containing underscore), test files (`*.test.ts`, `*.spec.ts`, `*_test.py`). No bare PascalCase, no AST resolution, no LLM extraction in v1. Anchors are the stored noun; mentions are the process. (D32)

### Retrieval — deterministic core (the substrate)

The deterministic core must work on its own. Context assembly is the next v1 engine-hardening step; embeddings are optional later work, not a required checkpoint.

**Scoring formula (D34):**

```
text_score = 0.70 × BM25_norm + 0.30 × heading_match_score

final_score = text_score
            × (1 + 0.70 × scope_match_score)
            × (1 + 0.80 × mention_overlap_score)
            × specificity_weight(scope_layer)

packing_score = final_score / sqrt(token_count)
```

- BM25 via SQLite FTS5; normalized per-query so best match → 1.0
- `heading_match_score`: matched-task-terms / task-terms (Jaccard, lowercased, basic stem)
- `scope_match_score`: hierarchical (1.0 exact, 0.6 same project diff module, 0.3 same layer diff project, 0 otherwise); multi-scope queries OR'd; missing query scope → 0 (neutral)
- `mention_overlap_score`: matched-query-anchors / query-anchors; missing query anchors → 0 (neutral)
- `specificity_weight`: module 1.4 / project 1.2 / decision 1.1 / team 1.0 / company 0.9 / unknown 1.0
- Min final_score threshold 0.05 (drops tiny irrelevant chunks)
- All weights in `config.yaml` from day 1 — tunable without code edits

**Packing:** greedy by `final_score / sqrt(token_count)` until budget exhausted. Default 6,000 tokens. Presets: `small=4k / default=6k / large=10k`.

**`contexttrail explain`** is mandatory from day 1 — shows BM25, heading_match, scope_match, mention_overlap, specificity, text_score, final_score, token_count, packing_score, why included/omitted.

### Context assembly groundwork — week 5

- Add assembly evals on top of fact-finding quality.
- Use `assembly_need` to define what surrounding context belongs in a Pack.
- Scope the first pass to anchored implementation tasks where the primary source is already right but nearby structure still matters.
- Prove deterministic structural expansion first: parent context, selective same-doc siblings, and direct linked neighbors.
- Keep `signal_empty` and broad recovery behavior separate from this first assembly slice.
- Keep the work deterministic and inspectable through explain output and eval reporting.

### Cards (overlay) — week 3
- Three card types: `constraint`, `symbol_note`, `evidence`
- Markdown source-of-truth (frontmatter + body), one file per card
- Manual authoring in week 3; bootstrap proposes candidates in week 6
- Constraint guaranteed-include for matching scope
- Exact symbol_note guaranteed-include for matching symbols
- 1.2x type-bias for accepted cards over doc chunks at equal relevance
- Output: sectioned (Locked rules / Symbol notes / Relevant docs / Evidence / Warnings / Omitted) but ranked globally

### Card bootstrap (opt-in AI feature) — week 6
- `contexttrail card bootstrap` scans imported doc chunks, proposes constraint candidates to a triage inbox
- Closes the cold-start gap so a stranger installing ContextTrail sees signal in 60 seconds, not after 90 minutes of manual authoring
- LLM provider, candidate storage, and triage UX deferred to week 6 grilling — see [OPEN.md](OPEN.md)

### MCP server — week 4
- `retrieve_context_pack`, `get_doc_chunk`, `get_card`, `list_context_sources`
- Read-only (no `propose_card` in v1)

### Lifecycle
- Doc chunks: `current` / `tombstoned` only — no rich freshness states
- Card-to-chunk links carry chunk version_id; when content changes, linked card → `needs_review`
- Manual `contexttrail card mark-needs-review` and `contexttrail card verify` for cards
- AST fingerprinting deferred to v1.5+

### Forward-compatibility scaffolding — kept minimal

Per [ADR-0004](adr/0004-bar-2-scope-with-embeddings-and-bootstrap.md), the full forward-compat scaffolding from D26 is **cut**. v1 keeps only:

- **SQLite WAL mode** (`PRAGMA journal_mode=WAL`) — one line, free, protects future daemon mode

Everything else (`LLMProvider` / `EmbeddingProvider` interfaces, `maybe*` hooks, `extraction_runs` table, `.contexttrail/prompts/`, AI telemetry, MCP optional AI params, `contexttrail doctor` AI tier) lands when its first real call site lands. Don't build the abstraction until there are at least two things to abstract over.

### Project scaffold (D36)

Single npm package, `commander` CLI, domain-folder layout:

```
src/
  cli/         # init.ts, import.ts, index.ts, context.ts, scope-inspect.ts
  parse/       # markdown.ts, chunker.ts
  scope/       # rules.ts, resolve.ts
  extract/     # mentions.ts
  store/       # schema.ts, migrations.ts, db.ts
  retrieve/    # bm25.ts, pack.ts, score.ts
  assemble/    # sufficiency.ts, widening.ts     (week 5)
  bootstrap/   # propose.ts, inbox.ts            (week 6)
  config/      # load.ts, defaults.ts
  types/       # shared types — DocChunk, IndexedDocSource, Scope, Mention, ContextPack
  index.ts
```

Tests colocated as `*.test.ts` (vitest convention). Tests for the regex table, chunking edge cases, and scope resolution are non-negotiable for week 1.

## What is explicitly cut from v1

- All non-markdown doc sources (Notion, Confluence, Google Docs, PDF) — markdown only
- LLM rerank — defer until retrieval plus assembly leaves a measurable gap
- File watcher (manual or implicit-on-retrieve only)
- Card types: requirement, decision, feature_intent, conversation_fragment
- `propose_card` MCP tool (agents read-only in v1)
- Authority modes (planning / audit) — implementation mode only in v1
- Multi-repo / monorepo cross-context sharing
- CI integration, GitHub PR integration
- External doc sync, doc API integrations
- Python or any non-TypeScript language for code analysis
- Polished docs site / examples gallery beyond README
- Forward-compat AI scaffolding (`LLMProvider` interfaces, `maybe*` hooks, telemetry tables) — added per call site, not pre-emptively
- Vector index (`sqlite-vec`, hnswlib) — linear cosine over BLOB column is sufficient for v1 scale
- AST symbol resolution (`ts-morph`) — regex-only mention extraction in v1

## Week-by-week

### Week 1 — Doc import + chunking + scope + mention extraction

**Goal:** Import a real layered markdown doc set and produce queryable chunks with correct scope tagging and code anchors.

**CLI surface delivered:**

```
contexttrail init
contexttrail import docs <glob>...
contexttrail index
contexttrail scope inspect [--unknown]
```

#### Deliverables

Each row is a candidate issue (or set of issues) for `/to-issues`. Spec column tells the implementer which DESIGN.md decision and SCHEMA.md section to read.

| # | Component | Files | Spec |
|---|---|---|---|
| 1.1 | Project scaffold | `package.json` (`bin: contexttrail`, deps), `tsconfig.json`, `vitest.config.ts`, `src/cli/main.ts`, `src/types/*.ts`, `.gitignore` for `.contexttrail/cache/` | D36 |
| 1.2 | SQLite store | `src/store/schema.ts` (flat `doc_chunks` + `indexed_doc_sources`, WAL pragma, nullable `embedding` BLOB), `src/store/db.ts` (better-sqlite3 wrapper), `src/store/migrations.ts` (registry placeholder) | D29; [SCHEMA.md week 1–2 section](SCHEMA.md#sqlite-cache-schema--week-12-flat) |
| 1.3 | Markdown parser | `src/parse/markdown.ts` (remark + unified + gfm + gray-matter; exposes `parse(source) → { ast, frontmatter, lineMap }`) | D28 |
| 1.4 | Tokenizer | `src/parse/tokens.ts` (gpt-tokenizer cl100k_base wrapper; `count(text): number`) | D28 |
| 1.5 | Chunker | `src/parse/chunker.ts` — per D30: no merge, greedy-fill to target, preserve-and-warn for oversized atomic blocks, contexttrail-only (overlap=0), `chunk_index_within_section`. Identity per D31. | D30, D31 |
| 1.6 | Scope resolver | `src/scope/rules.ts` (config rule glob match), `src/scope/resolve.ts` (frontmatter per-field override → config rule → path inference → unknown; chunks inherit file scope; mentions augment chunk anchors only) | D33 |
| 1.7 | Code anchors (via mention extraction) | `src/extract/mentions.ts` (the regex table; produces `CodeAnchor` records) + colocated `mentions.test.ts` with positive + negative cases per row | D32 |
| 1.8 | Config | `src/config/load.ts` (read `.contexttrail/config.yaml` with zod), `src/config/defaults.ts` | [SCHEMA.md config section](SCHEMA.md#config-file-v1) |
| 1.9 | CLI: `contexttrail init` | `src/cli/init.ts` — creates `.contexttrail/`, `config.yaml` (from defaults), `cache/contexttrail.db` opened with WAL | — |
| 1.10 | CLI: `contexttrail import` | `src/cli/import.ts` — wires parse → chunk → scope → mentions → store; populates `indexed_doc_sources` | — |
| 1.11 | CLI: `contexttrail index` | `src/cli/index-cmd.ts` — re-scan via mtime+size fast-path; re-parse on `source_content_hash` change; tombstone removed chunks | D19 |
| 1.12 | CLI: `contexttrail scope inspect` | `src/cli/scope-inspect.ts` — per-chunk scope + extracted anchors + source line range; `--unknown` filter | — |

#### Acceptance

- `contexttrail init` in an empty repo creates `.contexttrail/` with config + WAL'd SQLite; idempotent (rerun is a no-op)
- `contexttrail import docs/**/*.md` against ContextTrail's own docs:
  - All chunks carry stable_key + version_id; intra-section identity verified by inserting a heading and confirming sibling stable_keys survive (test)
  - Token counts respect target/max caps; oversized atomic blocks emit warnings, not splits
  - Frontmatter overrides per-field over config rules
- `contexttrail scope inspect --unknown` returns a small, justified list (no false-unknowns on real docs)
- `contexttrail scope inspect` mention output audited on a 50-chunk sample; regex false-positive rate <5%
- `contexttrail index` is a no-op when sources unchanged (mtime+size fast path); reindexes when `source_content_hash` changes
- All component unit tests pass (chunker edge cases A/B/C/D, mentions table per row, scope resolver precedence)

#### Out of scope this week

Cards (week 3), retrieval (week 2), context assembly groundwork (week 5), bootstrap (week 6), MCP server (week 4), substrate migration (week 3).

---

### Week 2 — Deterministic retrieval + Context Pack CLI

**Goal:** Given a task + files + symbols, return a Context Pack of doc chunks (no cards yet) using the locked hybrid scoring formula.

**CLI surface delivered:**

```
contexttrail context "task" --files X --symbols Y [--budget small|default|large] [--json] [--explain]
```

#### Deliverables

| # | Component | Files | Spec |
|---|---|---|---|
| 2.1 | FTS5 + BM25 | `src/retrieve/bm25.ts` — populate FTS5 virtual table at index time; `score(query) → BM25_norm` per-query normalized to [0,1] (raw = -bm25, divide by max raw for query) | D34 |
| 2.2 | Heading match | `src/retrieve/heading-match.ts` — Jaccard of stemmed (basic lowercase + singularize) task tokens vs joined `heading_path` | D34 |
| 2.3 | Scope match | `src/retrieve/scope-match.ts` — hierarchical (1.0 / 0.6 / 0.3 / 0); multi-query-scope OR via `max(...)`; missing query scope → 0 | D34 |
| 2.4 | Mention overlap | `src/retrieve/mention-overlap.ts` — `matched_query_anchors / query_anchors`; missing query anchors → 0 | D34 |
| 2.5 | Specificity weight | `src/retrieve/specificity.ts` — lookup table from `config.retrieval.scoring.specificity_weight` | D34 |
| 2.6 | Score combiner | `src/retrieve/score.ts` — `text_score = w_bm25·BM25 + w_heading·heading`; `final_score = text_score × (1+w_scope·...) × (1+w_mentions·...) × specificity`; apply `min_final_score` threshold | D34 |
| 2.7 | Query scope inference | `src/retrieve/query-scope.ts` — infer scope (project/module) from `--files` paths via the same scope-rules used at import; multi-file produces multi-scope | D33, D34 |
| 2.8 | Packer | `src/retrieve/pack.ts` — greedy by `final_score / sqrt(token_count)` until budget; emit section labels (Relevant docs / Omitted) | D34 |
| 2.9 | Explain trace | `src/retrieve/explain.ts` — per-chunk score breakdown table; included/omitted reason | D34 |
| 2.10 | Context Pack rendering | `src/retrieve/render.ts` — text output (default) and `--json`; chunk bodies prefixed with contexttrail context header | D30 |
| 2.11 | CLI: `contexttrail context` | `src/cli/context.ts` — parse args → query scope → score → pack → render; `--explain` surfaces trace; `--budget small\|default\|large` selects token budget | — |
| 2.12 | Config wiring | extend `src/config/defaults.ts` with `retrieval.scoring.*` weights and `retrieval.budgets.*` so weights tune without code edits | [SCHEMA.md retrieval block](SCHEMA.md) |

#### Acceptance

- For 5 hand-picked tasks against ContextTrail's own docs:
  - `contexttrail context "..."` returns ≤6 chunks within the chosen budget
  - Subjective score 4–5 on ≥4 of 5 ("would I have shown the agent these chunks?")
  - `contexttrail explain` produces a clear per-chunk breakdown showing which signal drove inclusion
- Empty query scope (`--files` and `--symbols` omitted): `scope_match` and `mention_overlap` degrade to 0 (neutral), and `BM25 + heading_match` still return sensible chunks
- Multi-file query (e.g. `--files src/a.ts src/b.ts`): scope match ORs via `max(...)` and is verified by a unit test
- `min_final_score: 0.05` threshold drops tiny irrelevant chunks (validated with a contrived noise test)
- All scoring weights are read from `config.yaml`; flipping `w_heading` to 0 in config (without code edits) measurably changes ranking
- `--json` output schema documented in README and stable (will be the contract for week-4 MCP)

#### Out of scope this week

Cards (week 3), card-aware locking, context assembly groundwork (week 5), MCP server (week 4), bootstrap (week 6).

### Week 3 — Cards overlay + substrate migration + locked guarantee

**Phase PRD:** [PRD-0002 — Cards, locked-include, substrate migration](prd/0002-week-3-cards-and-substrate.md). The detailed deliverables, checkpoints (3a cards-on-flat → 3b migration → 3c robustness), and acceptance criteria live there.

**Goal in one paragraph:** Layer the three v1 card types (`constraint`, `symbol_note`, `evidence`) on top of doc retrieval with a *locked-include* guarantee — matching constraints (D38, hierarchical-down scope) and matching symbol_notes (D39, strict anchor equality) bypass the ranker and are pulled into every Pack as must-read, with budget as a hard guarantee for locked content (D37). Then migrate the cache from flat `doc_chunks` + `indexed_doc_sources` to the substrate model (`context_objects` + `doc_chunk_ext` + `card_ext` + `links`) — gated by ADR-0009's fixture round-trip and identical-pack invariants. Finally, install the robustness scaffolding (`contexttrail verify`, golden corpus, snapshot tests, property tests, E2E cold-install) that every later phase will rely on.

**Success criterion:** 6–8 constraints, 4–6 symbol_notes, 2–3 evidence cards authored against fundops dogfood docs (per [ADR-0003](adr/0003-layered-dogfood-strategy.md)). Constraints reliably appear in matching task packs as locked must-read. Substrate migration passes both invariants on the frozen fixture corpus before touching real data.

### Week 4 — MCP server (read-only)

**Phase PRD:** [PRD-0003 — MCP server (read-only)](prd/0003-week-4-mcp-server.md). The detailed tool surface, response contract, error semantics, and acceptance criteria live there.

**Goal in one paragraph:** Expose ContextTrail as an MCP server over stdio with four read-only tools (`retrieve_context_pack`, `get_doc_chunk`, `get_card`, `list_context_sources`). The `retrieve_context_pack` response is structured (locked / ranked / omitted / warnings / budget) with full bodies inline and a `rendered_text` convenience field — agents that just want context paste `rendered_text`, agents that want to introspect have full structure. No-matches and no-sources are valid results, not errors; locked cards still return even when no docs clear threshold. Document the Claude Code wiring in README so a real agent session can call ContextTrail natively.

**Success criterion:** A real Claude Code session, configured per the documented setup, calls `retrieve_context_pack` against ContextTrail's own docs and receives a sensible pack. The response contract matches the schema asserted in the contract test for every golden task from PRD-0002.

### Week 5 — Context assembly groundwork

**Goal:** Bridge from fact-finding quality to assembled Context Packs. Prove the engine can decide what surrounding context belongs once the right authoritative objects are found, starting with a narrow anchored-implementation slice.

Build:

- assembly eval cases layered on the retrieval fixture corpus
- explicit assembly expectations grouped by `assembly_need`
- a minimal structural expansion ladder: `primary_only` -> `parent` -> `siblings` -> `linked_neighbor`
- minimal-sufficient-stage expectations for targeted assembly cases
- stage-level over-expansion checks so bigger packs do not count as free wins
- `contexttrail explain` / eval reporting extended to make assembly decisions inspectable

The first linked-neighbor policy is intentionally conservative. Week 5 is proving the basics of deterministic structural assembly, not freezing the final neighbor model forever.

Not the first target of week 5:

- broad-query widening for under-specified requests
- `signal_empty` recovery behavior
- semantic or embedding-driven neighbor discovery

**Success:** Re-run the week-2 + week-4 evaluation tasks and the expanded fixture eval with assembly expectations added. Show that structural assembly improves usefulness on anchored implementation cases without regressing locked correctness, canonical-source ranking, or omission honesty.

If the targeted offline eval clearly wins, week 5 should also wire that same narrow structural behavior into live `retrieve_context_pack` behavior for anchored implementation queries. Week 6 and week 7 should build on the real runtime path, not only on a benchmark.

This should not introduce a new user-facing config toggle. The rollout boundary is the query slice itself, and the explain/reporting surface must show the assembly root, stage reached, neighbor reasons, and early-stop decision.

The response split should stay consistent with the current MCP contract: a minimal assembly stage summary may be always-on, while detailed assembly reasons live under `explain`.

That summary should distinguish "assembly did not apply" from "assembly ran and stopped at the root" so `not_applicable` and `primary_only` are not collapsed.

### Week 6 — Card bootstrap + triage inbox

**Goal:** Close the cold-start gap on top of the week-5 structural assembly baseline. New users get high-confidence constraint candidates from their imported docs without writing a card.

Build:

- `contexttrail card bootstrap` is an explicit opt-in command, not part of `contexttrail import`
- Bootstrap uses a hosted provider by default in the first slice
- Bootstrap scans imported doc chunks and proposes `constraint` and `symbol_note` candidates into a local `.contexttrail/inbox/`
- Triage CLI: `contexttrail inbox list`, `contexttrail inbox accept <id>`, `contexttrail inbox reject <id>`, `contexttrail inbox show <id>`
- The inbox is gitignored by default; accepted cards move into `.contexttrail/cards/` and become the shared repo truth
- Confidence thresholds, dedupe with manually-authored cards, and exact candidate field shape are still part of the week-6 implementation work; see [OPEN.md](OPEN.md)
- Bootstrap candidates flow into the same retrieval pipeline as candidates (lower bias, never auto-locked)
- Week 6 assumes only the narrow structural assembly slice from week 5, not broad recovery or semantic widening, is available underneath it
- Deliberately deferred beyond the first week-6 slice: `evidence` candidates and code/test-driven bootstrap sources

**Success:** Run `contexttrail card bootstrap` against fundops docs cold (no manually-authored cards). Inbox produces ≥10 candidates; ≥6 are accepted on triage. Demo: a fresh checkout of fundops produces a usable Context Pack within 5 minutes of `contexttrail import`, using the same narrow structural assembly baseline proven in week 5.

### Week 7 — Dogfood + measurement

**Goal:** Run the validation protocol against the success criterion. The week-6 bootstrap and the week-5 structural assembly baseline are now both available, so measurement is layered.

Week-7 follow-up questions to keep visible during measurement:

- Did the doc-chunk-only bootstrap source produce strong enough candidates, or is it time to add code/test sources?
- Did the local inbox + accept-to-cards workflow feel good enough before thinking about team/shared candidate flows?
- Did the accepted `constraint` and `symbol_note` cards cover most of the cold-start value, or is it time to add `evidence` candidates with a clearer verification story?

Validation protocol per task (×10 minimum on fundops):

1. Write task prompt
2. Run `contexttrail context` with files/symbols
3. Save Context Pack
4. Estimate naive docs you'd have shown manually
5. Compute token count: pack vs. naive
6. Score subjective correctness 1–5
7. Note omissions and noise

**Three-axis comparison** for at least 3 tasks:

- **A:** Manual cards + fact-finding only
- **B:** Manual cards + structural-assembly-enabled packing
- **C:** Bootstrap-only cards + structural-assembly-enabled packing (cold-start scenario)

This separates "is the core useful?" from "does the narrow structural assembly slice improve the final Pack?" from "does bootstrap close cold-start usefully?"

For 3 tasks, also run **behavior parity**: agent with vs without pack, compare outcomes.

Log per task:

```
.contexttrail/cache/retrieval-log.jsonl
  - task
  - repo
  - files / symbols / scope
  - pack_token_count
  - naive_token_count
  - reduction_pct
  - subjective_score
  - missing_context
  - irrelevant_context
  - assembly_enabled (bool)
  - cards_source (manual | bootstrap | mixed)
  - agent_outcome (annotated post-hoc)
  - notes
```

**Headline success criterion (Bar 2):**

```
≥10 real fundops tasks evaluated
≥7/10 packs score 4 or 5 in scenario A (deterministic core, manual cards)
≥7/10 packs score 4 or 5 in scenario B (assembly-enabled)
≥6/10 packs score 4 or 5 in scenario C (bootstrap-only cards)
average token reduction ≥50% across all scenarios
≥1 clear behavior-parity or behavior-lift demonstration
```

The scenario-A bar is the stand-alone-core test. Failing it means the deterministic core needs work, not that semantic retrieval should be promoted into the critical path.

**Drift-substrate readiness criterion (load-bearing for v1.5+):**

The v1's job is not only to retrieve well — it's to be the substrate drift detection (v1.5) builds on. Because the long-term product is drift detection (and ultimately the integrity / orchestration layer), the substrate's correctness matters more than retrieval headline numbers. A v1 that passes the headline criterion but fails the substrate readiness check is a dead end for v2.

Verify, at minimum:

```
Edit a doc; confirm linked cards transition to `needs_review` automatically (chunk version_id rotates, link triggers freshness change).
Author/edit a card; confirm code anchor extraction picks up the right symbols/files and links pin chunk version_ids correctly.
Modify a chunk's source heading and verify stable_key + version_id behavior matches D31 (insertions and reorders survive; rename invalidates as expected).
Tombstone a chunk by removing the section from source; confirm linked cards surface a tombstone warning.
The mention-extraction → code-anchor pipeline produces reliable, low-false-positive anchors that AST fingerprinting (v1.5) can pivot off.
```

If the headline retrieval criterion is met but the substrate readiness check fails, **fix the substrate before declaring v1 done** — drift detection's reliability in v1.5 will inherit every fragility v1 leaves in.

**Redesign retrieval if:**
- Packs are small but miss key docs
- Packs include too much irrelevant prose
- Scope tagging fails repeatedly
- Chunking breaks useful context
- Fact-finding is strong, but assembled Context Packs still miss obvious surrounding context needed to do the work

### Week 8 — Stabilization (only what week 7 surfaces)

**Goal:** Address the specific issues raised in week 7. Polish the README and packaging only enough that a stranger can install and reproduce the demo, and only broaden assembly behavior if week-7 evidence shows the narrow structural baseline is already solid.

This is a flex week. If week 7 went smoothly, it's largely a docs + npm publishing pass. If week 7 surfaced real issues, this is where they get fixed before declaring v1 done.

Explicitly *not* in week 8:
- Polished docs site (post-v1)
- Examples gallery (post-v1)
- Marketing
- Multi-repo support (deferred)
- Anything from the cut list above

### Week 9 — Setup initialization and confidence-guided onboarding (post-v1)

**Goal:** Turn repo onboarding into a first-class product surface. Help a new repo become retrieval-ready without promoting suggestions into accepted truth automatically.

Build:

- a setup-initialization flow above `contexttrail init`
- deterministic repo scan for likely import roots, scope patterns, and unknowns
- readiness/status output showing confidence by domain
- retrieval probes as part of setup completion
- a small high-leverage question loop for unresolved authority or scope boundaries
- setup/admin MCP surfaces that preserve the ADR-0014 authority boundary

**Success:** A new repo can reach a first useful Context Pack in under 10 minutes, with setup quality reported separately from retrieval quality and without silent truth promotion. See [PRD-0007](prd/0007-week-9-setup-initialization-and-confidence.md).

## Post-v1 priorities (named now to anchor v1.5+)

The long-term product is drift detection on the v1 substrate (and beyond that, the integrity / orchestration layer). The post-v1 list is reordered to reflect that — drift-relevant work is at the top, retrieval polish is below.

### Tier 1 — setup initialization and onboarding quality

1. **Setup initialization flow** — guide a new repo from `contexttrail init` to "ready for normal agent work" using deterministic scanning, suggested setup choices, retrieval probes, and confidence reporting. This is the first post-v1 slice because it reduces onboarding friction without changing the truth boundary. See [PRD-0007](prd/0007-week-9-setup-initialization-and-confidence.md).
2. **Setup status model** — report domain coverage, authority clarity, conflict status, and retrieval probe pass rate in a form the user can actually act on.
3. **Setup/admin MCP tools** — expose repo-scan, unknowns, and confirmable setup choices to an MCP agent while keeping accepted truth behind explicit human approval.

### Tier 2 — drift detection unlock (the v1.5 headline)

These items together make drift detection real. Build them as a coherent v1.5, not as scattered features.

4. **AST fingerprinting** — `ts-morph`-based code-side change detection. Snapshot the symbol surface (functions, classes, methods, exported types) at index time; on re-index, diff against the previous snapshot to identify semantically meaningful changes. This is the missing signal that turns v1's chunk-card linking into actual drift detection. **The single highest-leverage drift feature after setup onboarding.**
5. **Drift detection loop** — when AST fingerprinting reports a symbol changed, scan all chunks and cards anchored to that symbol; transition them to `needs_review` with a `triggered_by` reason. Mechanical, deterministic, no LLM. The version_id rotation mechanism in v1 is the seed; this extends it from doc-edit drift to code-edit drift.
6. **`drift review` CLI** — list chunks/cards in non-verified freshness states; show the triggering change; allow `mark verified` (with optional note), `mark superseded`, `bump scope`, or `archive`. The human-in-the-loop surface for drift response.
7. **MCP `list_drift` tool** — agents can query "what's stale that I might be about to touch?" before editing. Pairs with `retrieve_context_pack` to give the agent both *what to read* and *what to be careful about*.

### Tier 3 — capture loop and card ergonomics

8. **`propose_card` MCP tool** — agents propose constraint/symbol_note candidates back to the inbox during work. Closes the capture loop. Same triage UX as week-6 bootstrap.
9. **Decision and feature_intent card types** — once the constraint/symbol_note workflow is proven on Bar 2. Decisions especially valuable for the "why was this designed this way" context that prevents agent over-simplification.

### Tier 4 — coverage and breadth

10. **External doc sources** — Notion, Confluence, Google Docs converters. One at a time, validated separately.
11. **Multi-repo / monorepo cross-context** — shared cards across repos at the company / team layer.
12. **CI / GitHub PR integration** — show retrieved Context Pack as PR comment; fail CI when changes touch a `needs_review` constraint with no fresh evidence.
13. **File watcher mode** — quality-of-life for active development.

### Tier 5 — retrieval polish (only if measurement demands)

14. **Support closure** (from prune.codes) — if a chunk references a symbol, also include the chunk that defines it. Goes beyond top-K. Build only if week-7 dogfood shows a "missing definitions" failure pattern.
15. **Connected-subgraph packing** (from prune.codes) — prefer chunks that form a connected explanation over flat top-K. Steiner-ish/beam selector. Build only if simple top-K leaves measurable gaps.
16. **Scope-graph debugging view** — `drift graph show --task "..."` renders the deterministic traversal. No LLM required; makes the implicit graph legible.
17. **LLM rerank** — only if week-7 measurement shows retrieval plus assembly plus structural signals still leaves a measurable gap. Skip otherwise — rerank is the canonical RAG over-engineering trap.
18. **Vector index** (`sqlite-vec` or hnswlib) — only when chunk count crosses ~100k and linear cosine becomes the bottleneck. Not before.

The bigger picture: v1 builds the substrate, the first post-v1 slice improves setup onboarding (Tier 1), v1.5 unlocks drift on that substrate (Tier 2), and v2+ builds the integrity / orchestration layer above. The retrieval polish in Tier 5 exists only to keep the substrate honest — it's not the road to the destination.

See [VISION.md](VISION.md) for the full furnished product and [IDEAS.md](IDEAS.md) for design tangents and competitor analysis (including [R2.19](IDEAS.md#r219--competitive-landscape-may-2026-sweep) on the May 2026 sweep).
