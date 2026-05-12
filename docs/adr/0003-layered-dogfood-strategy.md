# ADR-0003: Layered dogfood strategy — ContextTrail for engineering loop, fundops for product hypothesis

**Status:** Accepted
**Date:** 2026-05-05

## Context

The 5-week MVP must validate two distinct things:

1. **Engineering loop** — is the engine pleasant and useful for a developer who is actively writing code?
2. **Product hypothesis** — do agents measurably behave better with a small scoped Context Pack than with naive doc dumping?

[MVP.md](../MVP.md) originally proposed: ContextTrail for (1), Ralph for (2). That fell apart on inspection:

- **Ralph** is unfamiliar to the user. Card authoring requires deep knowledge of the codebase's actual rules and invariants — knowing what's load-bearing vs. stylistic, which symbols couple across modules, which doc sentences are real constraints. An author without that knowledge produces guess-cards, and a poor week-5 result tells us nothing about whether the engine failed or the cards failed.
- **ContextTrail itself** has zero incident library because it is pre-implementation. The product hypothesis requires *concrete tasks where you can compare agent-with-pack vs. agent-without-pack*. With no incident history, those tasks must be invented, and the counterfactuals become hypothetical.
- **fundops** is the only repo where the user is the domain expert *and* has a real incident library — at minimum the DB-vs-JSON drift incident (rule was "DB is single source of truth," agent kept a JSON handoff alongside, weeks of work compounded on top before discovery) and the run-pipeline cross-module whack-a-mole. The objection is that fundops is "relatively simple" and may not stress-test the engine.

The simplicity objection is overweighted. The ContextTrail engine does not care whether a codebase is 5kloc or 500kloc — it cares whether cards capture real invariants and retrieval surfaces them at the right moment. The fundops failure modes (alternative-mechanism drift, cross-module contract contexttrail) are exactly the ones the engine should catch, just expressed in a smaller blast radius. *Failure-mode complexity*, not codebase complexity, is what matters.

## Decision

Use a layered dogfood plan, not a single repo.

| Role | Repo | Purpose |
|---|---|---|
| Engineering loop (weeks 1–4) | **ContextTrail itself** | Use the engine while building it. Tests ergonomics. |
| Incident library (pre-week-1) | **fundops** | Mine 5–8 historical incidents in the [INCIDENTS.md](../../INCIDENTS.md) format. Becomes the failure-mode taxonomy. |
| Product hypothesis (week 5) | **fundops** | Re-run historical incidents with cards authored. Measure with-pack vs. without-pack. |
| Sanity check (week 5, ~1 day) | ContextTrail / Ralph / friend's repo | Informal external-eyes test on a different repo. Not part of success bar. |

### Required discipline (load-bearing)

Every time Claude Code (or any agent) makes a wrong move during weeks 1–4 while building ContextTrail, log it in [INCIDENTS.md](../../INCIDENTS.md) using the standard format. Without this log, week-5 measurement on ContextTrail has nothing to compare against.

## Consequences

### Positive
- Cards are authored with confidence (user is domain expert on both fundops and ContextTrail)
- Counterfactuals are real on fundops (historical failure logs exist)
- Engineering ergonomics are tested daily (ContextTrail eats its own dog food while being built)
- Over-fit risk is bounded by the optional sanity check

### Accepted costs
- The user must commit to the incident-logging discipline during weeks 1–4. No log → no ContextTrail product-hypothesis data.
- fundops complexity remains a fair criticism. Mitigation: the sanity check, plus the argument that failure-mode complexity is what matters.
- Two repos to keep loaded in head simultaneously during weeks 4–5.

### Constraint imposed on the future
- The week-5 success bar (≥10 tasks, ≥7/10 score 4–5, ≥1 behavior-parity demo) is measured *primarily on fundops*. ContextTrail and the sanity-check repo are supplementary signals, not the bar.

## Alternatives considered

1. **Ralph as primary product-hypothesis repo (original MVP.md plan).** Rejected: card authoring requires familiarity Ralph doesn't give the user. Wizard-A (ADR-0001) reduces config friction but does not replace the need for domain expertise when authoring constraints.
2. **ContextTrail as sole dogfood for both engineering loop and product hypothesis.** Rejected: no historical incident library; counterfactuals become hypothetical; severe over-fit risk (engine author authoring cards on engine codebase).
3. **fundops alone, no engineering-loop test.** Rejected: loses the daily ergonomics signal that comes from using the engine while building it.

## Week-7 amendment (2026-05-08)

The week-7 baseline+experiments plan promoted **Ralph** from informal sanity-check to a frozen-seed surface for the real-corpus eval, alongside an OSS framework repo (Prisma) chosen for shape diversity.

**Fundops's frozen-seed slot did not materialize.** Inspection during Phase 1.1 found that fundops has effectively no markdown documentation — only two `README.md` files (root + frontend). The retrieval engine has nothing to retrieve from there, so a fundops seed cannot be authored without first authoring a synthetic-but-circular corpus (which would defeat the point of a real-corpus eval).

This does not invalidate the original ADR. fundops remains the right product-hypothesis anchor *whenever a doc corpus exists there*. Ops-shape coverage is now an OPEN.md item for whenever fundops grows organic docs (or when ContextTrail's bootstrap helps generate them from code/incidents). The week-5 measurement target language in this ADR is preserved as the historical decision; week-7's substitute surface set is recorded separately in [docs/plan/week-7-baseline-and-experiments-2026-05.md](../plan/week-7-baseline-and-experiments-2026-05.md).

The "≥2 codebases of different shape" pre-v1 ship gate from OPEN §5 is satisfied by Ralph + Prisma for the eval-mechanism; ops-shape coverage remains a separately-tracked gap.

## Related

- [ADR-0001](0001-wizard-a-deterministic-setup-only.md) — Wizard-A reduces config friction but not authoring friction; this ADR reflects that distinction
- [INCIDENTS.md](../../INCIDENTS.md) — the incident log this ADR commits to maintaining
- [MVP.md](../MVP.md) — the original dogfood split this ADR refines
- [Week-7 plan](../plan/week-7-baseline-and-experiments-2026-05.md) — week-7 frozen-seed surface set (Ralph + Prisma; fundops slot deferred)
