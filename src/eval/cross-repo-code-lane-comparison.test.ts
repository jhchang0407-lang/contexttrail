import { describe, expect, it } from "vitest";
import {
  renderCrossRepoCodeLaneComparison,
  runCrossRepoCodeLaneComparison,
} from "./cross-repo-code-lane-comparison.js";
import type { PairedCodeLaneComparison } from "./code-lane-comparison.js";

function makeComparison(repoName: string): PairedCodeLaneComparison {
  return {
    budgetTokensOverride: 4096,
    caseCount: 1,
    fileCoverage: {
      old: { mentioned: 1, total: 3 },
      new: { mentioned: 2, total: 3 },
    },
    codeTop1: {
      old: { hits: 0, total: 1 },
      new: { hits: 1, total: 1 },
    },
    codeRankedUseful: {
      old: { hits: 0, total: 1 },
      new: { hits: 1, total: 1 },
    },
    supportClusterUseful: {
      old: { hits: 0, total: 1 },
      new: { hits: 1, total: 1 },
    },
    oldSummary: {
      caseCount: 1,
      totalSrc: 3,
      totalSrcOverlap: 1,
      totalDoc: 0,
      totalDocOverlap: 0,
      codeCaseCount: 1,
      topCodeAcceptableCount: 0,
      rankedCodeUsefulCount: 0,
      supportClusterUsefulCount: 0,
      rankedCodeFileOverlap: { mentioned: 0, total: 3 },
      bodyMentionOnlyFileOverlap: { mentioned: 1, total: 3 },
      supportClusterFileOverlap: { mentioned: 0, total: 3 },
      rows: [
        {
          ticket: `${repoName}-old`,
          commit: "abc1234",
          changedFiles: ["src/example.ts"],
          mentionedFiles: [],
          srcOverlap: 0,
          srcTotal: 1,
          docOverlap: 0,
          docTotal: 0,
          topCodeFiles: [],
          rankedCodeFiles: [],
          rankedCodeChangedFiles: [],
          supportClusterFiles: [],
          supportClusterChangedFiles: [],
          topCodeAcceptable: false,
          rankedCodeUseful: false,
          supportClusterUseful: false,
        },
      ],
    },
    newSummary: {
      caseCount: 1,
      totalSrc: 3,
      totalSrcOverlap: 2,
      totalDoc: 0,
      totalDocOverlap: 0,
      codeCaseCount: 1,
      topCodeAcceptableCount: 1,
      rankedCodeUsefulCount: 1,
      supportClusterUsefulCount: 1,
      rankedCodeFileOverlap: { mentioned: 1, total: 3 },
      bodyMentionOnlyFileOverlap: { mentioned: 1, total: 3 },
      supportClusterFileOverlap: { mentioned: 1, total: 3 },
      rows: [
        {
          ticket: `${repoName}-new`,
          commit: "def5678",
          changedFiles: ["src/example.ts"],
          mentionedFiles: ["src/example.ts"],
          srcOverlap: 1,
          srcTotal: 1,
          docOverlap: 0,
          docTotal: 0,
          topCodeFiles: ["src/example.ts"],
          rankedCodeFiles: ["src/example.ts"],
          rankedCodeChangedFiles: ["src/example.ts"],
          supportClusterFiles: ["src/example.ts"],
          supportClusterChangedFiles: ["src/example.ts"],
          topCodeAcceptable: true,
          rankedCodeUseful: true,
          supportClusterUseful: true,
        },
      ],
    },
    rows: [
      {
        ticket: `${repoName}-ticket`,
        commit: "abc1234",
        old: {
          ticket: `${repoName}-ticket`,
          commit: "abc1234",
          changedFiles: ["src/example.ts"],
          mentionedFiles: [],
          srcOverlap: 0,
          srcTotal: 1,
          docOverlap: 0,
          docTotal: 0,
          topCodeFiles: [],
          rankedCodeFiles: [],
          rankedCodeChangedFiles: [],
          supportClusterFiles: [],
          supportClusterChangedFiles: [],
          topCodeAcceptable: false,
          rankedCodeUseful: false,
          supportClusterUseful: false,
        },
        new: {
          ticket: `${repoName}-ticket`,
          commit: "abc1234",
          changedFiles: ["src/example.ts"],
          mentionedFiles: ["src/example.ts"],
          srcOverlap: 1,
          srcTotal: 1,
          docOverlap: 0,
          docTotal: 0,
          topCodeFiles: ["src/example.ts"],
          rankedCodeFiles: ["src/example.ts"],
          rankedCodeChangedFiles: ["src/example.ts"],
          supportClusterFiles: ["src/example.ts"],
          supportClusterChangedFiles: ["src/example.ts"],
          topCodeAcceptable: true,
          rankedCodeUseful: true,
          supportClusterUseful: true,
        },
      },
    ],
  };
}

describe("runCrossRepoCodeLaneComparison", () => {
  it("runs the same paired budgeted comparison for every repo panel", async () => {
    const calls: Array<{ repoId: string; budgetTokensOverride?: number }> = [];

    const report = await runCrossRepoCodeLaneComparison({
      repos: [
        {
          id: "contexttrail",
          name: "ContextTrail",
          repoRoot: "/repo/contexttrail",
          minimumTaskPanel: ["THO-227", "THO-219"],
        },
        {
          id: "ralph",
          name: "Ralph",
          repoRoot: "/repo/ralph",
          minimumTaskPanel: ["THO-25", "THO-24"],
        },
      ],
      budgetTokensOverride: 4096,
      runComparison: async (repo, options) => {
        calls.push({ repoId: repo.id, budgetTokensOverride: options.budgetTokensOverride });
        return makeComparison(repo.name);
      },
    });

    expect(calls).toEqual([
      { repoId: "contexttrail", budgetTokensOverride: 4096 },
      { repoId: "ralph", budgetTokensOverride: 4096 },
    ]);
    expect(report.repos.map((entry) => entry.repo.id)).toEqual([
      "contexttrail",
      "ralph",
    ]);
  });
});

describe("renderCrossRepoCodeLaneComparison", () => {
  it("renders repo-labelled sections so cross-repo verdicts are easy to distinguish", () => {
    const rendered = renderCrossRepoCodeLaneComparison({
      budgetTokensOverride: 4096,
      repos: [
        {
          repo: {
            id: "contexttrail",
            name: "ContextTrail",
            repoRoot: "/repo/contexttrail",
            minimumTaskPanel: ["THO-227", "THO-219"],
          },
          comparison: makeComparison("ContextTrail"),
        },
        {
          repo: {
            id: "ralph",
            name: "Ralph",
            repoRoot: "/repo/ralph",
            minimumTaskPanel: ["THO-25", "THO-24"],
          },
          comparison: makeComparison("Ralph"),
        },
      ],
    });

    expect(rendered).toContain("CROSS-REPO CODE-LANE COMPARISON");
    expect(rendered).toContain("Repo: ContextTrail");
    expect(rendered).toContain("Repo: Ralph");
    expect(rendered).toContain("task panel: THO-227, THO-219");
    expect(rendered).toContain("task panel: THO-25, THO-24");
    expect(rendered).toContain("Same budget across every repo section: 4096");
  });
});
