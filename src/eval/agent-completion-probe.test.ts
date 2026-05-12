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
  emitAgentCompletionProbeCli,
  parseAgentCompletionBudgetArgs,
  renderAgentCompletionBudgetSweepTable,
  renderAgentCompletionReport,
  summarizeAgentCompletionRows,
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
});
