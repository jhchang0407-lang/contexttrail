/**
 * PRD-0027 / THO-227 — deterministic nav/sidebar parser.
 *
 * One pure entry function per docs-config format produces a `NavGraph`
 * whose entries describe per-doc nav metadata. The entry function
 * `parseNavConfig` walks a corpus root, dispatches to per-format
 * sub-parsers, merges their results deterministically, and returns the
 * graph.
 *
 * Design constraints:
 *
 *   - Tolerant: missing config → empty graph; malformed config →
 *     skip-and-log the offending sub-parser; one parser failure never
 *     blocks the others.
 *   - Deterministic: same corpus, same graph. Sub-parsers produce
 *     entries in a stable order; the merge step de-duplicates by
 *     `source_path` with a fixed precedence (explicit nav config wins
 *     over README-as-section-index, which wins over frontmatter).
 *   - No new score-component coefficients enter the system from this
 *     module. The graph is consumed by the existing alias substrate /
 *     overview-owner-score path in slice 27.1.3.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, sep } from "node:path";
import {
  parseVitePressConfig,
  type VitePressParseInput,
} from "./nav-parser/vitepress.js";
import {
  parseDocusaurusCategory,
  parseDocusaurusSidebar,
  type DocusaurusParseInput,
} from "./nav-parser/docusaurus.js";
import { parseMkDocsNav } from "./nav-parser/mkdocs.js";
import { parseFrontmatterSidebar } from "./nav-parser/frontmatter.js";
import { detectReadmeSectionIndex } from "./nav-parser/readme-as-index.js";

export type NavEntry = {
  /** Forward-slashed path relative to the corpus root, e.g.
   *  `docs/server/overview.md`. */
  source_path: string;
  /** Stable section key the doc belongs to in nav, e.g. `"server"`,
   *  `"guide"`. Always non-empty; falls back to the parent directory
   *  when the format does not name the section explicitly. */
  nav_section_id: string;
  /** 1-indexed order of the entry within its section. 1 means
   *  "first / landing entry." */
  nav_position: number;
  /** The label the nav uses for this doc (often more canonical than
   *  the doc's title). When the format does not declare a label the
   *  filename stem is used. */
  nav_label: string;
  /** True iff this is the first entry in a multi-entry section. */
  is_nav_landing: boolean;
  /** Raw parser origin used for explain/debug provenance. */
  nav_origin?: NavOrigin;
  /** Trust class used by ranking consumers. */
  nav_provenance?: NavProvenance;
};

export type NavGraph = {
  entries: NavEntry[];
};

/** Origin tag attached to sub-parser entries before merge so the merge
 *  step can apply precedence deterministically. Higher numeric values
 *  win on conflict. */
export type NavOrigin =
  | "frontmatter"
  | "readme_as_index"
  | "mkdocs"
  | "docusaurus_category"
  | "docusaurus_sidebar"
  | "vitepress";

export type NavProvenance = "explicit_config" | "frontmatter" | "structural";

const ORIGIN_PRECEDENCE: Record<NavOrigin, number> = {
  frontmatter: 1,
  readme_as_index: 2,
  mkdocs: 3,
  docusaurus_category: 4,
  docusaurus_sidebar: 5,
  vitepress: 6,
};

export type RawNavEntry = NavEntry & { origin: NavOrigin };

function navProvenanceForOrigin(origin: NavOrigin): NavProvenance {
  if (origin === "frontmatter") return "frontmatter";
  if (origin === "readme_as_index") return "structural";
  return "explicit_config";
}

/** Pure merge step: collapse multiple raw entries per source path into
 *  one canonical entry, picking the highest-precedence origin. Stable
 *  ordering is alphabetical by `source_path` so callers iterate
 *  deterministically.
 *
 *  Exposed for tests; `parseNavConfig` calls this internally. */
export function mergeRawNavEntries(raw: RawNavEntry[]): NavGraph {
  const winners = new Map<string, RawNavEntry>();
  for (const entry of raw) {
    const existing = winners.get(entry.source_path);
    if (
      !existing ||
      ORIGIN_PRECEDENCE[entry.origin] > ORIGIN_PRECEDENCE[existing.origin]
    ) {
      winners.set(entry.source_path, entry);
    }
  }
  const entries: NavEntry[] = Array.from(winners.values())
    .map(({ origin, ...rest }) => ({
      ...rest,
      nav_origin: origin,
      nav_provenance: navProvenanceForOrigin(origin),
    }))
    .sort((a, b) => (a.source_path < b.source_path ? -1 : a.source_path > b.source_path ? 1 : 0));
  return { entries };
}

/** Recompute `nav_position` and `is_nav_landing` after the merge so
 *  precedence between origins doesn't leave gaps. Sections with a
 *  single entry never get the landing flag — landing is meaningful
 *  only when there are siblings to lead. */
export function renumberWithinSections(graph: NavGraph): NavGraph {
  const bySection = new Map<string, NavEntry[]>();
  for (const e of graph.entries) {
    const arr = bySection.get(e.nav_section_id) ?? [];
    arr.push(e);
    bySection.set(e.nav_section_id, arr);
  }
  const out: NavEntry[] = [];
  for (const [, arr] of bySection) {
    arr.sort((a, b) => a.nav_position - b.nav_position || (a.source_path < b.source_path ? -1 : 1));
    for (let i = 0; i < arr.length; i += 1) {
      const e = arr[i]!;
      const provenance = e.nav_provenance;
      const explicitConfigLanding =
        provenance === "explicit_config" && arr.length > 1 && i === 0;
      const frontmatterLanding =
        provenance === "frontmatter" && e.is_nav_landing === true && arr.length > 1;
      out.push({
        ...e,
        nav_position: i + 1,
        is_nav_landing: explicitConfigLanding || frontmatterLanding,
      });
    }
  }
  out.sort((a, b) => (a.source_path < b.source_path ? -1 : a.source_path > b.source_path ? 1 : 0));
  return { entries: out };
}

/** Walk the corpus root, gather raw entries from every sub-parser, and
 *  merge. The corpus root is the directory the importer treats as the
 *  root of the documentation tree (typically the repo root). */
export function parseNavConfig(corpus_root: string): NavGraph {
  if (!corpus_root || !existsSync(corpus_root)) {
    return { entries: [] };
  }
  const raw: RawNavEntry[] = [];

  const markdownFiles = listMarkdownFiles(corpus_root);

  // Sub-parser: VitePress.
  const vitepressInput = readVitePressInputs(corpus_root);
  if (vitepressInput) {
    safePush(raw, () =>
      parseVitePressConfig(vitepressInput).map((e) => ({ ...e, origin: "vitepress" })),
    );
  }

  // Sub-parser: Docusaurus sidebars.
  const docusaurusInput = readDocusaurusInputs(corpus_root);
  if (docusaurusInput) {
    safePush(raw, () =>
      parseDocusaurusSidebar(docusaurusInput).map((e) => ({
        ...e,
        origin: "docusaurus_sidebar",
      })),
    );
  }

  // Sub-parser: Docusaurus _category_.json (one per directory; merged with
  // the directory's markdown contents to position siblings).
  for (const cat of readDocusaurusCategoryFiles(corpus_root, markdownFiles)) {
    safePush(raw, () =>
      parseDocusaurusCategory(cat).map((e) => ({ ...e, origin: "docusaurus_category" })),
    );
  }

  // Sub-parser: MkDocs.
  const mkdocsRaw = readMkDocsConfig(corpus_root);
  if (mkdocsRaw) {
    safePush(raw, () =>
      parseMkDocsNav(mkdocsRaw).map((e) => ({ ...e, origin: "mkdocs" })),
    );
  }

  // Sub-parser: README-as-section-index (purely structural).
  safePush(raw, () =>
    detectReadmeSectionIndex(markdownFiles).map((e) => ({
      ...e,
      origin: "readme_as_index",
    })),
  );

  // Sub-parser: frontmatter sidebar_position / sidebar_label.
  for (const md of markdownFiles) {
    const abs = join(corpus_root, md.split("/").join(sep));
    let raw_text = "";
    try {
      raw_text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    safePush(raw, () =>
      parseFrontmatterSidebar({ source_path: md, raw: raw_text }).map((e) => ({
        ...e,
        origin: "frontmatter",
      })),
    );
  }

  return renumberWithinSections(mergeRawNavEntries(raw));
}

// ──────────────────────────────────────────────────────────────────────────
// Sub-parser input helpers — kept small and side-effect-only here so the
// per-format modules stay pure (string in → entries out) for unit testing.
// ──────────────────────────────────────────────────────────────────────────

function safePush(out: RawNavEntry[], fn: () => RawNavEntry[]): void {
  try {
    const got = fn();
    for (const e of got) out.push(e);
  } catch {
    // Skip-and-log is captured in the design but we deliberately keep
    // the parser silent for now — any logger hook would couple this
    // module to import-time logging. Future work: a shared logger.
  }
}

function listMarkdownFiles(corpus_root: string): string[] {
  const out: string[] = [];
  const SKIP_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    ".vitepress/cache",
    ".vitepress/dist",
    ".docusaurus",
    ".cache",
  ]);
  const walk = (abs: string, rel: string) => {
    let entries;
    try {
      entries = readdirSync(abs);
    } catch {
      return;
    }
    for (const name of entries) {
      const childAbs = join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      if (SKIP_DIRS.has(name) || SKIP_DIRS.has(childRel)) continue;
      let st;
      try {
        st = statSync(childAbs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(childAbs, childRel);
      } else if (/\.(md|mdx|markdown)$/i.test(name)) {
        out.push(childRel);
      }
    }
  };
  walk(corpus_root, "");
  out.sort();
  return out;
}

function readVitePressInputs(corpus_root: string): VitePressParseInput | null {
  const candidates = [
    "docs/.vitepress/config.ts",
    "docs/.vitepress/config.mts",
    "docs/.vitepress/config.cts",
    "docs/.vitepress/config.js",
    "docs/.vitepress/config.mjs",
    "docs/.vitepress/config.cjs",
    ".vitepress/config.ts",
    ".vitepress/config.mts",
    ".vitepress/config.cts",
    ".vitepress/config.js",
    ".vitepress/config.mjs",
    ".vitepress/config.cjs",
  ];
  for (const candidate of candidates) {
    const abs = join(corpus_root, candidate);
    if (!existsSync(abs)) continue;
    try {
      const raw = readFileSync(abs, "utf8");
      return { config_text: raw, config_path: candidate };
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function readDocusaurusInputs(corpus_root: string): DocusaurusParseInput | null {
  const candidates = [
    "sidebars.ts",
    "sidebars.js",
    "sidebars.mjs",
    "sidebars.cjs",
    "docusaurus.config.ts",
    "docusaurus.config.js",
  ];
  for (const candidate of candidates) {
    const abs = join(corpus_root, candidate);
    if (!existsSync(abs)) continue;
    try {
      const raw = readFileSync(abs, "utf8");
      return { config_text: raw, config_path: candidate };
    } catch {
      // try next
    }
  }
  return null;
}

function readDocusaurusCategoryFiles(
  corpus_root: string,
  all_markdown: string[],
): Array<{
  category_path: string;
  category_text: string;
  directory_markdown: string[];
}> {
  // _category_.json files live next to a group of docs. Walk every
  // directory that contains markdown and check.
  const dirs = new Set<string>();
  for (const md of all_markdown) {
    const lastSlash = md.lastIndexOf("/");
    const dir = lastSlash === -1 ? "" : md.slice(0, lastSlash);
    dirs.add(dir);
  }
  const out: Array<{
    category_path: string;
    category_text: string;
    directory_markdown: string[];
  }> = [];
  for (const dir of Array.from(dirs).sort()) {
    const catRel = dir ? `${dir}/_category_.json` : "_category_.json";
    const catAbs = join(corpus_root, catRel.split("/").join(sep));
    if (!existsSync(catAbs)) continue;
    let text: string;
    try {
      text = readFileSync(catAbs, "utf8");
    } catch {
      continue;
    }
    const directoryMarkdown = all_markdown
      .filter((md) => {
        const slash = md.lastIndexOf("/");
        const mdDir = slash === -1 ? "" : md.slice(0, slash);
        return mdDir === dir;
      })
      .sort();
    out.push({
      category_path: catRel,
      category_text: text,
      directory_markdown: directoryMarkdown,
    });
  }
  return out;
}

function readMkDocsConfig(corpus_root: string): string | null {
  for (const candidate of ["mkdocs.yml", "mkdocs.yaml"]) {
    const abs = join(corpus_root, candidate);
    if (!existsSync(abs)) continue;
    try {
      return readFileSync(abs, "utf8");
    } catch {
      continue;
    }
  }
  return null;
}
