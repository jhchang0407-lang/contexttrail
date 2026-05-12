/**
 * Shared tokenizer + stemmer for retrieval scoring.
 *
 * Replaces the trivial trailing-`s` stemmer that previously lived inside
 * `score.ts` and the lossy `bm25.ts` query construction. See ADR-0019
 * Phase A1 for the architectural framing.
 *
 * Public surface:
 *   - tokenize(text, opts) → string[] of normalized (lowercased, stop-filtered,
 *     stemmed) tokens. May expand camelCase / snake_case identifiers.
 *   - stemmedTokenSet(text, opts) → Set<string>, deduped result of tokenize.
 *   - porter(word) → string, the Porter stemmer for a single lowercased word.
 */
import { stemmer } from "stemmer";

export type TokenizeOptions = {
  /** When true (default), camelCase and snake_case identifiers are split into
   *  parts and the whole identifier is also kept. */
  splitCodeIdentifiers?: boolean;
  /** Override default stop word list. Pass an empty Set to keep every token. */
  stopWords?: Set<string>;
  /** When true (default), apply Porter stemming. */
  stem?: boolean;
};

/** Default English stop word list. Larger than the original 19-word set in
 *  score.ts. Question words ("what", "why", "how", "when", "where", "which",
 *  "who") are intentionally KEPT — they are signal for decision-rationale and
 *  recovery-mode queries. */
export const DEFAULT_STOP_WORDS = new Set<string>([
  "a", "an", "the",
  "and", "or", "but", "nor", "so", "yet",
  "of", "to", "in", "on", "at", "by", "for", "with", "about", "as",
  "from", "into", "onto", "upon", "over", "under", "between",
  "is", "be", "are", "was", "were", "been", "being", "am",
  "do", "does", "did", "doing",
  "has", "have", "had", "having",
  "i", "you", "he", "she", "it", "we", "they",
  "my", "your", "his", "her", "its", "our", "their",
  "this", "that", "these", "those",
  "if", "then", "else", "than",
  "not", "no",
  "can", "could", "should", "would", "may", "might", "will", "shall", "must",
]);

export function porter(word: string): string {
  // Iterate to idempotence. The Porter algorithm applies suffix transformations
  // that occasionally leave the result still stemmable on the next pass — for
  // example `stemmer("deployment") = "deploy"` and `stemmer("deploy") = "deploi"`.
  // A single pass leaves "deployment" and "deploying" with different stems even
  // though they share a root. Iterating to a fixed point collapses these.
  let prev = word.toLowerCase();
  let cur = stemmer(prev);
  let guard = 0;
  while (cur !== prev && guard < 8) {
    prev = cur;
    cur = stemmer(prev);
    guard += 1;
  }
  return cur;
}

/**
 * Expand a single raw token to its parts when it looks like a code identifier:
 *   normalizeTicket   → [normalize, ticket, normalizeticket]
 *   setup_sync        → [setup, sync, setup_sync]
 *   MACHINE_BLOCK     → [machine, block, machine_block]
 *   RefundService     → [refund, service, refundservice]
 * Single-word lowercase tokens are returned unchanged.
 *
 * Returned tokens are lowercased; the underscore is preserved on the whole-form
 * variant so exact symbol-name matches still hit.
 */
function expandCodeIdentifier(raw: string): string[] {
  const hasUnderscore = raw.includes("_");
  const hasInternalCase = /[a-z][A-Z]|[A-Z][a-z]/.test(raw);
  if (!hasUnderscore && !hasInternalCase) {
    return [raw.toLowerCase()];
  }
  // Split on underscore first, then on case transitions.
  const partial: string[] = [];
  for (const piece of raw.split("_")) {
    if (!piece) continue;
    // Insert split point at lowercase→uppercase and acronym→Word boundaries.
    const camelSplit = piece
      .replace(/([a-z0-9])([A-Z])/g, "$1$2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1$2")
      .split("");
    for (const part of camelSplit) {
      if (part) partial.push(part.toLowerCase());
    }
  }
  // Also keep the whole identifier as a single token so exact-match queries bind.
  const whole = raw.toLowerCase();
  return [...partial, whole];
}

export function tokenize(text: string, opts: TokenizeOptions = {}): string[] {
  const stopWords = opts.stopWords ?? DEFAULT_STOP_WORDS;
  const stem = opts.stem ?? true;
  const splitIds = opts.splitCodeIdentifiers ?? true;
  // Split on whitespace and on punctuation that is not part of identifier-like
  // characters (we keep underscores and case so expandCodeIdentifier can see them).
  const initial = text.split(/[\s.,;:!?()\[\]{}<>"'`/\\@#$%&*+=|~]+/).filter((t) => t.length > 0);
  const expanded: string[] = [];
  for (const raw of initial) {
    const candidates = splitIds ? expandCodeIdentifier(raw) : [raw.toLowerCase()];
    for (const c of candidates) {
      // Drop pure-symbol residue and length-1 tokens.
      if (c.length < 2) continue;
      // After the camelCase / underscore expansion, fall back to the legacy
      // alphanumeric filter so trailing punctuation can't sneak through.
      const cleaned = c.replace(/[^a-z0-9_]/g, "");
      if (!cleaned || cleaned.length < 2) continue;
      if (stopWords.has(cleaned)) continue;
      expanded.push(cleaned);
    }
  }
  return stem ? expanded.map(porter) : expanded;
}

export function stemmedTokenSet(text: string, opts: TokenizeOptions = {}): Set<string> {
  return new Set(tokenize(text, { ...opts, stem: true }));
}
