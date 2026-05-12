---
scope:
  layer: project
  project: general
doc_role: example
---

# Glossary

A reference of terms used across the platform. This is the platform-wide glossary, not domain-specific authoritative documentation. For canonical behavior, refer to the per-module documentation.

## Domain terms

- **Audit event** — a record of a state change. Payment audit events live in payments; billing audit events live in billing.
- **Capture** — the act of finalizing a draft invoice and triggering payment collection. See billing for the canonical capture rules.
- **Dispatch** — outbound delivery of a webhook event to an external endpoint.
- **Idempotency key** — a stable token used to deduplicate retries of the same operation. Used by refunds, invoices, and notifications.
- **Permission** — an authorization atom held by a principal. Checked via PermissionChecker.can.
- **Reconciliation** — the process of correlating two records that should refer to the same underlying event.
- **Refund** — the reversal of a payment. Implemented by RefundService.processRefund.
- **Session** — an authenticated request context. Stored via SessionStore.get and renewed via POST /sessions/:id/renew.
- **Subscription** — a recurring billing relationship. Lifecycle: active, canceling, upgrading, canceled.
- **Token** — an API credential. Issued via TokenStore.issue and revoked via TokenStore.revoke.
- **Webhook** — an outbound HTTP callback to a customer endpoint.

This glossary is provided for orientation only. None of the rules above are authoritative — every term has a canonical doc in its own module.
