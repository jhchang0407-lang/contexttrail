/**
 * Deterministic TypeScript/TSX code-source extractor (PRD-0028 / slice 28.1).
 *
 * Walks one TypeScript or TSX file via the TypeScript compiler API and
 * produces a `CodeSourceFacts` record: file path, top-level export shape,
 * file-level JSDoc/top comment, exported signatures, and corpus-resolved
 * relative imports. No code bodies; structural metadata only.
 *
 * Boundary: pure. Knows nothing about storage (28.2) or retrieval (28.3).
 */
import ts from "typescript";
import type {
  CodeSourceExportKind,
  CodeSourceExportedSymbol,
  CodeSourceFacts,
} from "../types/code-source.js";
import {
  CODE_SOURCE_PURPOSE_CHAR_BUDGET,
  CODE_SOURCE_SIGNATURE_CHAR_BUDGET,
} from "../types/code-source.js";

export type ExtractCodeSourceFactsArgs = {
  source_path: string;
  content: string;
  corpus_root: string;
};

export function extractCodeSourceFacts(
  args: ExtractCodeSourceFactsArgs,
): CodeSourceFacts {
  const empty: CodeSourceFacts = {
    file_path: args.source_path,
    exported_symbols: [],
    exported_signatures: [],
    file_purpose: null,
    imports: [],
  };
  if (!args.content || !args.content.trim()) return empty;

  let sf: ts.SourceFile;
  try {
    sf = ts.createSourceFile(
      args.source_path,
      args.content,
      ts.ScriptTarget.Latest,
      /*setParentNodes*/ true,
      args.source_path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
  } catch {
    return empty;
  }

  let exported_symbols: CodeSourceExportedSymbol[];
  let exported_signatures: string[];
  let imports: string[];
  let file_purpose: string | null;
  try {
    const collected = collectExports(sf, args.content);
    exported_symbols = collected.symbols;
    exported_signatures = collected.signatures;
    imports = collectRelativeImports(sf, args.source_path);
    file_purpose = extractLeadingComment(args.content);
  } catch {
    return empty;
  }

  return {
    file_path: args.source_path,
    exported_symbols,
    exported_signatures,
    file_purpose,
    imports,
  };
}

function collectExports(
  sf: ts.SourceFile,
  content: string,
): { symbols: CodeSourceExportedSymbol[]; signatures: string[] } {
  const symbols: CodeSourceExportedSymbol[] = [];
  const signatures: string[] = [];
  const seen = new Set<string>();

  // First pass: locally-named declarations (top-level only) keyed by name.
  const localDecls = new Map<string, { kind: CodeSourceExportKind; node: ts.Node }>();

  for (const stmt of sf.statements) {
    const isExported = hasExportModifier(stmt);
    const isDefault = hasDefaultModifier(stmt);

    if (ts.isFunctionDeclaration(stmt)) {
      const name = stmt.name?.text;
      if (name) localDecls.set(name, { kind: "function", node: stmt });
      if (isExported) {
        const exportName = name ?? (isDefault ? "default" : null);
        if (exportName) push(symbols, seen, { name: exportName, kind: "function" });
        signatures.push(truncate(sliceSignature(stmt, content), CODE_SOURCE_SIGNATURE_CHAR_BUDGET));
      }
    } else if (ts.isClassDeclaration(stmt)) {
      const name = stmt.name?.text;
      if (name) localDecls.set(name, { kind: "class", node: stmt });
      if (isExported) {
        const exportName = name ?? (isDefault ? "default" : null);
        if (exportName) push(symbols, seen, { name: exportName, kind: "class" });
        signatures.push(
          truncate(`class ${exportName ?? ""}`, CODE_SOURCE_SIGNATURE_CHAR_BUDGET),
        );
      }
    } else if (ts.isInterfaceDeclaration(stmt)) {
      const name = stmt.name.text;
      localDecls.set(name, { kind: "interface", node: stmt });
      if (isExported) {
        push(symbols, seen, { name, kind: "interface" });
        signatures.push(truncate(sliceSignature(stmt, content), CODE_SOURCE_SIGNATURE_CHAR_BUDGET));
      }
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      const name = stmt.name.text;
      localDecls.set(name, { kind: "type", node: stmt });
      if (isExported) {
        push(symbols, seen, { name, kind: "type" });
        signatures.push(truncate(sliceSignature(stmt, content), CODE_SOURCE_SIGNATURE_CHAR_BUDGET));
      }
    } else if (ts.isEnumDeclaration(stmt)) {
      const name = stmt.name.text;
      localDecls.set(name, { kind: "enum", node: stmt });
      if (isExported) {
        push(symbols, seen, { name, kind: "enum" });
        signatures.push(truncate(`enum ${name}`, CODE_SOURCE_SIGNATURE_CHAR_BUDGET));
      }
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) {
          const name = d.name.text;
          localDecls.set(name, { kind: "const", node: d });
          if (isExported) {
            push(symbols, seen, { name, kind: "const" });
            signatures.push(
              truncate(sliceSignature(d, content), CODE_SOURCE_SIGNATURE_CHAR_BUDGET),
            );
          }
        }
      }
    } else if (ts.isExportAssignment(stmt)) {
      // `export default <expr>`
      const expr = stmt.expression;
      let name = "default";
      let kind: CodeSourceExportKind = "const";
      if (ts.isIdentifier(expr)) {
        const local = localDecls.get(expr.text);
        if (local) {
          name = expr.text;
          kind = local.kind;
        } else {
          name = expr.text;
        }
      }
      push(symbols, seen, { name, kind });
      signatures.push(
        truncate(sliceSignature(stmt, content), CODE_SOURCE_SIGNATURE_CHAR_BUDGET),
      );
    } else if (ts.isExportDeclaration(stmt)) {
      // `export { a, b }` (no module specifier) or `export { a } from "..."`.
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          const exportedName = el.name.text;
          const localName = (el.propertyName ?? el.name).text;
          const local = localDecls.get(localName);
          const kind: CodeSourceExportKind = local?.kind ?? "const";
          push(symbols, seen, { name: exportedName, kind });
        }
      }
    }
  }

  return { symbols, signatures };
}

function push(
  out: CodeSourceExportedSymbol[],
  seen: Set<string>,
  s: CodeSourceExportedSymbol,
): void {
  if (seen.has(s.name)) return;
  seen.add(s.name);
  out.push(s);
}

function hasExportModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function hasDefaultModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
}

function sliceSignature(node: ts.Node, content: string): string {
  // For declarations, the signature is the source text up to (but not
  // including) the function/class/type body — we trim at the first `{` or
  // `=`-followed-block to keep it shape-only.
  const start = node.getStart();
  const end = Math.min(node.getEnd(), start + CODE_SOURCE_SIGNATURE_CHAR_BUDGET * 2);
  let text = content.slice(start, end);
  // Strip a trailing block body if present — keep declaration head.
  const braceIdx = text.indexOf("{");
  if (braceIdx >= 0) {
    text = text.slice(0, braceIdx).trim();
  }
  return text.replace(/\s+/g, " ").trim();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function collectRelativeImports(sf: ts.SourceFile, sourcePath: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const spec = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(spec)) continue;
    const raw = spec.text;
    if (!raw.startsWith(".")) continue;
    const resolved = resolveRelative(sourcePath, raw);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      out.push(resolved);
    }
  }
  return out;
}

function resolveRelative(fromPath: string, spec: string): string | null {
  const fromSegs = fromPath.split("/");
  fromSegs.pop(); // drop filename
  const specStripped = spec.replace(/\.(jsx?|tsx?)$/i, "");
  const specSegs = specStripped.split("/");
  const stack: string[] = [...fromSegs];
  for (const seg of specSegs) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      stack.pop();
      continue;
    }
    stack.push(seg);
  }
  return stack.join("/");
}

function extractLeadingComment(content: string): string | null {
  const ranges = ts.getLeadingCommentRanges(content, 0) ?? [];
  let collected = "";
  for (const r of ranges) {
    collected += content.slice(r.pos, r.end) + "\n";
  }
  const cleaned = cleanComment(collected);
  if (!cleaned) return null;
  return truncate(cleaned, CODE_SOURCE_PURPOSE_CHAR_BUDGET);
}

function cleanComment(raw: string): string {
  if (!raw) return "";
  // Strip /** ... */ / /* ... */ / leading //.
  let s = raw
    .replace(/^\s*\/\*\*?/, "")
    .replace(/\*\/\s*$/, "")
    .trim();
  const lines = s
    .split("\n")
    .map((l) => l.replace(/^\s*\/\/\s?/, "").replace(/^\s*\*\s?/, "").trimEnd())
    .filter((l, i, arr) => !(i === 0 && l.trim() === "") && !(i === arr.length - 1 && l.trim() === ""));
  return lines.join("\n").trim();
}
