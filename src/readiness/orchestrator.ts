/**
 * Readiness-aware assembly orchestrator (PRD-0015 Slice 5).
 *
 * Single integration seam that ties together:
 *
 *   1. extractTaskNeeds         — produces named context needs
 *   2. selectSourceScopedChunks — picks chunks inside the top source
 *   3. verifyPackReadiness      — labels the pack ready/partial/...
 *
 * This is the "readiness-aware assembly orchestrator" deep module from
 * PRD-0015. The MCP presenter and the real-corpus eval call this so
 * that explain and eval surfaces report a single, consistent readiness
 * picture rather than diverging diagnostics.
 *
 * The orchestrator accepts retrieval-side primitives (not a
 * `RetrievalResult`), so it stays testable in isolation and does not
 * couple readiness to presentation internals.
 */
import {
  selectSourceScopedChunks,
  type ChunkOmission,
  type ChunkSelection,
  type SourceChunkCandidate,
} from "./chunk-selector.js";
import {
  verifyPackReadiness,
  type PackReadinessResult,
} from "./pack-verifier.js";
import { extractTaskNeeds, type TaskNeed } from "./task-need.js";
import type { QueryIntent } from "../types/query.js";

export type ReadinessOrchestratorInput = {
  task: string;
  query_mode: "anchored" | "unanchored" | "signal_empty";
  query_intent?: QueryIntent;
  files?: string[];
  symbols?: string[];
  routes?: string[];
  /** Source-local chunk candidates across all selected sources. The
   *  orchestrator selects the top source by primary score and runs the
   *  source-scoped chunk selector on that source. */
  sourceCandidates: SourceChunkCandidate[];
  selectedSources: string[];
  mustIncludeSources: string[];
  warnings: string[];
  coverage_confidence: "confident" | "uncertain" | "empty";
  lockedCount: number;
  budgetTokens?: number;
  /** PRD-0016 P16.7 / THO-165: optional ambiguity diagnostic from the
   *  top-family planner. Forwarded to the readiness verifier. */
  topFamilyAmbiguous?: boolean;
};

export type ReadinessOrchestratorOutput = {
  needs: TaskNeed[];
  selections: ChunkSelection[];
  omitted: ChunkOmission[];
  result: PackReadinessResult;
};

export function orchestratePackReadiness(
  input: ReadinessOrchestratorInput,
): ReadinessOrchestratorOutput {
  const needs = extractTaskNeeds({
    task: input.task,
    query_mode: input.query_mode,
    query_intent: input.query_intent,
    symbols: input.symbols,
    files: input.files,
    routes: input.routes,
  });

  const topSource = pickTopSource(input.sourceCandidates, input.selectedSources);
  const { selections, omitted } = topSource
    ? selectSourceScopedChunks({
        sourcePath: topSource,
        candidates: input.sourceCandidates,
        needs,
        budgetTokens: input.budgetTokens,
      })
    : { selections: [], omitted: [] };

  const result = verifyPackReadiness({
    needs,
    selections,
    selectedSources: input.selectedSources,
    mustIncludeSources: input.mustIncludeSources,
    warnings: input.warnings,
    coverage_confidence: input.coverage_confidence,
    lockedCount: input.lockedCount,
    topFamilyAmbiguous: input.topFamilyAmbiguous,
  });

  return { needs, selections, omitted, result };
}

function pickTopSource(
  candidates: SourceChunkCandidate[],
  selectedSources: string[],
): string | undefined {
  if (selectedSources.length > 0) return selectedSources[0];
  if (candidates.length === 0) return undefined;
  let best = candidates[0]!;
  for (const c of candidates) if (c.score > best.score) best = c;
  return best.source_path;
}
