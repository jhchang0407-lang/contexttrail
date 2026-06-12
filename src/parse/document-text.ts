import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
import { localOcrUnavailableMessage } from "./ocr.js";

const requireFromHere = createRequire(import.meta.url);

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

export function loadDocumentForImport(
  path: string,
  sourcePath = path,
): LoadedDocumentForImport {
  const bytes = readFileSync(path);
  const source_content_hash = sha256(bytes);
  const ext = extname(path).toLowerCase();
  const ir =
    ext === ".docx"
      ? loadDocxIr(path, sourcePath, source_content_hash)
      : ext === ".pdf"
        ? loadPdfIr(path, sourcePath, source_content_hash)
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
): DocumentIR {
  try {
    const extracted = extractPdfDocument(path);
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
      const warning =
        `PDF has no extractable text layer; OCR is required before it can be used as evidence. ${localOcrUnavailableMessage()}`;
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
): DocumentIR {
  try {
    const result = extractDocxHtml(path);
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
  const mammothPath = requireFromHere.resolve("mammoth");
  return runNodeExtractor(`
    const mammoth = require(${JSON.stringify(mammothPath)});
    const result = await mammoth.extractRawText({ path: inputPath });
    process.stdout.write(result.value || "");
  `, path, "DOCX");
}

function extractDocxHtml(path: string): { html: string; messages: string[] } {
  const mammothPath = requireFromHere.resolve("mammoth");
  return runNodeJson(`
    const mammoth = require(${JSON.stringify(mammothPath)});
    const result = await mammoth.convertToHtml({ path: inputPath });
    process.stdout.write(JSON.stringify({
      html: result.value || "",
      messages: (result.messages || []).map((message) => message.message || String(message)).filter(Boolean),
    }));
  `, path, "DOCX");
}

/**
 * Ruled-table detection walks every page's operator list, which gets costly on
 * very large PDFs; positioned text and form fields are still extracted in full.
 */
const PDF_TABLE_DETECTION_MAX_PAGES = 50;

function extractPdfDocument(path: string): ExtractedPdfDocument {
  const pdfParsePath = requireFromHere.resolve("pdf-parse");
  return runNodeJson(`
    const { readFile } = await import("node:fs/promises");
    const pdfParse = require(${JSON.stringify(pdfParsePath)});
    const parser = new pdfParse.PDFParse({ data: await readFile(inputPath) });
    const out = { page_count: 0, pages: [], fields: [], tables: [], notes: [] };
    try {
      if (typeof parser.load !== "function") {
        throw new Error("pdf-parse internal load() is unavailable; positioned text extraction needs a compatible pdf-parse version");
      }
      const doc = await parser.load();
      out.page_count = doc.numPages;
      for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
        const page = await doc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const items = [];
        for (const item of content.items) {
          if (typeof item.str !== "string" || item.str.length === 0) continue;
          const point = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
          items.push({
            str: item.str,
            x: Math.round(point[0] * 100) / 100,
            y: Math.round(point[1] * 100) / 100,
            width: Math.round((item.width || 0) * 100) / 100,
            height: Math.round((item.height || 0) * 100) / 100,
          });
        }
        out.pages.push({ num: pageNum, items });
        let annotations = [];
        try {
          annotations = (await page.getAnnotations()) || [];
        } catch {
          annotations = [];
        }
        for (const annotation of annotations) {
          if (annotation.subtype !== "Widget" || annotation.hidden) continue;
          const label = String(annotation.alternativeText || annotation.fieldName || "").trim();
          let value = "";
          if (annotation.fieldType === "Tx" || annotation.fieldType === "Ch") {
            const raw = annotation.fieldValue;
            value = Array.isArray(raw) ? raw.filter(Boolean).join(", ") : String(raw ?? "");
          } else if (annotation.fieldType === "Btn" && !annotation.pushButton) {
            const raw = annotation.fieldValue;
            if (annotation.checkBox) {
              value = raw && raw !== "Off" ? "checked" : "";
            } else if (raw && raw !== "Off" && raw === annotation.buttonValue) {
              value = String(raw);
            }
          }
          value = value.trim();
          if (!value) continue;
          out.fields.push({ page: pageNum, label, value });
        }
        page.cleanup();
      }
      if (doc.numPages > 0 && doc.numPages <= ${PDF_TABLE_DETECTION_MAX_PAGES}) {
        try {
          const tableResult = await parser.getTable();
          for (const pageResult of tableResult.pages || []) {
            for (const rows of pageResult.tables || []) {
              out.tables.push({ page: pageResult.num, rows });
            }
          }
        } catch (err) {
          out.notes.push("PDF ruled-table detection failed: " + (err && err.message ? err.message : String(err)));
        }
      }
    } finally {
      await parser.destroy();
    }
    process.stdout.write(JSON.stringify(out));
  `, path, "PDF");
}

/**
 * Cap on extractor subprocess output. Dense PDFs exceeded the previous 64MB
 * ceiling and died with a cryptic ENOBUFS before returning any text.
 */
const EXTRACTOR_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

/** Cap on subprocess failure detail surfaced into user-facing warnings. */
const EXTRACTOR_REASON_MAX_CHARS = 300;

/** Sentinel the inline extractor script prefixes its own failure line with. */
const EXTRACTOR_ERROR_SENTINEL = "EXTRACTOR_ERROR:";

/** Document kind label used in user-facing extractor failure messages. */
type ExtractorKind = "PDF" | "DOCX";

/**
 * Extractor failure whose message is already shaped for end users; failedIr
 * surfaces it verbatim instead of wrapping it in the generic prefix.
 */
class ExtractorError extends Error {}

/**
 * Shapes an execFileSync failure into a concise, user-facing message.
 * Raw execFileSync errors embed the full command line — including the entire
 * inline extractor script — plus the child's stderr (verified at ~66KB for a
 * zero-byte PDF); none of that belongs in warnings or the db. Exported for
 * tests.
 */
export function extractorFailureMessage(err: unknown, kind: ExtractorKind): string {
  const failure = err as { code?: unknown; status?: unknown; stderr?: unknown };
  if (failure?.code === "ENOBUFS") {
    return `${kind} text layer too large to extract (exceeded 256MB extractor buffer)`;
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
  return reason.length <= EXTRACTOR_REASON_MAX_CHARS
    ? reason
    : `${reason.slice(0, EXTRACTOR_REASON_MAX_CHARS)}…`;
}

function runNodeExtractor(body: string, path: string, kind: ExtractorKind): string {
  // The inline script reports its own failures on one sentinel line: node's
  // default crash report prints the throwing source line as a code frame,
  // which for minified bundles like pdf-parse is ~64KB of stderr that drowns
  // out (and can truncate away) the actual error message.
  const script = `
    import { createRequire } from "node:module";
    const require = createRequire(import.meta.url);
    const inputPath = process.argv[1];
    try {
      ${body}
    } catch (err) {
      const reason = err && err.message ? err.message : String(err);
      process.stderr.write(${JSON.stringify(EXTRACTOR_ERROR_SENTINEL)} + " " + reason + "\\n");
      process.exit(1);
    }
  `;
  try {
    return execFileSync(process.execPath, ["--input-type=module", "-e", script, path], {
      encoding: "utf8",
      maxBuffer: EXTRACTOR_MAX_BUFFER_BYTES,
      // Capture stderr for failure shaping instead of echoing it to the
      // parent terminal alongside the warning that already reports it.
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    throw new ExtractorError(extractorFailureMessage(err, kind));
  }
}

function runNodeJson<T>(body: string, path: string, kind: ExtractorKind): T {
  return JSON.parse(runNodeExtractor(body, path, kind)) as T;
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
