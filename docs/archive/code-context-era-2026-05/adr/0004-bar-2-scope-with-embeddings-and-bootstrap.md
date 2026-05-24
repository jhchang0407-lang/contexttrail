# ADR-0004: Bar 2 scope — bootstrap in v1, embeddings optional later

**Status:** Accepted
**Date:** 2026-05-05
**Amended:** 2026-05-07

## Context

[MVP.md](../MVP.md) originally scoped v1 as a 5-week build with embeddings deferred to v1.5 and card bootstrap deferred to post-v1 priority #1. That scope was sized against an implicit time-pressure framing — "what's the smallest thing that ships?"

The author has no time pressure (sole developer, between roles, no external deadlines — see `memory/contexttrail_project.md`). The relevant question is therefore not *"what fits in 5 weeks?"* but *"what bar must v1 clear to be worth showing anyone?"*.

Three demo bars were considered:

- **Bar 1 — "It works on my repo."** The 5-week MVP. BM25 + scope + cards + MCP. Convinces the author. Easily dismissed by a stranger as "BM25 + a CLI" — Anthropic's own agents already retrieve from docs decently with their own attention, so the comparison "ContextTrail pack vs. naive doc dump" may not show daylight on tasks where the agent's own retrieval is sufficient.
- **Bar 2 — "It's visibly better than naive on someone else's repo."** Needs a stronger retrieval-and-packing story than Bar 1 plus a cold-start answer. Card bootstrap closes the cold-start gap; context assembly groundwork makes the final Pack more useful than "just retrieve the right chunks."
- **Bar 3 — "Competitive with commercial offerings."** Adds a real evaluation harness across 3+ repos, `propose_card` MCP tool, decision card type, polished docs + examples. This is the level where ContextTrail becomes a project people actually use rather than a portfolio piece.

## Decision

Scope v1 to **Bar 2.** Bar 1 is too easy to dismiss and does not test the wedge convincingly on a stranger's codebase. Bar 3 is the right ambition for v1.5+ but premature without first validating that Bar 2 holds up under dogfood.

### What this changes from MVP.md

| Item | Old plan | New plan |
|---|---|---|
| Embeddings | Deferred to v1.5 (`contexttrail setup embeddings`) | Optional later enhancement; not on the v1 critical path |
| Card bootstrap from docs | Post-v1 priority #1 | In v1, week 6 |
| Week 5 focus | Dogfood-only or semantic retrieval uplift | Context assembly groundwork |
| Calendar | 5–6 weeks | 7–8 weeks |

### What stays deferred

The deferred list is mostly unchanged. File watcher, CI/PR integration, multi-repo, AST fingerprinting, `propose_card` MCP tool, decision/feature_intent card types, and a polished docs site / examples gallery all remain post-v1. These do not change the strength of the wedge demonstration; they are polish for adoption, not proof of the hypothesis.

### Critical constraint: deterministic core stands alone

Embeddings are an **enhancement layer, not the substrate**. The deterministic core (BM25 + scope + heading-match + mention extraction) must be competent without embeddings or any LLM call. The current v1 sequencing spends week 5 on context assembly groundwork instead of embedding integration because the bigger product risk is "did we assemble a useful Pack?" rather than "did we retrieve semantically similar text?"

> If embeddings are required, you built a search engine.
> If embeddings are optional, you built a context engine.

Week-7 dogfood must still isolate the deterministic core from later enhancements. If the core is useless without semantic retrieval, the right response is to fix chunking / scope / ranking / assembly — not to hide weakness behind the model.

### Bootstrap is the one v1 AI feature

[CORE.md](../CORE.md) previously stated "v1 ships without AI features." Pulling bootstrap into v1 makes that wrong. The revised AI rule: *the deterministic engine must function without AI; specific enhancements that close clear gaps may use AI when the gap is concrete.* Bootstrap closes a concrete gap (cold-start with zero cards). Context assembly closes another (finding the right surrounding context once authoritative objects are identified). Bootstrap is the only AI-dependent v1 feature on the critical path.

The "if removed, does the system still function?" test still holds:
- Remove bootstrap → manual card authoring still works. ✓
- Remove embeddings → BM25 + scope retrieval still works. ✓

## Consequences

### Positive
- v1 is credible enough for OSS adoption and resume use; not dismissible as "just BM25"
- Semantic-retrieval strategy can be shaped later by real assembly failures instead of speculative architecture
- Bootstrap UX is informed by the actual feel of card authoring during week 3
- The "deterministic core stands alone" principle is enforced by sequencing: context assembly groundwork (week 5) and bootstrap (week 6) only land *after* the core has been measured (weeks 2–4 internal use)

### Negative
- Calendar grows from 5 to ~7–8 weeks
- Bootstrap still introduces an LLM dependency; embeddings do not need to land before v1 proves its wedge
- The `contexttrail doctor` and config surface still grow around bootstrap and setup
- More to dogfood, measure, and stabilize before "v1 done" is honest

### Deferred to week 6–7 grilling

Several decisions specific to bootstrap are not resolved by this ADR. Capture before week 6 starts:

- Bootstrap UX: inline during `contexttrail import` vs. explicit `contexttrail card bootstrap` step
- LLM provider for bootstrap: local (Ollama / llama.cpp) vs. hosted (Anthropic / OpenAI key) vs. both
- Bootstrap candidate storage: separate `.contexttrail/inbox/` directory vs. `status: candidate` on cards in the same dir
- Triage UX: inbox listing, accept/reject CLI, bulk operations
- Confidence thresholds and dedupe with manually-authored cards

Tracked in [OPEN.md](../OPEN.md) under "Deferred (open for week 6–7 grilling)."

### Deferred beyond v1-critical-path

- Embedding provider and storage placement
- Hybrid BM25 + cosine scoring details
- Semantic-recall experiments driven by real assembly misses rather than roadmap inertia

## References

- Grilling session 2026-05-05 where the Bar 1/2/3 framing surfaced and Bar 2 was selected
- `memory/contexttrail_scope_bar.md` — durable record of the decision and its principles
- [VISION.md §Foundational architecture](../VISION.md) — embeddings + bootstrap analysis (now elevated from "future" to "v1")
- [IDEAS.md R2.18](../IDEAS.md#r218--why-competitors-went-graph-heavy-and-what-to-borrow) — embeddings as the cheaper alternative to competitor knowledge graphs
