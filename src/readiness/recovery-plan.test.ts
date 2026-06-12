import { describe, expect, it } from "vitest";
import { buildRecoveryPlan, type RecoveryPlanInput } from "./recovery-plan.js";

function input(overrides: Partial<RecoveryPlanInput> = {}): RecoveryPlanInput {
  return {
    task: "how do I add custom middleware before authentication",
    query_mode: "unanchored",
    coverage_confidence: "confident",
    pack_readiness: "ready",
    reason_codes: ["all_needs_satisfied"],
    missing_needs: [],
    warnings: [],
    ranked: [
      {
        kind: "chunk",
        contexttrail: "Source: docs/middleware.md > Section: Middleware > Part: 1/1",
        score: 1,
        tokens: 300,
      },
      {
        kind: "chunk",
        contexttrail: "Source: docs/authentication.md > Section: Auth > Part: 1/1",
        score: 0.8,
        tokens: 250,
      },
      {
        kind: "chunk",
        contexttrail: "Source: docs/security.md > Section: Security > Part: 1/1",
        score: 0.7,
        tokens: 200,
      },
    ],
    ...overrides,
  };
}

describe("buildRecoveryPlan", () => {
  it("answers directly for confident ready packs", () => {
    const plan = buildRecoveryPlan(input());

    expect(plan.action).toBe("answer");
    expect(plan.reason_codes).toContain("pack_ready");
  });

  it("answers with a caveat when context exists but confidence is uncertain", () => {
    const plan = buildRecoveryPlan(input({
      coverage_confidence: "uncertain",
      pack_readiness: "partial",
      reason_codes: ["coverage_uncertain"],
      symbols: ["AuthenticationMiddleware"],
    }));

    expect(plan.action).toBe("answer_with_caveat");
    expect(plan.reason_codes).toContain("safe_to_answer_with_caveat");
    expect(plan.follow_up_searches[0]).toContain("custom middleware");
  });

  it("inspects broad uncertain packs before spending a retry", () => {
    const plan = buildRecoveryPlan(input({
      coverage_confidence: "uncertain",
      pack_readiness: "partial",
      reason_codes: ["coverage_uncertain"],
      ranked: [
        ...input().ranked,
        {
          kind: "chunk",
          contexttrail: "Source: docs/hooks.md > Section: Hooks > Part: 1/1",
          score: 0.6,
          tokens: 180,
        },
        {
          kind: "chunk",
          contexttrail: "Source: docs/plugins.md > Section: Plugins > Part: 1/1",
          score: 0.5,
          tokens: 160,
        },
      ],
    }));

    expect(plan.action).toBe("inspect_pack_or_retry");
    expect(plan.hint).toContain("Inspect the current ranked refs first");
  });

  it("does not answer signal-empty intent just because ranked context exists", () => {
    const plan = buildRecoveryPlan(input({
      query_intent: "signal_empty",
      coverage_confidence: "uncertain",
      pack_readiness: "partial",
      reason_codes: ["coverage_uncertain"],
    }));

    expect(plan.action).toBe("ask_for_anchors");
  });

  it("asks for anchors when exact-symbol context is missing and no anchor was supplied", () => {
    const plan = buildRecoveryPlan(input({
      coverage_confidence: "uncertain",
      pack_readiness: "partial",
      reason_codes: ["exact_symbol_missing"],
      missing_needs: ["exact_symbol_behavior"],
      ranked: [],
    }));

    expect(plan.action).toBe("ask_for_anchors");
    expect(plan.anchor_requests).toContain("a relevant document or file path");
  });

  it("asks for anchors when unrecognized anchors make the current pack unsafe", () => {
    const plan = buildRecoveryPlan(input({
      coverage_confidence: "uncertain",
      pack_readiness: "partial",
      reason_codes: ["anchors_unrecognized"],
      warnings: ["anchors_unrecognized"],
    }));

    expect(plan.action).toBe("ask_for_anchors");
    expect(plan.reason_codes).toContain("needs_user_anchor");
  });

  it("abstains when no sources are available and nothing ranked", () => {
    const plan = buildRecoveryPlan(input({
      coverage_confidence: "uncertain",
      pack_readiness: "unsupported",
      ranked: [],
      warnings: ["no_sources"],
    }));

    expect(plan.action).toBe("abstain");
  });

  it("generates follow-up searches for cross-module uncertainty before retrying", () => {
    const plan = buildRecoveryPlan(input({
      query_mode: "anchored",
      coverage_confidence: "uncertain",
      pack_readiness: "partial",
      reason_codes: ["coverage_uncertain"],
      missing_needs: ["cross_module_boundary"],
      files: ["src/http/middleware.ts"],
      ranked: [
        {
          kind: "chunk",
          contexttrail: "Source: docs/integrations/middleware.md > Section: Integration > Part: 1/1",
          score: 1,
          tokens: 300,
        },
      ],
    }));

    expect(plan.action).toBe("retry_with_followup_searches");
    expect(plan.follow_up_searches.some((search) => search.includes("integration"))).toBe(true);
  });

  it("generates code-shaped follow-up searches when exact symbol behavior is still missing", () => {
    const plan = buildRecoveryPlan(input({
      coverage_confidence: "uncertain",
      pack_readiness: "partial",
      reason_codes: ["exact_symbol_missing"],
      missing_needs: ["exact_symbol_behavior"],
      symbols: ["RefundService.processRefund"],
      ranked: [
        {
          kind: "code",
          contexttrail: "Code: src/payments/refund.ts > Symbol: RefundService.processRefund > Role: declaration > Lines: 10-42",
          source_path: "src/payments/refund.ts",
          symbol_path: "RefundService.processRefund",
          score: 0.7,
          tokens: 180,
        },
      ],
    }));

    expect(plan.follow_up_searches.some((search) => search.includes("implementation"))).toBe(true);
    expect(
      plan.follow_up_searches.some((search) => search.includes("RefundService.processRefund")),
    ).toBe(true);
  });

  it("abstains when the ledger has no evidence", () => {
    const plan = buildRecoveryPlan(input({
      coverage_confidence: "empty",
      pack_readiness: "unsupported",
      reason_codes: ["no_evidence"],
      ranked: [],
    }));

    expect(plan.action).toBe("abstain");
  });
});
