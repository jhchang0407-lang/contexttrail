/**
 * Deterministic SourceProfile v1 builder (PRD-0012 / Slice 2 v2).
 *
 * Inputs: an imported markdown source's raw text, plus already-resolved
 * doc_role/role_source and chunk-derived counts. No index-time LLM calls.
 *
 * Output: a SourceProfile shaped for retrieval-index storage and source-level
 * reranking. Final Context Packs continue to cite Doc Chunks and Cards only.
 */
import type { Root, Heading, Paragraph } from "mdast";
import { parse } from "./markdown.js";
import type {
  AliasKind,
  AliasOrigin,
  AliasConfidence,
  DocPurpose,
  HeadingOutlineEntry,
  NavMetadataOrigin,
  NavMetadataProvenance,
  PurposeSource,
  SourceAlias,
  SourceProfile,
  SummarySource,
  QuestionsAnsweredSource,
} from "../types/source-profile.js";
import { DOC_PURPOSES } from "../types/source-profile.js";
import type { DocRole, RoleSource } from "../types/chunk.js";
import {
  computePathDepth,
  detectIsIndexFile,
  detectIsSectionLanding,
  detectPackageSegment,
  detectVersionSegment,
} from "../retrieve/path-topology.js";
import { extractHeadingAliases } from "../retrieve/heading-aliases.js";
import { extractCodeFenceEntities } from "../retrieve/code-fence-entities.js";
import type { NavGraph } from "./nav-parser.js";

const SUMMARY_BUDGET_CHARS = 480;
const QUESTION_PREFIXES = [
  "how", "why", "what", "when", "where", "which",
  "can", "should", "do", "does", "is", "are",
];

export type BuildSourceProfileArgs = {
  source_path: string;
  source: string;
  source_content_hash: string;
  indexed_at: string;
  doc_role: DocRole;
  role_source: RoleSource;
  chunk_count: number;
  token_count: number;
  /**
   * PRD-0023 / slice 23.2: corpus-wide source paths used to compute
   * `is_section_landing`. Optional — when omitted, the landing field
   * is left undefined (older callers that re-build a single profile
   * out-of-band and don't have the corpus on hand). All four other
   * topology fields require only the source path itself and are
   * always populated.
   */
  all_source_paths?: Set<string>;
  /**
   * PRD-0023 / slice 23.2: directory under which `path_depth` is
   * counted. Defaults to "" (count from the path's start). Existing
   * callers don't set this; future callers that mount the corpus
   * under a non-trivial root can override.
   */
  import_root?: string;
  /**
   * PRD-0027 / slice 27.1.2: corpus-wide nav graph produced by
   * `parseNavConfig` at import time. When supplied, the profile
   * builder looks up its source path and populates the four
   * additive `nav_*` fields. Older / out-of-band callers may leave
   * this undefined; the fields stay undefined in that case.
   */
  nav_graph?: NavGraph;
};

export function buildSourceProfile(args: BuildSourceProfileArgs): SourceProfile {
  const parsed = parse(args.source);
  const ast = parsed.ast;
  const fm = parsed.frontmatter ?? {};

  const h1 = extractH1(ast);
  const title = pickTitle(fm, h1, args.source_path);
  const headingOutline = extractHeadingOutline(ast);
  const intro = extractIntro(ast, parsed.body);
  const { summary, summary_source } = buildSummary({ title, h1, intro, fm });
  const { doc_purpose, purpose_source } = classifyPurpose({
    fm,
    source_path: args.source_path,
    title,
    headingOutline,
  });
  const aliases = extractAliases({
    source_path: args.source_path,
    fm,
    title,
    h1,
    headingOutline,
  });
  const { questions_answered, questions_answered_source } =
    extractQuestionsAnswered(headingOutline);

  const importRoot = args.import_root ?? "";
  const path_depth = computePathDepth(args.source_path, importRoot);
  const is_index_file = detectIsIndexFile(args.source_path);
  const is_section_landing = args.all_source_paths
    ? detectIsSectionLanding(args.source_path, args.all_source_paths)
    : undefined;
  const package_segment = detectPackageSegment(args.source_path);
  const version_segment = detectVersionSegment(args.source_path);
  const heading_aliases = extractHeadingAliases(headingOutline);
  const code_fence_entities = extractCodeFenceEntities(args.source);

  // PRD-0027 / slice 27.1.2: project the corpus-wide nav graph onto
  // this profile by source-path lookup. The four fields stay
  // undefined when no graph is supplied or no entry matches.
  let nav_section_id: string | null | undefined;
  let nav_position: number | null | undefined;
  let nav_label: string | null | undefined;
  let is_nav_landing: boolean | undefined;
  let nav_origin: NavMetadataOrigin | null | undefined;
  let nav_provenance: NavMetadataProvenance | null | undefined;
  if (args.nav_graph) {
    const entry = args.nav_graph.entries.find(
      (e) => e.source_path === args.source_path,
    );
    if (entry) {
      nav_section_id = entry.nav_section_id;
      nav_position = entry.nav_position;
      nav_label = entry.nav_label;
      is_nav_landing = entry.is_nav_landing;
      nav_origin = entry.nav_origin;
      nav_provenance = entry.nav_provenance;
    }
  }

  return {
    source_path: args.source_path,
    source_content_hash: args.source_content_hash,
    title,
    h1,
    intro,
    heading_outline: headingOutline,
    doc_role: args.doc_role,
    role_source: args.role_source,
    doc_purpose,
    purpose_source,
    aliases,
    summary,
    summary_source,
    questions_answered,
    questions_answered_source,
    chunk_count: args.chunk_count,
    token_count: args.token_count,
    indexed_at: args.indexed_at,
    path_depth,
    is_index_file,
    is_section_landing,
    package_segment,
    version_segment,
    heading_aliases,
    code_fence_entities,
    nav_section_id,
    nav_position,
    nav_label,
    is_nav_landing,
    nav_origin,
    nav_provenance,
  };
}

function headingText(node: Heading): string {
  return (node.children ?? [])
    .map((c: any) =>
      c.type === "text" || c.type === "inlineCode" ? c.value : "",
    )
    .join("")
    .trim();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function extractH1(ast: Root): string | null {
  for (const node of ast.children ?? []) {
    if (node.type === "heading" && node.depth === 1) {
      const t = headingText(node);
      return t || null;
    }
  }
  return null;
}

function pickTitle(
  fm: Record<string, unknown>,
  h1: string | null,
  source_path: string,
): string {
  const fmTitle = fm.title;
  if (typeof fmTitle === "string" && fmTitle.trim()) return fmTitle.trim();
  if (h1) return h1;
  const leaf = source_path.split(/[\\/]/).pop() ?? source_path;
  return leaf.replace(/\.[^.]+$/, "") || leaf;
}

function extractHeadingOutline(ast: Root): HeadingOutlineEntry[] {
  const out: HeadingOutlineEntry[] = [];
  for (const node of ast.children ?? []) {
    if (node.type === "heading") {
      const text = headingText(node);
      if (!text) continue;
      out.push({ level: node.depth, text, slug: slugify(text) });
    }
  }
  return out;
}

function paragraphText(node: Paragraph, body: string): string {
  if (!node.position) return "";
  return body
    .slice(node.position.start.offset!, node.position.end.offset!)
    .trim();
}

function extractIntro(ast: Root, body: string): string | null {
  const children = ast.children ?? [];
  // Prefer the first paragraph after the first heading; fall back to the very
  // first paragraph in headingless docs.
  let firstHeadingSeen = false;
  for (const node of children) {
    if (node.type === "heading") {
      firstHeadingSeen = true;
      continue;
    }
    if (node.type === "paragraph") {
      if (children.some((c) => c.type === "heading") && !firstHeadingSeen) continue;
      const t = paragraphText(node, body);
      if (t) return t;
    }
  }
  return null;
}

function buildSummary(args: {
  title: string;
  h1: string | null;
  intro: string | null;
  fm: Record<string, unknown>;
}): { summary: string | null; summary_source: SummarySource } {
  const fmSummary = args.fm.summary;
  if (typeof fmSummary === "string" && fmSummary.trim()) {
    return {
      summary: clamp(fmSummary.trim(), SUMMARY_BUDGET_CHARS),
      summary_source: "frontmatter",
    };
  }
  const head = args.h1 ?? args.title;
  if (!args.intro) {
    return { summary: null, summary_source: "empty" };
  }
  const text = head ? `${head}\n\n${args.intro}` : args.intro;
  return {
    summary: clamp(text, SUMMARY_BUDGET_CHARS),
    summary_source: "deterministic_intro",
  };
}

function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

const PURPOSE_SET = new Set<string>(DOC_PURPOSES);

function classifyPurpose(args: {
  fm: Record<string, unknown>;
  source_path: string;
  title: string;
  headingOutline: HeadingOutlineEntry[];
}): { doc_purpose: DocPurpose; purpose_source: PurposeSource } {
  const fmPurpose = args.fm.doc_purpose;
  if (typeof fmPurpose === "string") {
    if (!PURPOSE_SET.has(fmPurpose)) {
      throw new Error(`invalid doc_purpose frontmatter: ${fmPurpose}`);
    }
    return { doc_purpose: fmPurpose as DocPurpose, purpose_source: "frontmatter" };
  }

  const lowerPath = args.source_path.toLowerCase();
  const filename = (lowerPath.split(/[\\/]/).pop() ?? lowerPath).replace(/\.[^.]+$/, "");
  const lowerTitle = args.title.toLowerCase();

  // Path rules — most specific first.
  if (/(^|\/)docs\/adr\//.test(lowerPath)) {
    return { doc_purpose: "adr", purpose_source: "path_rule" };
  }
  if (/(^|\/)docs\/prd\//.test(lowerPath)) {
    return { doc_purpose: "prd", purpose_source: "path_rule" };
  }
  if (/(^|\/)docs\/runbooks?\//.test(lowerPath)) {
    return { doc_purpose: "runbook", purpose_source: "path_rule" };
  }

  // Filename rules.
  if (filename === "changelog") {
    return { doc_purpose: "changelog", purpose_source: "path_rule" };
  }
  if (/(^|-|_)release[-_]?notes?$/.test(filename)) {
    return { doc_purpose: "release_note", purpose_source: "path_rule" };
  }
  if (/migrat/.test(filename) || /upgrad/.test(filename)) {
    return { doc_purpose: "migration", purpose_source: "path_rule" };
  }
  if (/^quick[-_]?start$/.test(filename) || /getting[-_]?started/.test(filename)) {
    return { doc_purpose: "quick_start", purpose_source: "path_rule" };
  }
  if (filename === "readme") {
    if (/(^|\/)packages\//.test(lowerPath) || /(^|\/)package\//.test(lowerPath)) {
      return { doc_purpose: "package_readme", purpose_source: "path_rule" };
    }
    return { doc_purpose: "readme", purpose_source: "path_rule" };
  }
  if (/(^|\/)examples?\//.test(lowerPath) || filename.endsWith(".example")) {
    return { doc_purpose: "example", purpose_source: "path_rule" };
  }
  if (/(^|\/)docs\/api\//.test(lowerPath) || /(^|\/)api[-_]?reference\b/.test(lowerPath)) {
    return { doc_purpose: "api_reference", purpose_source: "path_rule" };
  }
  if (/(^|\/)docs\/concepts?\//.test(lowerPath)) {
    return { doc_purpose: "concept", purpose_source: "path_rule" };
  }
  if (/(^|\/)docs\/guides?\//.test(lowerPath) || /(^|\/)docs\/howtos?\//.test(lowerPath)) {
    return { doc_purpose: "guide", purpose_source: "path_rule" };
  }

  // Title rules.
  if (/\bmigration\b|\bupgrad/i.test(lowerTitle)) {
    return { doc_purpose: "migration", purpose_source: "title_rule" };
  }
  if (/\bchangelog\b/i.test(lowerTitle)) {
    return { doc_purpose: "changelog", purpose_source: "title_rule" };
  }
  if (/\bapi reference\b/i.test(lowerTitle) || /\breference\b/i.test(lowerTitle)) {
    return { doc_purpose: "api_reference", purpose_source: "title_rule" };
  }
  if (/\bquick ?start\b|\bgetting started\b/i.test(lowerTitle)) {
    return { doc_purpose: "quick_start", purpose_source: "title_rule" };
  }
  if (/\bguide\b|\bhow ?to\b/i.test(lowerTitle)) {
    return { doc_purpose: "guide", purpose_source: "title_rule" };
  }

  // Content-structure rules: lots of "## Method/Class/function" suggests
  // api_reference; otherwise unknown.
  const apiHeadingHits = args.headingOutline.filter((h) =>
    /\b(class|interface|function|method|api)\b/i.test(h.text),
  ).length;
  if (apiHeadingHits >= 3) {
    return { doc_purpose: "api_reference", purpose_source: "content_rule" };
  }

  return { doc_purpose: "unknown", purpose_source: "default" };
}

function pushAlias(
  out: SourceAlias[],
  seen: Set<string>,
  kind: AliasKind,
  rawValue: string,
  confidence: AliasConfidence,
  origin: AliasOrigin,
): void {
  const value = rawValue.trim();
  if (!value) return;
  const key = `${kind}:${value.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ kind, value, confidence, origin });
}

function extractAliases(args: {
  source_path: string;
  fm: Record<string, unknown>;
  title: string;
  h1: string | null;
  headingOutline: HeadingOutlineEntry[];
}): SourceAlias[] {
  const out: SourceAlias[] = [];
  const seen = new Set<string>();

  // Path aliases — directory segments and the full path stem.
  const noExt = args.source_path.replace(/\.[^.]+$/, "");
  pushAlias(out, seen, "path", noExt, "high", "path");
  for (const seg of noExt.split(/[\\/]/)) {
    if (seg && seg !== "docs") {
      pushAlias(out, seen, "path", seg, "medium", "path");
    }
  }

  // Filename alias — the leaf without extension.
  const leaf = (args.source_path.split(/[\\/]/).pop() ?? args.source_path).replace(
    /\.[^.]+$/,
    "",
  );
  pushAlias(out, seen, "filename", leaf, "high", "filename");

  // Title aliases.
  if (args.title) {
    pushAlias(out, seen, "title", args.title, "high", "title");
  }
  if (args.h1 && args.h1 !== args.title) {
    pushAlias(out, seen, "title", args.h1, "high", "h1");
  }

  // Heading aliases — H2/H3 headings.
  for (const h of args.headingOutline) {
    if (h.level >= 2 && h.level <= 3) {
      pushAlias(out, seen, "heading", h.text, "medium", "heading");
    }
  }

  // Frontmatter symbol/route/package aliases.
  for (const [fmKey, kind, origin, confidence] of [
    ["symbols", "symbol", "frontmatter", "high"],
    ["routes", "route", "frontmatter", "high"],
    ["packages", "package", "frontmatter", "high"],
  ] as Array<[string, AliasKind, AliasOrigin, AliasConfidence]>) {
    const v = args.fm[fmKey];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string") {
          pushAlias(out, seen, kind, item, confidence, origin);
        }
      }
    }
  }

  // package_readme heuristic: if path is packages/<name>/README.md, alias <name>.
  const pkgMatch = args.source_path.match(/(?:^|\/)packages\/([^/]+)\/README\.md$/i);
  if (pkgMatch && pkgMatch[1]) {
    pushAlias(out, seen, "package", pkgMatch[1], "high", "package_name");
  }

  return out;
}

function extractQuestionsAnswered(headings: HeadingOutlineEntry[]): {
  questions_answered: string[];
  questions_answered_source: QuestionsAnsweredSource;
} {
  const out: string[] = [];
  for (const h of headings) {
    const t = h.text;
    if (!t) continue;
    if (t.endsWith("?")) {
      out.push(t);
      continue;
    }
    const firstWord = t.toLowerCase().split(/\s+/)[0] ?? "";
    if (QUESTION_PREFIXES.includes(firstWord) && /\s/.test(t)) {
      out.push(t);
    }
  }
  return {
    questions_answered: out,
    questions_answered_source: out.length > 0 ? "heading_question_extraction" : "empty",
  };
}
