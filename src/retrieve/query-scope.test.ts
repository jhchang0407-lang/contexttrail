import { describe, it, expect } from "vitest";
import { compileQueryScopes, inferQueryScopes, makeInMemoryAnchorLookup } from "./query-scope.js";
import { ConfigSchema } from "../config/defaults.js";
import type { Card } from "../types/card.js";
import type { CodeAnchor, DocChunk } from "../types/chunk.js";

const cfg = ConfigSchema.parse({
  code_scopes: [
    {
      id: "src-tree",
      pattern: "src/**",
      scope: { layer: "module", module_from_path_after: "src" },
    },
  ],
});

const emptyCfg = ConfigSchema.parse({ code_scopes: [] });

describe("query scope inference from --files", () => {
  it("single file → single scope keyed by module", () => {
    const scopes = inferQueryScopes(["src/payments/refund.ts"], cfg);
    expect(scopes).toHaveLength(1);
    expect(scopes[0]!.module).toBe("payments");
  });

  it("multi-file in different modules → multi-scope (OR semantics)", () => {
    const scopes = inferQueryScopes(
      ["src/payments/refund.ts", "src/billing/invoice.ts"],
      cfg,
    );
    expect(scopes).toHaveLength(2);
    const mods = scopes.map((s) => s.module).sort();
    expect(mods).toEqual(["billing", "payments"]);
  });

  it("no --files → empty (neutral)", () => {
    expect(inferQueryScopes([], cfg)).toEqual([]);
  });

  it("file outside known scope rules → no inferred scope (skipped)", () => {
    const scopes = inferQueryScopes(["random/x.ts"], cfg);
    expect(scopes).toHaveLength(0);
  });
});

function chunk(
  version_id: string,
  scope: DocChunk["scope"],
  status: DocChunk["status"] = "current",
): DocChunk {
  return {
    stable_key: `${version_id}-stable`,
    version_id,
    source_path: `docs/${version_id}.md`,
    doc_id: `doc-${version_id}`,
    heading_path: ["A"],
    heading_level: 1,
    chunk_index: 1,
    chunk_count: 1,
    title: "A",
    body: "body",
    token_count: 10,
    chunk_content_hash: `hash-${version_id}`,
    start_line: 1,
    end_line: 2,
    heading_slug: "a",
    status,
    source_content_hash: `source-${version_id}`,
    indexed_at: "2026-01-01T00:00:00Z",
    scope,
  };
}

function card(
  id: string,
  scope: Card["scope"],
  anchors: { files?: string[]; symbols?: string[]; routes?: string[] } = {},
): Card {
  return {
    id,
    type: "constraint",
    title: id,
    body: "body",
    authority: "accepted",
    scope,
    symbol_anchors: anchors.symbols ?? [],
    file_anchors: anchors.files ?? [],
    route_anchors: anchors.routes ?? [],
    links: [],
    freshness_state: "verified",
    freshness_reason: "all_links_current",
    author_review_state: "unreviewed",
    token_count: 10,
    source_path: `.contexttrail/cards/${id}.md`,
    source_hash: "hash",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function anchor(
  chunk_version_id: string,
  kind: CodeAnchor["kind"],
  value: string,
  confidence: CodeAnchor["confidence"] = "high",
): CodeAnchor {
  return {
    chunk_version_id,
    kind,
    value,
    confidence,
    source: "frontmatter",
  };
}

describe("PRD-0005 query compilation", () => {
  it("prefers anchor-derived scopes over code_scopes fallback for file anchors", () => {
    const c = card(
      "card-payments",
      { layer: "module", project: "billing", module: "refunds", source: {} },
      { files: ["src/payments/refund.ts"] },
    );

    const out = compileQueryScopes({
      anchors: { files: ["src/payments/refund.ts"] },
      config: cfg,
      lookup: makeInMemoryAnchorLookup({ chunks: [], cards: [c], anchorsByChunkVersionId: new Map() }),
    });

    expect(out.query_scopes).toEqual([{ project: "billing", module: "refunds" }]);
    expect(out.query_compilation.query_mode).toBe("anchored");
    expect(out.query_compilation.anchors[0]!.mode).toBe("anchor_derived");
    expect(out.query_compilation.anchors[0]!.recognition).toBe("scope_inferred");
  });

  it("falls back to code_scopes only for file anchors with no derived scope", () => {
    const out = compileQueryScopes({
      anchors: { files: ["src/payments/refund.ts"] },
      config: cfg,
      lookup: makeInMemoryAnchorLookup({ chunks: [], cards: [], anchorsByChunkVersionId: new Map() }),
    });

    expect(out.query_scopes).toEqual([{ module: "payments" }]);
    expect(out.query_compilation.query_mode).toBe("anchored");
    expect(out.query_compilation.anchors[0]!.mode).toBe("code_scopes_fallback");
  });

  it("does not fall back to code_scopes for symbol or route anchors", () => {
    const out = compileQueryScopes({
      anchors: {
        symbols: ["RefundService.processRefund"],
        routes: ["POST /refunds"],
      },
      config: cfg,
      lookup: makeInMemoryAnchorLookup({ chunks: [], cards: [], anchorsByChunkVersionId: new Map() }),
    });

    expect(out.query_scopes).toEqual([]);
    expect(out.query_compilation.query_mode).toBe("signal_empty");
    expect(out.query_compilation.anchors.map((a) => a.mode)).toEqual(["none", "none"]);
  });

  it("keeps path-component fallback strict even when symbol lookup supports fuzzy matches", () => {
    const c = chunk("v1", {
      layer: "module",
      module: "workers",
      source: {},
    });
    const out = compileQueryScopes({
      anchors: { files: ["src/workers/retry.ts"] },
      config: emptyCfg,
      lookup: makeInMemoryAnchorLookup({
        chunks: [c],
        cards: [],
        anchorsByChunkVersionId: new Map([
          ["v1", [anchor("v1", "symbol", "RetryWorker")]],
        ]),
      }),
    });

    expect(out.query_scopes).toEqual([]);
    expect(out.query_compilation.query_mode).toBe("signal_empty");
    expect(out.query_compilation.anchors[0]!.mode).toBe("none");
  });

  it("dedupes and caps scopes per anchor without merging them", () => {
    const chunks = Array.from({ length: 12 }, (_, i) =>
      chunk(`v${i}`, {
        layer: "module",
        project: "proj",
        module: `m${i}`,
        source: {},
      }),
    );
    const anchorsByChunkVersionId = new Map(
      chunks.map((c) => [
        c.version_id,
        [anchor(c.version_id, "file", "src/shared.ts", "medium")],
      ]),
    );

    const out = compileQueryScopes({
      anchors: { files: ["src/shared.ts"] },
      config: cfg,
      lookup: makeInMemoryAnchorLookup({ chunks, cards: [], anchorsByChunkVersionId }),
    });

    expect(out.query_compilation.anchors[0]!.scopes).toHaveLength(10);
    expect(out.query_compilation.anchors[0]!.scopes[0]).toEqual({
      project: "proj",
      module: "m0",
    });
  });

  it("counts an exact anchored surface as recognized even without inferred scope", () => {
    const c = chunk("v1", { layer: "unknown", source: {} });
    const out = compileQueryScopes({
      anchors: { routes: ["POST /sessions/:id/renew"] },
      config: cfg,
      lookup: makeInMemoryAnchorLookup({
        chunks: [c],
        cards: [],
        anchorsByChunkVersionId: new Map([
        ["v1", [anchor("v1", "route", "POST /sessions/:id/renew")]],
        ]),
      }),
    });

    expect(out.query_scopes).toEqual([]);
    expect(out.query_compilation.query_mode).toBe("anchored");
    expect(out.query_compilation.anchors[0]!.recognition).toBe("exact_anchor_only");
  });

  it("infers scopes from route anchors on Cards", () => {
    const c = card(
      "card-auth",
      { layer: "module", project: "auth", module: "sessions", source: {} },
      { routes: ["POST /sessions/:id/renew"] },
    );

    const out = compileQueryScopes({
      anchors: { routes: ["POST /sessions/:id/renew"] },
      config: cfg,
      lookup: makeInMemoryAnchorLookup({ chunks: [], cards: [c], anchorsByChunkVersionId: new Map() }),
    });

    expect(out.query_scopes).toEqual([{ project: "auth", module: "sessions" }]);
    expect(out.query_compilation.query_mode).toBe("anchored");
    expect(out.query_compilation.anchors[0]!.contributing_anchors).toEqual([
      {
        object_id: "card-auth",
        kind: "card",
        value: "POST /sessions/:id/renew",
        confidence: "high",
        match_source: "code_anchor",
        match_kind: "exact",
      },
    ]);
  });

  it("keeps Card symbol-anchor scope inference strict while chunk anchors can be fuzzy", () => {
    const c = card(
      "symbol-note",
      { layer: "module", module: "payments", source: {} },
      { symbols: ["RefundService.processRefund"] },
    );

    const out = compileQueryScopes({
      anchors: { symbols: ["refundservice.processrefund"] },
      config: cfg,
      lookup: makeInMemoryAnchorLookup({
        chunks: [],
        cards: [c],
        anchorsByChunkVersionId: new Map(),
      }),
    });

    expect(out.query_scopes).toEqual([]);
    expect(out.query_compilation.query_mode).toBe("signal_empty");
  });
});
