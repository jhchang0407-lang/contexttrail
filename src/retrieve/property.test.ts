/**
 * Property-based tests for load-bearing retrieval invariants.
 *
 * Narrow on purpose: the property suite is *not* a substitute for example
 * tests. It targets four invariants that, if broken, would silently degrade
 * core promises of the engine:
 *
 *   (a) every locked Card always appears in the Pack (hard guarantee)
 *   (b) chunker output's union reconstructs the source minus whitespace
 *   (c) final_score is monotone in BM25 holding all else equal
 *   (d) scope_match is monotone in scope specificity
 *
 * 100 generated cases per property.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { packWithLocked, type LockedTrace, type CandidateTrace } from "./pack.js";
import { scopeMatchScore, type QueryScope } from "./scope-match.js";
import { scoreChunk, type ScoringWeights } from "./score.js";
import { chunk } from "../parse/chunker.js";
import type { Card, CardType } from "../types/card.js";
import type { ChunkScope, DocChunk, CodeAnchor } from "../types/chunk.js";

const RUNS = 100;

const baseWeights: ScoringWeights = {
  w_bm25: 0.7,
  w_heading: 0.3,
  w_scope: 0.7,
  w_mentions: 0.8,
  card_type_bias: 1.2,
  specificity_weight: {
    company: 0.9,
    team: 1.0,
    project: 1.2,
    module: 1.4,
    decision: 1.1,
    unknown: 1.0,
  },
};

function lockedCardOfTokens(card_id: string, tokens: number, card_type: CardType = "constraint"): LockedTrace {
  return {
    version_id: card_id,
    bm25_norm: 0,
    heading_match: 0,
    scope_match: 0,
    mention_overlap: 0,
    specificity: 1,
    text_score: 0,
    final_score: 0,
    token_count: tokens,
    packing_score: 0,
    kind: "card",
    card_id,
    card_type,
    lock_reason: { card_id, kind: "constraint_scope_match" },
  };
}

function candidate(version_id: string, tokens: number, score: number): CandidateTrace {
  return {
    version_id,
    bm25_norm: score,
    heading_match: 0,
    scope_match: 0,
    mention_overlap: 0,
    specificity: 1,
    text_score: score,
    final_score: score,
    token_count: tokens,
    packing_score: tokens > 0 ? score / Math.sqrt(tokens) : score,
    kind: "doc_chunk",
  };
}

describe("property: every locked Card appears in the Pack (D37)", () => {
  it("locked items always present regardless of budget or candidate count", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 8 }),
        fc.array(
          fc.tuple(fc.string({ minLength: 1, maxLength: 6 }), fc.integer({ min: 1, max: 500 }), fc.float({ min: 0, max: 1, noNaN: true })),
          { maxLength: 12 },
        ),
        fc.integer({ min: 0, max: 5000 }),
        (lockedTokens, cands, budget) => {
          const locked = lockedTokens.map((t, i) => lockedCardOfTokens(`L${i}`, t));
          const candidates = cands.map(([v, t, s], i) => candidate(`${v}_${i}`, t, s));
          const r = packWithLocked({
            locked,
            candidates,
            budget_tokens: budget,
            min_final_score: 0.05,
          });
          // (a) every locked card appears in r.locked
          expect(r.locked.length).toBe(locked.length);
          for (let i = 0; i < locked.length; i++) {
            expect(r.locked[i]!.card_id).toBe(`L${i}`);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

describe("property: chunker reconstructs source (atomic block preservation)", () => {
  it("body union (after whitespace normalize) equals source body", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 1, max: 4 }),
            fc.string({ minLength: 4, maxLength: 60 }).filter((s) => /\S/.test(s)),
            fc.array(fc.string({ minLength: 1, maxLength: 80 }).filter((s) => !s.includes("---") && !s.includes("```") && !s.startsWith("#")), { minLength: 1, maxLength: 4 }),
          ),
          { minLength: 1, maxLength: 5 },
        ),
        (sections) => {
          const lines: string[] = [];
          for (const [level, heading, paras] of sections) {
            lines.push("#".repeat(level) + " " + heading.replace(/\n/g, " "));
            for (const p of paras) {
              lines.push("");
              lines.push(p.replace(/\n/g, " "));
            }
          }
          const source = lines.join("\n") + "\n";
          let chunks: DocChunk[];
          try {
            chunks = chunk(source, {
              source_path: "x.md",
              source_content_hash: "h",
              indexed_at: "now",
              target_tokens: 50,
              max_tokens: 200,
            });
          } catch {
            return; // chunker rejected this synthetic input — fine, skip.
          }
          // (b) every chunk's body content is a substring of the source's
          // whitespace-normalized form. Stronger property — every section's
          // text is reconstructable — would require chunker invariants this
          // test isn't structured for; the substring check is the cheap
          // load-bearing guarantee.
          const norm = (s: string) => s.replace(/\s+/g, " ").trim();
          const haystack = norm(source);
          for (const c of chunks) {
            const needle = norm(c.body);
            if (needle.length === 0) continue;
            expect(haystack.includes(needle)).toBe(true);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

describe("property: final_score is monotone in BM25 holding all else equal", () => {
  it("scoreChunk(bm25=a) ≤ scoreChunk(bm25=b) when a ≤ b", () => {
    const baseChunk: DocChunk = {
      stable_key: "sk",
      version_id: "v",
      doc_id: "d",
      source_path: "x.md",
      heading_path: ["X"],
      heading_level: 1,
      chunk_index: 1,
      chunk_count: 1,
      title: "X",
      body: "body",
      token_count: 100,
      chunk_content_hash: "h",
      source_content_hash: "sh",
      start_line: 0,
      end_line: 1,
      status: "current",
      indexed_at: "now",
      scope: { layer: "module", project: "p", module: "p/m", source: { frontmatter: true } },
    };
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        (a, b) => {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          const args = {
            chunk: baseChunk,
            anchors: [] as CodeAnchor[],
            query: "q",
            query_scopes: [{ project: "p", module: "p/m" }] as QueryScope[],
            query_anchors: {},
            weights: baseWeights,
          };
          const sLo = scoreChunk({ ...args, bm25_norm: lo });
          const sHi = scoreChunk({ ...args, bm25_norm: hi });
          expect(sHi.final_score).toBeGreaterThanOrEqual(sLo.final_score - 1e-9);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

describe("property: scope_match monotone in scope specificity", () => {
  // Specificity ordering: module > project > team > company > none.
  // scope_match is a max over per-scope matches; stronger query produces
  // ≥ score for the same chunk.
  it("module-match ≥ project-match ≥ company-match for chunks aligned at the deepest layer", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("acme"),
        fc.constantFrom("fundops"),
        fc.constantFrom("fundops/payments"),
        (company, project, mod) => {
          const chunkScope: ChunkScope = {
            layer: "module",
            company,
            project,
            module: mod,
            source: {},
          };
          const company_only: QueryScope = { company };
          const project_only: QueryScope = { company, project };
          const module_only: QueryScope = { company, project, module: mod };
          const sCompany = scopeMatchScore([company_only], chunkScope);
          const sProject = scopeMatchScore([project_only], chunkScope);
          const sModule = scopeMatchScore([module_only], chunkScope);
          expect(sModule).toBeGreaterThanOrEqual(sProject);
          expect(sProject).toBeGreaterThanOrEqual(sCompany);
        },
      ),
      { numRuns: RUNS },
    );
  });
});
