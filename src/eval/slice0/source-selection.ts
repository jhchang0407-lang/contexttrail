/**
 * THO-143 / PRD-0014 V3.1 — source-selection diagnostics.
 *
 * Classifies cases where the declared `must_include_sources` did not all
 * reach the displayed top-3, and categorises *why*. The V2.5 retrieval
 * pipeline already places critical sources in the candidate set (recall@50
 * is ~99%), so the surviving losses are about source choice among already
 * visible candidates. V3.1 turns those losses into measurable, named gates
 * so subsequent V3 slices have a target to move.
 *
 * The module is pure and deterministic: callers pass already-derived signals
 * (must_include set, displayed top-3, candidate ranks, query intent, plus a
 * lightweight source descriptor when available) and the module returns the
 * fact and a reason code. No knowledge of repo paths or fixture ids.
 */
import type { QueryIntent } from "../types.js";

export const SOURCE_SELECTION_LOSS_CATEGORIES = [
  "none",
  "candidate_recall_outlier",
  "parent_vs_leaf",
  "decision_vs_procedural",
  "anchored_exact_vs_broad",
  "overview_vs_reference",
  "adjacent_sibling",
  "changelog_release_intent",
  "generic_display_loss",
] as const;

export type SourceSelectionLossCategory =
  (typeof SOURCE_SELECTION_LOSS_CATEGORIES)[number];

export type MustIncludeTop3Args = {
  must_include_sources: string[];
  displayed_top3_sources: string[];
};

export function mustIncludeTop3(args: MustIncludeTop3Args): boolean {
  if (args.must_include_sources.length === 0) return true;
  const displayed = new Set(top3(args.displayed_top3_sources));
  for (const required of args.must_include_sources) {
    if (!displayed.has(required)) return false;
  }
  return true;
}

/**
 * Lightweight source descriptor used by the loss classifier. Real callers
 * will pass enough fields to label the relationship; tests can pass a
 * minimal subset and assert on a specific loss category.
 */
export type SourceDescriptor = {
  source_path: string;
  /** Optional doc purpose (concept, guide, api_reference, changelog, ...). */
  doc_purpose?: string;
  /** Optional doc role (canonical, archive, ideation, example). */
  doc_role?: string;
};

export type ClassifyLossArgs = {
  intent: QueryIntent;
  must_include_sources: string[];
  displayed_top3_sources: string[];
  /** 1-indexed candidate rank by source path; absent => not in candidate set. */
  candidate_rank_by_source: Map<string, number>;
  /** Optional source descriptors keyed by source path for relationship hints. */
  descriptor_by_source?: Map<string, SourceDescriptor>;
};

export type SourceSelectionLossObservation = {
  category: SourceSelectionLossCategory;
  /** The first must_include source that was missing from displayed top-3. */
  missing_source: string | null;
  /** Displayed sources for diagnostic narration. */
  displayed_top3: string[];
};

export function classifySourceSelectionLoss(
  args: ClassifyLossArgs,
): SourceSelectionLossObservation {
  const displayed_top3 = top3(args.displayed_top3_sources);
  if (mustIncludeTop3({
    must_include_sources: args.must_include_sources,
    displayed_top3_sources: displayed_top3,
  })) {
    return {
      category: "none",
      missing_source: null,
      displayed_top3,
    };
  }

  const displayedSet = new Set(displayed_top3);
  const missing =
    args.must_include_sources.find((p) => !displayedSet.has(p)) ?? null;

  // Outside the candidate set entirely — this is the lone V2.5 outlier
  // (turborepo-unanchored-getting-started). It is a recall problem, not a
  // ranking problem; V3 must keep it visible without conflating it with
  // source-scoring losses.
  if (
    missing &&
    !args.candidate_rank_by_source.has(missing)
  ) {
    return {
      category: "candidate_recall_outlier",
      missing_source: missing,
      displayed_top3,
    };
  }

  const descriptors = args.descriptor_by_source;
  const missingDesc = descriptors && missing ? descriptors.get(missing) : undefined;
  const displayedDescs = descriptors
    ? displayed_top3
        .map((p) => descriptors.get(p))
        .filter((d): d is SourceDescriptor => d !== undefined)
    : [];

  // Changelog/release intent — the query asks about changes/versions but the
  // displayed sources are non-changelog docs. Distinguished from ordinary
  // adjacent-sibling losses because the remediation is intent classification,
  // not ranking.
  if (
    missing &&
    (missingDesc?.doc_purpose === "changelog" ||
      missingDesc?.doc_purpose === "release_note" ||
      isChangelogPath(missing))
  ) {
    return {
      category: "changelog_release_intent",
      missing_source: missing,
      displayed_top3,
    };
  }

  // Anchored intent that lost the exact owner of the topic to broad reference
  // pages (turborepo globs, vitest cli).
  if (
    args.intent === "file_anchored" &&
    displayedDescs.some((d) => d.doc_purpose === "api_reference") &&
    missingDesc &&
    missingDesc.doc_purpose !== "api_reference"
  ) {
    return {
      category: "anchored_exact_vs_broad",
      missing_source: missing,
      displayed_top3,
    };
  }

  // Decision query lost to procedural/adapter docs (trpc rpc-vs-rest).
  if (
    args.intent === "decision_lookup" &&
    displayedDescs.length > 0 &&
    !displayedDescs.some(
      (d) => d.doc_purpose === "adr" || d.doc_purpose === "concept",
    )
  ) {
    return {
      category: "decision_vs_procedural",
      missing_source: missing,
      displayed_top3,
    };
  }

  // Parent overview lost to leaf siblings (hono middleware, trpc overview,
  // vitest browser-mode). Detected structurally: the missing source has a
  // strictly shorter path prefix than every displayed source.
  if (missing && looksLikeParent(missing, displayed_top3)) {
    return {
      category: "parent_vs_leaf",
      missing_source: missing,
      displayed_top3,
    };
  }

  // Broad-domain overview lost to reference/config pages (vitest projects).
  if (
    args.intent === "broad_domain" &&
    displayedDescs.some(
      (d) => d.doc_purpose === "api_reference" || d.doc_purpose === "config_reference",
    )
  ) {
    return {
      category: "overview_vs_reference",
      missing_source: missing,
      displayed_top3,
    };
  }

  // Adjacent sibling — top-3 includes a sibling close in path/topic but not
  // the declared required source (trpc nextjs, ralph anchored-setup-sync).
  if (
    missing &&
    displayed_top3.some((p) =>
      shareParentDirectory(p, missing),
    )
  ) {
    return {
      category: "adjacent_sibling",
      missing_source: missing,
      displayed_top3,
    };
  }

  return {
    category: "generic_display_loss",
    missing_source: missing,
    displayed_top3,
  };
}

function top3(paths: string[]): string[] {
  return paths.slice(0, 3);
}

function isChangelogPath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith("/changelog.md") ||
    lower.endsWith("changelog.md") ||
    lower.includes("/release-notes") ||
    lower.endsWith("/release.md")
  );
}

function looksLikeParent(missing: string, displayed: string[]): boolean {
  if (displayed.length === 0) return false;
  const missingDir = parentDir(missing);
  return displayed.every((p) => {
    const dir = parentDir(p);
    return (
      dir.length > missingDir.length &&
      dir.startsWith(missingDir.endsWith("/") ? missingDir : missingDir + "/")
    );
  });
}

function shareParentDirectory(a: string, b: string): boolean {
  return parentDir(a) === parentDir(b);
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

/**
 * Aggregate input — one row per case the V3 eval considers. Unsupported
 * (signal_empty) cases pass `is_answerable: false` and contribute zero
 * eligibility for the must_include_top3 metric.
 */
export type SourceSelectionAggregateInputCase = {
  id: string;
  is_answerable: boolean;
  intent: QueryIntent;
  must_include_sources: string[];
  displayed_top3_sources: string[];
  candidate_rank_by_source: Map<string, number>;
  descriptor_by_source?: Map<string, SourceDescriptor>;
};

export type SourceSelectionAggregate = {
  must_include_top3_passes: number;
  must_include_top3_eligible: number;
  must_include_top3_rate: number;
  display_loss_count: number;
  loss_category_counts: Record<SourceSelectionLossCategory, number>;
  /** Per-case loss category for downstream rendering. */
  per_case: Array<{
    id: string;
    must_include_top3: boolean;
    loss_category: SourceSelectionLossCategory;
    missing_source: string | null;
  }>;
};

export function aggregateSourceSelectionMetrics(
  cases: SourceSelectionAggregateInputCase[],
): SourceSelectionAggregate {
  const loss_category_counts: Record<SourceSelectionLossCategory, number> =
    Object.fromEntries(
      SOURCE_SELECTION_LOSS_CATEGORIES.map((c) => [c, 0]),
    ) as Record<SourceSelectionLossCategory, number>;
  const per_case: SourceSelectionAggregate["per_case"] = [];

  let passes = 0;
  let eligible = 0;
  let display_losses = 0;

  for (const c of cases) {
    if (!c.is_answerable || c.must_include_sources.length === 0) {
      per_case.push({
        id: c.id,
        must_include_top3: true,
        loss_category: "none",
        missing_source: null,
      });
      continue;
    }
    eligible += 1;
    const loss = classifySourceSelectionLoss({
      intent: c.intent,
      must_include_sources: c.must_include_sources,
      displayed_top3_sources: c.displayed_top3_sources,
      candidate_rank_by_source: c.candidate_rank_by_source,
      descriptor_by_source: c.descriptor_by_source,
    });
    loss_category_counts[loss.category] += 1;
    const ok = loss.category === "none";
    if (ok) {
      passes += 1;
    } else if (loss.category !== "candidate_recall_outlier") {
      display_losses += 1;
    }
    per_case.push({
      id: c.id,
      must_include_top3: ok,
      loss_category: loss.category,
      missing_source: loss.missing_source,
    });
  }

  return {
    must_include_top3_passes: passes,
    must_include_top3_eligible: eligible,
    must_include_top3_rate: eligible === 0 ? 1 : passes / eligible,
    display_loss_count: display_losses,
    loss_category_counts,
    per_case,
  };
}

export type V3GateName =
  | "source_selection_display_losses"
  | "must_include_top3_floor"
  | "candidate_recall_floor"
  | "false_confident_unsupported";

export type V3GateFailure = {
  gate: V3GateName;
  message: string;
};

export type V3GateResult = {
  passed: boolean;
  failures: V3GateFailure[];
};

export type V3GateInputs = {
  display_loss_count: number;
  display_loss_budget: number;
  must_include_top3_rate: number;
  must_include_top3_floor: number;
  candidate_recall_at_50_rate: number;
  candidate_recall_floor: number;
  false_confident_unsupported: number;
};

/** PRD-0014 V3 release floors. */
export const V3_RELEASE_FLOORS = {
  combined_wire_top1: 0.75,
  combined_wire_top3: 0.938,
  holdout_wire_top1: 0.75,
  holdout_wire_top3: 0.938,
  combined_candidate_recall: 0.992,
  holdout_candidate_recall: 0.989,
  combined_display_losses: 5,
  holdout_display_losses: 5,
  must_include_missing_reduction: 0.6,
  unsupported_honesty: 1.0,
  false_confident_unsupported: 0,
} as const;

export type V3ReleasePanelInputs = {
  wire_top1_rate: number;
  wire_top3_rate: number;
  candidate_recall_at_50_rate: number;
  display_loss_count: number;
  /** Number of cases where must_include_top3 was false on the V2.5 baseline. */
  must_include_top3_missing_baseline: number;
  /** Same metric on the current run. */
  must_include_top3_missing_current: number;
};

export type V3ReleaseGateName =
  | "synthetic_regression"
  | "false_confident_unsupported"
  | "unsupported_honesty"
  | "combined_wire_top1"
  | "combined_wire_top3"
  | "combined_candidate_recall"
  | "combined_display_losses"
  | "holdout_wire_top1"
  | "holdout_wire_top3"
  | "holdout_candidate_recall"
  | "holdout_display_losses"
  | "must_include_missing_reduction";

export type V3ReleaseGateFailure = {
  gate: V3ReleaseGateName;
  message: string;
};

export type V3ReleaseGateResult = {
  passed: boolean;
  failures: V3ReleaseGateFailure[];
};

export type V3ReleaseGateInputs = {
  combined: V3ReleasePanelInputs;
  holdout: V3ReleasePanelInputs;
  false_confident_unsupported: number;
  unsupported_honesty_rate: number;
  synthetic_regression: boolean;
};

export function evaluateV3ReleaseGates(
  input: V3ReleaseGateInputs,
): V3ReleaseGateResult {
  const failures: V3ReleaseGateFailure[] = [];

  if (input.synthetic_regression) {
    failures.push({
      gate: "synthetic_regression",
      message: "synthetic regression set; cannot interpret real-corpus movement",
    });
  }
  if (input.false_confident_unsupported > V3_RELEASE_FLOORS.false_confident_unsupported) {
    failures.push({
      gate: "false_confident_unsupported",
      message: `${input.false_confident_unsupported} unsupported case(s) reported confident; floor requires 0`,
    });
  }
  if (input.unsupported_honesty_rate < V3_RELEASE_FLOORS.unsupported_honesty) {
    failures.push({
      gate: "unsupported_honesty",
      message: `unsupported honesty = ${(input.unsupported_honesty_rate * 100).toFixed(1)}% < ${(V3_RELEASE_FLOORS.unsupported_honesty * 100).toFixed(1)}% floor`,
    });
  }

  // Combined panel.
  pushPanelFailures({
    panel: input.combined,
    prefix: "combined",
    floors: {
      top1: V3_RELEASE_FLOORS.combined_wire_top1,
      top3: V3_RELEASE_FLOORS.combined_wire_top3,
      recall: V3_RELEASE_FLOORS.combined_candidate_recall,
      display_loss_budget: V3_RELEASE_FLOORS.combined_display_losses,
    },
    failures,
  });

  // Holdout panel.
  pushPanelFailures({
    panel: input.holdout,
    prefix: "holdout",
    floors: {
      top1: V3_RELEASE_FLOORS.holdout_wire_top1,
      top3: V3_RELEASE_FLOORS.holdout_wire_top3,
      recall: V3_RELEASE_FLOORS.holdout_candidate_recall,
      display_loss_budget: V3_RELEASE_FLOORS.holdout_display_losses,
    },
    failures,
  });

  // Must-include reduction — measured against the V2.5 baseline. Use the
  // tighter of the two panels (whichever shows the larger missing count
  // after V3) so improvements on one panel cannot mask regressions on the
  // other.
  const baseline = Math.max(
    input.combined.must_include_top3_missing_baseline,
    input.holdout.must_include_top3_missing_baseline,
  );
  const current = Math.max(
    input.combined.must_include_top3_missing_current,
    input.holdout.must_include_top3_missing_current,
  );
  const reduction = baseline === 0 ? 1 : (baseline - current) / baseline;
  if (reduction < V3_RELEASE_FLOORS.must_include_missing_reduction) {
    failures.push({
      gate: "must_include_missing_reduction",
      message: `must_include_top3 missing reduced ${(reduction * 100).toFixed(1)}% (baseline ${baseline} → current ${current}); floor requires ${(V3_RELEASE_FLOORS.must_include_missing_reduction * 100).toFixed(0)}%`,
    });
  }

  return { passed: failures.length === 0, failures };
}

function pushPanelFailures(args: {
  panel: V3ReleasePanelInputs;
  prefix: "combined" | "holdout";
  floors: { top1: number; top3: number; recall: number; display_loss_budget: number };
  failures: V3ReleaseGateFailure[];
}): void {
  const { panel, prefix, floors, failures } = args;
  if (panel.wire_top1_rate < floors.top1) {
    failures.push({
      gate: `${prefix}_wire_top1` as V3ReleaseGateName,
      message: `${prefix} wire top-1 = ${(panel.wire_top1_rate * 100).toFixed(1)}% < ${(floors.top1 * 100).toFixed(1)}% floor`,
    });
  }
  if (panel.wire_top3_rate < floors.top3) {
    failures.push({
      gate: `${prefix}_wire_top3` as V3ReleaseGateName,
      message: `${prefix} wire top-3 = ${(panel.wire_top3_rate * 100).toFixed(1)}% < ${(floors.top3 * 100).toFixed(1)}% floor`,
    });
  }
  if (panel.candidate_recall_at_50_rate < floors.recall) {
    failures.push({
      gate: `${prefix}_candidate_recall` as V3ReleaseGateName,
      message: `${prefix} critical-source candidate recall@50 = ${(panel.candidate_recall_at_50_rate * 100).toFixed(1)}% < ${(floors.recall * 100).toFixed(1)}% floor`,
    });
  }
  if (panel.display_loss_count > floors.display_loss_budget) {
    failures.push({
      gate: `${prefix}_display_losses` as V3ReleaseGateName,
      message: `${prefix} source-selection display losses = ${panel.display_loss_count} > budget ${floors.display_loss_budget}`,
    });
  }
}

export function evaluateV3SourceSelectionGates(
  input: V3GateInputs,
): V3GateResult {
  const failures: V3GateFailure[] = [];
  if (input.display_loss_count > input.display_loss_budget) {
    failures.push({
      gate: "source_selection_display_losses",
      message:
        `source-selection display losses = ${input.display_loss_count} > budget ${input.display_loss_budget}`,
    });
  }
  if (input.must_include_top3_rate < input.must_include_top3_floor) {
    failures.push({
      gate: "must_include_top3_floor",
      message:
        `must_include_top3 rate = ${(input.must_include_top3_rate * 100).toFixed(1)}% < ${(input.must_include_top3_floor * 100).toFixed(1)}% floor`,
    });
  }
  if (input.candidate_recall_at_50_rate < input.candidate_recall_floor) {
    failures.push({
      gate: "candidate_recall_floor",
      message:
        `critical-source candidate recall@50 = ${(input.candidate_recall_at_50_rate * 100).toFixed(1)}% < ${(input.candidate_recall_floor * 100).toFixed(1)}% floor`,
    });
  }
  if (input.false_confident_unsupported > 0) {
    failures.push({
      gate: "false_confident_unsupported",
      message:
        `${input.false_confident_unsupported} unsupported case(s) reported \`confident\`; floor requires 0`,
    });
  }
  return { passed: failures.length === 0, failures };
}
