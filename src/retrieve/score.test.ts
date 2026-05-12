import { describe, it, expect } from "vitest";
import {
  headingMatchScore,
  mentionOverlapScore,
  scoreChunk,
  specificityWeight,
  type ScoringWeights,
} from "./score.js";
import type { DocChunk, CodeAnchor } from "../types/chunk.js";

const W: ScoringWeights = {
  w_bm25: 0.7,
  w_heading: 0.3,
  w_scope: 0.7,
  w_mentions: 0.8,
  card_type_bias: 1.2,
  specificity_weight: {
    module: 1.4,
    project: 1.2,
    decision: 1.1,
    team: 1.0,
    company: 0.9,
    unknown: 1.0,
  },
};

const baseChunk = (overrides: Partial<DocChunk> = {}): DocChunk => ({
  stable_key: "sk",
  version_id: "v",
  source_path: "docs/x.md",
  doc_id: "d",
  heading_path: ["Refunds"],
  heading_level: 1,
  chunk_index: 1,
  chunk_count: 1,
  title: "Refunds",
  body: "refund body",
  token_count: 100,
  chunk_content_hash: "ch",
  source_content_hash: "src",
  start_line: 1,
  end_line: 1,
  status: "current",
  indexed_at: "now",
  scope: { layer: "project", project: "payments", source: {} },
  ...overrides,
});

describe("score combiner — D34 formula", () => {
  it("text_score is additive over BM25 + heading; final_score multiplies structural boosts", () => {
    const chunk = baseChunk();
    const trace = scoreChunk({
      chunk,
      anchors: [],
      bm25_norm: 1.0,
      query: "refund",
      query_scopes: [{ project: "payments" }],
      query_anchors: {},
      weights: W,
    });
    // text = 0.7*1 + 0.3*headingMatch ≥ 0.7
    expect(trace.text_score).toBeGreaterThanOrEqual(0.7);
    // scope_match = 0.6 (project), structural multiplier = (1+0.7*0.6) * (1+0) * 1.2
    expect(trace.scope_match).toBeCloseTo(0.6);
    expect(trace.specificity).toBe(1.2);
    // final = text * (1 + 0.7*0.6) * (1 + 0) * 1.2
    const expected = trace.text_score * (1 + 0.7 * 0.6) * 1.0 * 1.2;
    expect(trace.final_score).toBeCloseTo(expected);
  });

  it("zero w_heading kills heading contribution; ranking changes accordingly", () => {
    const chunk = baseChunk();
    const a = scoreChunk({
      chunk,
      anchors: [],
      bm25_norm: 0,
      query: "refund refund",
      query_scopes: [],
      query_anchors: {},
      weights: W,
    });
    const b = scoreChunk({
      chunk,
      anchors: [],
      bm25_norm: 0,
      query: "refund refund",
      query_scopes: [],
      query_anchors: {},
      weights: { ...W, w_heading: 0 },
    });
    expect(a.text_score).toBeGreaterThan(0);
    expect(b.text_score).toBe(0);
  });

  it("ADR-0007 vocabulary mismatch rescue: low BM25 + strong heading match still scores", () => {
    const chunk = baseChunk({
      heading_path: ["Refunds", "Idempotency"],
      title: "Idempotency",
    });
    const trace = scoreChunk({
      chunk,
      anchors: [],
      bm25_norm: 0.05, // weak text overlap (different vocab)
      query: "refund idempotency",
      query_scopes: [],
      query_anchors: {},
      weights: W,
    });
    expect(trace.heading_match).toBeGreaterThan(0);
    expect(trace.text_score).toBeGreaterThan(0.05); // heading rescues
  });

  it("ADR-0007 wrong-scope penalty: right-scope chunk with weaker BM25 beats wrong-scope with stronger BM25", () => {
    const right = baseChunk({
      version_id: "right",
      scope: { layer: "module", project: "payments", module: "refunds", source: {} },
    });
    const wrong = baseChunk({
      version_id: "wrong",
      scope: { layer: "module", project: "billing", module: "invoices", source: {} },
    });
    const queryScopes = [{ project: "payments", module: "refunds" }];
    const r = scoreChunk({
      chunk: right,
      anchors: [],
      bm25_norm: 0.6,
      query: "x",
      query_scopes: queryScopes,
      query_anchors: {},
      weights: W,
    });
    const w = scoreChunk({
      chunk: wrong,
      anchors: [],
      bm25_norm: 0.9, // stronger text but wrong scope (gap within scope-multiplier rescue range per ADR-0007)
      query: "x",
      query_scopes: queryScopes,
      query_anchors: {},
      weights: W,
    });
    expect(r.final_score).toBeGreaterThan(w.final_score);
  });

  describe("component independence — zeroing each weight changes ranking in expected direction", () => {
    // A chunk that has every signal "on" so each weight has something to gate.
    const richChunk = baseChunk({
      heading_path: ["Refunds", "Idempotency"],
      title: "Idempotency",
      scope: { layer: "module", project: "payments", module: "refunds", source: {} },
    });
    const richInputs = {
      chunk: richChunk,
      anchors: [
        {
          chunk_version_id: "v",
          kind: "symbol" as const,
          value: "RefundService.processRefund",
          confidence: "high" as const,
          source: "manual" as const,
        },
      ],
      bm25_norm: 0.6,
      query: "refund idempotency",
      query_scopes: [{ project: "payments", module: "refunds" }],
      query_anchors: { symbols: ["RefundService.processRefund"] },
    };

    const baseline = scoreChunk({ ...richInputs, weights: W });

    it.each([
      ["w_bm25", "bm25_norm contribution to text_score"],
      ["w_heading", "heading_match contribution to text_score"],
      ["w_scope", "scope_match multiplier"],
      ["w_mentions", "mention_overlap multiplier"],
    ] as const)("zeroing %s reduces final_score (kills %s)", (weight) => {
      const zeroed = scoreChunk({
        ...richInputs,
        weights: { ...W, [weight]: 0 },
      });
      expect(zeroed.final_score).toBeLessThan(baseline.final_score);
    });
  });

  it("missing query anchors → mention_overlap is 0 (neutral)", () => {
    const chunk = baseChunk();
    const trace = scoreChunk({
      chunk,
      anchors: [{ chunk_version_id: "v", kind: "file", value: "x.ts", confidence: "high", source: "manual" }],
      bm25_norm: 1,
      query: "refund",
      query_scopes: [],
      query_anchors: {},
      weights: W,
    });
    expect(trace.mention_overlap).toBe(0);
    // Multiplier (1 + 0.8*0) = 1 → no boost
    expect(trace.final_score).toBeCloseTo(trace.text_score * 1 * 1 * 1.2);
  });

  it("applies doc_role demotion by query mode", () => {
    const canonical = scoreChunk({
      chunk: baseChunk({ doc_role: "canonical", role_source: "default" }),
      anchors: [],
      bm25_norm: 1,
      query: "refund",
      query_scopes: [],
      query_anchors: {},
      query_mode: "anchored",
      weights: W,
    });
    const ideation = scoreChunk({
      chunk: baseChunk({ doc_role: "ideation", role_source: "config_pattern" }),
      anchors: [],
      bm25_norm: 1,
      query: "refund",
      query_scopes: [],
      query_anchors: {},
      query_mode: "anchored",
      weights: W,
    });
    const exampleUnanchored = scoreChunk({
      chunk: baseChunk({ doc_role: "example", role_source: "frontmatter" }),
      anchors: [],
      bm25_norm: 1,
      query: "refund",
      query_scopes: [],
      query_anchors: {},
      query_mode: "unanchored",
      weights: W,
    });
    const archiveUnanchored = scoreChunk({
      chunk: baseChunk({ doc_role: "archive", role_source: "config_pattern" }),
      anchors: [],
      bm25_norm: 1,
      query: "refund",
      query_scopes: [],
      query_anchors: {},
      query_mode: "unanchored",
      weights: W,
    });

    expect(canonical.role_multiplier).toBe(1);
    expect(ideation.role_multiplier).toBe(0.5);
    expect(ideation.final_score).toBeCloseTo(canonical.final_score * 0.5);
    expect(exampleUnanchored.role_multiplier).toBe(1);
    expect(archiveUnanchored.role_multiplier).toBe(0.3);
  });

  it("demotes anchored lexical matches with no structural support", () => {
    const lexicalOnly = scoreChunk({
      chunk: baseChunk({
        version_id: "lexical-only",
        scope: { layer: "module", project: "contexttrail", module: "architecture", source: {} },
      }),
      anchors: [],
      bm25_norm: 1,
      query: "refund idempotency",
      query_scopes: [{ project: "payments", module: "refunds" }],
      query_anchors: { files: ["src/payments/refund.ts"] },
      query_mode: "anchored",
      weights: W,
    });
    const unanchored = scoreChunk({
      chunk: baseChunk({
        version_id: "unanchored",
        scope: { layer: "module", project: "contexttrail", module: "architecture", source: {} },
      }),
      anchors: [],
      bm25_norm: 1,
      query: "refund idempotency",
      query_scopes: [],
      query_anchors: {},
      query_mode: "unanchored",
      weights: W,
    });

    expect(lexicalOnly.scope_match).toBe(0);
    expect(lexicalOnly.mention_overlap).toBe(0);
    expect(lexicalOnly.structural_multiplier).toBe(0.1);
    expect(unanchored.structural_multiplier).toBe(1);
    expect(lexicalOnly.final_score).toBeCloseTo(unanchored.final_score * 0.1);
  });

  it("demotes anchored mention-only matches when scope does not agree", () => {
    const mentionOnly = scoreChunk({
      chunk: baseChunk({
        version_id: "mention-only",
        scope: { layer: "module", project: "contexttrail", module: "architecture", source: {} },
      }),
      anchors: [
        {
          chunk_version_id: "mention-only",
          kind: "symbol",
          value: "RefundService.processRefund",
          confidence: "high",
          source: "mention_extraction",
        },
      ],
      bm25_norm: 1,
      query: "refund idempotency",
      query_scopes: [{ project: "payments", module: "refunds" }],
      query_anchors: { symbols: ["RefundService.processRefund"] },
      query_mode: "anchored",
      weights: W,
    });

    expect(mentionOnly.scope_match).toBe(0);
    expect(mentionOnly.mention_overlap).toBe(1);
    expect(mentionOnly.structural_multiplier).toBe(0.15);
  });
});

describe("specificity weight lookup", () => {
  const table = {
    module: 1.4,
    project: 1.2,
    decision: 1.1,
    team: 1.0,
    company: 0.9,
    unknown: 1.0,
  };

  it("returns the configured weight for the layer", () => {
    expect(specificityWeight("module", table)).toBe(1.4);
    expect(specificityWeight("project", table)).toBe(1.2);
    expect(specificityWeight("decision", table)).toBe(1.1);
    expect(specificityWeight("company", table)).toBe(0.9);
  });

  it("falls back to unknown weight for missing layers", () => {
    expect(specificityWeight("unknown", table)).toBe(1.0);
  });
});

describe("heading-match — Jaccard of stemmed task tokens vs joined heading_path", () => {
  it("perfect overlap → 1.0", () => {
    const score = headingMatchScore("refunds", ["Refunds"]);
    expect(score).toBeCloseTo(1.0);
  });

  it("partial overlap is between 0 and 1", () => {
    const score = headingMatchScore("refund idempotency rules", ["Refunds"]);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("no overlap → 0", () => {
    expect(headingMatchScore("authentication", ["Refunds", "Edge Cases"])).toBe(0);
  });

  it("empty query → 0 (neutral, not a free boost)", () => {
    expect(headingMatchScore("", ["Refunds"])).toBe(0);
  });

  it("stemming: 'refunds' matches 'refund'", () => {
    expect(headingMatchScore("refunds", ["Refund"])).toBeGreaterThan(0);
    expect(headingMatchScore("refund", ["Refunds"])).toBeGreaterThan(0);
  });

  it("ignores case and joins heading path", () => {
    const score = headingMatchScore("partial refund edge", [
      "Payments",
      "Refunds",
      "Partial Refunds",
      "Edge Cases",
    ]);
    expect(score).toBeGreaterThan(0.4);
  });
});

describe("mention-overlap — matched_query_anchors / query_anchors", () => {
  const anchor = (kind: CodeAnchor["kind"], value: string): CodeAnchor => ({
    chunk_version_id: "x",
    kind,
    value,
    confidence: "high",
    source: "mention_extraction",
  });

  it("all query anchors found → 1.0", () => {
    const chunkAnchors = [
      anchor("file", "src/payments/refund.ts"),
      anchor("symbol", "RefundService.processRefund"),
    ];
    const score = mentionOverlapScore(
      {
        files: ["src/payments/refund.ts"],
        symbols: ["RefundService.processRefund"],
      },
      chunkAnchors,
    );
    expect(score).toBe(1.0);
  });

  it("half found → 0.5", () => {
    const chunkAnchors = [anchor("file", "src/payments/refund.ts")];
    const score = mentionOverlapScore(
      {
        files: ["src/payments/refund.ts"],
        symbols: ["RefundService.processRefund"],
      },
      chunkAnchors,
    );
    expect(score).toBeCloseTo(0.5);
  });

  it("none found → 0", () => {
    const score = mentionOverlapScore(
      { files: ["src/x.ts"] },
      [anchor("file", "src/y.ts")],
    );
    expect(score).toBe(0);
  });

  it("no query anchors → 0 (neutral, not 1; D34 lock)", () => {
    expect(mentionOverlapScore({}, [anchor("file", "src/y.ts")])).toBe(0);
  });
});
