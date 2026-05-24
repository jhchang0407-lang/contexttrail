# Phase 0 — Session Log (fastapi pilot)

> One entry per real coding / exploration session where ContextTrail was active. Aim for ≥5 sessions over the 1-2 week Phase 0 window. Each session ≥30 min on something you'd want to learn about fastapi (or actually accomplish in it).
>
> The signal lives in **specifics**. "It was useful" is noise. "Asked about dependency injection scope; pack surfaced the right tutorial doc + a related doc on yield-based DI I didn't know existed" is gold.

## Template

```markdown
### Session N — <date>

**Duration:** N minutes
**Goal / question(s):**
- specific question 1
- specific question 2

**Drift results:**
- Q1: [pack contained right thing | partial | wrong | abstained honestly]; specifics: ...
- Q2: ...

**Fell back to:** grep | reading code | docs site directly | gave up
**Useful moments (specific):**
- ...

**Failure moments (specific):**
- ...

**Friction noticed but not bug-worthy:** ...
```

## Sessions

### Session 1 — 2026-05-11

**Duration:** ~90 minutes (continuous; all four questions one after another)
**Goal:** Validate that MCP retrieval works end-to-end on fastapi corpus and produces useful agent responses across four query shapes (domain-specific, architectural, edge-case, negative-test).

#### Q1 — "What does fastapi say about password storage and security?"

**Drift results:** pack contained right material; agent delegated parsing to a subagent (pack was large enough to warrant it).

**Useful moments (specific):**
- Version-aware disambiguation: agent identified `pwdlib` as the current recommendation and `passlib` as the older docs reference. That requires the pack to have surfaced both and the agent to reason about precedence.
- Surfaced three priority files in correct order: `oauth2-jwt.md` (main), `first-steps.md`, `simple-oauth2.md`.
- Direct doc quote about over-simplified packages having security flaws.
- Pulled a secondary-domain finding: `http-basic-auth.md` with the `secrets.compare_digest` vs `==` timing-attack note + named the reference code file `docs_src/security/tutorial006_an_py310.py`.
- Agent volunteered "want me to scaffold a /token endpoint" — feels confident enough in the context to propose concrete next steps.

**Failure moments:** none material.

#### Q2 — "How do I add custom middleware that runs before dependency injection?"

**Drift results:** pack contained the architectural answer; agent caught the ordering and both registration patterns with code examples.

**Useful moments:**
- Caught the ordering: "middleware → DI → path operation → DI cleanup → middleware (response side)" — a real architectural fact pulled from docs.
- Showed both registration patterns (`@app.middleware("http")` decorator and `app.add_middleware(MyMiddleware)`) with working code.
- Stack-ordering rule with direct quote: "the last added middleware is the outermost, the first added is the innermost."
- Four gotchas, all docs-grounded:
  - No `Depends(...)` inside middleware
  - Don't read request body in `BaseHTTPMiddleware` (consumes stream)
  - Pure ASGI middleware avoids `BaseHTTPMiddleware` quirks
  - Middleware fires for 404s, dependencies don't

**Failure moments / findings:**
- Agent flagged: "the most directly relevant doc chunk was budget-omitted from the retrieval, so the canonical `call_next` example is best read from `docs/en/docs/tutorial/middleware.md` directly." **This confirms B3 from the production surface** — a giant chunk got cut by the budget and the agent had to compensate by naming the source file. Worth recording: the agent's honesty about the gap is good behavior, but the gap exists.

#### Q3 — "Does fastapi support async generators as response types? What are the constraints?"

**Drift results:** pack rich enough that the agent went deeper with Bash + direct file reads. 21 tool uses, ~3.5 min.

**Useful moments:**
- Both streaming patterns documented with code:
  1. Return `StreamingResponse(generator(), media_type=...)`
  2. `response_class=StreamingResponse` + `yield` direct (FastAPI ≥ 0.134.0, "much more convenient")
- Version-awareness again: "FastAPI ≥ 0.134.0" for the recommended pattern.
- Direct doc quote about Pydantic absence: "FastAPI will not try to convert the data to JSON with Pydantic..."
- Cancellation explanation with `await anyio.sleep(0)` and a docs quote: "An async task can only be cancelled when it reaches an await."
- Five specific constraints — async cancellation, sync file I/O blocking, media_type-must-be-set, yield-in-dependencies-is-different.
- Five file paths including specific Python source files (`docs_src/stream_data/tutorial001_py310.py`, etc.).

**Data point:** the per-question latency (3m 25s) and tool count (21) are higher than the others. Pilot users on rich corpora may experience this as slow — not a bug, but a real characteristic to track.

#### Q4 — "What's the recommended way to deploy fastapi on AWS Lambda with cold-start optimization?" (negative test)

**Drift results:** pack genuinely empty on the topic; agent abstained honestly.

**Useful moments — most important result of the four:**
- Honest abstention: "I searched the FastAPI docs corpus for lambda, mangum, serverless, zappa, and cold start — zero matches... I can't give you a FastAPI-blessed Lambda deployment recipe — that recommendation doesn't exist."
- Properly-labeled out-of-corpus offering: "This is community-standard practice, not FastAPI docs" — then provided community knowledge (Mangum adapter, lazy imports, Provisioned Concurrency, SnapStart) clearly separated from what's actually in the docs.
- Listed what the docs DO recommend (6 deployment concepts + 4 concrete recipes) so the user sees the boundary of the corpus.

This is textbook honest signal_empty behavior at the agent level. PRD-0033's `primary_contributors` probe (B6) is fuzzy at the metric level, but the END-TO-END product surface — retrieval + agent reasoning + agent honesty — produces correct behavior. The product is trustworthy even where the metric is imprecise.

### Aggregate observations (across all four questions)

**Fell back to:** never. All four questions produced an actionable answer from the pack.

**Repeating positive patterns:**
- Version-aware retrieval (Q1, Q3) — pack surfaces both current and historical guidance, agent disambiguates.
- File-path priority ordering — every question got a "read these N files in this order" list, which is the right shape for agent context.
- Direct doc quotes — every question pulled at least one quoted line, evidence the agent isn't hallucinating.

**Real findings worth carrying forward:**
1. B3 (oversized chunks) is biting in production — the Q2 budget-omitted note is the direct evidence.
2. Q3 latency suggests rich corpora may need either bigger budgets, smaller chunks, or both.
3. Agent-level honest signal_empty works (Q4); B6's probe-level imprecision is less important than the end-to-end behavior.

**Phase 0 exit position:** structurally cleared. Bug fixes needed before cohort 1 are tracked in `bugs.md` (B1, B8 blocking; B3/B4/B5 major). The engine is genuinely usable on a stranger's repo.

### Methodology caveat — fastapi is an easy case (added 2026-05-11 after sessions completed)

A serious limitation of this Phase 0 result: **fastapi is one of the most well-represented repos in any LLM training corpus.** The agent already had priors about FastAPI's architecture (middleware, dependency injection, streaming responses) before reading any pack. Several signals from the Phase 0 sessions confirm this:

- **Q3 used 21 tool uses over 3m 25s.** That's not the engine giving one good answer from a single retrieval — that's the agent iterating: call retrieve_context_pack, get something partial, refine search, grep the actual file directly, refine again. The LLM's prior knowledge of FastAPI told it WHAT to search for at each step. The pack supplied source-cites and direct quotes, but not the architectural framing.
- **Q1 surfaced "pwdlib is current, passlib is older."** That ordering judgment was supported by the pack (both libraries appear) but reinforced by training data (the LLM knows pwdlib is the newer recommendation in the broader Python ecosystem).
- **Q4 gave community-knowledge fallback labelled clearly.** "This is community-standard practice, not FastAPI docs" — but the community standard (Mangum, SnapStart, Provisioned Concurrency) was ENTIRELY training-data. On a private repo where the LLM has no priors, the agent could only honestly say "I don't know" — it couldn't fall back to community knowledge because there's no community.

**What this means for Phase 0 success:**

The engine works on a corpus where the LLM can fill retrieval gaps. We have NOT shown it works on a corpus where the LLM has zero prior knowledge. This is a critical methodological gap that Phase 1 must address.

**Implication for Cohort 1 user selection:**

At least one of the 3 cohort users must be on a **private or personal repo the LLM has no training-data exposure to**. Without that, the cohort signal is optimistic-biased. Update to PILOT.md user profile is being made in the same commit.

**The good news from this finding:**

Even on the easy case, the product surface (agent honesty in Q4, source-cited quotes throughout, version-aware framing) is well-shaped. The LLM-backfill isn't a *replacement* for retrieval — it's a *complement*. On a hard case the same product surface should still produce honest behavior; it just won't produce confident community-knowledge fallbacks. That's actually *more* trustworthy in some senses — fewer ways to hallucinate.

**Friction noticed but not bug-worthy:**
- The shell paste-ate-the-angle-brackets thing was tiny and recoverable (B7).
- Build-up of accepted cards over time (only 1 accepted across the session) — but that's by design, not friction. Pilot users would naturally accept more as they review the inbox.
