---
scope:
  layer: module
  project: billing
  module: proration
  files:
    - src/billing/proration.ts
  symbols:
    - ProrationCalculator.compute
---

# Proration

`ProrationCalculator.compute` calculates the proration adjustment when a subscription is upgraded mid-period. The returned value is a signed integer representing the net credit or charge in the smallest currency unit.

## Calculation rules

- **Unused days on the current plan** produce a credit (negative amount).
- **Days remaining on the new plan** produce a charge (positive amount).
- For same-price upgrades the net proration amount must equal zero.
- Proration is computed at upgrade time using the wall-clock timestamp of the upgrade; rounding uses half-up.

## Billing

The proration amount is billed immediately when `SubscriptionService.upgrade` is called. A proration line item is added to the current open invoice, or a standalone proration invoice is created if no open invoice exists.

## Edge cases

If the upgrade occurs on the last day of a billing period, the proration credit for the old plan is zero. The new plan charge still applies for the remaining partial day.
