# ContextTrail — Foundational Architecture

> ⚠️ **Read [CORE.md](CORE.md) first.** This document is **forward-compatibility notes**, not v1 requirements. v1 ships a brutally simple product (docs → chunk → scope → index → retrieve → pack). This file documents the architectural choices that keep that simple product from becoming a dead-end when later features land. Read this only when you're making a schema or scaling decision and need to know what to leave room for.
>
> The substrate model below is _insurance against rework_, not a v1 deliverable. Don't let it make v1 feel bigger than it is.

---

This document defines the layered architecture that v1 ships and that every future feature (drift detection, verification, orchestration, multi-agent coordination) can build on without rewrites. The wedge is doc-first context retrieval; the platform is what it grows into _if_ the wedge proves out.

It is the document to read before making any change that affects core schemas, the retrieval pipeline, or the MCP tool surface. Everything in [DESIGN.md](DESIGN.md) is a specific decision; this is the frame those decisions live inside.

---

## The one design rule

```
ContextTrail never asks agents to trust ungrounded AI summaries.
It routes agents to source-grounded context and clearly separates
imported docs, accepted rules, candidates, and verified evidence.
```

Every architectural decision should be testable against this rule. Anything that violates it (silently accepting LLM output as authoritative, hiding source of inference, blurring authority levels) is rejected regardless of how convenient it would be.

This rule scales. It is what protects ContextTrail from becoming generic "AI knowledge graph" vaporware.

---

## Strategic claim

The long-term product is not _doc retrieval_. The platform is:

> An integrity/context graph for AI software work.

The wedge is:

> Retrieve the right slice of existing project docs for AI coding agents.

The wedge ships first because it has the clearest pain and the lowest cold-start cost. The platform is what the wedge _grows into_ — without rewrites — by adding source kinds, object kinds, and applications on top of a stable substrate.

---

## The four layers

```
Layer 4: Applications
  ├── Context Pack for coding agents (v1 wedge)
  ├── Spec-code drift detection (later)
  ├── Verification planning (later)
  ├── Agent orchestration (later)
  ├── PR review context (later)
  └── Multi-agent coordination (later)

Layer 3: Retrieval engine
  ├── retrieve_context_pack(task, files, symbols)        (v1)
  ├── retrieve_context_for_verification(change_event)   (later)
  ├── retrieve_context_for_spec_update(ticket)          (later)
  └── retrieve_context_for_review(PR)                   (later)

Layer 2: Context graph / index
  ├── ContextObjects (unified core)
  ├── Scope index (layered: company → team → project → module → symbol)
  ├── Authority index (accepted / imported / candidate / inferred)
  ├── Links (typed, source-aware, version-pinned)
  └── Freshness / version tracking

Layer 1: Source ingestion
  ├── markdown_file        (v1: docs)
  ├── card_file            (v1: cards)
  ├── future:notion        (later)
  ├── future:confluence    (later)
  ├── future:git_diff      (later — drives drift detection)
  ├── future:test_run      (later — drives evidence verification)
  ├── future:ticket        (later — drives spec atoms)
  └── future:agent_run     (later — drives orchestration)
```

**Layer 1** creates and updates ContextObjects. It does not directly drive product behavior.

**Layer 2** is the durable substrate. Stable schemas. Slow-changing.

**Layer 3** is the first real product surface. Reusable infrastructure across applications.

**Layer 4** is where new products live. Each one consumes Layer 3, never bypasses it.

---

## The five primitives that must be stable from day one

These are the abstractions to protect. They are designed once and extended later, never replaced.

### 1. ContextObject

The unifying primitive. DocChunks and ContextCards are both kinds of ContextObject; future entities (SpecAtom, Ticket, Task, ChangeEvent, EvidenceRun, AgentRun, VerificationResult) all fit the same shape.

```ts
type ContextObject = {
  id: string; // stable
  kind: ContextObjectKind; // discriminated: 'doc_chunk' | 'card' | future kinds
  source_id: string; // FK to sources table
  authority: Authority; // 'accepted' | 'imported' | 'candidate' | 'inferred'
  scope: ScopeRef; // layered scope
  content_ref: ContentRef; // pointer to body content (in extension table or inline)
  metadata: Record<string, unknown>; // type-specific fields go in extension tables
  version_id: string; // pinned identity for drift detection
  content_hash: string;
  source_hash: string;
  freshness: FreshnessState;
  indexed_at: string;
  updated_at: string;
};
```

**v1 implementation:** SQLite has a `context_objects` table holding the shared fields. Type-specific fields live in extension tables (`doc_chunk_ext`, `card_ext`). Adding a new kind = adding a new extension table; the core never changes.

**The MCP layer always returns ContextObjects** (with type-specific fields visible in metadata). Agents read a uniform shape regardless of source.

### 2. Source

Every ContextObject traces back to a Source. Sources are versioned and discriminated by kind.

```ts
type Source = {
  id: string;
  kind: SourceKind; // 'markdown_file' | 'card_file' | 'future:notion' | ...
  uri: string; // path, URL, or external identifier
  content_hash: string;
  last_indexed_at: string;
  metadata: Record<string, unknown>;
};
```

**Even though v1 only handles `markdown_file` and `card_file`, the abstraction is in place.** Adding Notion later is _register a new SourceKind + ingestion adapter_, not a schema migration.

### 3. Scope

The most important durable concept. The bridge between docs, code, specs, and agents across all four layers.

```ts
type ScopeRef = {
  layer: ScopeLayer; // 'company' | 'team' | 'project' | 'feature' | 'module' | 'symbol' | 'unknown'

  // Hierarchical fields populated based on layer
  company?: string;
  team?: string;
  project?: string;
  module?: string;
  feature?: string;
  domains?: string[];

  // Code anchors (populated by mention extraction or frontmatter)
  files?: string[];
  symbols?: string[];
  routes?: string[];

  // Origin tracking — used to weight retrieval confidence
  source: ScopeSource; // 'frontmatter' | 'config_rule' | 'path_inference' | 'mention_extraction' | 'unknown'
};
```

Used by:

- **v1 retrieval:** `task scope → relevant ContextObjects`
- **Drift detection (later):** `changed symbol → affected ContextObjects in same scope`
- **Orchestration (later):** `task scope → which agent / context / evidence applies`

### 4. Authority

What prevents the system from becoming AI-generated mush. Required forever.

```
accepted   > imported > candidate > inferred
```

| Level       | Meaning                                                                               | Used in retrieval?                                |
| ----------- | ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `accepted`  | Human-authored or human-confirmed; promoted to truth                                  | Always (default)                                  |
| `imported`  | External authoritative source (existing doc); not curated but authoritative-by-origin | Always (default)                                  |
| `candidate` | Machine-generated; awaiting human review                                              | Only with `--include-candidates` or planning mode |
| `inferred`  | Derived (mention extraction, embedding similarity); used as signal, never as fact     | Used as ranking signal, never standalone          |

**LLM output never elevates authority.** An LLM-suggested constraint is `candidate` until a human accepts it; after acceptance, it becomes `accepted` (the human's act of acceptance is what makes it authoritative).

Without authority discipline, orchestration becomes unsafe — agents cannot tell what they may rely on.

### 5. Link

Typed, source-aware, version-pinned. Forward-compatible with every future relationship kind.

```ts
type Link = {
  from_kind: ContextObjectKind | SourceKind;
  from_id: string;
  to_kind: ContextObjectKind | SourceKind;
  to_id: string;
  type: LinkType; // 'covers' | 'mentions' | 'evidences' | 'supersedes' | future kinds
  confidence: number; // 0.0 – 1.0
  source: LinkSource; // 'manual' | 'mention_extraction' | 'frontmatter' | 'agent_proposed' | ...
  version_pin?: string; // captures version_id of target at link creation, for drift detection
  created_at: string;
};
```

**Single typed `links` table** in v1 instead of separate per-type link tables. New link kinds add a `LinkType` value; no schema migration. This is what lets future drift detection reuse the same graph rather than inventing a new one.

### 6. Freshness / version

Every ContextObject tracks:

```ts
type FreshnessFields = {
  version_id: string; // hash(stable_key + content_hash)
  content_hash: string;
  source_hash: string; // parent source's hash
  freshness_state: FreshnessState; // 'verified' | 'unverified' | 'needs_review' | 'maybe_affected' | 'potentially_superseded' | 'deprecated'
  last_verified_sha?: string;
  last_indexed_at: string;
};
```

Even if v1 only uses these lightly (only cards have rich freshness; chunks are `current` or `tombstoned`), every object has the fields. This is what lets:

- **v1.5 drift detection** mark ContextObjects `needs_review` on linked code change
- **Verification (later)** track `last_verified_sha` and re-run evidence
- **Orchestration (later)** know when a Context Pack must be regenerated because its referenced objects drifted

---

## How future features build on the same engine

### Future 1: Drift detection

**No rewrite.** Add a new SourceKind: `git_diff`. Ingestion creates `ChangeEvent` ContextObjects from the diff. Then query the existing graph:

```
changed symbols → linked ContextObjects (via existing links)
                → mark linked objects 'needs_review' (via existing freshness)
                → emit warning naming affected objects
```

Same scope system. Same links. Same freshness states. Drift detection is _triggers_ feeding into infrastructure that already exists.

### Future 2: Verification layer

Add new ContextObjectKinds: `EvidenceRun`, `VerificationResult`. They link to existing cards via the existing `Link` table. Engine answers:

```
This constraint is accepted.
It links to this evidence (Link.type='evidences').
Evidence last passed at SHA abc123 (EvidenceRun.last_verified_sha).
Linked code changed at SHA def456 (ChangeEvent).
Therefore this constraint needs verification.
```

Again: extension, not rewrite.

### Future 3: Orchestration layer

Add ContextObjectKinds: `Task`, `AgentRun`, `ContextPackLog`, `Outcome`. The orchestrator does:

```
for this Task:
  retrieve_context_pack(task) → ContextPackLog
  assign agent → AgentRun
  observe code changes → ChangeEvent
  trigger verification → EvidenceRun
  agent proposes new cards/links → candidate ContextObjects
```

Same retrieval engine. Same context objects. Same authority model.

### Future 4: Spec/code alignment

Add ContextObjectKinds: `SpecAtom`, `AcceptanceCriterion`, `ImplementationLink`. Spec-code drift becomes:

```
SpecAtom links to symbols (via Link)
Symbol changed (via ChangeEvent)
SpecAtom marked 'needs_review' (via existing freshness)
```

Built on the same substrate.

---

## What v1 must NOT bake too deeply

To stay scalable, the internal model should not assume any of these are permanent:

- All context is markdown
- All scope is TypeScript symbols
- All cards are manually authored
- All retrieval is BM25
- All agents are Claude Code
- All docs live in repo forever

V1 can support only those things _operationally_. But the data model treats them as _current implementations_ of forward-compatible abstractions:

| Bake-too-deep risk                     | Forward-compatible alternative                                      |
| -------------------------------------- | ------------------------------------------------------------------- |
| `markdown_file` is the only source     | `Source.kind` is a discriminated union with `future:*` placeholders |
| Cards and DocChunks are sibling tables | `context_objects` core + extension tables                           |
| Links live in card frontmatter         | Single typed `links` table                                          |
| Symbols are TypeScript only            | `code_anchors` table abstracts over language                        |
| Authority is `accepted` boolean        | Authority enum with explicit levels                                 |
| Freshness is per-card                  | Every ContextObject has freshness fields                            |

Each abstraction costs ~one extra hour in v1. Skipping them costs days-to-weeks of rework later.

---

## What v1 keeps brutally simple

Scalable architecture does not mean building everything now.

V1 ships:

- Local markdown docs only
- Local markdown cards only
- SQLite cache (with WAL mode)
- BM25 / keyword retrieval
- MCP read-only
- Three card types (constraint, symbol_note, evidence)
- ContextTrail + Ralph for dogfood

The principle:

> Build the smallest useful product, but do not corrupt the core abstractions.

A narrow product on a stable substrate scales. A narrow product on a narrow substrate becomes a rewrite when the next feature lands.

---

## The architectural test

Before any v1 design decision is locked, it must pass:

1. **Does it serve the wedge?** (docs-first context retrieval for coding agents)
2. **Does it preserve the substrate?** (ContextObject, Source, Scope, Authority, Link, Freshness as forward-compatible primitives)
3. **Does it respect the design rule?** (never ungrounded AI summaries; source-grounded with explicit authority)
4. **Does it avoid the bake-too-deep list?** (no implementation details promoted to abstractions)
5. **Is it the smallest version that could work?** (no premature generalization beyond the five primitives)

Decisions that pass all five are good. Decisions that fail #2, #3, or #4 should be rejected even if they're convenient.

---

## AI policy

ContextTrail's retrieval engine must stand without AI. AI may be added only when it closes a concrete quality gap and can be removed without breaking the deterministic path. The live v1 example is setup-time Card bootstrap augmentation: it may draft candidate Cards or clarification needs, but the output lands in the inbox and is not authoritative until a human accepts it.

The architectural rule is deliberately stricter than "AI-ready" scaffolding:

- Do not add provider interfaces, `maybe*` hooks, telemetry tables, prompt directories, or MCP parameters before a real call site needs them.
- Do not let AI output become `accepted` authority directly. AI output is provisional (`candidate` / `inferred`) and reviewable.
- Keep AI behind the module whose current interface already owns the work. If LLM rerank lands, the retrieval module gets that seam then; not before.
- Record provenance and cost at the first real call site, not through speculative global middleware.

See [CORE.md](CORE.md#the-ai-rule) and [ADR-0004](adr/0004-bar-2-scope-with-embeddings-and-bootstrap.md). This section supersedes the earlier placeholder plan that proposed `NoneProvider`, global `maybe*` hooks, and no-op AI request parameters in v1.

## Cross-references

- [DESIGN.md](DESIGN.md) — specific design decisions with reasoning
- [SCHEMA.md](SCHEMA.md) — concrete schemas (with the substrate model applied)
- [MVP.md](MVP.md) — phase plan and v1 cut line
- [VISION.md](VISION.md) — what the substrate grows into
- [IDEAS.md](IDEAS.md) — design tangents and rejected ideas (incl. R2.18 competitor analysis)
- [OPEN.md](OPEN.md) — unresolved items
