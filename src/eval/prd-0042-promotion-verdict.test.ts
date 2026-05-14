import { describe, expect, it } from "vitest";
import {
  buildPrd0042ValidationRepos,
  evaluatePrd0042PromotionVerdict,
  getPrimaryCodeLaneComparison,
  renderPrd0042PromotionVerdict,
} from "./prd-0042-promotion-verdict.js";
import type { PairedCodeLaneComparison } from "./code-lane-comparison.js";
import type { AgentTaskSuccessVerdict } from "./task-success.js";
import type { PairedWorkflowAssemblyComparison } from "./workflow-assembly-comparison.js";

function makeCodeLaneComparison(): PairedCodeLaneComparison {
  return {
    budgetTokensOverride: 4096,
    caseCount: 1,
    fileCoverage: {
      old: { mentioned: 64, total: 66 },
      new: { mentioned: 65, total: 66 },
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
      totalSrc: 66,
      totalSrcOverlap: 64,
      totalDoc: 0,
      totalDocOverlap: 0,
      codeCaseCount: 1,
      topCodeAcceptableCount: 0,
      rankedCodeUsefulCount: 0,
      supportClusterUsefulCount: 0,
      rankedCodeFileOverlap: { mentioned: 64, total: 66 },
      bodyMentionOnlyFileOverlap: { mentioned: 0, total: 66 },
      supportClusterFileOverlap: { mentioned: 0, total: 66 },
      rows: [],
    },
    newSummary: {
      caseCount: 1,
      totalSrc: 66,
      totalSrcOverlap: 65,
      totalDoc: 0,
      totalDocOverlap: 0,
      codeCaseCount: 1,
      topCodeAcceptableCount: 1,
      rankedCodeUsefulCount: 1,
      supportClusterUsefulCount: 1,
      rankedCodeFileOverlap: { mentioned: 65, total: 66 },
      bodyMentionOnlyFileOverlap: { mentioned: 0, total: 66 },
      supportClusterFileOverlap: { mentioned: 1, total: 66 },
      rows: [],
    },
    rows: [],
  };
}

function makeLowCoverageButImprovedComparison(): PairedCodeLaneComparison {
  return {
    budgetTokensOverride: 4096,
    caseCount: 1,
    fileCoverage: {
      old: { mentioned: 13, total: 66 },
      new: { mentioned: 15, total: 66 },
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
      totalSrc: 66,
      totalSrcOverlap: 13,
      totalDoc: 0,
      totalDocOverlap: 0,
      codeCaseCount: 1,
      topCodeAcceptableCount: 0,
      rankedCodeUsefulCount: 0,
      supportClusterUsefulCount: 0,
      rankedCodeFileOverlap: { mentioned: 13, total: 66 },
      bodyMentionOnlyFileOverlap: { mentioned: 0, total: 66 },
      supportClusterFileOverlap: { mentioned: 0, total: 66 },
      rows: [],
    },
    newSummary: {
      caseCount: 1,
      totalSrc: 66,
      totalSrcOverlap: 15,
      totalDoc: 0,
      totalDocOverlap: 0,
      codeCaseCount: 1,
      topCodeAcceptableCount: 1,
      rankedCodeUsefulCount: 1,
      supportClusterUsefulCount: 1,
      rankedCodeFileOverlap: { mentioned: 15, total: 66 },
      bodyMentionOnlyFileOverlap: { mentioned: 0, total: 66 },
      supportClusterFileOverlap: { mentioned: 1, total: 66 },
      rows: [],
    },
    rows: [],
  };
}

function makeWorkflowComparison(): PairedWorkflowAssemblyComparison {
  return {
    budgetTokensOverride: undefined,
    workflowServed: {
      old: { served: 22, total: 23 },
      new: { served: 22, total: 23 },
    },
    workflowChunks: {
      old: { covered: 21, total: 22 },
      new: { covered: 22, total: 22 },
    },
    oldReport: {
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
        supportRawHits: 19,
        supportTraversedHits: 22,
        supportTotal: 23,
        chunkRawHits: 18,
        chunkTraversedHits: 21,
        chunkTotal: 22,
        ticketsServedRaw: 20,
        ticketsServedTraversed: 22,
        avgRawSources: 2.1,
        avgLinkPulledSources: 0.7,
      },
      cases: [],
    },
    newReport: {
      repoRoot: "/repo",
      fixturePath: "/repo/tests/fixtures/workflow.yaml",
      summary: {
        tickets: 23,
        totalQueries: 46,
        topK: 5,
        linkHops: 2,
        importedSources: 19,
        primaryRawHits: 21,
        primaryTraversedHits: 22,
        primaryTotal: 23,
        supportRawHits: 20,
        supportTraversedHits: 23,
        supportTotal: 23,
        chunkRawHits: 20,
        chunkTraversedHits: 22,
        chunkTotal: 22,
        ticketsServedRaw: 21,
        ticketsServedTraversed: 22,
        avgRawSources: 2.2,
        avgLinkPulledSources: 0.8,
      },
      cases: [],
    },
  };
}

function makeVerdict(
  ticket: string,
  acceptableChange: boolean,
): AgentTaskSuccessVerdict {
  return {
    ticket,
    commit_sha: "abc1234",
    task: `Task ${ticket}`,
    budget: "default",
    lowSignalExpectation: "ordinary",
    expectedChangeTargetText: "src/example.ts",
    reachedRightFiles: acceptableChange,
    acceptableChange,
    missingSurfacedFiles: acceptableChange ? [] : ["src/example.ts"],
    missingChangedFiles: acceptableChange ? [] : ["src/example.ts"],
    supportClusterFiles: [],
    supportClusterChangedFiles: [],
    supportClusterContributed: false,
    evaluationMode: "deterministic_file_set",
    acceptableOutcomeNotes: ["note"],
  };
}

describe("evaluatePrd0042PromotionVerdict", () => {
  it("fails with named miss buckets when downstream or honesty evidence is still missing", () => {
    const verdict = evaluatePrd0042PromotionVerdict({
      primaryCodeLane: makeCodeLaneComparison(),
      crossRepoRepoCount: 2,
      workflowAssembly: makeWorkflowComparison(),
    });

    expect(verdict.pass).toBe(false);
    expect(verdict.failed_gates).toContain("downstream_task_success_measured");
    expect(verdict.failed_gates).toContain("token_accounting_and_pack_honesty");
    expect(verdict.recommendation).toBe("keep_shadow_mode");
  });

  it("passes only when every named gate is satisfied", () => {
    const verdict = evaluatePrd0042PromotionVerdict({
      primaryCodeLane: makeCodeLaneComparison(),
      crossRepoRepoCount: 2,
      workflowAssembly: makeWorkflowComparison(),
      downstreamTaskSuccess: {
        oldVerdicts: [makeVerdict("THO-1", false)],
        newVerdicts: [makeVerdict("THO-1", true)],
      },
      honesty: {
        coverageConfidenceHonest: true,
        packReadinessHonest: true,
        queryModeHonest: true,
      },
    });

    expect(verdict.pass).toBe(true);
    expect(verdict.failed_gates).toEqual([]);
    expect(verdict.recommendation).toBe("eligible_for_human_review");
  });

  it("treats primary file coverage as a paired non-regression gate on the same panel", () => {
    const verdict = evaluatePrd0042PromotionVerdict({
      primaryCodeLane: makeLowCoverageButImprovedComparison(),
      crossRepoRepoCount: 2,
      workflowAssembly: makeWorkflowComparison(),
      downstreamTaskSuccess: {
        oldVerdicts: [makeVerdict("THO-1", false)],
        newVerdicts: [makeVerdict("THO-1", true)],
      },
      honesty: {
        coverageConfidenceHonest: true,
        packReadinessHonest: true,
        queryModeHonest: true,
      },
    });

    expect(
      verdict.gates.find((gate) => gate.name === "primary_file_coverage_floor"),
    ).toMatchObject({ pass: true, baseline: "13/66", current: "15/66" });
    expect(verdict.pass).toBe(true);
  });
});

describe("renderPrd0042PromotionVerdict", () => {
  it("renders a durable shadow recommendation with old-vs-new evidence sections", () => {
    const rendered = renderPrd0042PromotionVerdict(
      evaluatePrd0042PromotionVerdict({
        primaryCodeLane: makeCodeLaneComparison(),
        crossRepoRepoCount: 2,
        workflowAssembly: makeWorkflowComparison(),
        downstreamTaskSuccess: {
          oldVerdicts: [makeVerdict("THO-1", false)],
          newVerdicts: [makeVerdict("THO-1", true)],
        },
        honesty: {
          coverageConfidenceHonest: false,
          packReadinessHonest: true,
          queryModeHonest: true,
        },
      }),
    );

    expect(rendered).toContain("PRD-0042 Promotion Verdict");
    expect(rendered).toContain("Recommendation");
    expect(rendered).toContain("keep_shadow_mode");
    expect(rendered).toContain("Old (file-card)");
    expect(rendered).toContain("New (chunk-first)");
    expect(rendered).toContain("downstream_task_success");
    expect(rendered).toContain("token_accounting_and_pack_honesty");
  });
});

describe("buildPrd0042ValidationRepos", () => {
  it("uses the requested repo root for the primary validation repo", () => {
    const repos = buildPrd0042ValidationRepos("/tmp/custom-root");

    expect(repos[0].id).toBe("contexttrail");
    expect(repos[0].repoRoot).toBe("/tmp/custom-root");
    expect(repos[1].id).toBe("ralph");
  });
});

describe("getPrimaryCodeLaneComparison", () => {
  it("selects the primary repo comparison by repo id instead of array position", () => {
    const primary = makeCodeLaneComparison();
    const report = {
      budgetTokensOverride: 4096,
      repos: [
        {
          repo: {
            id: "ralph",
            name: "Ralph",
            repoRoot: "/repo/ralph",
            minimumTaskPanel: ["THO-25"],
          },
          comparison: makeCodeLaneComparison(),
        },
        {
          repo: {
            id: "contexttrail",
            name: "ContextTrail",
            repoRoot: "/repo/contexttrail",
            minimumTaskPanel: ["THO-227"],
          },
          comparison: primary,
        },
      ],
    };

    expect(
      getPrimaryCodeLaneComparison({
        report,
      }),
    ).toBe(primary);
  });

  it("throws a clear error when the primary repo is missing from the report", () => {
    expect(() =>
      getPrimaryCodeLaneComparison({
        report: {
          budgetTokensOverride: 4096,
          repos: [
            {
              repo: {
                id: "ralph",
                name: "Ralph",
                repoRoot: "/repo/ralph",
                minimumTaskPanel: ["THO-25"],
              },
              comparison: makeCodeLaneComparison(),
            },
          ],
        },
      }),
    ).toThrow("Missing primary validation repo 'contexttrail'");
  });
});
