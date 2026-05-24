# ADR-0013: `retrieve_context_pack` `omitted` becomes a bounded summary

**Status:** Accepted
**Date:** 2026-05-06

## Context

After [ADR-0012](0012-retrieve-context-pack-rendered-text-opt-in.md) made `rendered_text` opt-in, real-corpus payload measurement on ContextTrail's own docs left `omitted` as the second-largest contributor:

- `omitted`: ~54k bytes / ~677 entries on the dogfood query
- ~22% of total wire payload after the `rendered_text` win

The `omitted` array shipped one wire entry per candidate that didn't make the included pack — every below-threshold chunk, every over-budget chunk, every tombstoned version. For a typical real-corpus query this means hundreds of small entries whose primary information value to an agent is "how much was left out and why," not "every individual id and score."

PRD-0003 locked the MCP response contract, so changing `omitted`'s shape is a deliberate contract revision (same posture as ADR-0012).

## Decision

`omitted` on the wire becomes a bounded summary object instead of an unbounded list of entries:

```ts
omitted: {
  total: number;                                    // unbounded count of all candidates omitted
  by_reason: { below_threshold?: number; budget?: number; tombstoned?: number };
  top: OmittedEntry[];                              // up to N highest-scoring entries
  truncated: boolean;                               // top.length < total
}
```

`OmittedEntry` keeps its existing shape (`{ id, kind, reason, score }`), so per-entry inspection is unchanged for whatever fits in `top`.

`N` is hardcoded at **10** in [src/mcp/transform.ts](../../src/mcp/transform.ts) as `OMITTED_TOP_N`. No config knob in v1.

The CLI path is unaffected — `contexttrail context --json` still emits the full omitted list. Only the MCP wire is summarized.

## Why

1. **Honest framing of what `omitted` is for.** Agents use it to decide "should I widen the budget?" That decision needs a count + reasons, plus a small sample of what's near the threshold. It does not need every below-threshold candidate's id and score.
2. **Materially smaller payload.** Real-corpus dogfood query: `omitted` dropped from ~54k bytes to ~1k bytes. Combined with ADR-0012, total wire payload is down ~80% vs pre-PRD-0004.
3. **`total` and `by_reason` preserve the diagnostic value.** Agents still know how many candidates were omitted and the distribution of reasons; they just don't get every entry serialized.
4. **`truncated` makes the cap explicit.** Consumers can detect when they're seeing only a sample without doing arithmetic.

## Alternatives considered

### Option A: Cap the existing array, expose counts as a sibling field

Reject. Two reasons:

- It pretends `omitted` is still a complete list when it isn't. Consumers writing `r.omitted.length` would silently get a misleading number.
- It requires a sibling field (`omitted_summary` or similar) for the counts, splitting one logical concept across two top-level keys.

### Option B: Summary object (chosen)

Accept. Cost: every consumer that does `r.omitted.map(...)` or `r.omitted.length` rewrites against `r.omitted.top` and `r.omitted.total`. That cost is real but small (handful of test files in this repo) and the rewrite makes the contract honest.

### Option C: Drop `omitted` entirely

Reject. PRD-0003's contract pillar is "`omitted` is part of the response, not optional — agents need to know what *almost* made it." Removing it loses the budget-widening signal.

### Option D: Make `omitted` opt-in (parallel to `rendered_text`)

Reject. The summary form is small enough (~1k bytes) that always-on is fine; opt-in adds an API knob without buying meaningful payload.

## Consequences

### Positive

- Real-corpus dogfood payload reduced by another ~50k bytes per query.
- The `omitted` field becomes self-describing (`truncated` flag, `total` count).
- Future quality work has cleaner before/after numbers — `ranked` is now the dominant line item, which is what we want.

### Negative

- This is a contract revision. PRD-0003 was previously locked.
- Consumers using `omitted` as an array must update to the summary shape.
- `top` is hardcoded at 10 — if a future caller wants more, they currently have no knob.

### Accepted cost

- One contract change (already done in PRD-0004 / S2).
- Test updates across schemas, edge-cases, contract-equivalence, snapshots, handlers, transform.

## Implementation notes

- `OmittedSummary` defined in [src/mcp/schemas.ts](../../src/mcp/schemas.ts) using `z.record(OmittedReason, z.number())` for `by_reason` so missing reasons don't appear as zeros.
- Top-N selection sorts descending by `score`, ties broken by retrieval-pipeline order (stable sort).
- CLI path (`contexttrail context --json`) untouched; only [src/mcp/transform.ts](../../src/mcp/transform.ts) builds the summary.
- Equivalence test (`src/mcp/contract-equivalence.test.ts`) asserts: MCP `total` matches CLI omitted length; MCP `top` is a strict subset of CLI omitted ids; `truncated` is consistent with `top.length < total`.

## References

- [ADR-0012](0012-retrieve-context-pack-rendered-text-opt-in.md) — companion contract revision (`rendered_text` opt-in)
- [PRD-0003](../prd/0003-week-4-mcp-server.md) — week-4 MCP contract (annotated with both revisions)
- [PRD-0004](../prd/0004-mcp-payload-size.md) — post-dogfood payload reduction
- [src/mcp/payload-size.test.ts](../../src/mcp/payload-size.test.ts) — measurement harness
- [src/mcp/__snapshots__/payload-size.test.ts.snap](../../src/mcp/__snapshots__/payload-size.test.ts.snap) — baseline
