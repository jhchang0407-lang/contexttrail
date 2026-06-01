import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import fg from "fast-glob";
import { loadConfig } from "../config/load.js";
import { openDb, closeDb } from "../store/db.js";
import { getChunkByVersionId, tombstoneChunk, updateDocRoleForSource } from "../store/chunks.js";
import {
  deleteSource,
  upsertSource,
  getSource,
  listChunkVersionIdsForSource,
} from "../store/sources.js";
import { persistChunkWithAnchors } from "../store/persist-chunk.js";
import { deleteSourceProfile, upsertSourceProfile } from "../store/source-profiles.js";
import { replaceCodeChunksForSource } from "../archive/code-engine-era-2026-05/code-engine/store/code-chunks.js";
import { upsertCodeSource } from "../archive/code-engine-era-2026-05/code-engine/store/code-sources.js";
import { syncCodeGraph } from "../archive/code-engine-era-2026-05/code-engine/store/code-graph.js";
import { chunk } from "../parse/chunker.js";
import { parse as parseMarkdown } from "../parse/markdown.js";
import { loadDocumentForImport, type LoadedDocumentForImport } from "../parse/document-text.js";
import { buildSourceProfile } from "../parse/source-profile.js";
import { extractCodeIndexArtifactsFor } from "../archive/code-engine-era-2026-05/code-engine/parse/code-source-dispatch.js";
import {
  buildCodePackageFactsBySourcePath,
  withCodePackageFacts,
} from "../archive/code-engine-era-2026-05/code-engine/facts/code-package-facts.js";
import {
  buildCodeCochangeFactsBySourcePath,
  withCodeCochangeFacts,
} from "../archive/code-engine-era-2026-05/code-engine/facts/code-cochange-facts.js";
import { parseNavConfig } from "../parse/nav-parser.js";
import { count as countTokens } from "../parse/tokens.js";
import { resolveScope } from "../scope/resolve.js";
import { resolveDocRole } from "../scope/doc-role.js";
import { absoluteSourcePath, storageSourcePath } from "../source-path.js";
import {
  getSourceExtraction,
  upsertSourceExtraction,
  type StoredSourceExtraction,
} from "../store/source-extractions.js";

export type ImportSummary = {
  files_imported: number;
  files_unchanged: number;
  chunks_written: number;
  warnings: string[];
};

export type ImportOptions = {
  /**
   * Used by the retrieval freshness pre-pass when it already knows the exact
   * stale markdown paths. The normal CLI import still refreshes code sources.
   */
  skipCodeSources?: boolean;
};

type ImportMatch = {
  sourcePath: string;
  absolutePath: string;
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function runImport(
  cwd: string,
  patterns: string[],
  options: ImportOptions = {},
): ImportSummary {
  const cfg = loadConfig(cwd);
  const dbPath = join(cwd, ".contexttrail/cache/contexttrail.db");
  const db = openDb(dbPath);
  const summary: ImportSummary = {
    files_imported: 0,
    files_unchanged: 0,
    chunks_written: 0,
    warnings: [],
  };

  // Sort to make import order deterministic across runs and filesystems.
  // Without this, fg.sync returns OS-dependent order, which surfaces as
  // FTS5 rowid drift and downstream score-tie ordering variance — observed
  // during PRD-0032 audit runs as 7-47 row count swings between
  // consecutive runs on identical corpora.
  const matched = expandImportPatterns(cwd, patterns);
  const indexed_at = new Date().toISOString();
  // PRD-0023 / slice 23.2: corpus-wide path set for section-landing
  // detection. Includes every matched source path so each profile sees
  // the same view.
  const all_source_paths = new Set(matched.map((match) => match.sourcePath));
  // PRD-0027 / slice 27.1.2: corpus-wide nav graph computed once
  // per import pass; projected onto each profile by source_path.
  const nav_graph = parseNavConfig(cwd);

  for (const match of matched) {
    const rel = match.sourcePath;
    const abs = match.absolutePath;
    const stat = statSync(abs);
    let loaded: LoadedDocumentForImport;
    try {
      loaded = loadDocumentForImport(abs, rel);
    } catch (err) {
      summary.warnings.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const raw = loaded.text;
    const content_hash = loaded.source_content_hash;
    const priorExtraction = getSourceExtraction(db, rel);
    const renderedTextHash = sha256(raw);
    upsertSourceExtraction(db, {
      source_path: rel,
      source_content_hash: content_hash,
      method: loaded.ir.method,
      status: loaded.ir.status,
      quality: loaded.ir.metrics.extraction_quality,
      warnings: loaded.ir.warnings,
      metrics: loaded.ir.metrics,
      text_hash: renderedTextHash,
      indexed_at,
    });
    summary.warnings.push(...loaded.warnings.map((warning) => `${rel}: ${warning}`));
    if (loaded.ir.status === "needs_ocr" || loaded.ir.status === "failed" || raw.trim().length === 0) {
      removeIndexedSource(db, rel);
      if (loaded.warnings.length === 0) {
        summary.warnings.push(`${rel}: no extractable text found; skipping import.`);
      }
      continue;
    }
    const { frontmatter } = parseMarkdown(raw);
    const role = resolveDocRole({
      source_path: rel,
      frontmatter,
      config: cfg,
    });

    const existing = getSource(db, rel);
    if (
      existing &&
      existing.source_content_hash === content_hash &&
      existing.source_size === stat.size &&
      !needsPdfExtractionRepair(db, rel) &&
      !needsDocumentIrRepair(priorExtraction, loaded, renderedTextHash)
    ) {
      updateDocRoleForSource(db, rel, role.doc_role, role.role_source);
      // Refresh the SourceProfile so doc_role/role_source updates from config
      // changes propagate even when source content is unchanged.
      upsertSourceProfile(
        db,
        buildSourceProfile({
          source_path: rel,
          source: raw,
          source_content_hash: content_hash,
          indexed_at,
          doc_role: role.doc_role,
          role_source: role.role_source,
          chunk_count: existing.chunk_count,
          token_count: countTokens(raw),
          all_source_paths,
          nav_graph,
        }),
      );
      summary.files_unchanged++;
      continue;
    }

    const scope = resolveScope({
      source_path: rel,
      frontmatter,
      config: cfg,
    });
    updateDocRoleForSource(db, rel, role.doc_role, role.role_source);

    const chunks = chunk(raw, {
      source_path: rel,
      source_content_hash: content_hash,
      indexed_at,
      target_tokens: cfg.chunking.target_tokens,
      max_tokens: cfg.chunking.max_tokens,
      default_scope: scope,
    });

    // Tombstone any prior current chunks whose version_id is no longer present.
    const newIds = new Set(chunks.map((c) => c.version_id));
    const priorCurrent = listChunkVersionIdsForSource(db, rel, "current");
    for (const oldId of priorCurrent) {
      if (!newIds.has(oldId)) tombstoneChunk(db, oldId);
    }

    for (const c of chunks) {
      c.doc_role = role.doc_role;
      c.role_source = role.role_source;
      persistChunkWithAnchors(db, c, scope);
      if (c.warnings) summary.warnings.push(...c.warnings);
    }

    upsertSource(db, {
      source_path: rel,
      source_mtime_ms: Math.floor(stat.mtimeMs),
      source_size: stat.size,
      source_content_hash: content_hash,
      last_indexed_at: indexed_at,
      chunk_count: chunks.length,
    });

    upsertSourceProfile(
      db,
      buildSourceProfile({
        source_path: rel,
        source: raw,
        source_content_hash: content_hash,
        indexed_at,
        doc_role: role.doc_role,
        role_source: role.role_source,
        chunk_count: chunks.length,
        token_count: countTokens(raw),
        all_source_paths,
        nav_graph,
      }),
    );

    summary.files_imported++;
    summary.chunks_written += chunks.length;
  }

  if (!options.skipCodeSources) {
    // PRD-0028 / slice 28.2: code-source structural metadata index. Runs
    // unconditionally at import time so the table is always populated when
    // present; the retrieval-side flag (slice 28.3) controls whether the
    // index is *read* during retrieval.
    importCodeSources({
      cwd,
      db,
      indexed_at,
      globs: cfg.code_globs,
      ignore: cfg.code_ignore,
    });
    syncCodeGraph(db);
  }

  closeDb(db);
  return summary;
}

function needsPdfExtractionRepair(db: ReturnType<typeof openDb>, sourcePath: string): boolean {
  if (!sourcePath.toLowerCase().endsWith(".pdf")) return false;
  return listChunkVersionIdsForSource(db, sourcePath, "current").some((versionId) => {
    const chunk = getChunkByVersionId(db, versionId);
    return chunk ? /--\s*\d+\s+of\s+\d+\s*--|Docusign Envelope ID:/i.test(chunk.body) : false;
  });
}

function needsDocumentIrRepair(
  prior: StoredSourceExtraction | null,
  loaded: LoadedDocumentForImport,
  renderedTextHash: string,
): boolean {
  if (!prior) return true;
  return (
    prior.source_content_hash !== loaded.source_content_hash ||
    prior.method !== loaded.ir.method ||
    prior.status !== loaded.ir.status ||
    prior.quality !== loaded.ir.metrics.extraction_quality ||
    prior.text_hash !== renderedTextHash
  );
}

function removeIndexedSource(db: ReturnType<typeof openDb>, sourcePath: string): void {
  for (const versionId of listChunkVersionIdsForSource(db, sourcePath, "current")) {
    tombstoneChunk(db, versionId);
  }
  deleteSourceProfile(db, sourcePath);
  deleteSource(db, sourcePath);
}

function expandImportPatterns(cwd: string, patterns: string[]): ImportMatch[] {
  const bySourcePath = new Map<string, ImportMatch>();
  for (const rawPattern of patterns) {
    const pattern = rawPattern.trim();
    if (!pattern) continue;
    const absolutePattern = isAbsolute(pattern);
    const matches = fg.sync(pattern, {
      cwd,
      onlyFiles: true,
      dot: false,
      absolute: absolutePattern,
    });
    for (const matched of matches) {
      const absolutePath = absolutePattern
        ? resolve(matched)
        : absoluteSourcePath(cwd, matched);
      const sourcePath = storageSourcePath(cwd, absolutePath);
      bySourcePath.set(sourcePath, { sourcePath, absolutePath });
    }
  }
  return [...bySourcePath.values()].sort((a, b) =>
    a.sourcePath.localeCompare(b.sourcePath),
  );
}

export function importCodeSources(args: {
  cwd: string;
  db: ReturnType<typeof openDb>;
  indexed_at: string;
  globs: string[];
  ignore: string[];
}): { files_indexed: number } {
  if (!args.globs || args.globs.length === 0) {
    return { files_indexed: 0 };
  }
  // Sort for deterministic indexing order — same reason as the doc-import
  // path above.
  const matched = fg.sync(args.globs, {
    cwd: args.cwd,
    onlyFiles: true,
    dot: false,
    ignore: args.ignore,
  }).sort();
  const packageFactsByPath = buildCodePackageFactsBySourcePath({
    cwd: args.cwd,
    source_paths: matched,
    ignore: args.ignore,
  });
  const cochangeFactsByPath = buildCodeCochangeFactsBySourcePath({
    cwd: args.cwd,
    source_paths: matched,
  });
  let files_indexed = 0;
  for (const rel of matched) {
    const abs = join(args.cwd, rel);
    const raw = readFileSync(abs, "utf8");
    const content_hash = sha256(raw);
    const extracted = extractCodeIndexArtifactsFor({
      source_path: rel,
      content: raw,
      corpus_root: args.cwd,
    });
    const facts = withCodeCochangeFacts(
      withCodePackageFacts(
        extracted.facts,
        packageFactsByPath.get(rel),
      ),
      cochangeFactsByPath.get(rel),
    );
    upsertCodeSource(args.db, {
      facts,
      source_content_hash: content_hash,
      indexed_at: args.indexed_at,
    });
    replaceCodeChunksForSource(args.db, {
      source_path: rel,
      source_content_hash: content_hash,
      indexed_at: args.indexed_at,
      chunks: extracted.chunks,
    });
    files_indexed++;
  }
  return { files_indexed };
}
