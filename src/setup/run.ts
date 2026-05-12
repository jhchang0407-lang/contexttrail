/**
 * PRD-0033 / THO-251 — orchestrator that ties scan + probes + next-step
 * together. The CLI and MCP tool both call this; renderers do nothing
 * beyond formatting its output.
 */
import { listInboxItems } from "../inbox/items.js";
import { runProbes, type ProbeRetriever } from "./probes.js";
import {
  scanSetupReadiness,
  type SetupReadinessReport,
} from "./readiness-scan.js";
import {
  suggestNextStep,
  type NextStepSuggestion,
} from "./next-step.js";

export type SetupReadinessRunResult = {
  report: SetupReadinessReport;
  suggestion: NextStepSuggestion;
  pending_inbox_items: number;
};

export async function runSetupReadiness(
  cwd: string,
  retriever: ProbeRetriever,
): Promise<SetupReadinessRunResult> {
  const probes = await runProbes(retriever);
  const pendingInboxItems = countPendingInboxItems(cwd);
  const report = scanSetupReadiness(cwd, { probeResults: probes });
  const importedChunks =
    (report.dimensions.corpus_coverage.evidence.imported_chunks as
      | number
      | undefined) ?? 0;
  const suggestion = suggestNextStep({
    corpus_coverage: report.dimensions.corpus_coverage.score,
    scope_coverage: report.dimensions.scope_coverage.score,
    card_coverage: report.dimensions.card_coverage.score,
    retrieval_probes: report.dimensions.retrieval_probes.score,
    has_pending_inbox_items: pendingInboxItems > 0,
    imported_chunks: importedChunks,
  });
  return { report, suggestion, pending_inbox_items: pendingInboxItems };
}

function countPendingInboxItems(cwd: string): number {
  try {
    return listInboxItems(cwd).filter((i) => i.status === "pending").length;
  } catch {
    return 0;
  }
}
