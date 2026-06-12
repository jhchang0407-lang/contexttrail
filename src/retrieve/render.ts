import type { DocChunk } from "../types/chunk.js";
import type { Card } from "../types/card.js";
import type { LockFailure, LockReason } from "../cards/locked-include.js";
import type { RetrievalView } from "./view.js";
import type {
  CardPackedTrace,
  DocChunkPackedTrace,
  OmittedTrace,
  PackResult,
  PackWarning,
} from "./pack.js";
import type { ScoreTrace } from "./score.js";
import type { QueryCompilation, QueryMode } from "./query-scope.js";
import { chunkContextTrail } from "./contexttrail.js";
import {
  orderIncludedForRender as orderIncludedForRenderImpl,
  resolvePackPresentation,
  type FreshnessSummary,
  type PackPresentation,
  type PresentedRankedEntry,
} from "./presentation.js";

export const orderIncludedForRender = orderIncludedForRenderImpl;

export type RenderArgs = {
  query: string;
  result: PackResult;
  chunksByVersionId: Map<string, DocChunk>;
  cardsByCardId?: Map<string, Card>;
  query_mode?: QueryMode;
  query_compilation?: QueryCompilation;
  lock_failures?: LockFailure[];
  has_sources?: boolean;
  /** When true, include the per-chunk explain trace in the text output. */
  explain?: boolean;
};

/**
 * Inline freshness label used by the markdown projection.
 * Combines author_review_state with materialized freshness state.
 */
function freshnessLabel(summary: FreshnessSummary): string {
  const f = summary.state;
  const a = summary.author_review_state;
  if (f === "verified" && a === "unreviewed") return "verified";
  if (f === "verified" && a === "verified") return "verified*";
  if (f === "needs_review") return `needs_review (${summary.reason})`;
  if (a === "needs_review_manual") return "needs_review_manual";
  return f;
}

function presentationFromArgs(args: RenderArgs): PackPresentation {
  return resolvePackPresentation({
    query: args.query,
    pack: args.result,
    chunksByVersionId: args.chunksByVersionId,
    cardsByCardId: args.cardsByCardId ?? new Map(),
    query_mode: args.query_mode ?? "unanchored",
    query_compilation: args.query_compilation ?? {
      query_mode: args.query_mode ?? "unanchored",
      provided_anchor_count: 0,
      recognized_anchor_count: 0,
      anchors: [],
    },
    lock_failures: args.lock_failures ?? [],
    has_sources: args.has_sources ?? args.chunksByVersionId.size > 0,
  });
}

/**
 * Pack render order is driven by section labels (D42), not by score arithmetic:
 *   Locked rules → Symbol notes (locked) → Relevant docs → Evidence → Warnings → Omitted
 */
export function renderText(args: RenderArgs): string {
  const { explain } = args;
  const presentation = presentationFromArgs(args);
  return renderTextFromPresentation({
    query: args.query,
    presentation,
    explain,
  });
}

export function renderTextFromView(view: RetrievalView): string {
  return renderTextFromPresentation({
    query: view.query,
    presentation: view.presentation,
    explain: view.explain,
  });
}

function renderTextFromPresentation(args: {
  query: string;
  presentation: PackPresentation;
  explain?: boolean;
}): string {
  const { explain } = args;
  const presentation = args.presentation;
  const lines: string[] = [];

  lines.push(
    `# Context Pack — ${presentation.budget.used}/${presentation.budget.requested} tokens` +
      (presentation.budget.locked_overhead > 0
        ? ` (locked_overhead=${presentation.budget.locked_overhead})`
        : ""),
  );
  lines.push("");

  const lockedConstraints = presentation.locked.filter((e) => e.card.type === "constraint");
  const lockedSymbolNotes = presentation.locked.filter((e) => e.card.type === "symbol_note");
  const lockedEvidence = presentation.locked.filter((e) => e.card.type === "evidence");

  if (lockedConstraints.length > 0) {
    lines.push("## Locked rules");
    lines.push("");
    for (const e of lockedConstraints) {
      const broad = e.reason.broad_scope ? " (broad_scope)" : "";
      const path = e.reason.scope_match_path ? ` — ${e.reason.scope_match_path}` : "";
      lines.push(`### ${e.card.id}: ${e.card.title}${broad}`);
      lines.push(`_freshness: ${freshnessLabel(e.freshness)}${path}_`);
      lines.push("");
      lines.push(e.card.body);
      lines.push("");
    }
  }

  if (lockedSymbolNotes.length > 0) {
    lines.push("## Symbol notes (locked)");
    lines.push("");
    for (const e of lockedSymbolNotes) {
      const sym = e.reason.matched_symbol ? ` — ${e.reason.matched_symbol}` : "";
      lines.push(`### ${e.card.id}: ${e.card.title}${sym}`);
      lines.push(`_freshness: ${freshnessLabel(e.freshness)}_`);
      lines.push("");
      lines.push(e.card.body);
      lines.push("");
    }
  }

  if (lockedEvidence.length > 0) {
    lines.push("## Evidence (locked)");
    lines.push("");
    for (const e of lockedEvidence) {
      const derived = e.reason.derived_from?.length
        ? ` — covers ${e.reason.derived_from.join(", ")}`
        : "";
      const cmd = e.card.type === "evidence" ? ` — \`${e.card.command}\`` : "";
      lines.push(`### ${e.card.id}: ${e.card.title}${cmd}${derived}`);
      lines.push(`_freshness: ${freshnessLabel(e.freshness)}_`);
      lines.push("");
      lines.push(e.card.body);
      lines.push("");
    }
  }

  if (presentation.relevant.length > 0) {
    lines.push("## Relevant docs");
    lines.push("");
    for (const r of presentation.relevant) {
      if (r.kind === "card") {
        lines.push(`### ${r.card.id}: ${r.card.title} (${r.card.type})`);
        lines.push(`_freshness: ${freshnessLabel(r.freshness)}_`);
        if (explain) lines.push(formatTrace(r.trace));
        lines.push("");
        lines.push(r.card.body);
        lines.push("");
        continue;
      }
      lines.push(`### ${chunkContextTrail(r.chunk)}`);
      if (explain) lines.push(formatTrace(r.trace));
      lines.push("");
      lines.push(r.chunk.body);
      lines.push("");
    }
  }

  if (presentation.evidence.length > 0) {
    lines.push("## Evidence");
    lines.push("");
    for (const r of presentation.evidence) {
      const cmd = r.card.type === "evidence" ? ` — \`${r.card.command}\`` : "";
      lines.push(`### ${r.card.id}: ${r.card.title}${cmd}`);
      if (explain) lines.push(formatTrace(r.trace));
      lines.push("");
      lines.push(r.card.body);
      lines.push("");
    }
  }

  // Warnings: pack-level (no_matches, locked_overflow) + freshness on locked
  // cards that are needs_review. The freshness lines are markdown-specific
  // surface — wire callers consume `freshness_warnings` per-locked entry.
  const freshnessWarningLines: string[] = [];
  for (const e of presentation.locked) {
    if (e.freshness.state === "needs_review") {
      freshnessWarningLines.push(
        `- [freshness] ${e.card.id} is needs_review (${e.freshness.reason}); still locked-include`,
      );
    }
  }
  const allWarningLines = [
    ...presentation.warnings.map((w) => `- [${w.kind}] ${w.message}`),
    ...freshnessWarningLines,
  ];
  if (allWarningLines.length > 0) {
    lines.push("## Warnings");
    lines.push("");
    lines.push(...allWarningLines);
    lines.push("");
  }

  if (presentation.omitted.length > 0) {
    lines.push("## Omitted");
    lines.push("");
    if (!explain) {
      const counts = countOmittedReasons(presentation.omitted);
      const summary = Object.entries(counts)
        .map(([reason, count]) => `${reason}=${count}`)
        .join(", ");
      lines.push(
        `${presentation.omitted.length} candidates omitted (${summary}). Run with --explain to inspect omitted candidates.`,
      );
      lines.push("");
    } else {
      for (const o of presentation.omitted) {
      let head: string;
      if (o.kind === "card") {
        head = o.card ? `${o.card.id} :: ${o.card.title}` : o.trace.version_id;
      } else {
        head = o.chunk
          ? `${o.chunk.source_path} :: ${o.chunk.heading_path.join(" > ")}`
          : o.trace.version_id;
      }
      lines.push(`- ${head}  — ${o.trace.reason}`);
      if (explain) lines.push(`  ${formatTrace(o.trace).trim()}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function countOmittedReasons(
  omitted: PackPresentation["omitted"],
): Partial<Record<OmittedTrace["omitted_reason"], number>> {
  const counts: Partial<Record<OmittedTrace["omitted_reason"], number>> = {};
  for (const entry of omitted) {
    const reason = entry.trace.omitted_reason;
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}

export function formatTrace(t: ScoreTrace): string {
  return `  [bm25=${t.bm25_norm.toFixed(3)} heading=${t.heading_match.toFixed(3)} scope=${t.scope_match.toFixed(3)} mentions=${t.mention_overlap.toFixed(3)} spec=${t.specificity.toFixed(2)} text=${t.text_score.toFixed(3)} final=${t.final_score.toFixed(3)} tokens=${t.token_count} packing=${t.packing_score.toFixed(3)}]`;
}

export type ContextPackJson = {
  query: string;
  total_tokens: number;
  budget_tokens: number;
  budget: PackResult["budget"];
  warnings: PackWarning[];
  /** Locked Cards (always present in the pack, regardless of budget). */
  locked: {
    card_id: string;
    card_type: "constraint" | "symbol_note" | "evidence";
    title: string;
    body: string;
    token_count: number;
    lock_reason: LockReason;
    freshness_state: string;
    author_review_state: string;
  }[];
  included: {
    version_id: string;
    /** 'doc_chunk' | 'card' (defaults to 'doc_chunk' for back-compat). */
    kind?: "doc_chunk" | "card";
    /** Doc-chunk fields. */
    source_path: string;
    heading_path: string[];
    title: string;
    chunk_index?: number;
    chunk_count?: number;
    start_line?: number;
    end_line?: number;
    body: string;
    token_count: number;
    /** Card fields (when kind='card'). */
    card_id?: string;
    card_type?: "constraint" | "symbol_note" | "evidence";
    score: ScoreTrace;
  }[];
  omitted: {
    version_id: string;
    kind?: "doc_chunk" | "card";
    source_path: string;
    heading_path: string[];
    reason: string;
    score: ScoreTrace;
  }[];
};

export function renderJson(args: RenderArgs): ContextPackJson {
  const presentation = presentationFromArgs(args);
  return renderJsonFromPresentation({
    query: args.query,
    result: args.result,
    presentation,
  });
}

export function renderJsonFromView(view: RetrievalView): ContextPackJson {
  return renderJsonFromPresentation({
    query: view.query,
    result: view.result.pack,
    presentation: view.presentation,
  });
}

function renderJsonFromPresentation(args: {
  query: string;
  result: PackResult;
  presentation: PackPresentation;
}): ContextPackJson {
  const presentation = args.presentation;

  const locked = presentation.locked.map((e) => ({
    card_id: e.card.id,
    card_type: e.card.type,
    title: e.card.title,
    body: e.card.body,
    token_count: e.entry.token_count,
    lock_reason: e.reason,
    freshness_state: e.freshness.state,
    author_review_state: e.freshness.author_review_state,
  }));

  const includedAll: PresentedRankedEntry[] = [...presentation.relevant, ...presentation.evidence];

  const inc = includedAll.map((r): ContextPackJson["included"][number] => {
    if (r.kind === "card") {
      return {
        version_id: r.trace.version_id,
        kind: "card",
        source_path: r.card.source_path,
        heading_path: [r.card.title],
        title: r.card.title,
        body: r.card.body,
        token_count: r.trace.token_count,
        card_id: r.card.id,
        card_type: r.card.type,
        score: stripReason(r.trace),
      };
    }
    return {
      version_id: r.trace.version_id,
      kind: "doc_chunk",
      source_path: r.chunk.source_path,
      heading_path: r.chunk.heading_path,
      title: r.chunk.title,
      chunk_index: r.chunk.chunk_index,
      chunk_count: r.chunk.chunk_count,
      start_line: r.chunk.start_line,
      end_line: r.chunk.end_line,
      body: r.chunk.body,
      token_count: r.chunk.token_count,
      score: stripReason(r.trace),
    };
  });

  const om = presentation.omitted.map((o): ContextPackJson["omitted"][number] => {
    if (o.kind === "card") {
      return {
        version_id: o.trace.version_id,
        kind: "card",
        source_path: o.card?.source_path ?? "",
        heading_path: o.card ? [o.card.title] : [],
        reason: o.trace.reason,
        score: stripReason(o.trace),
      };
    }
    return {
      version_id: o.trace.version_id,
      kind: "doc_chunk",
      source_path: o.chunk?.source_path ?? "",
      heading_path: o.chunk?.heading_path ?? [],
      reason: o.trace.reason,
      score: stripReason(o.trace),
    };
  });

  return {
    query: args.query,
    total_tokens: presentation.total_tokens,
    budget_tokens: presentation.budget_tokens,
    budget: presentation.budget,
    // The CLI JSON has historically carried only pack-level warnings (locked_overflow,
    // freshness, tombstoned_link). Generated wire warnings (no_matches, no_sources, etc.)
    // stay out of this projection — agents inspecting JSON have access to the raw counts
    // via `omitted` and `included`.
    warnings: args.result.warnings,
    locked,
    included: inc,
    omitted: om,
  };
}

function stripReason(
  t: DocChunkPackedTrace | CardPackedTrace | OmittedTrace,
): ScoreTrace {
  return {
    version_id: t.version_id,
    bm25_norm: t.bm25_norm,
    heading_match: t.heading_match,
    scope_match: t.scope_match,
    mention_overlap: t.mention_overlap,
    specificity: t.specificity,
    text_score: t.text_score,
    final_score: t.final_score,
    token_count: t.token_count,
    packing_score: t.packing_score,
  };
}
