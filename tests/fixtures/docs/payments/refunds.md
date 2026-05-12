---
scope:
  layer: module
  project: payments
  module: refunds
  files:
    - src/payments/refund.ts
  symbols:
    - RefundService.processRefund
---

# Refunds

Every refund attempt must emit an audit event, including failed attempts. The `RefundService.processRefund` method is the only entry point and must be idempotent — providers may retry it, and a duplicate call for the same order should return the existing refund record rather than creating a new one.

## Partial refunds

A partial refund reuses the same idempotency key. See `src/payments/refund.ts` for the canonical implementation. Partial refunds must be ledgered against the original charge.

## Edge cases

When a payment is partially refunded twice, the second call should return the existing refund record. Set `STRIPE_API_KEY` before running `refund.test.ts` to verify this end-to-end.
