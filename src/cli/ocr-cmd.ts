/**
 * `contexttrail ocr` — make scanned/image-only PDFs searchable.
 *
 * Finds sources whose stored extraction status is `needs_ocr` (optionally
 * filtered by globs), OCRs them with locally installed tesseract + pdftoppm,
 * writes the recovered text to `.contexttrail/cache/ocr/<content_hash>.txt`,
 * and re-runs import for those files so the text enters the index as method
 * "ocr_local".
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import fg from "fast-glob";
import {
  OCR_PAGE_CAP,
  locateOcrTools,
  ocrCachePath,
  ocrPdfWithLocalTools,
  ocrTextTooSparse,
  writeOcrCacheText,
  type LocalOcrPdfResult,
} from "../parse/ocr-local.js";
import { openDb, closeDb } from "../store/db.js";
import {
  listSourceExtractions,
  type StoredSourceExtraction,
} from "../store/source-extractions.js";
import { absoluteSourcePath, storageSourcePath } from "../source-path.js";
import { runImport } from "./import.js";

export type OcrRunDeps = {
  /** Environment used for PATH-based tool discovery (default: process.env). */
  env?: Record<string, string | undefined>;
  /**
   * Test seam: per-file OCR runner. When provided, PATH discovery of
   * tesseract/pdftoppm is skipped entirely so tests never need the tools.
   */
  ocrPdf?: (absPath: string, maxPages: number) => LocalOcrPdfResult;
  /** Per-file progress sink (default: console.log). */
  log?: (line: string) => void;
};

export type OcrRunSummary = {
  status: "ok" | "tools_missing";
  /** Install guidance; present only when status is "tools_missing". */
  guidance?: string;
  /** Sources OCRed and queued for re-import this run. */
  ocrd: number;
  /** Sources where OCR failed or produced unusable output (stay needs_ocr). */
  failed: number;
  /** Sources skipped (file gone, or OCR text already cached). */
  skipped: number;
  /** Chunks written by the re-import of successfully OCRed sources. */
  chunks_written: number;
  warnings: string[];
};

export function runOcr(
  cwd: string,
  patterns: string[] = [],
  deps: OcrRunDeps = {},
): OcrRunSummary {
  const log = deps.log ?? ((line: string) => console.log(line));
  const summary: OcrRunSummary = {
    status: "ok",
    ocrd: 0,
    failed: 0,
    skipped: 0,
    chunks_written: 0,
    warnings: [],
  };

  // Tool check comes first: when tesseract/pdftoppm are missing the command
  // prints install guidance and exits without touching anything.
  let ocrPdf = deps.ocrPdf;
  if (!ocrPdf) {
    const lookup = locateOcrTools(deps.env ?? process.env);
    if (!lookup.ok) {
      return { ...summary, status: "tools_missing", guidance: lookup.guidance };
    }
    const tools = lookup.tools;
    ocrPdf = (absPath, maxPages) => ocrPdfWithLocalTools(tools, absPath, { maxPages });
  }

  const candidates = listNeedsOcrSources(cwd, patterns, summary.warnings);
  if (candidates.length === 0) {
    log(
      patterns.length > 0
        ? "contexttrail ocr: no sources matching the given globs are waiting on OCR."
        : "contexttrail ocr: no sources are waiting on OCR (status needs_ocr). Run `contexttrail import` first.",
    );
    return summary;
  }

  const toImport: string[] = [];
  for (const extraction of candidates) {
    const rel = extraction.source_path;
    const abs = absoluteSourcePath(cwd, rel);
    if (!existsSync(abs)) {
      summary.skipped++;
      summary.warnings.push(`${rel}: file no longer exists; skipped.`);
      continue;
    }
    // Hash the file as it is on disk right now: the cache key must match the
    // hash `loadDocumentForImport` computes when the file is re-imported.
    const contentHash = sha256(readFileSync(abs));
    const cachePath = ocrCachePath(cwd, contentHash);
    if (existsSync(cachePath) && readFileSync(cachePath, "utf8").trim().length > 0) {
      summary.skipped++;
      toImport.push(rel);
      log(`ocr ${rel}: cached OCR text found; re-importing`);
      continue;
    }

    let result: LocalOcrPdfResult;
    try {
      result = ocrPdf(abs, OCR_PAGE_CAP);
    } catch (err) {
      summary.failed++;
      summary.warnings.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const totalPages = extraction.metrics.page_count;
    if (result.truncated || (totalPages ?? 0) > OCR_PAGE_CAP) {
      summary.warnings.push(
        `${rel}: OCR capped at the first ${OCR_PAGE_CAP} page(s)${
          totalPages && totalPages > OCR_PAGE_CAP ? ` of ${totalPages}` : ""
        }.`,
      );
    }
    if (ocrTextTooSparse(result.text)) {
      summary.failed++;
      summary.warnings.push(
        `${rel}: OCR produced almost no readable text; leaving the source as needs_ocr instead of indexing noise.`,
      );
      continue;
    }
    writeOcrCacheText(cwd, contentHash, result.text);
    summary.ocrd++;
    toImport.push(rel);
    log(`ocr ${rel}: ${result.page_count} page(s) → ${result.text.length} chars`);
  }

  if (toImport.length > 0) {
    const imported = runImport(
      cwd,
      toImport.map((sourcePath) => fg.escapePath(sourcePath)),
    );
    summary.chunks_written = imported.chunks_written;
    summary.warnings.push(...imported.warnings);
  }
  return summary;
}

function listNeedsOcrSources(
  cwd: string,
  patterns: string[],
  warnings: string[],
): StoredSourceExtraction[] {
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  let extractions: StoredSourceExtraction[];
  try {
    extractions = listSourceExtractions(db).filter(
      (extraction) => extraction.status === "needs_ocr",
    );
  } finally {
    closeDb(db);
  }
  if (patterns.length === 0) return extractions;
  const matched = expandPatternSourcePaths(cwd, patterns, warnings);
  return extractions.filter((extraction) => matched.has(extraction.source_path));
}

/**
 * Expands glob patterns the same way import does (negative `!patterns`
 * become the ignore set) into the set of storage source paths they match.
 */
function expandPatternSourcePaths(
  cwd: string,
  patterns: string[],
  warnings: string[],
): Set<string> {
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
  const matched = new Set<string>();
  for (const pattern of positive) {
    const absolutePattern = isAbsolute(pattern);
    try {
      const hits = fg.sync(pattern, {
        cwd,
        onlyFiles: true,
        dot: false,
        absolute: absolutePattern,
        ignore,
        suppressErrors: true,
      });
      for (const hit of hits) {
        const absolutePath = absolutePattern ? resolve(hit) : absoluteSourcePath(cwd, hit);
        matched.add(storageSourcePath(cwd, absolutePath));
      }
    } catch (err) {
      warnings.push(`${pattern}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return matched;
}

export function formatOcrSummary(summary: OcrRunSummary): string {
  return `${summary.ocrd} OCR'd, ${summary.failed} failed, ${summary.skipped} skipped, ${summary.chunks_written} chunks written`;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
