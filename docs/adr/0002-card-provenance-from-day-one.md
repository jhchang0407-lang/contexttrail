# ADR-0002: Card schema includes `provenance` and `authored_by` from v1

**Status:** Accepted
**Date:** 2026-05-05

## Context

v1 ships with manual card authoring only (see ADR-0001). Every accepted card is, by construction, human-authored. Provenance is implicit: if it's in `cards/` and `status: accepted`, a human wrote it.

Post-v1 will introduce drift response: AI proposes patches to existing cards, humans ratify them. After ratification the card is still `status: accepted`, but it is no longer "human-authored truth" — it is "human-approved AI suggestion." That's a real semantic shift in what "accepted" means.

Without explicit provenance:
- 6 months from now, you cannot tell which accepted cards you wrote vs. which the AI proposed and you rubber-stamped
- You cannot filter "show me only human-authored constraints"
- You cannot audit "how many accepted cards came from AI proposals?"
- If you ever lose trust in a model's proposals, you cannot selectively re-validate AI-origin cards

The card schema is fixed in week 1. Adding provenance later means migrating every card.

## Decision

Card frontmatter includes `provenance` and `authored_by` from v1, even though the v1 value set is small.

```yaml
---
id: C002
type: constraint
title: Refunds must not exceed captured amount
status: accepted
provenance: human_authored
authored_by: thomas
created_at: 2026-05-05
---
```

### v1 provenance values
- `human_authored` — user wrote it by hand (most cards)
- `imported_from_doc` — derived deterministically from a doc heading or comment during setup (no LLM reasoning involved)
- `system_derived` — created by a deterministic system action (e.g., automatic evidence card from test discovery)

### Post-v1 expansion (do not implement now)
- `ai_proposed` — AI drafted, human accepted
- `ai_updated` — AI proposed an update to an existing card, human accepted

### `authored_by`
Free-form string in v1: a user name, `system`, or post-v1 an agent name like `claude_code`. No structured identity primitive yet. If multi-agent identity matters later, introduce a separate `agent_id` or `actor` field rather than overloading this one.

## Consequences

### Positive
- Forward-compatible with drift response (ADR-0001) without card migration
- Auditability: any future drift in trust can be re-authenticated by filtering on provenance
- Cheap: two flat frontmatter fields, near-zero cost in v1
- Composable: future tooling like "verify all `ai_proposed` cards" becomes a one-line filter

### Accepted costs
- Two extra frontmatter fields users must set when authoring (defaults are obvious enough that this is minor)
- Risk of `authored_by` becoming a structured identity field by accident — must keep it as free-form string in v1

### Constraint imposed on the future
- `authored_by` stays a simple string. Multi-agent identity, if needed, introduces a separate primitive — not an overload of this field.

## Alternatives considered

1. **Skip provenance, add later.** Rejected: every card written without provenance becomes ambiguous forever. Backfill is guesswork.
2. **`provenance` only, no `authored_by`.** Considered. `authored_by` is near-free and enables solo-vs-team auditability with no additional cost.
3. **Full structured provenance object** (`{ kind, model, prompt_version, reviewer }`). Rejected: overengineered for v1. Two flat fields suffice; structured form can be added under `provenance_metadata` later if genuinely needed.

## Related

- ADR-0001 — defers the drift response loop that this schema choice enables
- CONTEXT.md — definitions of `authority`, `provenance`, `authored_by`, `freshness`
