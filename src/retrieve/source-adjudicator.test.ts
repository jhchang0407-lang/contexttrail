/**
 * THO-163 (PRD-0016 / P16.5): deterministic pairwise source
 * adjudicator.
 *
 * Compares two top-N candidate source cards for a specific query
 * intent and returns a winner ("a" | "b" | "tie"), confidence, margin,
 * and ordered reason codes. Bounded by design: a no-op path returns
 * "tie" when there is no decisive evidence so it can be applied only
 * to close-call top-N pairs.
 *
 * The synthetic probes below cover the named cohorts PRD-0016 calls
 * out:
 *   - parent overview vs child detail
 *   - canonical guide vs API reference
 *   - decision/concept vs procedural leaf
 *   - exact path/title/H1 phrase vs body-density distractor
 *   - changelog/release vs README/migration
 */
import { describe, expect, it } from "vitest";
import {
  adjudicateSourcePair,
  type AdjudicateSourcePairArgs,
  type AdjudicationOutcome,
} from "./source-adjudicator.js";
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

function candidate(p: Partial<ProfileEnrichedSourceCandidate>): ProfileEnrichedSourceCandidate {
  return {
    rank: p.rank ?? 1,
    source_path: p.source_path ?? "docs/x.md",
    best_chunk_rank: p.best_chunk_rank ?? 1,
    best_chunk_score: p.best_chunk_score ?? 0.5,
    contributing_chunks: p.contributing_chunks ?? [
      { version_id: "v1", rank: 1, final_score: 0.5 },
    ],
    profile: p.profile ?? profile({ source_path: p.source_path ?? "docs/x.md" }),
    ...p,
  };
}

function pair(
  aPath: string,
  aProfile: Partial<SourceProfile>,
  bPath: string,
  bProfile: Partial<SourceProfile>,
  task: string,
  query_intent: AdjudicateSourcePairArgs["query_intent"] = "broad_domain",
): AdjudicationOutcome {
  const cands = [
    candidate({ rank: 1, source_path: aPath, profile: profile({ source_path: aPath, ...aProfile }) }),
    candidate({ rank: 2, source_path: bPath, profile: profile({ source_path: bPath, ...bProfile }) }),
  ];
  const cards = buildSourceCardsFromCandidates({
    candidates: cands,
    query_tokens: task.split(/\s+/).map((s) => s.toLowerCase()),
    query_intent,
    top_n: 5,
    task,
  });
  return adjudicateSourcePair({ a: cards[0]!, b: cards[1]!, query_intent });
}

describe("adjudicateSourcePair — parent overview vs child detail", () => {
  it("for a broad_domain query, a parent overview wins over a child detail", () => {
    const out = pair(
      "docs/mocking.md",
      { title: "Mocking", doc_purpose: "guide", purpose_source: "path_rule" },
      "docs/mocking/modules.md",
      { title: "Modules", doc_purpose: "guide", purpose_source: "path_rule" },
      "mocking",
      "broad_domain",
    );
    expect(out.winner).toBe("a");
    expect(out.reason_codes).toContain("canonicality_parent_for_broad");
  });

  it("for an exact_symbol query, a child detail can win over the parent overview", () => {
    const out = pair(
      "docs/mocking.md",
      { title: "Mocking", doc_purpose: "guide", purpose_source: "path_rule" },
      "docs/mocking/modules.md",
      { title: "Modules", doc_purpose: "guide", purpose_source: "path_rule" },
      "modules",
      "exact_symbol",
    );
    // Exact-symbol queries shouldn't punish the leaf for being a leaf
    // when its phrase evidence is stronger.
    expect(["b", "tie"]).toContain(out.winner);
  });
});

describe("adjudicateSourcePair — canonical guide vs API reference", () => {
  it("for broad_domain, a guide beats an API reference", () => {
    const out = pair(
      "docs/guide.md",
      { title: "Guide", doc_purpose: "guide", purpose_source: "path_rule" },
      "docs/api/reference.md",
      { title: "API reference", doc_purpose: "api_reference", purpose_source: "frontmatter" },
      "guide",
      "broad_domain",
    );
    expect(out.winner).toBe("a");
    expect(out.reason_codes).toContain("role_compat_guide_for_broad");
  });

  it("for exact_symbol, an API reference beats a generic guide", () => {
    const out = pair(
      "docs/guide.md",
      { title: "Guide", doc_purpose: "guide", purpose_source: "path_rule" },
      "docs/api/reference.md",
      { title: "API reference", doc_purpose: "api_reference", purpose_source: "frontmatter" },
      "reference",
      "exact_symbol",
    );
    expect(out.winner).toBe("b");
    expect(out.reason_codes).toContain("role_compat_api_for_exact");
  });
});

describe("adjudicateSourcePair — decision/concept vs procedural leaf", () => {
  it("for decision_lookup, a decision doc beats a procedural leaf", () => {
    const out = pair(
      "docs/adr/0007-hybrid.md",
      { title: "Hybrid scoring", doc_purpose: "adr", purpose_source: "path_rule" },
      "docs/scripts/run.md",
      { title: "Run script", doc_purpose: "guide", purpose_source: "path_rule" },
      "hybrid scoring decision",
      "decision_lookup",
    );
    expect(out.winner).toBe("a");
    expect(out.reason_codes).toContain("role_compat_decision_for_decision_lookup");
  });
});

describe("adjudicateSourcePair — phrase / proximity wins over body density", () => {
  it("a title phrase hit beats a candidate with only scattered body evidence", () => {
    const out = pair(
      "docs/error-handling.md",
      { title: "Error handling", doc_purpose: "guide", purpose_source: "path_rule" },
      "docs/runtime.md",
      { title: "Runtime", doc_purpose: "guide", purpose_source: "path_rule" },
      "error handling",
      "broad_domain",
    );
    expect(out.winner).toBe("a");
    expect(out.reason_codes).toContain("phrase_proximity_stronger");
  });
});

describe("adjudicateSourcePair — changelog/release vs README/migration", () => {
  it("for a release-intent query, a changelog beats a README", () => {
    const out = pair(
      "CHANGELOG.md",
      { title: "Changelog", doc_purpose: "changelog", purpose_source: "title_rule" },
      "README.md",
      { title: "README", doc_purpose: "readme", purpose_source: "title_rule" },
      "changelog release",
      "broad_domain",
    );
    // Reason code identifies the role-driven win.
    expect(out.winner).toBe("a");
    expect(out.reason_codes).toContain("role_compat_changelog_for_release_intent");
  });

  it("for a migration-intent query, a migration doc beats a changelog", () => {
    const out = pair(
      "MIGRATION.md",
      { title: "Migration guide", doc_purpose: "migration", purpose_source: "title_rule" },
      "CHANGELOG.md",
      { title: "Changelog", doc_purpose: "changelog", purpose_source: "title_rule" },
      "migration upgrade",
      "broad_domain",
    );
    expect(out.winner).toBe("a");
  });
});

describe("adjudicateSourcePair — bounded no-op path", () => {
  it("returns tie / low confidence when the two candidates carry essentially the same evidence", () => {
    const out = pair(
      "docs/a.md",
      { title: "Topic", doc_purpose: "guide", purpose_source: "path_rule" },
      "docs/b.md",
      { title: "Topic", doc_purpose: "guide", purpose_source: "path_rule" },
      "topic",
      "broad_domain",
    );
    expect(out.winner).toBe("tie");
    expect(out.confidence).toBe("low");
  });
});

describe("adjudicateSourcePair — never promotes signal-empty / unsupported cases", () => {
  it("does not amplify confidence when neither candidate has phrase or role evidence for the task", () => {
    const out = pair(
      "docs/random-1.md",
      { title: "Random one", doc_purpose: "unknown", purpose_source: "default" },
      "docs/random-2.md",
      { title: "Random two", doc_purpose: "unknown", purpose_source: "default" },
      "completely unrelated query terms",
      "signal_empty",
    );
    expect(out.winner).toBe("tie");
    expect(out.confidence).toBe("low");
  });
});

describe("adjudicateSourcePair — anchor-symbol exact basename match (THO-164 expansion)", () => {
  it("strongly prefers a candidate whose path basename equals an anchor symbol verbatim (case-preserving)", () => {
    const cands = [
      candidate({
        rank: 1,
        source_path: "docs/client/react/useQueries.md",
        profile: profile({
          source_path: "docs/client/react/useQueries.md",
          title: "useQueries",
          h1: "useQueries()",
          doc_purpose: "guide",
        }),
      }),
      candidate({
        rank: 2,
        source_path: "docs/client/react/useQuery.md",
        profile: profile({
          source_path: "docs/client/react/useQuery.md",
          title: "useQuery",
          h1: "useQuery",
          doc_purpose: "guide",
        }),
      }),
    ];
    const cards = buildSourceCardsFromCandidates({
      candidates: cands,
      query_tokens: ["fetch", "data", "us", "queri", "trpc", "react"],
      query_intent: "file_anchored",
      top_n: 5,
      task: "fetch data with useQuery from a trpc react client",
      anchor_symbols: ["useQuery"],
    });
    const out = adjudicateSourcePair({ a: cards[0]!, b: cards[1]!, query_intent: "file_anchored" });
    expect(out.winner).toBe("b");
    expect(out.reason_codes).toContain("anchor_symbol_basename_match");
  });

  it("does not vote when neither basename matches the symbol verbatim", () => {
    const cands = [
      candidate({
        rank: 1,
        source_path: "docs/a.md",
        profile: profile({ source_path: "docs/a.md", title: "A", doc_purpose: "guide" }),
      }),
      candidate({
        rank: 2,
        source_path: "docs/b.md",
        profile: profile({ source_path: "docs/b.md", title: "B", doc_purpose: "guide" }),
      }),
    ];
    const cards = buildSourceCardsFromCandidates({
      candidates: cands,
      query_tokens: ["topic"],
      query_intent: "file_anchored",
      top_n: 5,
      task: "topic",
      anchor_symbols: ["NonexistentSymbol"],
    });
    const out = adjudicateSourcePair({ a: cards[0]!, b: cards[1]!, query_intent: "file_anchored" });
    expect(out.reason_codes).not.toContain("anchor_symbol_basename_match");
  });

  it("matches a compound anchor by topic word against a single-word basename (publicProcedure → procedures.md)", () => {
    const cands = [
      candidate({
        rank: 1,
        source_path: "docs/server/validators.md",
        profile: profile({ source_path: "docs/server/validators.md", title: "Input Validators", doc_purpose: "guide" }),
      }),
      candidate({
        rank: 2,
        source_path: "docs/server/procedures.md",
        profile: profile({ source_path: "docs/server/procedures.md", title: "Procedures", doc_purpose: "guide" }),
      }),
    ];
    const cards = buildSourceCardsFromCandidates({
      candidates: cands,
      query_tokens: ["defin", "queri", "procedur", "input", "valid", "trpc"],
      query_intent: "file_anchored",
      top_n: 5,
      task: "define a query procedure with input validation in trpc",
      anchor_symbols: ["publicProcedure"],
    });
    const out = adjudicateSourcePair({ a: cards[0]!, b: cards[1]!, query_intent: "file_anchored" });
    expect(out.winner).toBe("b");
    expect(out.reason_codes).toContain("anchor_symbol_basename_match");
  });

  it("matches a dotted anchor (vi.mock → mocking.md) by topic word", () => {
    const cands = [
      candidate({
        rank: 1,
        source_path: "docs/guide/mocking/modules.md",
        profile: profile({
          source_path: "docs/guide/mocking/modules.md",
          title: "Mocking Modules",
          doc_purpose: "guide",
        }),
      }),
      candidate({
        rank: 2,
        source_path: "docs/guide/mocking.md",
        profile: profile({
          source_path: "docs/guide/mocking.md",
          title: "Mocking",
          doc_purpose: "guide",
        }),
      }),
    ];
    const cards = buildSourceCardsFromCandidates({
      candidates: cands,
      query_tokens: ["mock", "modul", "vitest"],
      query_intent: "file_anchored",
      top_n: 5,
      task: "mock a module in a vitest test",
      anchor_symbols: ["vi.mock"],
    });
    const out = adjudicateSourcePair({ a: cards[0]!, b: cards[1]!, query_intent: "file_anchored" });
    expect(out.winner).toBe("b");
    expect(out.reason_codes).toContain("anchor_symbol_basename_match");
  });

  it("does not vote when both candidates share the same basename match (no differentiator)", () => {
    // Pathological case: both files have the same basename. Symbol
    // match must not blindly favor one — it has to be a tie-breaker.
    const cands = [
      candidate({
        rank: 1,
        source_path: "a/useQuery.md",
        profile: profile({ source_path: "a/useQuery.md", title: "useQuery", doc_purpose: "guide" }),
      }),
      candidate({
        rank: 2,
        source_path: "b/useQuery.md",
        profile: profile({ source_path: "b/useQuery.md", title: "useQuery", doc_purpose: "guide" }),
      }),
    ];
    const cards = buildSourceCardsFromCandidates({
      candidates: cands,
      query_tokens: ["us", "queri"],
      query_intent: "file_anchored",
      top_n: 5,
      task: "useQuery",
      anchor_symbols: ["useQuery"],
    });
    const out = adjudicateSourcePair({ a: cards[0]!, b: cards[1]!, query_intent: "file_anchored" });
    expect(out.reason_codes).not.toContain("anchor_symbol_basename_match");
  });
});

describe("adjudicateSourcePair — structural-field token coverage (THO-164 expansion)", () => {
  it("strongly prefers a candidate whose title carries a query-topic token when the other's title carries none", () => {
    // Query "snapshot testing in vitest". The competing candidate's
    // title is generic ("Vitest" / "Guide") with NO query topic
    // token; the correct candidate has "Snapshot" in its title and
    // path basename. The signal fires on the asymmetric coverage.
    const cands = [
      candidate({
        rank: 1,
        source_path: "docs/guide/index.md",
        profile: profile({
          source_path: "docs/guide/index.md",
          title: "Vitest Guide",
          h1: "Vitest Guide",
          doc_purpose: "guide",
        }),
      }),
      candidate({
        rank: 2,
        source_path: "docs/guide/snapshot.md",
        profile: profile({
          source_path: "docs/guide/snapshot.md",
          title: "Snapshot Testing",
          h1: "Snapshot Testing",
          doc_purpose: "guide",
        }),
      }),
    ];
    const cards = buildSourceCardsFromCandidates({
      candidates: cands,
      query_tokens: ["snapshot", "test", "vitest"],
      query_intent: "broad_domain",
      top_n: 5,
      task: "snapshot testing in vitest",
    });
    const out = adjudicateSourcePair({ a: cards[0]!, b: cards[1]!, query_intent: "broad_domain" });
    expect(out.winner).toBe("b");
    expect(out.reason_codes).toContain("title_token_coverage_decisive");
  });

  it("does not vote when title-token-coverage difference is small", () => {
    const cands = [
      candidate({
        rank: 1,
        source_path: "docs/a.md",
        profile: profile({ source_path: "docs/a.md", title: "A topic doc" }),
      }),
      candidate({
        rank: 2,
        source_path: "docs/b.md",
        profile: profile({ source_path: "docs/b.md", title: "Another topic doc" }),
      }),
    ];
    const cards = buildSourceCardsFromCandidates({
      candidates: cands,
      query_tokens: ["topic"],
      query_intent: "broad_domain",
      top_n: 5,
      task: "topic",
    });
    const out = adjudicateSourcePair({ a: cards[0]!, b: cards[1]!, query_intent: "broad_domain" });
    expect(out.reason_codes).not.toContain("title_token_coverage_decisive");
  });
});

describe("buildAdjudicatorAdapter — V5.x revert protection (THO-164)", () => {
  it("does NOT swap on a canonicality-only diff for a broad/decision query", async () => {
    // The V5.8 / V5.11 / V5.12 reverts showed that swapping live top-1
    // based on a parent_container/leaf signal alone regresses more
    // cases than it fixes. The adapter must treat canonicality as a
    // tie-breaker, not a swap trigger.
    const { buildAdjudicatorAdapter } = await import("./source-adjudicator.js");
    const adapter = buildAdjudicatorAdapter("decision_lookup");
    const cands = [
      candidate({
        rank: 1,
        source_path: "wiki/optionality.md",
        profile: profile({
          source_path: "wiki/optionality.md",
          title: "Optionality in Zod v4",
          // doc_purpose default = unknown → role unknown, canonicality leaf
          doc_purpose: "unknown",
        }),
      }),
      candidate({
        rank: 2,
        source_path: "packages/docs-v3/README.md",
        profile: profile({
          source_path: "packages/docs-v3/README.md",
          title: "README",
          doc_purpose: "package_readme",
          purpose_source: "path_rule",
        }),
      }),
    ];
    const cards = buildSourceCardsFromCandidates({
      candidates: cands,
      query_tokens: ["why", "zod", "separat", "optin", "optout", "option", "field"],
      query_intent: "decision_lookup",
      top_n: 5,
      task: "why does zod separate optin and optout for optional fields",
    });
    const pref = adapter(cards[0]!, cards[1]!);
    expect(pref.preferred).toBe("a");
  });

  it("DOES swap when there is decisive lexical (phrase/proximity) evidence", async () => {
    const { buildAdjudicatorAdapter } = await import("./source-adjudicator.js");
    const adapter = buildAdjudicatorAdapter("broad_domain");
    const cands = [
      candidate({
        rank: 1,
        source_path: "docs/runtime.md",
        profile: profile({ source_path: "docs/runtime.md", title: "Runtime", doc_purpose: "guide" }),
      }),
      candidate({
        rank: 2,
        source_path: "docs/error-handling.md",
        profile: profile({
          source_path: "docs/error-handling.md",
          title: "Error handling",
          h1: "Error handling",
          doc_purpose: "guide",
        }),
      }),
    ];
    const cards = buildSourceCardsFromCandidates({
      candidates: cands,
      query_tokens: ["error", "handl"],
      query_intent: "broad_domain",
      top_n: 5,
      task: "error handling",
    });
    const pref = adapter(cards[0]!, cards[1]!);
    expect(pref.preferred).toBe("b");
  });
});

describe("adjudicateSourcePair — output shape", () => {
  it("includes winner, confidence, margin, and a non-empty reason_codes array on every decision", () => {
    const out = pair(
      "docs/error-handling.md",
      { title: "Error handling", doc_purpose: "guide", purpose_source: "path_rule" },
      "docs/runtime.md",
      { title: "Runtime", doc_purpose: "guide", purpose_source: "path_rule" },
      "error handling",
      "broad_domain",
    );
    expect(out.winner).toBeDefined();
    expect(["high", "medium", "low"]).toContain(out.confidence);
    expect(typeof out.margin).toBe("number");
    expect(Array.isArray(out.reason_codes)).toBe(true);
    expect(out.reason_codes.length).toBeGreaterThan(0);
  });
});
