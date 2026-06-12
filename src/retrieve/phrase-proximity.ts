/**
 * Deterministic phrase / proximity feature
 * extractor.
 *
 * Returns structured per-field evidence for a query phrase against a
 * candidate source's path / title / H1 / headings / intro / body. The
 * result is purely diagnostic — a planned pairwise-adjudication stage
 * is the next step that may consume these features for a production
 * decision. Until then, exposing them in eval traces alone gives us
 * inspectable signal for the named top-3 miss and top-1 ordering
 * cohorts without changing live rank.
 *
 * Strength order (most to least specific):
 *   exact   — query tokens appear consecutively, in order
 *   near    — query tokens appear in order, ≤ 2 intervening tokens between
 *             each consecutive pair (NEAR_GAP_MAX)
 *   ordered — query tokens appear in order, ≤ 9 intervening tokens
 *             between each consecutive pair (ORDERED_GAP_MAX)
 *   scattered — every query token appears in the field, any order
 *   none      — at least one query token is missing
 *
 * Single-token queries collapse to exact / none.
 */
import { tokenize } from "./tokenize.js";

/** Query tokens are tokenized (and stemmed) the same way as the
 *  candidate fields so phrase comparison is on a single normalized
 *  basis. */
export type PhraseProximityFields = {
  path: string;
  title: string;
  h1: string;
  /** All non-H1 headings (each a heading-path string). */
  headings: string[];
  intro: string;
  body: string;
};

export const PHRASE_HITS = ["exact", "near", "ordered", "scattered", "none"] as const;
export type PhraseHit = typeof PHRASE_HITS[number];

export type PhraseProximityField =
  | "path"
  | "title"
  | "h1"
  | "heading"
  | "intro"
  | "body"
  | "none";

export type PhraseProximityEvidence = {
  query_phrase: string;
  query_tokens: string[];
  path: PhraseHit;
  title: PhraseHit;
  h1: PhraseHit;
  heading: PhraseHit;
  intro: PhraseHit;
  body: PhraseHit;
  best_field: PhraseProximityField;
  best_hit: PhraseHit;
};

/** A single intervening token still counts as "near" — covers
 *  "browser preview mode" / "error in handling" patterns. */
const NEAR_GAP_MAX = 3;
/** Up to 9 intervening tokens still counts as "ordered" — covers
 *  multi-sentence ordered windows where filename/topic phrases are
 *  reassembled from separated content. */
const ORDERED_GAP_MAX = 10;

const FIELD_PRECEDENCE: PhraseProximityField[] = [
  "path",
  "title",
  "h1",
  "heading",
  "intro",
  "body",
];

const HIT_RANK: Record<PhraseHit, number> = {
  exact: 4,
  near: 3,
  ordered: 2,
  scattered: 1,
  none: 0,
};

export function extractPhraseProximity(
  query: string,
  fields: PhraseProximityFields,
): PhraseProximityEvidence {
  const queryTokens = tokenizeForPhrase(query);

  const evaluate = (text: string): PhraseHit =>
    queryTokens.length === 0 ? "none" : evaluateFieldHit(queryTokens, tokenizeForPhrase(text));

  const headingHit = bestHeadingHit(queryTokens, fields.headings);

  const perField: Record<PhraseProximityField, PhraseHit> = {
    path: evaluate(fields.path),
    title: evaluate(fields.title),
    h1: evaluate(fields.h1),
    heading: headingHit,
    intro: evaluate(fields.intro),
    body: evaluate(fields.body),
    none: "none",
  };

  let bestField: PhraseProximityField = "none";
  let bestRank = 0;
  for (const field of FIELD_PRECEDENCE) {
    const rank = HIT_RANK[perField[field]];
    if (rank > bestRank) {
      bestRank = rank;
      bestField = field;
    }
  }

  return {
    query_phrase: query.trim(),
    query_tokens: queryTokens,
    path: perField.path,
    title: perField.title,
    h1: perField.h1,
    heading: perField.heading,
    intro: perField.intro,
    body: perField.body,
    best_field: bestRank === 0 ? "none" : bestField,
    best_hit: bestRank === 0 ? "none" : perField[bestField],
  };
}

function bestHeadingHit(queryTokens: string[], headings: string[]): PhraseHit {
  if (queryTokens.length === 0 || headings.length === 0) return "none";
  let best: PhraseHit = "none";
  let bestRank = 0;
  for (const heading of headings) {
    const hit = evaluateFieldHit(queryTokens, tokenizeForPhrase(heading));
    if (HIT_RANK[hit] > bestRank) {
      best = hit;
      bestRank = HIT_RANK[hit];
    }
  }
  return best;
}

/**
 * Pre-normalize path/identifier separators so phrase comparison can
 * match hyphenated and underscored compounds the way readers see them
 * (`error-handling.md`, `browser_mode`, `docs/error-handling.md`).
 *
 * The shared retrieval tokenizer keeps `-` and `/` joined inside a
 * single token, so `error-handling.md` becomes `errorhandl` rather than
 * the two-token phrase a phrase scorer needs. Replacing those
 * separators with spaces before tokenizing produces the natural
 * adjacent-token sequence.
 */
function tokenizeForPhrase(text: string): string[] {
  if (!text) return [];
  return tokenize(text.replace(/[\-_/\\]+/g, " "));
}

function evaluateFieldHit(queryTokens: string[], fieldTokens: string[]): PhraseHit {
  if (queryTokens.length === 0 || fieldTokens.length === 0) return "none";

  // Map each field token position to a list of indices.
  const positions = new Map<string, number[]>();
  for (let i = 0; i < fieldTokens.length; i += 1) {
    const t = fieldTokens[i]!;
    const list = positions.get(t);
    if (list) list.push(i);
    else positions.set(t, [i]);
  }

  // Quick rejection: at least one token missing → none.
  for (const t of queryTokens) {
    if (!positions.has(t)) return "none";
  }

  // Single-token query: present ⇒ exact (always; there is no proximity
  // notion to apply).
  if (queryTokens.length === 1) return "exact";

  const orderedHit = bestOrderedGap(queryTokens, positions);
  if (orderedHit !== null) {
    if (orderedHit === 1) return "exact";
    if (orderedHit <= NEAR_GAP_MAX) return "near";
    if (orderedHit <= ORDERED_GAP_MAX) return "ordered";
  }
  // Tokens present but never in-order within ORDERED_GAP_MAX.
  return "scattered";
}

/**
 * Returns the minimum achievable max-gap across all valid in-order
 * placements of the query tokens, or null if no in-order assignment
 * exists. The DP is needed because the upstream tokenizer occasionally
 * emits the same lowercase token twice (e.g. "Use" → ["us","us"]) when
 * the camelCase split path runs without a real boundary; greedy
 * left-to-right would lock in the first occurrence and miss the
 * actually-adjacent later occurrence.
 */
function bestOrderedGap(
  queryTokens: string[],
  positions: Map<string, number[]>,
): number | null {
  const memo = new Map<string, number>();

  function recur(i: number, prev: number): number {
    if (i === queryTokens.length) return 0;
    const key = `${i}:${prev}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const list = positions.get(queryTokens[i]!);
    if (!list || list.length === 0) {
      memo.set(key, Infinity);
      return Infinity;
    }
    let best = Infinity;
    for (const p of list) {
      if (p <= prev) continue;
      const localGap = prev === -1 ? 0 : p - prev;
      const future = recur(i + 1, p);
      const total = Math.max(localGap, future);
      if (total < best) best = total;
    }
    memo.set(key, best);
    return best;
  }

  const result = recur(0, -1);
  if (!Number.isFinite(result)) return null;
  // For multi-token queries the smallest possible max-gap is 1
  // (consecutive positions). For a single-token query we never call
  // this function (handled above), so a 0 result is theoretical only.
  return result === 0 ? 1 : result;
}
