---
scope:
  layer: project
  project: general
doc_role: example
---

# Code style guide

Naming and structural conventions for the codebase.

## Class naming

Service classes use the `XxxService` suffix. Repository classes use `XxxStore`. Workers use `XxxWorker`. Examples:

- `RefundService` — payments domain
- `InvoiceService` — billing domain
- `SubscriptionService` — billing domain
- `SessionStore` — auth domain
- `TokenStore` — auth domain
- `EmailWorker` — notifications domain
- `WebhookDispatcher` — notifications domain (note: `Dispatcher` because it dispatches and retries)

## Method naming

Methods that mutate state should be named with verbs. Methods that read state should use noun-style names where appropriate.

- `processRefund` — verb, mutating
- `reconcileRefund` — verb, mutating
- `record` — verb (used by `AuditLogger.record`)
- `can` — predicate (used by `PermissionChecker.can`)
- `get` — accessor (used by `SessionStore.get`)

## Route naming

REST routes follow the pattern `<METHOD> /<resource>/<id>/<action>`. Examples:

- `POST /sessions/:id/renew`
- `DELETE /sessions/:id`
- `POST /tokens` (collection)

This document is style guidance only. Behavioral rules live in the per-module documentation.
