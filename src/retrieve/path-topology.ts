/**
 * Deterministic path-topology extractors.
 *
 * Five pure functions over a source path (plus the corpus-wide path set
 * for landing detection) that produce additive optional fields on
 * SourceProfile. No filesystem reads beyond the inputs explicitly passed
 * in. No author-mandatory frontmatter, no AI inference, no schema bump.
 *
 * Each rule generalizes outside the 121-case real corpus via synthetic
 * property tests certified at Wilson lower-95 ≥ 95%.
 */

const MARKDOWN_EXT_REGEX = /\.(md|mdx|markdown)$/i;
const INDEX_BASENAMES = new Set(["index", "readme", "_index"]);

const PACKAGE_MARKERS = ["packages", "apps", "crates", "sdk"] as const;

const LITERAL_VERSION_MARKERS = new Set([
  "next",
  "beta",
  "latest",
  "legacy",
  "deprecated",
]);
const VERSION_VN_REGEX = /^v\d+(?:\.x)?$/;
const VERSION_NX_REGEX = /^\d+\.x$/;

/**
 * Normalize a path to forward-slash segments with `.` segments dropped.
 * Empty segments and `..` segments are NOT dropped here — callers that
 * compute depth want them as segments to count, while landing detection
 * never sees them in well-formed corpus paths.
 */
function normalizeSegments(path: string): string[] {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .filter((seg) => seg !== "" && seg !== ".");
}

function stripImportRoot(path: string, importRoot: string): string {
  if (!importRoot) return path;
  const normalizedRoot = importRoot.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalizedRoot) return path;
  const normalizedPath = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  ) {
    return normalizedPath.slice(normalizedRoot.length).replace(/^\/+/, "");
  }
  return path;
}

function basename(segments: string[]): string {
  return segments[segments.length - 1] ?? "";
}

function basenameStem(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

/**
 * Directory depth under the import root, counted by path segments.
 * Filename does not count. `mocking.md → 0`, `guide/mocking.md → 1`,
 * `guide/mocking/modules.md → 2`.
 */
export function computePathDepth(
  source_path: string,
  import_root: string,
): number {
  const stripped = stripImportRoot(source_path, import_root);
  const segments = normalizeSegments(stripped);
  return Math.max(0, segments.length - 1);
}

/**
 * True iff (basename, case-insensitive) ∈ `{index, readme, _index}` AND
 * (extension, case-insensitive) ∈ `{.md, .mdx, .markdown}`. Rejects
 * `index.txt`, extensionless `index`, `INDEX.html`.
 */
export function detectIsIndexFile(source_path: string): boolean {
  const segments = normalizeSegments(source_path);
  const leaf = basename(segments);
  if (!leaf) return false;
  if (!MARKDOWN_EXT_REGEX.test(leaf)) return false;
  const stem = basenameStem(leaf);
  return INDEX_BASENAMES.has(stem.toLowerCase());
}

/**
 * Section-landing detector. Four deterministic cases:
 *
 *   (i) `Foo.md` AND `Foo/` directory exist in same parent → `Foo.md`.
 *   (ii) `Foo/<index|README|_index>.md` exists AND no sibling `Foo.md`
 *        → that index file.
 *   (iii) both `Foo.md` AND `Foo/index.md` exist → parent `.md` wins;
 *        the index is not flagged.
 *   (iv) child file alone → not flagged.
 */
export function detectIsSectionLanding(
  source_path: string,
  all_source_paths: Set<string>,
): boolean {
  const segments = normalizeSegments(source_path);
  if (segments.length === 0) return false;
  const leaf = basename(segments);
  if (!MARKDOWN_EXT_REGEX.test(leaf)) return false;

  const parents = segments.slice(0, -1); // dir segments
  const stem = basenameStem(leaf);

  // Case (ii / iii) — this is an Foo/index.md kind of file.
  if (INDEX_BASENAMES.has(stem.toLowerCase())) {
    if (parents.length === 0) return false; // root index has no parent section
    // Sibling at parent level: <grandparent>/<parent>.md (any markdown extension).
    const grandparent = parents.slice(0, -1);
    const parentName = parents[parents.length - 1] ?? "";
    if (!parentName) return false;
    if (siblingMarkdownExists(grandparent, parentName, all_source_paths)) {
      // Case (iii): parent .md wins; index is not the landing.
      return false;
    }
    // Case (ii): index alone is the landing.
    return true;
  }

  // Case (i) / (iv) — this is a Foo.md style file. Landing iff a sibling
  // directory `<parents>/<stem>/` contains any path.
  return directoryExistsInCorpus(parents, stem, all_source_paths);
}

function siblingMarkdownExists(
  parents: string[],
  name: string,
  all_source_paths: Set<string>,
): boolean {
  const prefix = parents.length > 0 ? `${parents.join("/")}/` : "";
  for (const ext of [".md", ".mdx", ".markdown"]) {
    if (all_source_paths.has(`${prefix}${name}${ext}`)) return true;
  }
  // Case-insensitive fallback: scan for any path whose normalized form
  // matches. Markdown extensions are typically lowercase but some corpora
  // mix case (e.g. README.MD) — landing detection should not depend on
  // exact byte equality.
  const lowerCandidates = new Set(
    [".md", ".mdx", ".markdown"].map(
      (ext) => `${prefix}${name}${ext}`.toLowerCase(),
    ),
  );
  for (const path of all_source_paths) {
    if (lowerCandidates.has(path.toLowerCase())) return true;
  }
  return false;
}

function directoryExistsInCorpus(
  parents: string[],
  name: string,
  all_source_paths: Set<string>,
): boolean {
  const dirPrefix =
    parents.length > 0 ? `${parents.join("/")}/${name}/` : `${name}/`;
  const lowerDirPrefix = dirPrefix.toLowerCase();
  for (const path of all_source_paths) {
    if (path === undefined) continue;
    if (path.startsWith(dirPrefix)) return true;
    if (path.toLowerCase().startsWith(lowerDirPrefix)) return true;
  }
  return false;
}

/**
 * Capture `<name>` from `packages/<name>/`, `apps/<name>/`,
 * `crates/<name>/`, or `sdk/<name>/`. First-match (outermost) wins on
 * nested patterns. Returns null if no marker is present on a segment
 * boundary.
 */
export function detectPackageSegment(source_path: string): string | null {
  const segments = normalizeSegments(source_path);
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i];
    const next = segments[i + 1];
    if (!seg || !next) continue;
    if ((PACKAGE_MARKERS as readonly string[]).includes(seg) && next.length > 0) {
      return next;
    }
  }
  return null;
}

/**
 * Match a version-shaped segment on a path-segment boundary. Recognized
 * forms: `vN`, `vN.x`, `N.x`, or one of the literal markers
 * `{next, beta, latest, legacy, deprecated}`. Outer-segment wins on
 * multiple markers. Returns null if nothing matches.
 */
export function detectVersionSegment(source_path: string): string | null {
  const segments = normalizeSegments(source_path);
  // Skip the leaf — version markers should be a directory segment, not
  // the filename. (e.g. `next.md` should not classify the doc as
  // belonging to the "next" version channel.)
  const dirSegments = segments.slice(0, -1);
  for (const seg of dirSegments) {
    const lower = seg.toLowerCase();
    if (LITERAL_VERSION_MARKERS.has(lower)) return lower;
    if (VERSION_VN_REGEX.test(lower)) return lower;
    if (VERSION_NX_REGEX.test(lower)) return lower;
  }
  return null;
}
