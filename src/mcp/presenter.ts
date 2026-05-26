import type { z } from "zod";
import type { RetrievalResult } from "../retrieve/retrieve.js";
import type {
  CardPackedTrace,
  CodePackedTrace,
  DocChunkPackedTrace,
  OmittedTrace,
} from "../retrieve/pack.js";
import type { Card } from "../types/card.js";
import { chunkContextTrail } from "../retrieve/contexttrail.js";
import { buildRetrievalView } from "../retrieve/view.js";
import {
  WIRE_WARNING_KINDS,
  type PackPresentation,
  type PresentedLockedEntry,
  type PresentedOmittedEntry,
  type PresentedRankedEntry,
} from "../retrieve/presentation.js";
import { schemas } from "./schemas.js";
import { renderTextFromView } from "../retrieve/render.js";
import { decideCoverageConfidence } from "../retrieve/confidence-policy.js";
import { orchestratePackReadiness } from "../readiness/orchestrator.js";
import type { SourceChunkCandidate } from "../readiness/chunk-selector.js";
import { planTopFamilyAmbiguity } from "../retrieve/ambiguity-planner.js";
import { buildRecoveryPlan } from "../readiness/recovery-plan.js";
import { codeContextTrail } from "../retrieve/contexttrail.js";
import { buildRuntimeTaskReadiness } from "../readiness/runtime-task-readiness.js";

export type PresentedContextPack = z.infer<(typeof schemas)["retrieve_context_pack"]["output"]>;

export type PresentContextPackArgs = {
  query: string;
  result: RetrievalResult;
  requested_budget: number;
  has_sources: boolean;
  explain: boolean;
  include_rendered_text?: boolean;
  min_final_score?: number;
  /** PRD-0015 / THO-156: opt-in readiness-aware reorder. When true, the
   *  presenter lifts the orchestrator's need-driven chunk (intro for
   *  overview tasks, parent for decision-rationale tasks) to the top of
   *  the ranked list. Default false — production retains current top-1
   *  ordering until eval shows clear gains. */
  applyReadinessReorder?: boolean;
};

const OMITTED_TOP_N = 10;
const WIRE_RANKED_LIMIT = 3;

export function presentContextPack(args: PresentContextPackArgs): PresentedContextPack {
  const { include_rendered_text } = args;
  const view = buildRetrievalView({
    query: args.query,
    result: args.result,
    requested_budget: args.requested_budget,
    has_sources: args.has_sources,
    explain: args.explain,
    min_final_score: args.min_final_score,
  });
  const { query, result, explain } = args;
  const presentation = view.presentation;

  const rendered_text = include_rendered_text
    ? renderTextFromView(view)
    : undefined;

  const locked = presentation.locked.map(projectLockedToWire);
  const rankedAll = [
    ...presentation.relevant.map(projectRankedToWire),
    ...presentation.evidence.map(projectRankedToWire),
  ];
  const ranked = rankedAll.slice(0, WIRE_RANKED_LIMIT);
  const omitted = projectOmittedToWire(presentation.omitted);
  const warnings = presentation.warnings
    .filter((w) => WIRE_WARNING_KINDS.has(w.kind))
    .map((w) => ({
      kind: w.kind as PresentedContextPack["warnings"][number]["kind"],
      message: w.message,
      ...(w.hint !== undefined ? { hint: w.hint } : {}),
    }));

  // PRD-0016 P16.7 / THO-165: a genuinely ambiguous top family should not
  // remain `confident` even when the raw top score is high. The pack can
  // still be useful, but the answer should travel with caveats rather than
  // pretending the top family close-call is resolved.
  const ambiguityPlan =
    result.source_cards && result.source_selection
      ? planTopFamilyAmbiguity({
          cards: result.source_cards,
          top1_top2_margin: result.source_selection.top1_top2_margin,
        })
      : undefined;
  let coverage_confidence = decideCoverageConfidence({
    query_mode: presentation.query_mode,
    has_locked: locked.length > 0,
    ranked_scores: ranked.map((r) => r.score),
    warning_kinds: warnings.map((w) => w.kind),
    safety_net_engaged: presentation.safety_net_engaged,
    top_coverage_decision: result.top_source_coverage?.decision,
    code_lane: presentation.budget.code_lane,
  }).coverage_confidence;
  if (ambiguityPlan?.is_ambiguous && coverage_confidence === "confident") {
    coverage_confidence = "uncertain";
  }

  const sourceCandidates = buildSourceCandidates(presentation);
  const queryAnchors = result.request?.query_anchors ?? {};
  const orchestrator = orchestratePackReadiness({
    task: query,
    query_mode: presentation.query_mode,
    query_intent: result.query_intent,
    files: queryAnchors.files,
    symbols: queryAnchors.symbols,
    routes: queryAnchors.routes,
    sourceCandidates,
    selectedSources: uniqueSources(sourceCandidates),
    codeSelectedSources: uniqueCodeSources(presentation),
    mustIncludeSources: [],
    warnings: warnings.map((w) => w.kind),
    coverage_confidence,
    lockedCount: locked.length,
    codeLaneTriggered: presentation.budget.code_lane?.triggered ?? false,
    topFamilyAmbiguous: ambiguityPlan?.is_ambiguous,
  });

  const baseRecoveryPlan = buildRecoveryPlan({
    task: query,
    query_intent: result.query_intent,
    query_mode: presentation.query_mode,
    coverage_confidence,
    pack_readiness: orchestrator.result.state,
    reason_codes: orchestrator.result.reasonCodes,
    missing_needs: orchestrator.result.missingNeeds,
    warnings: warnings.map((w) => w.kind),
    ranked: ranked.map((entry) => ({
      contexttrail: entry.contexttrail,
      score: entry.score,
      tokens: entry.tokens,
      kind: entry.kind,
      source_path: entry.source_path,
      symbol_path: entry.symbol_path,
    })),
    files: queryAnchors.files,
    symbols: queryAnchors.symbols,
    routes: queryAnchors.routes,
  });
  const taskReadiness = buildRuntimeTaskReadiness({
    task: query,
    has_sources: args.has_sources,
    coverage_confidence,
    legacy_pack_readiness: orchestrator.result.state,
    legacy_reason_codes: orchestrator.result.reasonCodes,
    missing_needs: orchestrator.result.missingNeeds,
    satisfied_needs: orchestrator.result.satisfiedNeeds,
    warnings: warnings.map((w) => w.kind),
    ranked_count: ranked.length,
    locked_count: locked.length,
    recovery_plan: baseRecoveryPlan,
  });
  const recoveryPlan = alignRecoveryPlanWithTaskReadiness(baseRecoveryPlan, taskReadiness);

  const out: PresentedContextPack = {
    query_mode: presentation.query_mode,
    coverage_confidence,
    assembly_stage_reached: result.assembly?.stage_reached ?? "not_applicable",
    locked,
    ranked,
    omitted,
    warnings,
    budget: {
      requested: view.budget.requested,
      used: visibleTokenCount(locked, ranked),
      locked_overhead: presentation.budget.locked_overhead,
      ...(presentation.budget.code_lane !== undefined
        ? { code_lane: presentation.budget.code_lane }
        : {}),
    },
    task_readiness: taskReadiness,
    recovery_plan: recoveryPlan,
  };

  if (rendered_text !== undefined) out.rendered_text = rendered_text;

  if (args.applyReadinessReorder === true) {
    out.ranked = reorderRankedByReadiness(out.ranked, orchestrator);
  }
  if (explain) {
    out.explain = {
      per_chunk: buildExplain(result.pack),
      query_compilation: presentation.query_compilation,
      lock_failures: presentation.lock_failures,
      assembly:
        result.assembly?.root_version_id !== undefined || result.assembly?.selected_neighbors.length
          ? {
              root_version_id: result.assembly.root_version_id,
              selected_neighbors: result.assembly.selected_neighbors,
              early_stop_reason: result.assembly.early_stop_reason,
            }
          : undefined,
      pack_readiness: {
        state: orchestrator.result.state,
        needs: orchestrator.needs,
        satisfied_needs: orchestrator.result.satisfiedNeeds,
        missing_needs: orchestrator.result.missingNeeds,
        reason_codes: orchestrator.result.reasonCodes,
      },
    };
  }
  return out;
}

function visibleTokenCount(
  locked: PresentedContextPack["locked"],
  ranked: PresentedContextPack["ranked"],
): number {
  return (
    locked.reduce((sum, entry) => sum + entry.tokens, 0) +
    ranked.reduce((sum, entry) => sum + entry.tokens, 0)
  );
}

function alignRecoveryPlanWithTaskReadiness(
  recoveryPlan: NonNullable<PresentedContextPack["recovery_plan"]>,
  taskReadiness: PresentedContextPack["task_readiness"],
): NonNullable<PresentedContextPack["recovery_plan"]> {
  if (taskReadiness.recovery_action === "answer") {
    return {
      ...recoveryPlan,
      action: "answer",
      hint: "The context pack is ready to use.",
    };
  }
  if (taskReadiness.recovery_action === "answer_with_caveat") {
    return {
      ...recoveryPlan,
      action: "answer_with_caveat",
      hint: "Answer from the ranked context and call out the partial slot.",
    };
  }
  if (taskReadiness.recovery_action === "ask_user") {
    return {
      ...recoveryPlan,
      action: "ask_for_anchors",
      hint: "Ask the user for the missing source, import, or anchor before answering.",
    };
  }
  if (taskReadiness.recovery_action === "abstain") {
    return {
      ...recoveryPlan,
      action: "abstain",
      hint: "Do not answer from this context pack.",
    };
  }
  return {
    ...recoveryPlan,
    action: "retry_with_followup_searches",
    hint: "Task readiness found a required context slot that is not ready; retry with the generated follow-up searches before answering.",
  };
}

/**
 * THO-156: lift a need-driven chunk to the top of the ranked list.
 *
 *   - overview_orientation in needs → lift the chunk reasoned as "intro"
 *   - decision_rationale  in needs → lift the chunk reasoned as "parent"
 *
 * Operates by chunk id, so it stays a deterministic data-flow reorder
 * with no re-scoring; falls through to a no-op for tasks where the
 * orchestrator did not produce a lift candidate.
 */
function reorderRankedByReadiness(
  ranked: PresentedContextPack["ranked"],
  orchestrator: { needs: ReturnType<typeof orchestratePackReadiness>["needs"]; selections: ReturnType<typeof orchestratePackReadiness>["selections"] },
): PresentedContextPack["ranked"] {
  const liftReason = orchestrator.needs.includes("overview_orientation")
    ? "intro"
    : orchestrator.needs.includes("decision_rationale")
    ? "parent"
    : undefined;
  if (liftReason === undefined) return ranked;
  const liftSel = orchestrator.selections.find((s) => s.reason === liftReason);
  if (liftSel === undefined) return ranked;
  const liftIdx = ranked.findIndex((r) => r.id === liftSel.chunkId);
  if (liftIdx <= 0) return ranked;
  const lifted = ranked[liftIdx]!;
  return [lifted, ...ranked.slice(0, liftIdx), ...ranked.slice(liftIdx + 1)];
}

function buildSourceCandidates(presentation: PackPresentation): SourceChunkCandidate[] {
  const out: SourceChunkCandidate[] = [];
  for (const entry of [...presentation.relevant, ...presentation.evidence]) {
    if (entry.kind === "doc_chunk") {
      out.push({
        id: entry.trace.version_id,
        source_path: entry.chunk.source_path,
        heading_path: entry.chunk.heading_path,
        heading_level: Math.max(1, entry.chunk.heading_path.length),
        chunk_index: entry.chunk.chunk_index,
        chunk_count: entry.chunk.chunk_count,
        score: entry.trace.final_score,
        tokens: entry.trace.token_count,
      });
      continue;
    }
    if (entry.kind === "code") {
      out.push({
        id: entry.trace.version_id,
        source_path: entry.code.source_path,
        heading_path: [entry.code.symbol_path ?? entry.code.source_path],
        heading_level: 1,
        chunk_index: 1,
        chunk_count: 1,
        score: entry.trace.final_score,
        tokens: entry.trace.token_count,
      });
    }
  }
  return out;
}

function uniqueSources(candidates: SourceChunkCandidate[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    if (seen.has(c.source_path)) continue;
    seen.add(c.source_path);
    out.push(c.source_path);
  }
  return out;
}

function uniqueCodeSources(
  presentation: PackPresentation,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of [...presentation.relevant, ...presentation.evidence]) {
    if (entry.kind !== "code") continue;
    if (seen.has(entry.code.source_path)) continue;
    seen.add(entry.code.source_path);
    out.push(entry.code.source_path);
  }
  return out;
}

function projectLockedToWire(
  entry: PresentedLockedEntry,
): PresentedContextPack["locked"][number] {
  const out: PresentedContextPack["locked"][number] = {
    id: entry.card.id,
    kind: "card",
    card_type: entry.card.type,
    scope: entry.card.scope,
    tokens: entry.entry.token_count,
    body: entry.card.body,
    contexttrail: cardContextTrail(entry.card),
    lock_reason: entry.reason.kind,
    broad_scope: entry.reason.broad_scope ?? false,
    freshness_state: entry.freshness.state,
    freshness_warnings: entry.freshness.isWarning
      ? [`${entry.freshness.state} (${entry.freshness.reason})`]
      : [],
  };
  if (entry.reason.derived_from && entry.reason.derived_from.length > 0) {
    return { ...out, derived_from: entry.reason.derived_from };
  }
  return out;
}

function projectRankedToWire(
  entry: PresentedRankedEntry,
): PresentedContextPack["ranked"][number] {
  if (entry.kind === "card") {
    return {
      id: entry.trace.version_id,
      kind: "card",
      scope: entry.card.scope,
      tokens: entry.trace.token_count,
      score: entry.trace.final_score,
      body: entry.card.body,
      contexttrail: cardContextTrail(entry.card),
      type_bias_applied: true,
    };
  }
  if (entry.kind === "code") {
    return {
      id: entry.trace.version_id,
      kind: "code",
      scope: {},
      tokens: entry.trace.token_count,
      score: entry.trace.final_score,
      body: entry.code.body,
      contexttrail: codeContextTrail(entry.code, {
        import_traversed: entry.trace.import_traversed,
        support_cluster: entry.trace.support_cluster,
      }),
      type_bias_applied: false,
      source_path: entry.code.source_path,
      start_line: entry.code.start_line,
      end_line: entry.code.end_line,
      symbol_path: entry.code.symbol_path,
      code_role: entry.code.code_role,
      declaration_kind: entry.code.declaration_kind,
      support_cluster: entry.trace.support_cluster,
      retrieval_confidence: entry.trace.retrieval_confidence,
    };
  }
  return {
    id: entry.trace.version_id,
    kind: "chunk",
    scope: entry.chunk.scope,
    tokens: entry.trace.token_count,
    score: entry.trace.final_score,
    body: entry.chunk.body,
    contexttrail: chunkContextTrail(entry.chunk),
    type_bias_applied: false,
    source_path: entry.chunk.source_path,
    start_line: entry.chunk.start_line,
    end_line: entry.chunk.end_line,
  };
}

function projectOmittedToWire(
  entries: PresentedOmittedEntry[],
): PresentedContextPack["omitted"] {
  const wireEntries = entries.map((e) => ({
    id: e.trace.version_id,
    kind:
      e.kind === "card"
        ? ("card" as const)
        : e.kind === "code"
          ? ("code" as const)
          : ("chunk" as const),
    reason: e.trace.omitted_reason,
    score: e.trace.final_score,
  }));
  const by_reason: Record<string, number> = {};
  for (const e of wireEntries) {
    by_reason[e.reason] = (by_reason[e.reason] ?? 0) + 1;
  }
  const top = [...wireEntries].sort((a, b) => b.score - a.score).slice(0, OMITTED_TOP_N);
  return {
    total: wireEntries.length,
    by_reason,
    top,
    truncated: top.length < wireEntries.length,
  };
}

function cardContextTrail(card: Card): string {
  return `Card: ${card.id} (${card.type}) — ${card.title}`;
}

function buildExplain(
  pack: RetrievalResult["pack"],
): PresentedContextPack["explain"] extends infer E ? (E extends { per_chunk: infer P } ? P : never) : never {
  // Locked entries bypass scoring (D37/ADR-0010), so they have no meaningful
  // per-chunk explain row. The lock decision is surfaced via `locked[]` and
  // `lock_failures[]` instead.
  const scored: (DocChunkPackedTrace | CardPackedTrace | CodePackedTrace | OmittedTrace)[] = [
    ...pack.included,
    ...pack.omitted,
  ];
  return scored.map((t) => ({
    id: t.version_id,
    bm25_norm: t.bm25_norm,
    heading_match: t.heading_match,
    scope_match: t.scope_match,
    mention_overlap: t.mention_overlap,
    specificity: t.specificity,
    text_score: t.text_score,
    final_score: t.final_score,
    packing_score: t.packing_score,
    structural_multiplier: t.structural_multiplier,
    doc_role: t.doc_role,
    role_source: t.role_source,
    role_multiplier: t.role_multiplier,
    included: pack.included.includes(t as never),
    reason:
      "reason" in t && typeof t.reason === "string" ? t.reason : "above_threshold",
  }));
}

export type { PackPresentation };
