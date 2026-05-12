---
scope:
  layer: project
  project: general
doc_role: example
---

# Incident response runbook

Generic incident response procedures. For module-specific behavior, see the canonical module documentation.

## Initial triage

1. Identify the affected domain: payments, billing, auth, notifications, or platform-wide.
2. Pull recent audit events from the relevant audit table (`payment_audit_events`, `billing_audit_events`).
3. Check for elevated retry rates on idempotent operations like refunds, invoice creation, or webhook dispatch.

## Common checks by domain

### Payments

- Look for failed `RefundService.processRefund` retries in the last hour.
- Check `ReconciliationService.reconcileRefund` for duplicate ledger rows.

### Billing

- Look for `InvoiceService.create` errors on the `billing_period` field.
- Check subscription state transitions in `billing_audit_events`.

### Auth

- Look for elevated 401s with `TOKEN_REVOKED` error code.
- Check session renewal at `POST /sessions/:id/renew`.

### Notifications

- Look for webhook deliveries reaching `exhausted` state.
- Check `EmailWorker.send` retry rates.

This runbook is process documentation, not authoritative behavior. Always confirm against the canonical per-module docs before acting.
