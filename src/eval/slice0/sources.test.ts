import { describe, it, expect } from "vitest";
import {
  aggregateSourceCandidates,
  computeSourceRecallMetrics,
  isCriticalSourceCase,
} from "./sources.js";
import type { Slice0ChunkCandidate } from "./candidates.js";

function chunk(
  rank: number,
  source: string,
  score: number,
  versionId?: string,
): Slice0ChunkCandidate {
  return {
    rank,
    version_id: versionId ?? `${source}#${rank}`,
    source_path: source,
    heading_path: [],
    final_score: score,
    packing_score: score,
    bm25_norm: 0,
    heading_match: 0,
    scope_match: 0,
    mention_overlap: 0,
    specificity: 1,
    text_score: 0,
    token_count: 100,
  };
}

describe("aggregateSourceCandidates", () => {
  it("dedupes multiple chunks from one source into one source candidate", () => {
    const cands = [
      chunk(1, "docs/widgets.md", 0.9),
      chunk(2, "docs/widgets.md", 0.7),
      chunk(3, "docs/other.md", 0.5),
    ];
    const sources = aggregateSourceCandidates(cands);
    expect(sources).toHaveLength(2);
    const widgets = sources.find((s) => s.source_path === "docs/widgets.md")!;
    expect(widgets.contributing_chunks).toHaveLength(2);
  });

  it("uses minimum chunk rank as best_chunk_rank", () => {
    const cands = [
      chunk(5, "docs/a.md", 0.3),
      chunk(2, "docs/a.md", 0.4),
      chunk(8, "docs/a.md", 0.1),
    ];
    const [agg] = aggregateSourceCandidates(cands);
    expect(agg!.best_chunk_rank).toBe(2);
  });

  it("uses maximum final_score as best_chunk_score", () => {
    const cands = [
      chunk(5, "docs/a.md", 0.3),
      chunk(2, "docs/a.md", 0.4),
      chunk(8, "docs/a.md", 0.7),
    ];
    const [agg] = aggregateSourceCandidates(cands);
    expect(agg!.best_chunk_score).toBeCloseTo(0.7);
  });

  it("orders source candidates by best_chunk_rank with score as tie-breaker", () => {
    const cands = [
      chunk(3, "docs/c.md", 0.9),
      chunk(1, "docs/a.md", 0.1),
      chunk(2, "docs/b.md", 0.5),
      chunk(4, "docs/c.md", 0.8),
      chunk(5, "docs/a.md", 0.4),
    ];
    const sources = aggregateSourceCandidates(cands);
    expect(sources.map((s) => s.source_path)).toEqual([
      "docs/a.md",
      "docs/b.md",
      "docs/c.md",
    ]);
    // ranks are 1-based and dense.
    expect(sources.map((s) => s.rank)).toEqual([1, 2, 3]);
  });

  it("breaks ties by best_chunk_score descending when ranks tie", () => {
    // Synthetic: same min rank for two sources.
    const cands = [
      chunk(1, "docs/strong.md", 0.9),
      chunk(1, "docs/weak.md", 0.2),
    ];
    const sources = aggregateSourceCandidates(cands);
    expect(sources.map((s) => s.source_path)).toEqual([
      "docs/strong.md",
      "docs/weak.md",
    ]);
  });

  it("ignores chunks with empty source_path", () => {
    const cands = [chunk(1, "", 0.9), chunk(2, "docs/a.md", 0.4)];
    const sources = aggregateSourceCandidates(cands);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.source_path).toBe("docs/a.md");
  });
});

describe("isCriticalSourceCase", () => {
  it("treats answerable cases with must_include_sources as critical", () => {
    expect(
      isCriticalSourceCase({
        expectation_kind: "deterministic",
        expected_query_mode: "anchored",
        expected_signal_empty_warning: false,
        must_include_sources: ["docs/widgets.md"],
      }),
    ).toBe(true);
  });

  it("treats signal_empty cases as non-critical (no recall target)", () => {
    expect(
      isCriticalSourceCase({
        expectation_kind: "signal_empty",
        expected_query_mode: "signal_empty",
        expected_signal_empty_warning: true,
        must_include_sources: [],
      }),
    ).toBe(false);
  });

  it("treats signal_empty-by-warning cases as non-critical even with deterministic kind", () => {
    expect(
      isCriticalSourceCase({
        expectation_kind: "deterministic",
        expected_query_mode: "unanchored",
        expected_signal_empty_warning: true,
        must_include_sources: ["docs/widgets.md"],
      }),
    ).toBe(false);
  });

  it("non-critical when must_include_sources is empty even if answerable", () => {
    expect(
      isCriticalSourceCase({
        expectation_kind: "deterministic",
        expected_query_mode: "anchored",
        expected_signal_empty_warning: false,
        must_include_sources: [],
      }),
    ).toBe(false);
  });
});

describe("computeSourceRecallMetrics", () => {
  function build(
    sourcePaths: string[],
  ): ReturnType<typeof aggregateSourceCandidates> {
    const cands = sourcePaths.map((p, i) => chunk(i + 1, p, 1 / (i + 1)));
    return aggregateSourceCandidates(cands);
  }

  it("computes expected source recall@k by source rank", () => {
    const sources = build([
      "docs/a.md",
      "docs/b.md",
      "docs/c.md",
      "docs/widgets.md",
    ]);
    const m = computeSourceRecallMetrics({
      sources,
      expected_top_source: "docs/widgets.md",
      acceptable_top_sources: ["docs/widgets.md"],
      must_include_sources: ["docs/widgets.md"],
      is_critical: true,
    });
    expect(m.expected_source_rank).toBe(4);
    expect(m.expected_source_recall_at_10).toBe(true);
    expect(m.expected_source_recall_at_20).toBe(true);
    expect(m.expected_source_recall_at_50).toBe(true);
  });

  it("misses on expected_source_recall when source absent from candidates", () => {
    const sources = build(["docs/a.md", "docs/b.md"]);
    const m = computeSourceRecallMetrics({
      sources,
      expected_top_source: "docs/widgets.md",
      acceptable_top_sources: ["docs/widgets.md"],
      must_include_sources: ["docs/widgets.md"],
      is_critical: true,
    });
    expect(m.expected_source_rank).toBeNull();
    expect(m.expected_source_recall_at_50).toBe(false);
  });

  it("computes critical-source-set recall via must_include_sources", () => {
    const sources = build([
      "docs/a.md",
      "docs/b.md",
      "docs/widgets.md",
      "docs/quickstart.md",
    ]);
    const m = computeSourceRecallMetrics({
      sources,
      expected_top_source: "docs/widgets.md",
      acceptable_top_sources: ["docs/widgets.md"],
      must_include_sources: ["docs/widgets.md", "docs/quickstart.md", "docs/missing.md"],
      is_critical: true,
    });
    expect(m.critical_source_recall_at_50.found).toBe(2);
    expect(m.critical_source_recall_at_50.total).toBe(3);
    expect(m.all_critical_sources_covered_at_50).toBe(false);
    expect(m.missing_critical_sources_at_50).toEqual(["docs/missing.md"]);
  });

  it("reports all_critical_sources_covered=true only when every member is found within k", () => {
    const sources = build(["docs/widgets.md", "docs/quickstart.md", "docs/x.md"]);
    const m = computeSourceRecallMetrics({
      sources,
      expected_top_source: "docs/widgets.md",
      acceptable_top_sources: ["docs/widgets.md"],
      must_include_sources: ["docs/widgets.md", "docs/quickstart.md"],
      is_critical: true,
    });
    expect(m.all_critical_sources_covered_at_10).toBe(true);
  });

  it("returns null critical metrics when case is not critical", () => {
    const sources = build(["docs/a.md"]);
    const m = computeSourceRecallMetrics({
      sources,
      expected_top_source: "",
      acceptable_top_sources: [],
      must_include_sources: [],
      is_critical: false,
    });
    expect(m.critical_source_recall_at_10).toBeNull();
    expect(m.critical_source_recall_at_50).toBeNull();
    expect(m.all_critical_sources_covered_at_50).toBeNull();
    expect(m.missing_critical_sources_at_50).toBeNull();
  });
});
