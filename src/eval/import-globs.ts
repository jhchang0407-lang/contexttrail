import { copyFileSync, lstatSync, mkdirSync, readdirSync, statSync } from "node:fs";
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

const COMMIT_GROUNDED_EVAL_COPY_ROOTS = [
  "docs",
  "src",
  "packages",
  "apps",
  "lib",
  "crates",
  "pkg",
  "cmd",
  "internal",
] as const;

const COMMIT_GROUNDED_EVAL_COPY_EXCLUDE_SEGMENTS = new Set([
  ".git",
  ".contexttrail",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "target",
  "vendor",
]);

const COMMIT_GROUNDED_EVAL_SOURCE_FILE_RE =
  /\.(?:ts|tsx|js|jsx|py|go|rs)$/i;

export function shouldCopyCommitGroundedEvalSource(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    normalized
      .split("/")
      .some((segment) => COMMIT_GROUNDED_EVAL_COPY_EXCLUDE_SEGMENTS.has(segment))
  ) {
    return false;
  }
  return !COMMIT_GROUNDED_EVAL_SOURCE_EXCLUDE_PREFIXES.some(
    (prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix),
  );
}

export function prepareCommitGroundedEvalWorkspace(args: {
  repoRoot: string;
  cwd: string;
}): void {
  for (const root of COMMIT_GROUNDED_EVAL_COPY_ROOTS) {
    copyDirIfPresent(join(args.repoRoot, root), join(args.cwd, root), root);
  }
  copySourceFilesByExtension(args.repoRoot, args.cwd);
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

function copySourceFilesByExtension(repoRoot: string, cwd: string): void {
  copySourceFilesRecursive(repoRoot, cwd, "");
}

function copySourceFilesRecursive(srcRoot: string, dstRoot: string, relDir: string): void {
  const current = relDir ? join(srcRoot, relDir) : srcRoot;
  for (const name of [...readdirSync(current)].sort()) {
    const relPath = relDir ? `${relDir}/${name}` : name;
    const normalized = relPath.replace(/\\/g, "/");
    if (!shouldCopyCommitGroundedEvalSource(normalized)) continue;
    const srcPath = join(srcRoot, relPath);
    let stat;
    try {
      stat = lstatSync(srcPath);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      copySourceFilesRecursive(srcRoot, dstRoot, relPath);
      continue;
    }
    if (!COMMIT_GROUNDED_EVAL_SOURCE_FILE_RE.test(normalized)) continue;
    const dstPath = join(dstRoot, relPath);
    mkdirSync(join(dstPath, ".."), { recursive: true });
    copyFileSync(srcPath, dstPath);
  }
}
