import { describe, it, expect } from "vitest";
import { presentContextPack } from "./presenter.js";
import { schemas } from "./schemas.js";
import type { RetrievalResult } from "../retrieve/retrieve.js";
import type { DocChunk } from "../types/chunk.js";
import type { Card } from "../types/card.js";
import type { SourceCard } from "../retrieve/source-card.js";
import type { SourceSelectionDecision } from "../retrieve/source-selection-decision.js";

function emptyResult(): RetrievalResult {
  return {
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
      provided_anchor_count: 0,
      recognized_anchor_count: 0,
      anchors: [],
    },
    candidate_count: 0,
    eligible_count: 0,
  };
}

function sourceCard(
  source_path: string,
  rank: number,
  family_id: string | null,
): SourceCard {
  return {
    schema_version: 1,
    rank,
    source_path,
    query_intent: "broad_domain",
    query_tokens: [],
    profile_signals: null,
    candidate_path_evidence: {
      basename_tokens: [],
      dir_tokens: [],
      package_segment: null,
      version_segment: null,
      inside_src: false,
      inside_docs: true,
      inside_examples: false,
      inside_tests: false,
      path_depth: 1,
      is_index_page: false,
      is_readme_page: false,
      path_stem: source_path.replace(/\.md$/, ""),
    },
    top_chunk_evidence: {
      title: "Doc",
      heading_path: [],
      intro: "",
      body_preview: "",
      lexical_chunk_score: 0.9,
      best_chunk_rank: rank,
    },
    token_coverage: {
      lexical_chunk_score: 0.9,
      lexical_chunk_rank: rank,
      title_token_coverage: 0,
      path_token_coverage: 0,
      heading_token_coverage: 0,
      filename_token_coverage: 0,
      intro_token_coverage: 0,
      alias_hit_count: 0,
      code_fence_entity_hit_count: 0,
      owner_identity_score: 0,
      overview_owner_score: 0,
    },
    coverage_decision: null,
    phrase_proximity: null,
    source_role: {
      role: "unknown",
      canonicality: "unknown",
      confidence: "unknown",
      evidence: [],
    },
    source_family:
      family_id === null
        ? null
        : {
            family_id,
            family_kind: "sibling_index",
            family_role: "member",
          },
    anchor_symbols: [],
    path_topology: {
      package_segment: null,
      version_segment: null,
      path_depth: 1,
      is_index_page: false,
      is_readme_page: false,
      section_landing_dir: null,
    },
    heading_aliases: [],
    code_fence_entities: [],
    nav_metadata: {},
  };
}

describe("presentContextPack — pure transformation", () => {
  it("produces a schema-valid empty pack from an empty retrieval", () => {
    const out = presentContextPack({
      query: "x",
      result: emptyResult(),
      requested_budget: 6000,
      has_sources: true,
      explain: false,
    });
    const r = schemas.retrieve_context_pack.output.safeParse(out);
    expect(r.success).toBe(true);
    expect(out.query_mode).toBe("unanchored");
    expect(out.assembly_stage_reached).toBe("not_applicable");
    expect(out.locked).toEqual([]);
    expect(out.ranked).toEqual([]);
    expect(out.omitted).toEqual({ total: 0, by_reason: {}, top: [], truncated: false });
    // No-matches warning is expected when both arrays are empty AND sources exist.
    expect(out.warnings.map((w) => w.kind)).toContain("no_matches");
  });

  it("emits a no_sources warning when no sources are imported", () => {
    const out = presentContextPack({
      query: "x",
      result: emptyResult(),
      requested_budget: 6000,
      has_sources: false,
      explain: false,
    });
    expect(out.warnings.map((w) => w.kind)).toContain("no_sources");
    expect(out.warnings.find((w) => w.kind === "no_sources")?.hint).toMatch(
      /contexttrail import/i,
    );
  });

  it("projects assembly stage always-on and detailed reasons under explain only", () => {
    const result = emptyResult();
    result.assembly = {
      stage_reached: "siblings",
      root_version_id: "root",
      selected_neighbors: [
        {
          version_id: "sibling-1",
          relation: "siblings",
          reason: "adjacent sibling with lexical overlap",
        },
      ],
      early_stop_reason: "first sufficient structural stage",
    };

    const withoutExplain = presentContextPack({
      query: "x",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: false,
    });
    expect(withoutExplain.assembly_stage_reached).toBe("siblings");
    expect(withoutExplain.explain).toBeUndefined();

    const withExplain = presentContextPack({
      query: "x",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: true,
    });
    expect(withExplain.assembly_stage_reached).toBe("siblings");
    expect(withExplain.explain?.assembly).toEqual({
      root_version_id: "root",
      selected_neighbors: [
        {
          version_id: "sibling-1",
          relation: "siblings",
          reason: "adjacent sibling with lexical overlap",
        },
      ],
      early_stop_reason: "first sufficient structural stage",
    });
  });

  it("does not emit no_matches when ranked array is non-empty", () => {
    const result = emptyResult();
    const c: DocChunk = {
      version_id: "v1",
      stable_key: "k1",
      source_path: "docs/x.md",
      heading_path: ["A"],
      chunk_index: 1,
      chunk_count: 1,
      title: "A",
      body: "hello",
      token_count: 5,
      content_hash: "h",
      start_line: 1,
      end_line: 2,
      scope: { layer: "module", source: {} },
      status: "current",
    };
    result.chunksByVersionId.set("v1", c);
    result.pack.included = [
      {
        version_id: "v1",
        bm25_norm: 0.8,
        heading_match: 0.5,
        scope_match: 0.0,
        mention_overlap: 0.0,
        specificity: 1.4,
        text_score: 0.71,
        final_score: 1.0,
        token_count: 5,
        packing_score: 0.45,
        kind: "doc_chunk",
      },
    ];
    result.pack.budget = { requested: 6000, used: 5, locked_overhead: 0 };

    const out = presentContextPack({
      query: "x",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: false,
    });
    expect(out.warnings.map((w) => w.kind)).not.toContain("no_matches");
    expect(out.ranked.length).toBe(1);
    expect(out.ranked[0]!.id).toBe("v1");
    expect(out.ranked[0]!.kind).toBe("chunk");
    expect(out.ranked[0]!.body).toBe("hello");
    expect(out.ranked[0]!.tokens).toBe(5);
    expect(out.ranked[0]!.score).toBe(1.0);
    expect(out.ranked[0]!.type_bias_applied).toBe(false);
    expect(out.ranked[0]!.contexttrail).toContain("docs/x.md");
  });

  it("projects ranked code entries with structured navigation and code-lane budget accounting", () => {
    const result = emptyResult();
    result.codeByVersionId = new Map([
      [
        "code-v1",
        {
          version_id: "code-v1",
          stable_key: "src/payments/refund.ts::RefundService.processRefund::declaration",
          source_path: "src/payments/refund.ts",
          symbol_path: "RefundService.processRefund",
          code_role: "declaration",
          declaration_kind: "function",
          exported: true,
          body: "export function processRefund() {}",
          start_line: 10,
          end_line: 20,
          token_count: 180,
          chunk_content_hash: "chunk-hash",
          source_content_hash: "source-hash",
          indexed_at: "2026-05-13T00:00:00.000Z",
          status: "current",
        },
      ],
    ]);
    result.pack.included = [
      {
        version_id: "code-v1",
        bm25_norm: 0.9,
        heading_match: 0,
        scope_match: 0,
        mention_overlap: 0,
        specificity: 1,
        text_score: 0.9,
        final_score: 0.9,
        token_count: 180,
        packing_score: 0.067,
        kind: "code",
        source_path: "src/payments/refund.ts",
        start_line: 10,
        end_line: 20,
        symbol_path: "RefundService.processRefund",
        code_role: "declaration",
        declaration_kind: "function",
        parent_score: 0.9,
        support_cluster: {
          role: "support",
          seed_source_path: "src/payments/service.ts",
          distance: 1,
          reason: "outgoing_import",
          relevance: 0.8,
        },
        code_rank: 1,
      },
    ];
    result.pack.budget = {
      requested: 6000,
      used: 180,
      locked_overhead: 0,
      code_lane: { triggered: true, reserved: 1200, used: 180 },
    };

    const out = presentContextPack({
      query: "update RefundService.processRefund",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: false,
    });

    expect(out.ranked[0]).toMatchObject({
      id: "code-v1",
      kind: "code",
      source_path: "src/payments/refund.ts",
      start_line: 10,
      end_line: 20,
      symbol_path: "RefundService.processRefund",
      code_role: "declaration",
      support_cluster: {
        role: "support",
        seed_source_path: "src/payments/service.ts",
        distance: 1,
        reason: "outgoing_import",
        relevance: 0.8,
      },
    });
    expect(out.ranked[0]?.contexttrail).toContain("support-cluster support of src/payments/service.ts");
    expect(out.budget.code_lane).toEqual({
      triggered: true,
      reserved: 1200,
      used: 180,
    });
  });

  it("low_confidence warning caps coverage_confidence at uncertain (THO-121)", () => {
    // Reproduces a real-corpus false-confident pattern: top1 score 0.84,
    // unanchored mode (so low_confidence warning fires), but the previous
    // policy still classified the result as confident because 0.84 >= 0.5.
    const result = emptyResult();
    const c: DocChunk = {
      version_id: "weakish",
      stable_key: "weakish",
      source_path: "docs/bundler/fullstack.md",
      heading_path: ["Fullstack"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Fullstack",
      body: "fullstack content",
      token_count: 5,
      content_hash: "h",
      start_line: 1,
      end_line: 2,
      scope: { layer: "module", source: {} },
      status: "current",
    };
    result.chunksByVersionId.set("weakish", c);
    result.pack.included = [
      {
        version_id: "weakish",
        bm25_norm: 0.4,
        heading_match: 0.2,
        scope_match: 0,
        mention_overlap: 0,
        specificity: 1.2,
        text_score: 0.7,
        final_score: 0.84,
        token_count: 5,
        packing_score: 0.4,
        kind: "doc_chunk",
      },
    ];
    result.pack.budget = { requested: 6000, used: 5, locked_overhead: 0 };

    const out = presentContextPack({
      query: "android deployment",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: false,
    });

    expect(out.warnings.map((w) => w.kind)).toContain("low_confidence");
    expect(out.coverage_confidence).toBe("uncertain");
  });

  it("caps coverage_confidence at uncertain for a genuinely ambiguous top family", () => {
    const result = emptyResult();
    const c: DocChunk = {
      version_id: "top",
      stable_key: "top",
      source_path: "docs/nav/parser.md",
      heading_path: ["Parser"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Parser",
      body: "nav parser",
      token_count: 5,
      content_hash: "h",
      start_line: 1,
      end_line: 2,
      scope: { layer: "module", source: {} },
      status: "current",
    };
    result.query_mode = "anchored";
    result.query_compilation = {
      query_mode: "anchored",
      provided_anchor_count: 1,
      recognized_anchor_count: 1,
      anchors: [],
    };
    result.chunksByVersionId.set("top", c);
    result.pack.included = [
      {
        version_id: "top",
        bm25_norm: 0.8,
        heading_match: 0.4,
        scope_match: 0,
        mention_overlap: 0,
        specificity: 1.0,
        text_score: 0.9,
        final_score: 0.9,
        token_count: 5,
        packing_score: 0.9,
        kind: "doc_chunk",
      },
    ];
    result.pack.budget = { requested: 6000, used: 5, locked_overhead: 0 };
    result.source_cards = [
      sourceCard("docs/nav/parser.md", 1, "nav-family"),
      sourceCard("docs/nav/parser-subparsers.md", 2, "nav-family"),
    ];
    result.source_selection = {
      selected_sources: [
        {
          source_path: "docs/nav/parser.md",
          rank: 1,
          score: 0.9,
          aboutness_label: "covers",
          reason_codes: [],
        },
        {
          source_path: "docs/nav/parser-subparsers.md",
          rank: 2,
          score: 0.88,
          aboutness_label: "supports",
          reason_codes: [],
        },
      ],
      fail_closed: false,
      top1_top2_margin: 0.01,
      top1_top3_margin: 0.01,
    } satisfies SourceSelectionDecision;

    const out = presentContextPack({
      query: "implement nav parser sub-parsers",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: true,
    });

    expect(out.coverage_confidence).toBe("uncertain");
    expect(out.explain?.pack_readiness.reason_codes).toContain("ambiguous_top_family");
  });

  it("emits low_confidence for weak non-empty ranked output", () => {
    const result = emptyResult();
    const c: DocChunk = {
      version_id: "weak",
      stable_key: "weak",
      source_path: "docs/weak.md",
      heading_path: ["Weak"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Weak",
      body: "thin match",
      token_count: 5,
      content_hash: "h",
      start_line: 1,
      end_line: 2,
      scope: { layer: "module", source: {} },
      status: "current",
    };
    result.chunksByVersionId.set("weak", c);
    result.pack.included = [
      {
        version_id: "weak",
        bm25_norm: 0.05,
        heading_match: 0,
        scope_match: 0,
        mention_overlap: 0,
        specificity: 1,
        text_score: 0.035,
        final_score: 0.035,
        token_count: 5,
        packing_score: 0.015,
        kind: "doc_chunk",
      },
    ];
    result.pack.budget = { requested: 6000, used: 5, locked_overhead: 0 };

    const out = presentContextPack({
      query: "what should I think about",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: false,
    });

    expect(out.ranked).toHaveLength(1);
    expect(out.warnings.map((w) => w.kind)).toContain("low_confidence");
    expect(out.warnings.map((w) => w.kind)).not.toContain("no_matches");
  });

  it("orders ranked output by final_score, not density packing order", () => {
    const result = emptyResult();
    const dense: DocChunk = {
      version_id: "dense",
      stable_key: "dense",
      source_path: "docs/dense.md",
      heading_path: ["Dense"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Dense",
      body: "short lexical match",
      token_count: 4,
      content_hash: "h1",
      start_line: 1,
      end_line: 1,
      scope: { layer: "project", source: {} },
      status: "current",
    };
    const relevant: DocChunk = {
      version_id: "relevant",
      stable_key: "relevant",
      source_path: "docs/relevant.md",
      heading_path: ["Relevant"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Relevant",
      body: "longer but more relevant match",
      token_count: 100,
      content_hash: "h2",
      start_line: 1,
      end_line: 1,
      scope: { layer: "module", source: {} },
      status: "current",
    };
    result.chunksByVersionId.set("dense", dense);
    result.chunksByVersionId.set("relevant", relevant);
    result.pack.included = [
      {
        version_id: "dense",
        bm25_norm: 1,
        heading_match: 0,
        scope_match: 0,
        mention_overlap: 0,
        specificity: 1,
        text_score: 1,
        final_score: 0.4,
        token_count: 4,
        packing_score: 0.2,
        kind: "doc_chunk",
      },
      {
        version_id: "relevant",
        bm25_norm: 1,
        heading_match: 0,
        scope_match: 1,
        mention_overlap: 1,
        specificity: 1.4,
        text_score: 1,
        final_score: 1.4,
        token_count: 100,
        packing_score: 0.14,
        kind: "doc_chunk",
      },
    ];
    result.pack.budget = { requested: 6000, used: 104, locked_overhead: 0 };

    const out = presentContextPack({
      query: "x",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: false,
    });

    expect(out.ranked.map((entry) => entry.id)).toEqual(["relevant", "dense"]);
  });

  it("diversifies early ranked output across doc sources for multi-scope anchored queries", () => {
    const result = emptyResult();
    result.query_mode = "anchored";
    result.query_compilation = {
      query_mode: "anchored",
      provided_anchor_count: 2,
      recognized_anchor_count: 2,
      anchors: [
        {
          anchor: { kind: "file", value: "src/auth/sessions.ts" },
          recognition: "scope_inferred",
          mode: "anchor_derived",
          scopes: [{ project: "auth" }],
          contributing_anchors: [],
        },
        {
          anchor: { kind: "file", value: "src/auth/tokens.ts" },
          recognition: "scope_inferred",
          mode: "anchor_derived",
          scopes: [{ project: "auth", module: "tokens" }],
          contributing_anchors: [],
        },
      ],
    };

    const sessionPrimary: DocChunk = {
      version_id: "session-primary",
      stable_key: "session-primary",
      source_path: "docs/auth/sessions.md",
      heading_path: ["Session management"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Session management",
      body: "session details",
      token_count: 40,
      content_hash: "h1",
      start_line: 1,
      end_line: 5,
      scope: { layer: "project", project: "auth", source: {} },
      status: "current",
    };
    const sessionSecondary: DocChunk = {
      version_id: "session-secondary",
      stable_key: "session-secondary",
      source_path: "docs/auth/sessions.md",
      heading_path: ["Session management", "Renewal"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Renewal",
      body: "renewal details",
      token_count: 40,
      content_hash: "h2",
      start_line: 6,
      end_line: 10,
      scope: { layer: "project", project: "auth", source: {} },
      status: "current",
    };
    const tokenChunk: DocChunk = {
      version_id: "token-primary",
      stable_key: "token-primary",
      source_path: "docs/auth/tokens.md",
      heading_path: ["API tokens", "Revocation"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Revocation",
      body: "token revocation details",
      token_count: 40,
      content_hash: "h3",
      start_line: 1,
      end_line: 5,
      scope: { layer: "module", project: "auth", module: "tokens", source: {} },
      status: "current",
    };
    result.chunksByVersionId.set(sessionPrimary.version_id, sessionPrimary);
    result.chunksByVersionId.set(sessionSecondary.version_id, sessionSecondary);
    result.chunksByVersionId.set(tokenChunk.version_id, tokenChunk);
    result.pack.included = [
      {
        version_id: "session-primary",
        bm25_norm: 1,
        heading_match: 0.4,
        scope_match: 0.6,
        mention_overlap: 0,
        specificity: 1.2,
        text_score: 1.12,
        final_score: 1.63,
        token_count: 40,
        packing_score: 0.258,
        kind: "doc_chunk",
      },
      {
        version_id: "session-secondary",
        bm25_norm: 1,
        heading_match: 0.33,
        scope_match: 0.6,
        mention_overlap: 0,
        specificity: 1.2,
        text_score: 0.98,
        final_score: 1.417,
        token_count: 40,
        packing_score: 0.224,
        kind: "doc_chunk",
      },
      {
        version_id: "token-primary",
        bm25_norm: 0.8,
        heading_match: 0.12,
        scope_match: 1,
        mention_overlap: 0.33,
        specificity: 1.4,
        text_score: 0.596,
        final_score: 1.138,
        token_count: 40,
        packing_score: 0.18,
        kind: "doc_chunk",
      },
    ];
    result.pack.budget = { requested: 6000, used: 120, locked_overhead: 0 };

    const out = presentContextPack({
      query: "auth session token and permission management",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: false,
    });

    expect(out.ranked.map((entry) => entry.id)).toEqual([
      "token-primary",
      "session-primary",
      "session-secondary",
    ]);
  });

  it("prefers a canonical doc over a higher-scoring card for multi-scope anchored first-read ranking", () => {
    const result = emptyResult();
    result.query_mode = "anchored";
    result.query_compilation = {
      query_mode: "anchored",
      provided_anchor_count: 3,
      recognized_anchor_count: 3,
      anchors: [
        {
          anchor: { kind: "file", value: "src/auth/sessions.ts" },
          recognition: "scope_inferred",
          mode: "anchor_derived",
          scopes: [{ project: "auth" }],
          contributing_anchors: [{ object_id: "session-root", kind: "chunk", value: "src/auth/sessions.ts", confidence: "high" }],
        },
        {
          anchor: { kind: "file", value: "src/auth/tokens.ts" },
          recognition: "scope_inferred",
          mode: "anchor_derived",
          scopes: [{ project: "auth", module: "tokens" }],
          contributing_anchors: [{ object_id: "token-root", kind: "chunk", value: "src/auth/tokens.ts", confidence: "high" }],
        },
        {
          anchor: { kind: "file", value: "src/auth/permissions.ts" },
          recognition: "scope_inferred",
          mode: "anchor_derived",
          scopes: [{ project: "auth" }],
          contributing_anchors: [{ object_id: "permission-root", kind: "chunk", value: "src/auth/permissions.ts", confidence: "high" }],
        },
      ],
    };

    const sessionChunk: DocChunk = {
      version_id: "session-root",
      stable_key: "session-root",
      source_path: "docs/auth/sessions.md",
      heading_path: ["Session management"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Session management",
      body: "session semantics",
      token_count: 40,
      content_hash: "h-session",
      start_line: 1,
      end_line: 10,
      scope: { layer: "project", project: "auth", source: {} },
      status: "current",
    };
    const tokenChunk: DocChunk = {
      version_id: "token-root",
      stable_key: "token-root",
      source_path: "docs/auth/tokens.md",
      heading_path: ["API tokens", "Revocation"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Revocation",
      body: "token revocation semantics",
      token_count: 40,
      content_hash: "h-token",
      start_line: 1,
      end_line: 10,
      scope: { layer: "module", project: "auth", module: "tokens", source: {} },
      status: "current",
    };
    const card: Card = {
      id: "C003",
      type: "constraint",
      title: "Session renewal preserves token identity",
      body: "session renewal extends TTL without rotating the session token",
      authority: "accepted",
      scope: { layer: "module", project: "auth", module: "sessions", source: {} },
      symbol_anchors: [],
      file_anchors: [],
      route_anchors: ["POST /sessions/:id/renew"],
      links: [],
      freshness_state: "verified",
      freshness_reason: "none",
      author_review_state: "approved",
      created_at: "2026-05-07T00:00:00Z",
      updated_at: "2026-05-07T00:00:00Z",
      token_count: 10,
      file_path: ".contexttrail/cards/c-auth.md",
      source_hash: "card-hash",
    };

    result.chunksByVersionId.set(sessionChunk.version_id, sessionChunk);
    result.chunksByVersionId.set(tokenChunk.version_id, tokenChunk);
    result.cardsByCardId.set(card.id, card);
    result.pack.included = [
      {
        version_id: card.id,
        bm25_norm: 0.95,
        heading_match: 0.2,
        scope_match: 1,
        mention_overlap: 0,
        specificity: 1.4,
        text_score: 0.725,
        final_score: 1.849,
        token_count: 10,
        packing_score: 0.584,
        kind: "card",
        card_id: card.id,
        card_type: card.type,
      },
      {
        version_id: sessionChunk.version_id,
        bm25_norm: 0.9,
        heading_match: 0.4,
        scope_match: 0.6,
        mention_overlap: 0,
        specificity: 1.2,
        text_score: 0.75,
        final_score: 1.63,
        token_count: 40,
        packing_score: 0.258,
        kind: "doc_chunk",
      },
      {
        version_id: tokenChunk.version_id,
        bm25_norm: 0.7,
        heading_match: 0.2,
        scope_match: 1,
        mention_overlap: 0.33,
        specificity: 1.4,
        text_score: 0.55,
        final_score: 1.138,
        token_count: 40,
        packing_score: 0.18,
        kind: "doc_chunk",
      },
    ];
    result.pack.budget = { requested: 6000, used: 90, locked_overhead: 0 };

    const out = presentContextPack({
      query: "auth session token and permission management",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: false,
    });

    expect(out.ranked[0]?.kind).toBe("chunk");
    expect(out.ranked[0]?.id).toBe("token-root");
  });

  it("promotes a module chunk when a file anchor contributes cards but no chunks", () => {
    const result = emptyResult();
    result.query_mode = "anchored";
    result.query_compilation = {
      query_mode: "anchored",
      provided_anchor_count: 3,
      recognized_anchor_count: 3,
      anchors: [
        {
          anchor: { kind: "file", value: "src/auth/sessions.ts" },
          recognition: "scope_inferred",
          mode: "anchor_derived",
          scopes: [{ project: "auth" }],
          contributing_anchors: [{ object_id: "C007", kind: "card", value: "src/auth/sessions.ts", confidence: "high" }],
        },
        {
          anchor: { kind: "file", value: "src/auth/tokens.ts" },
          recognition: "scope_inferred",
          mode: "anchor_derived",
          scopes: [{ project: "auth", module: "tokens" }, { project: "auth" }],
          contributing_anchors: [
            { object_id: "C006", kind: "card", value: "src/auth/tokens.ts", confidence: "high" },
            { object_id: "C007", kind: "card", value: "src/auth/tokens.ts", confidence: "high" },
          ],
        },
        {
          anchor: { kind: "file", value: "src/auth/permissions.ts" },
          recognition: "scope_inferred",
          mode: "anchor_derived",
          scopes: [{ project: "auth" }, { project: "auth", module: "permissions" }],
          contributing_anchors: [{ object_id: "permission-root", kind: "chunk", value: "src/auth/permissions.ts", confidence: "high" }],
        },
      ],
    };

    const sessionChunk: DocChunk = {
      version_id: "session-root",
      stable_key: "session-root",
      source_path: "docs/auth/sessions.md",
      heading_path: ["Session management"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Session management",
      body: "Session rules",
      token_count: 40,
      content_hash: "session-root",
      start_line: 1,
      end_line: 8,
      scope: { layer: "project", project: "auth", source: {} },
      status: "current",
    };
    const tokenChunk: DocChunk = {
      version_id: "token-root",
      stable_key: "token-root",
      source_path: "docs/auth/tokens.md",
      heading_path: ["API tokens"],
      chunk_index: 1,
      chunk_count: 1,
      title: "API tokens",
      body: "Token lifecycle rules",
      token_count: 40,
      content_hash: "token-root",
      start_line: 1,
      end_line: 8,
      scope: { layer: "module", project: "auth", module: "tokens", source: {} },
      status: "current",
    };
    const permissionChunk: DocChunk = {
      version_id: "permission-root",
      stable_key: "permission-root",
      source_path: "docs/auth/permissions.md",
      heading_path: ["Permissions", "Request context caching"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Request context caching",
      body: "Permission checks cache request-scoped decisions.",
      token_count: 40,
      content_hash: "permission-root",
      start_line: 1,
      end_line: 8,
      scope: { layer: "module", project: "auth", module: "permissions", source: {} },
      status: "current",
    };

    result.chunksByVersionId.set(sessionChunk.version_id, sessionChunk);
    result.chunksByVersionId.set(tokenChunk.version_id, tokenChunk);
    result.chunksByVersionId.set(permissionChunk.version_id, permissionChunk);
    result.pack.included = [
      {
        version_id: "permission-root",
        bm25_norm: 0.9,
        heading_match: 0.35,
        scope_match: 1,
        mention_overlap: 0.1,
        specificity: 1.3,
        text_score: 0.79,
        final_score: 1.138,
        token_count: 40,
        packing_score: 0.17,
        kind: "doc_chunk",
      },
      {
        version_id: "session-root",
        bm25_norm: 1,
        heading_match: 0.4,
        scope_match: 0.6,
        mention_overlap: 0,
        specificity: 1.2,
        text_score: 1.12,
        final_score: 1.63,
        token_count: 40,
        packing_score: 0.258,
        kind: "doc_chunk",
      },
      {
        version_id: "token-root",
        bm25_norm: 0.7,
        heading_match: 0.2,
        scope_match: 1,
        mention_overlap: 0.1,
        specificity: 1.2,
        text_score: 0.55,
        final_score: 0.66,
        token_count: 40,
        packing_score: 0.12,
        kind: "doc_chunk",
      },
    ];
    result.pack.budget = { requested: 6000, used: 120, locked_overhead: 0 };

    const out = presentContextPack({
      query: "auth session token and permission management",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: false,
    });

    expect(out.ranked[0]?.kind).toBe("chunk");
    expect(out.ranked[0]?.id).toBe("token-root");
  });

  it("prefers the earlier file-backed module when file-only multi-scope docs tie on support", () => {
    const result = emptyResult();
    result.query_mode = "anchored";
    result.query_compilation = {
      query_mode: "anchored",
      provided_anchor_count: 3,
      recognized_anchor_count: 3,
      anchors: [
        {
          anchor: { kind: "file", value: "src/payments/refund.ts" },
          recognition: "scope_inferred",
          mode: "anchor_derived",
          scopes: [{ project: "payments" }, { project: "payments", module: "refunds" }],
          contributing_anchors: [{ object_id: "refund-root", kind: "chunk", value: "src/payments/refund.ts", confidence: "high" }],
        },
        {
          anchor: { kind: "file", value: "src/payments/reconciliation.ts" },
          recognition: "scope_inferred",
          mode: "anchor_derived",
          scopes: [{ project: "payments" }, { project: "payments", module: "reconciliation" }],
          contributing_anchors: [{ object_id: "reconciliation-root", kind: "chunk", value: "src/payments/reconciliation.ts", confidence: "high" }],
        },
        {
          anchor: { kind: "file", value: "src/payments/audit.ts" },
          recognition: "scope_inferred",
          mode: "anchor_derived",
          scopes: [{ project: "payments" }, { project: "payments", module: "audit" }],
          contributing_anchors: [{ object_id: "audit-root", kind: "chunk", value: "src/payments/audit.ts", confidence: "high" }],
        },
      ],
    };

    const refundChunk: DocChunk = {
      version_id: "refund-root",
      stable_key: "refund-root",
      source_path: "docs/payments/refunds.md",
      heading_path: ["Refunds", "Partial refunds"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Partial refunds",
      body: "Refund rules",
      token_count: 40,
      content_hash: "refund-root",
      start_line: 1,
      end_line: 8,
      scope: { layer: "module", project: "payments", module: "refunds", source: {} },
      status: "current",
    };
    const reconciliationChunk: DocChunk = {
      version_id: "reconciliation-root",
      stable_key: "reconciliation-root",
      source_path: "docs/payments/reconciliation.md",
      heading_path: ["Refund reconciliation"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Refund reconciliation",
      body: "Reconciliation rules",
      token_count: 40,
      content_hash: "reconciliation-root",
      start_line: 1,
      end_line: 8,
      scope: { layer: "module", project: "payments", module: "reconciliation", source: {} },
      status: "current",
    };
    const auditChunk: DocChunk = {
      version_id: "audit-root",
      stable_key: "audit-root",
      source_path: "docs/payments/audit.md",
      heading_path: ["Payment audit logging"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Payment audit logging",
      body: "Audit logging rules",
      token_count: 40,
      content_hash: "audit-root",
      start_line: 1,
      end_line: 8,
      scope: { layer: "module", project: "payments", module: "audit", source: {} },
      status: "current",
    };
    result.chunksByVersionId.set(refundChunk.version_id, refundChunk);
    result.chunksByVersionId.set(reconciliationChunk.version_id, reconciliationChunk);
    result.chunksByVersionId.set(auditChunk.version_id, auditChunk);
    result.pack.included = [
      {
        version_id: "reconciliation-root",
        bm25_norm: 1,
        heading_match: 0.5,
        scope_match: 1,
        mention_overlap: 0.33,
        specificity: 1.4,
        text_score: 0.8,
        final_score: 2.41,
        token_count: 40,
        packing_score: 0.24,
        kind: "doc_chunk",
      },
      {
        version_id: "audit-root",
        bm25_norm: 0.8,
        heading_match: 0.4,
        scope_match: 1,
        mention_overlap: 0.33,
        specificity: 1.4,
        text_score: 0.51,
        final_score: 1.55,
        token_count: 40,
        packing_score: 0.18,
        kind: "doc_chunk",
      },
      {
        version_id: "refund-root",
        bm25_norm: 0.6,
        heading_match: 0.2,
        scope_match: 1,
        mention_overlap: 0.33,
        specificity: 1.4,
        text_score: 0.43,
        final_score: 1.28,
        token_count: 40,
        packing_score: 0.16,
        kind: "doc_chunk",
      },
    ];
    result.pack.budget = { requested: 6000, used: 120, locked_overhead: 0 };

    const out = presentContextPack({
      query: "payment refund reconciliation and audit",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: false,
    });

    expect(out.ranked[0]?.kind).toBe("chunk");
    expect(out.ranked[0]?.id).toBe("refund-root");
  });

  it("prefers route-backed module chunks over symbol-backed chunks for route-plus-symbol queries", () => {
    const result = emptyResult();
    result.query_mode = "anchored";
    result.query_compilation = {
      query_mode: "anchored",
      provided_anchor_count: 2,
      recognized_anchor_count: 2,
      anchors: [
        {
          anchor: { kind: "symbol", value: "TokenStore.revoke" },
          recognition: "scope_inferred",
          mode: "anchor_derived",
          scopes: [
            { project: "auth", module: "tokens" },
            { project: "auth" },
          ],
          contributing_anchors: [
            { object_id: "token-example", kind: "chunk", value: "TokenStore.revoke", confidence: "high" },
          ],
        },
        {
          anchor: { kind: "route", value: "POST /sessions/:id/renew" },
          recognition: "scope_inferred",
          mode: "anchor_derived",
          scopes: [
            { project: "auth", module: "sessions" },
            { project: "general" },
          ],
          contributing_anchors: [
            { object_id: "route-example", kind: "chunk", value: "POST /sessions/:id/renew", confidence: "high" },
          ],
        },
      ],
    };

    const tokenChunk: DocChunk = {
      version_id: "token-rotation",
      stable_key: "token-rotation",
      source_path: "docs/auth/tokens.md",
      heading_path: ["API tokens", "Rotation"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Rotation",
      body: "Rotation revokes the old token and issues a new one.",
      token_count: 45,
      content_hash: "token-rotation",
      start_line: 1,
      end_line: 8,
      scope: { layer: "module", project: "auth", module: "tokens", source: {} },
      status: "current",
    };
    const sessionChunk: DocChunk = {
      version_id: "session-renewal",
      stable_key: "session-renewal",
      source_path: "docs/auth/sessions.md",
      heading_path: ["Session management", "Renewal"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Renewal",
      body: "Renewal extends the TTL and preserves the existing session token.",
      token_count: 28,
      content_hash: "session-renewal",
      start_line: 1,
      end_line: 6,
      scope: { layer: "module", project: "auth", module: "sessions", source: {} },
      status: "current",
    };
    result.chunksByVersionId.set(tokenChunk.version_id, tokenChunk);
    result.chunksByVersionId.set(sessionChunk.version_id, sessionChunk);
    result.pack.included = [
      {
        version_id: "token-rotation",
        bm25_norm: 0.8,
        heading_match: 0.14,
        scope_match: 1,
        mention_overlap: 0.5,
        specificity: 1.4,
        text_score: 0.61,
        final_score: 2.02,
        token_count: 45,
        packing_score: 0.25,
        kind: "doc_chunk",
      },
      {
        version_id: "session-renewal",
        bm25_norm: 0.73,
        heading_match: 0.14,
        scope_match: 1,
        mention_overlap: 0.5,
        specificity: 1.4,
        text_score: 0.55,
        final_score: 1.84,
        token_count: 28,
        packing_score: 0.35,
        kind: "doc_chunk",
      },
    ];
    result.pack.budget = { requested: 6000, used: 90, locked_overhead: 0 };

    const out = presentContextPack({
      query: "revoke token and invalidate session atomically",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: false,
    });

    expect(out.ranked[0]?.kind).toBe("chunk");
    expect(out.ranked[0]?.id).toBe("session-renewal");
  });

  it("prefers a topic-matching doc over a card for unanchored broad queries", () => {
    const result = emptyResult();
    result.query_mode = "unanchored";

    const sessionChunk: DocChunk = {
      version_id: "session-root",
      stable_key: "session-root",
      source_path: "docs/auth/sessions.md",
      heading_path: ["Session management", "Renewal"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Renewal",
      body: "Renewal extends the TTL but does not rotate the session token.",
      token_count: 28,
      content_hash: "session-root",
      start_line: 1,
      end_line: 6,
      scope: { layer: "module", project: "auth", module: "sessions", source: {} },
      status: "current",
    };
    const sessionCard: Card = {
      id: "C003",
      type: "constraint",
      title: "Session renewal preserves token identity",
      body: "Session renewal extends TTL without rotating the session token.",
      freshness_state: "verified",
      freshness_reason: "unchanged_since_review",
      author_review_state: "reviewed",
      scope: { layer: "project", project: "auth" },
      updated_by: "tester",
      updated_at: "2026-05-07T00:00:00.000Z",
    };

    result.chunksByVersionId.set(sessionChunk.version_id, sessionChunk);
    result.cardsByCardId.set(sessionCard.id, sessionCard);
    result.pack.included = [
      {
        version_id: sessionChunk.version_id,
        bm25_norm: 0.75,
        heading_match: 0.3,
        scope_match: 1,
        mention_overlap: 0.4,
        specificity: 1.4,
        text_score: 0.68,
        final_score: 1.06,
        token_count: 28,
        packing_score: 0.28,
        kind: "doc_chunk",
      },
      {
        version_id: sessionCard.id,
        card_id: sessionCard.id,
        bm25_norm: 1,
        heading_match: 0,
        scope_match: 0.6,
        mention_overlap: 0.4,
        specificity: 1.2,
        text_score: 0.8,
        final_score: 1.24,
        token_count: 18,
        packing_score: 0.19,
        kind: "card",
      },
    ];
    result.pack.budget = { requested: 6000, used: 60, locked_overhead: 0 };

    const out = presentContextPack({
      query: "renew an existing session",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: false,
    });

    expect(out.ranked[0]?.kind).toBe("chunk");
    expect(out.ranked[0]?.id).toBe("session-root");
  });

  it("prefers the more topic-aligned doc for unanchored webhook queries", () => {
    const result = emptyResult();
    result.query_mode = "unanchored";

    const webhookChunk: DocChunk = {
      version_id: "webhook-root",
      stable_key: "webhook-root",
      source_path: "docs/notifications/webhooks.md",
      heading_path: ["Webhooks", "Deduplication"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Deduplication",
      body: "Endpoints must tolerate duplicate webhook deliveries.",
      token_count: 32,
      content_hash: "webhook-root",
      start_line: 1,
      end_line: 8,
      scope: { layer: "module", project: "notifications", module: "webhooks", source: {} },
      status: "current",
    };
    const reconciliationChunk: DocChunk = {
      version_id: "reconciliation-root",
      stable_key: "reconciliation-root",
      source_path: "docs/payments/reconciliation.md",
      heading_path: ["Refund reconciliation", "Duplicate refund handling"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Duplicate refund handling",
      body: "Duplicate refunds are correlated against the original ledger entry.",
      token_count: 34,
      content_hash: "reconciliation-root",
      start_line: 1,
      end_line: 8,
      scope: { layer: "module", project: "payments", module: "reconciliation", source: {} },
      status: "current",
    };

    result.chunksByVersionId.set(webhookChunk.version_id, webhookChunk);
    result.chunksByVersionId.set(reconciliationChunk.version_id, reconciliationChunk);
    result.pack.included = [
      {
        version_id: reconciliationChunk.version_id,
        bm25_norm: 1,
        heading_match: 0.6,
        scope_match: 0.6,
        mention_overlap: 0,
        specificity: 1.4,
        text_score: 0.75,
        final_score: 1.12,
        token_count: 34,
        packing_score: 0.24,
        kind: "doc_chunk",
      },
      {
        version_id: webhookChunk.version_id,
        bm25_norm: 0.7,
        heading_match: 0.3,
        scope_match: 0.6,
        mention_overlap: 0,
        specificity: 1.4,
        text_score: 0.48,
        final_score: 0.68,
        token_count: 32,
        packing_score: 0.16,
        kind: "doc_chunk",
      },
    ];
    result.pack.budget = { requested: 6000, used: 66, locked_overhead: 0 };

    const out = presentContextPack({
      query: "duplicate webhook event handling",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: false,
    });

    expect(out.ranked[0]?.kind).toBe("chunk");
    expect(out.ranked[0]?.id).toBe("webhook-root");
  });

  it("preserves top-1 and diversifies the tail for unanchored broad queries", () => {
    const result = emptyResult();
    result.query_mode = "unanchored";

    const refundPrimary: DocChunk = {
      version_id: "refund-primary",
      stable_key: "refund-primary",
      source_path: "docs/payments/refunds.md",
      heading_path: ["Refunds", "Partial refunds"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Partial refunds",
      body: "Partial refund behavior.",
      token_count: 30,
      content_hash: "refund-primary",
      start_line: 1,
      end_line: 6,
      scope: { layer: "module", project: "payments", module: "refunds", source: {} },
      status: "current",
    };
    const refundSecondary: DocChunk = {
      version_id: "refund-secondary",
      stable_key: "refund-secondary",
      source_path: "docs/payments/refunds.md",
      heading_path: ["Refunds", "Edge cases"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Edge cases",
      body: "Refund edge cases.",
      token_count: 30,
      content_hash: "refund-secondary",
      start_line: 7,
      end_line: 12,
      scope: { layer: "module", project: "payments", module: "refunds", source: {} },
      status: "current",
    };
    const refundCard: Card = {
      id: "S001",
      type: "symbol_note",
      title: "RefundService.processRefund is idempotent",
      body: "Second attempt returns the existing refund record.",
      freshness_state: "verified",
      freshness_reason: "unchanged_since_review",
      author_review_state: "reviewed",
      scope: { layer: "module", project: "payments", module: "refunds" },
      updated_by: "tester",
      updated_at: "2026-05-07T00:00:00.000Z",
    };

    result.chunksByVersionId.set(refundPrimary.version_id, refundPrimary);
    result.chunksByVersionId.set(refundSecondary.version_id, refundSecondary);
    result.cardsByCardId.set(refundCard.id, refundCard);
    result.pack.included = [
      {
        version_id: refundPrimary.version_id,
        bm25_norm: 0.9,
        heading_match: 0.4,
        scope_match: 0.6,
        mention_overlap: 0,
        specificity: 1.4,
        text_score: 0.7,
        final_score: 1.05,
        token_count: 30,
        packing_score: 0.3,
        kind: "doc_chunk",
      },
      {
        version_id: refundSecondary.version_id,
        bm25_norm: 0.7,
        heading_match: 0.25,
        scope_match: 0.6,
        mention_overlap: 0,
        specificity: 1.4,
        text_score: 0.45,
        final_score: 0.72,
        token_count: 30,
        packing_score: 0.2,
        kind: "doc_chunk",
      },
      {
        version_id: refundCard.id,
        card_id: refundCard.id,
        bm25_norm: 0.65,
        heading_match: 0,
        scope_match: 0.6,
        mention_overlap: 0,
        specificity: 1.2,
        text_score: 0.5,
        final_score: 0.68,
        token_count: 16,
        packing_score: 0.18,
        kind: "card",
      },
    ];
    result.pack.budget = { requested: 6000, used: 76, locked_overhead: 0 };

    const out = presentContextPack({
      query: "partial refund twice returns existing record",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: false,
    });

    expect(out.ranked.map((entry) => entry.id).slice(0, 3)).toEqual([
      "refund-primary",
      "S001",
      "refund-secondary",
    ]);
  });

  it("demotes non-locked cards below docs for anchored multi-scope first-read ranking", () => {
    const result = emptyResult();
    result.query_mode = "anchored";
    result.query_compilation = {
      query_mode: "anchored",
      provided_anchor_count: 3,
      recognized_anchor_count: 3,
      anchors: [
        {
          anchor: { kind: "file", value: "src/auth/sessions.ts" },
          recognition: "scope_inferred",
          mode: "anchor_derived",
          scopes: [{ project: "auth" }],
          contributing_anchors: [{ object_id: "C007", kind: "card", value: "src/auth/sessions.ts", confidence: "high" }],
        },
        {
          anchor: { kind: "file", value: "src/auth/tokens.ts" },
          recognition: "scope_inferred",
          mode: "anchor_derived",
          scopes: [{ project: "auth", module: "tokens" }, { project: "auth" }],
          contributing_anchors: [
            { object_id: "C006", kind: "card", value: "src/auth/tokens.ts", confidence: "high" },
            { object_id: "C007", kind: "card", value: "src/auth/tokens.ts", confidence: "high" },
          ],
        },
        {
          anchor: { kind: "file", value: "src/auth/permissions.ts" },
          recognition: "scope_inferred",
          mode: "anchor_derived",
          scopes: [{ project: "auth" }, { project: "auth", module: "permissions" }],
          contributing_anchors: [{ object_id: "C007", kind: "card", value: "src/auth/permissions.ts", confidence: "high" }],
        },
      ],
    };

    const sessionChunk: DocChunk = {
      version_id: "session-root",
      stable_key: "session-root",
      source_path: "docs/auth/sessions.md",
      heading_path: ["Session management"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Session management",
      body: "Session rules",
      token_count: 40,
      content_hash: "session-root",
      start_line: 1,
      end_line: 8,
      scope: { layer: "project", project: "auth", source: {} },
      status: "current",
    };
    const tokenChunk: DocChunk = {
      version_id: "token-root",
      stable_key: "token-root",
      source_path: "docs/auth/tokens.md",
      heading_path: ["API tokens"],
      chunk_index: 1,
      chunk_count: 1,
      title: "API tokens",
      body: "Token lifecycle rules",
      token_count: 40,
      content_hash: "token-root",
      start_line: 1,
      end_line: 8,
      scope: { layer: "module", project: "auth", module: "tokens", source: {} },
      status: "current",
    };
    const sessionCard: Card = {
      id: "C003",
      type: "constraint",
      title: "Session renewal preserves token identity",
      body: "Session renewal extends TTL without rotating the session token.",
      authority: "accepted",
      scope: { layer: "module", project: "auth", module: "sessions", source: {} },
      symbol_anchors: ["SessionStore.get"],
      file_anchors: [],
      links: [],
      freshness_state: "verified",
      freshness_reason: "all_links_current",
      author_review_state: "approved",
      token_count: 28,
      source_path: ".contexttrail/cards/c-auth.md",
      source_hash: "c-auth",
      updated_at: "2026-01-01T00:00:00Z",
    };

    result.chunksByVersionId.set(sessionChunk.version_id, sessionChunk);
    result.chunksByVersionId.set(tokenChunk.version_id, tokenChunk);
    result.cardsByCardId.set(sessionCard.id, sessionCard);
    result.pack.included = [
      {
        version_id: "C003",
        bm25_norm: 1,
        heading_match: 0,
        scope_match: 1,
        mention_overlap: 0.5,
        specificity: 1.4,
        text_score: 1.32,
        final_score: 1.849,
        token_count: 28,
        packing_score: 0.66,
        kind: "card",
        card_id: "C003",
        card_type: "constraint",
      },
      {
        version_id: "session-root",
        bm25_norm: 1,
        heading_match: 0.4,
        scope_match: 0.6,
        mention_overlap: 0,
        specificity: 1.2,
        text_score: 1.12,
        final_score: 1.63,
        token_count: 40,
        packing_score: 0.258,
        kind: "doc_chunk",
      },
      {
        version_id: "token-root",
        bm25_norm: 0.7,
        heading_match: 0.2,
        scope_match: 1,
        mention_overlap: 0.1,
        specificity: 1.2,
        text_score: 0.55,
        final_score: 0.66,
        token_count: 40,
        packing_score: 0.12,
        kind: "doc_chunk",
      },
    ];
    result.pack.budget = { requested: 6000, used: 148, locked_overhead: 0 };

    const out = presentContextPack({
      query: "auth session token and permission management",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: false,
    });

    expect(out.ranked[0]?.kind).toBe("chunk");
  });

  it("prefers ADR chunks for unanchored rationale-style queries when scores are close", () => {
    const result = emptyResult();
    result.query_mode = "unanchored";

    const adrChunk: DocChunk = {
      version_id: "adr-root",
      stable_key: "adr-root",
      source_path: "docs/adr/0002-webhook-idempotency.md",
      heading_path: ["ADR-0002: Webhook delivery uses at-least-once semantics"],
      chunk_index: 1,
      chunk_count: 1,
      title: "ADR-0002",
      body: "Decision and rationale for webhook delivery semantics.",
      token_count: 55,
      content_hash: "adr-root",
      start_line: 1,
      end_line: 10,
      scope: { layer: "project", project: "notifications", source: {} },
      status: "current",
    };
    result.chunksByVersionId.set(adrChunk.version_id, adrChunk);

    const webhookCard: Card = {
      id: "S004",
      type: "symbol_note",
      title: "WebhookDispatcher.dispatch writes attempt before sending",
      body: "Writes the delivery attempt record before the HTTP call.",
      authority: "accepted",
      scope: { layer: "module", project: "notifications", module: "webhooks", source: {} },
      symbol_anchors: ["WebhookDispatcher.dispatch"],
      file_anchors: [],
      links: [],
      freshness_state: "verified",
      freshness_reason: "all_links_current",
      author_review_state: "approved",
      token_count: 26,
      source_path: ".contexttrail/cards/s-webhook.md",
      source_hash: "s-webhook",
      updated_at: "2026-01-01T00:00:00Z",
    };
    result.cardsByCardId.set(webhookCard.id, webhookCard);
    result.pack.included = [
      {
        version_id: "S004",
        bm25_norm: 1,
        heading_match: 0,
        scope_match: 0,
        mention_overlap: 0.5,
        specificity: 1.4,
        text_score: 0.98,
        final_score: 1.176,
        token_count: 26,
        packing_score: 0.452,
        kind: "card",
        card_id: "S004",
        card_type: "symbol_note",
      },
      {
        version_id: "adr-root",
        bm25_norm: 0.8,
        heading_match: 0.7,
        scope_match: 0,
        mention_overlap: 0.2,
        specificity: 1.1,
        text_score: 0.953,
        final_score: 0.953,
        token_count: 55,
        packing_score: 0.173,
        kind: "doc_chunk",
      },
    ];
    result.pack.budget = { requested: 6000, used: 81, locked_overhead: 0 };

    const out = presentContextPack({
      query: "what decision governs webhook delivery semantics",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: false,
    });

    expect(out.ranked[0]?.kind).toBe("chunk");
    expect(out.ranked[0]?.id).toBe("adr-root");
  });

  it("diversifies top results for rationale queries after the first ADR chunk", () => {
    const result = emptyResult();
    result.query_mode = "unanchored";

    const adrRoot: DocChunk = {
      version_id: "adr-root",
      stable_key: "adr-root",
      source_path: "docs/adr/0002-webhook-idempotency.md",
      heading_path: ["ADR-0002: Webhook delivery uses at-least-once semantics"],
      chunk_index: 1,
      chunk_count: 1,
      title: "ADR-0002",
      body: "Decision and rationale for webhook delivery semantics.",
      token_count: 55,
      content_hash: "adr-root",
      start_line: 1,
      end_line: 10,
      scope: { layer: "project", project: "notifications", source: {} },
      status: "current",
    };
    const adrConsequences: DocChunk = {
      version_id: "adr-consequences",
      stable_key: "adr-consequences",
      source_path: "docs/adr/0002-webhook-idempotency.md",
      heading_path: ["ADR-0002: Webhook delivery uses at-least-once semantics", "Consequences"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Consequences",
      body: "Operational consequences for the decision.",
      token_count: 55,
      content_hash: "adr-consequences",
      start_line: 11,
      end_line: 18,
      scope: { layer: "project", project: "notifications", source: {} },
      status: "current",
    };
    const webhookDoc: DocChunk = {
      version_id: "webhooks-root",
      stable_key: "webhooks-root",
      source_path: "docs/notifications/webhooks.md",
      heading_path: ["Webhooks"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Webhooks",
      body: "Webhook delivery behavior.",
      token_count: 42,
      content_hash: "webhooks-root",
      start_line: 1,
      end_line: 8,
      scope: { layer: "module", project: "notifications", module: "webhooks", source: {} },
      status: "current",
    };
    result.chunksByVersionId.set(adrRoot.version_id, adrRoot);
    result.chunksByVersionId.set(adrConsequences.version_id, adrConsequences);
    result.chunksByVersionId.set(webhookDoc.version_id, webhookDoc);

    const webhookCard: Card = {
      id: "S004",
      type: "symbol_note",
      title: "WebhookDispatcher.dispatch writes attempt before sending",
      body: "Writes the delivery attempt record before the HTTP call.",
      authority: "accepted",
      scope: { layer: "module", project: "notifications", module: "webhooks", source: {} },
      symbol_anchors: ["WebhookDispatcher.dispatch"],
      file_anchors: [],
      links: [],
      freshness_state: "verified",
      freshness_reason: "all_links_current",
      author_review_state: "approved",
      token_count: 26,
      source_path: ".contexttrail/cards/s-webhook.md",
      source_hash: "s-webhook",
      updated_at: "2026-01-01T00:00:00Z",
    };
    result.cardsByCardId.set(webhookCard.id, webhookCard);

    result.pack.included = [
      {
        version_id: "S004",
        bm25_norm: 1,
        heading_match: 0,
        scope_match: 0,
        mention_overlap: 0.5,
        specificity: 1.4,
        text_score: 0.98,
        final_score: 1.176,
        token_count: 26,
        packing_score: 0.452,
        kind: "card",
        card_id: "S004",
        card_type: "symbol_note",
      },
      {
        version_id: "adr-root",
        bm25_norm: 0.8,
        heading_match: 0.7,
        scope_match: 0,
        mention_overlap: 0.2,
        specificity: 1.1,
        text_score: 0.953,
        final_score: 0.953,
        token_count: 55,
        packing_score: 0.173,
        kind: "doc_chunk",
      },
      {
        version_id: "adr-consequences",
        bm25_norm: 0.7,
        heading_match: 0.4,
        scope_match: 0,
        mention_overlap: 0.2,
        specificity: 1.1,
        text_score: 0.778,
        final_score: 0.778,
        token_count: 55,
        packing_score: 0.141,
        kind: "doc_chunk",
      },
      {
        version_id: "webhooks-root",
        bm25_norm: 0.65,
        heading_match: 0.2,
        scope_match: 0,
        mention_overlap: 0.1,
        specificity: 1.1,
        text_score: 0.756,
        final_score: 0.756,
        token_count: 42,
        packing_score: 0.18,
        kind: "doc_chunk",
      },
    ];
    result.pack.budget = { requested: 6000, used: 178, locked_overhead: 0 };

    const out = presentContextPack({
      query: "what decision governs webhook delivery semantics",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: false,
    });

    expect(out.ranked.map((entry) => entry.id).slice(0, 3)).toEqual([
      "adr-root",
      "S004",
      "webhooks-root",
    ]);
  });

  it("includes locked Cards with full metadata", () => {
    const result = emptyResult();
    const card: Card = {
      id: "card_001",
      type: "constraint",
      title: "Refunds must emit audit",
      body: "Refunds must emit an audit event.",
      authority: "accepted",
      scope: { layer: "module", module: "fundops/ledger", source: {} },
      symbol_anchors: [],
      file_anchors: [],
      links: [],
      freshness_state: "verified",
      freshness_reason: "all_links_current",
      author_review_state: "unreviewed",
      token_count: 8,
      source_path: ".contexttrail/cards/card_001.md",
      source_hash: "h",
      updated_at: "2026-01-01T00:00:00Z",
    };
    result.cardsByCardId.set("card_001", card);
    result.pack.locked = [
      {
        version_id: "card_001",
        bm25_norm: 0,
        heading_match: 0,
        scope_match: 0,
        mention_overlap: 0,
        specificity: 1,
        text_score: 0,
        final_score: 0,
        token_count: 8,
        packing_score: 0,
        kind: "card",
        card_id: "card_001",
        card_type: "constraint",
        lock_reason: {
          card_id: "card_001",
          kind: "constraint_scope_match",
          scope_match_path: "project:fundops -> module:fundops/ledger",
          broad_scope: false,
        },
      },
    ];
    result.pack.budget = { requested: 6000, used: 8, locked_overhead: 0 };

    const out = presentContextPack({
      query: "x",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: false,
    });
    expect(out.locked.length).toBe(1);
    const l = out.locked[0]!;
    expect(l.id).toBe("card_001");
    expect(l.kind).toBe("card");
    expect(l.card_type).toBe("constraint");
    expect(l.body).toBe("Refunds must emit an audit event.");
    expect(l.tokens).toBe(8);
    expect(l.lock_reason).toBe("constraint_scope_match");
    expect(l.broad_scope).toBe(false);
    expect(l.freshness_state).toBe("verified");
  });

  it("maps internal symbol_note_exact → wire symbol_note_exact", () => {
    const result = emptyResult();
    const card: Card = {
      id: "card_sym",
      type: "symbol_note",
      title: "RefundService idempotent",
      body: "...",
      authority: "accepted",
      scope: { layer: "module", source: {} },
      symbol_anchors: ["RefundService.processRefund"],
      file_anchors: [],
      links: [],
      freshness_state: "verified",
      freshness_reason: "all_links_current",
      author_review_state: "unreviewed",
      token_count: 5,
      source_path: ".contexttrail/cards/card_sym.md",
      source_hash: "h",
      updated_at: "2026-01-01T00:00:00Z",
    };
    result.cardsByCardId.set("card_sym", card);
    result.pack.locked = [
      {
        version_id: "card_sym",
        bm25_norm: 0, heading_match: 0, scope_match: 0, mention_overlap: 0,
        specificity: 1, text_score: 0, final_score: 0, token_count: 5, packing_score: 0,
        kind: "card", card_id: "card_sym", card_type: "symbol_note",
        lock_reason: { card_id: "card_sym", kind: "symbol_note_exact", matched_symbol: "RefundService.processRefund" },
      },
    ];
    const out = presentContextPack({
      query: "x", result, requested_budget: 6000, has_sources: true, explain: false,
    });
    expect(out.locked[0]!.lock_reason).toBe("symbol_note_exact");
  });

  it("maps promoted evidence lock reason and derived_from provenance", () => {
    const result = emptyResult();
    const card: Card = {
      id: "evidence_001",
      type: "evidence",
      title: "Refund test evidence",
      body: "npm test passed.",
      authority: "accepted",
      scope: { layer: "module", source: {} },
      symbol_anchors: [],
      file_anchors: [],
      links: [],
      command: "npm test",
      covers: ["card_001"],
      freshness_state: "verified",
      freshness_reason: "all_links_current",
      author_review_state: "unreviewed",
      token_count: 5,
      source_path: ".contexttrail/cards/evidence_001.md",
      source_hash: "h",
      updated_at: "2026-01-01T00:00:00Z",
    };
    result.cardsByCardId.set("evidence_001", card);
    result.pack.locked = [
      {
        version_id: "evidence_001",
        bm25_norm: 0, heading_match: 0, scope_match: 0, mention_overlap: 0,
        specificity: 1, text_score: 0, final_score: 0, token_count: 5, packing_score: 0,
        kind: "card", card_id: "evidence_001", card_type: "evidence",
        lock_reason: {
          card_id: "evidence_001",
          kind: "evidence_covers_locked",
          derived_from: ["card_001"],
        },
      },
    ];

    const out = presentContextPack({
      query: "x", result, requested_budget: 6000, has_sources: true, explain: false,
    });

    expect(out.locked[0]!.lock_reason).toBe("evidence_covers_locked");
    expect(out.locked[0]!.derived_from).toEqual(["card_001"]);
  });

  it("propagates locked_overflow from pack warnings", () => {
    const result = emptyResult();
    result.pack.warnings = [
      { kind: "locked_overflow", message: "Locked content exceeds budget by 100 tokens." },
    ];
    result.pack.budget = { requested: 100, used: 200, locked_overhead: 100 };

    const out = presentContextPack({
      query: "x", result, requested_budget: 100, has_sources: true, explain: false,
    });
    expect(out.warnings.map((w) => w.kind)).toContain("locked_overflow");
    expect(out.budget.locked_overhead).toBe(100);
  });

  it("filters internal-only warning kinds (freshness/tombstoned_link) from wire output", () => {
    const result = emptyResult();
    result.pack.warnings = [
      { kind: "freshness", message: "x" },
      { kind: "tombstoned_link", message: "y" },
    ];
    const out = presentContextPack({
      query: "x", result, requested_budget: 6000, has_sources: true, explain: false,
    });
    for (const w of out.warnings) {
      expect(["no_matches", "no_sources", "locked_overflow"]).toContain(w.kind);
    }
  });

  it("populates explain block when requested", () => {
    const result = emptyResult();
    const c: DocChunk = {
      version_id: "v1", stable_key: "k1", source_path: "x", heading_path: ["A"],
      chunk_index: 1, chunk_count: 1, title: "A", body: "x", token_count: 1,
      content_hash: "h", start_line: 1, end_line: 1,
      scope: { layer: "module", source: {} }, status: "current",
    };
    result.chunksByVersionId.set("v1", c);
    result.pack.included = [{
      version_id: "v1", bm25_norm: 0.5, heading_match: 0.4, scope_match: 0.3,
      mention_overlap: 0.2, specificity: 1.2, text_score: 0.5, final_score: 1.0,
      token_count: 1, packing_score: 1.0, kind: "doc_chunk",
      structural_multiplier: 0.1,
      doc_role: "ideation", role_source: "config_pattern", role_multiplier: 0.5,
    }];
    const withExplain = presentContextPack({
      query: "x", result, requested_budget: 6000, has_sources: true, explain: true,
    });
    expect(withExplain.explain).toBeDefined();
    expect(withExplain.explain!.per_chunk.length).toBe(1);
    expect(withExplain.explain!.per_chunk[0]!.bm25_norm).toBe(0.5);
    expect(withExplain.explain!.per_chunk[0]!.doc_role).toBe("ideation");
    expect(withExplain.explain!.per_chunk[0]!.role_source).toBe("config_pattern");
    expect(withExplain.explain!.per_chunk[0]!.role_multiplier).toBe(0.5);
    expect(withExplain.explain!.per_chunk[0]!.structural_multiplier).toBe(0.1);
    expect(withExplain.explain!.query_compilation.query_mode).toBe("unanchored");

    const withoutExplain = presentContextPack({
      query: "x", result, requested_budget: 6000, has_sources: true, explain: false,
    });
    expect(withoutExplain.explain).toBeUndefined();
  });

  it("emits lock_failures in explain output", () => {
    const result = emptyResult();
    result.lock_failures = [
      {
        card_id: "C001",
        card_type: "constraint",
        candidate_match_path: "project:fundops -> module:payments",
        failed_reason: "scope_mismatch",
        detail: "constraint scope did not cover any inferred query scope",
      },
    ];

    const out = presentContextPack({
      query: "x",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: true,
    });

    expect(out.explain!.lock_failures).toEqual(result.lock_failures);
    expect(schemas.retrieve_context_pack.output.safeParse(out).success).toBe(true);
  });

  it("rendered_text matches the CLI text rendering when opt-in (ADR-0012)", () => {
    const result = emptyResult();
    const out = presentContextPack({
      query: "x", result, requested_budget: 6000, has_sources: true, explain: false,
      include_rendered_text: true,
    });
    expect(out.rendered_text).toMatch(/Context Pack/);
  });

  it("rendered_text is omitted by default (ADR-0012)", () => {
    const result = emptyResult();
    const out = presentContextPack({
      query: "x", result, requested_budget: 6000, has_sources: true, explain: false,
    });
    expect(out.rendered_text).toBeUndefined();
  });

  it("uses the structured safety-net flag instead of inferring no-signal from prose", () => {
    const result = emptyResult();
    result.pack.safety_net_engaged = true;
    result.pack.included = [
      {
        version_id: "v1",
        bm25_norm: 0,
        heading_match: 0,
        scope_match: 0,
        mention_overlap: 0,
        specificity: 1,
        text_score: 0,
        final_score: 0,
        token_count: 5,
        packing_score: 0,
        kind: "doc_chunk",
      },
    ];

    const out = presentContextPack({
      query: "x",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: false,
    });

    expect(out.ranked).toEqual([]);
    expect(out.omitted).toEqual({
      total: 1,
      by_reason: { below_threshold: 1 },
      top: [{ id: "v1", kind: "chunk", reason: "below_threshold", score: 0 }],
      truncated: false,
    });
    expect(out.warnings.map((w) => w.kind)).toContain("no_matches");
  });

  it("emits anchors_unrecognized for signal-empty retrieval", () => {
    const result = emptyResult();
    result.query_mode = "signal_empty";
    result.query_compilation = {
      query_mode: "signal_empty",
      provided_anchor_count: 1,
      recognized_anchor_count: 0,
      anchors: [
        {
          anchor: { kind: "file", value: "src/missing.ts" },
          recognition: "none",
          mode: "none",
          scopes: [],
          contributing_anchors: [],
        },
      ],
    };

    const out = presentContextPack({
      query: "x",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: true,
    });

    expect(out.query_mode).toBe("signal_empty");
    expect(out.warnings.map((w) => w.kind)).toContain("anchors_unrecognized");
    expect(out.explain!.query_compilation.anchors[0]!.anchor.value).toBe("src/missing.ts");
  });

  it("THO-155: includes pack_readiness diagnostics in the explain block", () => {
    const result = emptyResult();
    const c: DocChunk = {
      version_id: "v1",
      stable_key: "k1",
      source_path: "docs/x.md",
      heading_path: ["Glob", "Usage"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Usage",
      body: "use Bun.Glob",
      token_count: 5,
      content_hash: "h",
      start_line: 1,
      end_line: 2,
      scope: { layer: "module", source: {} },
      status: "current",
    };
    result.chunksByVersionId.set("v1", c);
    result.pack.included = [
      {
        version_id: "v1",
        bm25_norm: 0.8,
        heading_match: 0.5,
        scope_match: 0.0,
        mention_overlap: 0.0,
        specificity: 1.4,
        text_score: 0.71,
        final_score: 1.0,
        token_count: 5,
        packing_score: 0.45,
        kind: "doc_chunk",
      },
    ];
    result.pack.budget = { requested: 6000, used: 5, locked_overhead: 0 };

    const out = presentContextPack({
      query: "use Bun.Glob to walk files",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: true,
    });

    expect(out.explain?.pack_readiness).toBeDefined();
    expect(out.explain?.pack_readiness?.state).toMatch(/ready|partial|needs_anchors|unsupported/);
    expect(Array.isArray(out.explain?.pack_readiness?.satisfied_needs)).toBe(true);
    expect(Array.isArray(out.explain?.pack_readiness?.missing_needs)).toBe(true);
    expect(Array.isArray(out.explain?.pack_readiness?.reason_codes)).toBe(true);
  });

  it("THO-155: omits pack_readiness from the response when explain=false", () => {
    const result = emptyResult();
    const out = presentContextPack({
      query: "x",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: false,
    });
    expect(out.explain).toBeUndefined();
  });

  it("THO-156: applyReadinessReorder lifts an intro chunk above a higher-scored leaf in the same source for an overview task", () => {
    const result = emptyResult();
    const intro: DocChunk = {
      version_id: "intro",
      stable_key: "intro-k",
      source_path: "docs/runtime/file-io.md",
      heading_path: ["File I/O"],
      chunk_index: 1,
      chunk_count: 1,
      title: "File I/O",
      body: "intro body",
      token_count: 5,
      content_hash: "h1",
      start_line: 1,
      end_line: 2,
      scope: { layer: "module", source: {} },
      status: "current",
    };
    const leaf: DocChunk = {
      version_id: "leaf",
      stable_key: "leaf-k",
      source_path: "docs/runtime/file-io.md",
      heading_path: ["File I/O", "Benchmarks", "Edge cases"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Edge cases",
      body: "leaf body",
      token_count: 5,
      content_hash: "h2",
      start_line: 3,
      end_line: 4,
      scope: { layer: "module", source: {} },
      status: "current",
    };
    result.chunksByVersionId.set("intro", intro);
    result.chunksByVersionId.set("leaf", leaf);
    // Leaf scored higher by lexical signals, but the orchestrator should
    // recognize an overview need on a "what is X / read and write files"
    // broad-domain task and lift intro to the top of its source.
    result.pack.included = [
      {
        version_id: "leaf",
        bm25_norm: 0.9,
        heading_match: 0.7,
        scope_match: 0.0,
        mention_overlap: 0.0,
        specificity: 1.4,
        text_score: 0.81,
        final_score: 5.0,
        token_count: 5,
        packing_score: 0.9,
        kind: "doc_chunk",
      },
      {
        version_id: "intro",
        bm25_norm: 0.4,
        heading_match: 0.5,
        scope_match: 0.0,
        mention_overlap: 0.0,
        specificity: 1.2,
        text_score: 0.45,
        final_score: 1.0,
        token_count: 5,
        packing_score: 0.45,
        kind: "doc_chunk",
      },
    ];
    result.pack.budget = { requested: 6000, used: 10, locked_overhead: 0 };

    const baseline = presentContextPack({
      query: "what is file I/O in Bun",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: true,
    });
    expect(baseline.ranked.map((r) => r.id)).toEqual(["leaf", "intro"]);

    const reordered = presentContextPack({
      query: "what is file I/O in Bun",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: true,
      applyReadinessReorder: true,
    });
    // Intro is promoted above the leaf within the same source.
    expect(reordered.ranked.map((r) => r.id)).toEqual(["intro", "leaf"]);
  });

  it("THO-156: applyReadinessReorder is a no-op for an exact_symbol task with only a primary selection", () => {
    const result = emptyResult();
    const c: DocChunk = {
      version_id: "v1",
      stable_key: "k1",
      source_path: "docs/runtime/glob.md",
      heading_path: ["Glob"],
      chunk_index: 1,
      chunk_count: 1,
      title: "Glob",
      body: "glob body",
      token_count: 5,
      content_hash: "h",
      start_line: 1,
      end_line: 2,
      scope: { layer: "module", source: {} },
      status: "current",
    };
    result.chunksByVersionId.set("v1", c);
    result.pack.included = [
      {
        version_id: "v1",
        bm25_norm: 0.9,
        heading_match: 0.5,
        scope_match: 0.0,
        mention_overlap: 0.0,
        specificity: 1.4,
        text_score: 0.81,
        final_score: 1.0,
        token_count: 5,
        packing_score: 0.9,
        kind: "doc_chunk",
      },
    ];
    result.pack.budget = { requested: 6000, used: 5, locked_overhead: 0 };

    const out = presentContextPack({
      query: "use Bun.Glob to walk files",
      result,
      requested_budget: 6000,
      has_sources: true,
      explain: true,
      applyReadinessReorder: true,
    });
    expect(out.ranked.map((r) => r.id)).toEqual(["v1"]);
  });
});
