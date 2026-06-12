/**
 * Repo-configurable real-corpus import globs (V2.5.2).
 * Each repo can declare its own import globs; per-repo overrides REPLACE the
 * defaults so the file is the single source of truth. The wiki glob is opt-in
 * per repo (Zod is the first consumer).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

export const REAL_CORPUS_DEFAULT_IMPORT_GLOBS: readonly string[] = [
  "*.md",
  "docs/**/*.md",
  "packages/**/*.md",
];

export type RealCorpusRepoConfig = {
  /** Replaces the default import globs when present. */
  import_globs?: string[];
};

export type LoadGlobsArgs = {
  repo: string;
  /** Real-corpus root containing `<repo>.config.yaml` and `<repo>/`. */
  root: string;
};

export function realCorpusConfigPath(args: LoadGlobsArgs): string {
  return join(args.root, `${args.repo}.config.yaml`);
}

export function loadRealCorpusRepoConfig(
  args: LoadGlobsArgs,
): RealCorpusRepoConfig {
  const path = realCorpusConfigPath(args);
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  const parsed = YAML.parse(raw) as RealCorpusRepoConfig | null;
  return parsed ?? {};
}

export function loadRealCorpusImportGlobs(args: LoadGlobsArgs): string[] {
  const cfg = loadRealCorpusRepoConfig(args);
  if (cfg.import_globs && cfg.import_globs.length > 0) {
    return [...cfg.import_globs];
  }
  return [...REAL_CORPUS_DEFAULT_IMPORT_GLOBS];
}
