---
scope:
  layer: module
  project: payments
  module: reconciliation
  files:
    - src/payments/reconciliation.ts
  symbols:
    - ReconciliationService.reconcileRefund
---

# Refund reconciliation

Duplicate refunds must be reconciled against the original ledger entry. The
`ReconciliationService.reconcileRefund` method compares charge IDs, refund IDs,
and audit trail entries before posting a corrective ledger line.

## Duplicate refund handling

If a refund is submitted twice, the second call should not create a new ledger
row. Instead, correlate the repeated call with the original payment audit event
and reuse the existing reconciliation record.
