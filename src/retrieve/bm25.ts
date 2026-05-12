import type { Db } from "../store/db.js";
import { tokenize } from "./tokenize.js";

export type FieldWeights = {
  title: number;
  heading_path: number;
  body: number;
};

const DEFAULT_FIELD_WEIGHTS: FieldWeights = {
  title: 2.5,
  heading_path: 1.5,
  body: 1.0,
};

/**
 * Tokenize and dedupe a free-text query for FTS5 MATCH expressions.
 *
 * Both sides of FTS5 are pre-tokenized through `src/retrieve/tokenize.ts`
 * so the stored fields contain Porter-stemmed tokens with code-identifier
 * expansions. The query goes through the same tokenizer.
 */
function queryTokens(query: string): string[] {
  const raw = tokenize(query, { stem: true, splitCodeIdentifiers: true })
    .filter((t) => /^[a-z0-9_]+$/.test(t))
    .filter((t) => t.length > 1);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const t of raw) {
    if (seen.has(t)) continue;
    seen.add(t);
    unique.push(t);
  }
  return unique;
}

/** AND-joined FTS5 query: every token must appear. Highest precision. */
function andExpr(tokens: string[]): string {
  return tokens.map((t) => `"${t}"`).join(" AND ");
}

/** OR-joined FTS5 query: any token may appear. Highest recall. */
function orExpr(tokens: string[]): string {
  return tokens.map((t) => `"${t}"`).join(" OR ");
}

/**
 * Run BM25F over the doc_chunks_fts virtual table with per-field weights and
 * return per-version_id scores normalized to [0, 1] by max(raw). FTS5's
 * bm25() takes per-column weights matching the virtual-table column order
 * (title, heading_path, body).
 */
/** AND-with-OR-fallback: prefer high-precision AND matches; fall back to
 *  recall-focused OR when AND yields 0 docs. Single-token queries don't
 *  need the fallback path; AND and OR are equivalent there. */
function bm25Query(
  db: Db,
  matchExpr: string,
  weights: FieldWeights,
  table: "doc_chunks" | "cards",
): { id: string; raw: number }[] {
  if (!matchExpr) return [];
  if (table === "doc_chunks") {
    return db
      .prepare(
        `SELECT dc.version_id AS id,
                -bm25(doc_chunks_fts, ?, ?, ?) AS raw
         FROM doc_chunks_fts
         JOIN doc_chunks dc ON dc.rowid = doc_chunks_fts.rowid
         WHERE doc_chunks_fts MATCH ?
           AND dc.status='current'`,
      )
      .all(weights.title, weights.heading_path, weights.body, matchExpr) as {
        id: string; raw: number;
      }[];
  }
  return db
    .prepare(
      `SELECT c.id AS id,
              -bm25(cards_fts, ?, ?) AS raw
       FROM cards_fts
       JOIN cards c ON c.rowid = cards_fts.rowid
       WHERE cards_fts MATCH ?
         AND c.authority != 'deprecated'`,
    )
    .all(weights.title, weights.body, matchExpr) as { id: string; raw: number }[];
}

/** Multiplier applied to BM25 raw scores for docs that match every query
 *  token (the AND set). Preserves OR-driven recall while rewarding precision. */
const AND_MATCH_BOOST = 1.5;

/** Multiplier for docs containing the "primary phrase" — the last 2 content
 *  tokens of the query, treated as adjacent. The trailing noun phrase tends
 *  to be the actual subject ("...shadow database", "...many-to-many
 *  relations"). Phrase-bigram OR-join across all bigrams (D1 first attempt)
 *  matched too many wrong docs; targeting only the last bigram is much more
 *  selective. ADR-0019 Phase D1 retry. */
const PRIMARY_PHRASE_BOOST = 1.3;

/** Multiplier applied when ALL query tokens appear in the chunk's TITLE
 *  field (not just any field). Lifts canonical concept docs whose title
 *  is a perfect match over body-heavy reference docs that have the same
 *  terms scattered. THO-107 / W7-IDEA1. */
const TITLE_EXACT_MATCH_BOOST = 1.6;

/** Run an FTS5 query restricted to the title field to find chunks whose
 *  title contains every token. Returns the set of matching version_ids. */
function titleExactMatchIds(
  db: Db,
  tokens: string[],
): Set<string> {
  if (tokens.length === 0) return new Set();
  // FTS5 column-restricted phrase: `title:"token"` matches chunks whose
  // title field contains the token. AND-join all tokens so every one
  // must appear in the title.
  const expr = tokens.map((t) => `title:"${t}"`).join(" AND ");
  try {
    const rows = db
      .prepare(
        `SELECT dc.version_id AS id
         FROM doc_chunks_fts
         JOIN doc_chunks dc ON dc.rowid = doc_chunks_fts.rowid
         WHERE doc_chunks_fts MATCH ?
           AND dc.status='current'`,
      )
      .all(expr) as { id: string }[];
    return new Set(rows.map((r) => r.id));
  } catch {
    return new Set();
  }
}

export function bm25Norm(
  db: Db,
  query: string,
  weights: FieldWeights = DEFAULT_FIELD_WEIGHTS,
): Map<string, number> {
  const tokens = queryTokens(query);
  const out = new Map<string, number>();
  if (tokens.length === 0) return out;

  // OR-joined query gives the recall-driven candidate set. Every doc with
  // at least one query token is a candidate; BM25F over the fielded index
  // already rewards docs with more matches.
  const orRows = bm25Query(db, orExpr(tokens), weights, "doc_chunks");
  if (orRows.length === 0) return out;

  // For multi-token queries, add an AND-match boost: docs that contain
  // every query token (AND set) get their raw score multiplied by
  // AND_MATCH_BOOST. This preserves OR's recall while rewarding the
  // precision of an all-terms-present hit. Single-token queries skip the
  // boost step (AND ≡ OR there).
  let andIds: Set<string> | undefined;
  if (tokens.length > 1) {
    const andRows = bm25Query(db, andExpr(tokens), weights, "doc_chunks");
    andIds = new Set(andRows.map((r) => r.id));
  }

  // Title-exact-match boost (THO-107): chunks whose title contains every
  // token win against body-heavy distractors at equal scope/anchor signal.
  const titleExactIds = tokens.length > 0
    ? titleExactMatchIds(db, tokens)
    : new Set<string>();

  // Primary-phrase boost (THO-104): the LAST 2 content tokens of the
  // query, treated as a phrase. Trailing noun phrase tends to be the query
  // subject. Highly selective — only fires for chunks that contain those
  // two stems adjacent.
  let primaryPhraseIds: Set<string> | undefined;
  if (tokens.length >= 2) {
    const last2 = tokens.slice(-2);
    const phraseExpr = `"${last2.join(" ")}"`;
    try {
      const rows = bm25Query(db, phraseExpr, weights, "doc_chunks");
      primaryPhraseIds = new Set(rows.map((r) => r.id));
    } catch {
      // FTS5 syntax error — silently skip
    }
  }

  let maxRaw = 0;
  const adjusted: { id: string; raw: number }[] = orRows.map((r) => {
    let raw = r.raw;
    if (andIds?.has(r.id)) raw *= AND_MATCH_BOOST;
    if (titleExactIds.has(r.id)) raw *= TITLE_EXACT_MATCH_BOOST;
    if (primaryPhraseIds?.has(r.id)) raw *= PRIMARY_PHRASE_BOOST;
    if (raw > maxRaw) maxRaw = raw;
    return { id: r.id, raw };
  });
  if (maxRaw <= 0) return out;
  for (const r of adjusted) {
    out.set(r.id, r.raw / maxRaw);
  }
  return out;
}

/** Per-card BM25F scores (normalized [0, 1]). cards_fts has only title and
 *  body fields so we use w_title + w_body. */
export function bm25NormCards(
  db: Db,
  query: string,
  weights: FieldWeights = DEFAULT_FIELD_WEIGHTS,
): Map<string, number> {
  const tokens = queryTokens(query);
  const out = new Map<string, number>();
  if (tokens.length === 0) return out;

  const orRows = bm25Query(db, orExpr(tokens), weights, "cards");
  if (orRows.length === 0) return out;

  let andIds: Set<string> | undefined;
  if (tokens.length > 1) {
    const andRows = bm25Query(db, andExpr(tokens), weights, "cards");
    andIds = new Set(andRows.map((r) => r.id));
  }

  let maxRaw = 0;
  const adjusted: { id: string; raw: number }[] = orRows.map((r) => {
    const raw = andIds?.has(r.id) ? r.raw * AND_MATCH_BOOST : r.raw;
    if (raw > maxRaw) maxRaw = raw;
    return { id: r.id, raw };
  });
  if (maxRaw <= 0) return out;
  for (const r of adjusted) {
    out.set(r.id, r.raw / maxRaw);
  }
  return out;
}
