import { describe, it, expect } from "vitest";
import { scopeMatchScore } from "./scope-match.js";
import type { ChunkScope } from "../types/chunk.js";

const chunkScope = (overrides: Partial<ChunkScope>): ChunkScope => ({
  layer: "module",
  source: {},
  ...overrides,
});

describe("scope-match — hierarchical 1.0 / 0.6 / 0.3 / 0", () => {
  it("module match → 1.0", () => {
    const cs = chunkScope({ project: "payments", module: "refunds" });
    const s = scopeMatchScore([{ project: "payments", module: "refunds" }], cs);
    expect(s).toBe(1.0);
  });

  it("project match (chunk has different module) → 0.6", () => {
    const cs = chunkScope({ project: "payments", module: "audit" });
    const s = scopeMatchScore([{ project: "payments", module: "refunds" }], cs);
    expect(s).toBeCloseTo(0.6);
  });

  it("team match only → 0.3", () => {
    const cs = chunkScope({ team: "fundops", project: "billing" });
    const s = scopeMatchScore(
      [{ team: "fundops", project: "payments" }],
      cs,
    );
    expect(s).toBeCloseTo(0.3);
  });

  it("no overlap → 0", () => {
    const cs = chunkScope({ project: "billing" });
    const s = scopeMatchScore([{ project: "payments" }], cs);
    expect(s).toBe(0);
  });

  it("missing query scope (empty array) → 0 (neutral, not 1)", () => {
    const cs = chunkScope({ project: "payments" });
    expect(scopeMatchScore([], cs)).toBe(0);
  });

  it("multi-scope OR via max(...)", () => {
    const cs = chunkScope({ project: "payments", module: "refunds" });
    // First query scope is wrong project; second matches at module level.
    const s = scopeMatchScore(
      [
        { project: "billing", module: "invoices" },
        { project: "payments", module: "refunds" },
      ],
      cs,
    );
    expect(s).toBe(1.0);
  });
});
