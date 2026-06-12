/**
 * Pack/display integration for source selection (V3.5).
 *
 * Two contracts:
 *   1. `applySourceSelectionToChunks` maps a V3.4 SourceSelectionDecision
 *      onto candidate doc chunks by stamping `source_selection_rank` per
 *      chunk. Chunks whose source did not survive selection lose their rank
 *      (they may still pack via existing scoring; selection just stops
 *      forcing them to the front).
 *   2. The pack honours `source_selection_rank` ahead of the legacy
 *      `source_rerank_rank` so the V3 decision drives display order.
 *      Locked Cards bypass selection entirely.
 */
import { describe, expect, it } from "vitest";
import {
  applySourceSelectionToChunks,
} from "./pack-v3-selection.js";
import { packWithLocked } from "./pack.js";
import { orderIncludedForRender } from "./presentation.js";
import type { CandidateDocChunkTrace } from "./pack.js";
import type { ScoreTrace } from "./score.js";
import type { SourceSelectionDecision } from "./source-selection-decision.js";

function chunk(
  overrides: Partial<CandidateDocChunkTrace> = {},
): CandidateDocChunkTrace {
  const base: ScoreTrace = {
    version_id: overrides.version_id ?? "vid",
    final_score: overrides.final_score ?? 0.5,
    packing_score: overrides.packing_score ?? 0.5,
    bm25_raw: 0,
    bm25_norm: 0,
    scope_match: 0,
    mention_overlap: 0,
    heading_match: 0,
    specificity: 0,
    type_bias: 0,
    freshness: 1,
    token_count: 100,
    cost_penalty: 0,
    contexttrail: "",
  } as unknown as ScoreTrace;
  return {
    ...base,
    kind: "doc_chunk",
    ...overrides,
  };
}

function chunkWithSource(
  source_path: string,
  version_id: string,
  final_score: number,
): CandidateDocChunkTrace & { source_path?: string } {
  // pack.ts treats source_path as additional metadata; selection helper
  // reads it. The legacy ScoreTrace shape carries source_path as part of
  // the trace; we attach it here for the helper to find.
  return Object.assign(
    chunk({ version_id, final_score, packing_score: final_score }),
    { source_path },
  ) as CandidateDocChunkTrace & { source_path: string };
}

function decision(
  selected: Array<{ path: string; rank: number }>,
): SourceSelectionDecision {
  return {
    selected_sources: selected.map(({ path, rank }, i) => ({
      source_path: path,
      rank,
      score: 1 - i * 0.1,
      aboutness_label: "covers",
      reason_codes: ["covers_label"],
    })),
    fail_closed: false,
    top1_top2_margin: selected.length > 1 ? 0.1 : 0,
    top1_top3_margin: selected.length > 2 ? 0.2 : 0,
  };
}

describe("applySourceSelectionToChunks", () => {
  it("stamps source_selection_rank on chunks of selected sources", () => {
    const chunks: CandidateDocChunkTrace[] = [
      chunkWithSource("a.md", "v1", 0.5),
      chunkWithSource("b.md", "v2", 0.6),
    ];
    const updated = applySourceSelectionToChunks({
      chunks,
      decision: decision([
        { path: "b.md", rank: 1 },
        { path: "a.md", rank: 2 },
      ]),
    });
    const byVid = Object.fromEntries(updated.map((c) => [c.version_id, c]));
    expect(byVid["v1"].source_selection_rank).toBe(2);
    expect(byVid["v2"].source_selection_rank).toBe(1);
  });

  it("leaves source_selection_rank unset on chunks whose source was not selected", () => {
    const chunks: CandidateDocChunkTrace[] = [
      chunkWithSource("a.md", "v1", 0.5),
      Object.assign(chunkWithSource("c.md", "v3", 0.4), {
        source_selection_rank: 99,
      }),
    ];
    const updated = applySourceSelectionToChunks({
      chunks,
      decision: decision([{ path: "a.md", rank: 1 }]),
    });
    const byVid = Object.fromEntries(updated.map((c) => [c.version_id, c]));
    expect(byVid["v1"].source_selection_rank).toBe(1);
    expect(byVid["v3"].source_selection_rank).toBeUndefined();
  });

  it("clears stale source_selection_rank when selection failed closed", () => {
    const chunks: CandidateDocChunkTrace[] = [
      Object.assign(chunkWithSource("a.md", "v1", 0.5), {
        source_selection_rank: 2,
      }),
    ];
    const updated = applySourceSelectionToChunks({
      chunks,
      decision: {
        selected_sources: [],
        fail_closed: true,
        top1_top2_margin: 0,
        top1_top3_margin: 0,
      },
    });
    expect(updated[0].source_selection_rank).toBeUndefined();
  });
});

describe("packWithLocked honours source_selection_rank ahead of source_rerank_rank", () => {
  it("packs chunks in source_selection_rank order even when source_rerank_rank disagrees", () => {
    const candidates: CandidateDocChunkTrace[] = [
      Object.assign(
        chunkWithSource("a.md", "v-a", 0.5),
        { source_rerank_rank: 1, source_selection_rank: 2 },
      ),
      Object.assign(
        chunkWithSource("b.md", "v-b", 0.5),
        { source_rerank_rank: 2, source_selection_rank: 1 },
      ),
    ];
    const result = packWithLocked({
      locked: [],
      candidates,
      budget_tokens: 1000,
      min_final_score: 0,
    });
    expect(result.included.map((t) => t.version_id)).toEqual(["v-b", "v-a"]);
  });

  it("packs selected doc chunks ahead of unselected doc chunks", () => {
    const candidates: CandidateDocChunkTrace[] = [
      Object.assign(chunkWithSource("unselected.md", "v-old", 0.99), {
        source_rerank_rank: 1,
      }),
      Object.assign(chunkWithSource("selected.md", "v-selected", 0.4), {
        source_rerank_rank: 9,
        source_selection_rank: 1,
      }),
    ];
    const result = packWithLocked({
      locked: [],
      candidates,
      budget_tokens: 1000,
      min_final_score: 0,
    });
    expect(result.included.map((t) => t.version_id)).toEqual([
      "v-selected",
      "v-old",
    ]);
  });

  it("preserves at least one chunk per selected source when budget allows", () => {
    const candidates: CandidateDocChunkTrace[] = [
      // Two chunks from a.md — high score and lower score
      Object.assign(chunkWithSource("a.md", "v-a-1", 0.9), {
        source_selection_rank: 1,
      }),
      Object.assign(chunkWithSource("a.md", "v-a-2", 0.85), {
        source_selection_rank: 1,
      }),
      // One chunk from b.md (lower selection rank but still selected)
      Object.assign(chunkWithSource("b.md", "v-b-1", 0.6), {
        source_selection_rank: 2,
      }),
    ];
    const result = packWithLocked({
      locked: [],
      candidates,
      budget_tokens: 250, // only 2 chunks of 100 tokens fit
      min_final_score: 0,
    });
    const sources = result.included
      .filter((t) => t.kind === "doc_chunk")
      .map((t) => (t as { source_path?: string }).source_path);
    // Both sources should appear at least once.
    expect(sources).toContain("a.md");
    expect(sources).toContain("b.md");
  });

  it("uses source-scoped selection rank inside a selected source without overriding source order", () => {
    const candidates: CandidateDocChunkTrace[] = [
      Object.assign(chunkWithSource("a.md", "a-leaf", 0.9), {
        source_selection_rank: 1,
        source_scoped_selection_rank: 101,
        source_scoped_selection_reason: "primary" as const,
      }),
      Object.assign(chunkWithSource("a.md", "a-intro", 0.4), {
        source_selection_rank: 1,
        source_scoped_selection_rank: 100,
        source_scoped_selection_reason: "intro" as const,
      }),
      Object.assign(chunkWithSource("b.md", "b-primary", 0.8), {
        source_selection_rank: 2,
        source_scoped_selection_rank: 200,
        source_scoped_selection_reason: "primary" as const,
      }),
    ];
    const result = packWithLocked({
      locked: [],
      candidates,
      budget_tokens: 300,
      min_final_score: 0,
    });

    expect(result.included.map((t) => t.version_id)).toEqual([
      "a-intro",
      "b-primary",
      "a-leaf",
    ]);
  });
});

describe("render ordering honours source_selection_rank", () => {
  it("keeps V3 selected source order ahead of legacy source-rerank order", () => {
    const included: CandidateDocChunkTrace[] = [
      Object.assign(chunkWithSource("a.md", "v-a", 0.5), {
        source_rerank_rank: 1,
        source_selection_rank: 2,
      }),
      Object.assign(chunkWithSource("b.md", "v-b", 0.5), {
        source_rerank_rank: 2,
        source_selection_rank: 1,
      }),
    ];
    const ordered = orderIncludedForRender(included).relevant;
    expect(ordered.map((t) => t.version_id)).toEqual(["v-b", "v-a"]);
  });

  it("keeps source-scoped chunk order in the displayed ranked list", () => {
    const included: CandidateDocChunkTrace[] = [
      Object.assign(chunkWithSource("a.md", "leaf", 0.9), {
        source_selection_rank: 1,
        source_scoped_selection_rank: 101,
      }),
      Object.assign(chunkWithSource("a.md", "intro", 0.4), {
        source_selection_rank: 1,
        source_scoped_selection_rank: 100,
      }),
    ];
    const ordered = orderIncludedForRender(included).relevant;
    expect(ordered.map((t) => t.version_id)).toEqual(["intro", "leaf"]);
  });
});
