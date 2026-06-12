import { realpathSync, statSync, type Stats } from "node:fs";
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
import { chunk } from "../parse/chunker.js";
import { parse as parseMarkdown } from "../parse/markdown.js";
import {
  documentNeedsExtraction,
  loadDocumentForImport,
  precomputeDocumentExtractions,
  type LoadedDocumentForImport,
  type PrecomputedDocumentExtraction,
} from "../parse/document-text.js";
import { buildSourceProfile } from "../parse/source-profile.js";
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


type ImportMatch = {
  sourcePath: string;
  absolutePath: string;
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function runImport(cwd: string, patterns: string[]): ImportSummary {
  const cfg = loadConfig(cwd);
  const dbPath = join(cwd, ".contexttrail/cache/contexttrail.db");
  const db = openDb(dbPath);
  const summary: ImportSummary = {
    files_imported: 0,
    files_unchanged: 0,
    chunks_written: 0,
    warnings: [],
  };

  // Close the db even when an unexpected per-file error escapes the loop;
  // otherwise the WAL connection leaks for the rest of the process lifetime.
  try {
    runImportWithDb(db, cwd, cfg, patterns, summary);
  } finally {
    closeDb(db);
  }
  return summary;
}

function runImportWithDb(
  db: ReturnType<typeof openDb>,
  cwd: string,
  cfg: ReturnType<typeof loadConfig>,
  patterns: string[],
  summary: ImportSummary,
): void {
  // Sort to make import order deterministic across runs and filesystems.
  // Without this, fg.sync returns OS-dependent order, which surfaces as
  // FTS5 rowid drift and downstream score-tie ordering variance — observed
  // during audit runs as 7-47 row count swings between consecutive runs
  // on identical corpora.
  const matched = expandImportPatterns(cwd, patterns, summary.warnings);
  const indexed_at = new Date().toISOString();
  // Corpus-wide path set for section-landing detection. Includes every
  // matched source path so each profile sees the same view.
  const all_source_paths = new Set(matched.map((match) => match.sourcePath));
  // Corpus-wide nav graph computed once per import pass; projected onto
  // each profile by source_path.
  const nav_graph = parseNavConfig(cwd);

  const progress = createImportProgress(matched.length);
  try {
    runImportLoop(db, cfg, matched, summary, {
      indexed_at,
      all_source_paths,
      nav_graph,
      progress,
    });
  } finally {
    // Always clear the in-place progress line so warnings and the summary
    // never render on top of a stale counter.
    progress.finish();
  }
}

type ImportLoopContext = {
  indexed_at: string;
  all_source_paths: Set<string>;
  nav_graph: ReturnType<typeof parseNavConfig>;
  progress: ImportProgress;
};

function runImportLoop(
  db: ReturnType<typeof openDb>,
  cfg: ReturnType<typeof loadConfig>,
  matched: ImportMatch[],
  summary: ImportSummary,
  context: ImportLoopContext,
): void {
  const { indexed_at, all_source_paths, nav_graph, progress } = context;

  // PDFs/DOCX pay the heavy extraction cost, so run them through the worker
  // pool in parallel before the (synchronous) per-file loop, which then
  // consumes the precomputed results. Every matched extractable file is
  // extracted, exactly as the serial loop did — the content-hash skip below
  // intentionally still happens after extraction.
  const extractable = matched.filter((match) => documentNeedsExtraction(match.absolutePath));
  let precomputed = new Map<string, PrecomputedDocumentExtraction>();
  if (extractable.length > 0) {
    precomputed = precomputeDocumentExtractions(
      extractable.map((match) => ({ key: match.sourcePath, path: match.absolutePath })),
      (done, total) => progress.update("extracting", done, total),
    );
  }

  let processed = 0;
  for (const match of matched) {
    progress.update("importing", ++processed, matched.length);
    const rel = match.sourcePath;
    const abs = match.absolutePath;
    // Guard the stat the same way as loadDocumentForImport: a file deleted
    // (or made unreachable) between glob expansion and this loop should
    // surface as a warning, not abort the remaining files.
    let stat: Stats;
    try {
      stat = statSync(abs);
    } catch (err) {
      summary.warnings.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    let loaded: LoadedDocumentForImport;
    try {
      loaded = loadDocumentForImport(abs, rel, precomputed.get(rel));
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
}

/** Imports at or below this many matched files run silently. */
const PROGRESS_MIN_MATCHED_FILES = 25;
/** Non-TTY stderr gets one plain progress line every N processed files. */
const PROGRESS_PLAIN_LINE_EVERY = 50;

type ImportProgress = {
  update(stage: "extracting" | "importing", done: number, total: number): void;
  finish(): void;
};

const SILENT_PROGRESS: ImportProgress = { update() {}, finish() {} };

/**
 * Stderr progress for large imports: a single self-overwriting line on a TTY
 * (`importing 132/1043 …`), plain lines every PROGRESS_PLAIN_LINE_EVERY files
 * otherwise. Small imports (and therefore the test suite) stay silent.
 */
function createImportProgress(matchedCount: number): ImportProgress {
  if (matchedCount <= PROGRESS_MIN_MATCHED_FILES) return SILENT_PROGRESS;
  const stderr = process.stderr;
  if (stderr.isTTY) {
    let dirty = false;
    return {
      update(stage, done, total) {
        stderr.write(`\r\x1b[K${stage} ${done}/${total} …`);
        dirty = true;
      },
      finish() {
        if (dirty) stderr.write("\r\x1b[K");
      },
    };
  }
  let lastLine = "";
  return {
    update(stage, done, total) {
      if (done % PROGRESS_PLAIN_LINE_EVERY !== 0 && done !== total) return;
      const line = `${stage} ${done}/${total}`;
      if (line === lastLine) return;
      lastLine = line;
      stderr.write(`${line}\n`);
    },
    finish() {},
  };
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

function expandImportPatterns(
  cwd: string,
  patterns: string[],
  warnings: string[],
): ImportMatch[] {
  // Patterns are expanded one at a time, so negative patterns ("!docs/...")
  // would otherwise match nothing. Collect them up front and apply them as
  // the ignore set for every positive pattern instead.
  const positive: string[] = [];
  const ignore: string[] = [];
  for (const rawPattern of patterns) {
    const pattern = rawPattern.trim();
    if (!pattern) continue;
    if (pattern.startsWith("!")) {
      const negated = pattern.slice(1).trim();
      if (negated) ignore.push(negated);
    } else {
      positive.push(pattern);
    }
  }
  const bySourcePath = new Map<string, ImportMatch>();
  const seenRealPaths = new Set<string>();
  for (const pattern of positive) {
    const absolutePattern = isAbsolute(pattern);
    let matches: string[];
    try {
      matches = fg.sync(pattern, {
        cwd,
        onlyFiles: true,
        dot: false,
        absolute: absolutePattern,
        ignore,
        // Skip unreadable directories instead of aborting the whole import.
        suppressErrors: true,
      });
    } catch (err) {
      warnings.push(`${pattern}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    // Sort within the pattern so the realpath dedupe below picks a
    // deterministic winner (first source path in lexical order).
    matches.sort();
    for (const matched of matches) {
      const absolutePath = absolutePattern
        ? resolve(matched)
        : absoluteSourcePath(cwd, matched);
      const sourcePath = storageSourcePath(cwd, absolutePath);
      if (bySourcePath.has(sourcePath)) continue;
      // Symlink loops surface the same file under many source paths; dedupe
      // on the resolved path so each document imports exactly once.
      let realPath: string;
      try {
        realPath = realpathSync(absolutePath);
      } catch (err) {
        warnings.push(`${sourcePath}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      if (seenRealPaths.has(realPath)) continue;
      seenRealPaths.add(realPath);
      bySourcePath.set(sourcePath, { sourcePath, absolutePath });
    }
  }
  return [...bySourcePath.values()].sort((a, b) =>
    a.sourcePath.localeCompare(b.sourcePath),
  );
}

