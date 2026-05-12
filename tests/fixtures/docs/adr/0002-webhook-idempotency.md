---
scope:
  layer: decision
  project: notifications
---

# ADR-0002: Webhook delivery uses at-least-once semantics

We chose **at-least-once** delivery over exactly-once because exactly-once requires a distributed coordinator that adds operational complexity and latency. Customers must implement idempotent handlers on their side using the `event_id` field.

## Context

The alternative was exactly-once delivery using a two-phase commit or outbox pattern. This would eliminate duplicate events but requires the webhook service to coordinate with each endpoint's acknowledgment before marking a delivery complete — impractical for arbitrary customer endpoints over the public internet.

## Decision

`WebhookDispatcher.dispatch` stores a delivery attempt record before sending. This guarantees retries happen even on process crash, accepting that an endpoint may receive the same event more than once.

## Consequences

- Customers must implement idempotent webhook handlers using `event_id` as the deduplication key.
- The at-least-once contract is documented in the public API reference.
- `WebhookDispatcher.dispatch` must write to `webhook_delivery_attempts` before any HTTP call; this ordering must not be changed.
