import { describe, it, expect } from "vitest";
import { renderText, renderJson } from "./render.js";
import type { DocChunk } from "../types/chunk.js";
import type { PackResult } from "./pack.js";

const chunk = (overrides: Partial<DocChunk>): DocChunk => ({
  stable_key: "sk",
  version_id: "v",
  source_path: "docs/x.md",
  doc_id: "d",
  heading_path: ["A", "B"],
  heading_level: 2,
  chunk_index: 1,
  chunk_count: 1,
  title: "B",
  body: "body content",
  token_count: 10,
  chunk_content_hash: "ch",
  source_content_hash: "src",
  start_line: 1,
  end_line: 4,
  status: "current",
  indexed_at: "2026-05-06T00:00:00Z",
  scope: { layer: "project", source: {} },
  ...overrides,
});

describe("render — text output with contexttrail context-header (D30)", () => {
  it("prepends drift 'Source: ... > Section: ... > Part: i/n' to each chunk body", () => {
    const c1 = chunk({ version_id: "v1", body: "alpha", chunk_index: 1, chunk_count: 2 });
    const c2 = chunk({ version_id: "v2", body: "beta", chunk_index: 2, chunk_count: 2 });
    const out = renderText({
      query: "x",
      result: makePackResult([c1, c2], []),
      chunksByVersionId: byId([c1, c2]),
    });
    expect(out).toMatch(/Source: docs\/x\.md/);
    expect(out).toMatch(/Section: A > B/);
    expect(out).toMatch(/Part: 1\/2/);
    expect(out).toMatch(/Part: 2\/2/);
    expect(out).toMatch(/alpha/);
    expect(out).toMatch(/beta/);
  });

  it("summarizes omitted candidates by default", () => {
    const incl = chunk({ version_id: "i", body: "in" });
    const om = chunk({ version_id: "o", body: "out" });
    const out = renderText({
      query: "x",
      result: makePackResult([incl], [om]),
      chunksByVersionId: byId([incl, om]),
    });
    expect(out).toMatch(/Relevant docs/);
    expect(out).toMatch(/Omitted/);
    expect(out).toMatch(/1 candidates omitted/);
    expect(out).not.toMatch(/docs\/x\.md :: A > B/);
  });

  it("shows omitted candidate details in explain mode", () => {
    const incl = chunk({ version_id: "i", body: "in" });
    const om = chunk({ version_id: "o", body: "out" });
    const out = renderText({
      query: "x",
      result: makePackResult([incl], [om]),
      chunksByVersionId: byId([incl, om]),
      explain: true,
    });
    expect(out).toMatch(/docs\/x\.md :: A > B/);
  });

  it("uses the actual retrieval mode when generating warning text", () => {
    const out = renderText({
      query: "x",
      result: makePackResult([], []),
      chunksByVersionId: byId([]),
      query_mode: "signal_empty",
      query_compilation: {
        query_mode: "signal_empty",
        provided_anchor_count: 1,
        recognized_anchor_count: 0,
        anchors: [],
      },
      has_sources: true,
    });
    expect(out).toMatch(/anchors_unrecognized/);
    expect(out).not.toMatch(/no_sources/);
  });
});

describe("render — JSON output (week-4 MCP contract)", () => {
  it("emits stable schema: { query, included[], omitted[], total_tokens, budget_tokens }", () => {
    const c = chunk({ version_id: "v1" });
    const json = renderJson({
      query: "make refunds idempotent",
      result: makePackResult([c], []),
      chunksByVersionId: byId([c]),
    });
    expect(json.query).toBe("make refunds idempotent");
    expect(Array.isArray(json.included)).toBe(true);
    expect(json.included[0]!.version_id).toBe("v1");
    expect(json.included[0]!.heading_path).toEqual(["A", "B"]);
    expect(json.included[0]!.body).toBe("body content");
    expect(json.included[0]!.source_path).toBe("docs/x.md");
    expect(json.total_tokens).toBe(10);
    expect(json.budget_tokens).toBe(6000);
    expect(Array.isArray(json.omitted)).toBe(true);
  });
});

// helpers
function byId(cs: DocChunk[]) {
  const m = new Map<string, DocChunk>();
  for (const c of cs) m.set(c.version_id, c);
  return m;
}
function makePackResult(included: DocChunk[], omitted: DocChunk[]): PackResult {
  const used = included.reduce((s, c) => s + c.token_count, 0);
  return {
    locked: [],
    included: included.map((c) => ({
      version_id: c.version_id,
      bm25_norm: 1,
      heading_match: 0,
      scope_match: 0,
      mention_overlap: 0,
      specificity: 1,
      text_score: 0.7,
      final_score: 0.7,
      token_count: c.token_count,
      packing_score: 0.07,
      kind: "doc_chunk" as const,
    })),
    omitted: omitted.map((c) => ({
      version_id: c.version_id,
      bm25_norm: 0,
      heading_match: 0,
      scope_match: 0,
      mention_overlap: 0,
      specificity: 1,
      text_score: 0,
      final_score: 0,
      token_count: c.token_count,
      packing_score: 0,
      reason: "test",
      omitted_reason: "below_threshold" as const,
      kind: "doc_chunk" as const,
    })),
    warnings: [],
    total_tokens: used,
    budget_tokens: 6000,
    safety_net_engaged: false,
    budget: { requested: 6000, used, locked_overhead: 0 },
  };
}
