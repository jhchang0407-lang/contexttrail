/**
 * THO-235 (PRD-0029 / 29.1) — locked gate-bands module tests.
 *
 * The module encodes PRD-0029 Rule 1 (case-count bands at small N) and
 * Rule 2 (floor = measured baseline − tolerance, never aspirational).
 * Floors live in code, not config, so updates require a deliberate diff
 * (Rule 3).
 */
import { describe, expect, it } from "vitest";
import {
  ASSEMBLY_GATE_BANDS,
  evaluateAssemblyGates,
  renderAssemblyVerdict,
} from "./assembly-gate-bands.js";

describe("ASSEMBLY_GATE_BANDS constant", () => {
  it("locks the PRD-0029 + PRD-0032 baseline table verbatim", () => {
    expect(ASSEMBLY_GATE_BANDS.workflow_assembly).toEqual({
      baseline_served: 22,
      total: 23,
      tolerance_cases: 1,
    });
    // PRD-0032 amendment ratcheted commits 11 → 13 and files 62 → 65
    // after the import-glob sort fix stabilized measurement at higher
    // values. ADR-0021 amendment locks the new baselines.
    expect(ASSEMBLY_GATE_BANDS.agent_completion_commits).toEqual({
      baseline_passing: 13,
      total: 14,
      tolerance_cases: 1,
    });
    expect(ASSEMBLY_GATE_BANDS.agent_completion_files).toEqual({
      baseline_mentioned: 65,
      total: 66,
      tolerance_cases: 2,
    });
  });

  it("is frozen so callers cannot mutate baselines at runtime", () => {
    expect(Object.isFrozen(ASSEMBLY_GATE_BANDS)).toBe(true);
  });
});

describe("evaluateAssemblyGates — workflow_assembly_floor", () => {
  it("passes at the current 22/23 measurement", () => {
    const verdict = evaluateAssemblyGates({
      workflow_assembly: { served: 22, total: 23 },
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.failed_gates).toEqual([]);
  });

  it("passes at the locked floor of 21/23 (baseline − 1 case)", () => {
    const verdict = evaluateAssemblyGates({
      workflow_assembly: { served: 21, total: 23 },
    });
    expect(verdict.pass).toBe(true);
  });

  it("fails at 20/23 with the workflow_assembly_floor gate name", () => {
    const verdict = evaluateAssemblyGates({
      workflow_assembly: { served: 20, total: 23 },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.failed_gates).toContain("workflow_assembly_floor");
  });

  it("fails when the workflow sample size drifts even if the numerator still clears the floor", () => {
    const verdict = evaluateAssemblyGates({
      workflow_assembly: { served: 21, total: 24 },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.failed_gates).toContain("workflow_assembly_floor");
  });
});

describe("evaluateAssemblyGates — agent-completion floors", () => {
  it("passes at the ratcheted baseline (13/14 commits and 65/66 files)", () => {
    const verdict = evaluateAssemblyGates({
      agent_completion_commits: { passing: 13, total: 14 },
      agent_completion_files: { mentioned: 65, total: 66 },
    });
    expect(verdict.pass).toBe(true);
  });

  it("fails when commits drop below the locked 12/14 floor", () => {
    const verdict = evaluateAssemblyGates({
      agent_completion_commits: { passing: 11, total: 14 },
      agent_completion_files: { mentioned: 65, total: 66 },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.failed_gates).toContain("agent_completion_commits_floor");
    expect(verdict.failed_gates).not.toContain("agent_completion_files_floor");
  });

  it("fails when files drop below the locked 63/66 floor (independent of commits)", () => {
    const verdict = evaluateAssemblyGates({
      agent_completion_commits: { passing: 13, total: 14 },
      agent_completion_files: { mentioned: 62, total: 66 },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.failed_gates).toContain("agent_completion_files_floor");
    expect(verdict.failed_gates).not.toContain("agent_completion_commits_floor");
  });

  it("fails when the agent-completion totals drift without an ADR-locked baseline update", () => {
    const verdict = evaluateAssemblyGates({
      agent_completion_commits: { passing: 13, total: 15 },
      agent_completion_files: { mentioned: 60, total: 80 },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.failed_gates).toContain("agent_completion_commits_floor");
    expect(verdict.failed_gates).toContain("agent_completion_files_floor");
  });
});

describe("evaluateAssemblyGates — measurement-driven inclusion", () => {
  it("only emits gates for metrics actually passed in", () => {
    const verdict = evaluateAssemblyGates({
      workflow_assembly: { served: 22, total: 23 },
    });
    expect(verdict.gates.map((g) => g.name)).toEqual(["workflow_assembly_floor"]);
  });
});

describe("renderAssemblyVerdict", () => {
  it("renders a PRD-0016-shaped block with PASS/FAIL header", () => {
    const verdict = evaluateAssemblyGates({
      workflow_assembly: { served: 22, total: 23 },
    });
    const block = renderAssemblyVerdict(verdict);
    expect(block).toContain("Assembly Gate Verdict");
    expect(block).toContain("PASS");
    expect(block).toContain("workflow_assembly_floor");
  });
});
