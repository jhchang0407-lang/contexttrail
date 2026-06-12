import type { ChunkScopeLayer, DocChunk, CodeAnchor } from "../types/chunk.js";
import type { Card } from "../types/card.js";
import type { QueryMode } from "./query-scope.js";
import { scopeMatchScore, type QueryScope } from "./scope-match.js";
import { stemmedTokenSet } from "./tokenize.js";

// ---------------------------------------------------------------------------
// Query-input types
// ---------------------------------------------------------------------------

export type QueryAnchors = {
  files?: string[];
  symbols?: string[];
  routes?: string[];
};

// ---------------------------------------------------------------------------
// Specificity: per-layer multiplier on final_score so module-scope
// matches outweigh project-scope matches at equal text relevance.
// ---------------------------------------------------------------------------

export type SpecificityTable = Record<ChunkScopeLayer, number>;

export function specificityWeight(
  layer: ChunkScopeLayer,
  table: SpecificityTable,
): number {
  return table[layer] ?? table.unknown ?? 1.0;
}

// ---------------------------------------------------------------------------
// Heading match: Jaccard of stemmed task tokens vs. joined heading_path.
// Cheap structural rescue when BM25 vocabulary diverges from heading
// vocabulary.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on",
  "for", "is", "be", "are", "was", "with", "by", "as", "at",
]);

function stem(word: string): string {
  // Trivial v1 stemmer: lowercase + strip trailing 's'.
  const w = word.toLowerCase();
  if (w.length > 3 && w.endsWith("s")) return w.slice(0, -1);
  return w;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

function tokenSet(text: string): Set<string> {
  return new Set(tokenize(text).map(stem));
}

export function headingMatchScore(
  query: string,
  heading_path: string[],
): number {
  const qTokens = tokenSet(query);
  const hTokens = tokenSet(heading_path.join(" "));
  if (qTokens.size === 0 || hTokens.size === 0) return 0;
  let inter = 0;
  for (const t of qTokens) if (hTokens.has(t)) inter++;
  const union = new Set([...qTokens, ...hTokens]).size;
  return union === 0 ? 0 : inter / union;
}

// ---------------------------------------------------------------------------
// Mention overlap: matched_query_anchors / query_anchors.
// Missing query anchors → 0 (neutral, not a free boost).
//
// File anchors use path-similarity matching rather
// than strict equality. Agents passing `src/payments/refund.ts` should still
// bind to chunks anchored as `payments/refund.ts` or `refund.ts` —
// previously the binary equality dropped them entirely. Symbol and route
// anchors keep strict equality.
// ---------------------------------------------------------------------------

/** Normalize a file path for similarity comparison: lowercase, strip leading
 *  src/ or tests/ or docs/ prefixes, normalize separators. The result is
 *  used for suffix-match — a query path matches a chunk path when one is a
 *  suffix of the other under normalization. */
function normalizeFilePath(p: string): string {
  let n = p.toLowerCase().replace(/\\/g, "/");
  // Strip common leading segments that agents may or may not include.
  n = n.replace(/^\.\//, "");
  for (const prefix of ["src/", "lib/", "tests/", "test/", "spec/", "specs/", "docs/", "doc/"]) {
    if (n.startsWith(prefix)) n = n.slice(prefix.length);
  }
  return n;
}

/** True if `a` and `b` are similar enough to count as a file-anchor match.
 *  Either side may be a suffix of the other after normalization. We require
 *  that BOTH sides have at least one path separator so common bare
 *  filenames like `schema.prisma` don't collapse against every chunk that
 *  mentions them in body code blocks. Bare-basename matching gave us a
 *  -10pp Prisma top-1 regression because the Prisma docs reference
 *  `schema.prisma` in nearly every doc.
 */
function fileAnchorSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  const na = normalizeFilePath(a);
  const nb = normalizeFilePath(b);
  if (na === nb) return true;
  // Require at least one path separator on at least one side so
  // single-token filenames don't match every code-block mention.
  if (!na.includes("/") && !nb.includes("/")) return false;
  if (na.endsWith("/" + nb) || nb.endsWith("/" + na)) return true;
  return false;
}

export function mentionOverlapScore(
  query: QueryAnchors,
  chunkAnchors: CodeAnchor[],
): number {
  const queryItems: { kind: CodeAnchor["kind"]; value: string }[] = [];
  for (const f of query.files ?? []) queryItems.push({ kind: "file", value: f });
  for (const s of query.symbols ?? []) queryItems.push({ kind: "symbol", value: s });
  for (const r of query.routes ?? []) queryItems.push({ kind: "route", value: r });

  if (queryItems.length === 0) return 0;
  const fileAnchors = chunkAnchors.filter((a) => a.kind === "file").map((a) => a.value);
  const exactSet = new Set(chunkAnchors.map((a) => `${a.kind}::${a.value}`));
  let matched = 0;
  for (const q of queryItems) {
    if (exactSet.has(`${q.kind}::${q.value}`)) {
      matched += 1;
      continue;
    }
    // File anchors get the path-similarity fallback; symbol/route stay strict.
    if (q.kind === "file" && fileAnchors.some((fa) => fileAnchorSimilar(q.value, fa))) {
      matched += 1;
    }
  }
  return matched / queryItems.length;
}

// ---------------------------------------------------------------------------
// Hybrid scoring formula: additive text + multiplicative structure.
// ---------------------------------------------------------------------------

export type ScoringWeights = {
  w_bm25: number;
  w_heading: number;
  w_scope: number;
  w_mentions: number;
  /** Multiplier applied to non-locked Cards in the global ranker. */
  card_type_bias: number;
  specificity_weight: SpecificityTable;
};

export type ScoreTrace = {
  version_id: string;
  bm25_norm: number;
  heading_match: number;
  scope_match: number;
  mention_overlap: number;
  specificity: number;
  text_score: number;
  final_score: number;
  token_count: number;
  packing_score: number;
  structural_multiplier?: number;
  doc_role?: DocChunk["doc_role"];
  role_source?: DocChunk["role_source"];
  role_multiplier?: number;
};

const ANCHORED_LEXICAL_ONLY_MULTIPLIER = 0.10;
const ANCHORED_MENTION_ONLY_MULTIPLIER = 0.15;

export type ScoreInputs = {
  chunk: DocChunk;
  anchors: CodeAnchor[];
  bm25_norm: number;
  query: string;
  query_scopes: QueryScope[];
  query_anchors: QueryAnchors;
  query_mode?: QueryMode;
  weights: ScoringWeights;
};

/** Source-path basename + parent-directory overlap boost.
 *  Filename and parent directory names are strong canonical signals — a query
 *  for "many-to-many relation" landing on `relations/many-to-many-relations.md`
 *  is almost certainly the canonical answer. We sum overlap across the leaf
 *  filename AND the last 2 parent directories so paths like `data-model/
 *  relations/many-to-many-relations.md` get credit for both "relations" (parent)
 *  and "many-to-many-relations" (filename) matching the query. */
function basenameOverlapBoost(query: string, sourcePath: string): number {
  const segments = sourcePath
    .split(/[\\/]/)
    .filter((s) => s && s !== "." && s !== "..")
    .map((s) => s.replace(/\.[^.]+$/, ""));
  if (segments.length === 0) return 1;
  const qTokens = stemmedTokenSet(query);
  if (qTokens.size === 0) return 1;
  // Look at the last 3 segments (filename + up to 2 parent dirs). Earlier
  // segments are typically generic (docs/, src/, etc.) and don't carry the
  // canonical signal.
  const considered = segments.slice(-3);
  const tokens = new Set<string>();
  for (const seg of considered) {
    for (const t of stemmedTokenSet(seg.replace(/[-_]/g, " "))) tokens.add(t);
  }
  if (tokens.size === 0) return 1;
  let overlap = 0;
  for (const t of tokens) if (qTokens.has(t)) overlap += 1;
  if (overlap >= 3) return 1.7;
  if (overlap >= 2) return 1.4;
  if (overlap >= 1) return 1.1;
  return 1;
}

/** Heading-coverage boost. When a chunk's heading_path
 *  contains 2+ Porter-stemmed query tokens, apply a multiplicative boost.
 *  This is a structural signal distinct from BM25F's heading_path field
 *  weight: a heading like "Shadow database" matching query stems "shadow"
 *  + "databas" indicates the section topic IS the query subject, not a
 *  tangential mention. Single-token heading coverage doesn't fire (too
 *  noisy — common stems would over-boost). */
function headingCoverageBoost(query: string, headingPath: string[]): number {
  const qTokens = stemmedTokenSet(query);
  const hTokens = stemmedTokenSet(headingPath.join(" "));
  if (qTokens.size === 0 || hTokens.size === 0) return 1;
  let intersection = 0;
  for (const t of qTokens) if (hTokens.has(t)) intersection += 1;
  if (intersection >= 3) return 1.2;
  return 1;
}

/** Section position decay. Down-weight chunks late in
 *  their parent doc since canonical content tends to live earlier. Keep the
 *  decay gentle — many real-corpus canonical sections (Prisma's relation
 *  docs, for example) live many chunks into a long doc. */
function positionDecay(chunkIndex: number, chunkCount: number): number {
  if (chunkCount <= 1) return 1;
  // Linear decay: first chunk = 1.0, last chunk = 0.85. Gentler than the
  // 0.7 originally suggested in the audit, which caused regressions.
  const ratio = (chunkIndex - 1) / Math.max(1, chunkCount - 1);
  return 1.0 - 0.15 * ratio;
}

export function scoreChunk(args: ScoreInputs): ScoreTrace {
  const { chunk, anchors, bm25_norm, query, query_scopes, query_anchors, weights } = args;
  const heading_match = headingMatchScore(query, chunk.heading_path);
  const scope_match = scopeMatchScore(query_scopes, chunk.scope);
  const mention_overlap = mentionOverlapScore(query_anchors, anchors);
  const layer = (chunk.scope.layer ?? "unknown") as ChunkScopeLayer;
  const specificity = specificityWeight(layer, weights.specificity_weight);
  const text_score = weights.w_bm25 * bm25_norm + weights.w_heading * heading_match;
  const role_multiplier = docRoleMultiplier(
    chunk.doc_role ?? "canonical",
    args.query_mode ?? "unanchored",
  );
  const structural_multiplier = anchoredStructuralMultiplier(
    args.query_mode,
    scope_match,
    mention_overlap,
  );
  const position_multiplier = positionDecay(chunk.chunk_index, chunk.chunk_count);
  const heading_coverage_multiplier = headingCoverageBoost(query, chunk.heading_path);
  const basename_boost = basenameOverlapBoost(query, chunk.source_path);
  // Long-doc penalty: chunks from docs with many chunks (sprawling
  // reference docs, e.g., prisma-cli-reference.md, prisma-client-reference.md)
  // get a mild multiplicative penalty so concise canonical docs win at equal
  // text similarity. Threshold deliberately high so normal layered docs are
  // unaffected.
  const long_doc_penalty = chunk.chunk_count > 15 ? 0.85 : 1.0;
  const final_score =
    text_score *
    (1 + weights.w_scope * scope_match) *
    (1 + weights.w_mentions * mention_overlap) *
    specificity *
    role_multiplier *
    structural_multiplier *
    position_multiplier *
    heading_coverage_multiplier *
    basename_boost *
    long_doc_penalty;
  const token_count = chunk.token_count;
  const packing_score =
    token_count > 0 ? final_score / Math.sqrt(token_count) : final_score;
  return {
    version_id: chunk.version_id,
    bm25_norm,
    heading_match,
    scope_match,
    mention_overlap,
    specificity,
    text_score,
    final_score,
    token_count,
    packing_score,
    structural_multiplier,
    doc_role: chunk.doc_role ?? "canonical",
    role_source: chunk.role_source ?? "default",
    role_multiplier,
  };
}

function docRoleMultiplier(
  role: NonNullable<DocChunk["doc_role"]>,
  queryMode: QueryMode,
): number {
  if (role === "archive") return 0.3;
  if (queryMode === "anchored" || queryMode === "signal_empty") {
    if (role === "ideation") return 0.5;
    if (role === "example") return 0.4;
  }
  return 1;
}

export type ScoreCardInputs = {
  card: Card;
  bm25_norm: number;
  query: string;
  query_scopes: QueryScope[];
  query_anchors: QueryAnchors;
  query_mode?: QueryMode;
  weights: ScoringWeights;
};

/**
 * Score a non-locked Card under the global ranker.
 *
 * Uses the same hybrid formula as Doc Chunks but multiplies `final_score` by
 * `card_type_bias` (default 1.2) so authored Cards win ties against ambient
 * prose at equal relevance. Locked Cards bypass this path entirely; the bias
 * never applies to them.
 */
export function scoreCard(args: ScoreCardInputs): ScoreTrace {
  const { card, bm25_norm, query, query_scopes, query_anchors, weights } = args;
  const heading_match = headingMatchScore(query, [card.title]);
  const scope_match = scopeMatchScore(query_scopes, card.scope);
  // Build a synthetic CodeAnchor[] from the card's anchors so the same
  // mention-overlap signal computes against query_anchors.
  const synthAnchors: CodeAnchor[] = [
    ...card.symbol_anchors.map((s) => ({
      chunk_version_id: card.id,
      kind: "symbol" as const,
      value: s,
      confidence: "high" as const,
      source: "frontmatter" as const,
    })),
    ...card.file_anchors.map((f) => ({
      chunk_version_id: card.id,
      kind: "file" as const,
      value: f,
      confidence: "high" as const,
      source: "frontmatter" as const,
    })),
    ...card.route_anchors.map((r) => ({
      chunk_version_id: card.id,
      kind: "route" as const,
      value: r,
      confidence: "high" as const,
      source: "frontmatter" as const,
    })),
  ];
  const mention_overlap = mentionOverlapScore(query_anchors, synthAnchors);
  const layer = (card.scope.layer ?? "unknown") as ChunkScopeLayer;
  const specificity = specificityWeight(layer, weights.specificity_weight);
  const text_score =
    weights.w_bm25 * bm25_norm + weights.w_heading * heading_match;
  const raw_final =
    text_score *
    (1 + weights.w_scope * scope_match) *
    (1 + weights.w_mentions * mention_overlap) *
    specificity;
  const structural_multiplier = anchoredStructuralMultiplier(
    args.query_mode,
    scope_match,
    mention_overlap,
  );
  const structurally_adjusted_final = raw_final * structural_multiplier;
  const final_score = structurally_adjusted_final * weights.card_type_bias;
  // Approximate token count for cards via title + body length (matching the
  // chunker's tokens.count would be exact but is computed at load time).
  const token_count = Math.max(1, Math.ceil((card.body.length + card.title.length) / 4));
  const packing_score = final_score / Math.sqrt(token_count);
  return {
    version_id: card.id,
    bm25_norm,
    heading_match,
    scope_match,
    mention_overlap,
    specificity,
    text_score,
    final_score,
    token_count,
    packing_score,
    structural_multiplier,
  };
}

function anchoredStructuralMultiplier(
  queryMode: QueryMode | undefined,
  scopeMatch: number,
  mentionOverlap: number,
): number {
  if (queryMode !== "anchored") return 1;
  if (scopeMatch > 0) return 1;
  if (mentionOverlap > 0) return ANCHORED_MENTION_ONLY_MULTIPLIER;
  return ANCHORED_LEXICAL_ONLY_MULTIPLIER;
}
