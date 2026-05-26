# 2026-05-26 Runtime Readiness Layer

## Decision

Reuse the old confidence system, but promote it from query-level retrieval
confidence to slot-level assembly readiness.

The old system answered:

```text
Did this query retrieve enough plausible results?
```

The document-workflow engine needs the stricter runtime question:

```text
Did this Context Pack assemble every required workflow ingredient?
```

## Locked Runtime Model

The runtime layer has four primary signals:

```ts
type RetrievalConfidence = "confident" | "uncertain" | "weak" | "empty";
type AdequateSearch = "adequate" | "partial" | "insufficient" | "not_applicable";
type SlotReadiness = "ready" | "partial" | "retry_required" | "blocked";
type PackReadiness = "ready" | "partial" | "retry_required" | "blocked";
```

Retrieval confidence is per slot. It uses the old style of signals: anchors,
source-type match, score strength, score margin, result count, and query signal.

Adequate search is also per slot. It records whether the engine searched the
places where the evidence should reasonably exist.

Slot readiness decides whether the workflow ingredient is satisfied.

Pack readiness is the worst readiness among required task-critical slots:

```text
ready < partial < retry_required < blocked
```

If a task-critical required slot is `partial`, promote the pack to
`retry_required`. Caveats are allowed for optional/background gaps, but not as a
shortcut around missing required ingredients.

## Missing Context Rule

Missing context can be a successful result:

```text
missing evidence + adequate search = valid missing-context finding
missing evidence + insufficient search = retry_required
```

This prevents the engine from making false absence claims when it did not search
the expected places.

## Eval Requirement

The first evaluation for this runtime layer should target the current robust
panel required-slot misses:

- Known required-slot misses flagged: at least `4/5`.
- False retry on good required slots: no more than `10-15%`.
- Critical false missing-context claims: `0`.

The key product requirement is not merely that the engine retrieves good
context. It must tell the agent when the pack is not ready and exactly which
slot to retry, ask about, or abstain on.
