import type {
  CodeAnchorKind,
  CodeAnchorConfidence,
} from "../types/chunk.js";

export type ExtractedMention = {
  kind: CodeAnchorKind;
  value: string;
  confidence: CodeAnchorConfidence;
  source: "explicit_path" | "exact_symbol" | "bare_identifier" | "code_span";
};

const CONF_RANK: Record<CodeAnchorConfidence, number> = {
  ambiguous: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/** Find every backticked code-span body (no nested backticks) and the rest as prose. */
function partition(body: string): { backticked: string[]; prose: string } {
  const backticked: string[] = [];
  // Replace each `…` with a placeholder so prose-side regexes don't double-match.
  const prose = body.replace(/`([^`\n]+)`/g, (_, inner: string) => {
    backticked.push(inner.trim());
    return " ".repeat(inner.length + 2);
  });
  return { backticked, prose };
}

// ---------------------------------------------------------------------------
// Entity-shaped business identifiers ("id" anchors): CLM-2026-0412, INV-1042,
// PO-88231, AB-12345/X, policy numbers, ticket keys, …
//
// Shared between index time (chunk bodies, via extractMentions) and query
// time (task text, via compileQueryScopes). The pattern is deliberately
// CONSERVATIVE: an id anchor only ever binds through exact, case-folded
// equality on both sides, so the rules below are tuned to reject
// date/version/number noise rather than to maximize recall.
//
// Rules (each has a matching unit test):
//   1. Candidate runs use charset [A-Za-z0-9#/\._-]. Runs containing `.`,
//      `_`, or `\` anywhere inside are rejected wholesale: dots mean
//      semver / filenames / domains (1.2.3, report-2026.pdf), underscores
//      mean env vars / code identifiers (STRIPE_API_KEY — already covered by
//      the env_var kind), backslashes mean Windows paths. Leading/trailing
//      dot runs (sentence punctuation, ellipses) are trimmed first so
//      "close out CLM-2026-0412." still matches.
//   2. Token must start and end alphanumeric. A leading separator signals a
//      route/path (/orders/123) or hashtag (#88231), not an identifier.
//   3. Length 5–40 after trimming. "K-1" does NOT match: at <5 chars a
//      letter-digit pair collides with tax-form shorthand (K-1, W-2),
//      aircraft names (B-52), chess notation… it also carries only one
//      digit, so rule 4 would reject it independently.
//   4. At least one letter and at least two digits. Excludes pure dates
//      (2026-06-12, 06/12/2026), phone fragments (555-1234), bare numbers,
//      and acronym-digit pairs like UTF-8 (single digit).
//   5. Internal structure: at least one separator from [-/#], OR — with no
//      separator — a 3+ uppercase-letter prefix at the letter→digit boundary
//      (INV1042, ABC12345). Unseparated prefixes shorter than 3 uppercase
//      letters (PO88231, a1b2c3) are rejected: too easy to collide with hex
//      strings and random tokens. The separated forms (PO-88231) still match.
//   6. Date-shaped exclusions beyond rule 4: month-name segments accompanied
//      only by numeric segments (12-JUN-2026, JUN-2026) and ISO timestamps
//      that keep their `T` (2026-06-12T10).
//   7. Lowercase-word + calendar-year ("mid-2026", "early-2025") is prose,
//      not an identifier. Uppercase forms (FY-2026, Q1-2026 — note Q1 has a
//      digit) survive because real fiscal ids are written uppercase.
//   8. Quantity-prefix compounds — first segment purely numeric, every other
//      segment purely alphabetic ("12-month", "30-day", "12-month-period",
//      "10-Q") — are prose, not identifiers. The reverse, prefix-code order
//      (INV-1042, inv-1042) is what real business ids use, and segments
//      mixing letters and digits (550e8400-e29b…) are untouched.
//
// NOT normalized: separators. CLM-2026-0412, CLM/2026/0412 and CLM20260412
// are treated as distinct identifiers — separator structure is part of the
// identifier; only letter case is presentation (matching case-folds, see
// src/anchor-match.ts).
// ---------------------------------------------------------------------------

const ID_RUN_RE = /[A-Za-z0-9#/\\._-]+/g;
const ID_SHAPE_RE = /^[A-Za-z0-9][A-Za-z0-9#/-]*[A-Za-z0-9]$/;
const ID_UNSEPARATED_RE = /^[A-Z]{3,}[0-9]{2,}[A-Z0-9]*$/;
const ID_SEPARATOR_RE = /[-/#]/;
const ID_ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d/;
const ID_PROSE_YEAR_RE = /^[a-z]+-(?:19|20)\d{2}$/;
const ID_MIN_LENGTH = 5;
const ID_MAX_LENGTH = 40;

const MONTH_NAMES = new Set([
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept",
  "oct", "nov", "dec",
  "january", "february", "march", "april", "june", "july", "august",
  "september", "october", "november", "december",
]);

/** Quantity-prefix compound (12-month, 30-day, 12-month-period) → prose. */
function isQuantityCompound(token: string): boolean {
  const segments = token.split(ID_SEPARATOR_RE);
  if (segments.length < 2) return false;
  if (!/^\d+$/.test(segments[0]!)) return false;
  return segments.slice(1).every((segment) => /^[A-Za-z]+$/.test(segment));
}

/** Month-name + numeric segments only (12-JUN-2026, JUN-2026) → date, not id. */
function isMonthDateShaped(token: string): boolean {
  const segments = token.split(ID_SEPARATOR_RE);
  if (segments.length < 2) return false;
  let sawMonth = false;
  for (const segment of segments) {
    if (/^\d+$/.test(segment)) continue;
    if (MONTH_NAMES.has(segment.toLowerCase())) {
      sawMonth = true;
      continue;
    }
    return false;
  }
  return sawMonth;
}

/**
 * Extract entity-shaped identifier tokens from free text. Order of first
 * appearance; deduped case-insensitively (first spelling wins). Used both by
 * `extractMentions` (doc bodies at chunk-persist time) and by
 * `compileQueryScopes` (task text at query time) so the two sides of the
 * exact-match contract can never drift.
 */
export function extractIdTokens(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const run of text.match(ID_RUN_RE) ?? []) {
    const token = run.replace(/^\.+/, "").replace(/\.+$/, "");
    if (token.length < ID_MIN_LENGTH || token.length > ID_MAX_LENGTH) continue;
    if (!ID_SHAPE_RE.test(token)) continue;
    if (!/[A-Za-z]/.test(token)) continue;
    if ((token.match(/[0-9]/g) ?? []).length < 2) continue;
    if (!ID_SEPARATOR_RE.test(token) && !ID_UNSEPARATED_RE.test(token)) continue;
    if (ID_ISO_TIMESTAMP_RE.test(token)) continue;
    if (ID_PROSE_YEAR_RE.test(token)) continue;
    if (isQuantityCompound(token)) continue;
    if (isMonthDateShaped(token)) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

const FILE_PATH_RE = /\b((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)\b/g;
const TEST_FILE_RE = /\b([A-Za-z0-9_.-]+(?:\.test\.ts|\.spec\.ts|_test\.py))\b/g;
const SYMBOL_CHAIN_RE = /\b([A-Z][A-Za-z0-9]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\b/g;
const SYMBOL_BARE_RE = /^([A-Z][A-Za-z0-9]*)$/;
const ROUTE_COLON_RE = /(\/[A-Za-z0-9_\-]+(?:\/[A-Za-z0-9_\-:]+){0,})/;
const ROUTE_METHOD_RE = /^((?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+\/[^\s]+)$/;
const ENV_VAR_RE = /\b([A-Z][A-Z0-9_]{3,})\b/g;

export function extractMentions(body: string): ExtractedMention[] {
  const { backticked, prose } = partition(body);
  const map = new Map<string, ExtractedMention>();
  const add = (m: ExtractedMention) => {
    const key = `${m.kind}::${m.value}`;
    const prev = map.get(key);
    if (!prev || CONF_RANK[m.confidence] > CONF_RANK[prev.confidence]) {
      map.set(key, m);
    }
  };

  for (const span of backticked) {
    const trimmed = span.trim();

    // Test files first (more specific than symbol/file)
    const testMatch = trimmed.match(TEST_FILE_RE);
    if (testMatch) {
      for (const v of testMatch) {
        add({ kind: "test", value: v, confidence: "high", source: "code_span" });
      }
      continue;
    }

    // Routes: METHOD /path
    if (ROUTE_METHOD_RE.test(trimmed)) {
      add({ kind: "route", value: trimmed, confidence: "high", source: "code_span" });
      continue;
    }
    // Routes: /path with `:` or 2+ segments
    if (
      trimmed.startsWith("/") &&
      (trimmed.includes(":") || trimmed.split("/").filter(Boolean).length >= 2)
    ) {
      const m = trimmed.match(ROUTE_COLON_RE);
      if (m) {
        add({ kind: "route", value: trimmed, confidence: "high", source: "code_span" });
        continue;
      }
    }

    // File path: extension + slash
    const fileMatches = trimmed.match(FILE_PATH_RE);
    if (fileMatches && fileMatches[0] === trimmed) {
      add({ kind: "file", value: trimmed, confidence: "high", source: "explicit_path" });
      continue;
    }

    // Symbol chain
    const chainMatch = trimmed.match(/^([A-Z][A-Za-z0-9]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)$/);
    if (chainMatch) {
      add({
        kind: "symbol",
        value: trimmed,
        confidence: "high",
        source: "exact_symbol",
      });
      continue;
    }

    // Bare PascalCase / camelCase
    if (SYMBOL_BARE_RE.test(trimmed)) {
      if (/^Xxx/.test(trimmed)) continue;
      add({
        kind: "symbol",
        value: trimmed,
        confidence: "medium",
        source: "exact_symbol",
      });
      continue;
    }
  }

  // Prose-side scans (lower confidence; skip bare PascalCase)
  for (const m of prose.matchAll(TEST_FILE_RE)) {
    add({
      kind: "test",
      value: m[1]!,
      confidence: "high",
      source: "code_span",
    });
  }
  for (const m of prose.matchAll(FILE_PATH_RE)) {
    const v = m[1]!;
    // Skip if it was already classified as a test by the line above.
    if (v.endsWith(".test.ts") || v.endsWith(".spec.ts") || v.endsWith("_test.py")) {
      continue;
    }
    add({
      kind: "file",
      value: v,
      confidence: "medium",
      source: "explicit_path",
    });
  }
  for (const m of prose.matchAll(SYMBOL_CHAIN_RE)) {
    add({
      kind: "symbol",
      value: m[1]!,
      confidence: "low",
      source: "bare_identifier",
    });
  }
  for (const m of prose.matchAll(ENV_VAR_RE)) {
    const v = m[1]!;
    if (!v.includes("_")) continue; // require underscore (excludes API, HTTP, JSON, AUTHORIZATION)
    if (v.length < 4) continue;
    add({
      kind: "env_var",
      value: v,
      confidence: "medium",
      source: "bare_identifier",
    });
  }

  // Entity-shaped business identifiers (CLM-2026-0412, INV-1042, …). Scanned
  // over the raw body — backticks around an id don't change its meaning, and
  // the conservative shape rules plus exact-equality matching make prose
  // occurrences as trustworthy as code spans. Medium confidence: extraction
  // is pattern-based, but binding later requires exact (case-folded) equality.
  for (const value of extractIdTokens(body)) {
    add({
      kind: "id",
      value,
      confidence: "medium",
      source: "bare_identifier",
    });
  }

  return [...map.values()];
}
