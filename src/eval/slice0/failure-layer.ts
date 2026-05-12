/**
 * THO-134 / PRD-0013 V2.5.1 — failure-layer classification.
 *
 * Classifies why an expected critical source did not appear in the displayed
 * top-3. The classification points at the remediation layer:
 *
 *   - `not_imported`           — corpus import did not include the file
 *   - `absent_from_candidates` — file imported but no chunk reached the
 *                                pre-pack candidate set at all
 *   - `outside_top50`          — present in candidates but rank > 50
 *   - `below_threshold`        — top-50 but every chunk fell below the
 *                                min_final_score threshold
 *   - `pack_loss`              — at least one chunk above threshold but none
 *                                survived budget packing
 *   - `display_loss`           — packed but did not reach displayed top-3
 *   - `none`                   — no failure (the source is in displayed top-3)
 *
 * The function is pure and deterministic. It has no knowledge of repo or
 * intent: callers translate raw retrieval state into these signals.
 */
export const FAILURE_LAYERS = [
  "none",
  "not_imported",
  "absent_from_candidates",
  "outside_top50",
  "below_threshold",
  "pack_loss",
  "display_loss",
] as const;

export type FailureLayer = (typeof FAILURE_LAYERS)[number];

export type SourceFailureSignals = {
  /**
   * Whether the source path was found among imported docs. `null` means
   * "import inventory not available" — treated as imported (true) for now;
   * THO-135 wires real not-imported tracking.
   */
  imported: boolean | null;
  /** 1-indexed rank in the source-candidate aggregation; null if absent. */
  candidate_rank: number | null;
  /** True if any chunk from this source survived the threshold filter. */
  has_above_threshold_chunk: boolean;
  /** True if any chunk from this source was packed. */
  has_packed_chunk: boolean;
  /** True if any chunk from this source appears in the displayed top-3. */
  in_displayed_top3: boolean;
};

export function classifyCriticalSourceMiss(
  signals: SourceFailureSignals,
): FailureLayer {
  if (signals.imported === false) return "not_imported";
  if (signals.candidate_rank === null) return "absent_from_candidates";
  if (signals.candidate_rank > 50) return "outside_top50";
  if (!signals.has_above_threshold_chunk) return "below_threshold";
  if (!signals.has_packed_chunk) return "pack_loss";
  if (!signals.in_displayed_top3) return "display_loss";
  return "none";
}

export type CaseFailureLayerInputSource = {
  source_path: string;
  signals: SourceFailureSignals;
};

export type PerSourceFailureLayer = {
  source_path: string;
  layer: FailureLayer;
};

export type CaseFailureLayerObservation = {
  /**
   * Dominant layer for the case — the highest-precedence non-`none` layer
   * across critical sources. `none` means every critical source is in the
   * displayed top-3.
   */
  layer: FailureLayer;
  per_source: PerSourceFailureLayer[];
};

const LAYER_PRECEDENCE: FailureLayer[] = [
  "not_imported",
  "absent_from_candidates",
  "outside_top50",
  "below_threshold",
  "pack_loss",
  "display_loss",
];

export type CaseSignalSources = {
  must_include_sources: string[];
  candidate_rank_by_source: Map<string, number>;
  above_threshold_sources: Set<string>;
  packed_sources: Set<string>;
  displayed_top3_sources: Set<string>;
  /**
   * Set of imported source paths. `null` means inventory unavailable; the
   * classifier then cannot say `not_imported` (THO-135 wires this in).
   */
  imported_sources: Set<string> | null;
};

/**
 * Adapter that turns raw retrieval-stage state into per-source signals and
 * classifies each critical source. Eval/report code calls this; pure
 * `classifyCriticalSourceMiss` stays unaware of how signals are derived.
 */
export function caseFailureLayer(
  input: CaseSignalSources,
): CaseFailureLayerObservation {
  const sources: CaseFailureLayerInputSource[] = input.must_include_sources.map(
    (path) => {
      const candidate_rank = input.candidate_rank_by_source.get(path) ?? null;
      const imported =
        input.imported_sources === null
          ? null
          : input.imported_sources.has(path);
      return {
        source_path: path,
        signals: {
          imported,
          candidate_rank,
          has_above_threshold_chunk: input.above_threshold_sources.has(path),
          has_packed_chunk: input.packed_sources.has(path),
          in_displayed_top3: input.displayed_top3_sources.has(path),
        },
      };
    },
  );
  return classifyCaseFailureLayer({ sources });
}

/**
 * Aggregate per-source classifications into a single case-level layer. The
 * dominant layer is the worst (highest-precedence) actual failure across the
 * critical sources, so reports can sort cases by primary remediation target.
 */
export function classifyCaseFailureLayer(input: {
  sources: CaseFailureLayerInputSource[];
}): CaseFailureLayerObservation {
  const per_source: PerSourceFailureLayer[] = input.sources.map((s) => ({
    source_path: s.source_path,
    layer: classifyCriticalSourceMiss(s.signals),
  }));
  let dominant: FailureLayer = "none";
  let dominantIdx = LAYER_PRECEDENCE.length;
  for (const p of per_source) {
    if (p.layer === "none") continue;
    const idx = LAYER_PRECEDENCE.indexOf(p.layer);
    if (idx >= 0 && idx < dominantIdx) {
      dominant = p.layer;
      dominantIdx = idx;
    }
  }
  return { layer: dominant, per_source };
}
