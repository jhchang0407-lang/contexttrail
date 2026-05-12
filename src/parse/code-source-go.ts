/**
 * Deterministic Go code-source extractor (PRD-0028 follow-up).
 *
 * Same `CodeSourceFacts` shape as the TypeScript and Python extractors.
 * Regex-based parser: works on any Go source without adding a Go
 * runtime dependency.
 *
 * Captures:
 *   - `func Name(...) ...` top-level functions
 *   - `func (r *Recv) Method(...) ...` top-level methods (recorded by name)
 *   - `type Name struct {...}` / `type Name interface {...}` / `type Name = X`
 *   - `const Name = ...` / `var Name = ...` (top-level only)
 *   - `import "path/to/pkg"` / `import alias "path/to/pkg"`
 *   - Leading package-level comment block (the doc comment above
 *     `package X`) as file_purpose
 *
 * Go's export convention is capitalization. Names beginning with a
 * lowercase letter are package-private and intentionally excluded —
 * same logic as the Python leading-underscore filter.
 */
import type {
  CodeSourceExportKind,
  CodeSourceExportedSymbol,
  CodeSourceFacts,
} from "../types/code-source.js";
import {
  CODE_SOURCE_PURPOSE_CHAR_BUDGET,
  CODE_SOURCE_SIGNATURE_CHAR_BUDGET,
} from "../types/code-source.js";

export type ExtractGoCodeSourceFactsArgs = {
  source_path: string;
  content: string;
  /**
   * Optional Go module prefix (`go.mod`'s `module foo.com/bar`). When
   * provided, imports beginning with this prefix get resolved to
   * corpus-relative paths. Otherwise stdlib + module imports are
   * surfaced as-is.
   */
  module_prefix?: string;
};

const FUNC_RE = /^func\s+(?:\(\s*\w+\s+\*?\w+\s*\)\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(\([^)]*\)|[\w*.\[\]]+)?\s*\{/gm;
const TYPE_RE = /^type\s+([A-Za-z_]\w*)\s+(struct|interface|=?\s*[\w*.\[\]<>]+)/gm;
const CONST_RE = /^const\s+([A-Z]\w*)\s*(?:[\w*.\[\]]+\s*)?=\s*(.+)$/gm;
const VAR_RE = /^var\s+([A-Z]\w*)\s*(?:[\w*.\[\]]+\s*)?=?\s*(.+)?$/gm;
const IMPORT_SINGLE_RE = /^import\s+(?:(\w+)\s+)?"([^"]+)"$/gm;
const IMPORT_BLOCK_RE = /^import\s*\(([\s\S]*?)\)/m;
const IMPORT_INNER_RE = /^\s*(?:(\w+)\s+)?"([^"]+)"/gm;

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

function isExported(name: string): boolean {
  return name.length > 0 && name[0]! >= "A" && name[0]! <= "Z";
}

function extractPackageDocComment(content: string): string | null {
  // Find the `package X` declaration line, then walk backwards through
  // contiguous `//` or `/* ... */` comments immediately preceding it.
  const lines = content.split("\n");
  let pkgLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*package\s+\w+/.test(lines[i] ?? "")) {
      pkgLine = i;
      break;
    }
  }
  if (pkgLine < 0) return null;
  const comments: string[] = [];
  for (let i = pkgLine - 1; i >= 0; i--) {
    const ln = lines[i] ?? "";
    if (/^\s*\/\//.test(ln)) {
      comments.unshift(ln.replace(/^\s*\/\/\s?/, ""));
    } else if (ln.trim() === "") {
      // Blank line between comment block and package: stop.
      if (comments.length > 0) break;
    } else {
      break;
    }
  }
  if (comments.length === 0) return null;
  return clampPurpose(comments.join(" "));
}

function resolveImport(modulePath: string, modulePrefix?: string): string | null {
  if (!modulePath) return null;
  if (modulePrefix && modulePath.startsWith(`${modulePrefix}/`)) {
    return modulePath.slice(modulePrefix.length + 1);
  }
  if (modulePrefix && modulePath === modulePrefix) {
    return "";
  }
  // Stdlib + external — keep verbatim so the corpus matcher can decide
  // whether to filter them (matches the TS extractor's behaviour of
  // leaving `react` / `node:fs` in the imports list).
  return modulePath;
}

export function extractGoCodeSourceFacts(
  args: ExtractGoCodeSourceFactsArgs,
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
    if (!isExported(name)) return;
    if (seen.has(`${name}|${kind}`)) return;
    seen.add(`${name}|${kind}`);
    exported_symbols.push({ name, kind });
    exported_signatures.push(clampSignature(sig));
  };

  // Functions / methods
  for (const m of args.content.matchAll(FUNC_RE)) {
    const name = m[1]!;
    const params = m[2] ?? "";
    const ret = m[3] ?? "";
    push(name, "function", `func ${name}(${params}) ${ret}`.trim());
  }

  // Types
  for (const m of args.content.matchAll(TYPE_RE)) {
    const name = m[1]!;
    const decl = m[2] ?? "";
    let kind: CodeSourceExportKind = "type";
    if (decl.startsWith("struct")) kind = "class";
    else if (decl.startsWith("interface")) kind = "interface";
    push(name, kind, `type ${name} ${decl}`);
  }

  // Consts + vars
  for (const m of args.content.matchAll(CONST_RE)) {
    const name = m[1]!;
    const value = m[2] ?? "";
    push(name, "const", `const ${name} = ${value.trim()}`);
  }
  for (const m of args.content.matchAll(VAR_RE)) {
    const name = m[1]!;
    const value = m[2] ?? "";
    push(name, "const", `var ${name} = ${value.trim()}`);
  }

  // Imports — single-line + block form
  const imports: string[] = [];
  const importsSeen = new Set<string>();
  const recordImport = (modulePath: string) => {
    const resolved = resolveImport(modulePath, args.module_prefix);
    if (!resolved) return;
    if (importsSeen.has(resolved)) return;
    importsSeen.add(resolved);
    imports.push(resolved);
  };
  for (const m of args.content.matchAll(IMPORT_SINGLE_RE)) {
    recordImport(m[2] ?? "");
  }
  const blockMatch = args.content.match(IMPORT_BLOCK_RE);
  if (blockMatch && blockMatch[1]) {
    for (const m of blockMatch[1].matchAll(IMPORT_INNER_RE)) {
      recordImport(m[2] ?? "");
    }
  }

  const file_purpose = extractPackageDocComment(args.content);

  return {
    file_path: args.source_path,
    exported_symbols,
    exported_signatures,
    file_purpose,
    imports,
  };
}
