/**
 * THO-165 (PRD-0016 / P16.7): ambiguity-aware compact pack planner.
 *
 * Inputs: top-N source cards (with family + role + adjudicator
 * outcomes). Output: an ambiguity decision used by the pack-readiness
 * verifier and (later) by the live pack assembler.
 *
 * Synthetic probes here cover the named cases:
 *   - related close-call inclusion (true ambiguity)
 *   - unrelated noise exclusion (no ambiguity)
 *   - clear-winner compactness (top-1 dominant, no extra family chunks)
 *   - readiness ambiguity (the diagnostic surface readiness consumes)
 */
import { describe, expect, it } from "vitest";
import { planTopFamilyAmbiguity } from "./ambiguity-planner.js";
import { buildSourceCardsFromCandidates } from "./source-card.js";
import type { ProfileEnrichedSourceCandidate } from "./source-candidates.js";
import type { SourceProfile } from "../types/source-profile.js";

function profile(p: Partial<SourceProfile> = {}): SourceProfile {
  return {
    source_path: p.source_path ?? "docs/x.md",
    source_content_hash: "h",
    title: "X",
    h1: null,
    intro: null,
    heading_outline: [],
    doc_role: "canonical",
    role_source: "default",
    doc_purpose: "unknown",
    purpose_source: "default",
    aliases: [],
    summary: null,
    summary_source: "empty",
    questions_answered: [],
    questions_answered_source: "empty",
    chunk_count: 1,
    token_count: 100,
    indexed_at: "2026-05-09T00:00:00Z",
    ...p,
  };
}

function cand(p: Partial<ProfileEnrichedSourceCandidate>): ProfileEnrichedSourceCandidate {
  return {
    rank: p.rank ?? 1,
    source_path: p.source_path ?? "docs/x.md",
    best_chunk_rank: p.best_chunk_rank ?? p.rank ?? 1,
    best_chunk_score: p.best_chunk_score ?? 0.5,
    contributing_chunks: p.contributing_chunks ?? [
      { version_id: "v1", rank: p.rank ?? 1, final_score: 0.5 },
    ],
    profile: p.profile ?? profile({ source_path: p.source_path ?? "docs/x.md" }),
    ...p,
  };
}

describe("planTopFamilyAmbiguity — clear winner", () => {
  it("returns is_ambiguous=false when top-1 score dominates top-2", () => {
    const cands = [
      cand({ rank: 1, source_path: "docs/a.md", best_chunk_score: 1.0 }),
      cand({ rank: 2, source_path: "docs/b.md", best_chunk_score: 0.4 }),
    ];
    const cards = buildSourceCardsFromCandidates({
      candidates: cands,
      query_tokens: ["topic"],
      query_intent: "broad_domain",
      top_n: 5,
    });
    const plan = planTopFamilyAmbiguity({ cards, top1_top2_margin: 0.6 });
    expect(plan.is_ambiguous).toBe(false);
    expect(plan.selected_family_paths).toEqual([cards[0]!.source_path]);
  });
});

describe("planTopFamilyAmbiguity — true ambiguity within a family", () => {
  it("flags ambiguity and returns ordered family-member paths when top pair is in same family", () => {
    const cands = [
      cand({
        rank: 1,
        source_path: "docs/mocking.md",
        best_chunk_score: 0.5,
        profile: profile({ source_path: "docs/mocking.md", title: "Mocking", doc_purpose: "guide" }),
      }),
      cand({
        rank: 2,
        source_path: "docs/mocking/modules.md",
        best_chunk_score: 0.49,
        profile: profile({
          source_path: "docs/mocking/modules.md",
          title: "Modules",
          doc_purpose: "guide",
        }),
      }),
      cand({
        rank: 3,
        source_path: "docs/unrelated.md",
        best_chunk_score: 0.2,
        profile: profile({ source_path: "docs/unrelated.md", title: "Unrelated" }),
      }),
    ];
    const cards = buildSourceCardsFromCandidates({
      candidates: cands,
      query_tokens: ["mocking"],
      query_intent: "broad_domain",
      top_n: 5,
    });
    const plan = planTopFamilyAmbiguity({ cards, top1_top2_margin: 0.01 });
    expect(plan.is_ambiguous).toBe(true);
    // Both family members should appear in the planned set; unrelated doc must NOT.
    expect(plan.selected_family_paths).toContain("docs/mocking.md");
    expect(plan.selected_family_paths).toContain("docs/mocking/modules.md");
    expect(plan.selected_family_paths).not.toContain("docs/unrelated.md");
  });
});

describe("planTopFamilyAmbiguity — unrelated noise exclusion", () => {
  it("does NOT label ambiguity when top-2 belongs to a different family", () => {
    const cands = [
      cand({
        rank: 1,
        source_path: "docs/router.md",
        best_chunk_score: 0.5,
        profile: profile({ source_path: "docs/router.md", title: "Router" }),
      }),
      cand({
        rank: 2,
        source_path: "services/orders/router-decisions.md",
        best_chunk_score: 0.49,
        profile: profile({
          source_path: "services/orders/router-decisions.md",
          title: "Router decisions",
        }),
      }),
    ];
    const cards = buildSourceCardsFromCandidates({
      candidates: cands,
      query_tokens: ["router"],
      query_intent: "broad_domain",
      top_n: 5,
    });
    const plan = planTopFamilyAmbiguity({ cards, top1_top2_margin: 0.01 });
    expect(plan.is_ambiguous).toBe(false);
    // Only the top-1 member is in the selected set.
    expect(plan.selected_family_paths).toEqual([cards[0]!.source_path]);
  });
});

describe("planTopFamilyAmbiguity — readiness diagnostics", () => {
  it("emits an `ambiguous_top_family` diagnostic when the top pair is a close-call family", () => {
    const cands = [
      cand({
        rank: 1,
        source_path: "docs/mocking.md",
        best_chunk_score: 0.5,
        profile: profile({ source_path: "docs/mocking.md", title: "Mocking", doc_purpose: "guide" }),
      }),
      cand({
        rank: 2,
        source_path: "docs/mocking/modules.md",
        best_chunk_score: 0.49,
        profile: profile({
          source_path: "docs/mocking/modules.md",
          title: "Modules",
          doc_purpose: "guide",
        }),
      }),
    ];
    const cards = buildSourceCardsFromCandidates({
      candidates: cands,
      query_tokens: ["mocking"],
      query_intent: "broad_domain",
      top_n: 5,
    });
    const plan = planTopFamilyAmbiguity({ cards, top1_top2_margin: 0.01 });
    expect(plan.reason_codes).toContain("ambiguous_top_family");
  });

  it("does NOT emit an ambiguity reason code on a clear winner", () => {
    const cards = buildSourceCardsFromCandidates({
      candidates: [
        cand({ rank: 1, source_path: "docs/a.md", best_chunk_score: 1.0 }),
        cand({ rank: 2, source_path: "docs/b.md", best_chunk_score: 0.2 }),
      ],
      query_tokens: ["topic"],
      query_intent: "broad_domain",
      top_n: 5,
    });
    const plan = planTopFamilyAmbiguity({ cards, top1_top2_margin: 0.8 });
    expect(plan.reason_codes).not.toContain("ambiguous_top_family");
  });
});

describe("planTopFamilyAmbiguity — degenerate inputs", () => {
  it("returns is_ambiguous=false when there is only one candidate card", () => {
    const cards = buildSourceCardsFromCandidates({
      candidates: [cand({ rank: 1, source_path: "docs/a.md", best_chunk_score: 0.5 })],
      query_tokens: ["topic"],
      query_intent: "broad_domain",
      top_n: 5,
    });
    const plan = planTopFamilyAmbiguity({ cards, top1_top2_margin: 0 });
    expect(plan.is_ambiguous).toBe(false);
  });

  it("returns is_ambiguous=false on an empty card list", () => {
    const plan = planTopFamilyAmbiguity({ cards: [], top1_top2_margin: 0 });
    expect(plan.is_ambiguous).toBe(false);
    expect(plan.selected_family_paths).toEqual([]);
  });
});
