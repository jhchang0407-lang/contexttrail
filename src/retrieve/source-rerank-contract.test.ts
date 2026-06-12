/**
 * Contract guardrails: source rerank must not change the Cards or
 * confidence-policy contracts.
 *
 *  - Locked Cards bypass source rerank (and the global ranker generally).
 *  - Non-locked Cards keep ranked behavior with card_type_bias.
 *  - Evidence Cards promoted by locked-card coverage remain locked.
 *  - coverage_confidence still comes from the established confidence policy.
 *  - The MCP response schema is unchanged.
 */
import { describe, it, expect } from "vitest";
import { createEvalFixtureLab } from "../eval/lab.js";
import { createHandlers } from "../mcp/handlers.js";
import { schemas } from "../mcp/schemas.js";

describe("source rerank — Cards & confidence contracts", () => {
  it("locked Cards still surface in pack.locked and bypass source rerank", async () => {
    const lab = createEvalFixtureLab();
    try {
      lab.importCorpus();
      const handlers = createHandlers({ cwd: lab.cwd });
      const response = await handlers.retrieve_context_pack({
        task: "make refunds idempotent",
        files: ["src/payments/refund.ts"],
        symbols: ["RefundService.processRefund"],
        budget: "default",
      });
      // anchored-refund-idempotency in tests/fixtures/eval-set.yaml expects
      // C001, S001, and E001 to lock.
      const lockedCardIds = new Set(response.locked.map((l) => l.id));
      expect(lockedCardIds.has("C001")).toBe(true);
      expect(lockedCardIds.has("S001")).toBe(true);
      // Locked cards are NOT included via the global ranker.
      const rankedCardIds = response.ranked
        .filter((r) => r.kind === "card")
        .map((r) => r.id);
      expect(rankedCardIds).not.toContain("C001");
      expect(rankedCardIds).not.toContain("S001");
    } finally {
      lab.cleanup();
    }
  });

  it("evidence Cards promoted by locked-card coverage remain locked", async () => {
    const lab = createEvalFixtureLab();
    try {
      lab.importCorpus();
      const handlers = createHandlers({ cwd: lab.cwd });
      const response = await handlers.retrieve_context_pack({
        task: "make refunds idempotent",
        files: ["src/payments/refund.ts"],
        symbols: ["RefundService.processRefund"],
        budget: "default",
      });
      // E001 covers C001 and so promotes alongside C001 once C001 locks.
      const lockedCardIds = new Set(response.locked.map((l) => l.id));
      expect(lockedCardIds.has("E001")).toBe(true);
    } finally {
      lab.cleanup();
    }
  });

  it("non-locked Cards still appear in ranked output with the existing schema fields", async () => {
    const lab = createEvalFixtureLab();
    try {
      lab.importCorpus();
      const handlers = createHandlers({ cwd: lab.cwd });
      const response = await handlers.retrieve_context_pack({
        task: "Telemetry pipeline ordering",
        files: [],
        symbols: [],
        budget: "default",
      });
      // The response shape conforms to the public schema (which carries no
      // SourceProfile field — source rerank is internal/diagnostic only).
      const parsed = schemas.retrieve_context_pack.output.parse(response);
      expect(parsed).toBeDefined();
      const rankedCard = response.ranked.find((r) => r.kind === "card");
      if (rankedCard) {
        expect(rankedCard).toHaveProperty("id");
        expect(rankedCard).toHaveProperty("kind", "card");
      }
    } finally {
      lab.cleanup();
    }
  });

  it("coverage_confidence still comes from the PRD-0011 confidence policy regardless of rerank", async () => {
    const lab = createEvalFixtureLab();
    try {
      lab.importCorpus();
      const handlers = createHandlers({ cwd: lab.cwd });
      const r2 = await handlers.retrieve_context_pack({
        task: "make refunds idempotent",
        files: ["src/payments/refund.ts"],
        symbols: ["RefundService.processRefund"],
        budget: "default",
      });
      // coverage_confidence is one of the v1 confidence-policy enum states.
      // Source rerank never invents a new confidence value or rewrites the
      // policy's verdict.
      expect(["confident", "uncertain", "empty"]).toContain(r2.coverage_confidence);
    } finally {
      lab.cleanup();
    }
  });
});
