---
scope:
  layer: module
  project: notifications
  module: email
  files:
    - src/notifications/email.ts
  symbols:
    - EmailWorker.send
---

# Email notifications

`EmailWorker.send` enqueues a transactional email job. Delivery is asynchronous — the method returns a job ID, not a delivery receipt. All transactional emails are **deduplicated by `idempotency_key`**: passing the same key twice enqueues the job once and returns the same job ID on the second call.

## Retry behavior

Failed delivery attempts are retried with exponential backoff: 1 min, 5 min, 30 min, 2 hr, 8 hr. After five failures the job is moved to the dead-letter queue and an alert fires. The `idempotency_key` prevents duplicate sends during retries.

## Content rules

- Transactional emails (receipts, password resets, alerts) bypass opt-out checks.
- Marketing emails require an explicit opt-in record for the recipient address.
- HTML content is sanitized before delivery; raw script tags are stripped.

## Deduplication window

The deduplication window is 24 hours. An `idempotency_key` older than 24 hours is treated as a new send and reuses the same key only for logging correlation.
