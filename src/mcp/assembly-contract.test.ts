import { describe, expect, it } from "vitest";
import { schemas } from "./schemas.js";

describe("retrieve_context_pack structural assembly contract", () => {
  it("accepts always-on assembly_stage_reached plus explain-only assembly details", () => {
    const result = schemas.retrieve_context_pack.output.safeParse({
      query_mode: "anchored",
      coverage_confidence: "confident",
      assembly_stage_reached: "parent",
      locked: [],
      ranked: [],
      omitted: { total: 0, by_reason: {}, top: [], truncated: false },
      warnings: [],
      budget: { requested: 6000, used: 0, locked_overhead: 0 },
      explain: {
        per_chunk: [],
        query_compilation: {
          query_mode: "anchored",
          provided_anchor_count: 1,
          recognized_anchor_count: 1,
          anchors: [],
        },
        lock_failures: [],
        assembly: {
          root_version_id: "v_root",
          selected_neighbors: [
            {
              version_id: "v_parent",
              relation: "parent",
              reason: "immediate parent section",
            },
          ],
          early_stop_reason: "first sufficient structural stage",
        },
      },
    });

    expect(result.success).toBe(true);
  });
});
