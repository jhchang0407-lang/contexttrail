import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestCorpus, type TestCorpus } from "./test-corpus.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const FIXTURE_ROOT = resolve(REPO_ROOT, "tests", "fixtures", "docs");

export type EvalFixtureLab = {
  cwd: string;
  importCorpus: () => void;
  cleanup: () => void;
};

export function createEvalFixtureLab(): EvalFixtureLab {
  const corpus = createTestCorpus({ prefix: "contexttrail-eval-" });
  corpus.copyDocsFrom(FIXTURE_ROOT);
  writeEvalCards(corpus);
  return {
    cwd: corpus.cwd,
    importCorpus: () => {
      corpus.importDocs();
      corpus.importCards();
    },
    cleanup: corpus.cleanup,
  };
}

function writeEvalCards(corpus: TestCorpus): void {
  corpus.writeCard({
    id: "C001",
    type: "constraint",
    title: "Payments mutations must audit and dedupe",
    scope: { layer: "project", project: "payments" },
    files: ["src/payments/refund.ts", "src/payments/reconciliation.ts", "src/payments/audit.ts"],
    body: "Payment mutations must be idempotent and emit audit events.",
    filename: "c-payments.md",
  });
  corpus.writeCard({
    id: "C002",
    type: "constraint",
    title: "Reconciliation never creates duplicate ledger rows",
    scope: { layer: "module", project: "payments", module: "reconciliation" },
    files: ["src/payments/reconciliation.ts"],
    symbol_anchors: ["ReconciliationService.reconcileRefund"],
    body: "Duplicate refund reconciliation must reuse the existing ledger row.",
    filename: "c-reconciliation.md",
  });
  corpus.writeCard({
    id: "C003",
    type: "constraint",
    title: "Session renewal preserves token identity",
    scope: { layer: "module", project: "auth", module: "sessions" },
    routes: ["POST /sessions/:id/renew"],
    symbol_anchors: ["SessionStore.get"],
    body: "Session renewal extends TTL without rotating the session token.",
    filename: "c-auth.md",
  });
  corpus.writeCard({
    id: "S001",
    type: "symbol_note",
    title: "RefundService.processRefund is idempotent",
    scope: { layer: "module", project: "payments", module: "refunds" },
    symbol_anchors: ["RefundService.processRefund"],
    body: "RefundService.processRefund returns the existing refund for duplicate provider retries.",
    filename: "s-refund.md",
  });
  corpus.writeCard({
    id: "S002",
    type: "symbol_note",
    title: "AuditLogger.record owns payment audit writes",
    scope: { layer: "module", project: "payments", module: "audit" },
    symbol_anchors: ["AuditLogger.record"],
    body: "AuditLogger.record is the only path that writes payment audit event rows.",
    filename: "s-audit.md",
  });
  corpus.writeCard({
    id: "E001",
    type: "evidence",
    title: "Refund idempotency test evidence",
    scope: { layer: "module", project: "payments", module: "refunds" },
    command: "npm test -- refund-idempotency",
    covers: ["C001"],
    body: "The refund idempotency test proves duplicate provider retries return the existing record.",
    filename: "e-refund.md",
  });
  corpus.writeCard({
    id: "C004",
    type: "constraint",
    title: "Invoices are immutable after capture",
    scope: { layer: "project", project: "billing" },
    files: ["src/billing/invoice.ts", "src/billing/subscription.ts", "src/billing/proration.ts"],
    body: "Captured invoices must not have line items modified. Only status transitions are permitted post-capture.",
    filename: "c-billing.md",
  });
  corpus.writeCard({
    id: "C005",
    type: "constraint",
    title: "Notifications must be deduplicated by idempotency key",
    scope: { layer: "project", project: "notifications" },
    files: ["src/notifications/email.ts", "src/notifications/webhook.ts"],
    body: "All notification sends must use a stable idempotency key to prevent duplicate delivery.",
    filename: "c-notifications.md",
  });
  corpus.writeCard({
    id: "C006",
    type: "constraint",
    title: "Token rotation is not idempotent",
    scope: { layer: "module", project: "auth", module: "tokens" },
    files: ["src/auth/tokens.ts"],
    symbol_anchors: ["TokenStore.issue", "TokenStore.revoke"],
    body: "Token rotation issues a new token and revokes the old atomically. Callers must not retry rotation without user confirmation.",
    filename: "c-auth-tokens.md",
  });
  corpus.writeCard({
    id: "C007",
    type: "constraint",
    title: "Auth mutations require verified request context",
    scope: { layer: "project", project: "auth" },
    files: ["src/auth/sessions.ts", "src/auth/tokens.ts", "src/auth/permissions.ts"],
    body: "All auth mutations must run within a verified request context. Background workers may not call auth mutation methods directly.",
    filename: "c-auth-project.md",
  });
  corpus.writeCard({
    id: "C010",
    type: "constraint",
    title: "Support escalations must be audited",
    scope: { layer: "project", project: "support" },
    body: "Every support escalation must write an audit event before notification.",
    filename: "c-support-project.md",
  });
  corpus.writeCard({
    id: "S003",
    type: "symbol_note",
    title: "InvoiceService.create is idempotent",
    scope: { layer: "module", project: "billing", module: "invoices" },
    symbol_anchors: ["InvoiceService.create"],
    body: "InvoiceService.create returns the existing draft invoice when called with the same customer_id + billing_period.",
    filename: "s-invoice.md",
  });
  corpus.writeCard({
    id: "S004",
    type: "symbol_note",
    title: "WebhookDispatcher.dispatch writes attempt before sending",
    scope: { layer: "module", project: "notifications", module: "webhooks" },
    symbol_anchors: ["WebhookDispatcher.dispatch"],
    body: "WebhookDispatcher.dispatch writes the delivery attempt record before the HTTP call, guaranteeing retry on crash.",
    filename: "s-webhook.md",
  });
  corpus.writeCard({
    id: "S005",
    type: "symbol_note",
    title: "PermissionChecker.can never throws",
    scope: { layer: "module", project: "auth", module: "permissions" },
    symbol_anchors: ["PermissionChecker.can"],
    body: "PermissionChecker.can returns boolean only. Missing permission is false, not an exception.",
    filename: "s-permissions.md",
  });
  corpus.writeCard({
    id: "E002",
    type: "evidence",
    title: "Invoice idempotency test evidence",
    scope: { layer: "module", project: "billing", module: "invoices" },
    command: "npm test -- invoice-idempotency",
    covers: ["C004", "S003"],
    body: "The invoice idempotency test proves that InvoiceService.create returns the same draft for duplicate billing period calls.",
    filename: "e-invoice.md",
  });
  corpus.writeCard({
    id: "E005",
    type: "evidence",
    title: "STALE invoice evidence must not promote",
    scope: { layer: "module", project: "billing", module: "invoices" },
    command: "npm test -- stale-invoice-idempotency",
    covers: ["C004", "S003"],
    freshness_state: "potentially_superseded",
    freshness_reason: "version_drift",
    body: "This stale invoice evidence shares healthy invoice anchors but must not promote while potentially superseded.",
    filename: "e-invoice-stale.md",
  });
  corpus.writeCard({
    id: "E003",
    type: "evidence",
    title: "Webhook deduplication test evidence",
    scope: { layer: "module", project: "notifications", module: "webhooks" },
    command: "npm test -- webhook-dedup",
    covers: ["C005", "S004"],
    body: "The webhook deduplication test verifies that the same event_id is delivered once despite multiple dispatch calls.",
    filename: "e-webhook.md",
  });
  corpus.writeCard({
    id: "E004",
    type: "evidence",
    title: "Token rotation non-idempotency test evidence",
    scope: { layer: "module", project: "auth", module: "tokens" },
    command: "npm test -- token-rotation",
    covers: ["C006"],
    body: "The token rotation test proves that calling rotation twice produces two distinct tokens and two revocations.",
    filename: "e-auth-tokens.md",
  });
  corpus.writeCard({
    id: "C008",
    type: "constraint",
    title: "DEPRECATED billing constraint (must not lock)",
    authority: "deprecated",
    scope: { layer: "project", project: "billing" },
    files: ["src/billing/invoice.ts"],
    body: "This is a deprecated billing constraint kept in the fixture to test that authority=deprecated cards never lock.",
    filename: "c-billing-deprecated.md",
  });
  corpus.writeCard({
    id: "S006",
    type: "symbol_note",
    title: "DEPRECATED InvoiceService.create symbol note (must not lock)",
    authority: "deprecated",
    scope: { layer: "module", project: "billing", module: "invoices" },
    symbol_anchors: ["InvoiceService.create"],
    body: "This is a deprecated symbol_note kept in the fixture to test that authority=deprecated symbol notes never lock even on exact symbol match.",
    filename: "s-invoice-deprecated.md",
  });

  const fatBody = Array.from(
    { length: 90 },
    (_, i) =>
      `Section ${i + 1}: The telemetry ingest pipeline must enforce strict ordering of events ` +
      `to preserve causal consistency across distributed collectors. Each event carries a ` +
      `monotonic sequence number derived from the upstream producer's logical clock, and the ` +
      `collector emits a deterministic checkpoint every 10000 events to allow replay from a ` +
      `known-good offset. The telemetry pipeline rejects events whose sequence number is lower ` +
      `than the most recent checkpoint, and emits a CollectorRejection metric for every such ` +
      `event so that operators can detect upstream clock drift before it propagates downstream.`,
  ).join(" ");
  corpus.writeCard({
    id: "C009",
    type: "constraint",
    title: "Telemetry pipeline ordering and checkpoint requirements",
    scope: { layer: "project", project: "telemetry" },
    files: ["src/telemetry/collector.ts"],
    body: fatBody,
    filename: "c-telemetry.md",
  });
}
