# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

**Single-context repo.** No `CONTEXT-MAP.md`. There is one product surface (ContextTrail v1).

```
/
├── CLAUDE.md                          ← this file's parent (agent skill config)
├── docs/
│   ├── CONTEXT.md                     ← glossary (NOT at repo root — at docs/)
│   ├── DESIGN.md                      ← numbered design decisions (D1, D2, ... D42+)
│   ├── SCHEMA.md                      ← canonical schema reference
│   ├── MVP.md                         ← phase index pointing at PRDs
│   ├── CORE.md                        ← welcome mat / product framing
│   ├── ARCHITECTURE.md                ← substrate model
│   ├── VISION.md                      ← long-term ambitions
│   ├── IDEAS.md                       ← parking lot
│   ├── OPEN.md                        ← running questions
│   ├── adr/                           ← architectural decision records (ADR-0001+)
│   ├── prd/                           ← phase PRDs (PRD-0001+; one per phase)
│   ├── agents/                        ← this file's directory
│   ├── archive/                       ← retired plans
│   └── runbooks/                      ← (lazily created when first runbook is written)
└── src/
```

## Before exploring, read these

Read in this order when working on a task:

1. **[`docs/CORE.md`](../CORE.md)** — product framing in one page.
2. **[`docs/CONTEXT.md`](../CONTEXT.md)** — glossary. Source of truth for every domain term.
3. **The active phase PRD** — `docs/prd/<NNNN-week-N-*.md>`. Find the phase you're working on; that PRD is the executable spec.
4. **[`docs/adr/`](../adr/)** — read ADRs that touch the area you're about to work in. Critical ones for week 3+: ADR-0005 (two-phase schema), ADR-0006 (authority/freshness), ADR-0008 (linking), ADR-0009 (migration gate), ADR-0010 (locked overflow), ADR-0011 (locked-include matching).
5. **[`docs/DESIGN.md`](../DESIGN.md)** — for the specific D-numbered decision a PRD references.
6. **[`docs/SCHEMA.md`](../SCHEMA.md)** — for any schema or config question.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skills (`/grill-with-docs`, `/to-prd`, `/to-issues`) create them lazily as decisions resolve.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name, a code identifier), use the term as defined in [`docs/CONTEXT.md`](../CONTEXT.md). Don't drift to synonyms the glossary explicitly avoids.

Banned terms (per CONTEXT.md "Flagged ambiguities"):

- ❌ "status" — collapsed to **`authority`** for cards and **`lifecycle`** (`current | tombstoned`) for Doc Chunks.
- ❌ "reference" — ambiguous between **`code anchor`** (object → external code string) and **`link`** (object → object). Pick one.
- ❌ "stored mention" — use **`code anchor`** (the noun). "Mention" only appears inside the phrase **`mention extraction`** (the process).
- ❌ "scope layer" — use **`layer`** alone when the surrounding context is `scope`.
- ❌ "query scope" at retrieval time — use **`query anchors`** (with scope inferred from them).

Load-bearing terms to use exact-string: `Doc Chunk`, `Card`, `Context Pack`, `Context Object`, `code anchor`, `link`, `version_pin`, `scope`, `layer`, `query anchors`, `scope_match`, `mention_overlap`, `retrieval pipeline`, `retrieval request`, `retrieval`, `authority`, `freshness`, `author_review_state`, `locked-include`, `locked_overflow`, `broad_scope`.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0008 (card-to-chunk linking is author-declared) — but worth reopening because…_

The same applies to D-numbered decisions in DESIGN.md. Reopening a decision is fine; doing it without naming the contradicted decision is not.

## Phase-scoped PRDs vs project-coherent docs

Two layers of docs with different update rules:

**Project-coherent (single source, edited in place across phases):**
- `CORE.md`, `CONTEXT.md`, `DESIGN.md`, `SCHEMA.md`, `OPEN.md`, `IDEAS.md`, `INCIDENTS.md`, `docs/adr/`

**Phase-scoped (one file per phase, frozen when phase completes):**
- `docs/prd/0001-weeks-1-2-foundation.md` — weeks 1–2 (foundation)
- `docs/prd/0002-week-3-cards-and-substrate.md` — week 3 (cards + substrate migration)
- `docs/prd/0003-week-4-mcp-server.md` — week 4 (MCP read-only server)
- (Future: 0004-week-5-embeddings.md, 0005-week-6-bootstrap.md, 0006-week-7-dogfood.md)

When opening a new session for a specific phase, the read protocol is: `CORE.md` → `CONTEXT.md` → `docs/prd/<active-phase>.md`. Three files, full context, no spelunking.
