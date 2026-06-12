/**
 * VitePress config sub-parser.
 *
 * VitePress config is a TS/JS module exporting `defineConfig({...})`
 * with a nested `themeConfig.sidebar` declaration. We extract the
 * sidebar object literal pragmatically (the same approach as the
 * Docusaurus sidebar sub-parser): regex-locate the sidebar key, walk
 * the bracket-balanced literal, and JSON-parse a permissive
 * conversion.
 *
 * The sidebar is either:
 *   - an array (single sidebar applied everywhere) —
 *       [{ text, link }, { text, items: [...] }, ...]
 *   - an object keyed by URL prefix —
 *       { '/server/': [...], '/client/': [...] }
 */
import type { NavEntry } from "../nav-parser.js";

export type VitePressParseInput = {
  config_text: string;
  config_path: string;
};

export function parseVitePressConfig(input: VitePressParseInput): NavEntry[] {
  const stripped = stripComments(input.config_text);
  const sidebarLiteral = extractKeyLiteral(stripped, "sidebar");
  if (!sidebarLiteral) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsToJson(sidebarLiteral));
  } catch {
    return [];
  }
  if (parsed === null || parsed === undefined) return [];

  const out: NavEntry[] = [];
  if (Array.isArray(parsed)) {
    walkVitepressArray(parsed, "root", "/", out);
  } else if (typeof parsed === "object") {
    for (const [prefix, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (Array.isArray(value)) {
        walkVitepressArray(value, normalizeSectionId(prefix), prefix, out);
      }
    }
  }
  return out;
}

function walkVitepressArray(
  arr: unknown[],
  sectionId: string,
  baseLink: string,
  out: NavEntry[],
): void {
  let position = 0;
  for (const item of arr) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const text = typeof obj.text === "string" ? obj.text.trim() : "";
    const link = typeof obj.link === "string" ? obj.link.trim() : "";
    const items = Array.isArray(obj.items) ? obj.items : null;
    if (link) {
      position += 1;
      out.push({
        source_path: linkToPath(link, baseLink),
        nav_section_id: sectionId,
        nav_position: position,
        nav_label: text || filenameStem(linkToPath(link, baseLink)),
        is_nav_landing: false,
      });
    }
    if (items) {
      const childSection = text ? normalizeSectionId(text) : sectionId;
      walkVitepressArray(items, childSection, baseLink, out);
    }
  }
}

function linkToPath(link: string, baseLink: string): string {
  let url = link.replace(/\\/g, "/").trim();
  if (!url) return "";
  // Strip query / fragment.
  url = url.replace(/[?#].*$/, "");
  // Resolve relative against baseLink.
  if (!url.startsWith("/")) {
    const base = baseLink.endsWith("/") ? baseLink : `${baseLink}/`;
    url = `${base}${url}`;
  }
  // Drop leading slash and treat as docs-relative.
  url = url.replace(/^\/+/, "");
  if (!url) return "";
  // Default to `.md` extension; preserve explicit extensions.
  if (!/\.(md|mdx|markdown)$/i.test(url)) {
    if (url.endsWith("/")) {
      url = `${url}index.md`;
    } else {
      url = `${url}.md`;
    }
  }
  // VitePress configs typically live in `docs/.vitepress`, so links
  // like `/server/overview` correspond to `docs/server/overview.md`.
  if (!url.startsWith("docs/")) {
    url = `docs/${url}`;
  }
  return url;
}

function filenameStem(path: string): string {
  const leaf = path.split("/").pop() ?? path;
  return leaf.replace(/\.(md|mdx|markdown)$/i, "") || leaf;
}

function normalizeSectionId(label: string): string {
  return (
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "section"
  );
}

function stripComments(s: string): string {
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
      i = eol === -1 ? s.length : eol;
      continue;
    }
    out += s[i];
    i += 1;
  }
  return out;
}

function extractKeyLiteral(s: string, key: string): string | null {
  const re = new RegExp(`\\b${key}\\s*:`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(s)) !== null) {
    let i = match.index + match[0].length;
    while (i < s.length && (s[i] === " " || s[i] === "\t" || s[i] === "\n")) i += 1;
    const open = s[i];
    if (open !== "{" && open !== "[") continue;
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inStr: '"' | "'" | "`" | null = null;
    let escaped = false;
    for (let j = i; j < s.length; j += 1) {
      const ch = s[j]!;
      if (inStr) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inStr = ch;
        continue;
      }
      if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) return s.slice(i, j + 1);
      }
    }
  }
  return null;
}

function jsToJson(literal: string): string {
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
