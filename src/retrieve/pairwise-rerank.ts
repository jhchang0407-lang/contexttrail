/**
 * Optional close-call pairwise rerank adapter (V3.6).
 *
 * The deterministic V3 floor (V3.1–V3.5) ships without any model dependency.
 * This module adds a *strictly optional* pairwise rerank adapter that the
 * caller can plug in to break close-call ties between source cards. The
 * constraints are:
 *
 *   - Adapter is only invoked on close calls (margin < threshold).
 *   - Adapter cannot promote `unsupported` to first.
 *   - Adapter cannot override fail-closed selection.
 *   - Adapter calls are logged as an ablation; ablation logs include the
 *     reasons the adapter returned so movement is auditable.
 *   - Locked Cards and confidence policy are upstream of selection and
 *     untouched by this module.
 */
import type { SourceCard } from "./source-card.js";
import type {
  SourceSelectionDecision,
  SelectedSource,
  SelectionReasonCode,
} from "./source-selection-decision.js";

export type PairwiseRerankPreference = {
  preferred: "a" | "b";
  reasons: string[];
};

export type PairwiseRerankAdapter = (
  a: SourceCard,
  b: SourceCard,
) => PairwiseRerankPreference;

export type PairwiseRerankAblationEntry = {
  pair: [string, string];
  preferred: string;
  reasons: string[];
  swap_applied: boolean;
};

export type PairwiseRerankAblationLog = {
  invocations: number;
  swaps: number;
  refused_unsupported_promotions: number;
  entries: PairwiseRerankAblationEntry[];
};

export type ApplyPairwiseRerankArgs = {
  decision: SourceSelectionDecision;
  cards: SourceCard[];
  adapter: PairwiseRerankAdapter | undefined;
  /** Maximum (top1.score - top2.score) at which the adapter is consulted. */
  close_call_margin: number;
};

export type ApplyPairwiseRerankResult = {
  decision: SourceSelectionDecision;
  ablation_log: PairwiseRerankAblationLog;
};

export function applyCloseCallPairwiseRerank(
  args: ApplyPairwiseRerankArgs,
): ApplyPairwiseRerankResult {
  const log: PairwiseRerankAblationLog = {
    invocations: 0,
    swaps: 0,
    refused_unsupported_promotions: 0,
    entries: [],
  };
  const { cards, adapter, close_call_margin } = args;
  const decision = cloneDecision(args.decision);

  if (decision.fail_closed) {
    return { decision, ablation_log: log };
  }
  if (!adapter) {
    return { decision, ablation_log: log };
  }
  const sel = decision.selected_sources;
  const top = sel[0];
  const second = sel[1];
  if (!top || !second) {
    return { decision, ablation_log: log };
  }
  const margin = top.score - second.score;
  if (margin >= close_call_margin) {
    return { decision, ablation_log: log };
  }

  const cardByPath = new Map(cards.map((c) => [c.source_path, c]));
  const cardA = cardByPath.get(top.source_path);
  const cardB = cardByPath.get(second.source_path);
  if (!cardA || !cardB) {
    return { decision, ablation_log: log };
  }

  log.invocations += 1;
  const pref = adapter(cardA, cardB);
  const swapRequested = pref.preferred === "b";
  let swapApplied = false;

  if (swapRequested) {
    if (second.aboutness_label === "unsupported") {
      // Adapter cannot lift unsupported into the top slot. Confidence policy
      // remains authoritative; selection still includes the original top.
      log.refused_unsupported_promotions += 1;
    } else {
      // Apply swap. The adapter's reasons live in the new top entry's
      // reason_codes list as a single composite tag; the verbose reasons
      // remain in the ablation log so the movement is auditable.
      const newTop: SelectedSource = {
        ...second,
        rank: 1,
        score: top.score, // preserve composite score so downstream margins remain meaningful
        reason_codes: dedupePreserveOrder<SelectionReasonCode>([
          ...(second.reason_codes ?? []),
          "pairwise_rerank_promoted",
        ]),
      };
      const demoted: SelectedSource = {
        ...top,
        rank: 2,
        score: second.score,
      };
      const updated: SelectedSource[] = [newTop, demoted, ...sel.slice(2)];
      decision.selected_sources = updated;
      decision.top1_top2_margin = newTop.score - demoted.score;
      decision.top1_top3_margin = newTop.score - (updated[2]?.score ?? 0);
      log.swaps += 1;
      swapApplied = true;
    }
  }

  log.entries.push({
    pair: [top.source_path, second.source_path],
    preferred: pref.preferred === "a" ? top.source_path : second.source_path,
    reasons: pref.reasons,
    swap_applied: swapApplied,
  });

  return { decision, ablation_log: log };
}

function cloneDecision(decision: SourceSelectionDecision): SourceSelectionDecision {
  return {
    selected_sources: decision.selected_sources.map((source) => ({
      ...source,
      reason_codes: [...source.reason_codes],
    })),
    fail_closed: decision.fail_closed,
    top1_top2_margin: decision.top1_top2_margin,
    top1_top3_margin: decision.top1_top3_margin,
  };
}

function dedupePreserveOrder<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const i of items) {
    if (!seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  }
  return out;
}
