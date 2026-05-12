import type { z } from "zod";
import type { RetrievalResult } from "../retrieve/retrieve.js";
import type {
  CardPackedTrace,
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
  const ranked = [
    ...presentation.relevant.map(projectRankedToWire),
    ...presentation.evidence.map(projectRankedToWire),
  ];
  const omitted = projectOmittedToWire(presentation.omitted);
  const warnings = presentation.warnings
    .filter((w) => WIRE_WARNING_KINDS.has(w.kind))
    .map((w) => ({
      kind: w.kind as PresentedContextPack["warnings"][number]["kind"],
      message: w.message,
      ...(w.hint !== undefined ? { hint: w.hint } : {}),
    }));

  const coverage_confidence = decideCoverageConfidence({
    query_mode: presentation.query_mode,
    has_locked: locked.length > 0,
    ranked_scores: ranked.map((r) => r.score),
    warning_kinds: warnings.map((w) => w.kind),
    safety_net_engaged: presentation.safety_net_engaged,
    top_coverage_decision: result.top_source_coverage?.decision,
  }).coverage_confidence;

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
      used: presentation.budget.used,
      locked_overhead: presentation.budget.locked_overhead,
    },
  };

  if (rendered_text !== undefined) out.rendered_text = rendered_text;
  const sourceCandidates = buildSourceCandidates(presentation);
  const queryAnchors = result.request?.query_anchors ?? {};
  // PRD-0016 P16.7 / THO-165: feed pack readiness the top-family
  // ambiguity diagnostic so packs with a genuine close-call top pair are
  // labeled `partial` instead of pretending the close call is certain.
  const ambiguityPlan =
    result.source_cards && result.source_selection
      ? planTopFamilyAmbiguity({
          cards: result.source_cards,
          top1_top2_margin: result.source_selection.top1_top2_margin,
        })
      : undefined;
  const orchestrator = orchestratePackReadiness({
    task: query,
    query_mode: presentation.query_mode,
    query_intent: result.query_intent,
    files: queryAnchors.files,
    symbols: queryAnchors.symbols,
    routes: queryAnchors.routes,
    sourceCandidates,
    selectedSources: uniqueSources(sourceCandidates),
    mustIncludeSources: [],
    warnings: warnings.map((w) => w.kind),
    coverage_confidence,
    lockedCount: locked.length,
    topFamilyAmbiguous: ambiguityPlan?.is_ambiguous,
  });

  out.recovery_plan = buildRecoveryPlan({
    task: query,
    query_intent: result.query_intent,
    query_mode: presentation.query_mode,
    coverage_confidence,
    pack_readiness: orchestrator.result.state,
    reason_codes: orchestrator.result.reasonCodes,
    missing_needs: orchestrator.result.missingNeeds,
    warnings: warnings.map((w) => w.kind),
    ranked: out.ranked.map((entry) => ({
      contexttrail: entry.contexttrail,
      score: entry.score,
      tokens: entry.tokens,
      kind: entry.kind,
    })),
    files: queryAnchors.files,
    symbols: queryAnchors.symbols,
    routes: queryAnchors.routes,
  });

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
    if (entry.kind !== "doc_chunk") continue;
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
  return {
    id: entry.trace.version_id,
    kind: "chunk",
    scope: entry.chunk.scope,
    tokens: entry.trace.token_count,
    score: entry.trace.final_score,
    body: entry.chunk.body,
    contexttrail: chunkContextTrail(entry.chunk),
    type_bias_applied: false,
  };
}

function projectOmittedToWire(
  entries: PresentedOmittedEntry[],
): PresentedContextPack["omitted"] {
  const wireEntries = entries.map((e) => ({
    id: e.trace.version_id,
    kind: e.kind === "card" ? ("card" as const) : ("chunk" as const),
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
  const scored: (DocChunkPackedTrace | CardPackedTrace | OmittedTrace)[] = [
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
