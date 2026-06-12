/**
 * README-as-section-index detector.
 *
 * Pure function over the corpus's markdown file list. For each
 * directory that contains a README.md (or index.md) plus other
 * markdown files, treats the README as the section's landing entry.
 * The directory's name is the section id; nav_label is the filename
 * stem; nav_position is 1.
 *
 * The merge step in `parseNavConfig` lets explicit nav-config entries
 * override these heuristic ones.
 */
import type { NavEntry } from "../nav-parser.js";

const INDEX_BASENAMES = new Set(["readme", "index", "_index"]);

export function detectReadmeSectionIndex(all_markdown: string[]): NavEntry[] {
  if (all_markdown.length === 0) return [];

  // Group docs by parent directory.
  const byDir = new Map<string, string[]>();
  for (const md of all_markdown) {
    const slash = md.lastIndexOf("/");
    const dir = slash === -1 ? "" : md.slice(0, slash);
    const arr = byDir.get(dir) ?? [];
    arr.push(md);
    byDir.set(dir, arr);
  }

  const out: NavEntry[] = [];
  for (const [dir, files] of byDir) {
    if (files.length < 2) continue;
    const indexFile = files.find((f) => isIndexFile(f));
    if (!indexFile) continue;
    const sectionId = sectionIdFromDir(dir);
    const sortedFiles = [...files].sort();
    let position = 0;
    for (const f of sortedFiles) {
      position += 1;
      out.push({
        source_path: f,
        nav_section_id: sectionId,
        nav_position: f === indexFile ? 1 : position + 1,
        nav_label: filenameStem(f),
        is_nav_landing: false,
      });
    }
  }
  return out;
}

function isIndexFile(path: string): boolean {
  const leaf = path.split("/").pop() ?? path;
  const stem = leaf.replace(/\.(md|mdx|markdown)$/i, "").toLowerCase();
  return INDEX_BASENAMES.has(stem);
}

function filenameStem(path: string): string {
  const leaf = path.split("/").pop() ?? path;
  return leaf.replace(/\.(md|mdx|markdown)$/i, "") || leaf;
}

function sectionIdFromDir(dir: string): string {
  if (!dir) return "root";
  const parts = dir.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "root";
}
