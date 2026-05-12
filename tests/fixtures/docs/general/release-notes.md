---
scope:
  layer: project
  project: general
doc_role: example
---

# Release notes

Cross-cutting release history for the platform. Each entry summarizes a change at a high level — see the canonical module documentation for behavioral details.

## v1.4.0

- Added `RefundService.processRefund` retry guard on duplicate provider callbacks.
- Updated `InvoiceService.create` to accept a `billing_period` parameter.
- New route `POST /sessions/:id/renew` for session renewal.

## v1.3.2

- `AuditLogger.record` now writes the `actor` field unconditionally.
- `WebhookDispatcher.dispatch` retry schedule shortened on first attempt.
- `TokenStore.revoke` returns the previous revocation timestamp on idempotent calls.

## v1.3.0

- `ReconciliationService.reconcileRefund` first available.
- `PermissionChecker.can` no longer throws on unknown principal kinds.
- `SubscriptionService.cancel` honors the `reason_code` field.

This file is for release tracking. Implementation details are in the per-module documentation.
