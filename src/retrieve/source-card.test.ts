/**
 * THO-144 / PRD-0014 V3.2 — source card builder.
 *
 * A source card is a stable, comparable retrieval-metadata record for one
 * candidate source. It is NOT a Context Object: final Context Packs continue
 * to cite Doc Chunks and Cards only. Cards exist so downstream V3 modules
 * (aboutness verifier, source-selection decision, optional pairwise rerank)
 * compare candidates on the same evidence shape.
 *
 * Stability is the load-bearing property — the card serializes to a JSON
 * record that does not depend on Map iteration order or floating-point
 * formatting noise, so eval/explain output stays diffable.
 */
import { describe, expect, it } from "vitest";
import {
  buildSourceCard,
  buildSourceCardsFromCandidates,
  serializeSourceCard,
  type SourceCard,
} from "./source-card.js";
import type { ProfileEnrichedSourceCandidate } from "./source-candidates.js";
import type { SourceProfile } from "../types/source-profile.js";
import { tokenizeForRerank } from "./source-rerank.js";

function profile(overrides: Partial<SourceProfile> = {}): SourceProfile {
  return {
    source_path: "docs/concepts/middleware.md",
    source_content_hash: "h1",
    title: "Middleware",
    h1: "Middleware",
    intro: "Hono middleware concepts and how they compose around handlers.",
    heading_outline: [
      { level: 1, text: "Middleware", slug: "middleware" },
      { level: 2, text: "Composition", slug: "composition" },
    ],
    doc_role: "canonical",
    role_source: "default",
    doc_purpose: "concept",
    purpose_source: "path_rule",
    aliases: [
      { kind: "title", value: "Middleware", confidence: "high", origin: "title" },
      { kind: "filename", value: "middleware", confidence: "medium", origin: "filename" },
    ],
    summary: null,
    summary_source: "empty",
    questions_answered: ["What is middleware?"],
    questions_answered_source: "heading_question_extraction",
    chunk_count: 4,
    token_count: 1200,
    indexed_at: "2026-05-08T00:00:00Z",
    ...overrides,
  };
}

function candidate(
  overrides: Partial<ProfileEnrichedSourceCandidate> = {},
): ProfileEnrichedSourceCandidate {
  return {
    rank: 1,
    source_path: "docs/concepts/middleware.md",
    best_chunk_rank: 1,
    best_chunk_score: 0.78,
    contributing_chunks: [
      { version_id: "vid-1", rank: 1, final_score: 0.78 },
      { version_id: "vid-2", rank: 5, final_score: 0.42 },
    ],
    profile: profile(),
    fused_rank: 1,
    fused_path_count: 3,
    ...overrides,
  };
}

describe("buildSourceCard", () => {
  it("returns a record with source identity, query intent, and rank", () => {
    const card = buildSourceCard({
      candidate: candidate(),
      query_tokens: ["middleware", "decision"],
      query_intent: "decision_lookup",
      rank: 1,
    });
    expect(card.source_path).toBe("docs/concepts/middleware.md");
    expect(card.rank).toBe(1);
    expect(card.query_intent).toBe("decision_lookup");
  });

  it("captures profile signals: title, doc_purpose, doc_role, headings, aliases", () => {
    const card = buildSourceCard({
      candidate: candidate(),
      query_tokens: ["middleware"],
      query_intent: "decision_lookup",
      rank: 1,
    });
    expect(card.profile_signals?.title).toBe("Middleware");
    expect(card.profile_signals?.doc_purpose).toBe("concept");
    expect(card.profile_signals?.doc_role).toBe("canonical");
    expect(card.profile_signals?.heading_count).toBe(2);
    expect(card.profile_signals?.alias_kinds).toEqual(["title", "filename"]);
  });

  it("captures candidate-path evidence: best chunk rank/score, contributing count, fused agreement", () => {
    const card = buildSourceCard({
      candidate: candidate(),
      query_tokens: ["middleware"],
      query_intent: "decision_lookup",
      rank: 1,
    });
    expect(card.candidate_path_evidence.best_chunk_rank).toBe(1);
    expect(card.candidate_path_evidence.best_chunk_score).toBeCloseTo(0.78);
    expect(card.candidate_path_evidence.contributing_chunk_count).toBe(2);
    expect(card.candidate_path_evidence.fused_path_count).toBe(3);
  });

  it("captures top chunk evidence so source-level decisions remain grounded", () => {
    const card = buildSourceCard({
      candidate: candidate(),
      query_tokens: ["middleware"],
      query_intent: "decision_lookup",
      rank: 1,
    });
    expect(card.top_chunk_evidence.version_id).toBe("vid-1");
    expect(card.top_chunk_evidence.rank).toBe(1);
    expect(card.top_chunk_evidence.final_score).toBeCloseTo(0.78);
  });

  it("computes token coverage against title, path, and headings", () => {
    const card = buildSourceCard({
      candidate: candidate(),
      query_tokens: tokenizeForRerank("middleware composition"),
      query_intent: "decision_lookup",
      rank: 1,
    });
    expect(card.token_coverage.title_token_coverage).toBeGreaterThan(0);
    expect(card.token_coverage.path_token_coverage).toBeGreaterThan(0);
    expect(card.token_coverage.heading_token_coverage).toBeGreaterThan(0);
  });

  it("survives a missing profile by emitting null profile_signals and zero token coverage", () => {
    const card = buildSourceCard({
      candidate: candidate({ profile: null }),
      query_tokens: tokenizeForRerank("middleware"),
      query_intent: "decision_lookup",
      rank: 1,
    });
    expect(card.profile_signals).toBeNull();
    expect(card.token_coverage.title_token_coverage).toBe(0);
    expect(card.token_coverage.heading_token_coverage).toBe(0);
    // Path tokens still count even without a profile.
    expect(card.token_coverage.path_token_coverage).toBeGreaterThan(0);
  });

  it("attaches an optional coverage decision when supplied", () => {
    const card = buildSourceCard({
      candidate: candidate(),
      query_tokens: ["middleware"],
      query_intent: "decision_lookup",
      rank: 1,
      coverage: {
        verdict: "supported",
        signals: ["alias_anchor", "title_match"],
      },
    });
    expect(card.coverage_decision).toEqual({
      verdict: "supported",
      signals: ["alias_anchor", "title_match"],
    });
  });
});

describe("buildSourceCard — phrase/proximity evidence (THO-160)", () => {
  it("does not populate phrase_proximity when no task string is provided", () => {
    const card = buildSourceCard({
      candidate: candidate(),
      query_tokens: ["middleware"],
      query_intent: "decision_lookup",
      rank: 1,
    });
    expect(card.phrase_proximity).toBeNull();
  });

  it("attaches structured phrase evidence when a task string is provided", () => {
    const card = buildSourceCard({
      candidate: candidate(),
      query_tokens: ["middleware"],
      query_intent: "decision_lookup",
      rank: 1,
      task: "middleware",
    });
    expect(card.phrase_proximity).not.toBeNull();
    // "middleware" appears in the candidate's title, h1, and path.
    expect(card.phrase_proximity?.title).toBe("exact");
    expect(card.phrase_proximity?.h1).toBe("exact");
    expect(card.phrase_proximity?.path).toBe("exact");
  });

  it("treats source-level phrase evidence (path / title / h1) as best_field over body density", () => {
    // Candidate path / title / h1 all carry the phrase. Even if the
    // task is the same phrase, best_field must come from a structural
    // field, not body — body isn't even part of the card surface.
    const card = buildSourceCard({
      candidate: candidate(),
      query_tokens: ["middleware"],
      query_intent: "decision_lookup",
      rank: 1,
      task: "middleware",
    });
    expect(["path", "title", "h1"]).toContain(card.phrase_proximity?.best_field);
  });

  it("falls back gracefully when the candidate has no profile", () => {
    const card = buildSourceCard({
      candidate: candidate({ profile: null }),
      query_tokens: ["middleware"],
      query_intent: "decision_lookup",
      rank: 1,
      task: "middleware",
    });
    // Path is still available even without a profile, so best_field
    // resolves to "path" rather than "none".
    expect(card.phrase_proximity?.best_field).toBe("path");
  });
});

describe("buildSourceCard — source role classification (THO-161)", () => {
  it("attaches a deterministic role + canonicality + provenance to every card", () => {
    const card = buildSourceCard({
      candidate: candidate(),
      query_tokens: ["middleware"],
      query_intent: "decision_lookup",
      rank: 1,
    });
    // doc_purpose=concept on the default candidate maps to role=concept.
    expect(card.source_role.role).toBe("concept");
    expect(card.source_role.canonicality).toBe("leaf");
    expect(card.source_role.confidence).toBe("medium");
    expect(card.source_role.provenance.length).toBeGreaterThan(0);
  });

  it("uses the top-N candidate set as siblings for canonicality detection", () => {
    const parent = candidate({
      source_path: "docs/mocking.md",
      rank: 1,
      profile: profile({ source_path: "docs/mocking.md", title: "Mocking", doc_purpose: "guide" }),
    });
    const child = candidate({
      source_path: "docs/mocking/modules.md",
      rank: 2,
      profile: profile({
        source_path: "docs/mocking/modules.md",
        title: "Modules",
        doc_purpose: "guide",
      }),
    });
    const cards = buildSourceCardsFromCandidates({
      candidates: [parent, child],
      query_tokens: tokenizeForRerank("mocking"),
      query_intent: "broad_domain",
      top_n: 5,
    });
    const parentCard = cards.find((c) => c.source_path === "docs/mocking.md")!;
    const childCard = cards.find((c) => c.source_path === "docs/mocking/modules.md")!;
    expect(parentCard.source_role.canonicality).toBe("parent");
    expect(childCard.source_role.canonicality).toBe("child");
  });
});

describe("buildSourceCardsFromCandidates — source family graph (THO-162)", () => {
  it("attaches family membership to each card built over the candidate set", () => {
    const parent = candidate({
      source_path: "docs/mocking.md",
      rank: 1,
      profile: profile({ source_path: "docs/mocking.md", title: "Mocking", doc_purpose: "guide" }),
    });
    const child = candidate({
      source_path: "docs/mocking/modules.md",
      rank: 2,
      profile: profile({
        source_path: "docs/mocking/modules.md",
        title: "Modules",
        doc_purpose: "guide",
      }),
    });
    const cards = buildSourceCardsFromCandidates({
      candidates: [parent, child],
      query_tokens: tokenizeForRerank("mocking"),
      query_intent: "broad_domain",
      top_n: 5,
    });
    const parentCard = cards.find((c) => c.source_path === "docs/mocking.md")!;
    const childCard = cards.find((c) => c.source_path === "docs/mocking/modules.md")!;
    expect(parentCard.source_family?.relationship).toBe("parent");
    expect(childCard.source_family?.relationship).toBe("child");
    expect(parentCard.source_family?.family_id).toBe(childCard.source_family?.family_id);
  });

  it("leaves source_family null on cards built without the candidate-set helper", () => {
    const card = buildSourceCard({
      candidate: candidate(),
      query_tokens: ["middleware"],
      query_intent: "decision_lookup",
      rank: 1,
    });
    expect(card.source_family).toBeNull();
  });
});

describe("buildSourceCard — path-topology forwarding (PRD-0023 / 23.2)", () => {
  it("forwards path-topology fields from the source profile onto the card", () => {
    const cand = candidate({
      source_path: "docs/mocking.md",
      profile: profile({
        source_path: "docs/mocking.md",
        path_depth: 1,
        is_index_file: false,
        is_section_landing: true,
        package_segment: null,
        version_segment: "v3",
      }),
    });
    const card = buildSourceCard({
      candidate: cand,
      query_tokens: ["mocking"],
      query_intent: "broad_domain",
      rank: 1,
    });
    expect(card.path_topology.path_depth).toBe(1);
    expect(card.path_topology.is_index_file).toBe(false);
    expect(card.path_topology.is_section_landing).toBe(true);
    expect(card.path_topology.package_segment).toBeNull();
    expect(card.path_topology.version_segment).toBe("v3");
  });

  it("emits an empty topology object when the candidate has no profile", () => {
    const card = buildSourceCard({
      candidate: candidate({ profile: null }),
      query_tokens: ["mocking"],
      query_intent: "broad_domain",
      rank: 1,
    });
    expect(card.path_topology).toEqual({});
  });
});

describe("buildSourceCard — heading_aliases forwarding (PRD-0024 / 24.1.2)", () => {
  it("forwards heading aliases from the source profile onto the card", () => {
    const cand = candidate({
      profile: profile({
        heading_aliases: [
          {
            surface: "Module Mocking",
            normalized: "module mocking",
            tokens: ["modul", "mock"],
            depth: 2,
            section_path: ["Mocking"],
          },
        ],
      }),
    });
    const card = buildSourceCard({
      candidate: cand,
      query_tokens: ["mocking"],
      query_intent: "broad_domain",
      rank: 1,
    });
    expect(card.heading_aliases).toHaveLength(1);
    expect(card.heading_aliases[0]?.surface).toBe("Module Mocking");
  });

  it("emits an empty heading_aliases array when the candidate has no profile", () => {
    const card = buildSourceCard({
      candidate: candidate({ profile: null }),
      query_tokens: ["mocking"],
      query_intent: "broad_domain",
      rank: 1,
    });
    expect(card.heading_aliases).toEqual([]);
  });
});

describe("buildSourceCard — code_fence_entities forwarding (PRD-0024 / 24.2.2)", () => {
  it("forwards code-fence entities from the source profile onto the card", () => {
    const cand = candidate({
      profile: profile({
        code_fence_entities: [
          {
            kind: "symbol",
            value: "publicProcedure",
            normalized: "publicprocedure",
            language: "ts",
            section_heading: "Routers",
          },
        ],
      }),
    });
    const card = buildSourceCard({
      candidate: cand,
      query_tokens: ["publicprocedure"],
      query_intent: "exact_symbol",
      rank: 1,
    });
    expect(card.code_fence_entities).toHaveLength(1);
    expect(card.code_fence_entities[0]?.value).toBe("publicProcedure");
    expect(card.code_fence_entities[0]?.kind).toBe("symbol");
  });

  it("emits an empty code_fence_entities array when the candidate has no profile", () => {
    const card = buildSourceCard({
      candidate: candidate({ profile: null }),
      query_tokens: ["zod"],
      query_intent: "exact_symbol",
      rank: 1,
    });
    expect(card.code_fence_entities).toEqual([]);
  });
});

describe("serializeSourceCard", () => {
  it("produces stable JSON ordered by key, independent of input map order", () => {
    const a: SourceCard = buildSourceCard({
      candidate: candidate(),
      query_tokens: ["middleware"],
      query_intent: "decision_lookup",
      rank: 1,
    });
    const b: SourceCard = buildSourceCard({
      candidate: candidate(),
      query_tokens: ["middleware"],
      query_intent: "decision_lookup",
      rank: 1,
    });
    expect(serializeSourceCard(a)).toBe(serializeSourceCard(b));
  });

  it("builds cards for the top-N candidates in rank order", () => {
    const c1 = candidate({ source_path: "a.md", rank: 1 });
    const c2 = candidate({
      source_path: "b.md",
      rank: 2,
      profile: profile({ source_path: "b.md", title: "B doc" }),
    });
    const c3 = candidate({
      source_path: "c.md",
      rank: 3,
      profile: profile({ source_path: "c.md", title: "C doc" }),
    });
    const cards = buildSourceCardsFromCandidates({
      candidates: [c3, c1, c2],
      query_tokens: tokenizeForRerank("middleware"),
      query_intent: "decision_lookup",
      top_n: 2,
    });
    expect(cards.map((c) => c.source_path)).toEqual(["a.md", "b.md"]);
    expect(cards.map((c) => c.rank)).toEqual([1, 2]);
  });

  it("forwards coverage decisions by source path when provided", () => {
    const c1 = candidate({ source_path: "a.md", rank: 1 });
    const cards = buildSourceCardsFromCandidates({
      candidates: [c1],
      query_tokens: tokenizeForRerank("middleware"),
      query_intent: "decision_lookup",
      top_n: 1,
      coverage_by_source: new Map([
        ["a.md", { verdict: "partial", signals: ["title_only"] }],
      ]),
    });
    expect(cards[0].coverage_decision).toEqual({
      verdict: "partial",
      signals: ["title_only"],
    });
  });

  it("rounds floats to 4 decimal places so reports are diffable across runs", () => {
    const card: SourceCard = buildSourceCard({
      candidate: candidate({ best_chunk_score: 0.78912345 }),
      query_tokens: ["middleware"],
      query_intent: "decision_lookup",
      rank: 1,
    });
    const serialized = serializeSourceCard(card);
    expect(serialized).toContain("0.7891");
    expect(serialized).not.toContain("0.78912345");
  });
});

describe("buildSourceCard — nav_metadata forwarding (PRD-0027 / 27.1.2)", () => {
  it("forwards nav fields and provenance from the source profile onto the card", () => {
    const cand = candidate({
      profile: profile({
        nav_section_id: "server",
        nav_position: 1,
        nav_label: "Routers",
        is_nav_landing: true,
        nav_origin: "vitepress",
        nav_provenance: "explicit_config",
      }),
    });
    const card = buildSourceCard({
      candidate: cand,
      query_tokens: ["routers"],
      query_intent: "broad_domain",
      rank: 1,
    });
    expect(card.nav_metadata.nav_section_id).toBe("server");
    expect(card.nav_metadata.nav_position).toBe(1);
    expect(card.nav_metadata.nav_label).toBe("Routers");
    expect(card.nav_metadata.is_nav_landing).toBe(true);
    expect(card.nav_metadata.nav_origin).toBe("vitepress");
    expect(card.nav_metadata.nav_provenance).toBe("explicit_config");
  });

  it("emits an empty nav_metadata object when the candidate has no profile", () => {
    const card = buildSourceCard({
      candidate: candidate({ profile: null }),
      query_tokens: ["routers"],
      query_intent: "broad_domain",
      rank: 1,
    });
    expect(card.nav_metadata).toEqual({});
  });
});
