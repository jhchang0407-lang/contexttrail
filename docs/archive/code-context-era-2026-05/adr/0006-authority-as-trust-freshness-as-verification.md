# ADR-0006: Authority as trust; freshness as verification state

**Status:** Accepted
**Date:** 2026-05-05

## Context

The early ContextTrail schema carried three trust-adjacent fields with overlapping value sets:

- **status** on cards: `accepted | candidate | deprecated`
- **authority** in [ARCHITECTURE.md](../ARCHITECTURE.md) and [CONTEXT.md](../CONTEXT.md): `accepted | imported | candidate | inferred`
- **freshness** in [CONTEXT.md](../CONTEXT.md) and [SCHEMA.md](../SCHEMA.md): `verified | unverified | needs_review | maybe_affected | potentially_superseded | deprecated`

`accepted`, `candidate`, and `deprecated` appeared in two of the three. Concrete scenarios — *a hand-authored constraint with `status: accepted` whose linked chunk just changed (so freshness drops to `needs_review`) — what is its authority?* — had no canonical answer. Different code paths could reasonably treat the card as locked-include, locked-with-warning, or demoted-to-candidate.

The ambiguity is not abstract. Card authoring, retrieval scoring, the bootstrap-triage flow, and post-v1 drift detection all branch on these axes. Without a clear separation, the bug "card's authority and status drifted apart in a candidate-acceptance flow" is inevitable.

## Decision

Two trust-related fields. They are **orthogonal** — neither implies the other.

- **`authority`** answers *should this be trusted as source-of-truth?* Values: `accepted | imported | candidate | inferred | deprecated`. Changes only by **explicit human action** (accept, deprecate, demote to candidate). Card frontmatter field is named `authority`, not `status`. Doc Chunks default to `imported`. Bootstrap output is `candidate` until triaged.
- **`freshness`** answers *is this trusted thing still verified against current code?* Values: `verified | unverified | needs_review | maybe_affected | potentially_superseded`. (`deprecated` is removed from this enum — it belongs to `authority`.) Changes **mechanically**: linked chunk's `version_id` rotates → linked card → `needs_review`.

The legacy `status` field on cards is **collapsed into `authority`**. The card frontmatter rename is `status:` → `authority:`. The SQL column rename is `cards.status` → `cards.authority`. The legacy term "status" is **banned from prose** when discussing trust; the unrelated `doc_chunks.status` field (`current | tombstoned`) stands as a lifecycle marker and is referred to as "lifecycle" in prose to avoid the overload.

### Retrieval rule under the orthogonality

For a card with `authority: accepted, freshness: needs_review`:

- **Authority decides eligibility.** Accepted → eligible for locked-include if scope/symbol matches.
- **Freshness modulates the score, not the eligibility.** `freshness_weights[needs_review] = 0.75` from [SCHEMA.md](../SCHEMA.md) reduces the card's effective score; it does not exclude the card.
- **A warning surfaces in the Context Pack.** The pack's "Warnings" section names the card and the trigger.

Authority changes only by human action. A stale-but-trusted constraint is still trusted; the human has not retracted trust.

## Considered alternatives

- **Keep `status` and `authority` as separate fields.** Rejected: in v1 their value sets overlap completely on cards, so the separation is theoretical, and the bug surface (drift between the fields) is real.
- **Collapse all three (status + authority + freshness) into one field.** Rejected: trust and verification answer different questions. A trusted-but-stale card is a meaningful state. Collapsing loses that.
- **Make freshness change authority automatically.** Rejected: a stale chunk doesn't make a constraint *wrong*; it makes it *unverified against current code*. Letting mechanical signals downgrade trust would let the system silently retract authority that a human granted.

## Consequences

### Positive
- The orthogonality pays off in retrieval: accepted-but-stale cards stay locked-include with a warning, which is what users actually want (we explicitly chose to author this card; the agent should still see it).
- The bootstrap-triage flow becomes obvious: candidates have `authority: candidate, freshness: unverified`. Triage flips `authority` to `accepted`. Freshness flips later when evidence runs.
- Future drift detection can reason about freshness without fearing it will silently change trust state.

### Negative
- The card frontmatter rename and the SQL column rename are real edits, but they happen before any cards are committed (no migration needed beyond the docs and any prototype code).
- "Status" is a tempting word; future contributors will reach for it. The CONTEXT.md flagged-ambiguities section and this ADR exist to push back when that happens.

### Anti-patterns this ADR exists to block
- Re-introducing `status:` on card frontmatter for "compatibility" or "ergonomics." The collapse is deliberate; do not reverse it.
- Treating `freshness: needs_review` as a trust downgrade in any code path. It is a verification signal, not an authority signal.
- Letting any mechanical signal write `authority`. Only human actions write authority. Mechanical signals write freshness.

## References

- [CONTEXT.md `authority` and `freshness` entries](../CONTEXT.md) — canonical glossary definitions
- [SCHEMA.md card frontmatter and DDL](../SCHEMA.md) — the renamed field
- [DESIGN.md D9, D10](../DESIGN.md) — earlier authority/status framing this ADR clarifies
- [ADR-0002](0002-card-provenance-from-day-one.md) — provenance is yet another orthogonal axis (origin of the idea), distinct from both authority and freshness
