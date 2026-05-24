# ADR-0012: `retrieve_context_pack` `rendered_text` becomes opt-in

**Status:** Accepted
**Date:** 2026-05-06

## Context

Post-dogfood payload measurement showed that `retrieve_context_pack` responses are too large for focused queries. Real-corpus measurement on ContextTrail's own docs produced:

- `dogfood-default`: ~252.4k bytes
- `dogfood-small`: ~229.1k bytes

Field breakdown showed that `rendered_text` is the single biggest contributor:

- `rendered_text`: ~140k-149k bytes, about 60% of total
- `omitted`: ~53k-55k bytes
- `ranked`: ~33k-49k bytes

This means the current MCP response duplicates the included context substantially:

- once in structured `locked` / `ranked`
- again in `rendered_text`

Week 4's contract intentionally included `rendered_text` as a convenience surface so agents could paste a ready-made Context Pack without writing their own renderer. In practice, the main MCP consumers are capable of reading structured fields directly, and the payload cost of always shipping `rendered_text` is too high for the product's core goal of reducing context pressure.

## Decision

`retrieve_context_pack` will keep support for `rendered_text`, but it will no longer be returned by default.

Add an optional request field:

- `include_rendered_text?: boolean`

Behavior:

- absent or `false`: `rendered_text` is omitted from the response
- `true`: `rendered_text` is included exactly as before

This makes pre-rendered text an explicit convenience request rather than a mandatory cost on every MCP retrieval.

## Why

1. Largest immediate payload reduction with the smallest implementation change.
2. Preserves the convenience surface for callers that truly want it.
3. Keeps structured retrieval as the primary interface, which is what MCP is for.
4. Lets follow-up payload work focus on `omitted` after duplication is removed.

## Alternatives considered

### Remove `rendered_text` entirely

Rejected for now.

Too abrupt. It removes a useful convenience/debug surface and forces every caller onto structured rendering immediately.

### Keep `rendered_text` always-on

Rejected.

Real-corpus measurements show that this dominates payload size and works against the product goal.

### Replace `rendered_text` with pointer/fetch indirection

Rejected for now.

Too much complexity for an immediate stabilization pass. The simpler win is to stop always serializing the duplicate text.

## Consequences

### Positive

- focused queries become materially smaller immediately
- `small` budget becomes more meaningful in practice
- structured MCP usage becomes the default path
- S2 can be measured more cleanly after this change

### Negative

- this is a contract revision and needs schema/test updates
- clients relying on unconditional `rendered_text` must opt in explicitly

### Accepted cost

- one additive request-field change
- snapshot and contract-equivalence updates once

## Implementation notes

- add `include_rendered_text?: boolean` to the MCP input schema
- omit `rendered_text` unless explicitly requested
- update contract tests and snapshots
- rerun the real-corpus payload harness to establish the new baseline before S2

## Expected outcome

Real-corpus payload should drop by roughly the size of current `rendered_text`, taking the response from ~230-250k into a much smaller range before any omitted-list optimization.

## References

- [PRD-0003](../prd/0003-week-4-mcp-server.md) — week-4 MCP contract
- [DESIGN.md D-week4-1](../DESIGN.md#d-week4-1-retrieve_context_pack-mcp-response-shape) — `retrieve_context_pack` response shape
- [src/mcp/payload-size.test.ts](../../src/mcp/payload-size.test.ts) — payload measurement harness
- [src/mcp/__snapshots__/payload-size.test.ts.snap](../../src/mcp/__snapshots__/payload-size.test.ts.snap) — baseline snapshots
