/**
 * Composition test for code-fence-entity
 * consumption through the alias substrate and source-rerank's
 * existing alias_hit_count / owner_identity_score features.
 *
 * Property: a query whose token exactly matches a symbol entity on
 * candidate A but NOT on candidate B causes A to rank higher than B.
 * Certified at Wilson lower-95 ≥ 95% over 200 random entity-shaped
 * symbols. Mirrors the heading-alias composition test.
 *
 * The harness drives `rerankSourceCandidates` directly so the wiring
 * is exercised end-to-end (alias_hit_count + owner_identity_score +
 * IDF token weighting).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  rerankSourceCandidates,
  scoreSourceRerank,
  tokenizeForRerank,
} from "../../retrieve/source-rerank.js";
import type { ProfileEnrichedSourceCandidate } from "../../retrieve/source-candidates.js";
import type { SourceProfile } from "../../types/source-profile.js";
import type { CodeFenceEntity } from "../../retrieve/code-fence-entities.js";
import { wilson95Lower } from "./stats.js";

const PROPERTY_LOWER_95 = 0.95;
const PROPERTY_RUNS = 200;
const NOW = "2026-05-08T00:00:00Z";

function profile(args: {
  source_path: string;
  title: string;
  code_fence_entities?: CodeFenceEntity[];
}): SourceProfile {
  return {
    source_path: args.source_path,
    source_content_hash: "h0",
    title: args.title,
    h1: args.title,
    intro: null,
    heading_outline: [],
    doc_role: "canonical",
    role_source: "default",
    doc_purpose: "guide",
    purpose_source: "default",
    aliases: [],
    summary: null,
    summary_source: "empty",
    questions_answered: [],
    questions_answered_source: "empty",
    chunk_count: 1,
    token_count: 100,
    indexed_at: NOW,
    code_fence_entities: args.code_fence_entities,
  };
}

function candidate(p: SourceProfile): ProfileEnrichedSourceCandidate {
  return {
    rank: 1,
    source_path: p.source_path,
    best_chunk_rank: 1,
    best_chunk_score: 0.5,
    contributing_chunks: [{ version_id: "v", rank: 1, final_score: 0.5 }],
    profile: p,
  };
}

function withFlag<T>(value: "on" | "off", fn: () => T): T {
  const previous = process.env.RETRIEVAL_CODE_FENCE_ENTITIES;
  process.env.RETRIEVAL_CODE_FENCE_ENTITIES = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.RETRIEVAL_CODE_FENCE_ENTITIES;
    } else {
      process.env.RETRIEVAL_CODE_FENCE_ENTITIES = previous;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Adversarial — exact-only / no-additive-boost guarantees
// ──────────────────────────────────────────────────────────────────────────

describe("code-fence entities — alias_hit_count wiring (24.2.3)", () => {
  it("flag off: an entity-only match does NOT increment alias_hit_count", () => {
    const p = profile({
      source_path: "docs/server/routers.md",
      title: "Routers",
      code_fence_entities: [
        {
          kind: "symbol",
          value: "publicProcedure",
          normalized: "publicprocedure",
          language: "ts",
          section_heading: "Procedures",
        },
      ],
    });
    withFlag("off", () => {
      const s = scoreSourceRerank({
        candidate: candidate(p),
        query_tokens: tokenizeForRerank("publicProcedure"),
        intent: "exact_symbol",
      });
      expect(s.features.alias_hit_count).toBe(0);
    });
  });

  it("flag on: an entity-only match increments alias_hit_count", () => {
    const p = profile({
      source_path: "docs/server/routers.md",
      title: "Routers",
      code_fence_entities: [
        {
          kind: "symbol",
          value: "publicProcedure",
          normalized: "publicprocedure",
          language: "ts",
          section_heading: "Procedures",
        },
      ],
    });
    withFlag("on", () => {
      const s = scoreSourceRerank({
        candidate: candidate(p),
        query_tokens: tokenizeForRerank("publicProcedure"),
        intent: "exact_symbol",
      });
      expect(s.features.alias_hit_count).toBeGreaterThan(0);
    });
  });

  it("flag on: query token absent from any entity → no change vs flag off", () => {
    const p = profile({
      source_path: "docs/server/routers.md",
      title: "Routers",
      code_fence_entities: [
        {
          kind: "symbol",
          value: "publicProcedure",
          normalized: "publicprocedure",
          language: "ts",
          section_heading: "Procedures",
        },
      ],
    });
    const off = withFlag("off", () =>
      scoreSourceRerank({
        candidate: candidate(p),
        query_tokens: tokenizeForRerank("totallyUnrelated"),
        intent: "exact_symbol",
      }),
    );
    const on = withFlag("on", () =>
      scoreSourceRerank({
        candidate: candidate(p),
        query_tokens: tokenizeForRerank("totallyUnrelated"),
        intent: "exact_symbol",
      }),
    );
    expect(on.features.alias_hit_count).toBe(off.features.alias_hit_count);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Property test — composition over 200 random symbol entities.
// ──────────────────────────────────────────────────────────────────────────

describe("code-fence entities — composition (24.2.3)", () => {
  it("symbol-entity match on A but not B causes A to rank higher than B (lower-95 ≥ 95%)", () => {
    // Random Pascal-cased identifiers of length 6+ so they don't collide
    // with common English tokens after stemming.
    const symbolArb = fc
      .stringMatching(/^[A-Z][a-zA-Z0-9]{5,15}$/)
      .filter((s) => /^[A-Z][a-zA-Z0-9]+$/.test(s) && s.length >= 6);
    let passed = 0;
    let total = 0;
    fc.assert(
      fc.property(symbolArb, (sym) => {
        total += 1;
        const a = candidate(
          profile({
            source_path: "docs/a.md",
            title: "Doc A",
            code_fence_entities: [
              {
                kind: "symbol",
                value: sym,
                normalized: sym.toLowerCase(),
                language: "ts",
                section_heading: "Reference",
              },
            ],
          }),
        );
        const b = candidate(
          profile({ source_path: "docs/b.md", title: "Doc B" }),
        );
        const queryTokens = tokenizeForRerank(sym);
        const reranked = withFlag("on", () =>
          rerankSourceCandidates({
            candidates: [a, b],
            query_tokens: queryTokens,
            intent: "exact_symbol",
          }),
        );
        const aRank = reranked.find((r) => r.candidate.source_path === "docs/a.md")?.rank ?? 0;
        const bRank = reranked.find((r) => r.candidate.source_path === "docs/b.md")?.rank ?? 0;
        if (aRank > 0 && bRank > 0 && aRank < bRank) passed += 1;
      }),
      { numRuns: PROPERTY_RUNS },
    );
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(
      PROPERTY_LOWER_95,
    );
  });

  it("flag off: same query produces no positional advantage from the entity", () => {
    // Sanity: the lift comes from the flag, not from accidental ordering.
    const sym = "publicProcedure";
    const a = candidate(
      profile({
        source_path: "docs/a.md",
        title: "Doc A",
        code_fence_entities: [
          {
            kind: "symbol",
            value: sym,
            normalized: sym.toLowerCase(),
            language: "ts",
            section_heading: "Reference",
          },
        ],
      }),
    );
    const b = candidate(profile({ source_path: "docs/b.md", title: "Doc B" }));
    const reranked = withFlag("off", () =>
      rerankSourceCandidates({
        candidates: [a, b],
        query_tokens: tokenizeForRerank(sym),
        intent: "exact_symbol",
      }),
    );
    // With identical title/path/no-alias, both candidates score the same;
    // tied scores fall back to lexical-rank then alpha source_path order
    // (a.md before b.md is implementation-defined). We only assert that
    // there is NO rank lift in either direction beyond the lex/alpha
    // tiebreaker — i.e. the difference does NOT come from entity matching.
    const aRank = reranked.find((r) => r.candidate.source_path === "docs/a.md")?.rank ?? 0;
    const bRank = reranked.find((r) => r.candidate.source_path === "docs/b.md")?.rank ?? 0;
    expect(aRank).toBeGreaterThan(0);
    expect(bRank).toBeGreaterThan(0);
    // The two scores must be equal under flag-off — entity is invisible.
    const scoresEqual =
      reranked[0]?.score === reranked[1]?.score;
    expect(scoresEqual).toBe(true);
  });
});
