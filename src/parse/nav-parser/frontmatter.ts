/**
 * Frontmatter sidebar_position / sidebar_label sub-parser. Pure:
 * takes a single file's raw text and source path, returns at most
 * one nav entry derived from the file's frontmatter.
 *
 * The parser does not group siblings here — it just tags the entry
 * with its parent directory as the section. Position is
 * frontmatter-declared; the merge / renumber pass in the entry
 * function settles ordering across siblings.
 */
import matter from "gray-matter";
import type { NavEntry } from "../nav-parser.js";

export type FrontmatterParseInput = {
  source_path: string;
  raw: string;
};

export function parseFrontmatterSidebar(input: FrontmatterParseInput): NavEntry[] {
  if (!input.raw) return [];
  let parsed;
  try {
    parsed = matter(input.raw);
  } catch {
    return [];
  }
  const fm = (parsed.data ?? {}) as Record<string, unknown>;
  const positionRaw = fm.sidebar_position;
  const labelRaw = fm.sidebar_label;

  const position = normalizePosition(positionRaw);
  const label = typeof labelRaw === "string" ? labelRaw.trim() : "";
  if (position === null && !label) return [];

  const sectionId = sectionIdFromPath(input.source_path);
  const navLabel = label || filenameStem(input.source_path);

  return [
    {
      source_path: input.source_path,
      nav_section_id: sectionId,
      nav_position: position ?? Number.MAX_SAFE_INTEGER,
      nav_label: navLabel,
      // Renumber pass overwrites this; we provide a sane default for
      // single-entry sections so partial outputs (when only frontmatter
      // exists) still satisfy the type.
      is_nav_landing: position === 1,
    },
  ];
}

function normalizePosition(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string") {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return Math.floor(n);
  }
  return null;
}

function sectionIdFromPath(source_path: string): string {
  const parts = source_path.split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  // Drop the filename; the section is the immediate parent directory.
  return parts[parts.length - 2] ?? "";
}

function filenameStem(source_path: string): string {
  const leaf = source_path.split("/").pop() ?? source_path;
  return leaf.replace(/\.(md|mdx|markdown)$/i, "") || leaf;
}
