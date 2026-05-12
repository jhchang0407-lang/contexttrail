import { describe, it, expect } from "vitest";
import { aggregateSourceCandidates } from "./sources.js";
import { computeOracleMetrics, computeLossDiagnostics } from "./oracle.js";
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

describe("computeOracleMetrics", () => {
  it("oracle source top-1@50 succeeds when expected is in top 50", () => {
    // Place expected at rank 20.
    const sources = aggregateSourceCandidates(
      Array.from({ length: 30 }, (_, i) => chunk(i + 1, `docs/${i + 1}.md`, 1 / (i + 1))),
    );
    const m = computeOracleMetrics({
      sources,
      expected_top_source: "docs/20.md",
      acceptable_top_sources: ["docs/20.md"],
      must_include_sources: ["docs/20.md"],
      is_critical: true,
    });
    expect(m.oracle_source_top1_at_50).toBe(true);
    expect(m.oracle_failure_reason).toBeNull();
  });

  it("oracle source top-1@50 fails when expected is missing entirely", () => {
    const sources = aggregateSourceCandidates([
      chunk(1, "docs/a.md", 0.9),
      chunk(2, "docs/b.md", 0.7),
    ]);
    const m = computeOracleMetrics({
      sources,
      expected_top_source: "docs/widgets.md",
      acceptable_top_sources: ["docs/widgets.md"],
      must_include_sources: ["docs/widgets.md"],
      is_critical: true,
    });
    expect(m.oracle_source_top1_at_50).toBe(false);
    expect(m.oracle_failure_reason).toBe("expected_source_absent");
  });

  it("oracle failure_reason marks misorder when source is present but ranked > 1", () => {
    const sources = aggregateSourceCandidates([
      chunk(1, "docs/a.md", 0.9),
      chunk(2, "docs/widgets.md", 0.7),
    ]);
    const m = computeOracleMetrics({
      sources,
      expected_top_source: "docs/widgets.md",
      acceptable_top_sources: ["docs/widgets.md"],
      must_include_sources: ["docs/widgets.md"],
      is_critical: true,
    });
    // Oracle CAN promote present-but-ranked-low sources to top-1, so success.
    expect(m.oracle_source_top1_at_50).toBe(true);
    // But the underlying current ranking is misordered.
    expect(m.oracle_failure_reason).toBeNull();
    expect(m.actual_top_source_acceptable).toBe(false);
  });

  it("oracle all-critical-source coverage requires every critical source in top-50", () => {
    const sources = aggregateSourceCandidates([
      chunk(1, "docs/a.md", 0.9),
      chunk(2, "docs/widgets.md", 0.7),
      chunk(3, "docs/quickstart.md", 0.5),
    ]);
    const m = computeOracleMetrics({
      sources,
      expected_top_source: "docs/widgets.md",
      acceptable_top_sources: ["docs/widgets.md"],
      must_include_sources: ["docs/widgets.md", "docs/quickstart.md"],
      is_critical: true,
    });
    expect(m.oracle_all_critical_sources_at_50).toBe(true);
    expect(m.oracle_answerable_success_at_50).toBe(true);
  });

  it("oracle answerable success fails when one critical source absent", () => {
    const sources = aggregateSourceCandidates([
      chunk(1, "docs/widgets.md", 0.9),
    ]);
    const m = computeOracleMetrics({
      sources,
      expected_top_source: "docs/widgets.md",
      acceptable_top_sources: ["docs/widgets.md"],
      must_include_sources: ["docs/widgets.md", "docs/missing.md"],
      is_critical: true,
    });
    expect(m.oracle_all_critical_sources_at_50).toBe(false);
    expect(m.oracle_answerable_success_at_50).toBe(false);
  });

  it("oracle metrics are null on non-critical cases", () => {
    const sources = aggregateSourceCandidates([chunk(1, "docs/a.md", 0.9)]);
    const m = computeOracleMetrics({
      sources,
      expected_top_source: "",
      acceptable_top_sources: [],
      must_include_sources: [],
      is_critical: false,
    });
    expect(m.oracle_source_top1_at_50).toBeNull();
    expect(m.oracle_all_critical_sources_at_50).toBeNull();
    expect(m.oracle_answerable_success_at_50).toBeNull();
  });
});

describe("computeLossDiagnostics", () => {
  it("computes post-threshold and post-pack source recall against critical set", () => {
    const candidates: Slice0ChunkCandidate[] = [
      chunk(1, "docs/widgets.md", 0.9, "w1"),
      chunk(2, "docs/quickstart.md", 0.5, "q1"),
      chunk(3, "docs/dropped.md", 0.04, "d1"),
    ];
    const sources = aggregateSourceCandidates(candidates);
    const loss = computeLossDiagnostics({
      sources,
      candidates,
      included_version_ids: ["w1"], // budget kept only widgets
      below_threshold_version_ids: ["d1"],
      budget_dropped_version_ids: ["q1"],
      must_include_sources: ["docs/widgets.md", "docs/quickstart.md"],
      is_critical: true,
    });
    expect(loss.post_threshold_critical_recall_at_50!.found).toBe(2);
    expect(loss.post_pack_critical_recall_at_50!.found).toBe(1);
    expect(loss.threshold_to_pack_loss).toEqual(["docs/quickstart.md"]);
    expect(loss.budget_loss_sources).toEqual(["docs/quickstart.md"]);
  });

  it("returns null loss diagnostics when not critical", () => {
    const candidates: Slice0ChunkCandidate[] = [chunk(1, "docs/a.md", 0.5, "a1")];
    const sources = aggregateSourceCandidates(candidates);
    const loss = computeLossDiagnostics({
      sources,
      candidates,
      included_version_ids: ["a1"],
      below_threshold_version_ids: [],
      budget_dropped_version_ids: [],
      must_include_sources: [],
      is_critical: false,
    });
    expect(loss.post_threshold_critical_recall_at_50).toBeNull();
    expect(loss.post_pack_critical_recall_at_50).toBeNull();
  });

  it("source-to-threshold loss lists critical sources whose only chunks fell below threshold", () => {
    const candidates: Slice0ChunkCandidate[] = [
      chunk(1, "docs/widgets.md", 0.9, "w1"),
      chunk(2, "docs/lost.md", 0.02, "l1"),
    ];
    const sources = aggregateSourceCandidates(candidates);
    const loss = computeLossDiagnostics({
      sources,
      candidates,
      included_version_ids: ["w1"],
      below_threshold_version_ids: ["l1"],
      budget_dropped_version_ids: [],
      must_include_sources: ["docs/widgets.md", "docs/lost.md"],
      is_critical: true,
    });
    expect(loss.source_to_threshold_loss).toEqual(["docs/lost.md"]);
  });
});
