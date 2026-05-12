# ADR-0017: Structural assembly rolls out live for its narrow slice

**Status:** Accepted
**Date:** 2026-05-07

## Context

Week 5 introduces structural assembly as the first narrow slice of Context Pack quality: once ContextTrail has found the right grounded source object, it may add the minimum structural neighbors needed for a safe implementation change.

The open product question was not only how to evaluate that behavior, but how it should reach the live MCP contract once proven. Three trade-offs had to be settled:

- should week 5 stop at an offline benchmark, or promote proven behavior into live `retrieve_context_pack` results?
- should rollout be protected by a new user-facing config toggle, or by a narrow behavioral policy?
- should assembly observability be always-on, `explain`-only, or split between the two?

Without a recorded decision, future readers would see live structural expansion in `retrieve_context_pack` and reasonably wonder why it was made default for only one slice, why there is no knob for it, and why the response surface is split.

## Decision

Once the week-5 offline eval proves the targeted behavior, structural assembly should ship into live `retrieve_context_pack` behavior for its narrow slice rather than staying lab-only.

That live slice is:

- anchored implementation queries only
- one grounded source chunk root
- deterministic structural ladder: `primary_only` -> `parent` -> `siblings` -> `linked_neighbor`
- early stop once sufficiency is met
- `signal_empty` behavior unchanged

This rollout should not add a new user-facing config requirement. The boundary is behavioral, not configurational: if a retrieval falls into the targeted slice, the proven structural assembly behavior is the default.

Observability is mixed:

- `assembly_stage_reached` may be always-on as a small behavior-shaping summary
- `assembly_root`, neighbor selection reasons, and early-stop reasoning belong under `explain`

`assembly_stage_reached` must distinguish:

- `not_applicable` — structural assembly did not run for this retrieval
- `primary_only` — structural assembly ran and stopped at the rooted source object
- `parent`
- `siblings`
- `linked_neighbor`

Default human-readable CLI output stays calm. Assembly stage should not appear in normal text rendering unless the user asks for `--explain` or the stage is relevant to a warning or debugging flow.

## Why

This keeps week 5 honest and useful at the same time.

If structural assembly only exists in a benchmark, week 6 bootstrap and week 7 dogfood would build on a behavior the product does not actually use. But if we make it universal too early, we would blur a narrow proven slice with broader assembly and recovery work that has not been settled yet.

The chosen path keeps the runtime behavior real while containing its scope:

- live once proven
- default for the narrow slice
- no added setup burden
- inspectable rather than magical

## Consequences

### Positive

- week 6 and week 7 can evaluate real runtime behavior instead of a lab-only prototype
- the rollout boundary is easy to explain in product terms
- the MCP contract stays inspectable without turning every response into a debug payload
- `signal_empty` remains cleanly separated as a recovery problem

### Accepted costs

- `retrieve_context_pack` behavior now varies by query slice in a documented way
- the explain/output contract grows to describe assembly decisions
- tests and snapshots will need to protect the new response states

## References

- [Week 5 context assembly groundwork](../plan/week-5-context-assembly-groundwork-2026-05.md)
- [MVP.md week 5](../MVP.md#week-5--context-assembly-groundwork)
- [CONTEXT.md](../CONTEXT.md)
