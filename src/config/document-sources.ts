import {
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { runImport, type ImportSummary } from "../cli/import.js";
import { normalizePathSeparators } from "../source-path.js";
import type { ContextTrailConfig } from "./defaults.js";
import { init } from "./init.js";
import { CONFIG_REL_PATH, loadConfig } from "./load.js";

export const DEFAULT_DOCUMENT_SOURCE_GLOB = "**/*.{md,markdown,txt,docx,pdf}";
const LEGACY_DEFAULT_DOCUMENT_SOURCE_GLOBS = new Set(["**/*.{md,markdown,txt}"]);

export type DocumentSource = ContextTrailConfig["document_sources"][number];

export type SaveDocumentSourceInput = {
  path: string;
  glob?: string;
};

export type SaveDocumentSourceResult = {
  source: DocumentSource;
  action: "created" | "updated";
};

export function listDocumentSources(cwd: string): DocumentSource[] {
  init(cwd);
  return upgradeDocumentSourceDefaults(loadConfig(cwd).document_sources);
}

export function upgradeDocumentSourceDefaults(sources: DocumentSource[]): DocumentSource[] {
  return sources.map((source) => ({
    ...source,
    glob: upgradeLegacyDefaultGlob(source.glob),
  }));
}

export function saveDocumentSource(
  cwd: string,
  input: SaveDocumentSourceInput,
): SaveDocumentSourceResult {
  init(cwd);
  const sourcePath = normalizeDocumentSourcePath(cwd, input.path);
  const glob = normalizeGlob(input.glob);
  const existing = listDocumentSources(cwd);
  const index = existing.findIndex(
    (source) => resolveDocumentSourcePath(cwd, source.path) === sourcePath,
  );
  const source: DocumentSource = {
    id: index >= 0 ? existing[index]!.id : documentSourceId(sourcePath),
    path: sourcePath,
    glob,
  };
  const next = [...existing];
  let action: SaveDocumentSourceResult["action"] = "created";
  if (index >= 0) {
    next[index] = source;
    action = "updated";
  } else {
    next.push(source);
  }
  writeDocumentSources(cwd, next);
  return { source, action };
}

export function importConfiguredDocumentSources(cwd: string): ImportSummary {
  const sources = listDocumentSources(cwd);
  const patterns = documentSourceImportPatterns(sources);
  if (patterns.length === 0) return emptyImportSummary();
  return runImport(cwd, patterns, { skipCodeSources: true });
}

export function documentSourceImportPatterns(sources: DocumentSource[]): string[] {
  return sources.map((source) => joinGlob(source.path, source.glob));
}

function normalizeDocumentSourcePath(cwd: string, inputPath: string): string {
  const resolved = resolveDocumentSourcePath(cwd, inputPath);
  if (!existsSync(resolved)) {
    throw new Error(`document source path does not exist: ${resolved}`);
  }
  const stat = statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`document source path must be a folder: ${resolved}`);
  }
  return resolved;
}

function resolveDocumentSourcePath(cwd: string, inputPath: string): string {
  const raw = inputPath.trim();
  if (!raw) throw new Error("document source path is required");
  const expanded = raw.startsWith("~/")
    ? join(process.env.HOME ?? "", raw.slice(2))
    : raw;
  return normalizePathSeparators(resolve(cwd, expanded));
}

function normalizeGlob(input: string | undefined): string {
  const glob = input?.trim() || DEFAULT_DOCUMENT_SOURCE_GLOB;
  return upgradeLegacyDefaultGlob(glob.replace(/^\/+/, "") || DEFAULT_DOCUMENT_SOURCE_GLOB);
}

function upgradeLegacyDefaultGlob(glob: string): string {
  return LEGACY_DEFAULT_DOCUMENT_SOURCE_GLOBS.has(glob)
    ? DEFAULT_DOCUMENT_SOURCE_GLOB
    : glob;
}

function writeDocumentSources(cwd: string, sources: DocumentSource[]): void {
  const configPath = join(cwd, CONFIG_REL_PATH);
  const document = parseDocument(readFileSync(configPath, "utf8"));
  document.set("document_sources", sources);
  document.set("active_task_profile_id", null);
  writeFileSync(configPath, document.toString(), "utf8");
}

function documentSourceId(sourcePath: string): string {
  const base = basename(sourcePath)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "documents";
  const hash = createHash("sha256").update(sourcePath).digest("hex").slice(0, 8);
  return `docsrc-${base}-${hash}`;
}

function joinGlob(sourcePath: string, glob: string): string {
  return `${sourcePath.replace(/\/+$/, "")}/${glob.replace(/^\/+/, "")}`;
}

function emptyImportSummary(): ImportSummary {
  return {
    files_imported: 0,
    files_unchanged: 0,
    chunks_written: 0,
    warnings: [],
  };
}
