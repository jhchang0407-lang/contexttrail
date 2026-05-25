import {
  DOCUMENT_WORKFLOW_SPLITS,
  WORK_ARCHETYPES,
  type DocumentWorkflowReport,
} from "./document-workflow-probe.js";

export type DocumentWorkflowBreadthLevel = "exploratory" | "promotion_candidate";

export type DocumentWorkflowBreadthPolicy = {
  minWorkflows: number;
  minTaskVariants: number;
  minFields: number;
  minRequiredSlots: number;
  minEvidenceRequirements: number;
  minSearchedScopeRequirements: number;
  minImportedSources: number;
  minArchetypes: number;
  minSplits: number;
  minComputedFields: number;
  minJudgmentFields: number;
  minReviewFields: number;
};

export type DocumentWorkflowBreadthGate = {
  id: keyof DocumentWorkflowBreadthPolicy;
  label: string;
  current: number;
  minimum: number;
  passed: boolean;
};

export type DocumentWorkflowBreadthAssessment = {
  level: DocumentWorkflowBreadthLevel;
  passed: boolean;
  gates: DocumentWorkflowBreadthGate[];
  failedGates: DocumentWorkflowBreadthGate[];
  read: string;
};

export const DOCUMENT_WORKFLOW_PROMOTION_BREADTH_POLICY: DocumentWorkflowBreadthPolicy = {
  minWorkflows: 40,
  minTaskVariants: 100,
  minFields: 300,
  minRequiredSlots: 120,
  minEvidenceRequirements: 250,
  minSearchedScopeRequirements: 50,
  minImportedSources: 80,
  minArchetypes: WORK_ARCHETYPES.length,
  minSplits: DOCUMENT_WORKFLOW_SPLITS.length,
  minComputedFields: 8,
  minJudgmentFields: 8,
  minReviewFields: 30,
};

function countPresentBuckets<T extends string>(
  buckets: Partial<Record<T, { total: number }>>,
  keys: readonly T[],
): number {
  return keys.filter((key) => (buckets[key]?.total ?? 0) > 0).length;
}

function gate(
  id: keyof DocumentWorkflowBreadthPolicy,
  label: string,
  current: number,
  minimum: number,
): DocumentWorkflowBreadthGate {
  return {
    id,
    label,
    current,
    minimum,
    passed: current >= minimum,
  };
}

export function assessDocumentWorkflowBreadth(
  report: DocumentWorkflowReport,
  policy: DocumentWorkflowBreadthPolicy = DOCUMENT_WORKFLOW_PROMOTION_BREADTH_POLICY,
): DocumentWorkflowBreadthAssessment {
  const fields = report.cases.flatMap((row) => row.fields);
  const computedFields = fields.filter((field) => field.valueKind === "computed").length;
  const judgmentFields = fields.filter((field) => field.valueKind === "judgment").length;
  const reviewFields = fields.filter((field) => field.expectedStatus !== "answerable").length;
  const archetypes = countPresentBuckets(report.summary.byArchetype, WORK_ARCHETYPES);
  const splits = countPresentBuckets(report.summary.bySplit, DOCUMENT_WORKFLOW_SPLITS);
  const gates = [
    gate("minWorkflows", "Workflows", report.summary.workflows, policy.minWorkflows),
    gate("minTaskVariants", "Task variants", report.summary.taskVariants, policy.minTaskVariants),
    gate("minFields", "Fields", report.summary.fields, policy.minFields),
    gate("minRequiredSlots", "Required slots", report.summary.requiredSlots, policy.minRequiredSlots),
    gate(
      "minEvidenceRequirements",
      "Evidence requirements",
      report.summary.sectionRecallTotal,
      policy.minEvidenceRequirements,
    ),
    gate(
      "minSearchedScopeRequirements",
      "Searched-scope requirements",
      report.summary.searchedScopeTotal,
      policy.minSearchedScopeRequirements,
    ),
    gate("minImportedSources", "Imported sources", report.summary.importedSources, policy.minImportedSources),
    gate("minArchetypes", "Work archetypes", archetypes, policy.minArchetypes),
    gate("minSplits", "Dataset splits", splits, policy.minSplits),
    gate("minComputedFields", "Computed fields", computedFields, policy.minComputedFields),
    gate("minJudgmentFields", "Judgment fields", judgmentFields, policy.minJudgmentFields),
    gate("minReviewFields", "Missing/conflict fields", reviewFields, policy.minReviewFields),
  ];
  const failedGates = gates.filter((entry) => !entry.passed);
  const passed = failedGates.length === 0;
  return {
    level: passed ? "promotion_candidate" : "exploratory",
    passed,
    gates,
    failedGates,
    read: passed
      ? "Broad enough to use as a promotion candidate, though still not a proof of real-world generalization."
      : "Useful as a diagnostic lane, but too small or too narrow to justify generalization claims.",
  };
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, index) => Math.max(...rows.map((row) => row[index]!.length)));
  return rows.map((row) => row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ")).join("\n");
}

export function renderDocumentWorkflowBreadthAssessment(
  assessment: DocumentWorkflowBreadthAssessment,
): string {
  const lines = [
    "Breadth confidence",
    "",
    `Level: ${assessment.level}`,
    `Read: ${assessment.read}`,
    "",
    table([
      ["Gate", "Current", "Minimum", "Status"],
      ...assessment.gates.map((entry) => [
        entry.label,
        String(entry.current),
        String(entry.minimum),
        entry.passed ? "pass" : "fail",
      ]),
    ]),
  ];
  return `${lines.join("\n")}\n`;
}
