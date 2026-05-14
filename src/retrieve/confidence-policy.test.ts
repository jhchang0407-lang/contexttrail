import { describe, it, expect } from "vitest";
import { decideCoverageConfidence } from "./confidence-policy.js";

describe("decideCoverageConfidence — shared policy (THO-120)", () => {
  it("locked entries surface as confident regardless of ranked scores", () => {
    const d = decideCoverageConfidence({
      query_mode: "unanchored",
      has_locked: true,
      ranked_scores: [],
      warning_kinds: [],
      safety_net_engaged: false,
    });
    expect(d.coverage_confidence).toBe("confident");
    expect(d.reason).toBe("locked_entries_present");
  });

  it("no ranked output and no locked is empty", () => {
    const d = decideCoverageConfidence({
      query_mode: "unanchored",
      has_locked: false,
      ranked_scores: [],
      warning_kinds: [],
      safety_net_engaged: false,
    });
    expect(d.coverage_confidence).toBe("empty");
    expect(d.reason).toBe("ranked_empty");
  });

  it("strong unanchored top score with no warnings is confident", () => {
    const d = decideCoverageConfidence({
      query_mode: "unanchored",
      has_locked: false,
      ranked_scores: [1.2, 0.4],
      warning_kinds: [],
      safety_net_engaged: false,
    });
    expect(d.coverage_confidence).toBe("confident");
  });

  it("caps a would-be confident result at uncertain when the code lane triggered but no code survived", () => {
    const d = decideCoverageConfidence({
      query_mode: "anchored",
      has_locked: false,
      ranked_scores: [1.1, 0.2],
      warning_kinds: [],
      safety_net_engaged: false,
      code_lane: {
        triggered: true,
        used: 0,
      },
    });
    expect(d.coverage_confidence).toBe("uncertain");
    expect(d.reason).toBe("code_lane_triggered_without_surviving_code");
  });

  it("weak top score above empty floor is uncertain", () => {
    const d = decideCoverageConfidence({
      query_mode: "unanchored",
      has_locked: false,
      ranked_scores: [0.2],
      warning_kinds: [],
      safety_net_engaged: false,
    });
    expect(d.coverage_confidence).toBe("uncertain");
  });

  it("near-zero top score collapses to empty", () => {
    const d = decideCoverageConfidence({
      query_mode: "unanchored",
      has_locked: false,
      ranked_scores: [0.01],
      warning_kinds: [],
      safety_net_engaged: false,
    });
    expect(d.coverage_confidence).toBe("empty");
  });

  it("low_confidence warning caps a confident-by-score case at uncertain (THO-121)", () => {
    const d = decideCoverageConfidence({
      query_mode: "unanchored",
      has_locked: false,
      ranked_scores: [0.84],
      warning_kinds: ["low_confidence"],
      safety_net_engaged: false,
    });
    expect(d.coverage_confidence).toBe("uncertain");
    expect(d.reason).toBe("low_confidence_warning");
  });

  it("locked entries still beat low_confidence (THO-121)", () => {
    const d = decideCoverageConfidence({
      query_mode: "unanchored",
      has_locked: true,
      ranked_scores: [0.1],
      warning_kinds: ["low_confidence"],
      safety_net_engaged: false,
    });
    expect(d.coverage_confidence).toBe("confident");
  });

  it("safety-net forces empty even when warnings include low_confidence (THO-121)", () => {
    const d = decideCoverageConfidence({
      query_mode: "unanchored",
      has_locked: false,
      ranked_scores: [],
      warning_kinds: ["no_matches", "low_confidence"],
      safety_net_engaged: true,
    });
    expect(d.coverage_confidence).toBe("empty");
  });

  it("no_matches warning with empty ranked stays empty, not uncertain (THO-121)", () => {
    const d = decideCoverageConfidence({
      query_mode: "unanchored",
      has_locked: false,
      ranked_scores: [],
      warning_kinds: ["no_matches"],
      safety_net_engaged: false,
    });
    expect(d.coverage_confidence).toBe("empty");
  });

  it("signal_empty query mode caps a high-scoring case at uncertain (THO-122)", () => {
    const d = decideCoverageConfidence({
      query_mode: "signal_empty",
      has_locked: false,
      ranked_scores: [0.84],
      warning_kinds: ["anchors_unrecognized"],
      safety_net_engaged: false,
    });
    expect(d.coverage_confidence).toBe("uncertain");
    expect(d.reason).toBe("signal_empty_query_mode");
  });

  it("signal_empty with empty ranked is still empty, not uncertain (THO-122)", () => {
    const d = decideCoverageConfidence({
      query_mode: "signal_empty",
      has_locked: false,
      ranked_scores: [],
      warning_kinds: ["anchors_unrecognized", "no_matches"],
      safety_net_engaged: false,
    });
    expect(d.coverage_confidence).toBe("empty");
  });

  it("near-zero top1-top2 margin caps unanchored result at uncertain even with high top score (THO-122)", () => {
    // Mirrors the bun-signal-empty-cobol-interop pattern: top1 0.85, top2 0.845.
    const d = decideCoverageConfidence({
      query_mode: "unanchored",
      has_locked: false,
      ranked_scores: [0.95, 0.945, 0.940],
      warning_kinds: [],
      safety_net_engaged: false,
    });
    expect(d.coverage_confidence).toBe("uncertain");
    expect(d.reason).toBe("narrow_top_score_margin");
  });

  it("unanchored ranked-only output below the stronger confident floor is uncertain (THO-124)", () => {
    // Mirrors the final residual false-confident unsupported pattern: strong
    // margin and no low-confidence warning, but not enough absolute evidence
    // for an unanchored query.
    const d = decideCoverageConfidence({
      query_mode: "unanchored",
      has_locked: false,
      ranked_scores: [0.93, 0.66, 0.54],
      warning_kinds: [],
      safety_net_engaged: false,
    });
    expect(d.coverage_confidence).toBe("uncertain");
    expect(d.reason).toBe("unanchored_score_below_confident_floor");
  });

  it("anchored retrieval with strong score remains confident even when margin is narrow (THO-122)", () => {
    // Anchored mode trusts user-provided file/symbol/route anchors; narrow
    // margins between adjacent display items shouldn't downgrade a strongly
    // supported answer.
    const d = decideCoverageConfidence({
      query_mode: "anchored",
      has_locked: false,
      ranked_scores: [1.63, 1.62, 1.5],
      warning_kinds: [],
      safety_net_engaged: false,
    });
    expect(d.coverage_confidence).toBe("confident");
  });

  it("unanchored with strong top score and meaningful margin remains confident (THO-122)", () => {
    const d = decideCoverageConfidence({
      query_mode: "unanchored",
      has_locked: false,
      ranked_scores: [1.2, 0.6, 0.3],
      warning_kinds: [],
      safety_net_engaged: false,
    });
    expect(d.coverage_confidence).toBe("confident");
  });

  it("coverage=unsupported caps a high-score unanchored case at uncertain (THO-139)", () => {
    // Mirrors the named holdout false-confident unsupported pattern: high
    // score, decent margin, no warning, but the top source is not actually
    // about the query (Hono gRPC, Turborepo db-migration, Zod runtime/cli/react).
    const d = decideCoverageConfidence({
      query_mode: "unanchored",
      has_locked: false,
      ranked_scores: [1.04, 0.81, 0.66],
      warning_kinds: [],
      safety_net_engaged: false,
      top_coverage_decision: "unsupported",
    });
    expect(d.coverage_confidence).toBe("uncertain");
    expect(d.reason).toBe("coverage_unsupported");
  });

  it("coverage=partial caps confidence at uncertain (THO-139)", () => {
    const d = decideCoverageConfidence({
      query_mode: "unanchored",
      has_locked: false,
      ranked_scores: [1.2, 0.6, 0.3],
      warning_kinds: [],
      safety_net_engaged: false,
      top_coverage_decision: "partial",
    });
    expect(d.coverage_confidence).toBe("uncertain");
    expect(d.reason).toBe("coverage_partial");
  });

  it("coverage=needs_anchors caps confidence at uncertain (THO-139)", () => {
    const d = decideCoverageConfidence({
      query_mode: "anchored",
      has_locked: false,
      ranked_scores: [1.5, 0.9],
      warning_kinds: [],
      safety_net_engaged: false,
      top_coverage_decision: "needs_anchors",
    });
    expect(d.coverage_confidence).toBe("uncertain");
    expect(d.reason).toBe("coverage_needs_anchors");
  });

  it("coverage=covers preserves the existing confident classification (THO-139)", () => {
    const d = decideCoverageConfidence({
      query_mode: "unanchored",
      has_locked: false,
      ranked_scores: [1.2, 0.6, 0.3],
      warning_kinds: [],
      safety_net_engaged: false,
      top_coverage_decision: "covers",
    });
    expect(d.coverage_confidence).toBe("confident");
  });

  it("locked entries beat coverage=unsupported (locked Cards keep semantics, THO-139)", () => {
    const d = decideCoverageConfidence({
      query_mode: "unanchored",
      has_locked: true,
      ranked_scores: [0.1],
      warning_kinds: [],
      safety_net_engaged: false,
      top_coverage_decision: "unsupported",
    });
    expect(d.coverage_confidence).toBe("confident");
    expect(d.reason).toBe("locked_entries_present");
  });

  it("returns a deterministic reason string for every classification", () => {
    const cases = [
      { has_locked: true, ranked_scores: [], expect: /locked/ },
      { has_locked: false, ranked_scores: [], expect: /empty/ },
      { has_locked: false, ranked_scores: [0.6], expect: /confident|score/ },
      { has_locked: false, ranked_scores: [0.2], expect: /uncertain|weak|score/ },
    ];
    for (const c of cases) {
      const d = decideCoverageConfidence({
        query_mode: "unanchored",
        has_locked: c.has_locked,
        ranked_scores: c.ranked_scores,
        warning_kinds: [],
        safety_net_engaged: false,
      });
      expect(d.reason).toMatch(c.expect);
    }
  });
});
