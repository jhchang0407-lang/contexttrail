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
  return buildDocumentIr({
    source_path: sourcePath,
    source_content_hash: sourceContentHash,
    method: ext === ".md" || ext === ".markdown" ? "markdown" : "plain_text",
    blocks: [{ type: "paragraph", text: bytes.toString("utf8") }],
  });
}

function loadPdfIr(
  path: string,
  sourcePath: string,
  sourceContentHash: string,
): DocumentIR {
  try {
    const extracted = extractPdf(path);
    const text = cleanExtractedPdfText(extracted.text);
    if (!text.trim()) {
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
    const warnings: string[] = [];
    const status = classifyPdfExtraction(text);
    if (status === "layout_sensitive") {
      warnings.push(
        "PDF text layer appears layout-sensitive; citations from this source should be treated as weak until reviewed or OCR/layout extraction is improved.",
      );
    }
    return buildDocumentIr({
      source_path: sourcePath,
      source_content_hash: sourceContentHash,
      method: "pdf_text_layer",
      status,
      blocks: pdfTextBlocks(text),
      page_count: extracted.page_count,
      warnings,
    });
  } catch (err) {
    return failedIr(sourcePath, sourceContentHash, "pdf_text_layer", err);
  }
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
  return buildDocumentIr({
    source_path: sourcePath,
    source_content_hash: sourceContentHash,
    method,
    status: "failed",
    blocks: [],
    warnings: [`Document extraction failed: ${errorMessage(err)}`],
  });
}

function extractDocxRaw(path: string): string {
  const mammothPath = requireFromHere.resolve("mammoth");
  return runNodeExtractor(`
    const mammoth = require(${JSON.stringify(mammothPath)});
    const result = await mammoth.extractRawText({ path: inputPath });
    process.stdout.write(result.value || "");
  `, path);
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
  `, path);
}

function extractPdf(path: string): { text: string; page_count?: number } {
  const pdfParsePath = requireFromHere.resolve("pdf-parse");
  return runNodeJson(`
    const { readFile } = await import("node:fs/promises");
    const pdfParse = require(${JSON.stringify(pdfParsePath)});
    const parser = new pdfParse.PDFParse({ data: await readFile(inputPath) });
    try {
      const result = await parser.getText();
      process.stdout.write(JSON.stringify({
        text: result.text || "",
        page_count: typeof result.total === "number" ? result.total : Array.isArray(result.pages) ? result.pages.length : undefined,
      }));
    } finally {
      await parser.destroy();
    }
  `, path);
}

function runNodeExtractor(body: string, path: string): string {
  const script = `
    import { createRequire } from "node:module";
    const require = createRequire(import.meta.url);
    const inputPath = process.argv[1];
    ${body}
  `;
  return execFileSync(process.execPath, ["--input-type=module", "-e", script, path], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function runNodeJson<T>(body: string, path: string): T {
  return JSON.parse(runNodeExtractor(body, path)) as T;
}

function cleanExtractedPdfText(text: string): string {
  return text
    .replace(/\f/g, "\n")
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, "")
    .replace(/^Docusign Envelope ID:\s*[A-Z0-9-]+\s*$/gim, "")
    .replace(/[{}]{8,}/g, " ")
    .replace(/^[\s~{}_|=\-]{8,}$/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

function pdfTextBlocks(text: string): DocumentBlock[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({ type: "paragraph", text: paragraph }));
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
