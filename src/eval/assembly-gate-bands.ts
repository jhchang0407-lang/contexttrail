/**
 * PRD-0029: locked tolerance bands for the assembly probes.
 *
 * Rule 1 — small-N probes (N ≤ 50) tolerate cases, not percentage points.
 * Rule 2 — floors are the measured 2026-05-11 baseline minus tolerance.
 * Rule 3 — floors live here, version-controlled. Updates ship in the same
 *          commit as an ADR-0021 amendment.
 *
 * Pure module. No IO. Mirrors the Prd0016Verdict shape so renderers can
 * be shared.
 */

export type AssemblyGateName =
  | "workflow_assembly_floor"
  | "agent_completion_commits_floor"
  | "agent_completion_files_floor";

/**
 * Baselines as of 2026-05-11. PRD-0032 amendment (commit shipping with
 * the import-glob sort fix in src/cli/import.ts) ratcheted commits
 * (11 → 13) and files (62 → 65) baselines after the determinism fix
 * stabilized the measurement at higher values. Floors move with
 * baselines per ADR-0021 Rule 2. The corresponding ADR amendment is
 * locked in docs/adr/0021-gate-calibration-policy.md.
 */
export const ASSEMBLY_GATE_BANDS = Object.freeze({
  workflow_assembly: Object.freeze({
    baseline_served: 22,
    total: 23,
    tolerance_cases: 1,
  }),
  agent_completion_commits: Object.freeze({
    baseline_passing: 13,
    total: 14,
    tolerance_cases: 1,
  }),
  agent_completion_files: Object.freeze({
    baseline_mentioned: 65,
    total: 66,
    tolerance_cases: 2,
  }),
} as const);

export type AssemblyMeasurement = {
  workflow_assembly?: { served: number; total: number };
  agent_completion_commits?: { passing: number; total: number };
  agent_completion_files?: { mentioned: number; total: number };
};

export type AssemblyGateResult = {
  name: AssemblyGateName;
  pass: boolean;
  baseline: string;
  current: string;
  detail: string;
};

export type AssemblyVerdict = {
  pass: boolean;
  failed_gates: AssemblyGateName[];
  gates: AssemblyGateResult[];
};

function workflowFloor(): number {
  const b = ASSEMBLY_GATE_BANDS.workflow_assembly;
  return b.baseline_served - b.tolerance_cases;
}

function commitsFloor(): number {
  const b = ASSEMBLY_GATE_BANDS.agent_completion_commits;
  return b.baseline_passing - b.tolerance_cases;
}

function filesFloor(): number {
  const b = ASSEMBLY_GATE_BANDS.agent_completion_files;
  return b.baseline_mentioned - b.tolerance_cases;
}

function lockedTotalDetail(args: {
  floor: number;
  total: number;
  baseline: number;
  tolerance: number;
  unit: string;
}): string {
  return `must remain ≥ ${args.floor}/${args.total} (baseline ${args.baseline} − ${args.tolerance} ${args.unit}) and keep total locked at ${args.total}`;
}

export function evaluateAssemblyGates(current: AssemblyMeasurement): AssemblyVerdict {
  const gates: AssemblyGateResult[] = [];

  if (current.workflow_assembly) {
    const b = ASSEMBLY_GATE_BANDS.workflow_assembly;
    const floor = workflowFloor();
    const served = current.workflow_assembly.served;
    const totalLocked = current.workflow_assembly.total === b.total;
    gates.push({
      name: "workflow_assembly_floor",
      pass: served >= floor && totalLocked,
      baseline: `${b.baseline_served}/${b.total}`,
      current: `${served}/${current.workflow_assembly.total}`,
      detail: lockedTotalDetail({
        floor,
        total: b.total,
        baseline: b.baseline_served,
        tolerance: b.tolerance_cases,
        unit: "case",
      }),
    });
  }

  if (current.agent_completion_commits) {
    const b = ASSEMBLY_GATE_BANDS.agent_completion_commits;
    const floor = commitsFloor();
    const passing = current.agent_completion_commits.passing;
    const totalLocked = current.agent_completion_commits.total === b.total;
    gates.push({
      name: "agent_completion_commits_floor",
      pass: passing >= floor && totalLocked,
      baseline: `${b.baseline_passing}/${b.total}`,
      current: `${passing}/${current.agent_completion_commits.total}`,
      detail: lockedTotalDetail({
        floor,
        total: b.total,
        baseline: b.baseline_passing,
        tolerance: b.tolerance_cases,
        unit: "commit",
      }),
    });
  }

  if (current.agent_completion_files) {
    const b = ASSEMBLY_GATE_BANDS.agent_completion_files;
    const floor = filesFloor();
    const mentioned = current.agent_completion_files.mentioned;
    const totalLocked = current.agent_completion_files.total === b.total;
    gates.push({
      name: "agent_completion_files_floor",
      pass: mentioned >= floor && totalLocked,
      baseline: `${b.baseline_mentioned}/${b.total}`,
      current: `${mentioned}/${current.agent_completion_files.total}`,
      detail: lockedTotalDetail({
        floor,
        total: b.total,
        baseline: b.baseline_mentioned,
        tolerance: b.tolerance_cases,
        unit: "files",
      }),
    });
  }

  const failed_gates = gates.filter((g) => !g.pass).map((g) => g.name);
  return { pass: failed_gates.length === 0, failed_gates, gates };
}

export function renderAssemblyVerdict(verdict: AssemblyVerdict): string {
  const lines: string[] = [];
  lines.push(`Assembly Gate Verdict: ${verdict.pass ? "PASS" : "FAIL"}`);
  if (!verdict.pass) {
    lines.push(`Failed gates: ${verdict.failed_gates.join(", ")}`);
  }
  lines.push("");
  lines.push("Gate                                 baseline     current      result   detail");
  lines.push("─".repeat(96));
  for (const g of verdict.gates) {
    lines.push(
      `${g.name.padEnd(36)} ${String(g.baseline).padEnd(12)} ${String(g.current).padEnd(12)} ${(g.pass ? "PASS" : "FAIL").padEnd(8)} ${g.detail}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
