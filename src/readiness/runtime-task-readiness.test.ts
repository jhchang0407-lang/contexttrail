import { describe, expect, it } from "vitest";
import { buildRuntimeTaskReadiness } from "./runtime-task-readiness.js";

describe("buildRuntimeTaskReadiness", () => {
  it("marks a confident ready runtime pack as answerable", () => {
    const readiness = buildRuntimeTaskReadiness({
      task: "draft the follow-up",
      has_sources: true,
      coverage_confidence: "confident",
      legacy_pack_readiness: "ready",
      legacy_reason_codes: ["all_needs_satisfied"],
      missing_needs: [],
      satisfied_needs: ["overview_orientation"],
      warnings: [],
      ranked_count: 2,
      locked_count: 1,
    });

    expect(readiness.pack_readiness).toBe("ready");
    expect(readiness.recovery_action).toBe("answer");
    expect(readiness.slots[0]).toMatchObject({
      retrieval_confidence: "confident",
      slot_readiness: "ready",
      found_fields: ["overview_orientation"],
      missing_fields: [],
    });
  });

  it("distinguishes partial support from weak retrieval", () => {
    const readiness = buildRuntimeTaskReadiness({
      task: "explain the refund behavior",
      has_sources: true,
      coverage_confidence: "uncertain",
      legacy_pack_readiness: "partial",
      legacy_reason_codes: ["coverage_uncertain", "exact_symbol_missing"],
      missing_needs: ["exact_symbol_behavior"],
      satisfied_needs: ["overview_orientation"],
      warnings: [],
      ranked_count: 3,
      locked_count: 0,
      recovery_plan: {
        action: "retry_with_followup_searches",
        reason_codes: ["coverage_uncertain", "retry_can_expand_query"],
        hint: "Retry with a narrower query.",
        follow_up_searches: ["RefundService.processRefund behavior"],
        anchor_requests: [],
      },
    });

    expect(readiness.pack_readiness).toBe("retry_required");
    expect(readiness.recovery_action).toBe("retry_slot");
    expect(readiness.retry_slots).toEqual(["context_pack"]);
    expect(readiness.slots[0]).toMatchObject({
      retrieval_confidence: "uncertain",
      slot_readiness: "retry_required",
      found_fields: ["overview_orientation"],
      missing_fields: ["exact_symbol_behavior"],
      suggested_retry: { queries: ["RefundService.processRefund behavior"] },
    });
    expect(readiness.slots[0]?.reasons).not.toContain("retrieval_weak");
  });

  it("marks empty retrieval as retryable rather than answerable", () => {
    const readiness = buildRuntimeTaskReadiness({
      task: "find the policy clause",
      has_sources: true,
      coverage_confidence: "empty",
      legacy_pack_readiness: "unsupported",
      legacy_reason_codes: ["no_evidence"],
      missing_needs: ["overview_orientation"],
      satisfied_needs: [],
      warnings: [],
      ranked_count: 0,
      locked_count: 0,
    });

    expect(readiness.pack_readiness).toBe("retry_required");
    expect(readiness.recovery_action).toBe("retry_slot");
    expect(readiness.slots[0]).toMatchObject({
      retrieval_confidence: "empty",
      slot_readiness: "retry_required",
      missing_fields: ["overview_orientation"],
    });
  });

  it("blocks when the runtime has no imported sources to search", () => {
    const readiness = buildRuntimeTaskReadiness({
      task: "find the policy clause",
      has_sources: false,
      coverage_confidence: "empty",
      legacy_pack_readiness: "unsupported",
      legacy_reason_codes: ["no_evidence"],
      missing_needs: ["overview_orientation"],
      satisfied_needs: [],
      warnings: ["no_sources"],
      ranked_count: 0,
      locked_count: 0,
    });

    expect(readiness.pack_readiness).toBe("blocked");
    expect(readiness.recovery_action).toBe("ask_user");
    expect(readiness.blocking_slots).toEqual(["context_pack"]);
    expect(readiness.slots[0]).toMatchObject({
      retrieval_confidence: "empty",
      adequate_search: "insufficient",
      slot_readiness: "blocked",
      recovery_action: "ask_user",
    });
  });
});
