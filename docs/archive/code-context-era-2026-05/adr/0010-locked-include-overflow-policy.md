# ADR-0010: Locked-include is a hard guarantee; token budget is a soft target

**Status:** Accepted
**Date:** 2026-05-06

## Context

Every Context Pack is bounded by a token budget (default 6,000; presets `small=4k / default=6k / large=10k`). Two distinct content streams compete for that budget:

1. **Locked-include content** — accepted constraints whose scope matches the request (D38), accepted symbol_notes whose anchors match the request's query anchors (D39), and bounded one-hop evidence promoted from already-locked cards (D44). The product's central trust contract says these "always reach the agent."
2. **Score-ranked content** — every other Doc Chunk and non-locked Card, ordered by `final_score / sqrt(token_count)` and packed greedily until the budget is exhausted.

The two streams can collide. A task that matches 12 constraints + 3 symbol_notes — plus a small set of linked evidence cards — might generate 8,000 tokens of locked content under a 6,000-token budget. The packer's behavior in that case is *the* contract decision — it determines what authors can actually trust about "locked means locked."

The grilling session on 2026-05-06 (Q3) had to pick a policy. Four options surfaced, each with a different failure mode:

- **Hard-truncate locked Cards by score.** Pack locked greedily until budget hits, drop the rest with a warning. Promise becomes "always included *if they fit*."
- **Overflow the budget with a loud warning.** Always pack every locked Card; doc chunks get whatever's left (possibly nothing). Total tokens can exceed the requested budget.
- **Silently expand budget to fit locked, then pack docs into the original budget.** Effective budget = `requested + locked_tokens`. Locked never competes with docs.
- **Refuse with an error when locked exceeds budget.** Force the author to fix the authoring problem.

This is a contract decision, not a tuning choice. Once published, agents and authors build trust on it; reversing it later breaks the trust model that the entire locked-include feature exists to establish.

## Decision

**Locked-include is a hard guarantee. The budget is a soft target for everything else.**

The packer:

1. Pulls every locked Card into the pack first, regardless of total token cost.
2. Computes `remaining_budget = max(0, requested_budget − sum(locked_tokens))`.
3. Runs the global ranker (Doc Chunks + non-locked Cards) under `remaining_budget` only.
4. If `sum(locked_tokens) > requested_budget`, emits a `locked_overflow` warning naming the deficit and per-card token costs. Doc chunks may receive zero tokens.

The pack response surfaces `budget: { requested, used, locked_overhead }` so the agent and `contexttrail explain` can see exactly how much of the actual context window was consumed.

ADR-0006 already specifies that stale (`needs_review`) locked Cards remain locked-include with a freshness warning. ADR-0010 extends the same principle to budget: **locked is locked**.

## Considered alternatives

- **Hard-truncate locked Cards by score.** Rejected. Silently breaks the core trust contract — the worst possible failure mode for a tool whose value prop is "you can rely on what's in the pack." Authors lose the one guarantee that makes hand-authoring constraints worth the effort.
- **Silently expand budget to fit locked, then pack docs into original budget.** Rejected. The most "correct" option mathematically, but the cost is hidden — agents that asked for 6k tokens can find their actual context window consumed by 14k without understanding why. Hidden costs corrode trust as fast as silent drops.
- **Refuse with a structured error when locked exceeds budget.** Rejected. Locked-overflow is an *expected* state during the cold-start authoring phase when scope rules are still being tuned. Refusing the call there is hostile UX during exactly the phase where authors most need feedback. The warning + `contexttrail explain` surface the same information without blocking the workflow.

## Consequences

### Positive

- Authors can say "this constraint was authored, therefore it was shown" without footnotes. The trust contract is unconditional.
- `contexttrail explain` decomposes the budget cleanly via `locked_overhead`, so authors who hit overflow can see precisely which cards are responsible and prune scope.
- The `locked_overflow` warning is a *useful* signal for tuning: chronic overflow on a project means the scope rules are too broad, not that the tool is broken.

### Negative

- The agent's actual context consumption may exceed the requested budget. Agents that allocate context window strictly need to read `budget.used` rather than assume `budget.requested`. This is an explicit shift of contract surface from "request determines size" to "request determines target; response declares size."
- A pathologically over-locked authoring pattern (every card tagged at company scope, for instance) can degrade pack quality silently if authors ignore the `locked_overflow` warning. ADR-0010 trades silent quality drops for visible warnings, which is the right tradeoff for v1, but it does require authors to engage with warnings.

### Anti-patterns this ADR exists to block

- "Add a max-locked-tokens cap that overrides the guarantee when exceeded." Reintroduces the silent-truncation failure mode.
- "Make the budget a hard ceiling that evicts locked content if necessary." Same failure mode as truncation, dressed up.
- "Auto-expand the budget transparently to absorb locked overhead." Hides cost; agents lose visibility into the actual context consumed.
- "Treat `locked_overflow` as an error in CI / linting." It's a signal, not a defect. If overflow is unwanted, the fix is in scope rules, not in the pack policy.

## References

- [DESIGN.md D37](../DESIGN.md) — full decision and packer pseudocode
- [DESIGN.md D38](../DESIGN.md), [D39](../DESIGN.md), [D44](../DESIGN.md) — what counts as "locked-include"
- [ADR-0006](0006-authority-as-trust-freshness-as-verification.md) — locked-include applies to stale (`needs_review`) Cards as well
- [CONTEXT.md `locked-include`](../CONTEXT.md), `freshness`
- [PRD-0002](../prd/0002-week-3-cards-and-substrate.md) — week 3 implementation
