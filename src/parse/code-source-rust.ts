/**
 * Deterministic Rust code-source extractor (PRD-0028 follow-up).
 *
 * Same `CodeSourceFacts` shape as the other language extractors.
 * Regex-based; works on any Rust source without pulling in syn / rustc.
 *
 * Captures:
 *   - `pub fn`, `pub async fn` — top-level public functions
 *   - `pub struct`, `pub enum`, `pub trait`, `pub type` — type-shaped items
 *   - `pub const`, `pub static` — module-level public values
 *   - `use crate::foo::bar;` / `use self::baz;` / `use super::qux;` imports,
 *     resolved to corpus-relative module paths when possible
 *   - The leading `//!` inner module-doc block as file_purpose
 *
 * Rust's export convention is `pub` (and `pub(crate)`, which is treated
 * as exported here — same as TypeScript's `export` keyword: any
 * declared public surface). Items without `pub` are intentionally
 * excluded.
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

export type ExtractRustCodeSourceFactsArgs = {
  source_path: string;
  content: string;
};

const PUB = "(?:pub(?:\\([^)]*\\))?)";
const FN_RE = new RegExp(`^${PUB}\\s+(?:async\\s+)?(?:const\\s+)?(?:unsafe\\s+)?fn\\s+([A-Za-z_][\\w]*)\\s*(?:<[^>]+>)?\\s*\\(([^)]*)\\)(?:\\s*->\\s*([^{;]+))?`, "gm");
const STRUCT_RE = new RegExp(`^${PUB}\\s+struct\\s+([A-Za-z_][\\w]*)(?:<[^>]+>)?`, "gm");
const ENUM_RE = new RegExp(`^${PUB}\\s+enum\\s+([A-Za-z_][\\w]*)(?:<[^>]+>)?`, "gm");
const TRAIT_RE = new RegExp(`^${PUB}\\s+(?:unsafe\\s+)?trait\\s+([A-Za-z_][\\w]*)(?:<[^>]+>)?`, "gm");
const TYPE_RE = new RegExp(`^${PUB}\\s+type\\s+([A-Za-z_][\\w]*)(?:<[^>]+>)?\\s*=\\s*([^;]+);`, "gm");
const CONST_RE = new RegExp(`^${PUB}\\s+(?:const|static)\\s+([A-Z][A-Z0-9_]*)\\s*:\\s*([^=]+)=\\s*([^;]+);`, "gm");
const USE_RE = /^use\s+([\w:{}, *]+);/gm;

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

function extractInnerModuleDoc(content: string): string | null {
  const lines = content.split("\n");
  const docLines: string[] = [];
  for (const ln of lines) {
    if (/^\s*\/\/!/.test(ln)) {
      docLines.push(ln.replace(/^\s*\/\/!\s?/, ""));
    } else if (ln.trim() === "" && docLines.length === 0) {
      continue;
    } else {
      if (docLines.length > 0) break;
      if (ln.trim() === "") continue;
      break;
    }
  }
  if (docLines.length === 0) return null;
  return clampPurpose(docLines.join(" "));
}

function resolveUse(usePath: string): string[] {
  // Rust's use statements can have braces. Expand `use a::{b, c};`
  // into `["a::b", "a::c"]`. For corpus-relative resolution, prefer
  // `crate::` rooted paths — `crate::foo::bar` → `foo/bar`.
  // Stdlib / external (`std::`, `serde::`) are surfaced as-is.
  const trimmed = usePath.trim();
  if (!trimmed) return [];
  // Brace expansion
  const braceMatch = trimmed.match(/^(.+?)::\{(.+)\}$/);
  if (braceMatch) {
    const prefix = braceMatch[1]!;
    const items = (braceMatch[2] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return items.flatMap((item) => resolveUse(`${prefix}::${item}`));
  }
  // Convert crate::foo::bar to foo/bar
  if (trimmed.startsWith("crate::")) {
    return [trimmed.slice("crate::".length).replace(/::/g, "/")];
  }
  return [trimmed.replace(/::/g, "/")];
}

export function extractRustCodeSourceFacts(
  args: ExtractRustCodeSourceFactsArgs,
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
    if (seen.has(`${name}|${kind}`)) return;
    seen.add(`${name}|${kind}`);
    exported_symbols.push({ name, kind });
    exported_signatures.push(clampSignature(sig));
  };

  for (const m of args.content.matchAll(FN_RE)) {
    const name = m[1]!;
    const params = m[2] ?? "";
    const ret = m[3] ? ` -> ${m[3].trim()}` : "";
    push(name, "function", `pub fn ${name}(${params})${ret}`);
  }
  for (const m of args.content.matchAll(STRUCT_RE)) {
    push(m[1]!, "class", `pub struct ${m[1]}`);
  }
  for (const m of args.content.matchAll(ENUM_RE)) {
    push(m[1]!, "enum", `pub enum ${m[1]}`);
  }
  for (const m of args.content.matchAll(TRAIT_RE)) {
    push(m[1]!, "interface", `pub trait ${m[1]}`);
  }
  for (const m of args.content.matchAll(TYPE_RE)) {
    push(m[1]!, "type", `pub type ${m[1]} = ${(m[2] ?? "").trim()}`);
  }
  for (const m of args.content.matchAll(CONST_RE)) {
    push(m[1]!, "const", `pub const ${m[1]}: ${(m[2] ?? "").trim()} = ${(m[3] ?? "").trim()}`);
  }

  const imports: string[] = [];
  const importsSeen = new Set<string>();
  for (const m of args.content.matchAll(USE_RE)) {
    for (const resolved of resolveUse(m[1] ?? "")) {
      if (!resolved || importsSeen.has(resolved)) continue;
      importsSeen.add(resolved);
      imports.push(resolved);
    }
  }

  const file_purpose = extractInnerModuleDoc(args.content);

  return {
    file_path: args.source_path,
    exported_symbols,
    exported_signatures,
    file_purpose,
    imports,
  };
}
