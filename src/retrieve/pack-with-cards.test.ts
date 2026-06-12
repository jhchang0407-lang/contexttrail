import { describe, it, expect } from "vitest";
import { packWithLocked, type LockedTrace, type CandidateTrace } from "./pack.js";

function lockedCard(card_id: string, tokens: number, lock_kind: "constraint_scope_match" | "symbol_note_exact" = "constraint_scope_match"): LockedTrace {
  return {
    version_id: card_id,
    bm25_norm: 0,
    heading_match: 0,
    scope_match: 0,
    mention_overlap: 0,
    specificity: 1,
    text_score: 0,
    final_score: 0,
    token_count: tokens,
    packing_score: 0,
    kind: "card",
    card_id,
    card_type: lock_kind === "symbol_note_exact" ? "symbol_note" : "constraint",
    lock_reason: { card_id, kind: lock_kind },
  };
}

function candidate(
  version_id: string,
  score: number,
  tokens: number,
  kind: "doc_chunk" | "card" = "doc_chunk",
  source_rerank_rank?: number,
): CandidateTrace {
  const base = {
    version_id,
    bm25_norm: score,
    heading_match: 0,
    scope_match: 0,
    mention_overlap: 0,
    specificity: 1,
    text_score: score,
    final_score: score,
    token_count: tokens,
    packing_score: tokens > 0 ? score / Math.sqrt(tokens) : score,
  };
  if (kind === "card") {
    return {
      ...base,
      kind: "card",
      card_id: version_id,
      card_type: "constraint",
    };
  }
  return {
    ...base,
    kind: "doc_chunk",
    ...(source_rerank_rank !== undefined ? { source_rerank_rank } : {}),
  };
}

describe("packWithLocked — locked-first hard guarantee (D37, ADR-0010)", () => {
  it("under-budget case: locked + chunks all fit", () => {
    const locked = [lockedCard("C001", 200)];
    const candidates = [candidate("v1", 1.0, 300), candidate("v2", 0.5, 200)];
    const r = packWithLocked({
      locked,
      candidates,
      budget_tokens: 1000,
      min_final_score: 0.05,
    });
    expect(r.locked).toHaveLength(1);
    expect(r.included.map((x) => x.version_id).sort()).toEqual(["v1", "v2"]);
    expect(r.budget.requested).toBe(1000);
    expect(r.budget.used).toBe(700);
    expect(r.budget.locked_overhead).toBe(0);
    expect(r.warnings).toHaveLength(0);
    expect(r.total_tokens).toBe(700);
    expect(r.safety_net_engaged).toBe(false);
  });

  it("locked-overflow: locked exceeds budget — emits warning, locked still all in pack", () => {
    const locked = [
      lockedCard("C001", 4000),
      lockedCard("C002", 3000),
      lockedCard("S001", 1000, "symbol_note_exact"),
    ];
    const candidates = [candidate("v1", 1.0, 500)];
    const r = packWithLocked({
      locked,
      candidates,
      budget_tokens: 6000,
      min_final_score: 0.05,
    });
    // All 8000 locked tokens are in.
    expect(r.locked.map((x) => x.card_id)).toEqual(["C001", "C002", "S001"]);
    // Remaining budget = max(0, 6000 - 8000) = 0; no chunks fit.
    expect(r.included).toHaveLength(0);
    // Warning surfaces deficit and per-card costs.
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]!.kind).toBe("locked_overflow");
    expect(r.warnings[0]!.message).toContain("2000"); // deficit
    expect(r.budget.locked_overhead).toBe(2000);
    // total_tokens is the full locked sum.
    expect(r.total_tokens).toBe(8000);
  });

  it("exact-budget case: locked fills budget exactly, no chunks fit", () => {
    const locked = [lockedCard("C001", 6000)];
    const candidates = [candidate("v1", 1.0, 100)];
    const r = packWithLocked({
      locked,
      candidates,
      budget_tokens: 6000,
      min_final_score: 0.05,
    });
    expect(r.included).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
    expect(r.budget.locked_overhead).toBe(0);
    expect(r.budget.used).toBe(6000);
  });

  it("no locked cards: behaves like classic pack", () => {
    const r = packWithLocked({
      locked: [],
      candidates: [
        candidate("v1", 1.0, 200),
        candidate("v2", 0.8, 300),
      ],
      budget_tokens: 1000,
      min_final_score: 0.05,
    });
    expect(r.locked).toHaveLength(0);
    expect(r.included.map((x) => x.version_id).sort()).toEqual(["v1", "v2"]);
    expect(r.budget.locked_overhead).toBe(0);
  });

  it("filters candidates below min_final_score (unless every candidate is below)", () => {
    const r = packWithLocked({
      locked: [],
      candidates: [
        candidate("v1", 1.0, 100),
        candidate("v2", 0.01, 100),
      ],
      budget_tokens: 1000,
      min_final_score: 0.05,
    });
    expect(r.included.map((x) => x.version_id)).toEqual(["v1"]);
    expect(r.omitted.map((x) => x.version_id)).toEqual(["v2"]);
    expect(r.omitted[0]!.omitted_reason).toBe("below_threshold");
  });

  it("locked items never appear in omitted, even when overflowing", () => {
    const r = packWithLocked({
      locked: [lockedCard("C001", 9000)],
      candidates: [candidate("v1", 1.0, 100)],
      budget_tokens: 6000,
      min_final_score: 0.05,
    });
    expect(r.omitted.find((x) => x.version_id === "C001")).toBeUndefined();
  });

  it("included is sorted by packing_score descending", () => {
    const r = packWithLocked({
      locked: [],
      candidates: [
        candidate("low", 0.2, 100),
        candidate("high", 1.0, 100),
        candidate("mid", 0.5, 100),
      ],
      budget_tokens: 1000,
      min_final_score: 0.05,
    });
    expect(r.included.map((x) => x.version_id)).toEqual(["high", "mid", "low"]);
  });

  it("promotes the first chunk from each source-rerank source before repeats", () => {
    const r = packWithLocked({
      locked: [],
      candidates: [
        candidate("source-1-a", 1.0, 100, "doc_chunk", 1),
        candidate("source-1-b", 0.9, 100, "doc_chunk", 1),
        candidate("source-2-a", 0.8, 100, "doc_chunk", 2),
        candidate("source-3-a", 0.7, 100, "doc_chunk", 3),
      ],
      budget_tokens: 300,
      min_final_score: 0.05,
    });

    expect(r.included.map((x) => x.version_id)).toEqual([
      "source-1-a",
      "source-2-a",
      "source-3-a",
    ]);
    expect(r.omitted.map((x) => x.version_id)).toContain("source-1-b");
  });
});
