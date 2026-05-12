import { describe, expect, it } from "vitest";
import {
  emitRealWorkflowProbeCli,
  loadRealWorkflowCases,
  parseProbeBudgetArgs,
  renderBudgetSweepTable,
  renderRealWorkflowReport,
  scoreRealWorkflowCase,
  summarizeRealWorkflow,
  workflowAssemblyVerdictFromReport,
  type RealWorkflowReport,
} from "./real-workflow-probe.js";
import { evaluateAssemblyGates } from "./assembly-gate-bands.js";

describe("real-workflow context assembly fixture", () => {
  it("loads the permanent Linear-ticket workflow fixture", () => {
    const cases = loadRealWorkflowCases();
    expect(cases).toHaveLength(23);
    expect(cases.map((entry) => entry.ticket)).toContain("THO-228");
    expect(cases.map((entry) => entry.ticket)).toContain("THO-185-stub");
    for (const entry of cases) {
      expect(entry.queries.length).toBeGreaterThan(0);
      expect(entry.required_primary.length).toBeGreaterThan(0);
    }
    expect(cases.filter((entry) => (entry.must_include_chunks ?? []).length > 0)).toHaveLength(22);
  });
});

describe("scoreRealWorkflowCase", () => {
  it("scores primary and support coverage separately before and after traversal", () => {
    const row = scoreRealWorkflowCase({
      entry: {
        ticket: "T",
        title: "Task",
        queries: ["query"],
        required_primary: ["docs/prd.md"],
        required_support: [["docs/adr.md", "docs/schema.md"]],
        must_include_chunks: [
          {
            source: "docs/prd.md",
            heading_path: ["PRD", "Implementation"],
            rationale: "The task needs the implementation slice.",
          },
        ],
      },
      rawSources: ["docs/prd.md"],
      traversedSources: ["docs/prd.md", "docs/adr.md"],
      rawChunks: [JSON.stringify(["docs/prd.md", ["PRD", "Implementation"]])],
      traversedChunks: [JSON.stringify(["docs/prd.md", ["PRD", "Implementation"]])],
    });

    expect(row.primaryMissingRaw).toEqual([]);
    expect(row.primaryMissingTraversed).toEqual([]);
    expect(row.supportRawCovered).toBe(0);
    expect(row.supportTraversedCovered).toBe(1);
    expect(row.linkPulledSources).toEqual(["docs/adr.md"]);
    expect(row.chunkTraversedCovered).toBe(1);
    expect(row.chunkMissingTraversed).toEqual([]);
  });

  it("summarizes tickets served only when primary and every support group are covered", () => {
    const rows = [
      scoreRealWorkflowCase({
        entry: {
          ticket: "served",
          title: "Served",
          queries: ["q1", "q2"],
          required_primary: ["docs/a.md"],
          required_support: [["docs/b.md"]],
          must_include_chunks: [
            { source: "docs/a.md", heading_path: ["A"], rationale: "A" },
          ],
        },
        rawSources: ["docs/a.md"],
        traversedSources: ["docs/a.md", "docs/b.md"],
        rawChunks: [JSON.stringify(["docs/a.md", ["A"]])],
        traversedChunks: [JSON.stringify(["docs/a.md", ["A"]])],
      }),
      scoreRealWorkflowCase({
        entry: {
          ticket: "miss",
          title: "Miss",
          queries: ["q"],
          required_primary: ["docs/c.md"],
          required_support: [["docs/d.md"]],
          must_include_chunks: [
            { source: "docs/c.md", heading_path: ["C"], rationale: "C" },
          ],
        },
        rawSources: ["docs/x.md"],
        traversedSources: ["docs/x.md", "docs/d.md"],
      }),
    ];

    const summary = summarizeRealWorkflow({
      cases: rows,
      topK: 3,
      linkHops: 2,
      importedSources: 10,
    });
    expect(summary.tickets).toBe(2);
    expect(summary.totalQueries).toBe(3);
    expect(summary.ticketsServedRaw).toBe(0);
    expect(summary.ticketsServedTraversed).toBe(1);
    expect(summary.primaryTraversedHits).toBe(1);
    expect(summary.supportTraversedHits).toBe(2);
    expect(summary.chunkTraversedHits).toBe(1);
    expect(summary.chunkTotal).toBe(2);
  });
});

describe("real-workflow probe — assembly gate wiring (PRD-0029 / 29.1)", () => {
  it("passes the gate at the current 22/23 measurement", () => {
    const verdict = evaluateAssemblyGates({
      workflow_assembly: { served: 22, total: 23 },
    });
    expect(verdict.pass).toBe(true);
  });

  it("deliberate regression — dropping the served count past the band fails the workflow_assembly_floor gate", () => {
    const verdict = evaluateAssemblyGates({
      workflow_assembly: { served: 20, total: 23 },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.failed_gates).toEqual(["workflow_assembly_floor"]);
  });

  it("renders the verdict block on the same CLI path the probe uses", () => {
    const report: RealWorkflowReport = {
      repoRoot: "/repo",
      fixturePath: "/repo/tests/fixtures/workflow.yaml",
      summary: {
        tickets: 23,
        totalQueries: 46,
        topK: 5,
        linkHops: 2,
        importedSources: 19,
        primaryRawHits: 20,
        primaryTraversedHits: 22,
        primaryTotal: 23,
        supportRawHits: 18,
        supportTraversedHits: 23,
        supportTotal: 23,
        chunkRawHits: 20,
        chunkTraversedHits: 22,
        chunkTotal: 22,
        ticketsServedRaw: 19,
        ticketsServedTraversed: 22,
        avgRawSources: 2.1,
        avgLinkPulledSources: 0.7,
      },
      cases: [],
    };
    const writes: string[] = [];
    let exitCode: number | null = null;

    const verdict = emitRealWorkflowProbeCli({
      report,
      json: false,
      io: {
        write: (text) => writes.push(text),
        exit: (code) => {
          exitCode = code;
        },
      },
    });

    expect(verdict.pass).toBe(true);
    expect(exitCode).toBeNull();
    expect(writes.join("")).toContain(renderRealWorkflowReport(report).trim());
    expect(writes.join("")).toContain("Assembly Gate Verdict: PASS");
  });

  it("parses --budget=N and --budget-sweep=N1,N2,N3 flags (PRD-0030 / 30.1)", () => {
    expect(parseProbeBudgetArgs([])).toEqual({});
    expect(parseProbeBudgetArgs(["--budget=4096"])).toEqual({ budget: 4096 });
    expect(parseProbeBudgetArgs(["--budget-sweep=4096,8192,16384"])).toEqual({
      budgetSweep: [4096, 8192, 16384],
    });
    expect(parseProbeBudgetArgs(["--json", "--budget=8192", "--budget-sweep=4096,8192"])).toEqual({
      budget: 8192,
      budgetSweep: [4096, 8192],
    });
    // Tolerate whitespace and reject non-positive entries.
    expect(parseProbeBudgetArgs(["--budget-sweep=4096, 8192 ,abc,0,16384"])).toEqual({
      budgetSweep: [4096, 8192, 16384],
    });
  });

  it("renders a per-budget retention table with delta vs largest budget (PRD-0030 / 30.1)", () => {
    const table = renderBudgetSweepTable([
      { budget: 4096, served: 18, total: 23, chunkCovered: 16, chunkTotal: 22 },
      { budget: 8192, served: 21, total: 23, chunkCovered: 20, chunkTotal: 22 },
      { budget: 16384, served: 22, total: 23, chunkCovered: 21, chunkTotal: 22 },
    ]);
    expect(table).toContain("budget");
    expect(table).toContain("workflow_doc");
    expect(table).toContain("workflow_chunk");
    expect(table).toContain("delta_vs_default");
    expect(table).toContain("4096");
    expect(table).toContain("18 / 23");
    expect(table).toContain("16 / 22");
    expect(table).toContain("78.3%");
    expect(table).toContain("baseline");
    // The largest budget is the baseline row.
    const lines = table.split("\n");
    const baselineLine = lines.find((line) => line.includes("baseline"));
    expect(baselineLine).toContain("16384");
    // Smaller budget shows a negative delta.
    const smallLine = lines.find((line) => line.startsWith(" 4096") || line.startsWith("4096"));
    expect(smallLine).toMatch(/-4\s+cases?/);
  });

  it("fails the CLI path when the workflow total drifts past the locked baseline", () => {
    const report: RealWorkflowReport = {
      repoRoot: "/repo",
      fixturePath: "/repo/tests/fixtures/workflow.yaml",
      summary: {
        tickets: 24,
        totalQueries: 46,
        topK: 5,
        linkHops: 2,
        importedSources: 19,
        primaryRawHits: 20,
        primaryTraversedHits: 22,
        primaryTotal: 24,
        supportRawHits: 18,
        supportTraversedHits: 23,
        supportTotal: 24,
        chunkRawHits: 19,
        chunkTraversedHits: 21,
        chunkTotal: 22,
        ticketsServedRaw: 19,
        ticketsServedTraversed: 21,
        avgRawSources: 2.1,
        avgLinkPulledSources: 0.7,
      },
      cases: [],
    };
    const writes: string[] = [];
    let exitCode: number | null = null;

    const verdict = emitRealWorkflowProbeCli({
      report,
      json: false,
      io: {
        write: (text) => writes.push(text),
        exit: (code) => {
          exitCode = code;
        },
      },
    });

    expect(workflowAssemblyVerdictFromReport(report).pass).toBe(false);
    expect(verdict.pass).toBe(false);
    expect(exitCode).toBe(1);
    expect(writes.join("")).toContain("Assembly Gate Verdict: FAIL");
    expect(writes.join("")).toContain("workflow_assembly_floor");
  });
});
