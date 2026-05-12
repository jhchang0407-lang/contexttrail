/**
 * PRD-0027 follow-up — nav-graph candidate expansion for assembly.
 *
 * Structural parallel to `expandLinksKHops` (markdown link graph) and
 * `expandCodeImportsKHops` (TS import graph), but for nav siblings.
 *
 * **Motivating finding (2026-05-11 generalization test):** the link-
 * traversal lever fires only on link-heavy corpora. ContextTrail has
 * 324 internal markdown links; valibot has 0, biome has 0, prisma has
 * 0. The workflow-assembly metric on valibot was 73.3% — limited by
 * raw retrieval — because there were no inline cross-references for
 * traversal to walk. Framework-driven docs (vitepress / mkdocs /
 * docusaurus) express doc-to-doc relationships through nav config,
 * not body links.
 *
 * PRD-0027 already extracts those nav relationships at import time
 * into `SourceProfile.nav_section_id` / `nav_position` / `is_nav_landing` /
 * `nav_provenance`. This module is the assembly-layer use of that data:
 * when a doc surfaces, also surface its nav siblings (docs in the same
 * `nav_section_id`) — universal across the four supported nav formats.
 *
 * Trust boundary: traversal only fires when both seed and neighbour
 * carry **`nav_provenance="explicit_config"`** (sidebars.ts, mkdocs.yml,
 * _category_.json) or **`"frontmatter"`** (per-doc sidebar_position).
 * Structural fallback (`README-as-section-index`) is intentionally NOT
 * traversed — the slice-27 rollback already warned that weak inferred
 * structure becomes ranking authority when treated uniformly with
 * explicit config. Same trust-vs-presence gate applies here.
 */

export type NavGraphFacts = {
  source_path: string;
  nav_section_id?: string | null;
  nav_provenance?: "explicit_config" | "frontmatter" | "structural" | "none" | null;
};

export type ExpandNavSiblingsArgs = {
  seeds: Iterable<string>;
  /**
   * All source profiles in the corpus, projected to just the nav fields
   * we need. Pre-loading once is cheaper than per-seed lookups.
   */
  navFacts: ReadonlyArray<NavGraphFacts>;
  /** Cap the per-section expansion so a 50-doc section doesn't flood the pack. */
  maxSiblingsPerSection?: number;
  /**
   * When true (default), fall back to **immediate-parent-directory
   * grouping** for docs where `nav_section_id` is null. This is
   * structurally different from the rejected README-as-section-index
   * heuristic: directory containment is a hard filesystem fact, not an
   * inferred role. Two docs in the same directory ARE siblings in any
   * possible layout — there is no false-positive risk from uniform
   * application. Most OSS docs corpora ship without their framework's
   * nav config inside the importable doc tree (valibot's
   * vitepress config, biome's astro config, etc.), so this fallback
   * is the only nav signal those corpora provide.
   */
  directoryFallback?: boolean;
};

const DEFAULT_MAX_SIBLINGS = 8;
const TRUSTED_PROVENANCE = new Set(["explicit_config", "frontmatter"]);

function isTrusted(prov: NavGraphFacts["nav_provenance"]): boolean {
  return prov != null && TRUSTED_PROVENANCE.has(prov);
}

/**
 * Section identifier from path structure when explicit nav data is
 * absent. For an index/README file (`foo/bar/index.md`), the section
 * is the parent's parent (`foo/`) so the index siblings other docs in
 * the same logical group. For a plain file (`foo/bar/baz.md`), the
 * section is the parent (`foo/bar/`). Returns null for top-level files
 * (no implicit grouping at the corpus root).
 */
function sectionFromPath(path: string): string | null {
  const segments = path.split("/");
  if (segments.length < 2) return null;
  const leaf = segments[segments.length - 1] ?? "";
  const isIndex = /^(index|README)\.(md|mdx)$/i.test(leaf);
  if (isIndex) {
    // index.md's siblings are docs that share its grandparent dir.
    if (segments.length < 3) return null;
    return segments.slice(0, segments.length - 2).join("/") + "/";
  }
  return segments.slice(0, segments.length - 1).join("/") + "/";
}

/**
 * Given a seed set of source paths, return the union of seeds plus
 * docs that share a (trusted-provenance) `nav_section_id` with any
 * seed. Only one expansion step — nav siblings of siblings would over-
 * expand; the same-section rule already captures the assembly need
 * (when one doc in a section surfaces, the section is in play).
 *
 * Returns the seed paths first (in iteration order) then nav-pulled
 * paths in nav_section_id order. Caller decides ordering / scoring.
 */
export function expandNavSiblings(args: ExpandNavSiblingsArgs): Set<string> {
  const {
    seeds,
    navFacts,
    maxSiblingsPerSection = DEFAULT_MAX_SIBLINGS,
    directoryFallback = true,
  } = args;
  const seedSet = new Set(seeds);
  const out = new Set(seedSet);

  // Build a stable section key per doc: trusted nav data first,
  // directory-grouping fallback otherwise (when enabled).
  const sectionKey = (f: NavGraphFacts): string | null => {
    if (f.nav_section_id && isTrusted(f.nav_provenance)) return f.nav_section_id;
    if (directoryFallback) return sectionFromPath(f.source_path);
    return null;
  };

  // Index docs by section
  const bySection = new Map<string, NavGraphFacts[]>();
  const factsByPath = new Map<string, NavGraphFacts>();
  for (const f of navFacts) {
    factsByPath.set(f.source_path, f);
    const key = sectionKey(f);
    if (!key) continue;
    const list = bySection.get(key) ?? [];
    list.push(f);
    bySection.set(key, list);
  }

  // For each seed, find its section, surface siblings.
  const sectionsAlreadyExpanded = new Set<string>();
  for (const seedPath of seedSet) {
    const seedFacts = factsByPath.get(seedPath) ?? {
      source_path: seedPath,
      nav_section_id: null,
      nav_provenance: null,
    };
    const key = sectionKey(seedFacts);
    if (!key) continue;
    if (sectionsAlreadyExpanded.has(key)) continue;
    sectionsAlreadyExpanded.add(key);
    const siblings = bySection.get(key) ?? [];
    let added = 0;
    for (const sib of siblings) {
      if (added >= maxSiblingsPerSection) break;
      if (out.has(sib.source_path)) continue;
      out.add(sib.source_path);
      added += 1;
    }
  }
  return out;
}
