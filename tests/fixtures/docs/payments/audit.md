---
scope:
  layer: module
  project: payments
  module: audit
---

# Payment audit logging

Every state transition on a payment must produce an audit event in the `payment_audit_events` table. The `AuditLogger.record` method is the only path; do not write to the table directly. See `src/payments/audit.ts`.

## Required fields

Each event captures actor, action, before-state, after-state, and a reason string. Missing fields fail the schema check at write time.
