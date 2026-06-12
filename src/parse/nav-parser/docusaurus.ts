/**
 * Docusaurus sub-parsers.
 *
 * Two surfaces:
 *
 *   - `_category_.json` — per-directory file declaring the section's
 *     label and the position of the directory itself within its parent.
 *     Position of individual docs inside the directory comes from the
 *     filename's `sidebar_position` frontmatter (handled separately) or
 *     alphabetic order.
 *
 *   - `sidebars.{js,ts,mjs,cjs}` — explicit sidebar declaration. We
 *     parse a JSON-shaped object literal pragmatically using regex
 *     extraction; non-JSON-friendly TypeScript constructs degrade to
 *     "no entries" rather than crash.
 */
import type { NavEntry } from "../nav-parser.js";

export type DocusaurusParseInput = {
  config_text: string;
  config_path: string;
};

export type DocusaurusCategoryInput = {
  category_path: string;
  category_text: string;
  /** All markdown files (relative to corpus root) that live in the
   *  directory the `_category_.json` annotates. Used so the category
   *  parser can ascribe entries; ordering inside the directory is
   *  alphabetical. */
  directory_markdown: string[];
};

export function parseDocusaurusCategory(input: DocusaurusCategoryInput): NavEntry[] {
  if (!input.category_text || !input.category_text.trim()) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(input.category_text);
  } catch {
    return [];
  }
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const label = typeof obj.label === "string" ? obj.label.trim() : "";
  const sectionId = directoryName(input.category_path) || "section";

  // List of doc files in the directory, alphabetic. The first becomes
  // the landing in the renumber pass.
  const docs = input.directory_markdown
    .filter((p) => /\.(md|mdx|markdown)$/i.test(p))
    .sort();
  if (docs.length === 0) return [];

  const out: NavEntry[] = [];
  for (let i = 0; i < docs.length; i += 1) {
    const path = docs[i]!;
    out.push({
      source_path: path,
      nav_section_id: sectionId,
      nav_position: i + 1,
      nav_label: i === 0 && label ? label : filenameStem(path),
      is_nav_landing: false,
    });
  }
  return out;
}

export function parseDocusaurusSidebar(input: DocusaurusParseInput): NavEntry[] {
  // Pragmatic approach: locate the first object literal that looks like
  // a sidebars export and extract its top-level keys -> arrays. We
  // tolerate JS / TS comments (//, /* */) and trailing commas before
  // attempting a JSON parse.
  const text = stripComments(input.config_text);
  const objectLiteral = extractFirstObjectLiteral(text);
  if (!objectLiteral) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsToJson(objectLiteral));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];

  const out: NavEntry[] = [];
  const top = parsed as Record<string, unknown>;
  for (const [sidebarKey, value] of Object.entries(top)) {
    if (Array.isArray(value)) {
      walkSidebarArray(value, normalizeSectionId(sidebarKey), out);
    }
  }
  return out;
}

function walkSidebarArray(
  arr: unknown[],
  sectionId: string,
  out: NavEntry[],
): void {
  let position = 0;
  for (const item of arr) {
    if (typeof item === "string") {
      position += 1;
      out.push({
        source_path: idToPath(item),
        nav_section_id: sectionId,
        nav_position: position,
        nav_label: filenameStem(idToPath(item)),
        is_nav_landing: false,
      });
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const obj = item as Record<string, unknown>;
      const type = typeof obj.type === "string" ? obj.type : "";
      if (type === "doc" && typeof obj.id === "string") {
        position += 1;
        const path = idToPath(obj.id);
        out.push({
          source_path: path,
          nav_section_id: sectionId,
          nav_position: position,
          nav_label:
            (typeof obj.label === "string" && obj.label.trim()) ||
            filenameStem(path),
          is_nav_landing: false,
        });
        continue;
      }
      if (type === "category" && Array.isArray(obj.items)) {
        const childSection =
          typeof obj.label === "string"
            ? normalizeSectionId(obj.label)
            : sectionId;
        walkSidebarArray(obj.items, childSection, out);
      }
    }
  }
}

function idToPath(id: string): string {
  const cleaned = id.replace(/^\/+/, "").replace(/\\/g, "/");
  // Docusaurus sidebar IDs are doc-relative paths without an extension.
  if (/\.(md|mdx|markdown)$/i.test(cleaned)) {
    return cleaned.startsWith("docs/") ? cleaned : `docs/${cleaned}`;
  }
  const withExt = `${cleaned}.md`;
  return withExt.startsWith("docs/") ? withExt : `docs/${withExt}`;
}

function filenameStem(path: string): string {
  const leaf = path.split("/").pop() ?? path;
  return leaf.replace(/\.(md|mdx|markdown)$/i, "") || leaf;
}

function directoryName(catPath: string): string {
  // catPath is e.g. "docs/server/_category_.json"; we want "server".
  const parts = catPath.split("/").filter(Boolean);
  // Drop the trailing filename.
  parts.pop();
  return parts[parts.length - 1] ?? "";
}

function normalizeSectionId(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    || "section";
}

function stripComments(s: string): string {
  // Remove /* ... */ then //...EOL. This is good-enough for typical
  // hand-edited sidebar configs; pathological cases (// inside strings)
  // fail open and the caller falls back to "no entries."
  let out = "";
  let i = 0;
  while (i < s.length) {
    const two = s.slice(i, i + 2);
    if (two === "/*") {
      const end = s.indexOf("*/", i + 2);
      if (end === -1) {
        i = s.length;
      } else {
        i = end + 2;
      }
      continue;
    }
    if (two === "//") {
      const eol = s.indexOf("\n", i + 2);
      if (eol === -1) i = s.length;
      else i = eol;
      continue;
    }
    out += s[i];
    i += 1;
  }
  return out;
}

function extractFirstObjectLiteral(s: string): string | null {
  // Find the first '{' and walk forward, balancing braces while
  // respecting string literals.
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr: '"' | "'" | "`" | null = null;
  let escaped = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i]!;
    if (inStr) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === inStr) {
        inStr = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return s.slice(start, i + 1);
      }
    }
  }
  return null;
}

function jsToJson(literal: string): string {
  // Convert a permissive JS-ish object literal to a JSON-parseable
  // string:
  //   - single-quoted strings → double-quoted (best-effort; doesn't
  //     handle escaped single quotes inside, which fail to parse and
  //     the caller degrades cleanly)
  //   - backtick strings → double-quoted (no template interpolation
  //     support; treat them as static strings)
  //   - bare identifier keys → quoted keys
  //   - trailing commas before } and ] → removed
  let s = literal;
  s = s.replace(/'((?:[^'\\]|\\.)*)'/g, (_m, inner) => {
    return `"${inner.replace(/"/g, '\\"')}"`;
  });
  s = s.replace(/`((?:[^`\\$]|\\.)*)`/g, (_m, inner) => {
    return `"${inner.replace(/"/g, '\\"')}"`;
  });
  s = s.replace(
    /([{,])(\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g,
    (_m, prefix, ws, key) => `${prefix}${ws}"${key}":`,
  );
  s = s.replace(/,(\s*[}\]])/g, "$1");
  return s;
}
