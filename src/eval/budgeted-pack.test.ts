import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PresentedContextPack } from "../mcp/presenter.js";
import { budgetedRankedEntries } from "./budgeted-pack.js";

function ranked(
  id: string,
  tokens: number,
  kind: PresentedContextPack["ranked"][number]["kind"] = "chunk",
): PresentedContextPack["ranked"][number] {
  return {
    id,
    kind,
    scope: {},
    tokens,
    score: 1,
    body: id,
    contexttrail: kind === "code" ? `Code: src/${id}.ts` : `Source: docs/${id}.md`,
    type_bias_applied: false,
  };
}

describe("budgetedRankedEntries", () => {
  it("measures the final assembled ranked list under the requested budget", () => {
    const pack: PresentedContextPack = {
      query_mode: "unanchored",
      coverage_confidence: "confident",
      assembly_stage_reached: "linked_neighbor",
      locked: [],
      ranked: [ranked("base-a", 70), ranked("base-b", 20), ranked("link-pulled", 30)],
      omitted: { total: 0, by_reason: {}, top: [], truncated: false },
      warnings: [],
      budget: { requested: 100, used: 90, locked_overhead: 0 },
    };

    expect(budgetedRankedEntries(pack, 100).map((entry) => entry.id)).toEqual([
      "base-a",
      "base-b",
    ]);
  });

  it("reserves budget for locked entries before ranked entries", () => {
    const pack: PresentedContextPack = {
      query_mode: "anchored",
      coverage_confidence: "uncertain",
      assembly_stage_reached: "primary_only",
      locked: [
        {
          id: "card-a",
          kind: "card",
          card_type: "symbol_note",
          scope: {},
          tokens: 60,
          body: "locked",
          contexttrail: "Card: card-a",
          lock_reason: "symbol_note_exact",
          broad_scope: false,
          freshness_state: "fresh",
          freshness_warnings: [],
        },
      ],
      ranked: [ranked("fits", 30), ranked("overflow", 20)],
      omitted: { total: 0, by_reason: {}, top: [], truncated: false },
      warnings: [],
      budget: { requested: 100, used: 90, locked_overhead: 0 },
    };

    expect(budgetedRankedEntries(pack, 100).map((entry) => entry.id)).toEqual(["fits"]);
  });
});

describe("budgetedRankedEntries — kind-balanced (PRD-0032 / 32.2)", () => {
  // Default is on (flipped in slice 32.3); tests force unset/true to be
  // explicit about which path they exercise.
  const KIND_FLAG = "RETRIEVAL_PACK_KIND_BALANCED";
  let prevFlag: string | undefined;
  beforeEach(() => {
    prevFlag = process.env[KIND_FLAG];
    delete process.env[KIND_FLAG];
  });
  afterEach(() => {
    if (prevFlag === undefined) delete process.env[KIND_FLAG];
    else process.env[KIND_FLAG] = prevFlag;
  });

  const emptyOmitted = { total: 0, by_reason: {}, top: [], truncated: false };
  function packOf(entries: PresentedContextPack["ranked"], budget: number): PresentedContextPack {
    return {
      query_mode: "unanchored",
      coverage_confidence: "confident",
      assembly_stage_reached: "linked_neighbor",
      locked: [],
      ranked: entries,
      omitted: emptyOmitted,
      warnings: [],
      budget: { requested: budget, used: 0, locked_overhead: 0 },
    };
  }

  it("inert on code-less corpora (bit-identical to greedy-fit)", () => {
    const pack = packOf(
      [ranked("a", 60), ranked("b", 30), ranked("c", 40)],
      100,
    );
    // Greedy-fit admits a (60) and b (30), skips c (40 > 10).
    expect(budgetedRankedEntries(pack, 100).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("reserves 30% of remaining budget for code kind", () => {
    // Budget 100, code reserve = 30, other reserve = 70.
    // Chunks: c1(50), c2(40) — c1 fits (50<=70), c2 doesn't (90>70). Greedy reorder admits c2.
    //   Actually: c1 fits (50<=70); c2 doesn't (90>70 skipped under reserve).
    // Code: cd1(20), cd2(15) — both fit code reserve (20+15=35>30, so cd1 fits, cd2 doesn't).
    //   Slack from chunks: 70-50=20. cd2(15) fits in slack? No — slack pass admits ANY unfit
    //   entry into total remaining (100 - admitted-so-far). admitted so far: c1=50, cd1=20=70.
    //   total used 70; remaining 30; cd2(15) fits, c2(40) doesn't.
    // Expected admit set: { c1, cd1, cd2 } in rank order.
    const pack = packOf(
      [
        ranked("c1", 50, "chunk"),
        ranked("cd1", 20, "code"),
        ranked("c2", 40, "chunk"),
        ranked("cd2", 15, "code"),
      ],
      100,
    );
    expect(budgetedRankedEntries(pack, 100).map((e) => e.id)).toEqual(["c1", "cd1", "cd2"]);
  });

  it("admits a code entry that pure-greedy-fit would have displaced", () => {
    // Budget 100. Chunks: c1(60), c2(35). Code: cd(20) at rank 2.
    // Pure greedy-fit: c1=60 admitted; c2=35 admitted (95); cd=20 skipped (115>100).
    //   Result: { c1, c2 } — code kind is displaced.
    // Kind-balanced: code reserve = 30, other reserve = 70.
    //   c1=60 admitted (60<=70); c2=35 skipped under chunk reserve (95>70).
    //   cd=20 admitted under code reserve (20<=30).
    //   Slack pass: total used = 80, remaining 20; c2=35 doesn't fit.
    //   Result: { c1, cd } — code entry preserved.
    const pack = packOf(
      [ranked("c1", 60, "chunk"), ranked("c2", 35, "chunk"), ranked("cd", 20, "code")],
      100,
    );
    const ids = budgetedRankedEntries(pack, 100).map((e) => e.id);
    expect(ids).toContain("cd");
    expect(ids).toEqual(["c1", "cd"]);
  });

  it("slack pass uses unused code reserve for chunks", () => {
    // Budget 100, code reserve 30, other reserve 70. No code entries with
    // enough demand to use the reserve.
    const pack = packOf(
      [ranked("c1", 50, "chunk"), ranked("c2", 20, "chunk"), ranked("cd", 5, "code"), ranked("c3", 25, "chunk")],
      100,
    );
    // Pass 1: c1(50)+c2(20)=70 = chunk reserve max. c3(25) doesn't fit chunk reserve (95>70).
    //   cd(5) fits code reserve.
    // Pass 2: total used = 75; remaining 25. c3(25) fits.
    // Result: c1, c2, cd, c3 in rank order.
    const ids = budgetedRankedEntries(pack, 100).map((e) => e.id);
    expect(ids).toEqual(["c1", "c2", "cd", "c3"]);
  });

  it("preserves rank order in output", () => {
    const pack = packOf(
      [ranked("cd1", 10, "code"), ranked("c1", 20, "chunk"), ranked("cd2", 10, "code"), ranked("c2", 20, "chunk")],
      100,
    );
    const ids = budgetedRankedEntries(pack, 100).map((e) => e.id);
    expect(ids).toEqual(["cd1", "c1", "cd2", "c2"]);
  });

  it("flag-off (explicit \"false\") is bit-identical to greedy-fit", () => {
    process.env[KIND_FLAG] = "false";
    const pack = packOf(
      [ranked("c1", 60, "chunk"), ranked("c2", 35, "chunk"), ranked("cd", 20, "code")],
      100,
    );
    expect(budgetedRankedEntries(pack, 100).map((e) => e.id)).toEqual(["c1", "c2"]);
  });
});
