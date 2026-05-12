---
scope:
  layer: module
  project: billing
  module: subscriptions
  files:
    - src/billing/subscription.ts
  symbols:
    - SubscriptionService.cancel
    - SubscriptionService.upgrade
---

# Subscriptions

Subscriptions follow a lifecycle: `active → canceling → canceled` for cancellations, and `active → upgrading → active` for plan upgrades. Every state transition is logged to the `billing_audit_events` table.

## Cancellation

`SubscriptionService.cancel` schedules end-of-period termination. The subscription enters the `canceling` state and is canceled when the current billing period ends. Immediate cancellation skips the `canceling` state and requires a `reason_code` field.

## Upgrade

`SubscriptionService.upgrade` changes the subscription plan and computes proration. The subscription enters the `upgrading` state briefly while proration is calculated and billed immediately. After billing succeeds, the subscription returns to `active` on the new plan.

## Billing audit

All subscription state transitions — including cancellation and upgrade — are recorded in `billing_audit_events`. The `before_state`, `after_state`, and `actor` fields are required. Writes go through the subscription service only; do not write to `billing_audit_events` directly.
