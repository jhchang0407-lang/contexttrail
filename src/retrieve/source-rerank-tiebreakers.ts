/**
 * PRD-0022 (THO-208 / THO-209): close-call tiebreakers for source-rerank.
 *
 * Two surgical rules that fire only when the gap between top-1 and top-2
 * `source_rerank_score` is below SOURCE_RERANK_CLOSE_CALL_RATIO. They
 * operate as a final post-sort pass on the top-N reranked list, before
 * slicing to top-3.
 *
 *   Rule 1 (parent_canonicality): when top-1 and top-2 are parent/child
 *     in the source-family graph and the query lacks child-unique
 *     path tokens, swap the parent above the child.
 *
 *   Rule 2 (anchor_basename_exact): when top-1 and top-2 are NOT
 *     family-related, prefer the candidate whose extensionless basename
 *     surface-form-matches a query token (×2) over stemmed-only (×1).
 *
 * Rule 1 is checked first (ticket THO-209 acceptance: "Rule 2 evaluates
 * AFTER Rule 1 in the post-sort pass"). The two rules' preconditions are
 * mutually exclusive on the family-relatedness axis, so they never both
 * fire on the same pair.
 *
 * Behind the RETRIEVAL_RERANK_TIEBREAKERS env flag (default off in
 * slices 22.1/22.2; flips in 22.3).
 */
import {
  buildSourceFamilyGraph,
} from "./source-family.js";
import { porter, tokenize as tokenizeRetrievalText } from "./tokenize.js";
import type { RerankedSource } from "./source-rerank.js";

export const SOURCE_RERANK_CLOSE_CALL_RATIO = 0.10;

export type CloseCallTiebreakerRule =
  | "parent_canonicality"
  | "anchor_basename_exact";

export type CloseCallTiebreakerEntry = {
  rule: CloseCallTiebreakerRule;
  candidates: [string, string];
  score_gap: number;
  score_gap_ratio: number;
  fired: boolean;
  decision: "swap" | "keep" | "skip";
  reasoning: string;
  child_unique_tokens?: string[];
  query_token_intersection?: string[];
  basename_scores?: BasenameScore[];
};

export type BasenameScore = {
  path: string;
  basename: string;
  surface_matches: number;
  stemmed_only_matches: number;
  total: number;
};

export type CloseCallTiebreakerResult = {
  reranked: RerankedSource[];
  trace: CloseCallTiebreakerEntry[];
};

export type ApplyCloseCallTiebreakersArgs = {
  reranked: RerankedSource[];
  /** Stemmed query tokens (used by Rule 1 path-token comparisons). */
  query_tokens: string[];
  /**
   * Un-stemmed lowercased query tokens. Used by Rule 2 to distinguish
   * surface-form matches (verbatim) from stemmed-only matches. When
   * absent, Rule 2 falls back to `query_tokens` and surface-match rates
   * degrade gracefully.
   */
  query_raw_tokens?: string[];
  query_anchors?: {
    files?: string[];
    symbols?: string[];
    routes?: string[];
  };
};

export function tiebreakersEnabledFromEnv(): boolean {
  const raw = process.env.RETRIEVAL_RERANK_TIEBREAKERS;
  if (raw === undefined) return false;
  return raw.toLowerCase() === "on";
}

export function applyCloseCallTiebreakers(
  args: ApplyCloseCallTiebreakersArgs,
): CloseCallTiebreakerResult {
  const trace: CloseCallTiebreakerEntry[] = [];
  if (args.reranked.length < 2) return { reranked: args.reranked, trace };

  const top1 = args.reranked[0]!;
  const top2 = args.reranked[1]!;
  const score1 = top1.score;
  const score2 = top2.score;

  if (score1 === 0) {
    return { reranked: args.reranked, trace };
  }
  const score_gap = score1 - score2;
  const score_gap_ratio = score_gap / score1;
  if (score_gap_ratio >= SOURCE_RERANK_CLOSE_CALL_RATIO) {
    return { reranked: args.reranked, trace };
  }

  const fam = buildSourceFamilyGraph([
    {
      source_path: top1.candidate.source_path,
      profile: top1.candidate.profile ?? null,
    },
    {
      source_path: top2.candidate.source_path,
      profile: top2.candidate.profile ?? null,
    },
  ]);
  const member1 = fam.members[0]!;
  const member2 = fam.members[1]!;
  const isParentChildPair =
    member1.family_id === member2.family_id &&
    ((member1.relationship === "parent" && member2.relationship === "child") ||
      (member1.relationship === "child" && member2.relationship === "parent"));

  if (isParentChildPair) {
    const result = applyParentCanonicalityRule({
      top1,
      top2,
      member1,
      member2,
      query_tokens: args.query_tokens,
      query_anchors: args.query_anchors,
      score_gap,
      score_gap_ratio,
    });
    trace.push(result.trace_entry);
    if (result.swap) {
      return { reranked: swapTop1Top2(args.reranked), trace };
    }
    return { reranked: args.reranked, trace };
  }

  const ruleResult = applyAnchorBasenameRule({
    top1,
    top2,
    query_tokens: args.query_tokens,
    query_raw_tokens: args.query_raw_tokens,
    query_anchors: args.query_anchors,
    score_gap,
    score_gap_ratio,
  });
  trace.push(ruleResult.trace_entry);
  if (ruleResult.swap) {
    return { reranked: swapTop1Top2(args.reranked), trace };
  }
  return { reranked: args.reranked, trace };
}

type ParentCanonicalityArgs = {
  top1: RerankedSource;
  top2: RerankedSource;
  member1: { relationship: string; source_path: string };
  member2: { relationship: string; source_path: string };
  query_tokens: string[];
  query_anchors?: ApplyCloseCallTiebreakersArgs["query_anchors"];
  score_gap: number;
  score_gap_ratio: number;
};

function applyParentCanonicalityRule(args: ParentCanonicalityArgs): {
  swap: boolean;
  trace_entry: CloseCallTiebreakerEntry;
} {
  const parentSource =
    args.member1.relationship === "parent" ? args.top1 : args.top2;
  const childSource =
    args.member1.relationship === "child" ? args.top1 : args.top2;
  const parentTokens = new Set(
    tokenizeRetrievalText(parentSource.candidate.source_path),
  );
  const childTokens = new Set(
    tokenizeRetrievalText(childSource.candidate.source_path),
  );
  const childUnique = [...childTokens].filter((t) => !parentTokens.has(t));
  const queryTokenSet = new Set([
    ...args.query_tokens,
    ...collectAnchorTokens(args.query_anchors),
  ]);
  const intersection = childUnique.filter((t) => queryTokenSet.has(t));
  const childMatchesUnique = intersection.length > 0;
  const childIsAtTop1 = args.top1 === childSource;
  const fired = childIsAtTop1 && !childMatchesUnique;

  let reasoning: string;
  if (!childIsAtTop1) {
    reasoning = "parent already top-1; no swap needed";
  } else if (childMatchesUnique) {
    reasoning = `child top-1 carries child-unique tokens ${formatTokens(
      intersection,
    )} — keep child`;
  } else {
    reasoning = `child top-1; query lacks child-unique tokens ${formatTokens(
      childUnique,
    )} — promote parent`;
  }

  return {
    swap: fired,
    trace_entry: {
      rule: "parent_canonicality",
      candidates: [args.top1.candidate.source_path, args.top2.candidate.source_path],
      score_gap: args.score_gap,
      score_gap_ratio: args.score_gap_ratio,
      fired,
      decision: fired ? "swap" : "keep",
      reasoning,
      child_unique_tokens: childUnique,
      query_token_intersection: intersection,
    },
  };
}

type AnchorBasenameArgs = {
  top1: RerankedSource;
  top2: RerankedSource;
  query_tokens: string[];
  query_raw_tokens?: string[];
  query_anchors?: ApplyCloseCallTiebreakersArgs["query_anchors"];
  score_gap: number;
  score_gap_ratio: number;
};

function applyAnchorBasenameRule(args: AnchorBasenameArgs): {
  swap: boolean;
  trace_entry: CloseCallTiebreakerEntry;
} {
  const rawTokens = collectQueryRawTokens(
    args.query_raw_tokens ?? args.query_tokens,
    args.query_anchors,
  );
  const score1 = scoreBasename(args.top1.candidate.source_path, rawTokens);
  const score2 = scoreBasename(args.top2.candidate.source_path, rawTokens);

  let fired = false;
  let decision: "swap" | "keep" = "keep";
  let reasoning: string;
  if (score2.total > score1.total) {
    fired = true;
    decision = "swap";
    reasoning = `top-2 basename '${score2.basename}' (score ${score2.total}: surface=${score2.surface_matches}, stem=${score2.stemmed_only_matches}) outscores top-1 basename '${score1.basename}' (score ${score1.total}) — promote top-2`;
  } else if (score1.total > score2.total) {
    reasoning = `top-1 basename '${score1.basename}' already outscores top-2 — keep`;
  } else {
    reasoning = `basename scores tied at ${score1.total} — stable path tie-break (keep top-1)`;
  }

  return {
    swap: fired,
    trace_entry: {
      rule: "anchor_basename_exact",
      candidates: [args.top1.candidate.source_path, args.top2.candidate.source_path],
      score_gap: args.score_gap,
      score_gap_ratio: args.score_gap_ratio,
      fired,
      decision,
      reasoning,
      basename_scores: [score1, score2],
    },
  };
}

function scoreBasename(source_path: string, rawTokens: string[]): BasenameScore {
  const basename = extensionlessBasename(source_path);
  const basenameLower = basename.toLowerCase();
  const basenameStem = porter(basenameLower);
  const seenSurface = new Set<string>();
  const seenStem = new Set<string>();
  let surface = 0;
  let stemmed = 0;
  for (const raw of rawTokens) {
    const lower = raw.toLowerCase();
    if (lower.length < 2) continue;
    if (lower === basenameLower) {
      if (!seenSurface.has(lower)) {
        seenSurface.add(lower);
        surface += 1;
      }
      continue;
    }
    const stem = porter(lower);
    if (stem === basenameStem) {
      if (!seenStem.has(stem)) {
        seenStem.add(stem);
        stemmed += 1;
      }
    }
  }
  return {
    path: source_path,
    basename,
    surface_matches: surface,
    stemmed_only_matches: stemmed,
    total: surface * 2 + stemmed,
  };
}

function extensionlessBasename(source_path: string): string {
  const leaf = source_path.split(/[\\/]/).pop() ?? source_path;
  return leaf.replace(/\.[^.]+$/, "");
}

function collectQueryRawTokens(
  baseTokens: string[],
  anchors: ApplyCloseCallTiebreakersArgs["query_anchors"] | undefined,
): string[] {
  const out: string[] = [...baseTokens];
  if (anchors) {
    for (const f of anchors.files ?? []) out.push(...splitRaw(f));
    for (const s of anchors.symbols ?? []) out.push(...splitRaw(s));
    for (const r of anchors.routes ?? []) out.push(...splitRaw(r));
  }
  return out;
}

function splitRaw(text: string): string[] {
  return text
    .split(/[\s.,;:!?()\[\]{}<>"'`/\\@#$%&*+=|~]+/)
    .filter((t) => t.length > 0)
    .map((t) => t.toLowerCase());
}

function collectAnchorTokens(
  anchors?: ApplyCloseCallTiebreakersArgs["query_anchors"],
): string[] {
  if (!anchors) return [];
  const out: string[] = [];
  for (const f of anchors.files ?? []) out.push(...tokenizeRetrievalText(f));
  for (const s of anchors.symbols ?? []) out.push(...tokenizeRetrievalText(s));
  for (const r of anchors.routes ?? []) out.push(...tokenizeRetrievalText(r));
  return out;
}

function swapTop1Top2(reranked: RerankedSource[]): RerankedSource[] {
  if (reranked.length < 2) return reranked;
  const top1 = reranked[0]!;
  const top2 = reranked[1]!;
  return [
    { ...top2, rank: 1 },
    { ...top1, rank: 2 },
    ...reranked.slice(2),
  ];
}

function formatTokens(tokens: string[]): string {
  if (tokens.length === 0) return "{}";
  return `{${tokens.join(", ")}}`;
}
