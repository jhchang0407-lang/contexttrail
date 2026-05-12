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
import type { CodeSourceFacts } from "../types/code-source.js";
import { extractCodeSourceFacts } from "./code-source.js";
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
