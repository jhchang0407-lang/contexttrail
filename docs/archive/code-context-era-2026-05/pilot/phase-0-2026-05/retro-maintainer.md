# Phase 0 — Maintainer self-retro (fastapi)

> Date written: 2026-05-11 (same day as the Phase 0 session).
> Source evidence: [`sessions.md`](sessions.md), [`bugs.md`](bugs.md).
> Method: PILOT.md "Post-pilot retrospective" Q1–Q8, answered by the maintainer for their own session(s). Q8 is load-bearing — it becomes the baseline that cohort 1 user answers are compared against. The cohort 1 retros use the same template per user.

## Q1 — What changed between week 1 and week 2?

N/A in the strict sense. Phase 0 was a single ~90-minute sustained session on fastapi (Session 1 / 2026-05-11) covering four query shapes back-to-back, not a 2-week pilot. The structural intent of Q1 — "did the failures repeat / did anything that worked stop working" — has no week-2 to compare against.

What changed *within* the session is captured in `sessions.md`: the four questions (domain / architectural / edge-case / negative) all produced actionable agent responses with no fall-back to grep. The pack-quality pattern was consistent across all four — version-aware retrieval, file-path priority ordering, direct doc quotes. Failures were structural (B3 budget omission named by the agent on Q2; nothing user-blocking) rather than recurring.

For cohort 1, Q1 becomes meaningful — pilot users will have a real week-1 → week-2 trajectory.

## Q2 — One thing to fix before this is shippable to a stranger

**B1 — the next-step recommendation pushing users toward a second `contexttrail import` that bloats with translations.** This is what `bugs.md` calls the highest-leverage bug, for a specific reason: it directly invalidates the maintainer-named property *"setup readiness scan tells you the right next step."* If the engine's own onboarding guidance is wrong, no downstream surface gets a fair test.

PRD-0036's slice 36.1 ships the fix (decision-table branch + `BOOTSTRAP_MIN_CHUNK_FLOOR=50` floor). Cohort 1 will exercise it as the maintainer-validated path, not the broken one.

Honorable mention: **B8** (no `.mcp.json` written by `contexttrail init`) — a user finishes setup with no way to actually wire the engine to their agent. Strictly speaking that's a worse first-touch failure than B1 because it gates the wire-up entirely, but PRD-0036 ships both in the same slice, so the question doesn't force a pick.

## Q3 — Load-bearing question the agent answered (or that would unlock product belief if it did)

**Yes — Q4 from Session 1.** The negative test "what's the recommended way to deploy fastapi on AWS Lambda with cold-start optimization?" produced honest abstention: *"I searched the FastAPI docs corpus for lambda, mangum, serverless, zappa, and cold start — zero matches… I can't give you a FastAPI-blessed Lambda deployment recipe — that recommendation doesn't exist."*

That is the load-bearing demonstration. An engine that returns confident-shaped output on every query is unsafe at scale; an engine whose product surface says "the docs don't cover this, here is the boundary, here is what the docs *do* recommend" is the thing worth shipping. PRD-0033's `primary_contributors` probe (B6) is fuzzy at the probe level — Phase 0 confirmed that end-to-end the agent still produces honest signal_empty behavior. That's the more important calibration.

What this *doesn't* show: a load-bearing positive question on a private corpus where the LLM has no priors. That gap is exactly the methodology caveat at the bottom of `sessions.md` and the reason cohort 1 requires ≥2 of 3 users on private repos.

## Q4 — Honesty / authority boundary: useful / friction / neither?

**Neither (not actively exercised).** Phase 0 ran four retrieval queries; it did not exercise the inbox accept/reject flow at scale. `sessions.md` notes a single accepted card across the session. The session-level signal on the boundary is therefore not load-bearing — cohort 1 is the test of the boundary, because cohort 1 users will sit with hundreds of bootstrap candidates and decide what gets in.

What Phase 0 *did* validate structurally: the inbox surface is browsable (after slice 36.3's `--limit`/`--type`/`--status` flags ship — the unfiltered 344-item dump observed in Phase 0 would have been a friction-point at scale). PRD-0036/36.3 closes that gap.

## Q5 — Did `contexttrail setup`'s next-step recommendation match what you needed?

**No — and that is B1.** After importing 156 English doc files (2120 chunks, `scope_coverage: confident`), the right next step was `contexttrail card bootstrap`. The shipped engine recommended `contexttrail import docs/**/*.md` because `corpus_coverage` was stuck at `low` (denominator inflated by 1365 translation files). The maintainer followed the engine's suggestion and pulled in 12,976 more chunks of translated duplicates before catching the issue.

This is the cleanest example in Phase 0 of an engine surface contradicting the maintainer-named product invariant. PRD-0036/36.1 ships the route-around (the `bootstrap_despite_low_corpus` decision-table row) so cohort 1 doesn't repeat the mistake. The underlying denominator issue (B2) is deferred — the route-around handles the visible friction without committing to a heavyweight language-aware fix.

## Q6 — Stale data: did the freshness warnings fire? Useful or noise?

**Didn't fire.** Phase 0 happened in a single session immediately after import; PRD-0035's freshness check / code-source tombstoning had no opportunity to surface. Cohort 1 (which spans real coding days) is where this signal will appear. No verdict possible from Phase 0.

## Q7 — Would you recommend this to a colleague today, in its current state?

**Yes — with the cohort 1 caveats honored.** Specifically:

- The engine cleared every functional gate end-to-end on a stranger's repo (fastapi).
- The product surface (honest abstention, source-cited quotes, version-aware framing, file-path priority ordering) is in good shape.
- The blocking bugs (B1, B8) are fixed in PRD-0036.
- The methodology caveat (`sessions.md` bottom section, 2026-05-11 addition) is honest: fastapi is an easy case because the LLM has training-data priors. The engine has NOT been shown to work where the LLM has no priors. Cohort 1's 2-of-3 private-repo requirement (PILOT.md `User profile`) is the structural test that earns the recommendation.

So: "recommend after PRD-0036 lands and cohort 1 confirms the harder case." Not "recommend today, no caveats."

## Q8 — In one sentence: what is ContextTrail for, from your perspective? *(load-bearing)*

> **Draft answer (maintainer to confirm or revise before cohort 1):**
>
> *ContextTrail is the context surface that lets an AI coding agent ground its answers in your team's actual docs, code, and accepted constraints — including the ability to say honestly "the corpus doesn't cover this" instead of inventing an answer.*

**Note for the maintainer:** PILOT.md flags Q8 as the load-bearing positioning question — cohort 1 user answers will be compared against it. The draft above is grounded in the CONTEXT.md framing ("the condition of context being potentially out of sync with the code, specs, or behavior it describes") and the Phase 0 evidence (the Q4 honest-abstention finding). **Edit this answer in your own voice before cohort 1 begins.** If the cohort users converge near this sentence, positioning is real; if they diverge, positioning is the open question and a strategy follow-up is the right next step (per PILOT.md's decision matrix).

## Phase 0 verdict (summary)

Structurally cleared. The engine works end-to-end on a stranger's repo, the product surface is honest, the blocking bugs from this session ship in PRD-0036, and the methodology caveat that this was an easy case is recorded and propagated into the cohort 1 selection requirement. Cohort 1 is the test of the harder case.
