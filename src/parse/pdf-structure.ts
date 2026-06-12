import type { DocumentBlock } from "./document-ir.js";

/**
 * Structured reconstruction of PDF content from positioned text items.
 *
 * pdf.js getTextContent() reports every text run with viewport geometry, and
 * emits wide horizontal gaps (form-cell gutters, label/value spacing) as
 * standalone whitespace items. Plain text joins lose that signal, which is why
 * organized documents (K-1s, ruled corporate forms, financial statements) used
 * to flatten into prose soup. This module rebuilds lines and cells from the
 * geometry, then lifts them into DocumentBlocks: key-value pairs, tables,
 * headings, and paragraphs.
 */

export type PdfTextItem = {
  str: string;
  /** Viewport coordinates at scale 1: x grows right, y grows down. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ExtractedPdfPage = {
  num: number;
  items: PdfTextItem[];
};

export type PdfFormField = {
  page: number;
  label: string;
  value: string;
};

export type PdfRuledTable = {
  page: number;
  rows: string[][];
};

export type ExtractedPdfDocument = {
  page_count?: number;
  pages: ExtractedPdfPage[];
  fields: PdfFormField[];
  tables: PdfRuledTable[];
  notes: string[];
};

export type PdfLine = {
  y: number;
  height: number;
  cells: string[];
};

export type PdfPageLines = {
  num: number;
  lines: PdfLine[];
};

export type PdfStructureSummary = {
  heading_count: number;
  key_value_count: number;
  table_count: number;
  table_row_count: number;
  form_field_count: number;
};

export type PdfBlockBuildResult = {
  blocks: DocumentBlock[];
  summary: PdfStructureSummary;
};

/** Wide gaps relative to line height start a new cell; small gaps join words. */
const MIN_CELL_GAP = 8;
const CELL_GAP_HEIGHT_FACTOR = 2;
const WORD_GAP = 1.2;
/** Vertical gap (relative to line height) that splits paragraphs. */
const PARAGRAPH_GAP_FACTOR = 1.9;

export function assemblePdfLines(items: PdfTextItem[]): PdfLine[] {
  const usable = items.filter((item) => item.str.length > 0);
  const sorted = [...usable].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: PdfTextItem[][] = [];
  for (const item of sorted) {
    const row = rows[rows.length - 1];
    const anchor = row?.[0];
    if (row && anchor && Math.abs(item.y - anchor.y) <= lineTolerance(item, anchor)) {
      row.push(item);
    } else {
      rows.push([item]);
    }
  }
  return rows
    .map((row) => buildLineFromRow(row))
    .filter((line) => line.cells.length > 0);
}

function lineTolerance(a: PdfTextItem, b: PdfTextItem): number {
  return Math.max(2, Math.max(a.height, b.height) * 0.45);
}

function buildLineFromRow(row: PdfTextItem[]): PdfLine {
  const items = [...row].sort((a, b) => a.x - b.x);
  const height = Math.max(...items.map((item) => item.height), 0);
  const cellGap = Math.max(MIN_CELL_GAP, height * CELL_GAP_HEIGHT_FACTOR);
  const cells: string[] = [];
  let current = "";
  let right: number | undefined;
  for (const item of items) {
    // Whitespace-only items carry the gap geometry implicitly via the next
    // item's x position; skipping them (without advancing the right edge)
    // lets the gap test below see the true distance.
    if (item.str.trim().length === 0) continue;
    const gap = right === undefined ? 0 : item.x - right;
    if (current && gap > cellGap) {
      cells.push(current);
      current = item.str;
    } else if (current) {
      current += gap > WORD_GAP ? ` ${item.str}` : item.str;
    } else {
      current = item.str;
    }
    right = Math.max(right ?? 0, item.x + item.width);
  }
  if (current) cells.push(current);
  return {
    y: row.reduce((min, item) => Math.min(min, item.y), Number.POSITIVE_INFINITY),
    height,
    cells: cells
      .map((cell) => cell.replace(/[{}]{8,}/g, " ").replace(/\s+/g, " ").trim())
      .filter(Boolean),
  };
}

/** Plain rendition (cells joined by spaces) used for layout-risk scoring. */
export function pdfPlainTextLines(pages: PdfPageLines[]): string {
  return pages
    .flatMap((page) => page.lines.map((line) => line.cells.join(" ")))
    .join("\n");
}

export function buildPdfBlocks(input: {
  pages: PdfPageLines[];
  fields: PdfFormField[];
  tables: PdfRuledTable[];
}): PdfBlockBuildResult {
  const summary: PdfStructureSummary = {
    heading_count: 0,
    key_value_count: 0,
    table_count: 0,
    table_row_count: 0,
    form_field_count: 0,
  };
  const blocks: DocumentBlock[] = [];
  const fieldsByPage = new Map<number, PdfFormField[]>();
  for (const field of dedupeFields(input.fields)) {
    const existing = fieldsByPage.get(field.page) ?? [];
    existing.push(field);
    fieldsByPage.set(field.page, existing);
  }
  const tablesByPage = new Map<number, string[][][]>();
  for (const table of input.tables) {
    const rows = cleanRuledTableRows(table.rows);
    if (!rows) continue;
    const existing = tablesByPage.get(table.page) ?? [];
    existing.push(rows);
    tablesByPage.set(table.page, existing);
  }

  for (const page of input.pages) {
    const ruledTables = tablesByPage.get(page.num) ?? [];
    const ruledNorm = normalizeForMatch(
      ruledTables.flatMap((rows) => rows.flatMap((cells) => cells)).join(" "),
    );
    let paragraph: string[] = [];
    let tableRun: string[][] = [];
    let prev: PdfLine | undefined;

    const flushParagraph = () => {
      if (paragraph.length === 0) return;
      blocks.push({ type: "paragraph", text: paragraph.join("\n"), page: page.num });
      paragraph = [];
    };
    const flushTableRun = () => {
      if (tableRun.length === 0) return;
      if (tableRun.length >= 2) {
        blocks.push({ type: "table", rows: tableRun, page: page.num });
        summary.table_count += 1;
        summary.table_row_count += tableRun.length;
      } else {
        const cells = tableRun[0];
        if (cells) paragraph.push(cells.join(" "));
      }
      tableRun = [];
    };

    for (const line of page.lines) {
      const joined = line.cells.join(" ");
      if (isNoiseLine(joined)) {
        prev = line;
        continue;
      }
      if (ruledNorm.length > 0) {
        const lineNorm = normalizeForMatch(joined);
        if (lineNorm.length >= 6 && ruledNorm.includes(lineNorm)) {
          // Already captured by a ruled table on this page.
          prev = line;
          continue;
        }
      }
      if (prev && line.y - prev.y > Math.max(line.height, prev.height, MIN_CELL_GAP) * PARAGRAPH_GAP_FACTOR) {
        flushTableRun();
        flushParagraph();
      }
      const heading = headingFor(line);
      if (heading) {
        flushTableRun();
        flushParagraph();
        blocks.push({ type: "heading", level: heading.level, text: heading.text, page: page.num });
        summary.heading_count += 1;
        prev = line;
        continue;
      }
      const keyValue = keyValueFor(line);
      if (keyValue) {
        flushTableRun();
        flushParagraph();
        blocks.push({ type: "key_value", label: keyValue.label, value: keyValue.value, page: page.num });
        summary.key_value_count += 1;
        prev = line;
        continue;
      }
      if (line.cells.length >= 3) {
        flushParagraph();
        tableRun.push(line.cells);
        prev = line;
        continue;
      }
      flushTableRun();
      paragraph.push(joined);
      prev = line;
    }
    flushTableRun();
    flushParagraph();

    for (const rows of ruledTables) {
      blocks.push({ type: "table", rows, page: page.num });
      summary.table_count += 1;
      summary.table_row_count += rows.length;
    }
    for (const field of fieldsByPage.get(page.num) ?? []) {
      blocks.push({
        type: "key_value",
        label: field.label || "Form field",
        value: field.value,
        page: field.page,
      });
      summary.form_field_count += 1;
    }
  }

  // Fields reported for pages outside the text-page range still matter.
  const seenPages = new Set(input.pages.map((page) => page.num));
  for (const [pageNum, fields] of fieldsByPage) {
    if (seenPages.has(pageNum)) continue;
    for (const field of fields) {
      blocks.push({
        type: "key_value",
        label: field.label || "Form field",
        value: field.value,
        page: field.page,
      });
      summary.form_field_count += 1;
    }
  }

  return { blocks, summary };
}

function dedupeFields(fields: PdfFormField[]): PdfFormField[] {
  const seen = new Set<string>();
  const result: PdfFormField[] = [];
  for (const field of fields) {
    const key = `${field.page} ${field.label} ${field.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(field);
  }
  return result;
}

function cleanRuledTableRows(rows: string[][]): string[][] | null {
  const cleaned = rows
    .map((row) => row.map((cell) => cell.replace(/\s+/g, " ").trim()))
    .filter((row) => row.some((cell) => cell.length > 0));
  const width = Math.max(0, ...cleaned.map((row) => row.length));
  const nonEmptyCells = cleaned.flat().filter((cell) => cell.length > 0);
  if (cleaned.length < 2 || width < 2 || nonEmptyCells.length < 3) return null;
  if (normalizeForMatch(nonEmptyCells.join(" ")).length < 12) return null;
  return cleaned;
}

const HEADING_STOP_WORDS = /^(of|to|in|on|at|as|is|or|by|for|the|and)$/i;

function headingFor(line: PdfLine): { level: number; text: string } | null {
  if (line.cells.length !== 1) return null;
  const text = line.cells[0]!;
  if (text.length > 90 || /[.;,]$/.test(text)) return null;
  const scheduleOrForm = text.match(/^(schedule|form)\s+([a-z0-9][a-z0-9-]{0,11})\b/i);
  if (scheduleOrForm && text.length <= 60) {
    const token = scheduleOrForm[2]!;
    const formLike = /\d/.test(token) || (token.length <= 2 && !HEADING_STOP_WORDS.test(token));
    if (formLike) return { level: 1, text };
  }
  if (/^(part|section|article)\s+([ivxlcdm]+|\d{1,3}[a-z]?)\b/i.test(text)) {
    return { level: 2, text };
  }
  return null;
}

/** Dotted leaders ("Label ...... 1,234") act as a cell separator. */
const LEADER_RE = /\s*(?:\.\s*){4,}/;

function keyValueFor(line: PdfLine): { label: string; value: string } | null {
  let label: string | undefined;
  let value: string | undefined;
  if (line.cells.length === 2) {
    label = line.cells[0];
    value = line.cells[1];
  } else if (line.cells.length === 1 && LEADER_RE.test(line.cells[0]!)) {
    const parts = line.cells[0]!.split(LEADER_RE);
    if (parts.length === 2) {
      label = parts[0];
      value = parts[1];
    }
  }
  if (label === undefined || value === undefined) return null;
  label = label.replace(/[.\s]{4,}$/, "").trim();
  value = value.trim();
  if (!label || !value) return null;
  if (label.length > 120 || value.length > 80) return null;
  if (!/[a-z0-9]/i.test(label)) return null;
  // Long values without any number-ish content are usually a second prose
  // column, not a form value.
  if (!/[0-9$%]/.test(value) && value.length > 30) return null;
  return { label, value };
}

function isNoiseLine(joined: string): boolean {
  if (joined.length === 0) return true;
  if (/^docusign envelope id:/i.test(joined)) return true;
  if (/^[\s~{}_|=\-]{8,}$/.test(joined)) return true;
  return false;
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
