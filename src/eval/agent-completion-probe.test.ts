/**
 * THO-236 (PRD-0029 / 29.2) — agent-completion probe gate wiring tests.
 *
 * The probe enforces two locked floors:
 *   - per-commit:  10/14 (baseline 11/14 − 1 commit)
 *   - per-file:    60/66 (baseline 62/66 − 2 files)
 *
 * Each floor must break independently — a regression on either axis
 * fails the build, regardless of the other axis. The two cases below
 * cover both breach paths separately, per ticket acceptance.
 */
import { describe, expect, it } from "vitest";
import {
  agentCompletionVerdictFromSummary,
  categorizeAgentCompletionPath,
  emitAgentCompletionProbeCli,
  extractMentionedPaths,
  parseAgentCompletionBudgetArgs,
  renderAgentCompletionBudgetSweepTable,
  renderAgentCompletionReport,
  summarizeAgentCompletionDetailedRows,
  summarizeAgentCompletionRows,
  type AgentCompletionDetailedRow,
  type AgentCompletionProbeRow,
} from "./agent-completion-probe.js";

describe("agent-completion probe — assembly gate wiring (PRD-0029 / 29.2)", () => {
  it("passes at the ratcheted 13/14 commit and 65/66 file measurement (post-PRD-0032)", () => {
    const rows: AgentCompletionProbeRow[] = [
      {
        ticket: "THO-pass",
        commit: "abc1234",
        changedFiles: ["src/a.ts", "src/b.ts", "docs/a.md"],
        mentionedFiles: ["src/a.ts", "src/b.ts", "docs/a.md"],
        srcOverlap: 2,
        srcTotal: 2,
        docOverlap: 1,
        docTotal: 1,
      },
    ];
    const summary = summarizeAgentCompletionRows(rows, 1);
    const verdict = agentCompletionVerdictFromSummary({
      ...summary,
      totalSrc: 66,
      totalSrcOverlap: 65,
      totalDoc: 1,
      totalDocOverlap: 1,
      rows: Array.from({ length: 14 }, (_, index) => ({
        ticket: `THO-${index}`,
        commit: `sha-${index}`,
        changedFiles: ["src/a.ts"],
        mentionedFiles: index < 13 ? ["src/a.ts"] : [],
        srcOverlap: index < 13 ? 1 : 0,
        srcTotal: 1,
        docOverlap: 0,
        docTotal: 0,
      })),
      caseCount: 14,
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.failed_gates).toEqual([]);
  });

  it("deliberate regression — commit floor breached only, file floor still held", () => {
    // Post-PRD-0032 floors: commits 12/14, files 63/66.
    // 11/14 commits fails commit floor (12). 65/66 files holds the new
    // file floor (63).
    const verdict = agentCompletionVerdictFromSummary({
      caseCount: 14,
      rows: Array.from({ length: 14 }, (_, index) => ({
        ticket: `THO-${index}`,
        commit: `sha-${index}`,
        changedFiles: ["src/a.ts"],
        mentionedFiles: index < 11 ? ["src/a.ts"] : [],
        srcOverlap: index < 11 ? 1 : 0,
        srcTotal: 1,
        docOverlap: 0,
        docTotal: 0,
      })),
      totalSrc: 66,
      totalSrcOverlap: 65,
      totalDoc: 0,
      totalDocOverlap: 0,
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.failed_gates).toEqual(["agent_completion_commits_floor"]);
  });

  it("deliberate regression — file floor breached only, commit floor still held", () => {
    // Post-PRD-0032 floors: commits 12/14, files 63/66. 62/66 fails file
    // floor (63). 14/14 commits holds commit floor (12).
    const verdict = agentCompletionVerdictFromSummary({
      caseCount: 14,
      rows: Array.from({ length: 14 }, (_, index) => ({
        ticket: `THO-${index}`,
        commit: `sha-${index}`,
        changedFiles: ["src/a.ts"],
        mentionedFiles: ["src/a.ts"],
        srcOverlap: 1,
        srcTotal: 1,
        docOverlap: 0,
        docTotal: 0,
      })),
      totalSrc: 66,
      totalSrcOverlap: 62,
      totalDoc: 0,
      totalDocOverlap: 0,
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.failed_gates).toEqual(["agent_completion_files_floor"]);
  });

  it("renders the verdict block on the same CLI path the probe uses", () => {
    // Post-PRD-0032 floors: 65/66 files clears the 63/66 floor; 14/14
    // commits clears the 12/14 floor.
    const summary = {
      caseCount: 14,
      rows: Array.from({ length: 14 }, (_, index) => ({
        ticket: `THO-${index}`,
        commit: `sha-${index}`,
        changedFiles: ["src/a.ts"],
        mentionedFiles: ["src/a.ts"],
        srcOverlap: 1,
        srcTotal: 1,
        docOverlap: 0,
        docTotal: 0,
      })),
      totalSrc: 66,
      totalSrcOverlap: 65,
      totalDoc: 0,
      totalDocOverlap: 0,
    };
    const writes: string[] = [];
    let exitCode: number | null = null;

    const verdict = emitAgentCompletionProbeCli({
      summary,
      io: {
        write: (text) => writes.push(text),
        exit: (code) => {
          exitCode = code;
        },
      },
    });

    expect(verdict.pass).toBe(true);
    expect(exitCode).toBeNull();
    expect(writes.join("")).toContain(renderAgentCompletionReport(summary).trim());
    expect(writes.join("")).toContain("Assembly Gate Verdict: PASS");
  });

  it("parses --budget=N and --budget-sweep=N1,N2,N3 flags (PRD-0030 / 30.2)", () => {
    expect(parseAgentCompletionBudgetArgs([])).toEqual({});
    expect(parseAgentCompletionBudgetArgs(["--budget=4096"])).toEqual({ budget: 4096 });
    expect(parseAgentCompletionBudgetArgs(["--budget-sweep=4096,8192,16384"])).toEqual({
      budgetSweep: [4096, 8192, 16384],
    });
    expect(parseAgentCompletionBudgetArgs(["--budget-sweep=4096, 8192 ,abc,0,16384"])).toEqual({
      budgetSweep: [4096, 8192, 16384],
    });
  });

  it("renders per-budget table with per-file headline and per-commit context (PRD-0030 / 30.2)", () => {
    const table = renderAgentCompletionBudgetSweepTable([
      { budget: 4096, srcOverlap: 55, srcTotal: 66, commitsPassing: 11, commitsTotal: 14 },
      { budget: 8192, srcOverlap: 60, srcTotal: 66, commitsPassing: 13, commitsTotal: 14 },
      { budget: 16384, srcOverlap: 62, srcTotal: 66, commitsPassing: 14, commitsTotal: 14 },
    ]);
    expect(table).toContain("budget");
    expect(table).toContain("file_retention");
    expect(table).toContain("commit_retention");
    expect(table).toContain("delta_vs_default");
    expect(table).toContain("55 / 66");
    expect(table).toContain("11 / 14");
    expect(table).toContain("baseline");
    const lines = table.split("\n");
    const baselineLine = lines.find((line) => line.includes("baseline"));
    expect(baselineLine).toContain("16384");
    const smallLine = lines.find((line) => line.startsWith("4096"));
    expect(smallLine).toMatch(/-7\s+files?/);
  });

  it("fails the CLI path when the file-total baseline drifts", () => {
    const summary = {
      caseCount: 14,
      rows: Array.from({ length: 14 }, (_, index) => ({
        ticket: `THO-${index}`,
        commit: `sha-${index}`,
        changedFiles: ["src/a.ts"],
        mentionedFiles: ["src/a.ts"],
        srcOverlap: 1,
        srcTotal: 1,
        docOverlap: 0,
        docTotal: 0,
      })),
      totalSrc: 80,
      totalSrcOverlap: 60,
      totalDoc: 0,
      totalDocOverlap: 0,
    };
    const writes: string[] = [];
    let exitCode: number | null = null;

    const verdict = emitAgentCompletionProbeCli({
      summary,
      io: {
        write: (text) => writes.push(text),
        exit: (code) => {
          exitCode = code;
        },
      },
    });

    expect(verdict.pass).toBe(false);
    expect(exitCode).toBe(1);
    expect(writes.join("")).toContain("Assembly Gate Verdict: FAIL");
    expect(writes.join("")).toContain("agent_completion_files_floor");
  });

  it("counts structured source_path entries even when the body does not spell out the file path", () => {
    expect(
      [...extractMentionedPaths({
        body: "export function refund() { return true; }",
        source_path: "src/payments/refund.ts",
      })],
    ).toEqual(["src/payments/refund.ts"]);
  });

  it("treats common OSS monorepo package paths as source files, not non-code leftovers", () => {
    expect(categorizeAgentCompletionPath("packages/query-core/src/query.ts")).toBe("src");
    expect(categorizeAgentCompletionPath("apps/docs/src/router.tsx")).toBe("src");
    expect(categorizeAgentCompletionPath("crates/cli/src/main.rs")).toBe("src");
    expect(categorizeAgentCompletionPath("internal/server/handler.go")).toBe("src");
    expect(categorizeAgentCompletionPath("packages/query-core/src/query.test.ts")).toBe("test");
    expect(categorizeAgentCompletionPath("args_test.go")).toBe("test");
    expect(categorizeAgentCompletionPath("docs/query.md")).toBe("doc");
  });

  it("extracts package-path file mentions from retrieved bodies for OSS eval accounting", () => {
    expect(
      [...extractMentionedPaths({
        body: "The fix belongs in packages/query-core/src/query.ts and apps/docs/src/router.tsx.",
      })].sort(),
    ).toEqual([
      "apps/docs/src/router.tsx",
      "packages/query-core/src/query.ts",
    ]);
  });

  it("attributes detailed source-file coverage to support-cluster code entries", () => {
    const rows: AgentCompletionDetailedRow[] = [
      {
        ticket: "THO-support",
        commit: "abc1234",
        changedFiles: ["src/owner.ts", "src/schema.ts"],
        mentionedFiles: ["src/owner.ts", "src/schema.ts"],
        srcOverlap: 2,
        srcTotal: 2,
        docOverlap: 0,
        docTotal: 0,
        topCodeFiles: ["src/owner.ts"],
        rankedCodeFiles: ["src/owner.ts", "src/schema.ts"],
        rankedCodeChangedFiles: ["src/owner.ts", "src/schema.ts"],
        supportClusterFiles: ["src/schema.ts"],
        supportClusterChangedFiles: ["src/schema.ts"],
        topCodeAcceptable: true,
        rankedCodeUseful: true,
        supportClusterUseful: true,
      },
      {
        ticket: "THO-owner-only",
        commit: "def5678",
        changedFiles: ["src/owner-only.ts"],
        mentionedFiles: ["src/owner-only.ts"],
        srcOverlap: 1,
        srcTotal: 1,
        docOverlap: 0,
        docTotal: 0,
        topCodeFiles: ["src/owner-only.ts"],
        rankedCodeFiles: ["src/owner-only.ts"],
        rankedCodeChangedFiles: ["src/owner-only.ts"],
        supportClusterFiles: [],
        supportClusterChangedFiles: [],
        topCodeAcceptable: true,
        rankedCodeUseful: true,
        supportClusterUseful: false,
      },
    ];

    const summary = summarizeAgentCompletionDetailedRows(rows, 2);

    expect(summary.supportClusterUsefulCount).toBe(1);
    expect(summary.supportClusterFileOverlap).toEqual({ mentioned: 1, total: 3 });
    expect(summary.rankedCodeFileOverlap).toEqual({ mentioned: 3, total: 3 });
    expect(summary.bodyMentionOnlyFileOverlap).toEqual({ mentioned: 0, total: 3 });
    expect(renderAgentCompletionReport(summary)).toContain("Support-cluster useful: 1/2");
  });

  it("keeps body-only path mentions separate from actual ranked code-file hits", () => {
    const rows: AgentCompletionDetailedRow[] = [
      {
        ticket: "THO-body-only",
        commit: "abc1234",
        changedFiles: ["src/owner.ts", "src/schema.ts"],
        mentionedFiles: ["src/owner.ts", "src/schema.ts"],
        srcOverlap: 2,
        srcTotal: 2,
        docOverlap: 0,
        docTotal: 0,
        topCodeFiles: ["src/owner.ts"],
        rankedCodeFiles: ["src/owner.ts"],
        rankedCodeChangedFiles: ["src/owner.ts"],
        supportClusterFiles: [],
        supportClusterChangedFiles: [],
        topCodeAcceptable: true,
        rankedCodeUseful: true,
        supportClusterUseful: false,
      },
    ];

    const summary = summarizeAgentCompletionDetailedRows(rows, 1);

    expect(summary.totalSrcOverlap).toBe(2);
    expect(summary.rankedCodeFileOverlap).toEqual({ mentioned: 1, total: 2 });
    expect(summary.bodyMentionOnlyFileOverlap).toEqual({ mentioned: 1, total: 2 });
    expect(renderAgentCompletionReport(summary)).toContain("Body-mention-only file hits: 1/2");
  });

  it("classifies code retrieval misses by top-1, top-3, ranked, and body-only failure shape", () => {
    const rows: AgentCompletionDetailedRow[] = [
      {
        ticket: "THO-top1",
        commit: "aaa1111",
        changedFiles: ["src/top1.ts"],
        mentionedFiles: ["src/top1.ts"],
        srcOverlap: 1,
        srcTotal: 1,
        docOverlap: 0,
        docTotal: 0,
        topCodeFiles: ["src/top1.ts"],
        topThreeCodeFiles: ["src/top1.ts"],
        topThreeCodeChangedFiles: ["src/top1.ts"],
        rankedCodeFiles: ["src/top1.ts"],
        rankedCodeChangedFiles: ["src/top1.ts"],
        supportClusterFiles: [],
        supportClusterChangedFiles: [],
        topCodeAcceptable: true,
        rankedCodeUseful: true,
        supportClusterUseful: false,
      },
      {
        ticket: "THO-promote",
        commit: "bbb2222",
        changedFiles: ["src/promote.ts"],
        mentionedFiles: ["src/promote.ts"],
        srcOverlap: 1,
        srcTotal: 1,
        docOverlap: 0,
        docTotal: 0,
        topCodeFiles: ["src/decoy.ts"],
        topThreeCodeFiles: ["src/decoy.ts", "src/promote.ts"],
        topThreeCodeChangedFiles: ["src/promote.ts"],
        rankedCodeFiles: ["src/decoy.ts", "src/promote.ts"],
        rankedCodeChangedFiles: ["src/promote.ts"],
        supportClusterFiles: ["src/promote.ts"],
        supportClusterChangedFiles: ["src/promote.ts"],
        topCodeAcceptable: false,
        rankedCodeUseful: true,
        supportClusterUseful: true,
      },
      {
        ticket: "THO-below-top3",
        commit: "ccc3333",
        changedFiles: ["src/below.ts"],
        mentionedFiles: ["src/below.ts"],
        srcOverlap: 1,
        srcTotal: 1,
        docOverlap: 0,
        docTotal: 0,
        topCodeFiles: ["src/decoy-a.ts"],
        topThreeCodeFiles: ["src/decoy-a.ts", "src/decoy-b.ts", "src/decoy-c.ts"],
        topThreeCodeChangedFiles: [],
        rankedCodeFiles: [
          "src/decoy-a.ts",
          "src/decoy-b.ts",
          "src/decoy-c.ts",
          "src/below.ts",
        ],
        rankedCodeChangedFiles: ["src/below.ts"],
        supportClusterFiles: [],
        supportClusterChangedFiles: [],
        topCodeAcceptable: false,
        rankedCodeUseful: true,
        supportClusterUseful: false,
      },
      {
        ticket: "THO-body-only",
        commit: "ddd4444",
        changedFiles: ["src/body-only.ts"],
        mentionedFiles: ["src/body-only.ts"],
        srcOverlap: 1,
        srcTotal: 1,
        docOverlap: 0,
        docTotal: 0,
        topCodeFiles: ["src/decoy.ts"],
        topThreeCodeFiles: ["src/decoy.ts"],
        topThreeCodeChangedFiles: [],
        rankedCodeFiles: ["src/decoy.ts"],
        rankedCodeChangedFiles: [],
        supportClusterFiles: [],
        supportClusterChangedFiles: [],
        topCodeAcceptable: false,
        rankedCodeUseful: false,
        supportClusterUseful: false,
      },
      {
        ticket: "THO-ranked-miss",
        commit: "eee5555",
        changedFiles: ["src/missing.ts"],
        mentionedFiles: [],
        srcOverlap: 0,
        srcTotal: 1,
        docOverlap: 0,
        docTotal: 0,
        topCodeFiles: ["src/decoy.ts"],
        topThreeCodeFiles: ["src/decoy.ts"],
        topThreeCodeChangedFiles: [],
        rankedCodeFiles: ["src/decoy.ts"],
        rankedCodeChangedFiles: [],
        supportClusterFiles: [],
        supportClusterChangedFiles: [],
        topCodeAcceptable: false,
        rankedCodeUseful: false,
        supportClusterUseful: false,
      },
    ];

    const summary = summarizeAgentCompletionDetailedRows(rows, rows.length);

    expect(summary.missShapeSummary.caseBuckets).toEqual({
      top1_hit: 1,
      top3_hit_top1_miss: 1,
      ranked_hit_top3_miss: 1,
      ranked_miss_body_only: 1,
      ranked_miss: 1,
    });
    expect(summary.missShapeSummary.fileBuckets).toMatchObject({
      rankedHits: 3,
      topThreeHits: 2,
      bodyOnlyHits: 1,
      missingFromRanked: 2,
      totalSrc: 5,
    });
    expect(summary.missShapeSummary.supportBuckets).toEqual({
      useful: 1,
      couldPromoteTop1Miss: 1,
      missingWhenTop1Missed: 3,
    });
    expect(renderAgentCompletionReport(summary)).toContain("Miss taxonomy:");
    expect(renderAgentCompletionReport(summary)).toContain("top3_hit_top1_miss: 1");
  });

  it("summarizes prompt-variant robustness separately from ticket-level union coverage", () => {
    const rows: AgentCompletionDetailedRow[] = [
      {
        ticket: "THO-variants",
        commit: "abc1234",
        changedFiles: ["src/owner.ts", "src/schema.ts"],
        mentionedFiles: ["src/owner.ts", "src/schema.ts"],
        srcOverlap: 2,
        srcTotal: 2,
        docOverlap: 0,
        docTotal: 0,
        topCodeFiles: ["src/owner.ts"],
        topThreeCodeFiles: ["src/owner.ts", "src/schema.ts"],
        topThreeCodeChangedFiles: ["src/owner.ts", "src/schema.ts"],
        rankedCodeFiles: ["src/owner.ts", "src/schema.ts"],
        rankedCodeChangedFiles: ["src/owner.ts", "src/schema.ts"],
        supportClusterFiles: ["src/schema.ts"],
        supportClusterChangedFiles: ["src/schema.ts"],
        topCodeAcceptable: true,
        rankedCodeUseful: true,
        supportClusterUseful: true,
        promptVariants: [
          {
            query: "direct owner prompt",
            mentionedFiles: ["src/owner.ts"],
            topCodeFiles: ["src/owner.ts"],
            topThreeCodeFiles: ["src/owner.ts"],
            topThreeCodeChangedFiles: ["src/owner.ts"],
            rankedCodeFiles: ["src/owner.ts"],
            rankedCodeChangedFiles: ["src/owner.ts"],
            supportClusterFiles: [],
            supportClusterChangedFiles: [],
            srcOverlap: 1,
            topCodeAcceptable: true,
            topThreeCodeUseful: true,
            rankedCodeUseful: true,
            supportClusterUseful: false,
          },
          {
            query: "schema support prompt",
            mentionedFiles: ["src/schema.ts"],
            topCodeFiles: ["src/decoy.ts"],
            topThreeCodeFiles: ["src/decoy.ts", "src/schema.ts"],
            topThreeCodeChangedFiles: ["src/schema.ts"],
            rankedCodeFiles: ["src/decoy.ts", "src/schema.ts"],
            rankedCodeChangedFiles: ["src/schema.ts"],
            supportClusterFiles: ["src/schema.ts"],
            supportClusterChangedFiles: ["src/schema.ts"],
            srcOverlap: 1,
            topCodeAcceptable: false,
            topThreeCodeUseful: true,
            rankedCodeUseful: true,
            supportClusterUseful: true,
          },
        ],
      },
      {
        ticket: "THO-single",
        commit: "def5678",
        changedFiles: ["src/single.ts"],
        mentionedFiles: ["src/single.ts"],
        srcOverlap: 1,
        srcTotal: 1,
        docOverlap: 0,
        docTotal: 0,
        topCodeFiles: ["src/single.ts"],
        topThreeCodeFiles: ["src/single.ts"],
        topThreeCodeChangedFiles: ["src/single.ts"],
        rankedCodeFiles: ["src/single.ts"],
        rankedCodeChangedFiles: ["src/single.ts"],
        supportClusterFiles: [],
        supportClusterChangedFiles: [],
        topCodeAcceptable: true,
        rankedCodeUseful: true,
        supportClusterUseful: false,
      },
    ];

    const summary = summarizeAgentCompletionDetailedRows(rows, rows.length);

    expect(summary.promptVariantSummary).toEqual({
      promptCount: 3,
      promptTop1Acceptable: 2,
      promptTop3Useful: 3,
      promptRankedUseful: 3,
      promptSupportUseful: 1,
      promptRankedCodeFileHits: 3,
      promptRankedCodeFileTotal: 5,
      ticketsWithPromptVariants: 2,
      ticketsTop1Robust: 1,
      ticketsTop3Robust: 2,
      ticketsRankedRobust: 2,
    });
    expect(renderAgentCompletionReport(summary)).toContain("Prompt variants:");
    expect(renderAgentCompletionReport(summary)).toContain("prompt top-3 useful: 3/3");
    expect(renderAgentCompletionReport(summary)).toContain("tickets top-1 robust: 1/2");
    expect(renderAgentCompletionReport(summary)).toContain("direct owner prompt");
    expect(renderAgentCompletionReport(summary)).toContain("top1=hit top3=hit ranked=hit support=miss");
  });
});
