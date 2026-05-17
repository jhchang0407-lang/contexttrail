import { describe, expect, it } from "vitest";
import {
  buildCodeLaneDiagnostics,
  comparePairedCodeLaneSummaries,
  renderPairedCodeLaneComparison,
  runPairedCodeLaneComparison,
} from "./code-lane-comparison.js";
import {
  summarizeAgentCompletionDetailedRows,
  type AgentCompletionDetailedSummary,
  withCodeSourceIndexOverride,
} from "./agent-completion-probe.js";

function makeSummary(
  lane: "old" | "new",
): AgentCompletionDetailedSummary {
  const old = lane === "old";
  return summarizeAgentCompletionDetailedRows(
    [
      {
        ticket: "THO-1",
        commit: "abc1234",
        changedFiles: ["src/a.ts"],
        mentionedFiles: old ? [] : ["src/a.ts"],
        srcOverlap: old ? 0 : 1,
        srcTotal: 1,
        docOverlap: 0,
        docTotal: 0,
        topCodeFiles: old ? [] : ["src/a.ts"],
        topThreeCodeFiles: old ? [] : ["src/a.ts"],
        topThreeCodeChangedFiles: old ? [] : ["src/a.ts"],
        rankedCodeFiles: old ? [] : ["src/a.ts"],
        rankedCodeChangedFiles: old ? [] : ["src/a.ts"],
        supportClusterFiles: [],
        supportClusterChangedFiles: [],
        topCodeAcceptable: !old,
        rankedCodeUseful: !old,
        supportClusterUseful: false,
      },
      {
        ticket: "THO-2",
        commit: "def5678",
        changedFiles: ["src/b.ts", "src/c.ts", "docs/prd.md"],
        mentionedFiles: old ? ["src/b.ts"] : ["src/b.ts", "src/c.ts"],
        srcOverlap: old ? 1 : 2,
        srcTotal: 2,
        docOverlap: 0,
        docTotal: 1,
        topCodeFiles: old ? [] : ["src/decoy.ts"],
        topThreeCodeFiles: old ? [] : ["src/decoy.ts", "src/c.ts"],
        topThreeCodeChangedFiles: old ? [] : ["src/c.ts"],
        rankedCodeFiles: old ? [] : ["src/decoy.ts", "src/c.ts"],
        rankedCodeChangedFiles: old ? [] : ["src/c.ts"],
        supportClusterFiles: old ? [] : ["src/c.ts"],
        supportClusterChangedFiles: old ? [] : ["src/c.ts"],
        topCodeAcceptable: false,
        rankedCodeUseful: !old,
        supportClusterUseful: !old,
      },
    ],
    2,
  );
}

describe("comparePairedCodeLaneSummaries", () => {
  it("preserves paired old-vs-new file and code usefulness metrics per ticket", () => {
    const comparison = comparePairedCodeLaneSummaries({
      oldSummary: makeSummary("old"),
      newSummary: makeSummary("new"),
      budgetTokensOverride: 4096,
    });

    expect(comparison.budgetTokensOverride).toBe(4096);
    expect(comparison.caseCount).toBe(2);
    expect(comparison.fileCoverage.old).toEqual({ mentioned: 0, total: 3 });
    expect(comparison.fileCoverage.new).toEqual({ mentioned: 2, total: 3 });
    expect(comparison.codeTop1.old).toEqual({ hits: 0, total: 2 });
    expect(comparison.codeTop1.new).toEqual({ hits: 1, total: 2 });
    expect(comparison.codeRankedUseful.old).toEqual({ hits: 0, total: 2 });
    expect(comparison.codeRankedUseful.new).toEqual({ hits: 2, total: 2 });
    expect(comparison.supportClusterUseful.old).toEqual({ hits: 0, total: 2 });
    expect(comparison.supportClusterUseful.new).toEqual({ hits: 1, total: 2 });
    expect(comparison.rows[0]).toMatchObject({
      ticket: "THO-1",
      old: { srcOverlap: 0, topCodeAcceptable: false, rankedCodeUseful: false },
      new: { srcOverlap: 1, topCodeAcceptable: true, rankedCodeUseful: true },
    });
  });
});

describe("buildCodeLaneDiagnostics", () => {
  it("reports per-ticket missing files and aggregates repeated next-target files", () => {
    const summary = summarizeAgentCompletionDetailedRows(
      [
          {
            ticket: "THO-A",
            commit: "aaa1111",
            changedFiles: ["src/schema.ts", "src/parser.ts"],
            mentionedFiles: ["src/schema.ts", "src/parser.ts"],
            srcOverlap: 2,
            srcTotal: 2,
            docOverlap: 0,
            docTotal: 0,
            topCodeFiles: ["src/parser.ts"],
            topThreeCodeFiles: ["src/parser.ts"],
            topThreeCodeChangedFiles: ["src/parser.ts"],
            rankedCodeFiles: ["src/parser.ts"],
            rankedCodeChangedFiles: ["src/parser.ts"],
            supportClusterFiles: [],
            supportClusterChangedFiles: [],
            topCodeAcceptable: true,
            rankedCodeUseful: true,
            supportClusterUseful: false,
          },
          {
            ticket: "THO-B",
            commit: "bbb2222",
            changedFiles: ["src/schema.ts", "src/lift.ts"],
            mentionedFiles: ["src/schema.ts", "src/lift.ts"],
            srcOverlap: 2,
            srcTotal: 2,
            docOverlap: 0,
            docTotal: 0,
            topCodeFiles: ["src/decoy-a.ts"],
            topThreeCodeFiles: ["src/decoy-a.ts", "src/decoy-b.ts", "src/decoy-c.ts"],
            topThreeCodeChangedFiles: [],
            rankedCodeFiles: [
              "src/decoy-a.ts",
              "src/decoy-b.ts",
              "src/decoy-c.ts",
              "src/schema.ts",
              "src/lift.ts",
            ],
            rankedCodeChangedFiles: ["src/schema.ts", "src/lift.ts"],
            supportClusterFiles: ["src/lift.ts"],
            supportClusterChangedFiles: ["src/lift.ts"],
            topCodeAcceptable: false,
            rankedCodeUseful: true,
            supportClusterUseful: true,
          },
      ],
      2,
    );

    const diagnostics = buildCodeLaneDiagnostics(summary.rows);

    expect(diagnostics.ticketDiagnostics).toEqual([
      {
        ticket: "THO-A",
        commit: "aaa1111",
        missingFromRanked: ["src/schema.ts"],
        rankedBelowTop3: [],
        supportMissing: ["src/schema.ts", "src/parser.ts"],
        bodyOnly: ["src/schema.ts"],
      },
      {
        ticket: "THO-B",
        commit: "bbb2222",
        missingFromRanked: [],
        rankedBelowTop3: ["src/schema.ts", "src/lift.ts"],
        supportMissing: ["src/schema.ts"],
        bodyOnly: [],
      },
    ]);
    expect(diagnostics.nextTargetFiles[0]).toMatchObject({
      file: "src/schema.ts",
      tickets: ["THO-A", "THO-B"],
      missCounts: {
        missing_from_ranked: 1,
        ranked_below_top3: 1,
        support_missing: 2,
        body_only: 1,
      },
    });
  });

  it("groups residual misses by implementation family and miss shape", () => {
    const summary = summarizeAgentCompletionDetailedRows(
      [
        {
          ticket: "THO-PERSIST",
          commit: "aaa1111",
          changedFiles: ["src/store/schema.ts", "src/store/db.ts"],
          mentionedFiles: ["src/store/schema.ts"],
          srcOverlap: 1,
          srcTotal: 2,
          docOverlap: 0,
          docTotal: 0,
          topCodeFiles: ["src/store/db.ts"],
          topThreeCodeFiles: ["src/store/db.ts"],
          topThreeCodeChangedFiles: ["src/store/db.ts"],
          rankedCodeFiles: ["src/store/db.ts"],
          rankedCodeChangedFiles: ["src/store/db.ts"],
          supportClusterFiles: [],
          supportClusterChangedFiles: [],
          topCodeAcceptable: true,
          rankedCodeUseful: true,
          supportClusterUseful: false,
        },
        {
          ticket: "THO-SOURCE",
          commit: "bbb2222",
          changedFiles: ["src/types/source-profile.ts", "src/parse/source-profile.ts"],
          mentionedFiles: ["src/types/source-profile.ts", "src/parse/source-profile.ts"],
          srcOverlap: 2,
          srcTotal: 2,
          docOverlap: 0,
          docTotal: 0,
          topCodeFiles: ["src/parse/source-profile.ts"],
          topThreeCodeFiles: ["src/parse/source-profile.ts"],
          topThreeCodeChangedFiles: ["src/parse/source-profile.ts"],
          rankedCodeFiles: ["src/parse/source-profile.ts", "src/types/source-profile.ts"],
          rankedCodeChangedFiles: ["src/parse/source-profile.ts", "src/types/source-profile.ts"],
          supportClusterFiles: ["src/parse/source-profile.ts"],
          supportClusterChangedFiles: ["src/parse/source-profile.ts"],
          topCodeAcceptable: true,
          rankedCodeUseful: true,
          supportClusterUseful: true,
        },
        {
          ticket: "THO-IMPORT",
          commit: "ccc3333",
          changedFiles: ["src/cli/import.ts", "src/parse/chunker.ts"],
          mentionedFiles: ["src/cli/import.ts", "src/parse/chunker.ts"],
          srcOverlap: 2,
          srcTotal: 2,
          docOverlap: 0,
          docTotal: 0,
          topCodeFiles: ["src/cli/import.ts"],
          topThreeCodeFiles: ["src/cli/import.ts", "src/parse/chunker.ts"],
          topThreeCodeChangedFiles: ["src/cli/import.ts", "src/parse/chunker.ts"],
          rankedCodeFiles: ["src/cli/import.ts", "src/parse/chunker.ts"],
          rankedCodeChangedFiles: ["src/cli/import.ts", "src/parse/chunker.ts"],
          supportClusterFiles: ["src/cli/import.ts"],
          supportClusterChangedFiles: ["src/cli/import.ts"],
          topCodeAcceptable: true,
          rankedCodeUseful: true,
          supportClusterUseful: true,
        },
      ],
      3,
    );

    const diagnostics = buildCodeLaneDiagnostics(summary.rows);

    const persistence = diagnostics.residualFamilies.find(
      (family) => family.family === "persistence_substrate",
    );
    expect(persistence).toMatchObject({
      tickets: ["THO-PERSIST"],
      missCounts: {
        missing_from_ranked: 1,
        ranked_below_top3: 0,
        support_missing: 2,
        body_only: 1,
      },
      files: ["src/store/db.ts", "src/store/schema.ts"],
    });

    const sourceProfile = diagnostics.residualFamilies.find(
      (family) => family.family === "source_profile_storage",
    );
    expect(sourceProfile).toMatchObject({
      tickets: ["THO-SOURCE"],
      missCounts: {
        missing_from_ranked: 0,
        ranked_below_top3: 1,
        support_missing: 1,
        body_only: 0,
      },
      files: ["src/types/source-profile.ts"],
    });

    const importWorkflow = diagnostics.residualFamilies.find(
      (family) => family.family === "import_workflow",
    );
    expect(importWorkflow).toMatchObject({
      tickets: ["THO-IMPORT"],
      missCounts: {
        missing_from_ranked: 0,
        ranked_below_top3: 0,
        support_missing: 1,
        body_only: 0,
      },
      files: ["src/parse/chunker.ts"],
    });
  });
});

describe("renderPairedCodeLaneComparison", () => {
  it("renders side-by-side old-vs-new file coverage and code usefulness", () => {
    const rendered = renderPairedCodeLaneComparison(
      comparePairedCodeLaneSummaries({
        oldSummary: makeSummary("old"),
        newSummary: makeSummary("new"),
      }),
    );

    expect(rendered).toContain("PAIRED CODE-LANE COMPARISON");
    expect(rendered).toContain("Old (file-card)");
    expect(rendered).toContain("New (chunk-first)");
    expect(rendered).toContain("Ranked code-file coverage");
    expect(rendered).toContain("Code top-1 acceptable");
    expect(rendered).toContain("Code ranked useful");
    expect(rendered).toContain("Support-cluster useful");
    expect(rendered).toContain("Top-3 hit / top-1 miss");
    expect(rendered).toContain("Ranked miss");
    expect(rendered).toContain("Prompt variant top-1");
    expect(rendered).toContain("Prompt variant top-3");
    expect(rendered).toContain("Prompt variant ranked");
    expect(rendered).toContain("Code-lane diagnostics");
    expect(rendered).toContain("Next target files:");
    expect(rendered).toContain("missing_from_ranked:");
    expect(rendered).toContain("ranked_below_top3:");
    expect(rendered).toContain("body_only:");
    expect(rendered).toContain("THO-1");
    expect(rendered).toContain("THO-2");
  });
});

describe("runPairedCodeLaneComparison", () => {
  it("runs the same budgeted task panel with code lane off then on", async () => {
    const calls: Array<{ budgetTokensOverride?: number; codeSourceIndexEnabled?: boolean }> = [];
    const comparison = await runPairedCodeLaneComparison({
      budgetTokensOverride: 8192,
      runEval: async (options) => {
        calls.push(options);
        return options.codeSourceIndexEnabled ? makeSummary("new") : makeSummary("old");
      },
    });

    expect(calls).toEqual([
      { budgetTokensOverride: 8192, codeSourceIndexEnabled: false },
      { budgetTokensOverride: 8192, codeSourceIndexEnabled: true },
    ]);
    expect(comparison.fileCoverage.new.mentioned).toBe(2);
  });
});

describe("withCodeSourceIndexOverride", () => {
  it("restores the previous env value after success", async () => {
    process.env.RETRIEVAL_CODE_SOURCE_INDEX = "true";

    await withCodeSourceIndexOverride(false, async () => {
      expect(process.env.RETRIEVAL_CODE_SOURCE_INDEX).toBe("off");
    });

    expect(process.env.RETRIEVAL_CODE_SOURCE_INDEX).toBe("true");
  });

  it("restores the previous env value after failure", async () => {
    process.env.RETRIEVAL_CODE_SOURCE_INDEX = "on";

    await expect(
      withCodeSourceIndexOverride(true, async () => {
        expect(process.env.RETRIEVAL_CODE_SOURCE_INDEX).toBe("on");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(process.env.RETRIEVAL_CODE_SOURCE_INDEX).toBe("on");
  });
});
