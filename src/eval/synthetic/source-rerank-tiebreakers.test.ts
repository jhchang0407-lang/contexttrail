import { describe, expect, it } from "vitest";
import {
  SOURCE_RERANK_CLOSE_CALL_RATIO,
  applyCloseCallTiebreakers,
  type CloseCallTiebreakerEntry,
} from "../../retrieve/source-rerank-tiebreakers.js";
import {
  tokenizeForRerank,
  type RerankedSource,
  type SourceRerankFeatures,
} from "../../retrieve/source-rerank.js";
import { porter, tokenize } from "../../retrieve/tokenize.js";
import type { ProfileEnrichedSourceCandidate } from "../../retrieve/source-candidates.js";
import { wilson95Lower } from "./stats.js";

function rawTokens(text: string): string[] {
  return tokenize(text, { stem: false });
}

const ZERO_FEATURES: SourceRerankFeatures = {
  lexical_chunk_score: 0,
  source_rank_prior: 0,
  title_token_coverage: 0,
  path_token_coverage: 0,
  title_path_agreement: 0,
  heading_token_coverage: 0,
  filename_token_coverage: 0,
  intro_token_coverage: 0,
  alias_hit_count: 0,
  owner_identity_score: 0,
  overview_owner_score: 0,
  purpose_compat_bonus: 0,
  distractor_penalty: 0,
  broad_container_penalty: 0,
  leaf_specificity_penalty: 0,
  role_penalty: 0,
};

function reranked(args: {
  source_path: string;
  score: number;
  rank: number;
}): RerankedSource {
  const candidate: ProfileEnrichedSourceCandidate = {
    rank: args.rank,
    source_path: args.source_path,
    best_chunk_rank: args.rank,
    best_chunk_score: args.score,
    contributing_chunks: [
      {
        version_id: `v${args.rank}`,
        rank: args.rank,
        final_score: args.score,
      },
    ],
    profile: null,
  };
  return {
    rank: args.rank,
    candidate,
    score: args.score,
    features: ZERO_FEATURES,
    original_rank: args.rank,
  };
}

function findEntry(
  trace: CloseCallTiebreakerEntry[],
  rule: CloseCallTiebreakerEntry["rule"],
): CloseCallTiebreakerEntry | undefined {
  return trace.find((e) => e.rule === rule);
}

describe("SOURCE_RERANK_CLOSE_CALL_RATIO", () => {
  it("equals 0.10", () => {
    expect(SOURCE_RERANK_CLOSE_CALL_RATIO).toBe(0.1);
  });
});

describe("applyCloseCallTiebreakers — Rule 1 (parent_canonicality)", () => {
  it("swaps parent above child on close call when query lacks child-unique tokens", () => {
    const child = reranked({
      source_path: "docs/guide/mocking/modules.md",
      score: 100,
      rank: 1,
    });
    const parent = reranked({
      source_path: "docs/guide/mocking.md",
      score: 99,
      rank: 2,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [child, parent],
      query_tokens: tokenizeForRerank("how do I do mocking in vitest"),
    });
    expect(result.reranked[0]!.candidate.source_path).toBe(
      "docs/guide/mocking.md",
    );
    expect(result.reranked[1]!.candidate.source_path).toBe(
      "docs/guide/mocking/modules.md",
    );
    expect(result.reranked[0]!.rank).toBe(1);
    expect(result.reranked[1]!.rank).toBe(2);
    const entry = findEntry(result.trace, "parent_canonicality");
    expect(entry?.fired).toBe(true);
    expect(entry?.decision).toBe("swap");
  });

  it("keeps child at top when query carries child-unique token", () => {
    const child = reranked({
      source_path: "docs/guide/mocking/modules.md",
      score: 100,
      rank: 1,
    });
    const parent = reranked({
      source_path: "docs/guide/mocking.md",
      score: 99,
      rank: 2,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [child, parent],
      query_tokens: tokenizeForRerank("vitest mocking modules"),
    });
    expect(result.reranked[0]!.candidate.source_path).toBe(
      "docs/guide/mocking/modules.md",
    );
    const entry = findEntry(result.trace, "parent_canonicality");
    expect(entry?.fired).toBe(false);
    expect(entry?.decision).toBe("keep");
    expect(entry?.query_token_intersection).toContain("modul");
  });

  it("does not fire when score gap exceeds close-call ratio (10%)", () => {
    const child = reranked({
      source_path: "docs/guide/mocking/modules.md",
      score: 100,
      rank: 1,
    });
    const parent = reranked({
      source_path: "docs/guide/mocking.md",
      score: 80,
      rank: 2,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [child, parent],
      query_tokens: tokenizeForRerank("mocking"),
    });
    expect(result.reranked[0]!.candidate.source_path).toBe(
      "docs/guide/mocking/modules.md",
    );
    expect(findEntry(result.trace, "parent_canonicality")).toBeUndefined();
  });

  it("does not swap when candidates are not in same family", () => {
    const a = reranked({ source_path: "docs/api/auth.md", score: 100, rank: 1 });
    const b = reranked({ source_path: "docs/guides/sso.md", score: 99, rank: 2 });
    const result = applyCloseCallTiebreakers({
      reranked: [a, b],
      query_tokens: tokenizeForRerank("auth"),
    });
    expect(result.reranked[0]!.candidate.source_path).toBe("docs/api/auth.md");
    expect(findEntry(result.trace, "parent_canonicality")).toBeUndefined();
  });

  it("uses query_anchors when checking for child-unique tokens", () => {
    const child = reranked({
      source_path: "docs/guide/mocking/modules.md",
      score: 100,
      rank: 1,
    });
    const parent = reranked({
      source_path: "docs/guide/mocking.md",
      score: 99,
      rank: 2,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [child, parent],
      query_tokens: tokenizeForRerank("how do I"),
      query_anchors: { files: ["modules.ts"], symbols: [], routes: [] },
    });
    expect(result.reranked[0]!.candidate.source_path).toBe(
      "docs/guide/mocking/modules.md",
    );
    const entry = findEntry(result.trace, "parent_canonicality");
    expect(entry?.fired).toBe(false);
  });

  it("does not fire when parent already at top-1", () => {
    const parent = reranked({
      source_path: "docs/guide/mocking.md",
      score: 100,
      rank: 1,
    });
    const child = reranked({
      source_path: "docs/guide/mocking/modules.md",
      score: 99,
      rank: 2,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [parent, child],
      query_tokens: tokenizeForRerank("mocking"),
    });
    expect(result.reranked[0]!.candidate.source_path).toBe(
      "docs/guide/mocking.md",
    );
    const entry = findEntry(result.trace, "parent_canonicality");
    expect(entry?.fired).toBe(false);
    expect(entry?.decision).toBe("keep");
  });

  it("emits explain trace with rule name, candidates, score gap, decision, reasoning", () => {
    const child = reranked({
      source_path: "docs/guide/mocking/modules.md",
      score: 100,
      rank: 1,
    });
    const parent = reranked({
      source_path: "docs/guide/mocking.md",
      score: 95,
      rank: 2,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [child, parent],
      query_tokens: tokenizeForRerank("mocking"),
    });
    const entry = findEntry(result.trace, "parent_canonicality");
    expect(entry).toBeDefined();
    expect(entry!.candidates).toEqual([
      "docs/guide/mocking/modules.md",
      "docs/guide/mocking.md",
    ]);
    expect(entry!.score_gap).toBeCloseTo(5);
    expect(entry!.score_gap_ratio).toBeCloseTo(0.05);
    expect(entry!.fired).toBe(true);
    expect(entry!.decision).toBe("swap");
    expect(typeof entry!.reasoning).toBe("string");
    expect(entry!.reasoning.length).toBeGreaterThan(0);
  });

  // Adversarial: multi-level family. Rule operates on top1/top2 only.
  it("multi-level family: only top1/top2 are considered (grandchild vs parent)", () => {
    const grandchild = reranked({
      source_path: "docs/api/auth/oidc.md",
      score: 100,
      rank: 1,
    });
    const middle = reranked({
      source_path: "docs/api/auth.md",
      score: 99,
      rank: 2,
    });
    const grandparent = reranked({
      source_path: "docs/api.md",
      score: 60,
      rank: 3,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [grandchild, middle, grandparent],
      query_tokens: tokenizeForRerank("auth"),
    });
    expect(result.reranked[0]!.candidate.source_path).toBe("docs/api/auth.md");
    expect(result.reranked[1]!.candidate.source_path).toBe(
      "docs/api/auth/oidc.md",
    );
    expect(result.reranked[2]!.candidate.source_path).toBe("docs/api.md");
  });

  // Adversarial: generic parent paths (index.md / README.md).
  it("generic parent path (index.md) at top-2 still produces a sensible swap", () => {
    const child = reranked({
      source_path: "docs/api/users.md",
      score: 100,
      rank: 1,
    });
    const parent = reranked({
      source_path: "docs/api/index.md",
      score: 99,
      rank: 2,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [child, parent],
      query_tokens: tokenizeForRerank("api"),
    });
    expect(result.reranked[0]!.candidate.source_path).toBe(
      "docs/api/index.md",
    );
  });

  it("generic parent path (README.md) at top-2 swaps when query lacks child-unique tokens", () => {
    const child = reranked({
      source_path: "packages/zod/src/parser.md",
      score: 100,
      rank: 1,
    });
    const parent = reranked({
      source_path: "packages/zod/src/README.md",
      score: 99,
      rank: 2,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [child, parent],
      query_tokens: tokenizeForRerank("zod overview"),
    });
    expect(result.reranked[0]!.candidate.source_path).toBe(
      "packages/zod/src/README.md",
    );
  });

  // Adversarial: score gap exactly at the threshold.
  it("score gap exactly at the close-call ratio (10%) does NOT fire", () => {
    const child = reranked({
      source_path: "docs/guide/mocking/modules.md",
      score: 100,
      rank: 1,
    });
    const parent = reranked({
      source_path: "docs/guide/mocking.md",
      score: 90,
      rank: 2,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [child, parent],
      query_tokens: tokenizeForRerank("mocking"),
    });
    expect(result.reranked[0]!.candidate.source_path).toBe(
      "docs/guide/mocking/modules.md",
    );
    expect(findEntry(result.trace, "parent_canonicality")).toBeUndefined();
  });

  it("score gap just under the close-call ratio fires", () => {
    const child = reranked({
      source_path: "docs/guide/mocking/modules.md",
      score: 100,
      rank: 1,
    });
    const parent = reranked({
      source_path: "docs/guide/mocking.md",
      score: 91,
      rank: 2,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [child, parent],
      query_tokens: tokenizeForRerank("mocking"),
    });
    expect(result.reranked[0]!.candidate.source_path).toBe(
      "docs/guide/mocking.md",
    );
  });

  it("returns input unchanged when fewer than 2 candidates", () => {
    const only = reranked({
      source_path: "docs/api.md",
      score: 100,
      rank: 1,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [only],
      query_tokens: ["api"],
    });
    expect(result.reranked).toEqual([only]);
    expect(result.trace).toEqual([]);
  });
});

describe("synthetic property: Rule 1 — parent-canonicality", () => {
  it("over 200 random parent-child trees, child wins iff child_unique_tokens ∩ query_tokens ≠ ∅ (lower-95 ≥ 95%)", () => {
    let passed = 0;
    let total = 0;
    const PARENT_WORDS = [
      "mocking",
      "auth",
      "router",
      "queries",
      "events",
      "schema",
      "config",
      "deploy",
      "transform",
      "session",
      "validation",
      "snapshot",
      "procedure",
      "context",
    ];
    const CHILD_WORDS = [
      "modules",
      "tokens",
      "options",
      "params",
      "matcher",
      "history",
      "fields",
      "preview",
      "compile",
      "store",
      "renderer",
      "subscriber",
      "adapter",
      "loader",
    ];
    const FILLER = ["how", "what", "why", "use", "guide", "example"];
    for (let seed = 0; seed < 200; seed += 1) {
      const r = (i: number) => permute(seed, i) / 0xffffffff;
      const parentName = PARENT_WORDS[Math.floor(r(0) * PARENT_WORDS.length)]!;
      const childName = CHILD_WORDS[Math.floor(r(1) * CHILD_WORDS.length)]!;
      const parent_path = `docs/${parentName}.md`;
      const child_path = `docs/${parentName}/${childName}.md`;

      // Build query: always include parentName; sometimes include childName.
      const includeChild = r(2) < 0.5;
      const queryParts = [parentName];
      if (includeChild) queryParts.push(childName);
      // Add filler tokens.
      const fillerCount = Math.floor(r(3) * 3);
      for (let f = 0; f < fillerCount; f += 1) {
        queryParts.push(FILLER[Math.floor(r(10 + f) * FILLER.length)]!);
      }
      const queryTokens = tokenizeForRerank(queryParts.join(" "));

      // Compute the property's expected output directly.
      const parentTokens = new Set(tokenizeForRerank(parent_path));
      const childTokens = new Set(tokenizeForRerank(child_path));
      const childUnique = [...childTokens].filter((t) => !parentTokens.has(t));
      const queryTokenSet = new Set(queryTokens);
      const intersection = childUnique.filter((t) => queryTokenSet.has(t));
      const expectedTop = intersection.length > 0 ? child_path : parent_path;

      // Close-call scores: child at top, gap < threshold.
      const childScore = 100 + Math.floor(r(5) * 50);
      const gapPct = 0.01 + r(6) * 0.08; // 1%..9%
      const parentScore = childScore * (1 - gapPct);
      const childRr = reranked({
        source_path: child_path,
        score: childScore,
        rank: 1,
      });
      const parentRr = reranked({
        source_path: parent_path,
        score: parentScore,
        rank: 2,
      });
      const result = applyCloseCallTiebreakers({
        reranked: [childRr, parentRr],
        query_tokens: queryTokens,
      });
      total += 1;
      if (result.reranked[0]!.candidate.source_path === expectedTop) {
        passed += 1;
      }
    }
    expect(total).toBe(200);
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(0.95);
  });
});

describe("applyCloseCallTiebreakers — Rule 2 (anchor_basename_exact)", () => {
  it("surface-form match wins over stemmed-only match (singular vs plural)", () => {
    // Pair has different parent dirs, so source-family won't link them.
    const stemMatch = reranked({
      source_path: "docs/guide/learn/snapshots.md",
      score: 100,
      rank: 1,
    });
    const surfaceMatch = reranked({
      source_path: "docs/snapshot.md",
      score: 99,
      rank: 2,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [stemMatch, surfaceMatch],
      query_tokens: tokenizeForRerank("snapshot"),
      query_raw_tokens: rawTokens("snapshot"),
    });
    expect(result.reranked[0]!.candidate.source_path).toBe(
      "docs/snapshot.md",
    );
    expect(result.reranked[1]!.candidate.source_path).toBe(
      "docs/guide/learn/snapshots.md",
    );
    const entry = findEntry(result.trace, "anchor_basename_exact");
    expect(entry?.fired).toBe(true);
    expect(entry?.decision).toBe("swap");
    expect(entry?.basename_scores).toBeDefined();
  });

  it("higher total surface score wins", () => {
    const top1 = reranked({
      source_path: "docs/api/users.md",
      score: 100,
      rank: 1,
    });
    const top2 = reranked({
      source_path: "docs/server/procedures.md",
      score: 99,
      rank: 2,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [top1, top2],
      query_tokens: tokenizeForRerank("how do procedures work"),
      query_raw_tokens: rawTokens("how do procedures work"),
    });
    expect(result.reranked[0]!.candidate.source_path).toBe(
      "docs/server/procedures.md",
    );
  });

  it("ties (both candidates surface-match the same query token) do not swap (stable path tie-break)", () => {
    const top1 = reranked({
      source_path: "docs/b/foo.md",
      score: 100,
      rank: 1,
    });
    const top2 = reranked({
      source_path: "docs/a/foo.md",
      score: 99,
      rank: 2,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [top1, top2],
      query_tokens: tokenizeForRerank("foo"),
      query_raw_tokens: rawTokens("foo"),
    });
    expect(result.reranked[0]!.candidate.source_path).toBe("docs/b/foo.md");
    const entry = findEntry(result.trace, "anchor_basename_exact");
    expect(entry?.fired).toBe(false);
  });

  it("does not fire when neither basename matches any query token", () => {
    const top1 = reranked({
      source_path: "docs/api/auth.md",
      score: 100,
      rank: 1,
    });
    const top2 = reranked({
      source_path: "docs/guides/sso.md",
      score: 99,
      rank: 2,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [top1, top2],
      query_tokens: tokenizeForRerank("how do I configure a session"),
      query_raw_tokens: rawTokens("how do I configure a session"),
    });
    expect(result.reranked[0]!.candidate.source_path).toBe(
      "docs/api/auth.md",
    );
    const entry = findEntry(result.trace, "anchor_basename_exact");
    expect(entry?.fired).toBe(false);
  });

  it("does not fire when score gap exceeds close-call ratio", () => {
    const top1 = reranked({
      source_path: "docs/api/validators.md",
      score: 100,
      rank: 1,
    });
    const top2 = reranked({
      source_path: "docs/server/procedures.md",
      score: 80,
      rank: 2,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [top1, top2],
      query_tokens: tokenizeForRerank("procedures"),
      query_raw_tokens: rawTokens("procedures"),
    });
    expect(result.reranked[0]!.candidate.source_path).toBe(
      "docs/api/validators.md",
    );
    expect(findEntry(result.trace, "anchor_basename_exact")).toBeUndefined();
  });

  it("does NOT fire when top-1 and top-2 are parent/child (Rule 1 territory)", () => {
    const child = reranked({
      source_path: "docs/guide/mocking/modules.md",
      score: 100,
      rank: 1,
    });
    const parent = reranked({
      source_path: "docs/guide/mocking.md",
      score: 99,
      rank: 2,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [child, parent],
      query_tokens: tokenizeForRerank("modules"),
      query_raw_tokens: rawTokens("modules"),
    });
    // Rule 1 evaluates and decides not to swap (child has unique token); Rule
    // 2 must NOT also evaluate.
    expect(findEntry(result.trace, "parent_canonicality")).toBeDefined();
    expect(findEntry(result.trace, "anchor_basename_exact")).toBeUndefined();
  });

  it("fires on sibling pairs (same parent dir) that are not parent/child", () => {
    // PRD-0022 trpc-anchored-procedures example: same dir, different basename.
    const validators = reranked({
      source_path: "docs/server/validators.md",
      score: 100,
      rank: 1,
    });
    const procedures = reranked({
      source_path: "docs/server/procedures.md",
      score: 99,
      rank: 2,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [validators, procedures],
      query_tokens: tokenizeForRerank("procedures"),
      query_raw_tokens: rawTokens("procedures"),
    });
    expect(result.reranked[0]!.candidate.source_path).toBe(
      "docs/server/procedures.md",
    );
    const entry = findEntry(result.trace, "anchor_basename_exact");
    expect(entry?.fired).toBe(true);
    expect(entry?.decision).toBe("swap");
  });

  it("uses query_anchors when scoring basenames", () => {
    const top1 = reranked({
      source_path: "docs/api/users.md",
      score: 100,
      rank: 1,
    });
    const top2 = reranked({
      source_path: "docs/server/procedures.md",
      score: 99,
      rank: 2,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [top1, top2],
      query_tokens: ["how", "do"],
      query_raw_tokens: ["how", "do"],
      query_anchors: { files: [], symbols: ["procedures"], routes: [] },
    });
    expect(result.reranked[0]!.candidate.source_path).toBe(
      "docs/server/procedures.md",
    );
  });

  // Adversarial: score gap exactly at the close-call ratio
  it("score gap exactly at the close-call ratio (10%) does NOT fire Rule 2", () => {
    const top1 = reranked({
      source_path: "docs/server/validators.md",
      score: 100,
      rank: 1,
    });
    const top2 = reranked({
      source_path: "docs/server/procedures.md",
      score: 90,
      rank: 2,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [top1, top2],
      query_tokens: tokenizeForRerank("procedures"),
      query_raw_tokens: rawTokens("procedures"),
    });
    expect(result.reranked[0]!.candidate.source_path).toBe(
      "docs/server/validators.md",
    );
    expect(findEntry(result.trace, "anchor_basename_exact")).toBeUndefined();
  });

  // Adversarial: emits explain trace
  it("emits explain trace with rule name, candidates, basename scores, decision", () => {
    const top1 = reranked({
      source_path: "docs/guide/learn/snapshots.md",
      score: 100,
      rank: 1,
    });
    const top2 = reranked({
      source_path: "docs/snapshot.md",
      score: 99,
      rank: 2,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [top1, top2],
      query_tokens: tokenizeForRerank("snapshot"),
      query_raw_tokens: rawTokens("snapshot"),
    });
    const entry = findEntry(result.trace, "anchor_basename_exact");
    expect(entry).toBeDefined();
    expect(entry!.candidates).toEqual([
      "docs/guide/learn/snapshots.md",
      "docs/snapshot.md",
    ]);
    expect(entry!.basename_scores).toBeDefined();
    expect(entry!.basename_scores!.length).toBe(2);
    const top1Score = entry!.basename_scores!.find(
      (s) => s.path === "docs/guide/learn/snapshots.md",
    )!;
    const top2Score = entry!.basename_scores!.find(
      (s) => s.path === "docs/snapshot.md",
    )!;
    expect(top1Score.surface_matches).toBe(0);
    expect(top1Score.stemmed_only_matches).toBe(1);
    expect(top1Score.total).toBe(1);
    expect(top2Score.surface_matches).toBe(1);
    expect(top2Score.stemmed_only_matches).toBe(0);
    expect(top2Score.total).toBe(2);
    expect(entry!.decision).toBe("swap");
    expect(entry!.fired).toBe(true);
  });

  it("counts each query token at most once per candidate", () => {
    // duplicate tokens shouldn't double-count
    const top1 = reranked({
      source_path: "docs/server/validators.md",
      score: 100,
      rank: 1,
    });
    const top2 = reranked({
      source_path: "docs/server/procedures.md",
      score: 99,
      rank: 2,
    });
    const result = applyCloseCallTiebreakers({
      reranked: [top1, top2],
      query_tokens: ["procedures", "procedures", "procedures"],
      query_raw_tokens: ["procedures", "procedures", "procedures"],
    });
    const entry = findEntry(result.trace, "anchor_basename_exact");
    expect(entry?.basename_scores?.find((s) => s.path === top2.candidate.source_path)?.surface_matches).toBe(1);
    expect(entry?.basename_scores?.find((s) => s.path === top2.candidate.source_path)?.total).toBe(2);
  });
});

describe("synthetic property: Rule 2 — anchor-basename-exact", () => {
  it("over 200 random sibling-pair sets, candidate with higher (surface×2 + stemmed×1) wins close calls; non-close-calls never fire (lower-95 ≥ 95%)", () => {
    let passed = 0;
    let total = 0;
    // Words chosen so different basenames yield distinct stems (porter
    // applied to "procedures" gives "procedur"; to "procedure" gives
    // "procedur"; etc). The pool mixes singular/plural pairs so the
    // surface-form weighting is exercised.
    const BASENAMES = [
      "procedures",
      "procedure",
      "validators",
      "snapshot",
      "snapshots",
      "history",
      "events",
      "subscriptions",
      "queries",
      "schema",
      "auth",
      "routing",
      "renderer",
      "loader",
    ];
    for (let seed = 0; seed < 200; seed += 1) {
      const r = (i: number) => permute(seed, i) / 0xffffffff;
      // Pick two distinct basenames.
      let a = BASENAMES[Math.floor(r(0) * BASENAMES.length)]!;
      let b = BASENAMES[Math.floor(r(1) * BASENAMES.length)]!;
      while (b === a) {
        b = BASENAMES[Math.floor(r(11) * BASENAMES.length)]!;
      }
      // Different parent dirs to ensure not-family.
      const path_a = `pkg/${(seed * 7 + 11).toString(36)}/${a}.md`;
      const path_b = `pkg/${(seed * 13 + 23).toString(36)}/${b}.md`;

      // Build query: include 0..2 tokens drawn from {a, b, plural-of-a, etc}
      const queryParts: string[] = [];
      if (r(2) < 0.7) queryParts.push(a);
      if (r(3) < 0.4) queryParts.push(b);
      // Plural/singular flips for stemmed match testing
      if (r(4) < 0.3) {
        queryParts.push(a.endsWith("s") ? a.slice(0, -1) : `${a}s`);
      }
      if (queryParts.length === 0) queryParts.push(a);
      const queryString = queryParts.join(" ");
      const queryTokens = tokenizeForRerank(queryString);
      const queryRaw = rawTokens(queryString);

      // Compute property's predicted basename scores.
      const scoreA = computeBasenameScore(a, queryRaw);
      const scoreB = computeBasenameScore(b, queryRaw);

      // Choose close vs far gap.
      const closeCall = r(5) < 0.7;
      const score1 = 100 + Math.floor(r(6) * 50);
      const gapPct = closeCall ? 0.01 + r(7) * 0.08 : 0.15 + r(7) * 0.20;
      const score2 = score1 * (1 - gapPct);

      const top1 = reranked({ source_path: path_a, score: score1, rank: 1 });
      const top2 = reranked({ source_path: path_b, score: score2, rank: 2 });

      const result = applyCloseCallTiebreakers({
        reranked: [top1, top2],
        query_tokens: queryTokens,
        query_raw_tokens: queryRaw,
      });

      let expectedTop = path_a;
      if (closeCall && scoreB > scoreA) expectedTop = path_b;

      total += 1;
      if (result.reranked[0]!.candidate.source_path === expectedTop) {
        passed += 1;
      }
    }
    expect(total).toBe(200);
    expect(wilson95Lower(passed, total)).toBeGreaterThanOrEqual(0.95);
  });
});

function computeBasenameScore(basename: string, rawQueryTokens: string[]): number {
  const lowered = basename.toLowerCase();
  const stem = porter(lowered);
  const seenSurface = new Set<string>();
  const seenStem = new Set<string>();
  let surface = 0;
  let stemmed = 0;
  for (const raw of rawQueryTokens) {
    const lower = raw.toLowerCase();
    if (lower.length < 2) continue;
    if (lower === lowered) {
      if (!seenSurface.has(lower)) {
        seenSurface.add(lower);
        surface += 1;
      }
      continue;
    }
    const tokenStem = porter(lower);
    if (tokenStem === stem) {
      if (!seenStem.has(tokenStem)) {
        seenStem.add(tokenStem);
        stemmed += 1;
      }
    }
  }
  return surface * 2 + stemmed;
}

function permute(seed: number, idx: number): number {
  let x = (seed + idx * 2654435761) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) | 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) | 0;
  return (x ^ (x >>> 16)) >>> 0;
}
