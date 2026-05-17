/**
 * Per-language dispatch for the code-source extractor (PRD-0028 follow-up).
 *
 * Each extractor emits the SAME `CodeSourceFacts` shape, so the index,
 * storage layer, and retrieval mix are language-agnostic. Only the
 * AST/regex parser differs per language.
 *
 * Supported languages today:
 *   - TypeScript / TSX / JavaScript (typescript compiler API)
 *   - Python                        (regex; no Python runtime needed)
 *   - Go                            (regex; no Go toolchain needed)
 *   - Rust                          (regex; no Cargo / syn needed)
 *
 * Returns a synthesized empty record for unknown extensions so callers
 * never have to special-case "no extractor available" — the file simply
 * has no exported_symbols / file_purpose / imports.
 */
import type {
  CodeIndexArtifacts,
  CodeSourceFacts,
  ExtractedCodeChunk,
} from "../types/code-source.js";
import { extractCodeIndexArtifacts, extractCodeSourceFacts } from "./code-source.js";
import { extractPythonCodeSourceFacts } from "./code-source-python.js";
import { extractGoCodeSourceFacts } from "./code-source-go.js";
import { extractRustCodeSourceFacts } from "./code-source-rust.js";

export type CodeSourceLanguage = "typescript" | "javascript" | "python" | "go" | "rust" | "unknown";

export function detectCodeLanguage(source_path: string): CodeSourceLanguage {
  if (/\.tsx?$/i.test(source_path)) return "typescript";
  if (/\.jsx?$/i.test(source_path)) return "javascript";
  if (/\.py$/i.test(source_path)) return "python";
  if (/\.go$/i.test(source_path)) return "go";
  if (/\.rs$/i.test(source_path)) return "rust";
  return "unknown";
}

export type ExtractDispatchArgs = {
  source_path: string;
  content: string;
  corpus_root: string;
  /** Go-specific: module prefix from `go.mod`. */
  go_module_prefix?: string;
};

export function extractCodeIndexArtifactsFor(args: ExtractDispatchArgs): CodeIndexArtifacts {
  const lang = detectCodeLanguage(args.source_path);
  switch (lang) {
    case "typescript":
    case "javascript":
      return extractCodeIndexArtifacts({
        source_path: args.source_path,
        content: args.content,
        corpus_root: args.corpus_root,
      });
    case "python":
    case "go":
    case "rust":
      {
        const facts = extractCodeSourceFactsFor(args);
        return {
          facts,
          chunks: [genericOrientationChunk(args, facts)],
        };
      }
    case "unknown":
    default:
      return {
        facts: extractCodeSourceFactsFor(args),
        chunks: [],
      };
  }
}

function genericOrientationChunk(
  args: ExtractDispatchArgs,
  facts: CodeSourceFacts,
): ExtractedCodeChunk {
  const lineCount = Math.max(1, args.content.split(/\r?\n/).length);
  return {
    source_path: args.source_path,
    stable_key: `${args.source_path}::orientation`,
    symbol_path: null,
    code_role: "orientation",
    declaration_kind: null,
    exported: false,
    body: genericOrientationBody(args, facts),
    start_line: 1,
    end_line: Math.min(lineCount, 80),
  };
}

function genericOrientationBody(
  args: ExtractDispatchArgs,
  facts: CodeSourceFacts,
): string {
  const lines = [`Code file: ${facts.file_path}`];
  if (facts.file_purpose) lines.push(`Purpose: ${facts.file_purpose}`);
  if (facts.exported_symbols.length > 0) {
    lines.push(
      `Exports: ${facts.exported_symbols
        .map((symbol) => `${symbol.kind} ${symbol.name}`)
        .join(", ")}`,
    );
  }
  if (facts.exported_signatures.length > 0) {
    lines.push(`Signatures: ${facts.exported_signatures.join(" | ")}`);
  }
  if (facts.imports.length > 0) {
    lines.push(`Imports: ${facts.imports.join(", ")}`);
  }
  const bodyTerms = compactBodyTerms(args.content);
  if (bodyTerms.length > 0) {
    lines.push(`Body terms: ${bodyTerms.join(" ")}`);
  }
  return lines.join("\n");
}

function compactBodyTerms(content: string): string[] {
  const counts = new Map<string, number>();
  for (const token of content
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)) {
    if (token.length < 3 || GENERIC_BODY_TERM_STOPWORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const frequent = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 180)
    .map(([token]) => token);
  const specific = [...counts.keys()]
    .filter((token) => token.length >= 7)
    .sort()
    .slice(0, 180);
  return [...new Set([...frequent, ...specific])];
}

const GENERIC_BODY_TERM_STOPWORDS = new Set([
  "and",
  "any",
  "are",
  "arg",
  "args",
  "bool",
  "class",
  "const",
  "def",
  "else",
  "enum",
  "false",
  "for",
  "from",
  "function",
  "impl",
  "import",
  "int",
  "let",
  "match",
  "mod",
  "mut",
  "none",
  "not",
  "null",
  "option",
  "pub",
  "return",
  "self",
  "some",
  "str",
  "string",
  "struct",
  "the",
  "this",
  "true",
  "type",
  "use",
  "with",
]);

export function extractCodeSourceFactsFor(args: ExtractDispatchArgs): CodeSourceFacts {
  const lang = detectCodeLanguage(args.source_path);
  switch (lang) {
    case "typescript":
    case "javascript":
      return extractCodeSourceFacts({
        source_path: args.source_path,
        content: args.content,
        corpus_root: args.corpus_root,
      });
    case "python":
      return extractPythonCodeSourceFacts({
        source_path: args.source_path,
        content: args.content,
        corpus_root: args.corpus_root,
      });
    case "go":
      return extractGoCodeSourceFacts({
        source_path: args.source_path,
        content: args.content,
        ...(args.go_module_prefix ? { module_prefix: args.go_module_prefix } : {}),
      });
    case "rust":
      return extractRustCodeSourceFacts({
        source_path: args.source_path,
        content: args.content,
      });
    default:
      return {
        file_path: args.source_path,
        exported_symbols: [],
        exported_signatures: [],
        file_purpose: null,
        imports: [],
      };
  }
}
