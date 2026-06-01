import { existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { loadConfig } from "../config/load.js";
import { openDb, closeDb } from "../store/db.js";
import { tombstoneChunk } from "../store/chunks.js";
import {
  listSources,
  upsertSource,
  listChunkVersionIdsForSource,
  deleteSource,
} from "../store/sources.js";
import { persistChunkWithAnchors } from "../store/persist-chunk.js";
import {
  upsertSourceProfile,
  deleteSourceProfile,
} from "../store/source-profiles.js";
import {
  listCodeSources,
  deleteCodeSource,
} from "../store/code-sources.js";
import { syncCodeGraph } from "../store/code-graph.js";
import { chunk } from "../parse/chunker.js";
import { parse as parseMarkdown } from "../parse/markdown.js";
import { loadDocumentForImport, type LoadedDocumentForImport } from "../parse/document-text.js";
import { buildSourceProfile } from "../parse/source-profile.js";
import { parseNavConfig } from "../parse/nav-parser.js";
import { count as countTokens } from "../parse/tokens.js";
import { resolveScope } from "../scope/resolve.js";
import { resolveDocRole } from "../scope/doc-role.js";
import { absoluteSourcePath } from "../source-path.js";
import {
  deleteSourceExtraction,
  getSourceExtraction,
  upsertSourceExtraction,
  type StoredSourceExtraction,
} from "../store/source-extractions.js";

export type IndexSummary = {
  unchanged: number;
  reindexed: number;
  tombstoned_chunks: number;
  tombstoned_code_sources: number;
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function runIndex(cwd: string): IndexSummary {
  const cfg = loadConfig(cwd);
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  const summary: IndexSummary = {
    unchanged: 0,
    reindexed: 0,
    tombstoned_chunks: 0,
    tombstoned_code_sources: 0,
  };
  const indexed_at = new Date().toISOString();
  // PRD-0023 / slice 23.2: corpus-wide path set for section-landing
  // detection. Includes every currently-indexed source path so each
  // profile sees the same view as the rebuild progresses.
  const all_source_paths = new Set(listSources(db).map((s) => s.source_path));
  // PRD-0027 / slice 27.1.2: corpus-wide nav graph computed once
  // per index pass and projected onto each profile by source_path.
  const nav_graph = parseNavConfig(cwd);

  for (const src of listSources(db)) {
    const abs = absoluteSourcePath(cwd, src.source_path);
    if (!existsSync(abs)) {
      const ids = listChunkVersionIdsForSource(db, src.source_path, "current");
      for (const id of ids) {
        tombstoneChunk(db, id);
        summary.tombstoned_chunks++;
      }
      deleteSourceProfile(db, src.source_path);
      deleteSource(db, src.source_path);
      deleteSourceExtraction(db, src.source_path);
      continue;
    }
    const stat = statSync(abs);
    const mtime_ms = Math.floor(stat.mtimeMs);
    const priorExtraction = getSourceExtraction(db, src.source_path);
    if (mtime_ms === src.source_mtime_ms && stat.size === src.source_size && priorExtraction) {
      summary.unchanged++;
      continue;
    }
    let loaded: LoadedDocumentForImport;
    try {
      loaded = loadDocumentForImport(abs, src.source_path);
    } catch {
      summary.unchanged++;
      continue;
    }
    const raw = loaded.text;
    const content_hash = loaded.source_content_hash;
    const renderedTextHash = sha256(raw);
    upsertSourceExtraction(db, {
      source_path: src.source_path,
      source_content_hash: content_hash,
      method: loaded.ir.method,
      status: loaded.ir.status,
      quality: loaded.ir.metrics.extraction_quality,
      warnings: loaded.ir.warnings,
      metrics: loaded.ir.metrics,
      text_hash: renderedTextHash,
      indexed_at,
    });
    if (loaded.ir.status === "needs_ocr" || loaded.ir.status === "failed" || raw.trim().length === 0) {
      summary.tombstoned_chunks += removeIndexedSource(db, src.source_path);
      continue;
    }
    if (
      content_hash === src.source_content_hash &&
      !needsDocumentIrRepair(priorExtraction, loaded, renderedTextHash)
    ) {
      // mtime/size touched but content is the same — refresh stat and move on.
      upsertSource(db, {
        ...src,
        source_mtime_ms: mtime_ms,
        source_size: stat.size,
        last_indexed_at: indexed_at,
      });
      summary.unchanged++;
      continue;
    }

    const { frontmatter } = parseMarkdown(raw);
    const scope = resolveScope({
      source_path: src.source_path,
      frontmatter,
      config: cfg,
    });
    const chunks = chunk(raw, {
      source_path: src.source_path,
      source_content_hash: content_hash,
      indexed_at,
      target_tokens: cfg.chunking.target_tokens,
      max_tokens: cfg.chunking.max_tokens,
      default_scope: scope,
    });
    const newIds = new Set(chunks.map((c) => c.version_id));
    const priorCurrent = listChunkVersionIdsForSource(
      db,
      src.source_path,
      "current",
    );
    for (const oldId of priorCurrent) {
      if (!newIds.has(oldId)) {
        tombstoneChunk(db, oldId);
        summary.tombstoned_chunks++;
      }
    }
    for (const c of chunks) {
      persistChunkWithAnchors(db, c, scope);
    }
    upsertSource(db, {
      source_path: src.source_path,
      source_mtime_ms: mtime_ms,
      source_size: stat.size,
      source_content_hash: content_hash,
      last_indexed_at: indexed_at,
      chunk_count: chunks.length,
    });
    const role = resolveDocRole({
      source_path: src.source_path,
      frontmatter,
      config: cfg,
    });
    upsertSourceProfile(
      db,
      buildSourceProfile({
        source_path: src.source_path,
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
    summary.reindexed++;
  }

  // PRD-0035 / slice 35.1: parity with the doc-chunk loop above.
  // A code-source whose file no longer exists on disk is tombstoned
  // (row + FTS5 entry) via the storage primitive in store/code-sources.ts.
  // Renames are handled by the natural delete-then-add pattern: contexttrail index
  // tombstones the old path; a subsequent contexttrail import indexes the new one.
  for (const stored of listCodeSources(db)) {
    const abs = join(cwd, stored.facts.file_path);
    if (!existsSync(abs)) {
      deleteCodeSource(db, stored.facts.file_path);
      summary.tombstoned_code_sources++;
    }
  }
  syncCodeGraph(db);

  closeDb(db);
  return summary;
}

function removeIndexedSource(db: ReturnType<typeof openDb>, sourcePath: string): number {
  const ids = listChunkVersionIdsForSource(db, sourcePath, "current");
  for (const id of ids) {
    tombstoneChunk(db, id);
  }
  deleteSourceProfile(db, sourcePath);
  deleteSource(db, sourcePath);
  return ids.length;
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

export function formatIndexSummary(s: IndexSummary): string {
  const base = `${s.unchanged} unchanged, ${s.reindexed} reindexed, ${s.tombstoned_chunks} chunks tombstoned`;
  if (s.tombstoned_code_sources > 0) {
    return `${base}, ${s.tombstoned_code_sources} code-sources tombstoned`;
  }
  return base;
}
