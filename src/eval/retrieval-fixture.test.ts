import { describe, expect, it } from "vitest";
import { compareAssemblyStage, runFixtureRetrievalEval } from "./retrieval-fixture.js";

describe("runFixtureRetrievalEval structural assembly readiness subset", () => {
  it("fails fast when an unknown assembly stage reaches comparison", () => {
    expect(() => compareAssemblyStage("bogus", "parent")).toThrow("Unknown assembly stage 'bogus'");
    expect(() => compareAssemblyStage("parent", "bogus")).toThrow("Unknown assembly stage 'bogus'");
  });

  it("records the live assembly stage for targeted week-5 cases", async () => {
    const report = await runFixtureRetrievalEval();
    const byId = new Map(report.observations.map((observation) => [observation.id, observation]));

    expect(byId.get("anchored-idempotency-adr")).toMatchObject({
      assemblyStageExpected: "linked_neighbor",
      assemblyStageActual: "linked_neighbor",
      assemblyStageOk: true,
      underExpanded: false,
      overExpanded: false,
    });

    expect(byId.get("anchored-partial-refund-context")).toMatchObject({
      assemblyStageExpected: "parent",
      assemblyStageActual: "parent",
      assemblyStageOk: true,
      underExpanded: false,
      overExpanded: false,
    });

    expect(byId.get("anchored-partial-refunds-and-edge-cases")).toMatchObject({
      assemblyStageExpected: "siblings",
      assemblyStageActual: "siblings",
      assemblyStageOk: true,
      underExpanded: false,
      overExpanded: false,
    });
  });
});
