import { describe, expect, it } from "vitest";
import {
  renderAssemblyPressureBenchmark,
  summarizePressureScenario,
  syntheticRetainedRanked,
  type PressureScenario,
} from "./assembly-pressure-benchmark.js";

describe("assembly pressure benchmark", () => {
  it("retains ranked entries within synthetic budget", () => {
    const scenario: PressureScenario = {
      name: "5k_x4",
      targetBudget: 500,
      expansionFactor: 4,
    };
    const retained = syntheticRetainedRanked(
      [
        { id: "a", kind: "chunk", contexttrail: "Source: docs/a.md > Section: A", tokens: 60 },
        { id: "b", kind: "chunk", contexttrail: "Source: docs/b.md > Section: B", tokens: 30 },
        { id: "c", kind: "card", contexttrail: "(constraint)", tokens: 20 },
      ],
      100,
      scenario,
    );
    expect(retained.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("summarizes scenario retention metrics", () => {
    const row = summarizePressureScenario("all", "5k_x4", 5000, 4, [
      {
        originalTop1: "a",
        retained: [
          { id: "a", kind: "chunk", contexttrail: "Source: docs/a.md > Section: A", tokens: 50 },
          { id: "b", kind: "chunk", contexttrail: "Source: docs/b.md > Section: B", tokens: 40 },
        ],
        mustIncludeSources: ["docs/a.md"],
      },
      {
        originalTop1: "x",
        retained: [{ id: "x", kind: "chunk", contexttrail: "Source: docs/x.md > Section: X", tokens: 60 }],
        mustIncludeSources: ["docs/x.md"],
      },
    ]);
    expect(row.top1Retained).toBe(1);
    expect(row.mustIncludeCoverage).toBe(1);
    expect(row.avgRetainedEntries).toBe(1.5);
  });

  it("keeps cohort identity in summarized rows", () => {
    const row = summarizePressureScenario("neighbor_heavy", "5k_x4", 5000, 4, [
      {
        originalTop1: "a",
        retained: [
          { id: "a", kind: "chunk", contexttrail: "Source: docs/a.md > Section: A", tokens: 50 },
          { id: "b", kind: "chunk", contexttrail: "Source: docs/b.md > Section: B", tokens: 40 },
        ],
        mustIncludeSources: ["docs/a.md"],
      },
      {
        originalTop1: "x",
        retained: [{ id: "x", kind: "chunk", contexttrail: "Source: docs/x.md > Section: X", tokens: 60 }],
        mustIncludeSources: ["docs/x.md"],
      },
    ]);
    expect(row.cohort).toBe("neighbor_heavy");
  });

  it("renders the pressure benchmark table", () => {
    const rendered = renderAssemblyPressureBenchmark([
      {
        cohort: "all",
        name: "5k_x4",
        targetBudget: 5000,
        expansionFactor: 4,
        top1Retained: 0.97,
        mustIncludeCoverage: 0.99,
        top3Balance: 0.91,
        avgRetainedEntries: 6,
        avgRetainedTokens: 4800,
      },
      {
        cohort: "neighbor_heavy",
        name: "5k_x4",
        targetBudget: 5000,
        expansionFactor: 4,
        top1Retained: 0.96,
        mustIncludeCoverage: 0.99,
        top3Balance: 0.92,
        avgRetainedEntries: 4,
        avgRetainedTokens: 4700,
      },
    ]);
    expect(rendered).toContain("Assembly pressure benchmark");
    expect(rendered).toContain("Neighbor-heavy cases");
    expect(rendered).toContain("5k_x4");
    expect(rendered).toContain("Recommended pressure target");
  });
});
