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
  CodeDeclarationKind,
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
          chunks: [
            genericOrientationChunk(args, facts),
            ...genericDeclarationChunks(args, lang),
          ],
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

type GenericDeclarationSpec = {
  name: string;
  kind: CodeDeclarationKind;
  index: number;
  exported: boolean;
};

const GENERIC_DECLARATION_CHUNK_LIMIT = 120;

function genericDeclarationChunks(
  args: ExtractDispatchArgs,
  lang: "python" | "go" | "rust",
): ExtractedCodeChunk[] {
  const specs = genericDeclarationSpecs(args.content, lang)
    .sort((a, b) => a.index - b.index)
    .slice(0, GENERIC_DECLARATION_CHUNK_LIMIT);
  if (specs.length === 0) return [];
  const lineStarts = computeLineStarts(args.content);
  const lineCount = Math.max(1, lineStarts.length);
  return specs.map((spec, index) => {
    const startLine = lineNumberAt(lineStarts, spec.index);
    const nextStartLine = specs[index + 1]
      ? lineNumberAt(lineStarts, specs[index + 1]!.index)
      : lineCount + 1;
    const endLine = Math.min(nextStartLine - 1, startLine + 80, lineCount);
    const body = linesInRange(args.content, startLine, endLine).trim();
    return {
      source_path: args.source_path,
      stable_key: `${args.source_path}::${spec.name}:${startLine}`,
      symbol_path: spec.name,
      code_role: "declaration" as const,
      declaration_kind: spec.kind,
      exported: spec.exported,
      body,
      start_line: startLine,
      end_line: endLine,
    };
  }).filter((chunk) => chunk.body.length > 0);
}

function genericDeclarationSpecs(
  content: string,
  lang: "python" | "go" | "rust",
): GenericDeclarationSpec[] {
  switch (lang) {
    case "python":
      return [
        ...declarationMatches(content, /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm, "function", pythonExported),
        ...declarationMatches(content, /^class\s+([A-Za-z_]\w*)\b/gm, "class", pythonExported),
        ...pythonClassMethodSpecs(content),
        ...declarationMatches(content, /^([A-Z][A-Z0-9_]*)\s*(?::\s*[^=]+)?\s*=/gm, "const", () => true),
      ];
    case "go":
      return [
        ...goFunctionSpecs(content),
        ...declarationMatches(content, /^type\s+([A-Za-z_]\w*)\s+struct\b/gm, "class", goExported),
        ...declarationMatches(content, /^type\s+([A-Za-z_]\w*)\s+interface\b/gm, "interface", goExported),
        ...declarationMatches(content, /^type\s+([A-Za-z_]\w*)\b/gm, "type", goExported),
        ...declarationMatches(content, /^(?:const|var)\s+([A-Za-z_]\w*)\b/gm, "const", goExported),
      ];
    case "rust":
      return [
        ...declarationMatches(content, /^(pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:const\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)\b/gm, "function", rustExported, 2),
        ...rustImplMethodSpecs(content),
        ...declarationMatches(content, /^(pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)\b/gm, "class", rustExported, 2),
        ...declarationMatches(content, /^(pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)\b/gm, "enum", rustExported, 2),
        ...declarationMatches(content, /^(pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?trait\s+([A-Za-z_]\w*)\b/gm, "interface", rustExported, 2),
        ...declarationMatches(content, /^(pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z_]\w*)\b/gm, "type", rustExported, 2),
        ...declarationMatches(content, /^(pub(?:\([^)]*\))?\s+)?(?:const|static)\s+([A-Za-z_]\w*)\b/gm, "const", rustExported, 2),
      ];
  }
}

function goFunctionSpecs(content: string): GenericDeclarationSpec[] {
  const out: GenericDeclarationSpec[] = [];
  const pattern =
    /^func\s+(?:\(\s*(?:[A-Za-z_]\w*\s+)?\*?([A-Za-z_]\w*)\s*\)\s+)?([A-Za-z_]\w*)\s*\(/gm;
  for (const match of content.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const receiverType = match[1];
    const name = match[2];
    if (!name) continue;
    out.push({
      name: receiverType ? `${receiverType}.${name}` : name,
      kind: receiverType ? "method" : "function",
      index: match.index,
      exported: goExported(name),
    });
  }
  return out;
}

function pythonClassMethodSpecs(content: string): GenericDeclarationSpec[] {
  const out: GenericDeclarationSpec[] = [];
  const classPattern = /^class\s+([A-Za-z_]\w*)\b[^\n]*:/gm;
  for (const classMatch of content.matchAll(classPattern)) {
    if (classMatch.index === undefined) continue;
    const className = classMatch[1];
    if (!className) continue;
    const classLineEnd = content.indexOf("\n", classMatch.index);
    if (classLineEnd < 0) continue;
    const blockStart = classLineEnd + 1;
    const blockEnd = findNextPythonTopLevelDeclaration(content, blockStart);
    const block = content.slice(blockStart, blockEnd);
    const methodPattern = /^(?: {4}|\t)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm;
    for (const methodMatch of block.matchAll(methodPattern)) {
      if (methodMatch.index === undefined) continue;
      const methodName = methodMatch[1];
      if (!methodName) continue;
      out.push({
        name: `${className}.${methodName}`,
        kind: "method",
        index: blockStart + methodMatch.index,
        exported: pythonExported(className) && pythonExported(methodName),
      });
    }
  }
  return out;
}

function findNextPythonTopLevelDeclaration(content: string, start: number): number {
  const rest = content.slice(start);
  const nextTopLevel = rest.match(
    /^(?:class\s+[A-Za-z_]\w*\b|(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(|[A-Z][A-Z0-9_]*\s*(?::\s*[^=]+)?\s*=)/m,
  );
  return nextTopLevel?.index === undefined
    ? content.length
    : start + nextTopLevel.index;
}

function rustImplMethodSpecs(content: string): GenericDeclarationSpec[] {
  const out: GenericDeclarationSpec[] = [];
  const implPattern =
    /^impl(?:\s*<[^>{}]+>)?\s+(?:(?:[A-Za-z_]\w*(?:::[A-Za-z_]\w*)?(?:<[^>{}]*>)?)\s+for\s+)?([A-Za-z_]\w*)(?:<[^>{}]*>)?\s*\{/gm;
  for (const implMatch of content.matchAll(implPattern)) {
    if (implMatch.index === undefined) continue;
    const typeName = implMatch[1];
    if (!typeName) continue;
    const openIndex = content.indexOf("{", implMatch.index);
    if (openIndex < 0) continue;
    const closeIndex = findMatchingBrace(content, openIndex);
    const blockStart = openIndex + 1;
    const blockEnd = closeIndex > blockStart ? closeIndex : content.length;
    const block = content.slice(blockStart, blockEnd);
    const methodPattern =
      /^\s+(pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:const\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)\b/gm;
    for (const methodMatch of block.matchAll(methodPattern)) {
      if (methodMatch.index === undefined) continue;
      const methodName = methodMatch[2];
      if (!methodName) continue;
      out.push({
        name: `${typeName}.${methodName}`,
        kind: "method",
        index: blockStart + methodMatch.index,
        exported: Boolean(methodMatch[1]),
      });
    }
  }
  return out;
}

function findMatchingBrace(content: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < content.length; index++) {
    const char = content[index];
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function declarationMatches(
  content: string,
  pattern: RegExp,
  kind: CodeDeclarationKind,
  exported: (name: string, match: RegExpMatchArray) => boolean,
  nameGroup = 1,
): GenericDeclarationSpec[] {
  const out: GenericDeclarationSpec[] = [];
  for (const match of content.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const name = match[nameGroup];
    if (!name) continue;
    out.push({
      name,
      kind,
      index: match.index,
      exported: exported(name, match),
    });
  }
  return out;
}

function pythonExported(name: string): boolean {
  return !name.startsWith("_");
}

function goExported(name: string): boolean {
  return name.length > 0 && name[0]! >= "A" && name[0]! <= "Z";
}

function rustExported(_name: string, match: RegExpMatchArray): boolean {
  return Boolean(match[1]);
}

function computeLineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function lineNumberAt(lineStarts: readonly number[], index: number): number {
  let line = 1;
  for (let i = 0; i < lineStarts.length; i++) {
    if (lineStarts[i]! > index) break;
    line = i + 1;
  }
  return line;
}

function linesInRange(content: string, startLine: number, endLine: number): string {
  return content.split(/\r?\n/).slice(startLine - 1, endLine).join("\n");
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
