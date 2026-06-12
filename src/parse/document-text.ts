import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import {
  buildDocumentIr,
  layoutRiskScore,
  renderDocumentForChunking,
  type DocumentBlock,
  type DocumentExtractionStatus,
  type DocumentIR,
} from "./document-ir.js";
import {
  assemblePdfLines,
  buildPdfBlocks,
  pdfPlainTextLines,
  type ExtractedPdfDocument,
  type PdfPageLines,
  type PdfStructureSummary,
} from "./pdf-structure.js";
import { readOcrCacheText } from "./ocr-local.js";
import {
  runExtractorJobSync,
  runExtractorJobsSync,
  type ExtractorBatchJob,
  type ExtractorOutcome,
} from "./extractor-pool.js";

export type LoadedDocumentForImport = {
  ir: DocumentIR;
  text: string;
  source_content_hash: string;
  warnings: string[];
};

export type LoadedDocumentText = {
  text: string;
  source_content_hash: string;
  warnings: string[];
};

export function loadDocumentText(path: string): LoadedDocumentText {
  const loaded = loadDocumentForImport(path);
  return {
    text: loaded.text,
    source_content_hash: loaded.source_content_hash,
    warnings: loaded.warnings,
  };
}

/**
 * Raw worker-pool outcome for a document's primary extraction (PDF document
 * extraction or DOCX→HTML), produced ahead of time by
 * `precomputeDocumentExtractions` so a large import can run extractions in
 * parallel while `loadDocumentForImport` stays synchronous. Decoding (JSON
 * parse / failure shaping) happens inside the loaders so a precomputed
 * outcome takes exactly the same success/failure paths as an inline one.
 */
export type PrecomputedDocumentExtraction = ExtractorOutcome;

/** True when importing `path` goes through the extraction worker pool. */
export function documentNeedsExtraction(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return ext === ".pdf" || ext === ".docx";
}

/**
 * Runs the primary extraction for each PDF/DOCX through the worker pool with
 * up to pool-size parallelism, blocking until all complete. Results are keyed
 * by each file's `key` and meant to be handed back to `loadDocumentForImport`
 * as its `precomputed` argument. Non-extractable files are ignored.
 */
export function precomputeDocumentExtractions(
  files: Array<{ key: string; path: string }>,
  onProgress?: (done: number, total: number) => void,
): Map<string, PrecomputedDocumentExtraction> {
  const jobs: ExtractorBatchJob[] = [];
  for (const file of files) {
    const ext = extname(file.path).toLowerCase();
    if (ext === ".pdf") {
      jobs.push({ key: file.key, kind: "pdf", path: file.path });
    } else if (ext === ".docx") {
      jobs.push({ key: file.key, kind: "docx-html", path: file.path });
    }
  }
  return runExtractorJobsSync(jobs, onProgress);
}

export type LoadDocumentOptions = {
  /**
   * Workspace root (the directory containing `.contexttrail/`). Only used to
   * look up the local OCR cache for PDFs whose text layer is empty; callers
   * without a workspace (unit tests, ad-hoc loads) may omit it and get the
   * pre-OCR behavior (`needs_ocr`).
   */
  workspaceRoot?: string;
};

export function loadDocumentForImport(
  path: string,
  sourcePath = path,
  precomputed?: PrecomputedDocumentExtraction,
  options?: LoadDocumentOptions,
): LoadedDocumentForImport {
  const bytes = readFileSync(path);
  const source_content_hash = sha256(bytes);
  const ext = extname(path).toLowerCase();
  const ir =
    ext === ".docx"
      ? loadDocxIr(path, sourcePath, source_content_hash, precomputed)
      : ext === ".pdf"
        ? loadPdfIr(path, sourcePath, source_content_hash, precomputed, options)
        : loadPlainTextIr(bytes, ext, sourcePath, source_content_hash);
  const text = renderDocumentForChunking(ir);
  return {
    ir: {
      ...ir,
      text_for_chunking: text,
    },
    text,
    source_content_hash,
    warnings: ir.warnings,
  };
}

function loadPlainTextIr(
  bytes: Buffer,
  ext: string,
  sourcePath: string,
  sourceContentHash: string,
): DocumentIR {
  const decoded = decodeTextBytes(bytes);
  return buildDocumentIr({
    source_path: sourcePath,
    source_content_hash: sourceContentHash,
    method: ext === ".md" || ext === ".markdown" ? "markdown" : "plain_text",
    blocks: [{ type: "paragraph", text: decoded.text }],
    warnings: decoded.warnings,
  });
}

/** Sample size used for NUL / replacement-character ratio checks. */
const TEXT_DECODE_SAMPLE_CHARS = 1000;
/** Above this NUL ratio a blind UTF-8 decode is assumed to really be UTF-16. */
const TEXT_DECODE_UTF16_RETRY_RATIO = 0.1;
/** Above this noise ratio the best-effort decode is flagged as degraded. */
const TEXT_DECODE_NOISE_WARN_RATIO = 0.02;

/**
 * Decodes plain-text/markdown bytes with BOM detection instead of assuming
 * UTF-8: a blind utf8 decode turns UTF-16 files (e.g. PowerShell `>`
 * redirects) into NUL-interleaved garbage that still indexes as "good", and
 * leaks UTF-8 BOMs into the first characters. Exported for tests.
 */
export function decodeTextBytes(bytes: Buffer): { text: string; warnings: string[] } {
  const text = decodeWithBomDetection(bytes);
  const warnings: string[] = [];
  if (decodeNoiseRatio(text) > TEXT_DECODE_NOISE_WARN_RATIO) {
    warnings.push(
      "File does not look like UTF-8 text; some characters could not be decoded.",
    );
  }
  return { text, warnings };
}

function decodeWithBomDetection(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3).toString("utf8");
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString("utf16le");
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return swapUtf16Bytes(bytes.subarray(2)).toString("utf16le");
  }
  const utf8 = bytes.toString("utf8");
  if (charRatio(utf8, (ch) => ch === "\u0000") > TEXT_DECODE_UTF16_RETRY_RATIO) {
    // BOM-less UTF-16LE decoded as UTF-8 comes out NUL-interleaved; retry as
    // UTF-16LE and keep it only when the result looks like sane text.
    const utf16 = bytes.toString("utf16le");
    if (decodeNoiseRatio(utf16) < TEXT_DECODE_UTF16_RETRY_RATIO) return utf16;
  }
  return utf8;
}

function swapUtf16Bytes(bytes: Buffer): Buffer {
  const swapped = Buffer.from(bytes);
  // Buffer.swap16 throws on odd lengths; drop a trailing odd byte instead.
  const even = swapped.subarray(0, swapped.length - (swapped.length % 2));
  even.swap16();
  return even;
}

function decodeNoiseRatio(text: string): number {
  return charRatio(text, (ch) => ch === "\u0000" || ch === "\uFFFD");
}

function charRatio(text: string, matches: (ch: string) => boolean): number {
  const sample = text.slice(0, TEXT_DECODE_SAMPLE_CHARS);
  if (sample.length === 0) return 0;
  let count = 0;
  for (const ch of sample) {
    if (matches(ch)) count += 1;
  }
  return count / sample.length;
}

function loadPdfIr(
  path: string,
  sourcePath: string,
  sourceContentHash: string,
  precomputed?: PrecomputedDocumentExtraction,
  options?: LoadDocumentOptions,
): DocumentIR {
  try {
    const extracted = extractPdfDocument(path, precomputed);
    const pages: PdfPageLines[] = extracted.pages.map((page) => ({
      num: page.num,
      lines: assemblePdfLines(page.items),
    }));
    const built = buildPdfBlocks({
      pages,
      fields: extracted.fields,
      tables: extracted.tables,
    });
    if (built.blocks.length === 0) {
      const ocrIr = cachedOcrIr({
        workspaceRoot: options?.workspaceRoot,
        sourcePath,
        sourceContentHash,
        pageCount: extracted.page_count,
      });
      if (ocrIr) return ocrIr;
      const warning =
        "PDF has no extractable text layer; OCR is required before it can be used as evidence. Run `contexttrail ocr` (uses locally installed tesseract + poppler) to make it searchable.";
      return buildDocumentIr({
        source_path: sourcePath,
        source_content_hash: sourceContentHash,
        method: "pdf_text_layer",
        status: "needs_ocr",
        blocks: [],
        page_count: extracted.page_count,
        warnings: [warning],
      });
    }
    const warnings = [...extracted.notes];
    const plainText = pdfPlainTextLines(pages);
    if (!plainText.trim() && built.summary.form_field_count > 0) {
      warnings.push(
        `PDF has no extractable text layer; indexed ${built.summary.form_field_count} filled form-field value(s) only. Page imagery was not OCRed.`,
      );
    }
    const structured = hasRecoveredStructure(built.summary);
    let status: DocumentExtractionStatus;
    if (classifyPdfExtraction(plainText) === "layout_sensitive") {
      if (structured) {
        status = "parsed_with_warnings";
        warnings.push(
          `PDF form/table structure was reconstructed from the text layer (${describePdfStructure(built.summary)}); verify critical figures against the original document before final decisions.`,
        );
      } else {
        status = "layout_sensitive";
        warnings.push(
          "PDF text layer appears layout-sensitive; citations from this source should be treated as weak until reviewed or OCR/layout extraction is improved.",
        );
      }
    } else {
      status = warnings.length > 0 ? "parsed_with_warnings" : "indexed";
    }
    return buildDocumentIr({
      source_path: sourcePath,
      source_content_hash: sourceContentHash,
      method: "pdf_text_layer",
      status,
      blocks: built.blocks,
      page_count: extracted.page_count,
      warnings,
    });
  } catch (err) {
    return failedIr(sourcePath, sourceContentHash, "pdf_text_layer", err);
  }
}

/**
 * `contexttrail ocr` import hook: a PDF whose text layer is empty normally
 * surfaces as `needs_ocr`, but when a local OCR pass has already cached text
 * for this exact content hash (`.contexttrail/cache/ocr/<hash>.txt`), that
 * text is indexed instead under method "ocr_local". Returns null when there
 * is no workspace root or no usable cached text.
 */
function cachedOcrIr(args: {
  workspaceRoot: string | undefined;
  sourcePath: string;
  sourceContentHash: string;
  pageCount: number | undefined;
}): DocumentIR | null {
  if (!args.workspaceRoot) return null;
  const cached = readOcrCacheText(args.workspaceRoot, args.sourceContentHash);
  if (!cached || cached.trim().length === 0) return null;
  const warnings = [
    "Text was recovered with local OCR (`contexttrail ocr`); verify critical figures against the original scan.",
  ];
  // Reuse the text-layer quality heuristics: noisy/layout-heavy OCR output
  // is downgraded to parsed_with_warnings instead of clean indexed.
  const noisy = classifyPdfExtraction(cached) === "layout_sensitive";
  return buildDocumentIr({
    source_path: args.sourcePath,
    source_content_hash: args.sourceContentHash,
    method: "ocr_local",
    status: noisy ? "parsed_with_warnings" : "indexed",
    blocks: ocrPageBlocks(cached),
    page_count: args.pageCount,
    warnings,
  });
}

/** Splits cached OCR text (pages separated by \f) into paragraph blocks. */
function ocrPageBlocks(text: string): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];
  text.split("\f").forEach((pageText, index) => {
    for (const paragraph of pageText.split(/\n[ \t]*\n+/)) {
      const trimmed = paragraph.trim();
      if (trimmed) blocks.push({ type: "paragraph", text: trimmed, page: index + 1 });
    }
  });
  return blocks;
}

function hasRecoveredStructure(summary: PdfStructureSummary): boolean {
  return (
    summary.form_field_count > 0 ||
    summary.key_value_count >= 2 ||
    summary.table_count >= 1
  );
}

function describePdfStructure(summary: PdfStructureSummary): string {
  const parts: string[] = [];
  if (summary.key_value_count > 0) parts.push(`${summary.key_value_count} key-value line(s)`);
  if (summary.table_count > 0) {
    parts.push(`${summary.table_count} table(s) with ${summary.table_row_count} row(s)`);
  }
  if (summary.form_field_count > 0) parts.push(`${summary.form_field_count} filled form field(s)`);
  return parts.join(", ") || "no structured elements";
}

function loadDocxIr(
  path: string,
  sourcePath: string,
  sourceContentHash: string,
  precomputed?: PrecomputedDocumentExtraction,
): DocumentIR {
  try {
    const result = extractDocxHtml(path, precomputed);
    const warnings = [...result.messages];
    const blocks = blocksFromMammothHtml(result.html, warnings);
    if (blocks.length === 0) {
      warnings.push("DOCX produced no structured HTML blocks; falling back to raw text extraction.");
      return docxRawFallback(path, sourcePath, sourceContentHash, warnings);
    }
    return buildDocumentIr({
      source_path: sourcePath,
      source_content_hash: sourceContentHash,
      method: "docx",
      status: warnings.length > 0 ? "parsed_with_warnings" : "indexed",
      blocks,
      warnings,
    });
  } catch (err) {
    try {
      return docxRawFallback(path, sourcePath, sourceContentHash, [
        `DOCX structured extraction failed; fell back to raw text: ${errorMessage(err)}`,
      ]);
    } catch (fallbackErr) {
      return failedIr(sourcePath, sourceContentHash, "docx", fallbackErr);
    }
  }
}

function docxRawFallback(
  path: string,
  sourcePath: string,
  sourceContentHash: string,
  warnings: string[],
): DocumentIR {
  const text = extractDocxRaw(path);
  return buildDocumentIr({
    source_path: sourcePath,
    source_content_hash: sourceContentHash,
    method: "docx",
    status: text.trim() ? "parsed_with_warnings" : "failed",
    blocks: text.trim() ? [{ type: "paragraph", text }] : [],
    warnings,
  });
}

function failedIr(
  sourcePath: string,
  sourceContentHash: string,
  method: DocumentIR["method"],
  err: unknown,
): DocumentIR {
  const message =
    err instanceof ExtractorError
      ? err.message
      : `Document extraction failed: ${errorMessage(err)}`;
  return buildDocumentIr({
    source_path: sourcePath,
    source_content_hash: sourceContentHash,
    method,
    status: "failed",
    blocks: [],
    warnings: [message],
  });
}

function extractDocxRaw(path: string): string {
  // Trim matches the previous subprocess contract, which trimmed the child's
  // whole stdout before returning it.
  return decodeExtractorOutcome<{ text: string }>(
    runExtractorJobSync("docx-raw", path),
    "DOCX",
  ).text.trim();
}

function extractDocxHtml(
  path: string,
  precomputed?: PrecomputedDocumentExtraction,
): { html: string; messages: string[] } {
  return decodeExtractorOutcome(precomputed ?? runExtractorJobSync("docx-html", path), "DOCX");
}

function extractPdfDocument(
  path: string,
  precomputed?: PrecomputedDocumentExtraction,
): ExtractedPdfDocument {
  return decodeExtractorOutcome(precomputed ?? runExtractorJobSync("pdf", path), "PDF");
}

/** Cap on extractor failure detail surfaced into user-facing warnings. */
const EXTRACTOR_REASON_MAX_CHARS = 300;

/**
 * Sentinel the retired inline extractor script prefixed its failure line
 * with; still recognized by extractorFailureMessage's stderr shaping.
 */
const EXTRACTOR_ERROR_SENTINEL = "EXTRACTOR_ERROR:";

/** Document kind label used in user-facing extractor failure messages. */
type ExtractorKind = "PDF" | "DOCX";

/**
 * Extractor failure whose message is already shaped for end users; failedIr
 * surfaces it verbatim instead of wrapping it in the generic prefix.
 */
class ExtractorError extends Error {}

/**
 * Decodes a worker-pool outcome into the extractor's parsed JSON result, or
 * throws an ExtractorError carrying the same concise user-facing message the
 * subprocess-based extractor produced for the equivalent failure.
 */
function decodeExtractorOutcome<T>(outcome: ExtractorOutcome, kind: ExtractorKind): T {
  if (!outcome.ok) {
    throw new ExtractorError(extractorOutcomeMessage(outcome, kind));
  }
  return JSON.parse(outcome.json) as T;
}

function extractorOutcomeMessage(
  outcome: Exclude<ExtractorOutcome, { ok: true }>,
  kind: ExtractorKind,
): string {
  if (outcome.code === "payload_too_large") return extractorOversizeMessage(kind);
  const reason = outcome.reason.trim();
  return `${kind} extraction failed: ${
    reason ? truncateExtractorReason(reason) : "extractor failed before producing output"
  }`;
}

/**
 * The 256MB cap moved from the subprocess stdout buffer (ENOBUFS) to the
 * worker response payload, but the user-facing message is unchanged.
 */
function extractorOversizeMessage(kind: ExtractorKind): string {
  return `${kind} text layer too large to extract (exceeded 256MB extractor buffer)`;
}

function truncateExtractorReason(reason: string): string {
  return reason.length <= EXTRACTOR_REASON_MAX_CHARS
    ? reason
    : `${reason.slice(0, EXTRACTOR_REASON_MAX_CHARS)}…`;
}

/**
 * Shapes an execFileSync-style failure into a concise, user-facing message.
 * Raw execFileSync errors embed the full command line — including the entire
 * inline extractor script — plus the child's stderr (verified at ~66KB for a
 * zero-byte PDF); none of that belongs in warnings or the db. Extraction now
 * runs in persistent worker_threads (see extractorOutcomeMessage), but this
 * shaping is kept exported as the documented message contract and for tests.
 */
export function extractorFailureMessage(err: unknown, kind: ExtractorKind): string {
  const failure = err as { code?: unknown; status?: unknown; stderr?: unknown };
  if (failure?.code === "ENOBUFS") {
    return extractorOversizeMessage(kind);
  }
  const reason =
    extractorStderrReason(failure?.stderr) ??
    (typeof failure?.status === "number"
      ? `extractor exited with status ${failure.status}`
      : "extractor failed before producing output");
  return `${kind} extraction failed: ${reason}`;
}

function extractorStderrReason(stderr: unknown): string | undefined {
  const text =
    typeof stderr === "string" ? stderr : Buffer.isBuffer(stderr) ? stderr.toString("utf8") : "";
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sentinel = [...lines]
    .reverse()
    .find((line) => line.startsWith(EXTRACTOR_ERROR_SENTINEL));
  // No sentinel means the child died before its own catch ran (OOM, signal);
  // fall back to the last stderr line that is not stack-trace furniture.
  const reason = sentinel
    ? sentinel.slice(EXTRACTOR_ERROR_SENTINEL.length).trim()
    : (lines.filter((line) => !line.startsWith("at ") && !/^Node\.js v\d/.test(line)).at(-1) ?? "");
  if (!reason) return undefined;
  return truncateExtractorReason(reason);
}

function classifyPdfExtraction(text: string): DocumentExtractionStatus {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const risk = layoutRiskScore(text);
  const hasKnownFormShape =
    /\b(schedule\s+k-1|form\s+1065|partner'?s share|box\s+\d+[a-z]?|checkbox|tax form)\b/i
      .test(text);
  const hasSparseFormShape =
    lines.length >= 12 &&
    lines.filter((line) => /^[A-Z0-9][A-Z0-9 /&().,'-]{2,}$/.test(line) && line.length <= 70)
      .length >= 6;
  if (
    (hasKnownFormShape && risk >= 0.35) ||
    risk >= 0.85 ||
    (hasSparseFormShape && risk >= 0.55)
  ) {
    return "layout_sensitive";
  }
  return "indexed";
}

function blocksFromMammothHtml(html: string, warnings: string[]): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];
  const blockRe = /<(h[1-6]|p|li|table)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(blockRe)) {
    const tag = match[1]!.toLowerCase();
    const inner = match[2] ?? "";
    if (tag === "table") {
      const parsed = parseHtmlTable(inner);
      if (parsed.rows.length > 0) {
        blocks.push({ type: "table", rows: parsed.rows });
        if (parsed.malformed) {
          warnings.push("DOCX table has uneven row width; blank cells were inserted for chunking.");
        }
      }
      continue;
    }
    const text = htmlToText(inner);
    if (!text) continue;
    if (/^h[1-6]$/.test(tag)) {
      blocks.push({ type: "heading", level: Number(tag.slice(1)), text });
    } else {
      blocks.push({ type: "paragraph", text: tag === "li" ? `- ${text}` : text });
    }
  }
  if (blocks.length === 0) {
    const text = htmlToText(html);
    if (text) blocks.push({ type: "paragraph", text });
  }
  return blocks;
}

function parseHtmlTable(html: string): { rows: string[][]; malformed: boolean } {
  const rows: string[][] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const rowMatch of html.matchAll(rowRe)) {
    const rowHtml = rowMatch[1] ?? "";
    const cells = [...rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((cellMatch) => htmlToText(cellMatch[1] ?? ""));
    if (cells.some((cell) => cell.length > 0)) rows.push(cells);
  }
  const widths = new Set(rows.map((row) => row.length));
  return { rows, malformed: widths.size > 1 };
}

function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>\s*<p\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
