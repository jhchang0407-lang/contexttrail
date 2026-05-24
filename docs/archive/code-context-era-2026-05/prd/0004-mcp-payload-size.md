# PRD-0004: Post-dogfood assessment — reduce MCP payload size in `retrieve_context_pack`

> Source-of-truth canonical doc. Mirrored to issue tracker as the project's fourth PRD issue.
>
> Predecessor: [PRD-0003](0003-week-4-mcp-server.md). Glossary: [`docs/CONTEXT.md`](../CONTEXT.md).
>
> **No schedule pressure.** This is a post-week-4 stabilization item, surfaced during HITL dogfood.

## Problem Statement

After the week-4 HITL dogfood, we observed that `retrieve_context_pack` can still return very large MCP payloads even for focused queries with `budget: "small"`. In the observed run, the *included* pack was relatively focused, but the total wire response remained very large because it serialized both:

- the full `rendered_text` convenience field, and
- a very large `omitted` array.

This creates drift against the core product goal: **reduce agent context while preserving accurate, high-value context**. Week 4 is still complete and functioning — this is a post-dogfood quality/stabilization issue, not a failure of MCP integration.

## Why this matters

- Weakens the core product promise of context reduction.
- Makes future dogfood harder to interpret (signal swamped by payload bloat).
- Creates unnecessary token and latency pressure in real agent sessions.
- Makes `budget: "small"` semantically misleading from the agent's perspective — the agent sees no material reduction in what it has to handle.

## Observed behavior

- Focused refund/idempotency query, `symbols: ["RefundService.processRefund"]`, `files: ["src/payments/refund.ts"]`.
- `budget: "small"` (4000 tokens of *included* pack) did not materially reduce total response size: ~226k characters vs. ~250k characters at default budget.
- Response size appears dominated by duplicated included content (`rendered_text` mirrors `locked` + `ranked`) and/or unbounded `omitted` serialization (~690 entries in the observed run).
- The agent specifically noted the payload felt too large for the intended use case and had to fall back to `jq` extraction on a saved file rather than reading the response directly.

## Investigation goals

1. Measure total payload size for representative queries (focused, broad, locked-overflow, no-matches).
2. Break payload size down by field:
   - `rendered_text`
   - `locked`
   - `ranked`
   - `omitted`
   - `explain` (when set)
3. Confirm whether `omitted` is the dominant source of payload growth.
4. Evaluate whether `rendered_text` duplication is acceptable under the current contract (PRD-0003 locked the contract; any change here is a deliberate revision).
5. Propose the least-disruptive fix that materially reduces payload size.

## Likely solution areas

- Cap `omitted` (top-N by score, or by token budget).
- Summarize `omitted` instead of serializing the full list (counts by reason: `over_budget`, `below_threshold`, `out_of_scope`).
- Add pagination or top-N behavior for omitted items.
- Make `rendered_text` optional (opt-in via request flag) in a future contract revision.
- Align budget semantics with actual total response size, not just included pack size — or document the distinction explicitly.

## Acceptance criteria

- Same dogfood query (focused refund/idempotency) shows materially smaller total MCP payload after the fix.
- `budget: "small"` materially reduces practical response size, not just included pack size.
- `locked` / `ranked` usefulness is preserved (no regression in retrieval quality).
- No regression in contract-equivalence tests.
- No regression in edge-case MCP behavior (locked-only, locked-overflow, no-matches, no-sources).
- Any contract change is documented explicitly (ADR or PRD note) if required.

## Further notes

This should be treated as an immediate post-week-4 stabilization item, *before* extensive additional dogfood, because it directly affects the product's core usefulness. Continuing to dogfood on a payload-bloated baseline risks measuring the wrong things.

## Outcome

**Status (2026-05-06):** S1, S2, S3 implemented and merged. S4 deferred.

**Measured payload reduction (real-corpus dogfood query, this repo's `docs/` + `.contexttrail/cards/`):**

| Stage | dogfood-default | dogfood-small |
|---|--:|--:|
| Pre-PRD-0004 | 252,400 bytes | 229,100 bytes |
| Post-S3 (ADR-0012) | 104,800 | 90,100 |
| Post-S2 (ADR-0013) | 51,200 | 33,600 |
| Total reduction | **−80%** | **−85%** |

`ranked` (the primary content) is now the largest line item. Locked Cards contribute ~1,400 bytes / 2 cards as the trusted floor that does not shrink under any budget.

**Contract revisions landed:**

- [ADR-0012](../adr/0012-retrieve-context-pack-rendered-text-opt-in.md) — `rendered_text` becomes opt-in via `include_rendered_text: true` (default false)
- [ADR-0013](../adr/0013-retrieve-context-pack-omitted-becomes-summary.md) — `omitted` becomes a bounded summary `{ total, by_reason, top, truncated }` rather than an unbounded entry array

**Deferred:**

- S4 (align/document `budget` semantics) — judged redundant after S2 + S3 landed; `budget: "small"` now produces a materially smaller wire response in practice (229k → 34k vs 252k → 51k for default). May be worth revisiting only if a real budget-tuning case surfaces a remaining gap.

**Out-of-scope observations surfaced during eval-prep:**

- Only 2 of 15 cards fire on the dogfood refund/idempotency query. C002 (refund idempotency constraint) does not auto-lock. May be a locked-include matching bug under [ADR-0011](../adr/0011-locked-include-matching-rules.md), or correct behavior — not investigated. Beyond PRD-0004's scope; flag for future triage.
