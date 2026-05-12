---
scope:
  layer: module
  project: support
  module: escalations
  files:
    - src/support/escalations.ts
  symbols:
    - EscalationService.open
  routes:
    - POST /support/escalations
---

# Support escalations

`EscalationService.open` creates a support escalation for a customer-impacting incident. The service records the triggering incident id, customer id, and operator id before notifying the on-call owner.

## Route

`POST /support/escalations` opens a new escalation. The route must validate the incident id before calling `EscalationService.open`.

## Audit

Every support escalation must write an audit event before notification so operators can reconstruct who escalated the incident and why.
