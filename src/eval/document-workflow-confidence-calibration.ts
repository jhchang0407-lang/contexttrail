#!/usr/bin/env node
/**
 * Adversarial readiness calibration for document-workflow context packs.
 *
 * This is intentionally small and direct: it asks whether the runtime readiness
 * signal behaves like a safety classifier when retrieval is complete, weak,
 * decoy-only, truly absent, or blocked by unavailable source classes.
 */
import { fileURLToPath } from "node:url";
import {
  DOCUMENT_SLOT_READINESS,
  assessDocumentWorkflowPackReadiness,
  assessDocumentWorkflowSlotReadiness,
  type DocumentPackReadiness,
  type DocumentSlotReadiness,
  type DocumentWorkflowSlotReadinessInput,
} from "./document-workflow-readiness.js";

export const DOCUMENT_WORKFLOW_CONFIDENCE_GOLD_STATES = [
  "complete",
  "bad_retrieval",
  "true_absent",
  "weak_absence",
  "source_unavailable",
] as const;
export type DocumentWorkflowConfidenceGoldState =
  (typeof DOCUMENT_WORKFLOW_CONFIDENCE_GOLD_STATES)[number];

export type DocumentWorkflowConfidenceScenario = {
  id: string;
  description: string;
  goldState: DocumentWorkflowConfidenceGoldState;
  expectedSlotReadiness: DocumentSlotReadiness;
  input: DocumentWorkflowSlotReadinessInput;
};

export type DocumentWorkflowConfidenceScenarioResult = {
  id: string;
  description: string;
  goldState: DocumentWorkflowConfidenceGoldState;
  expectedSlotReadiness: DocumentSlotReadiness;
  actualSlotReadiness: DocumentSlotReadiness;
  actualPackReadiness: DocumentPackReadiness;
  pass: boolean;
};

export type DocumentWorkflowConfidenceCalibrationSummary = {
  total: number;
  passed: number;
  unsafeTotal: number;
  falseReadyOnUnsafe: number;
  readyExpectedTotal: number;
  falseRetryOnReady: number;
  badRetrievalTotal: number;
  badRetrievalCaught: number;
  trueAbsenceTotal: number;
  trueAbsenceReady: number;
  weakAbsenceTotal: number;
  weakAbsenceCaught: number;
  sourceUnavailableTotal: number;
  sourceUnavailableBlocked: number;
  byGoldState: Record<DocumentWorkflowConfidenceGoldState, Record<DocumentSlotReadiness, number>>;
};

export type DocumentWorkflowConfidenceCalibrationReport = {
  panelName: string;
  scenarios: DocumentWorkflowConfidenceScenarioResult[];
  summary: DocumentWorkflowConfidenceCalibrationSummary;
};

function baseInput(
  overrides: Partial<DocumentWorkflowSlotReadinessInput>,
): DocumentWorkflowSlotReadinessInput {
  return {
    slotId: "slot",
    required: true,
    taskCritical: true,
    slotKind: "evidence",
    role: "evidence",
    queryCount: 1,
    retrievedSectionCount: 1,
    evidenceTotal: 1,
    evidenceRetrieved: 1,
    searchedScopeTotal: 0,
    searchedScopeRetrieved: 0,
    missingFieldIds: [],
    retryQueries: ["retry this slot"],
    ...overrides,
  };
}

export function buildDefaultDocumentWorkflowConfidenceScenarios(): DocumentWorkflowConfidenceScenario[] {
  return [
    {
      id: "complete_required_evidence",
      description: "Required evidence and searched-scope proof are present.",
      goldState: "complete",
      expectedSlotReadiness: "ready",
      input: baseInput({
        slotId: "invoice_amounts",
        evidenceTotal: 2,
        evidenceRetrieved: 2,
        searchedScopeTotal: 1,
        searchedScopeRetrieved: 1,
        retrievedSectionCount: 2,
      }),
    },
    {
      id: "complete_source_type_evidence",
      description: "Required evidence is present and the expected source type was searched.",
      goldState: "complete",
      expectedSlotReadiness: "ready",
      input: baseInput({
        slotId: "policy_clause",
        expectedSourceTypes: ["policy"],
        availableSourceTypes: ["policy", "claim_summary"],
        searchedSourceTypes: ["policy"],
      }),
    },
    {
      id: "required_evidence_removed",
      description: "A required evidence chunk was not retrieved.",
      goldState: "bad_retrieval",
      expectedSlotReadiness: "retry_required",
      input: baseInput({
        slotId: "damage_cause",
        evidenceTotal: 2,
        evidenceRetrieved: 0,
        searchedScopeTotal: 1,
        searchedScopeRetrieved: 0,
        retrievedSectionCount: 1,
        missingFieldIds: ["cause_confirmation"],
      }),
    },
    {
      id: "right_source_wrong_section",
      description: "The source family looks plausible, but the required section is missing.",
      goldState: "bad_retrieval",
      expectedSlotReadiness: "retry_required",
      input: baseInput({
        slotId: "wrong_section",
        evidenceTotal: 1,
        evidenceRetrieved: 0,
        retrievedSectionCount: 1,
        missingFieldIds: ["required_clause"],
      }),
    },
    {
      id: "decoy_only",
      description: "Only non-authoritative decoy material was retrieved.",
      goldState: "bad_retrieval",
      expectedSlotReadiness: "retry_required",
      input: baseInput({
        slotId: "decoy_only",
        evidenceTotal: 1,
        evidenceRetrieved: 0,
        searchedScopeTotal: 1,
        searchedScopeRetrieved: 0,
        retrievedSectionCount: 1,
        missingFieldIds: ["authoritative_limit"],
      }),
    },
    {
      id: "no_results",
      description: "The slot retrieval returned no sections.",
      goldState: "bad_retrieval",
      expectedSlotReadiness: "retry_required",
      input: baseInput({
        slotId: "empty_retrieval",
        evidenceTotal: 1,
        evidenceRetrieved: 0,
        searchedScopeTotal: 1,
        searchedScopeRetrieved: 0,
        retrievedSectionCount: 0,
        missingFieldIds: ["required_fact"],
      }),
    },
    {
      id: "true_absent_scope_verified",
      description: "The task requires noticing absence, and searched-scope proof is adequate.",
      goldState: "true_absent",
      expectedSlotReadiness: "ready",
      input: baseInput({
        slotId: "approval_gap",
        slotKind: "missing_check",
        role: "missing_context",
        evidenceTotal: 0,
        evidenceRetrieved: 0,
        searchedScopeTotal: 2,
        searchedScopeRetrieved: 2,
        retrievedSectionCount: 2,
      }),
    },
    {
      id: "true_absent_source_type_verified",
      description: "The task requires noticing absence, and all expected source types were searched.",
      goldState: "true_absent",
      expectedSlotReadiness: "ready",
      input: baseInput({
        slotId: "forms_absent",
        slotKind: "missing_check",
        role: "missing_context",
        evidenceTotal: 0,
        evidenceRetrieved: 0,
        retrievedSectionCount: 2,
        expectedSourceTypes: ["employee_record", "signed_forms_packet"],
        availableSourceTypes: ["employee_record", "signed_forms_packet"],
        searchedSourceTypes: ["employee_record", "signed_forms_packet"],
      }),
    },
    {
      id: "weak_absence_no_search_proof",
      description: "The task requires noticing absence, but no adequate search proof exists.",
      goldState: "weak_absence",
      expectedSlotReadiness: "retry_required",
      input: baseInput({
        slotId: "unverified_absence",
        slotKind: "missing_check",
        role: "missing_context",
        evidenceTotal: 0,
        evidenceRetrieved: 0,
        searchedScopeTotal: 0,
        searchedScopeRetrieved: 0,
        retrievedSectionCount: 1,
      }),
    },
    {
      id: "weak_absence_partial_source_type",
      description: "The task requires noticing absence, but only one expected source type was searched.",
      goldState: "weak_absence",
      expectedSlotReadiness: "retry_required",
      input: baseInput({
        slotId: "partial_forms_search",
        slotKind: "missing_check",
        role: "missing_context",
        evidenceTotal: 0,
        evidenceRetrieved: 0,
        retrievedSectionCount: 1,
        expectedSourceTypes: ["employee_record", "signed_forms_packet"],
        availableSourceTypes: ["employee_record", "signed_forms_packet"],
        searchedSourceTypes: ["employee_record"],
      }),
    },
    {
      id: "source_type_unavailable",
      description: "The required source class is not present in the corpus.",
      goldState: "source_unavailable",
      expectedSlotReadiness: "blocked",
      input: baseInput({
        slotId: "missing_inspection_report",
        evidenceTotal: 1,
        evidenceRetrieved: 0,
        retrievedSectionCount: 0,
        expectedSourceTypes: ["inspection_report"],
        availableSourceTypes: ["claim_summary", "adjuster_notes"],
        searchedSourceTypes: [],
        missingFieldIds: ["inspection_findings"],
      }),
    },
  ];
}

export function evaluateDocumentWorkflowConfidenceScenarios(
  scenarios: DocumentWorkflowConfidenceScenario[],
): DocumentWorkflowConfidenceCalibrationReport {
  const results = scenarios.map((scenario) => {
    const slot = assessDocumentWorkflowSlotReadiness(scenario.input);
    const pack = assessDocumentWorkflowPackReadiness([{
      slotId: slot.slotId,
      required: slot.required,
      taskCritical: slot.taskCritical,
      slotReadiness: slot.slotReadiness,
      recoveryAction: slot.recoveryAction,
      missingContextFinding: slot.missingContextFinding,
    }]);
    return {
      id: scenario.id,
      description: scenario.description,
      goldState: scenario.goldState,
      expectedSlotReadiness: scenario.expectedSlotReadiness,
      actualSlotReadiness: slot.slotReadiness,
      actualPackReadiness: pack.packReadiness,
      pass: slot.slotReadiness === scenario.expectedSlotReadiness,
    };
  });
  return {
    panelName: "document_workflow_confidence_calibration",
    scenarios: results,
    summary: summarize(results),
  };
}

function summarize(
  scenarios: DocumentWorkflowConfidenceScenarioResult[],
): DocumentWorkflowConfidenceCalibrationSummary {
  const byGoldState = Object.fromEntries(
    DOCUMENT_WORKFLOW_CONFIDENCE_GOLD_STATES.map((state) => [
      state,
      Object.fromEntries(DOCUMENT_SLOT_READINESS.map((readiness) => [readiness, 0])),
    ]),
  ) as Record<DocumentWorkflowConfidenceGoldState, Record<DocumentSlotReadiness, number>>;
  for (const scenario of scenarios) {
    byGoldState[scenario.goldState][scenario.actualSlotReadiness] += 1;
  }

  const unsafe = scenarios.filter((scenario) =>
    scenario.goldState === "bad_retrieval" ||
    scenario.goldState === "weak_absence" ||
    scenario.goldState === "source_unavailable"
  );
  const readyExpected = scenarios.filter((scenario) => scenario.expectedSlotReadiness === "ready");
  const badRetrieval = scenarios.filter((scenario) => scenario.goldState === "bad_retrieval");
  const trueAbsence = scenarios.filter((scenario) => scenario.goldState === "true_absent");
  const weakAbsence = scenarios.filter((scenario) => scenario.goldState === "weak_absence");
  const sourceUnavailable = scenarios.filter((scenario) => scenario.goldState === "source_unavailable");

  return {
    total: scenarios.length,
    passed: scenarios.filter((scenario) => scenario.pass).length,
    unsafeTotal: unsafe.length,
    falseReadyOnUnsafe: unsafe.filter((scenario) => scenario.actualSlotReadiness === "ready").length,
    readyExpectedTotal: readyExpected.length,
    falseRetryOnReady: readyExpected.filter((scenario) =>
      scenario.actualSlotReadiness === "retry_required" || scenario.actualSlotReadiness === "blocked"
    ).length,
    badRetrievalTotal: badRetrieval.length,
    badRetrievalCaught: badRetrieval.filter((scenario) => scenario.actualSlotReadiness === "retry_required").length,
    trueAbsenceTotal: trueAbsence.length,
    trueAbsenceReady: trueAbsence.filter((scenario) => scenario.actualSlotReadiness === "ready").length,
    weakAbsenceTotal: weakAbsence.length,
    weakAbsenceCaught: weakAbsence.filter((scenario) => scenario.actualSlotReadiness === "retry_required").length,
    sourceUnavailableTotal: sourceUnavailable.length,
    sourceUnavailableBlocked: sourceUnavailable.filter((scenario) => scenario.actualSlotReadiness === "blocked").length,
    byGoldState,
  };
}

function pct(numerator: number, denominator: number): string {
  return denominator === 0 ? "not scored" : `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, index) => Math.max(...rows.map((row) => row[index]!.length)));
  return rows.map((row) => row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ")).join("\n");
}

export function renderDocumentWorkflowConfidenceCalibration(
  report: DocumentWorkflowConfidenceCalibrationReport,
): string {
  const s = report.summary;
  const lines: string[] = [];
  lines.push("Document workflow confidence calibration");
  lines.push("");
  lines.push(table([
    ["Signal", "Result"],
    [
      "Dangerous false-ready on unsafe retrieval",
      `${s.falseReadyOnUnsafe}/${s.unsafeTotal} (${pct(s.falseReadyOnUnsafe, s.unsafeTotal)})`,
    ],
    [
      "False retry on ready packs",
      `${s.falseRetryOnReady}/${s.readyExpectedTotal} (${pct(s.falseRetryOnReady, s.readyExpectedTotal)})`,
    ],
    [
      "Bad retrieval caught",
      `${s.badRetrievalCaught}/${s.badRetrievalTotal} (${pct(s.badRetrievalCaught, s.badRetrievalTotal)})`,
    ],
    [
      "True absence accepted",
      `${s.trueAbsenceReady}/${s.trueAbsenceTotal} (${pct(s.trueAbsenceReady, s.trueAbsenceTotal)})`,
    ],
    [
      "Weak absence caught",
      `${s.weakAbsenceCaught}/${s.weakAbsenceTotal} (${pct(s.weakAbsenceCaught, s.weakAbsenceTotal)})`,
    ],
    [
      "Source unavailable blocked",
      `${s.sourceUnavailableBlocked}/${s.sourceUnavailableTotal} (${pct(s.sourceUnavailableBlocked, s.sourceUnavailableTotal)})`,
    ],
  ]));
  lines.push("");
  lines.push("Readiness by gold state");
  lines.push(table([
    ["Gold state", ...DOCUMENT_SLOT_READINESS],
    ...DOCUMENT_WORKFLOW_CONFIDENCE_GOLD_STATES.map((state) => [
      state,
      ...DOCUMENT_SLOT_READINESS.map((readiness) => String(s.byGoldState[state][readiness])),
    ]),
  ]));
  lines.push("");
  lines.push("Scenario failures");
  const failures = report.scenarios.filter((scenario) => !scenario.pass);
  if (failures.length === 0) {
    lines.push("none");
  } else {
    for (const failure of failures) {
      lines.push(
        `- ${failure.id}: expected ${failure.expectedSlotReadiness}, got ${failure.actualSlotReadiness}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const report = evaluateDocumentWorkflowConfidenceScenarios(
    buildDefaultDocumentWorkflowConfidenceScenarios(),
  );
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(renderDocumentWorkflowConfidenceCalibration(report));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
