import type { Db } from "../../../../store/db.js";
import { listCodeSources } from "./code-sources.js";

export type CodeGraphDirection = "outgoing" | "incoming";

export type ListCodeGraphNeighborsArgs = {
  source_path: string;
  direction: CodeGraphDirection;
};

export type ExpandCodeGraphArgs = {
  seeds: Iterable<string>;
  directions?: readonly CodeGraphDirection[];
  maxHops?: number;
};

type EdgeRow = { path: string };

const DEFAULT_DIRECTIONS: readonly CodeGraphDirection[] = ["outgoing"];
const DEFAULT_MAX_HOPS = 2;

export function syncCodeGraph(db: Db): void {
  const stored = listCodeSources(db);
  const knownSources = new Set(stored.map((entry) => entry.facts.file_path));
  const packageRoots = buildPackageRootIndex(stored);
  const insertNode = db.prepare(
    "INSERT INTO code_graph_nodes (source_path, indexed_at) VALUES (?, ?)",
  );
  const insertEdge = db.prepare(
    "INSERT OR IGNORE INTO code_graph_edges (from_path, to_path, edge_kind) VALUES (?, ?, 'imports')",
  );

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM code_graph_edges").run();
    db.prepare("DELETE FROM code_graph_nodes").run();

    for (const entry of stored) {
      insertNode.run(entry.facts.file_path, entry.indexed_at);
    }

    for (const entry of stored) {
      for (const rawTarget of entry.facts.imports) {
        const resolved = resolveImportTarget(
          rawTarget,
          knownSources,
          entry.facts.file_path,
          packageRoots,
        );
        if (!resolved) continue;
        insertEdge.run(entry.facts.file_path, resolved);
      }
    }
  });

  tx();
}

export function listCodeGraphNeighbors(
  db: Db,
  args: ListCodeGraphNeighborsArgs,
): string[] {
  if (args.direction === "outgoing") {
    return (
      db
        .prepare(
          "SELECT to_path AS path FROM code_graph_edges WHERE from_path = ? AND edge_kind = 'imports' ORDER BY to_path",
        )
        .all(args.source_path) as EdgeRow[]
    ).map((row) => row.path);
  }

  return (
    db
      .prepare(
        "SELECT from_path AS path FROM code_graph_edges WHERE to_path = ? AND edge_kind = 'imports' ORDER BY from_path",
      )
      .all(args.source_path) as EdgeRow[]
  ).map((row) => row.path);
}

export function expandCodeGraph(db: Db, args: ExpandCodeGraphArgs): Set<string> {
  return new Set(expandCodeGraphWithDistances(db, args).keys());
}

export function expandCodeGraphWithDistances(
  db: Db,
  args: ExpandCodeGraphArgs,
): Map<string, number> {
  const directions = args.directions ?? DEFAULT_DIRECTIONS;
  const maxHops = args.maxHops ?? DEFAULT_MAX_HOPS;
  const visited = new Map<string, number>();

  for (const seed of args.seeds) {
    if (!hasCodeGraphNode(db, seed)) continue;
    visited.set(seed, 0);
  }

  let frontier = new Set(visited.keys());
  for (let hop = 0; hop < maxHops; hop++) {
    const next = new Set<string>();
    for (const source_path of frontier) {
      for (const direction of directions) {
        for (const neighbor of listCodeGraphNeighbors(db, {
          source_path,
          direction,
        })) {
          if (visited.has(neighbor)) continue;
          visited.set(neighbor, hop + 1);
          next.add(neighbor);
        }
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }

  return visited;
}

export function hasCodeGraphNode(db: Db, source_path: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM code_graph_nodes WHERE source_path = ? LIMIT 1")
      .get(source_path),
  );
}

export function listCodeGraphNodes(db: Db): string[] {
  return (
    db
      .prepare("SELECT source_path FROM code_graph_nodes ORDER BY source_path")
      .all() as Array<{ source_path: string }>
  ).map((row) => row.source_path);
}

function resolveImportTarget(
  rawTarget: string,
  knownSources: ReadonlySet<string>,
  importerPath: string,
  packageRoots: ReadonlyMap<string, readonly string[]>,
): string | null {
  for (const candidate of importTargetCandidates(
    rawTarget,
    importerPath,
    packageRoots,
  )) {
    if (knownSources.has(candidate)) return candidate;
  }

  return null;
}

function importTargetCandidates(
  rawTarget: string,
  importerPath: string,
  packageRoots: ReadonlyMap<string, readonly string[]>,
): string[] {
  const normalized = rawTarget.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized) return [];
  const bases = uniqueStrings([
    normalized,
    stripKnownSourceExtension(normalized),
    ...crateRootRelativeBases(normalized, importerPath),
    ...packageImportBases(normalized, packageRoots),
  ]);
  const out: string[] = [];
  for (const base of bases) {
    out.push(base);
    for (const ext of IMPORT_TARGET_EXTENSIONS) {
      out.push(`${base}${ext}`);
    }
    for (const indexName of IMPORT_TARGET_DIRECTORY_FILES) {
      for (const ext of IMPORT_TARGET_EXTENSIONS) {
        out.push(`${base}/${indexName}${ext}`);
      }
    }
  }
  return uniqueStrings(out);
}

function buildPackageRootIndex(
  stored: ReturnType<typeof listCodeSources>,
): Map<string, string[]> {
  const roots = new Map<string, Set<string>>();
  for (const entry of stored) {
    const packageFacts = entry.facts.package_facts;
    if (!packageFacts?.package_name || !packageFacts.package_root) continue;
    const current = roots.get(packageFacts.package_name) ?? new Set<string>();
    current.add(packageFacts.package_root);
    roots.set(packageFacts.package_name, current);
  }
  return new Map(
    [...roots.entries()].map(([name, values]) => [name, [...values].sort()]),
  );
}

function packageImportBases(
  rawTarget: string,
  packageRoots: ReadonlyMap<string, readonly string[]>,
): string[] {
  const match = packageImportMatch(rawTarget, packageRoots);
  if (!match) return [];
  const out: string[] = [];
  for (const root of match.roots) {
    if (match.subpath.length === 0) {
      out.push(root, `${root}/src`);
    } else {
      out.push(`${root}/${match.subpath}`, `${root}/src/${match.subpath}`);
    }
  }
  return out;
}

function packageImportMatch(
  rawTarget: string,
  packageRoots: ReadonlyMap<string, readonly string[]>,
): { roots: readonly string[]; subpath: string } | null {
  let best: { name: string; roots: readonly string[] } | null = null;
  for (const [name, roots] of packageRoots) {
    if (rawTarget !== name && !rawTarget.startsWith(`${name}/`)) continue;
    if (!best || name.length > best.name.length) {
      best = { name, roots };
    }
  }
  if (!best) return null;
  return {
    roots: best.roots,
    subpath: rawTarget === best.name
      ? ""
      : rawTarget.slice(best.name.length + 1),
  };
}

function crateRootRelativeBases(
  rawTarget: string,
  importerPath: string,
): string[] {
  if (rawTarget.startsWith("src/") || rawTarget.includes(":")) return [];
  const sourceRoot = sourceRootPrefix(importerPath);
  if (!sourceRoot || rawTarget.startsWith(`${sourceRoot}/`)) return [];
  return [
    `${sourceRoot}/${rawTarget}`,
    `${sourceRoot}/${stripKnownSourceExtension(rawTarget)}`,
  ];
}

function sourceRootPrefix(sourcePath: string): string | null {
  const segments = sourcePath.replace(/\\/g, "/").split("/").filter(Boolean);
  const srcIndex = segments.lastIndexOf("src");
  if (srcIndex < 0) return null;
  return segments.slice(0, srcIndex + 1).join("/");
}

function stripKnownSourceExtension(path: string): string {
  return path.replace(KNOWN_SOURCE_EXTENSION_PATTERN, "");
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].filter((value) => value.length > 0);
}

const IMPORT_TARGET_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
  ".rs",
  ".go",
  ".py",
] as const;

const IMPORT_TARGET_DIRECTORY_FILES = [
  "index",
  "mod",
  "lib",
  "__init__",
] as const;

const KNOWN_SOURCE_EXTENSION_PATTERN =
  /\.(?:[cm]?[jt]sx?|mjs|cjs|rs|go|py)$/i;
