import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type {
  CodeSourceCochangeFacts,
  CodeSourceFacts,
} from "../types/code-source.js";

export type BuildCodeCochangeFactsArgs = {
  cwd: string;
  source_paths: readonly string[];
  maxCommits?: number;
  maxFilesPerCommit?: number;
  maxRelatedPaths?: number;
};

const DEFAULT_MAX_COMMITS = 500;
const DEFAULT_MAX_FILES_PER_COMMIT = 60;
const DEFAULT_MAX_RELATED_PATHS = 32;

export function buildCodeCochangeFactsBySourcePath(
  args: BuildCodeCochangeFactsArgs,
): Map<string, CodeSourceCochangeFacts> {
  const sourcePaths = new Set(args.source_paths);
  if (sourcePaths.size === 0) return new Map();
  const gitRoot = resolveGitRoot(args.cwd);
  if (!gitRoot) return new Map();

  const commits = readRecentGitNameOnlyCommits({
    gitRoot,
    maxCommits: args.maxCommits ?? DEFAULT_MAX_COMMITS,
  });
  if (commits.length === 0) return new Map();

  const maxFilesPerCommit = args.maxFilesPerCommit ?? DEFAULT_MAX_FILES_PER_COMMIT;
  const pairCounts = new Map<string, Map<string, number>>();
  for (const commit of commits) {
    const changed = uniqueStrings(commit.filter((path) => sourcePaths.has(path)));
    if (changed.length < 2 || changed.length > maxFilesPerCommit) continue;
    for (const sourcePath of changed) {
      const related = pairCounts.get(sourcePath) ?? new Map<string, number>();
      for (const otherPath of changed) {
        if (otherPath === sourcePath) continue;
        related.set(otherPath, (related.get(otherPath) ?? 0) + 1);
      }
      pairCounts.set(sourcePath, related);
    }
  }

  const maxRelatedPaths = args.maxRelatedPaths ?? DEFAULT_MAX_RELATED_PATHS;
  const out = new Map<string, CodeSourceCochangeFacts>();
  for (const [sourcePath, counts] of pairCounts.entries()) {
    const related_paths = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, maxRelatedPaths)
      .map(([source_path, count]) => ({ source_path, count }));
    if (related_paths.length > 0) out.set(sourcePath, { related_paths });
  }
  return out;
}

export function withCodeCochangeFacts(
  facts: CodeSourceFacts,
  cochangeFacts: CodeSourceCochangeFacts | undefined,
): CodeSourceFacts {
  if (!cochangeFacts || cochangeFacts.related_paths.length === 0) return facts;
  return { ...facts, cochange_facts: cochangeFacts };
}

function resolveGitRoot(cwd: string): string | null {
  const direct = gitRootFor(cwd);
  if (direct) return direct;
  const sourceRootPath = join(cwd, ".contexttrail/source-root");
  if (!existsSync(sourceRootPath)) return null;
  const sourceRoot = readFileSync(sourceRootPath, "utf8").trim();
  if (!sourceRoot) return null;
  return gitRootFor(sourceRoot);
}

function gitRootFor(cwd: string): string | null {
  const result = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  const root = result.stdout.trim();
  return root.length > 0 ? root : null;
}

function readRecentGitNameOnlyCommits(args: {
  gitRoot: string;
  maxCommits: number;
}): string[][] {
  const result = spawnSync("git", [
    "-C",
    args.gitRoot,
    "log",
    `--max-count=${args.maxCommits}`,
    "--name-only",
    "--pretty=format:%x1e%H",
    "--no-renames",
  ], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split("\x1e")
    .map((block) =>
      block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(1),
    )
    .filter((paths) => paths.length > 0);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
