---
scope:
  layer: decision
  project: payments
---

# ADR-0001: Idempotency keys for payment retries

We use the upstream provider's idempotency key as the source of truth for retry semantics. This avoids a per-service deduplication store and aligns with how providers retry on transient failures.

## Consequences

`RefundService.processRefund` and the charge path both rely on the provider key being present in the request. Callers without an idempotency key must generate one before invoking either path.
