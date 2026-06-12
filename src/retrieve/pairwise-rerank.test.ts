/**
 * Optional close-call pairwise rerank adapter (V3.6).
 *
 * Behind an explicit flag and only on close calls, an external adapter (a
 * local cross-encoder, an LLM, etc.) can break ties between source cards.
 * The contract is:
 *
 *   - Default deterministic floor never depends on the adapter.
 *   - Adapter is invoked only when |top1.score − top2.score| < margin.
 *   - Adapter cannot override fail-closed or promote `unsupported` to first.
 *   - Adapter cannot override locked Cards or confidence policy.
 *   - Every adapter call is logged as an ablation.
 */
import { describe, expect, it } from "vitest";
import {
  applyCloseCallPairwiseRerank,
  type PairwiseRerankAdapter,
  type PairwiseRerankAblationLog,
} from "./pairwise-rerank.js";
import type { SourceSelectionDecision } from "./source-selection-decision.js";
import type { SourceCard } from "./source-card.js";

function card(source_path: string, rank = 1): SourceCard {
  return {
    schema_version: 1,
    rank,
    source_path,
    query_intent: "decision_lookup",
    query_tokens: ["middlewar"],
    profile_signals: {
      title: source_path,
      doc_purpose: "concept",
      doc_role: "canonical",
      heading_count: 1,
      alias_kinds: ["title"],
      has_intro: true,
    },
    candidate_path_evidence: {
      best_chunk_rank: rank,
      best_chunk_score: 0.5,
      contributing_chunk_count: 1,
      fused_rank: rank,
      fused_path_count: 1,
    },
    top_chunk_evidence: { version_id: `vid-${rank}`, rank, final_score: 0.5 },
    token_coverage: {
      title_token_coverage: 0.5,
      path_token_coverage: 0.5,
      heading_token_coverage: 0.3,
    },
    coverage_decision: null,
  };
}

function decision(
  selected: Array<{ path: string; score: number; label?: "covers" | "partial" | "unsupported" }>,
): SourceSelectionDecision {
  const sorted = [...selected].sort((a, b) => b.score - a.score);
  return {
    selected_sources: sorted.map(({ path, score, label }, i) => ({
      source_path: path,
      rank: i + 1,
      score,
      aboutness_label: label ?? "covers",
      reason_codes: [],
    })),
    fail_closed: false,
    top1_top2_margin: sorted.length > 1 ? sorted[0].score - sorted[1].score : 0,
    top1_top3_margin: sorted.length > 2 ? sorted[0].score - sorted[2].score : 0,
  };
}

describe("applyCloseCallPairwiseRerank", () => {
  it("does not invoke the adapter when the margin is above threshold", () => {
    const calls: Array<{ a: string; b: string }> = [];
    const adapter: PairwiseRerankAdapter = (a, b) => {
      calls.push({ a: a.source_path, b: b.source_path });
      return { preferred: "a", reasons: ["mock"] };
    };
    const result = applyCloseCallPairwiseRerank({
      decision: decision([
        { path: "a.md", score: 1.0 },
        { path: "b.md", score: 0.5 },
      ]),
      cards: [card("a.md", 1), card("b.md", 2)],
      adapter,
      close_call_margin: 0.1,
    });
    expect(calls).toEqual([]);
    expect(result.decision.selected_sources[0].source_path).toBe("a.md");
    expect(result.ablation_log.invocations).toBe(0);
  });

  it("invokes the adapter on a close call and reorders when adapter prefers second", () => {
    const calls: Array<{ a: string; b: string }> = [];
    const adapter: PairwiseRerankAdapter = (a, b) => {
      calls.push({ a: a.source_path, b: b.source_path });
      return { preferred: "b", reasons: ["adapter prefers b"] };
    };
    const result = applyCloseCallPairwiseRerank({
      decision: decision([
        { path: "a.md", score: 0.55 },
        { path: "b.md", score: 0.50 },
      ]),
      cards: [card("a.md", 1), card("b.md", 2)],
      adapter,
      close_call_margin: 0.1,
    });
    expect(calls).toHaveLength(1);
    expect(result.decision.selected_sources[0].source_path).toBe("b.md");
    expect(result.decision.selected_sources[0].reason_codes).toContain(
      "pairwise_rerank_promoted",
    );
    expect(result.ablation_log.invocations).toBe(1);
    expect(result.ablation_log.swaps).toBe(1);
  });

  it("does not mutate the input decision when applying a swap", () => {
    const adapter: PairwiseRerankAdapter = () => ({
      preferred: "b",
      reasons: ["adapter prefers b"],
    });
    const original = decision([
      { path: "a.md", score: 0.55 },
      { path: "b.md", score: 0.50 },
    ]);
    const result = applyCloseCallPairwiseRerank({
      decision: original,
      cards: [card("a.md", 1), card("b.md", 2)],
      adapter,
      close_call_margin: 0.1,
    });
    expect(original.selected_sources[0].source_path).toBe("a.md");
    expect(result.decision.selected_sources[0].source_path).toBe("b.md");
  });

  it("does not promote an unsupported candidate even if the adapter prefers it", () => {
    const adapter: PairwiseRerankAdapter = () => ({
      preferred: "b",
      reasons: ["adapter prefers b"],
    });
    const result = applyCloseCallPairwiseRerank({
      decision: decision([
        { path: "a.md", score: 0.55, label: "partial" },
        { path: "b.md", score: 0.5, label: "unsupported" },
      ]),
      cards: [card("a.md", 1), card("b.md", 2)],
      adapter,
      close_call_margin: 0.1,
    });
    expect(result.decision.selected_sources[0].source_path).toBe("a.md");
    expect(result.ablation_log.refused_unsupported_promotions).toBe(1);
  });

  it("returns the decision unchanged when the decision failed closed", () => {
    const adapter: PairwiseRerankAdapter = () => ({
      preferred: "a",
      reasons: ["mock"],
    });
    const result = applyCloseCallPairwiseRerank({
      decision: {
        selected_sources: [],
        fail_closed: true,
        top1_top2_margin: 0,
        top1_top3_margin: 0,
      },
      cards: [],
      adapter,
      close_call_margin: 0.1,
    });
    expect(result.decision.fail_closed).toBe(true);
    expect(result.ablation_log.invocations).toBe(0);
  });

  it("returns ablation log even when the adapter is undefined (close-call without adapter is a no-op)", () => {
    const result = applyCloseCallPairwiseRerank({
      decision: decision([
        { path: "a.md", score: 0.55 },
        { path: "b.md", score: 0.50 },
      ]),
      cards: [card("a.md", 1), card("b.md", 2)],
      adapter: undefined,
      close_call_margin: 0.1,
    });
    expect(result.ablation_log.invocations).toBe(0);
    expect(result.decision.selected_sources[0].source_path).toBe("a.md");
  });

  it("records reasons from the adapter on the ablation log", () => {
    const adapter: PairwiseRerankAdapter = () => ({
      preferred: "b",
      reasons: ["b has better intro", "b is closer to topic"],
    });
    const result = applyCloseCallPairwiseRerank({
      decision: decision([
        { path: "a.md", score: 0.55 },
        { path: "b.md", score: 0.50 },
      ]),
      cards: [card("a.md", 1), card("b.md", 2)],
      adapter,
      close_call_margin: 0.1,
    });
    expect(result.ablation_log.entries[0].reasons).toEqual([
      "b has better intro",
      "b is closer to topic",
    ]);
  });
});
