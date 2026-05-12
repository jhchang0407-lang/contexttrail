---
scope:
  layer: module
  project: billing
  module: invoices
  files:
    - src/billing/invoice.ts
  symbols:
    - InvoiceService.create
    - InvoiceService.capture
---

# Invoices

`InvoiceService.create` is idempotent. Using the same `customer_id` and `billing_period` as a natural key, a second call for the same period returns the existing draft invoice instead of creating a duplicate. Callers must pass a stable `billing_period` value.

## Capture

`InvoiceService.capture` finalizes a draft invoice and triggers payment collection. Once captured, an invoice is **immutable** — line items must not be modified after capture. Only status transitions are permitted on a captured invoice.

## Line items

Line items are written to the draft invoice before capture. All mutations to line items must happen before `InvoiceService.capture` is called. After capture, the `invoice_line_items` table is append-only for audit purposes.

## Edge cases

If `InvoiceService.create` is called twice with the same `billing_period` for the same customer, the second call returns the existing draft invoice record and does not emit a second creation event.
