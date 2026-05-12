import { describe, expect, it } from "vitest";
import { applyStructuralAssembly } from "./assembly.js";
import type { PackResult } from "./pack.js";
import type { QueryAnchors, ScoreTrace } from "./score.js";
import type { Card } from "../types/card.js";
import type { CodeAnchor, DocChunk } from "../types/chunk.js";
import type { QueryCompilation } from "./query-scope.js";

function chunk(overrides: Partial<DocChunk> & Pick<DocChunk, "version_id" | "source_path" | "heading_path" | "title" | "body">): DocChunk {
  return {
    stable_key: overrides.stable_key ?? `${overrides.version_id}-stable`,
    version_id: overrides.version_id,
    source_path: overrides.source_path,
    doc_id: overrides.doc_id ?? "doc-1",
    heading_path: overrides.heading_path,
    heading_level: overrides.heading_level ?? overrides.heading_path.length,
    chunk_index: overrides.chunk_index ?? 1,
    chunk_count: overrides.chunk_count ?? 1,
    title: overrides.title,
    body: overrides.body,
    token_count: overrides.token_count ?? 40,
    chunk_content_hash: overrides.chunk_content_hash ?? `${overrides.version_id}-hash`,
    start_line: overrides.start_line ?? 1,
    end_line: overrides.end_line ?? 5,
    heading_slug: overrides.heading_slug ?? overrides.title.toLowerCase().replace(/\s+/g, "-"),
    status: overrides.status ?? "current",
    source_content_hash: overrides.source_content_hash ?? "source-hash",
    indexed_at: overrides.indexed_at ?? "2026-05-07T00:00:00Z",
    scope: overrides.scope ?? { layer: "module", project: "payments", module: "refunds", source: {} },
    doc_role: overrides.doc_role ?? "canonical",
    role_source: overrides.role_source ?? "default",
    warnings: overrides.warnings,
  };
}

function trace(version_id: string, final_score: number, token_count = 40): ScoreTrace {
  return {
    version_id,
    bm25_norm: 1,
    heading_match: 0.5,
    scope_match: 1,
    mention_overlap: 1,
    specificity: 1.4,
    text_score: 0.8,
    final_score,
    token_count,
    packing_score: final_score / Math.sqrt(token_count),
    structural_multiplier: 1,
    doc_role: "canonical",
    role_source: "default",
    role_multiplier: 1,
  };
}

function emptyPack(included: PackResult["included"]): PackResult {
  return {
    locked: [],
    included,
    omitted: [],
    warnings: [],
    total_tokens: included.reduce((sum, entry) => sum + entry.token_count, 0),
    budget_tokens: 6000,
    safety_net_engaged: false,
    budget: {
      requested: 6000,
      used: included.reduce((sum, entry) => sum + entry.token_count, 0),
      locked_overhead: 0,
    },
  };
}

const anchoredCompilation: QueryCompilation = {
  query_mode: "anchored",
  provided_anchor_count: 1,
  recognized_anchor_count: 1,
  anchors: [
    {
      anchor: { kind: "file", value: "src/payments/refund.ts" },
      recognition: "scope_inferred",
      mode: "anchor_derived",
      scopes: [{ project: "payments", module: "refunds" }],
      contributing_anchors: [{ object_id: "root", kind: "chunk", value: "src/payments/refund.ts", confidence: "high" }],
    },
  ],
};

describe("applyStructuralAssembly", () => {
  it("stays not_applicable for unanchored retrievals", () => {
    const root = chunk({
      version_id: "root",
      source_path: "docs/payments/refunds.md",
      heading_path: ["Refunds"],
      title: "Refunds",
      body: "Refund overview",
    });
    const result = applyStructuralAssembly({
      query: "refund overview",
      query_mode: "unanchored",
      query_anchors: {},
      query_compilation: { ...anchoredCompilation, query_mode: "unanchored" },
      pack: emptyPack([{ ...trace("root", 1.5), kind: "doc_chunk" }]),
      chunksByVersionId: new Map([[root.version_id, root]]),
      cardsByCardId: new Map<string, Card>(),
      chunkTracesByVersionId: new Map([[root.version_id, trace("root", 1.5)]]),
      cardTracesByCardId: new Map(),
      chunkAnchorsByVersionId: new Map<string, CodeAnchor[]>(),
      cardLinksByCardId: new Map(),
    });

    expect(result.metadata.stage_reached).toBe("not_applicable");
    expect(result.pack.included.map((entry) => entry.version_id)).toEqual(["root"]);
  });

  it("adds one same-directory onboarding source sibling for unanchored setup queries", () => {
    const root = chunk({
      version_id: "root",
      source_path: "docs/getting-started/add-to-existing-repository.md",
      heading_path: ["Add to an existing repository"],
      title: "Add to an existing repository",
      body: "Add Turborepo to an existing project.",
      start_line: 1,
      end_line: 20,
    });
    const install = chunk({
      version_id: "install",
      source_path: "docs/getting-started/installation.md",
      heading_path: ["Installation"],
      title: "Installation",
      body: "Install the package before configuring your project.",
      start_line: 1,
      end_line: 20,
    });
    const unrelated = chunk({
      version_id: "docker",
      source_path: "docs/guides/tools/docker.md",
      heading_path: ["Docker"],
      title: "Docker",
      body: "Build containers.",
      start_line: 1,
      end_line: 20,
    });
    const rootTrace = {
      ...trace("root", 1.5, 40),
      source_rerank_rank: 1,
    };
    const installTrace = trace("install", 0.2, 40);
    const dockerTrace = {
      ...trace("docker", 1.8, 40),
      source_rerank_rank: 2,
    };
    const pack = emptyPack([
      { ...rootTrace, kind: "doc_chunk" },
      { ...dockerTrace, kind: "doc_chunk" },
    ]);
    pack.omitted = [
      {
        ...installTrace,
        kind: "doc_chunk",
        omitted_reason: "budget",
        reason: "did not fit budget",
      },
    ];

    const result = applyStructuralAssembly({
      query: "how do I add turborepo to my project",
      query_mode: "unanchored",
      query_anchors: {},
      query_compilation: { ...anchoredCompilation, query_mode: "unanchored", anchors: [] },
      pack,
      chunksByVersionId: new Map([
        [root.version_id, root],
        [install.version_id, install],
        [unrelated.version_id, unrelated],
      ]),
      cardsByCardId: new Map<string, Card>(),
      chunkTracesByVersionId: new Map([
        [root.version_id, rootTrace],
        [install.version_id, installTrace],
        [unrelated.version_id, dockerTrace],
      ]),
      cardTracesByCardId: new Map(),
      chunkAnchorsByVersionId: new Map<string, CodeAnchor[]>(),
      cardLinksByCardId: new Map(),
    });

    expect(result.metadata.stage_reached).toBe("source_sibling");
    expect(result.pack.included.map((entry) => entry.version_id)).toEqual(["root", "install", "docker"]);
    expect(result.metadata.selected_neighbors).toEqual([
      {
        version_id: "install",
        relation: "source_sibling",
        reason: "same-directory onboarding source sibling",
      },
    ]);
  });

  it("does not add source siblings for ordinary unanchored topical queries", () => {
    const root = chunk({
      version_id: "root",
      source_path: "docs/guides/caching.md",
      heading_path: ["Caching"],
      title: "Caching",
      body: "Cache task outputs.",
    });
    const install = chunk({
      version_id: "install",
      source_path: "docs/guides/installation.md",
      heading_path: ["Installation"],
      title: "Installation",
      body: "Install packages.",
    });
    const rootTrace = trace("root", 1.5, 40);
    const installTrace = trace("install", 0.6, 40);
    const pack = emptyPack([{ ...rootTrace, kind: "doc_chunk" }]);
    pack.omitted = [
      {
        ...installTrace,
        kind: "doc_chunk",
        omitted_reason: "budget",
        reason: "did not fit budget",
      },
    ];

    const result = applyStructuralAssembly({
      query: "how does caching work",
      query_mode: "unanchored",
      query_anchors: {},
      query_compilation: { ...anchoredCompilation, query_mode: "unanchored", anchors: [] },
      pack,
      chunksByVersionId: new Map([
        [root.version_id, root],
        [install.version_id, install],
      ]),
      cardsByCardId: new Map<string, Card>(),
      chunkTracesByVersionId: new Map([
        [root.version_id, rootTrace],
        [install.version_id, installTrace],
      ]),
      cardTracesByCardId: new Map(),
      chunkAnchorsByVersionId: new Map<string, CodeAnchor[]>(),
      cardLinksByCardId: new Map(),
    });

    expect(result.metadata.stage_reached).toBe("not_applicable");
    expect(result.pack.included.map((entry) => entry.version_id)).toEqual(["root"]);
  });

  it("expands to the parent section for nested anchored roots", () => {
    const parent = chunk({
      version_id: "parent",
      source_path: "docs/payments/refunds.md",
      heading_path: ["Refunds"],
      title: "Refunds",
      body: "Top-level refund rules",
      start_line: 1,
      end_line: 6,
    });
    const root = chunk({
      version_id: "root",
      source_path: "docs/payments/refunds.md",
      heading_path: ["Refunds", "Partial refunds"],
      title: "Partial refunds",
      body: "A partial refund reuses the same idempotency key.",
      start_line: 7,
      end_line: 12,
    });

    const result = applyStructuralAssembly({
      query: "partial refund idempotency key",
      query_mode: "anchored",
      query_anchors: { files: ["src/payments/refund.ts"] },
      query_compilation: anchoredCompilation,
      pack: emptyPack([
        {
          ...trace("root", 1.8),
          kind: "doc_chunk",
          source_rerank_rank: 2,
          source_selection_rank: 3,
        },
      ]),
      chunksByVersionId: new Map([
        [parent.version_id, parent],
        [root.version_id, root],
      ]),
      cardsByCardId: new Map<string, Card>(),
      chunkTracesByVersionId: new Map([
        [parent.version_id, trace("parent", 0.9)],
        [root.version_id, trace("root", 1.8)],
      ]),
      cardTracesByCardId: new Map(),
      chunkAnchorsByVersionId: new Map<string, CodeAnchor[]>(),
      cardLinksByCardId: new Map(),
    });

    expect(result.metadata.root_version_id).toBe("root");
    expect(result.metadata.stage_reached).toBe("parent");
    expect(result.pack.included.map((entry) => entry.version_id)).toEqual(["root", "parent"]);
    const rebuiltRoot = result.pack.included.find((entry) => entry.version_id === "root");
    expect(rebuiltRoot?.kind).toBe("doc_chunk");
    if (rebuiltRoot?.kind === "doc_chunk") {
      expect(rebuiltRoot.source_rerank_rank).toBe(2);
      expect(rebuiltRoot.source_selection_rank).toBe(3);
    }
    expect(result.metadata.selected_neighbors).toEqual([
      { version_id: "parent", relation: "parent", reason: "immediate parent section" },
    ]);
  });

  it("adds a conservative linked decision neighbor for rationale-seeking anchored queries", () => {
    const root = chunk({
      version_id: "root",
      source_path: "docs/payments/refunds.md",
      heading_path: ["Refunds"],
      title: "Refunds",
      body: "RefundService.processRefund must be idempotent.",
      scope: { layer: "module", project: "payments", module: "refunds", source: {} },
    });
    const adr = chunk({
      version_id: "adr",
      source_path: "docs/adr/0001-idempotency-keys.md",
      heading_path: ["ADR-0001: Idempotency keys for payment retries"],
      title: "ADR-0001: Idempotency keys for payment retries",
      body: "RefundService.processRefund relies on upstream idempotency keys.",
      scope: { layer: "decision", project: "payments", source: {} },
      doc_id: "doc-adr",
    });
    const rootTrace = trace("root", 1.6);
    const adrTrace = trace("adr", 0.8);

    const result = applyStructuralAssembly({
      query: "why do refunds use provider idempotency keys",
      query_mode: "anchored",
      query_anchors: { files: ["src/payments/refund.ts"], symbols: ["RefundService.processRefund"] },
      query_compilation: anchoredCompilation,
      pack: emptyPack([{ ...rootTrace, kind: "doc_chunk" }]),
      chunksByVersionId: new Map([
        [root.version_id, root],
        [adr.version_id, adr],
      ]),
      cardsByCardId: new Map<string, Card>(),
      chunkTracesByVersionId: new Map([
        [root.version_id, rootTrace],
        [adr.version_id, adrTrace],
      ]),
      cardTracesByCardId: new Map(),
      chunkAnchorsByVersionId: new Map([
        [root.version_id, [{ chunk_version_id: "root", kind: "symbol", value: "RefundService.processRefund", confidence: "high", source: "mention_extraction" }]],
        [adr.version_id, [{ chunk_version_id: "adr", kind: "symbol", value: "RefundService.processRefund", confidence: "high", source: "mention_extraction" }]],
      ]),
      cardLinksByCardId: new Map(),
    });

    expect(result.metadata.stage_reached).toBe("linked_neighbor");
    expect(result.pack.included.map((entry) => entry.version_id)).toEqual(["root", "adr"]);
    expect(result.metadata.selected_neighbors).toEqual([
      { version_id: "adr", relation: "linked_neighbor", reason: "shared anchored rationale signal" },
    ]);
  });
});
