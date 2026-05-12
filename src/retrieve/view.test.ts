import { describe, expect, it } from "vitest";
import { buildRetrievalView } from "./view.js";
import type { RetrievalResult } from "./retrieve.js";
import type { DocChunk } from "../types/chunk.js";
import type { Card } from "../types/card.js";

function emptyResult(): RetrievalResult {
  return {
    request: {
      task: "refund question",
      query_anchors: {
        files: ["docs/refunds.md"],
        symbols: ["Billing.Refund"],
        routes: ["/refunds"],
      },
      budget: "default",
      expected_locked: ["C001"],
      explain: true,
    },
    pack: {
      locked: [],
      included: [],
      omitted: [],
      warnings: [],
      total_tokens: 0,
      budget_tokens: 6000,
      safety_net_engaged: false,
      budget: { requested: 6000, used: 0, locked_overhead: 0 },
    },
    chunksByVersionId: new Map<string, DocChunk>(),
    cardsByCardId: new Map<string, Card>(),
    query_scopes: [],
    query_mode: "unanchored",
    query_compilation: {
      query_mode: "unanchored",
      provided_anchor_count: 3,
      recognized_anchor_count: 2,
      anchors: [],
    },
    lock_failures: [
      {
        card_id: "C001",
        card_type: "constraint",
        candidate_match_path: "scope mismatch",
        failed_reason: "scope_not_equal_or_ancestor",
        detail: "expected card did not match the anchored scope",
      },
    ],
    candidate_count: 0,
    eligible_count: 0,
  };
}

describe("retrieval view", () => {
  it("keeps richer internal retrieval state than the MCP wire surface", () => {
    const result = emptyResult();
    const chunk: DocChunk = {
      version_id: "v1",
      stable_key: "chunk-1",
      source_path: "docs/refunds.md",
      doc_id: "doc-1",
      heading_path: ["Refunds"],
      heading_level: 1,
      chunk_index: 1,
      chunk_count: 1,
      title: "Refunds",
      body: "Refunds must never exceed the captured amount.",
      token_count: 8,
      chunk_content_hash: "hash-1",
      source_content_hash: "source-hash-1",
      start_line: 1,
      end_line: 2,
      status: "current",
      indexed_at: "2026-05-07T00:00:00.000Z",
      scope: { layer: "project", source: {}, project: "contexttrail" },
    };
    result.chunksByVersionId.set("v1", chunk);
    result.pack.included = [
      {
        version_id: "v1",
        bm25_norm: 0.8,
        heading_match: 0.2,
        scope_match: 0.6,
        mention_overlap: 0.1,
        specificity: 1.4,
        text_score: 0.7,
        final_score: 0.9,
        token_count: 8,
        packing_score: 0.3,
        kind: "doc_chunk",
      },
    ];
    result.pack.omitted = [
      {
        version_id: "v2",
        bm25_norm: 0.1,
        heading_match: 0,
        scope_match: 0,
        mention_overlap: 0,
        specificity: 1,
        text_score: 0.1,
        final_score: 0.1,
        token_count: 5,
        packing_score: 0.02,
        reason: "did not fit budget",
        omitted_reason: "budget",
        kind: "doc_chunk",
      },
    ];
    result.pack.budget = { requested: 6000, used: 8, locked_overhead: 0 };

    const view = buildRetrievalView({
      query: "refund question",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: true,
    });

    expect(view.request).toEqual(result.request);
    expect(view.query_mode).toBe("unanchored");
    expect(view.ranked_full).toHaveLength(1);
    expect(view.omitted_full).toHaveLength(1);
    expect(view.lock_failures).toEqual(result.lock_failures);
    expect(view.budget).toEqual({
      requested: 6000,
      used: 8,
      locked_overhead: 0,
      headroom: 5992,
    });
    expect(view.warnings_full.map((warning) => warning.kind)).not.toContain("no_sources");
  });
});
