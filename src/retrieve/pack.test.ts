import { describe, it, expect } from "vitest";
import { pack } from "./pack.js";
import type { ScoreTrace } from "./score.js";

const trace = (overrides: Partial<ScoreTrace>): ScoreTrace => ({
  version_id: "v",
  bm25_norm: 0.5,
  heading_match: 0.5,
  scope_match: 0,
  mention_overlap: 0,
  specificity: 1,
  text_score: 0.5,
  final_score: 1.0,
  token_count: 100,
  packing_score: 1.0 / Math.sqrt(100),
  ...overrides,
});

describe("packer — greedy by final_score / sqrt(token_count)", () => {
  it("orders by packing_score descending and respects budget", () => {
    const traces = [
      trace({ version_id: "a", final_score: 1.0, token_count: 100 }), // ps=0.10
      trace({ version_id: "b", final_score: 1.0, token_count: 25 }),  // ps=0.20
      trace({ version_id: "c", final_score: 0.5, token_count: 100 }), // ps=0.05
    ];
    for (const t of traces) t.packing_score = t.final_score / Math.sqrt(t.token_count);

    const result = pack(traces, { budget_tokens: 130, min_final_score: 0 });
    expect(result.included.map((r) => r.version_id)).toEqual(["b", "a"]);
    expect(result.included.reduce((s, r) => s + r.token_count, 0)).toBeLessThanOrEqual(130);
    expect(result.omitted.map((r) => r.version_id)).toEqual(["c"]);
    expect(result.omitted[0]!.reason).toMatch(/budget/);
  });

  it("never exceeds budget", () => {
    const traces = [
      trace({ version_id: "a", final_score: 1.0, token_count: 50 }),
      trace({ version_id: "b", final_score: 0.9, token_count: 80 }),
      trace({ version_id: "c", final_score: 0.8, token_count: 200 }),
    ];
    for (const t of traces) t.packing_score = t.final_score / Math.sqrt(t.token_count);

    const result = pack(traces, { budget_tokens: 100, min_final_score: 0 });
    expect(result.included.reduce((s, r) => s + r.token_count, 0)).toBeLessThanOrEqual(100);
  });

  it("drops chunks below min_final_score regardless of packing cheapness", () => {
    const traces = [
      trace({ version_id: "tiny", final_score: 0.04, token_count: 4 }), // ps=0.02 high cheapness
      trace({ version_id: "real", final_score: 0.5, token_count: 100 }),
    ];
    for (const t of traces) t.packing_score = t.final_score / Math.sqrt(t.token_count);

    const result = pack(traces, { budget_tokens: 1000, min_final_score: 0.05 });
    expect(result.included.map((r) => r.version_id)).toEqual(["real"]);
    expect(result.omitted.map((r) => r.version_id)).toEqual(["tiny"]);
    expect(result.omitted[0]!.reason).toMatch(/min_final_score/);
    expect(result.omitted[0]!.omitted_reason).toBe("below_threshold");
  });

  it("falls back to the full candidate set when every trace is below threshold", () => {
    const traces = [
      trace({
        version_id: "module-a",
        final_score: 0,
        token_count: 10,
        packing_score: 0,
        specificity: 1.4,
      }),
      trace({
        version_id: "decision-b",
        final_score: 0,
        token_count: 10,
        packing_score: 0,
        specificity: 1.1,
      }),
    ];

    const result = pack(traces, { budget_tokens: 1000, min_final_score: 0.05 });
    expect(result.included.map((r) => r.version_id)).toEqual(["module-a", "decision-b"]);
    expect(result.omitted).toHaveLength(0);
    expect(result.safety_net_engaged).toBe(true);
  });
});
