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

  it("keeps exact-anchor-only recognition when source-profile alias lookup adds nothing", () => {
    const c = chunk("v1", { layer: "unknown", source: {} });
    const out = compileQueryScopes({
      anchors: { files: ["src/parse/nav-parser.ts"] },
      config: emptyCfg,
      lookup: makeInMemoryAnchorLookup({
        chunks: [c],
        cards: [],
        anchorsByChunkVersionId: new Map([
          ["v1", [anchor("v1", "file", "src/parse/nav-parser.ts")]],
        ]),
      }),
      source_lookup: () => [],
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

describe("task-inferred id anchors", () => {
  const idLookup = (scope: DocChunk["scope"] = { layer: "unknown", source: {} }) =>
    makeInMemoryAnchorLookup({
      chunks: [chunk("v-claim", scope)],
      cards: [],
      anchorsByChunkVersionId: new Map([
        ["v-claim", [anchor("v-claim", "id", "CLM-2026-0412", "medium")]],
      ]),
    });

  it("task text containing an indexed id → anchored, no files/symbols/routes params", () => {
    const out = compileQueryScopes({
      anchors: {},
      config: emptyCfg,
      lookup: idLookup({ layer: "module", project: "claims", module: "intake", source: {} }),
      task: "can we close out CLM-2026-0412",
    });

    expect(out.query_compilation.query_mode).toBe("anchored");
    expect(out.query_compilation.provided_anchor_count).toBe(1);
    expect(out.query_compilation.recognized_anchor_count).toBe(1);
    expect(out.query_compilation.anchors).toHaveLength(1);
    expect(out.query_compilation.anchors[0]!.anchor).toEqual({
      kind: "id",
      value: "CLM-2026-0412",
    });
    expect(out.query_compilation.anchors[0]!.recognition).toBe("scope_inferred");
    expect(out.query_compilation.anchors[0]!.mode).toBe("anchor_derived");
    expect(out.query_scopes).toEqual([{ project: "claims", module: "intake" }]);
  });

  it("matches case-insensitively (clm-2026-0412 → CLM-2026-0412), exact otherwise", () => {
    const out = compileQueryScopes({
      anchors: {},
      config: emptyCfg,
      lookup: idLookup({ layer: "module", project: "claims", module: "intake", source: {} }),
      task: "status of clm-2026-0412 please",
    });

    expect(out.query_compilation.query_mode).toBe("anchored");
    expect(out.query_compilation.anchors[0]!.anchor.value).toBe("clm-2026-0412");
    expect(
      out.query_compilation.anchors[0]!.contributing_anchors[0]!.value,
    ).toBe("CLM-2026-0412");
  });

  it("id on a scope-less chunk is dropped — inference requires an inferable scope", () => {
    // Unlike explicit anchors (exact_anchor_only counts as recognized
    // because the caller asserted relevance), an INFERRED id must bind to
    // scope-bearing content. On a scope-less corpus, anchored-mode scoring
    // has no scope to preserve and would uniformly down-weight every chunk
    // against the absolute score floor, starving tasks that need evidence
    // beyond the id's own document.
    const out = compileQueryScopes({
      anchors: {},
      config: emptyCfg,
      lookup: idLookup({ layer: "unknown", source: {} }),
      task: "can we close out CLM-2026-0412",
    });

    expect(out.query_compilation.query_mode).toBe("unanchored");
    expect(out.query_compilation.anchors).toEqual([]);
  });

  it("an id-shaped token absent from the corpus is dropped — stays unanchored, NOT signal_empty", () => {
    const out = compileQueryScopes({
      anchors: {},
      config: emptyCfg,
      lookup: idLookup(),
      task: "can we close out CLM-9999-0001",
    });

    expect(out.query_compilation.query_mode).toBe("unanchored");
    expect(out.query_compilation.provided_anchor_count).toBe(0);
    expect(out.query_compilation.recognized_anchor_count).toBe(0);
    expect(out.query_compilation.anchors).toEqual([]);
  });

  it("dates and bare numbers in the task never become id anchors", () => {
    const out = compileQueryScopes({
      anchors: {},
      config: emptyCfg,
      lookup: idLookup(),
      task: "what changed on 2026-06-12 in build 88231",
    });

    expect(out.query_compilation.query_mode).toBe("unanchored");
    expect(out.query_compilation.anchors).toEqual([]);
  });

  it("id anchors never bind to same-valued anchors of another kind", () => {
    const out = compileQueryScopes({
      anchors: {},
      config: emptyCfg,
      lookup: makeInMemoryAnchorLookup({
        chunks: [chunk("v1", { layer: "module", module: "billing", source: {} })],
        cards: [],
        anchorsByChunkVersionId: new Map([
          ["v1", [anchor("v1", "symbol", "INV-1042")]],
        ]),
      }),
      task: "pay INV-1042 now",
    });

    expect(out.query_compilation.query_mode).toBe("unanchored");
    expect(out.query_compilation.anchors).toEqual([]);
  });

  it("explicit anchors and recognized inferred ids combine", () => {
    const c = card(
      "card-payments",
      { layer: "module", project: "billing", module: "refunds", source: {} },
      { files: ["src/payments/refund.ts"] },
    );
    const out = compileQueryScopes({
      anchors: { files: ["src/payments/refund.ts"] },
      config: emptyCfg,
      lookup: makeInMemoryAnchorLookup({
        chunks: [chunk("v-claim", { layer: "module", project: "claims", source: {} })],
        cards: [c],
        anchorsByChunkVersionId: new Map([
          ["v-claim", [anchor("v-claim", "id", "CLM-2026-0412", "medium")]],
        ]),
      }),
      task: "reconcile CLM-2026-0412 against the refund",
    });

    expect(out.query_compilation.query_mode).toBe("anchored");
    expect(out.query_compilation.provided_anchor_count).toBe(2);
    expect(out.query_compilation.recognized_anchor_count).toBe(2);
    expect(out.query_compilation.anchors.map((a) => a.anchor.kind)).toEqual([
      "file",
      "id",
    ]);
    expect(out.query_scopes).toEqual([
      { project: "billing", module: "refunds" },
      { project: "claims" },
    ]);
  });

  it("explicit unrecognized anchors keep signal_empty when no inferred id rescues them", () => {
    const out = compileQueryScopes({
      anchors: { symbols: ["NotIndexedAnywhere"] },
      config: emptyCfg,
      lookup: idLookup(),
      task: "investigate NotIndexedAnywhere",
    });

    expect(out.query_compilation.query_mode).toBe("signal_empty");
    expect(out.query_compilation.provided_anchor_count).toBe(1);
  });

  it("a recognized inferred id lifts an otherwise signal_empty explicit anchor set to anchored", () => {
    const out = compileQueryScopes({
      anchors: { symbols: ["NotIndexedAnywhere"] },
      config: emptyCfg,
      lookup: idLookup({ layer: "module", project: "claims", module: "intake", source: {} }),
      task: "investigate NotIndexedAnywhere on CLM-2026-0412",
    });

    expect(out.query_compilation.query_mode).toBe("anchored");
    expect(out.query_compilation.provided_anchor_count).toBe(2);
    expect(out.query_compilation.recognized_anchor_count).toBe(1);
  });

  it("no task → no inferred anchors (back-compat)", () => {
    const out = compileQueryScopes({
      anchors: {},
      config: emptyCfg,
      lookup: idLookup(),
    });

    expect(out.query_compilation.query_mode).toBe("unanchored");
    expect(out.query_compilation.anchors).toEqual([]);
  });

  describe("discrimination gate — corpus-wide boilerplate ids do not anchor", () => {
    const lookupSpanningSources = (sourceCount: number) => {
      const chunks = Array.from({ length: sourceCount }, (_, i) => {
        const c = chunk(`v${i}`, { layer: "module", project: "claims", module: `m${i}`, source: {} });
        return { ...c, source_path: `docs/doc-${i}.md` };
      });
      return makeInMemoryAnchorLookup({
        chunks,
        cards: [],
        anchorsByChunkVersionId: new Map(
          chunks.map((c) => [
            c.version_id,
            [anchor(c.version_id, "id", "CLM-2026-0314", "medium")],
          ]),
        ),
      });
    };

    it("an id bound in ≤3 distinct sources anchors", () => {
      const out = compileQueryScopes({
        anchors: {},
        config: emptyCfg,
        lookup: lookupSpanningSources(3),
        task: "review CLM-2026-0314 payments",
      });
      expect(out.query_compilation.query_mode).toBe("anchored");
    });

    it("an id stamped across 4+ sources is boilerplate — dropped, stays unanchored", () => {
      const out = compileQueryScopes({
        anchors: {},
        config: emptyCfg,
        lookup: lookupSpanningSources(4),
        task: "review CLM-2026-0314 payments",
      });
      expect(out.query_compilation.query_mode).toBe("unanchored");
      expect(out.query_compilation.anchors).toEqual([]);
    });

    it("many chunks of the SAME source count as one source", () => {
      const chunks = Array.from({ length: 6 }, (_, i) => {
        const c = chunk(`v${i}`, { layer: "module", project: "claims", module: "intake", source: {} });
        return { ...c, source_path: "docs/claim-file.md" };
      });
      const out = compileQueryScopes({
        anchors: {},
        config: emptyCfg,
        lookup: makeInMemoryAnchorLookup({
          chunks,
          cards: [],
          anchorsByChunkVersionId: new Map(
            chunks.map((c) => [
              c.version_id,
              [anchor(c.version_id, "id", "CLM-2026-0314", "medium")],
            ]),
          ),
        }),
        task: "review CLM-2026-0314 payments",
      });
      expect(out.query_compilation.query_mode).toBe("anchored");
    });

    it("the gate never applies to caller-supplied anchors", () => {
      const chunks = Array.from({ length: 5 }, (_, i) => {
        const c = chunk(`v${i}`, { layer: "module", module: `m${i}`, source: {} });
        return { ...c, source_path: `docs/doc-${i}.md` };
      });
      const out = compileQueryScopes({
        anchors: { symbols: ["RefundService"] },
        config: emptyCfg,
        lookup: makeInMemoryAnchorLookup({
          chunks,
          cards: [],
          anchorsByChunkVersionId: new Map(
            chunks.map((c) => [
              c.version_id,
              [anchor(c.version_id, "symbol", "RefundService")],
            ]),
          ),
        }),
      });
      expect(out.query_compilation.query_mode).toBe("anchored");
      expect(out.query_compilation.anchors[0]!.scopes.length).toBe(5);
    });
  });
});
