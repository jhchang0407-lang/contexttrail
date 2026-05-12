---
scope:
  layer: module
  project: notifications
  module: webhooks
  files:
    - src/notifications/webhook.ts
  symbols:
    - WebhookDispatcher.dispatch
    - WebhookDispatcher.retry
---

# Webhooks

Webhook delivery uses an **at-least-once** guarantee. `WebhookDispatcher.dispatch` signs the payload with the endpoint's secret, writes the delivery attempt record to `webhook_delivery_attempts` before making the HTTP call, and returns the attempt ID. Writing first guarantees retries happen even if the process crashes after sending.

## Deduplication

Endpoints must tolerate duplicate deliveries. Each payload includes an `event_id` field that is stable across retries — receivers should use `event_id` as the deduplication key.

## Retry schedule

`WebhookDispatcher.retry` re-delivers failed attempts on a fixed schedule: 1 min, 5 min, 30 min, 2 hr, 8 hr. After five failures the delivery is marked `exhausted` and no further retries occur. An alert fires when a delivery reaches `exhausted` state.

## Payload signing

Every delivery is signed with HMAC-SHA256 using the endpoint's secret. The signature is in the `X-Webhook-Signature` header. Endpoints should verify the signature before processing the payload.
