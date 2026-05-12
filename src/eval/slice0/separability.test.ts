import { describe, it, expect } from "vitest";
import {
  computeSeparabilityFeatures,
  summarizeSeparability,
  SLICE0_UNAVAILABLE_FEATURES,
} from "./separability.js";
import type { Slice0ChunkCandidate } from "./candidates.js";

function chunk(
  rank: number,
  source: string,
  score: number,
  overrides: Partial<Slice0ChunkCandidate> = {},
): Slice0ChunkCandidate {
  return {
    rank,
    version_id: `${source}#${rank}`,
    source_path: source,
    heading_path: [],
    final_score: score,
    packing_score: score,
    bm25_norm: 0.4,
    heading_match: 0.1,
    scope_match: 0.0,
    mention_overlap: 0.0,
    specificity: 1,
    text_score: 0.4,
    token_count: 100,
    ...overrides,
  };
}

describe("computeSeparabilityFeatures", () => {
  it("computes available-today features for one case", () => {
    const candidates = [
      chunk(1, "docs/a.md", 0.6),
      chunk(2, "docs/b.md", 0.4),
      chunk(3, "docs/c.md", 0.3),
    ];
    const f = computeSeparabilityFeatures({
      candidates,
      coverage_confidence: "uncertain",
      query_mode: "unanchored",
      warning_kinds: ["anchors_unrecognized"],
      ranked_count: 3,
    });
    expect(f.available.coverage_confidence).toBe("uncertain");
    expect(f.available.query_mode).toBe("unanchored");
    expect(f.available.warning_kinds).toEqual(["anchors_unrecognized"]);
    expect(f.available.ranked_count).toBe(3);
    expect(f.available.top1_score).toBeCloseTo(0.6);
    expect(f.available.top1_top2_margin).toBeCloseTo(0.6 - 0.4);
    expect(f.available.top1_top3_margin).toBeCloseTo(0.6 - 0.3);
    expect(f.available.top1_features).toMatchObject({
      bm25_norm: 0.4,
      heading_match: 0.1,
      scope_match: 0,
      mention_overlap: 0,
      final_score: 0.6,
    });
  });

  it("handles empty candidate list (signal_empty unsupported)", () => {
    const f = computeSeparabilityFeatures({
      candidates: [],
      coverage_confidence: "empty",
      query_mode: "signal_empty",
      warning_kinds: ["no_matches"],
      ranked_count: 0,
    });
    expect(f.available.top1_score).toBe(0);
    expect(f.available.top1_top2_margin).toBe(0);
    expect(f.available.top1_top3_margin).toBe(0);
    expect(f.available.top1_features).toBeNull();
  });

  it("labels V2-only features as unavailable, not zero-filled", () => {
    const f = computeSeparabilityFeatures({
      candidates: [chunk(1, "docs/a.md", 0.6)],
      coverage_confidence: "confident",
      query_mode: "anchored",
      warning_kinds: [],
      ranked_count: 1,
    });
    for (const name of SLICE0_UNAVAILABLE_FEATURES) {
      expect(f.unavailable[name]).toBe("unavailable_in_slice_0");
    }
  });
});

describe("summarizeSeparability", () => {
  it("compares supported vs unsupported distributions", () => {
    const supported = [
      computeSeparabilityFeatures({
        candidates: [chunk(1, "docs/a.md", 0.7), chunk(2, "docs/b.md", 0.3)],
        coverage_confidence: "confident",
        query_mode: "unanchored",
        warning_kinds: [],
        ranked_count: 2,
      }),
      computeSeparabilityFeatures({
        candidates: [chunk(1, "docs/x.md", 0.65), chunk(2, "docs/y.md", 0.35)],
        coverage_confidence: "confident",
        query_mode: "unanchored",
        warning_kinds: [],
        ranked_count: 2,
      }),
    ];
    const unsupported = [
      computeSeparabilityFeatures({
        candidates: [chunk(1, "docs/n.md", 0.2)],
        coverage_confidence: "uncertain",
        query_mode: "unanchored",
        warning_kinds: [],
        ranked_count: 1,
      }),
      computeSeparabilityFeatures({
        candidates: [],
        coverage_confidence: "empty",
        query_mode: "signal_empty",
        warning_kinds: ["no_matches"],
        ranked_count: 0,
      }),
    ];

    const summary = summarizeSeparability({ supported, unsupported });
    expect(summary.supported.cases).toBe(2);
    expect(summary.unsupported.cases).toBe(2);
    // Supported avg top-1 should be clearly higher.
    expect(summary.supported.avg_top1_score).toBeGreaterThan(summary.unsupported.avg_top1_score);
    // Coverage confidence distribution.
    expect(summary.supported.coverage_confidence.confident).toBe(2);
    expect(summary.unsupported.coverage_confidence.empty).toBe(1);
    expect(summary.unsupported.coverage_confidence.uncertain).toBe(1);
    // False-confident unsupported = unsupported cases reporting confident.
    expect(summary.false_confident_unsupported).toBe(0);
  });

  it("flags false-confident unsupported cases", () => {
    const unsupported = [
      computeSeparabilityFeatures({
        candidates: [chunk(1, "docs/n.md", 0.8)],
        coverage_confidence: "confident",
        query_mode: "unanchored",
        warning_kinds: [],
        ranked_count: 1,
      }),
    ];
    const summary = summarizeSeparability({ supported: [], unsupported });
    expect(summary.false_confident_unsupported).toBe(1);
  });

  it("classifies separability as sufficient/weak/inconclusive", () => {
    // Sufficient: clear gap in top-1 score and confidence distribution.
    const sufficient = summarizeSeparability({
      supported: Array.from({ length: 5 }, () =>
        computeSeparabilityFeatures({
          candidates: [chunk(1, "docs/s.md", 0.8), chunk(2, "docs/x.md", 0.3)],
          coverage_confidence: "confident",
          query_mode: "unanchored",
          warning_kinds: [],
          ranked_count: 2,
        }),
      ),
      unsupported: Array.from({ length: 5 }, () =>
        computeSeparabilityFeatures({
          candidates: [chunk(1, "docs/n.md", 0.1)],
          coverage_confidence: "empty",
          query_mode: "signal_empty",
          warning_kinds: ["no_matches"],
          ranked_count: 1,
        }),
      ),
    });
    expect(sufficient.classification).toBe("sufficient");

    // Inconclusive: empty input.
    const inconclusive = summarizeSeparability({ supported: [], unsupported: [] });
    expect(inconclusive.classification).toBe("inconclusive");
  });
});
