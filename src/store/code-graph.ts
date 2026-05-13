import type { Db } from "./db.js";
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
        const resolved = resolveImportTarget(rawTarget, knownSources);
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
): string | null {
  if (knownSources.has(rawTarget)) return rawTarget;

  if (rawTarget.endsWith(".js")) {
    const tsTarget = rawTarget.slice(0, -3) + ".ts";
    if (knownSources.has(tsTarget)) return tsTarget;
    const tsxTarget = rawTarget.slice(0, -3) + ".tsx";
    if (knownSources.has(tsxTarget)) return tsxTarget;
  }

  for (const ext of [".ts", ".tsx", ".js"]) {
    const candidate = rawTarget + ext;
    if (knownSources.has(candidate)) return candidate;
  }

  return null;
}
