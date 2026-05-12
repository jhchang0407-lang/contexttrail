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

  return [...map.values()];
}
