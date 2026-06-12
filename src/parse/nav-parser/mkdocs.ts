/**
 * MkDocs `mkdocs.yml` sub-parser.
 *
 * MkDocs declares its nav as a YAML list. Each entry is either:
 *   - "Label: path/to/doc.md"   (object with single key)
 *   - "path/to/doc.md"          (bare string, label inferred from first H1 — we use filename stem)
 *   - "Section: [ ...children ]" (nested list)
 *
 * Output paths are relative to the `docs_dir` (defaults to `docs/`).
 */
import { parse as parseYAML } from "yaml";
import type { NavEntry } from "../nav-parser.js";

export function parseMkDocsNav(config_text: string): NavEntry[] {
  if (!config_text || !config_text.trim()) return [];
  let doc: unknown;
  try {
    doc = parseYAML(config_text);
  } catch {
    return [];
  }
  if (!doc || typeof doc !== "object") return [];
  const root = doc as Record<string, unknown>;
  const navRaw = root.nav;
  if (!Array.isArray(navRaw)) return [];

  const docsDir =
    typeof root.docs_dir === "string" && root.docs_dir.trim()
      ? root.docs_dir.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
      : "docs";

  const out: NavEntry[] = [];
  walkNav(navRaw, docsDir, "root", out);
  return out;
}

function walkNav(
  list: unknown[],
  docsDir: string,
  sectionId: string,
  out: NavEntry[],
): void {
  let position = 0;
  for (const item of list) {
    if (typeof item === "string") {
      const path = joinDocs(docsDir, item);
      if (!path) continue;
      position += 1;
      out.push({
        source_path: path,
        nav_section_id: sectionId,
        nav_position: position,
        nav_label: filenameStem(path),
        is_nav_landing: false,
      });
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const obj = item as Record<string, unknown>;
      const keys = Object.keys(obj);
      if (keys.length !== 1) continue;
      const label = keys[0]!;
      const value = obj[label];
      if (typeof value === "string") {
        const path = joinDocs(docsDir, value);
        if (!path) continue;
        position += 1;
        out.push({
          source_path: path,
          nav_section_id: sectionId,
          nav_position: position,
          nav_label: label,
          is_nav_landing: false,
        });
      } else if (Array.isArray(value)) {
        // Nested section. Use the label as the section id for children.
        // Position is per-section; reset by recursing into walkNav.
        walkNav(value, docsDir, normalizeSectionId(label), out);
      }
    }
  }
}

function joinDocs(docsDir: string, path: string): string | null {
  if (!path || typeof path !== "string") return null;
  const cleaned = path.replace(/\\/g, "/").trim();
  if (!cleaned) return null;
  // Strip leading ./ but preserve a leading docs_dir segment if already present.
  const noDot = cleaned.replace(/^\.\//, "");
  if (noDot.startsWith(`${docsDir}/`) || noDot === docsDir) return noDot;
  return docsDir ? `${docsDir}/${noDot}` : noDot;
}

function filenameStem(path: string): string {
  const leaf = path.split("/").pop() ?? path;
  return leaf.replace(/\.(md|mdx|markdown)$/i, "") || leaf;
}

function normalizeSectionId(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    || "section";
}
