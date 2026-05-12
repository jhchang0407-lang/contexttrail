import { describe, it, expect } from "vitest";
import { schemas } from "./schemas.js";

const baseOutputFields = {
  coverage_confidence: "empty",
  assembly_stage_reached: "not_applicable",
} as const;

describe("retrieve_context_pack input schema", () => {
  it("accepts a minimal valid request (task only)", () => {
    const r = schemas.retrieve_context_pack.input.safeParse({ task: "implement refunds" });
    expect(r.success).toBe(true);
  });

  it("accepts a full request with files, symbols, routes, budget, expected locks, explain", () => {
    const r = schemas.retrieve_context_pack.input.safeParse({
      task: "implement refunds",
      files: ["src/refunds.ts"],
      symbols: ["RefundService.processRefund"],
      routes: ["POST /refunds"],
      budget: "large",
      expected_locked: ["C001", "S001"],
      explain: true,
    });
    expect(r.success).toBe(true);
    expect(r.data.expected_locked).toEqual(["C001", "S001"]);
  });

  it("rejects empty object (task is required)", () => {
    const r = schemas.retrieve_context_pack.input.safeParse({});
    expect(r.success).toBe(false);
  });

  it("rejects unknown budget value", () => {
    const r = schemas.retrieve_context_pack.input.safeParse({ task: "x", budget: "huge" });
    expect(r.success).toBe(false);
  });

  it("rejects non-string task", () => {
    const r = schemas.retrieve_context_pack.input.safeParse({ task: 42 });
    expect(r.success).toBe(false);
  });
});

describe("retrieve_context_pack output schema", () => {
  it("accepts a well-formed empty pack", () => {
    const r = schemas.retrieve_context_pack.output.safeParse({
      ...baseOutputFields,
      rendered_text: "",
      query_mode: "unanchored",
      locked: [],
      ranked: [],
      omitted: { total: 0, by_reason: {}, top: [], truncated: false },
      warnings: [],
      budget: { requested: 0, used: 0, locked_overhead: 0 },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a pack missing the omitted summary (omitted is always present)", () => {
    const r = schemas.retrieve_context_pack.output.safeParse({
      ...baseOutputFields,
      rendered_text: "",
      query_mode: "unanchored",
      locked: [],
      ranked: [],
      warnings: [],
      budget: { requested: 0, used: 0, locked_overhead: 0 },
    });
    expect(r.success).toBe(false);
  });

  it("accepts a pack with locked Card carrying full required fields", () => {
    const r = schemas.retrieve_context_pack.output.safeParse({
      ...baseOutputFields,
      rendered_text: "Locked rules\n- foo\n",
      query_mode: "anchored",
      locked: [
        {
          id: "card_001",
          kind: "card",
          card_type: "constraint",
          scope: { layer: "module", value: "fundops/ledger" },
          tokens: 42,
          body: "Refunds must emit an audit event.",
          contexttrail: "card://fundops/ledger > constraint",
          lock_reason: "constraint_scope_match",
          broad_scope: false,
          freshness_state: "verified",
          freshness_warnings: [],
        },
      ],
      ranked: [],
      omitted: { total: 0, by_reason: {}, top: [], truncated: false },
      warnings: [],
      budget: { requested: 6000, used: 42, locked_overhead: 42 },
    });
    expect(r.success).toBe(true);
  });

  it("accepts promoted evidence with provenance in locked entries", () => {
    const r = schemas.retrieve_context_pack.output.safeParse({
      ...baseOutputFields,
      rendered_text: "",
      query_mode: "anchored",
      locked: [
        {
          id: "E001",
          kind: "card",
          card_type: "evidence",
          scope: { layer: "module", value: "fundops/ledger" },
          tokens: 24,
          body: "Test output proving the rule.",
          contexttrail: "card://fundops/ledger > evidence",
          lock_reason: "evidence_covers_locked",
          derived_from: ["C001"],
          broad_scope: false,
          freshness_state: "verified",
          freshness_warnings: [],
        },
      ],
      ranked: [],
      omitted: { total: 0, by_reason: {}, top: [], truncated: false },
      warnings: [],
      budget: { requested: 6000, used: 24, locked_overhead: 0 },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a locked Card with kind != 'card'", () => {
    const r = schemas.retrieve_context_pack.output.safeParse({
      ...baseOutputFields,
      rendered_text: "",
      query_mode: "unanchored",
      locked: [{ id: "x", kind: "chunk", card_type: "constraint", scope: {}, tokens: 1, body: "x", contexttrail: "x", lock_reason: "constraint_scope_match", broad_scope: false, freshness_state: "verified", freshness_warnings: [] }],
      ranked: [],
      omitted: { total: 0, by_reason: {}, top: [], truncated: false },
      warnings: [],
      budget: { requested: 0, used: 0, locked_overhead: 0 },
    });
    expect(r.success).toBe(false);
  });

  it("accepts a ranked chunk with score, scope, contexttrail, type_bias_applied", () => {
    const r = schemas.retrieve_context_pack.output.safeParse({
      ...baseOutputFields,
      rendered_text: "",
      query_mode: "anchored",
      locked: [],
      ranked: [
        {
          id: "v_abc123",
          kind: "chunk",
          scope: { layer: "module", value: "fundops/ledger" },
          tokens: 250,
          score: 0.87,
          body: "## Refund flow\n...",
          contexttrail: "Source: docs/fundops/ledger.md > Section: Refund flow",
          type_bias_applied: false,
        },
      ],
      omitted: { total: 0, by_reason: {}, top: [], truncated: false },
      warnings: [],
      budget: { requested: 6000, used: 250, locked_overhead: 0 },
    });
    expect(r.success).toBe(true);
  });

  it("accepts an omitted summary with top entries carrying enumerated reasons", () => {
    const r = schemas.retrieve_context_pack.output.safeParse({
      ...baseOutputFields,
      rendered_text: "",
      query_mode: "unanchored",
      locked: [],
      ranked: [],
      omitted: {
        total: 3,
        by_reason: { below_threshold: 1, budget: 1, tombstoned: 1 },
        top: [
          { id: "v_xyz", kind: "chunk", reason: "below_threshold", score: 0.02 },
          { id: "v_abc", kind: "chunk", reason: "budget", score: 0.55 },
          { id: "v_qqq", kind: "chunk", reason: "tombstoned", score: 0 },
        ],
        truncated: false,
      },
      warnings: [],
      budget: { requested: 0, used: 0, locked_overhead: 0 },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an omitted top entry with an unknown reason", () => {
    const r = schemas.retrieve_context_pack.output.safeParse({
      ...baseOutputFields,
      rendered_text: "",
      query_mode: "unanchored",
      locked: [],
      ranked: [],
      omitted: {
        total: 1,
        by_reason: { made_up: 1 },
        top: [{ id: "v_xyz", kind: "chunk", reason: "made_up", score: 0 }],
        truncated: false,
      },
      warnings: [],
      budget: { requested: 0, used: 0, locked_overhead: 0 },
    });
    expect(r.success).toBe(false);
  });

  it("accepts warnings with enumerated kinds", () => {
    for (const kind of [
      "no_matches",
      "no_sources",
      "locked_overflow",
      "anchors_unrecognized",
    ]) {
      const r = schemas.retrieve_context_pack.output.safeParse({
        ...baseOutputFields,
        rendered_text: "",
        query_mode: kind === "anchors_unrecognized" ? "signal_empty" : "unanchored",
        locked: [],
        ranked: [],
        omitted: { total: 0, by_reason: {}, top: [], truncated: false },
        warnings: [{ kind, message: "x", hint: "y" }],
        budget: { requested: 0, used: 0, locked_overhead: 0 },
      });
      expect(r.success, `kind=${kind}`).toBe(true);
    }
  });

  it("accepts a recovery plan with actionable follow-up searches", () => {
    const r = schemas.retrieve_context_pack.output.safeParse({
      ...baseOutputFields,
      rendered_text: "",
      query_mode: "unanchored",
      locked: [],
      ranked: [],
      omitted: { total: 0, by_reason: {}, top: [], truncated: false },
      warnings: [],
      budget: { requested: 0, used: 0, locked_overhead: 0 },
      recovery_plan: {
        action: "retry_with_followup_searches",
        reason_codes: ["coverage_uncertain", "retry_can_expand_query"],
        hint: "Retry with the generated follow-up searches.",
        follow_up_searches: ["middleware authentication order"],
        anchor_requests: ["a relevant file path"],
      },
    });
    expect(r.success).toBe(true);
  });

  it("accepts explain lock_failures with enumerated failure reasons", () => {
    const r = schemas.retrieve_context_pack.output.safeParse({
      ...baseOutputFields,
      rendered_text: "",
      query_mode: "anchored",
      locked: [],
      ranked: [],
      omitted: { total: 0, by_reason: {}, top: [], truncated: false },
      warnings: [],
      budget: { requested: 6000, used: 0, locked_overhead: 0 },
      explain: {
        per_chunk: [],
        query_compilation: {
          query_mode: "anchored",
          provided_anchor_count: 1,
          recognized_anchor_count: 1,
          anchors: [],
        },
        lock_failures: [
          {
            card_id: "C001",
            card_type: "constraint",
            candidate_match_path: "project:fundops -> module:payments",
            failed_reason: "scope_mismatch",
            detail: "constraint scope did not cover any inferred query scope",
          },
        ],
      },
    });
    expect(r.success).toBe(true);
    expect(r.data.explain?.lock_failures).toEqual([
      {
        card_id: "C001",
        card_type: "constraint",
        candidate_match_path: "project:fundops -> module:payments",
        failed_reason: "scope_mismatch",
        detail: "constraint scope did not cover any inferred query scope",
      },
    ]);
  });

  it("rejects warnings with unknown kinds", () => {
    const r = schemas.retrieve_context_pack.output.safeParse({
      ...baseOutputFields,
      rendered_text: "",
      query_mode: "unanchored",
      locked: [],
      ranked: [],
      omitted: { total: 0, by_reason: {}, top: [], truncated: false },
      warnings: [{ kind: "made_up", message: "x" }],
      budget: { requested: 0, used: 0, locked_overhead: 0 },
    });
    expect(r.success).toBe(false);
  });

  it("get_doc_chunk input accepts a version_id", () => {
    const r = schemas.get_doc_chunk.input.safeParse({ version_id: "v_abc123" });
    expect(r.success).toBe(true);
  });

  it("get_doc_chunk input accepts a stable_key", () => {
    const r = schemas.get_doc_chunk.input.safeParse({ stable_key: "k_abc123" });
    expect(r.success).toBe(true);
  });

  it("get_doc_chunk input rejects empty object (one of version_id/stable_key required)", () => {
    const r = schemas.get_doc_chunk.input.safeParse({});
    expect(r.success).toBe(false);
  });

  it("get_doc_chunk output accepts a full chunk shape", () => {
    const r = schemas.get_doc_chunk.output.safeParse({
      version_id: "v_abc",
      stable_key: "k_abc",
      source_path: "docs/fundops/ledger.md",
      heading_path: ["Ledger", "Refund flow"],
      contexttrail: "Source: docs/fundops/ledger.md > Section: Ledger > Refund flow",
      scope: { layer: "module", value: "fundops/ledger" },
      body: "...",
      code_anchors: [{ kind: "file", value: "src/refunds.ts" }],
      freshness_state: "verified",
      status: "current",
      tokens: 250,
    });
    expect(r.success).toBe(true);
  });

  it("get_doc_chunk output rejects unknown status value", () => {
    const r = schemas.get_doc_chunk.output.safeParse({
      version_id: "v_abc",
      stable_key: "k_abc",
      source_path: "x",
      heading_path: [],
      contexttrail: "x",
      scope: {},
      body: "x",
      code_anchors: [],
      freshness_state: "verified",
      status: "weird",
      tokens: 0,
    });
    expect(r.success).toBe(false);
  });

  it("get_card input requires id", () => {
    expect(schemas.get_card.input.safeParse({ id: "card_001" }).success).toBe(true);
    expect(schemas.get_card.input.safeParse({}).success).toBe(false);
  });

  it("get_card output accepts a full card shape with linked_chunks", () => {
    const r = schemas.get_card.output.safeParse({
      id: "card_001",
      card_type: "constraint",
      scope: { layer: "module", value: "fundops/ledger" },
      body: "Refunds must emit an audit event.",
      frontmatter: { id: "card_001", type: "constraint", scope: { module: "fundops/ledger" } },
      linked_chunks: [
        { version_pin: "v_abc", contexttrail: "Source: x > y", link_type: "mentions" },
      ],
      freshness_state: "verified",
      freshness_warnings: [],
      author_review_state: "verified",
    });
    expect(r.success).toBe(true);
  });

  it("get_card output rejects unknown author_review_state", () => {
    const r = schemas.get_card.output.safeParse({
      id: "card_001",
      card_type: "constraint",
      scope: {},
      body: "x",
      frontmatter: {},
      linked_chunks: [],
      freshness_state: "verified",
      freshness_warnings: [],
      author_review_state: "broken",
    });
    expect(r.success).toBe(false);
  });

  it("list_context_sources input accepts an empty object", () => {
    expect(schemas.list_context_sources.input.safeParse({}).success).toBe(true);
  });

  it("list_context_sources output accepts a list of sources", () => {
    const r = schemas.list_context_sources.output.safeParse({
      sources: [
        {
          source_path: "docs/fundops/ledger.md",
          scope_summary: "module:fundops/ledger",
          scope: { layer: "module", module: "fundops/ledger" },
          chunk_count: 12,
          last_indexed_at: "2026-05-06T12:00:00Z",
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("list_context_sources output accepts an empty list", () => {
    expect(
      schemas.list_context_sources.output.safeParse({ sources: [] }).success,
    ).toBe(true);
  });
});

describe("retrieve_context_pack output schema (continued)", () => {
  it("accepts an explain block when present", () => {
    const r = schemas.retrieve_context_pack.output.safeParse({
      ...baseOutputFields,
      rendered_text: "",
      query_mode: "unanchored",
      locked: [],
      ranked: [],
      omitted: { total: 0, by_reason: {}, top: [], truncated: false },
      warnings: [],
      budget: { requested: 0, used: 0, locked_overhead: 0 },
      explain: {
        query_compilation: {
          query_mode: "unanchored",
          provided_anchor_count: 0,
          recognized_anchor_count: 0,
          anchors: [],
        },
        per_chunk: [
          {
            id: "v_abc",
            bm25_norm: 0.8,
            heading_match: 0.5,
            scope_match: 1.0,
            mention_overlap: 0.0,
            specificity: 1.4,
            text_score: 0.71,
            final_score: 1.7,
            packing_score: 0.13,
            structural_multiplier: 1,
            doc_role: "ideation",
            role_source: "config_pattern",
            role_multiplier: 0.5,
            included: true,
            reason: "above_threshold",
          },
        ],
      },
    });
    expect(r.success).toBe(true);
  });

  it("accepts source-profile alias provenance in query compilation", () => {
    const r = schemas.retrieve_context_pack.output.safeParse({
      ...baseOutputFields,
      rendered_text: "",
      query_mode: "anchored",
      locked: [],
      ranked: [],
      omitted: { total: 0, by_reason: {}, top: [], truncated: false },
      warnings: [],
      budget: { requested: 0, used: 0, locked_overhead: 0 },
      explain: {
        per_chunk: [],
        query_compilation: {
          query_mode: "anchored",
          provided_anchor_count: 1,
          recognized_anchor_count: 1,
          anchors: [
            {
              anchor: { kind: "file", value: "turbo.json" },
              recognition: "scope_inferred",
              mode: "source_profile_alias",
              scopes: [{ module: "globs" }],
              contributing_anchors: [
                {
                  object_id: "chunk-globs",
                  kind: "chunk",
                  value: "turbo.json",
                  confidence: "medium",
                  match_source: "source_profile",
                  match_kind: "source_text_filename",
                  source_path: "docs/turbo/globs.md",
                },
              ],
            },
          ],
        },
        lock_failures: [],
      },
    });
    expect(r.success).toBe(true);
  });
});

describe("sync_ledger schema", () => {
  it("input accepts safe check mode and explicit apply mode", () => {
    expect(schemas.sync_ledger.input.safeParse({ check: true }).success).toBe(true);
    expect(
      schemas.sync_ledger.input.safeParse({
        cwd: "/tmp/repo",
        check: false,
        refresh_candidates: true,
      }).success,
    ).toBe(true);
  });

  it("output accepts a full sync report", () => {
    const counts = {
      total: 1,
      verified: 0,
      unverified: 0,
      needs_review: 1,
      maybe_affected: 0,
      potentially_superseded: 0,
      manual_needs_review: 0,
    };
    const r = schemas.sync_ledger.output.safeParse({
      cwd: "/tmp/repo",
      mode: "apply",
      initialized: true,
      actions: [
        {
          kind: "import_docs",
          description: "Re-import docs whose on-disk content changed.",
          paths: ["docs/a.md"],
        },
      ],
      writes: [".contexttrail/cache/contexttrail.db"],
      freshness: {
        stale_doc_sources: ["docs/a.md"],
        stale_code_sources: [],
        missing_sources: [],
      },
      cards: {
        before: { ...counts, needs_review: 0, verified: 1 },
        after: counts,
        newly_needs_review: [
          {
            id: "C001",
            title: "Rule",
            freshness_reason: "version_drift",
          },
        ],
        already_needs_review: [],
      },
      inbox: {
        pending_total: 0,
        candidate_cards: 0,
        clarification_needs: 0,
      },
      doc_import: { files_imported: 1, files_unchanged: 0, chunks_written: 1 },
      card_import: { cards_imported: 1, cards_skipped: 0, warnings: [] },
    });
    expect(r.success).toBe(true);
  });
});
