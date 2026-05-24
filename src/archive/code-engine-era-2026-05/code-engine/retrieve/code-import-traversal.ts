/**
 * PRD-0028 / slice 28.4 — code-import-graph traversal.
 *
 * Structural parallel to PRD-0027's markdown link graph and the
 * `expandLinksKHops` utility, but for TypeScript import statements
 * instead of markdown `[text](path)` links. When a code-source surfaces
 * in retrieval, the files it imports are part of the assembly need —
 * the substrate-file misses the slice-28.3 verdict identified
 * (`db.ts`, `chunks.ts`, `schema.ts`, etc.) are reached through
 * transitive imports from the named files, not by symbol-name match.
 *
 * Universal: every TypeScript / JavaScript module emits `import`
 * statements. Slice 28.1's extractor already captures them per file as
 * `CodeSourceFacts.imports`. This module is the retrieval-time
 * traversal layer.
 *
 * Boundary: traversal walks IMPORTS only (outgoing edges). Reverse
 * (importer-of) is a different lever that would need an additional
 * pre-computed index — out of scope here.
 */

export type CodeImportResolver = (filePath: string) => readonly string[];

export type ExpandCodeImportsArgs = {
  seeds: Iterable<string>;
  resolveImports: CodeImportResolver;
  knownSources: ReadonlySet<string>;
  maxHops?: number;
  /**
   * When provided, also walks **inbound** edges — files that import the
   * current path. Mirrors the forward-import structure but for the
   * reverse direction. Useful when a file surfaces via FTS and we want
   * the modules that depend on it (call sites, consumers) to appear in
   * the pack alongside it. Independent of `resolveImports`; either or
   * both can drive the traversal.
   */
  resolveImporters?: CodeImportResolver;
};

/**
 * Expand a seed set of code-source paths by K-hop import traversal.
 * Returns the seed set unioned with all imported paths reachable in
 * up to `maxHops` hops. Imports that don't resolve to a known
 * code-source (e.g., npm packages, type-only imports of `node:*`) are
 * silently filtered.
 *
 * `maxHops` defaults to 2. Matches the `expandLinksKHops` choice — two
 * hops cover most substrate-file chains (e.g., source-rerank.ts →
 * bm25.ts → chunks.ts).
 */
export function expandCodeImportsKHops(args: ExpandCodeImportsArgs): Set<string> {
  const { seeds, resolveImports, resolveImporters, knownSources, maxHops = 2 } = args;
  const visited = new Set<string>();
  for (const s of seeds) {
    if (knownSources.has(s)) visited.add(s);
  }
  let frontier = new Set(visited);
  for (let hop = 0; hop < maxHops; hop++) {
    const next = new Set<string>();
    for (const path of frontier) {
      // Forward edges (path → imports).
      for (const target of resolveImports(path)) {
        if (!knownSources.has(target)) continue;
        if (visited.has(target)) continue;
        visited.add(target);
        next.add(target);
      }
      // Reverse edges (importers → path). Optional. Walks one direction
      // at a time during the same hop; the loop terminates the same
      // way as forward-only.
      if (resolveImporters) {
        for (const target of resolveImporters(path)) {
          if (!knownSources.has(target)) continue;
          if (visited.has(target)) continue;
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

/**
 * Build a reverse-import index from a forward index: for each path's
 * imports, record the path as an importer of each. Returns a function
 * suitable for passing to `expandCodeImportsKHops` as `resolveImporters`.
 *
 * O(N) precomputation; O(1) per lookup. Caller should build this once
 * per retrieval call and reuse across all seed expansions.
 */
export function buildImportersResolver(
  importsByPath: ReadonlyMap<string, readonly string[]>,
): CodeImportResolver {
  const importers = new Map<string, string[]>();
  for (const [path, imports] of importsByPath.entries()) {
    for (const target of imports) {
      const list = importers.get(target) ?? [];
      list.push(path);
      importers.set(target, list);
    }
  }
  return (path: string) => importers.get(path) ?? [];
}
