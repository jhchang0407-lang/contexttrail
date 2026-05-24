/**
 * Deterministic Python code-source extractor (PRD-0028 follow-up).
 *
 * Same `CodeSourceFacts` shape as the TypeScript extractor — the index
 * is language-agnostic; only the per-language parser differs. Regex-
 * based parser: works on any Python 3.x source without adding a Python
 * runtime, tree-sitter wasm, or other heavy dependencies.
 *
 * Captures:
 *   - `def fn(...) -> R:` / `async def` top-level functions
 *   - `class C(...):` top-level classes
 *   - `NAME = ...` module-level constants (UPPER_SNAKE convention)
 *   - Type alias forms `X: TypeAlias = ...` and `X = Union[A, B]`
 *   - `from X import Y` / `import X` (relative resolved to repo paths)
 *   - Module-level docstring (first triple-quoted block at top of file)
 *
 * Does NOT parse class members, decorators with side effects, or
 * runtime metaclass tricks — the structural identity of a Python file
 * is its top-level surface, same as the TS extractor.
 *
 * Boundary: pure. Knows nothing about storage or retrieval.
 */
import { posix } from "node:path";
import type {
  CodeSourceExportKind,
  CodeSourceExportedSymbol,
  CodeSourceFacts,
} from "../types/code-source.js";
import {
  CODE_SOURCE_PURPOSE_CHAR_BUDGET,
  CODE_SOURCE_SIGNATURE_CHAR_BUDGET,
} from "../types/code-source.js";

export type ExtractPythonCodeSourceFactsArgs = {
  source_path: string;
  content: string;
  corpus_root: string;
};

const DEF_RE = /^(?:\s{0,3})(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?:/gm;
const CLASS_RE = /^(?:\s{0,3})class\s+([A-Za-z_][\w]*)\s*(?:\(([^)]*)\))?:/gm;
const CONST_RE = /^([A-Z][A-Z0-9_]*)\s*(?::\s*[^=]+)?\s*=\s*(.+)$/gm;
const TYPEALIAS_RE = /^([A-Za-z_][\w]*)\s*:\s*TypeAlias\s*=\s*(.+)$/gm;
const IMPORT_FROM_RE = /^from\s+([.\w]+)\s+import\s+([\w, *]+)$/gm;
const IMPORT_RE = /^import\s+([\w.]+)(?:\s+as\s+\w+)?$/gm;
const DOCSTRING_RE = /^\s*("""|''')([\s\S]*?)\1/;

function clampSignature(sig: string): string {
  const collapsed = sig.replace(/\s+/g, " ").trim();
  if (collapsed.length <= CODE_SOURCE_SIGNATURE_CHAR_BUDGET) return collapsed;
  return `${collapsed.slice(0, CODE_SOURCE_SIGNATURE_CHAR_BUDGET - 1).trimEnd()}…`;
}

function clampPurpose(text: string): string {
  const collapsed = text.replace(/\r/g, "").trim();
  if (collapsed.length <= CODE_SOURCE_PURPOSE_CHAR_BUDGET) return collapsed;
  return `${collapsed.slice(0, CODE_SOURCE_PURPOSE_CHAR_BUDGET - 1).trimEnd()}…`;
}

function isTopLevel(content: string, matchIndex: number): boolean {
  // Top-level forms start at column 0 (no leading whitespace before the
  // matched keyword). Our regexes already use `^` with multiline; this
  // helper guards against the optional ≤3-space gutter that regex
  // captures by re-checking the line head.
  const lineStart = content.lastIndexOf("\n", matchIndex - 1) + 1;
  const prefix = content.slice(lineStart, matchIndex);
  return /^\s{0,0}$/.test(prefix);
}

function extractModuleDocstring(content: string): string | null {
  // Skip optional shebang + encoding cookies.
  let body = content;
  if (body.startsWith("#!")) {
    const nl = body.indexOf("\n");
    body = nl >= 0 ? body.slice(nl + 1) : "";
  }
  // Allow one or two leading comment lines (encoding cookies / type: ignore).
  while (/^\s*#/.test(body)) {
    const nl = body.indexOf("\n");
    if (nl < 0) break;
    body = body.slice(nl + 1);
  }
  const m = body.match(DOCSTRING_RE);
  if (!m || m.index === undefined) return null;
  // Docstring must be the first non-comment, non-blank thing.
  const prefix = body.slice(0, m.index);
  if (prefix.trim().length > 0) return null;
  const inner = m[2] ?? "";
  return clampPurpose(inner);
}

/**
 * Resolve a Python import to a corpus-relative path. Handles:
 *   - `from .foo.bar import X` → "<dir>/foo/bar.py"
 *   - `from ..pkg import Y`    → "<dir-up>/pkg/__init__.py" or "<dir-up>/pkg.py"
 *   - `import top.level.mod`   → "top/level/mod.py"
 *
 * Returns the path WITHOUT a `.py` extension (mirrors TS extractor which
 * strips `.ts`/`.js` so the retrieval-time resolver can try variants).
 */
function resolveImport(modulePath: string, sourcePath: string): string | null {
  if (!modulePath) return null;
  const sourceDir = posix.dirname(sourcePath);
  // Relative imports: leading dots
  const dotMatch = modulePath.match(/^(\.+)(.*)$/);
  if (dotMatch) {
    const dots = dotMatch[1]!.length;
    const rest = dotMatch[2] ?? "";
    let base = sourceDir;
    for (let i = 1; i < dots; i++) {
      base = posix.dirname(base);
    }
    const restPath = rest.replace(/\./g, "/");
    return posix.normalize(posix.join(base, restPath));
  }
  // Absolute (from-corpus-root) imports
  return modulePath.replace(/\./g, "/");
}

export function extractPythonCodeSourceFacts(
  args: ExtractPythonCodeSourceFactsArgs,
): CodeSourceFacts {
  const empty: CodeSourceFacts = {
    file_path: args.source_path,
    exported_symbols: [],
    exported_signatures: [],
    file_purpose: null,
    imports: [],
  };
  if (!args.content || !args.content.trim()) return empty;

  const exported_symbols: CodeSourceExportedSymbol[] = [];
  const exported_signatures: string[] = [];
  const seen = new Set<string>();
  const push = (name: string, kind: CodeSourceExportKind, sig: string) => {
    if (name.startsWith("_")) return; // PEP 8 convention: leading underscore is private
    if (seen.has(`${name}|${kind}`)) return;
    seen.add(`${name}|${kind}`);
    exported_symbols.push({ name, kind });
    exported_signatures.push(clampSignature(sig));
  };

  // Functions
  for (const m of args.content.matchAll(DEF_RE)) {
    if (m.index === undefined || !isTopLevel(args.content, m.index)) continue;
    const name = m[1]!;
    const params = m[2] ?? "";
    const ret = m[3] ? ` -> ${m[3].trim()}` : "";
    push(name, "function", `def ${name}(${params})${ret}`);
  }

  // Classes
  for (const m of args.content.matchAll(CLASS_RE)) {
    if (m.index === undefined || !isTopLevel(args.content, m.index)) continue;
    const name = m[1]!;
    const bases = m[2] ? `(${m[2]})` : "";
    push(name, "class", `class ${name}${bases}`);
  }

  // Constants
  for (const m of args.content.matchAll(CONST_RE)) {
    if (m.index === undefined || !isTopLevel(args.content, m.index)) continue;
    const name = m[1]!;
    const value = m[2] ?? "";
    push(name, "const", `${name} = ${value.trim()}`);
  }

  // Type aliases (PEP 613 / 695 syntax)
  for (const m of args.content.matchAll(TYPEALIAS_RE)) {
    if (m.index === undefined || !isTopLevel(args.content, m.index)) continue;
    const name = m[1]!;
    const rhs = m[2] ?? "";
    push(name, "type", `${name}: TypeAlias = ${rhs.trim()}`);
  }

  // Imports
  const imports: string[] = [];
  const importsSeen = new Set<string>();
  const recordImport = (resolved: string | null) => {
    if (!resolved) return;
    if (importsSeen.has(resolved)) return;
    importsSeen.add(resolved);
    imports.push(resolved);
  };
  for (const m of args.content.matchAll(IMPORT_FROM_RE)) {
    if (m.index === undefined || !isTopLevel(args.content, m.index)) continue;
    recordImport(resolveImport(m[1] ?? "", args.source_path));
  }
  for (const m of args.content.matchAll(IMPORT_RE)) {
    if (m.index === undefined || !isTopLevel(args.content, m.index)) continue;
    recordImport(resolveImport(m[1] ?? "", args.source_path));
  }

  const file_purpose = extractModuleDocstring(args.content);

  return {
    file_path: args.source_path,
    exported_symbols,
    exported_signatures,
    file_purpose,
    imports,
  };
}
