import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Commit-grounded eval panels should index source-of-truth docs, not their own
 * generated measurement artifacts. Files under `docs/evals/**` are outputs of
 * prior evaluation runs and can mention changed source files after the fact,
 * which contaminates retrieval-based metrics.
 */
export const COMMIT_GROUNDED_EVAL_IMPORT_GLOBS = [
  "*.md",
  "docs/**/*.md",
  "!docs/evals/**/*.md",
] as const;

/**
 * The commit-grounded eval panels run against the same repo that contains
 * their own measurement code. If those modules enter the temporary corpus,
 * chunk-first code retrieval can surface the probes themselves because they
 * mention ticket ids, PRD ids, queries, and changed paths by design.
 */
export const COMMIT_GROUNDED_EVAL_SOURCE_EXCLUDE_PREFIXES = [
  "src/eval/",
] as const;

export function shouldCopyCommitGroundedEvalSource(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  return !COMMIT_GROUNDED_EVAL_SOURCE_EXCLUDE_PREFIXES.some(
    (prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix),
  );
}

export function prepareCommitGroundedEvalWorkspace(args: {
  repoRoot: string;
  cwd: string;
}): void {
  copyDirIfPresent(
    join(args.repoRoot, "docs"),
    join(args.cwd, "docs"),
    "docs",
  );
  copyDirIfPresent(
    join(args.repoRoot, "src"),
    join(args.cwd, "src"),
    "src",
  );
}

function copyDirIfPresent(src: string, dst: string, relRoot: string): void {
  try {
    if (statSync(src).isDirectory()) {
      copyDirFiltered(src, dst, relRoot);
    }
  } catch {
    // Optional input surface for external repo panels.
  }
}

function copyDirFiltered(src: string, dst: string, relRoot: string): void {
  mkdirSync(dst, { recursive: true });
  for (const name of [...readdirSync(src)].sort()) {
    const sp = join(src, name);
    const childRel = `${relRoot}/${name}`.replace(/\\/g, "/");
    if (!shouldCopyCommitGroundedEvalSource(childRel)) continue;
    const dp = join(dst, name);
    if (statSync(sp).isDirectory()) copyDirFiltered(sp, dp, childRel);
    else copyFileSync(sp, dp);
  }
}
