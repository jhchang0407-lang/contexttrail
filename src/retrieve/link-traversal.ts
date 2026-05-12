/**
 * Link-traversal context assembly layer — sits above `retrieve()` to close
 * the gap between single-doc retrieval and multi-doc context assembly.
 *
 * The structural principle is universal: every markdown corpus uses
 * `[text](path)` link syntax to express cross-doc references. When a
 * doc surfaces in retrieval, the docs it explicitly references are
 * part of the assembly need. This module parses those links from
 * surfaced docs' full bodies, resolves them to canonical corpus paths,
 * and lets callers expand the candidate set up to K hops.
 *
 * The function is corpus-agnostic — it does not depend on PRD-NNNN /
 * ADR-NNNN naming conventions, file frontmatter, or any docs-config
 * format. It works on raw markdown link syntax, which is universal.
 *
 * Real-workflow probe results on 23 Linear-style engineering tickets:
 *   - raw retrieval (no traversal):  5/23 (21.7%) full-context assembly
 *   - 2-hop link traversal:          22/23 (95.7%)
 *
 * 2 hops cover the foundational chain (PRD → parent PRD → architecture
 * doc) that engineers need but rarely query for by name.
 */
import { posix } from "node:path";

const MD_LINK_RE = /\[(?:[^\]\n]+)\]\(([^)\s]+?)(?:\s+[^)]*)?\)/g;
const MARKDOWN_EXT_RE = /\.(md|mdx)$/i;

/**
 * Extract markdown link targets from a doc body and resolve them to
 * canonical corpus paths. Skips external URLs, anchor-only refs, and
 * mailto links. Drops fragment / query suffixes from local refs.
 *
 * Only returns paths that exist in the supplied `corpusSources` set —
 * dangling links and out-of-corpus references are silently filtered.
 */
export function extractCorpusLinks(
  body: string,
  sourcePath: string,
  corpusSources: ReadonlySet<string>,
): string[] {
  const baseDir = posix.dirname(sourcePath);
  const targets = new Set<string>();
  for (const m of body.matchAll(MD_LINK_RE)) {
    const href = m[1] ?? "";
    if (!href) continue;
    if (
      href.startsWith("http://") ||
      href.startsWith("https://") ||
      href.startsWith("#") ||
      href.startsWith("mailto:")
    ) continue;
    const cleanHref = (href.split("#")[0] ?? "").split("?")[0] ?? "";
    if (!cleanHref) continue;
    const resolved = resolveMarkdownHref(baseDir, cleanHref);
    if (corpusSources.has(resolved)) targets.add(resolved);
    else {
      for (const candidate of markdownPathCandidates(resolved)) {
        if (corpusSources.has(candidate)) targets.add(candidate);
      }
    }
  }
  return [...targets];
}

function resolveMarkdownHref(baseDir: string, href: string): string {
  if (href.startsWith("/")) return posix.normalize(href.replace(/^\/+/, ""));
  return posix.normalize(posix.join(baseDir, href));
}

function markdownPathCandidates(path: string): string[] {
  const withoutTrailingSlash = path.replace(/\/+$/, "");
  const candidates: string[] = [];
  if (!MARKDOWN_EXT_RE.test(withoutTrailingSlash)) {
    candidates.push(`${withoutTrailingSlash}.md`, `${withoutTrailingSlash}.mdx`);
  }
  candidates.push(
    posix.join(withoutTrailingSlash, "index.md"),
    posix.join(withoutTrailingSlash, "README.md"),
  );
  return candidates;
}

export type DocBodyResolver = (sourcePath: string) => string;

/**
 * Expand a seed set of source paths by K-hop markdown link traversal.
 * The corpus and a body resolver (typically file-system or store-backed)
 * are provided by the caller. Returns the seed set unioned with all
 * paths reachable via up to `maxHops` of link traversal.
 *
 * `maxHops` defaults to 2 — empirically the minimum depth that covers
 * the foundational chain on the real-workflow probe. Set to 1 for
 * direct neighbors only; larger values converge quickly because the
 * docs graph is sparse.
 */
export function expandLinksKHops(args: {
  seeds: Iterable<string>;
  corpusSources: ReadonlySet<string>;
  resolveBody: DocBodyResolver;
  maxHops?: number;
}): Set<string> {
  const { seeds, corpusSources, resolveBody, maxHops = 2 } = args;
  const visited = new Set(seeds);
  let frontier = new Set(visited);
  for (let hop = 0; hop < maxHops; hop++) {
    const next = new Set<string>();
    for (const src of frontier) {
      const body = resolveBody(src);
      if (!body) continue;
      for (const target of extractCorpusLinks(body, src, corpusSources)) {
        if (!visited.has(target)) {
          visited.add(target);
          next.add(target);
        }
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }
  return visited;
}
