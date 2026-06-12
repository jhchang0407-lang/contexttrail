export const DOCUMENT_EXTRACTION_STATUSES = [
  "indexed",
  "parsed_with_warnings",
  "layout_sensitive",
  "needs_ocr",
  "failed",
] as const;

export type DocumentExtractionStatus = (typeof DOCUMENT_EXTRACTION_STATUSES)[number];

export const DOCUMENT_EXTRACTION_METHODS = [
  "markdown",
  "plain_text",
  "docx",
  "pdf_text_layer",
  "ocr_local",
] as const;

export type DocumentExtractionMethod = (typeof DOCUMENT_EXTRACTION_METHODS)[number];

export const DOCUMENT_EXTRACTION_QUALITIES = [
  "good",
  "usable",
  "weak",
  "unusable",
] as const;

export type DocumentExtractionQuality = (typeof DOCUMENT_EXTRACTION_QUALITIES)[number];

export type DocumentBlock =
  | { type: "paragraph"; text: string; page?: number }
  | { type: "heading"; text: string; level: number; page?: number }
  | { type: "table"; rows: string[][]; page?: number }
  | { type: "key_value"; label: string; value: string; page?: number };

export type DocumentIR = {
  source_path: string;
  source_content_hash: string;
  method: DocumentExtractionMethod;
  status: DocumentExtractionStatus;
  text_for_chunking: string;
  blocks: DocumentBlock[];
  metrics: {
    page_count?: number;
    text_chars: number;
    table_count: number;
    suspicious_line_count: number;
    extraction_quality: DocumentExtractionQuality;
  };
  warnings: string[];
};

export type BuildDocumentIrInput = {
  source_path: string;
  source_content_hash: string;
  method: DocumentExtractionMethod;
  blocks: DocumentBlock[];
  status?: DocumentExtractionStatus;
  warnings?: string[];
  page_count?: number;
};

export function buildDocumentIr(input: BuildDocumentIrInput): DocumentIR {
  const warnings = [...(input.warnings ?? [])];
  const rendered = renderBlocks(input.blocks);
  const metrics = calculateDocumentMetrics({
    blocks: input.blocks,
    text: rendered,
    page_count: input.page_count,
  });
  const status = input.status ?? statusForMetrics(metrics, warnings);
  const extraction_quality = qualityForStatus(status, metrics, warnings);
  const ir: DocumentIR = {
    source_path: input.source_path,
    source_content_hash: input.source_content_hash,
    method: input.method,
    status,
    text_for_chunking: rendered,
    blocks: input.blocks,
    metrics: {
      ...metrics,
      extraction_quality,
    },
    warnings,
  };
  return {
    ...ir,
    text_for_chunking: renderDocumentForChunking(ir),
  };
}

export function renderDocumentForChunking(ir: DocumentIR): string {
  return renderBlocks(ir.blocks).trim();
}

export function calculateSuspiciousLineCount(text: string): number {
  return linesOf(text).filter(isSuspiciousExtractionLine).length;
}

export function layoutRiskScore(text: string): number {
  const lines = linesOf(text);
  if (lines.length === 0) return 0;
  const shortLines = lines.filter((line) => line.length > 0 && line.length <= 18).length;
  const symbolHeavy = lines.filter((line) => symbolRatio(line) > 0.35).length;
  const allCapsLabels = lines.filter((line) =>
    /^[A-Z0-9][A-Z0-9 /&().,'-]{2,}$/.test(line) && line.length <= 80,
  ).length;
  const isolatedNumbers = lines.filter((line) => /^[A-Z]?\d{1,4}[A-Z]?$/.test(line)).length;
  const suspicious = calculateSuspiciousLineCount(text);
  return (
    shortLines / lines.length +
    symbolHeavy / lines.length +
    allCapsLabels / Math.max(lines.length, 1) +
    isolatedNumbers / Math.max(lines.length, 1) +
    suspicious / Math.max(lines.length, 1)
  );
}

function renderBlocks(blocks: DocumentBlock[]): string {
  const rendered: string[] = [];
  for (const block of blocks) {
    if (block.type === "heading") {
      rendered.push(`${"#".repeat(Math.max(1, Math.min(block.level, 6)))} ${block.text.trim()}`);
      continue;
    }
    if (block.type === "paragraph") {
      const text = block.text.trim();
      if (text) rendered.push(text);
      continue;
    }
    if (block.type === "key_value") {
      const label = block.label.trim();
      const value = block.value.trim();
      if (label || value) rendered.push(`- ${label}: ${value}`.trim());
      continue;
    }
    const table = renderMarkdownTable(block.rows);
    if (table) rendered.push(table);
  }
  return rendered.join("\n\n").trim();
}

function renderMarkdownTable(rows: string[][]): string {
  const nonEmptyRows = rows
    .map((row) => row.map((cell) => cleanTableCell(cell)))
    .filter((row) => row.some((cell) => cell.length > 0));
  if (nonEmptyRows.length === 0) return "";
  const width = Math.max(...nonEmptyRows.map((row) => row.length), 1);
  const padded = nonEmptyRows.map((row) => padRow(row, width));
  const header = padded[0]!;
  const divider = Array.from({ length: width }, () => "---");
  const body = padded.slice(1);
  return [header, divider, ...body]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

function padRow(row: string[], width: number): string[] {
  return [...row, ...Array.from({ length: Math.max(width - row.length, 0) }, () => "")];
}

function cleanTableCell(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

function calculateDocumentMetrics(args: {
  blocks: DocumentBlock[];
  text: string;
  page_count?: number;
}): Omit<DocumentIR["metrics"], "extraction_quality"> {
  return {
    ...(args.page_count !== undefined ? { page_count: args.page_count } : {}),
    text_chars: args.text.trim().length,
    table_count: args.blocks.filter((block) => block.type === "table").length,
    suspicious_line_count: calculateSuspiciousLineCount(args.text),
  };
}

function statusForMetrics(
  metrics: Omit<DocumentIR["metrics"], "extraction_quality">,
  warnings: string[],
): DocumentExtractionStatus {
  if (metrics.text_chars === 0) return "needs_ocr";
  if (warnings.length > 0) return "parsed_with_warnings";
  return "indexed";
}

function qualityForStatus(
  status: DocumentExtractionStatus,
  metrics: Omit<DocumentIR["metrics"], "extraction_quality">,
  warnings: string[],
): DocumentExtractionQuality {
  if (status === "failed" || status === "needs_ocr") return "unusable";
  if (status === "layout_sensitive") return "weak";
  if (warnings.length > 0 || metrics.suspicious_line_count > 0) return "usable";
  return "good";
}

function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isSuspiciousExtractionLine(line: string): boolean {
  if (/--\s*\d+\s+of\s+\d+\s*--/i.test(line)) return true;
  if (/^Docusign Envelope ID:/i.test(line)) return true;
  // Markdown table divider rows rendered from structured table blocks are
  // expected artifacts, not extraction noise.
  if (/^\|(?:\s*:?-{3,}:?\s*\|)+$/.test(line)) return false;
  if (/^[\s~{}_|=\-]{8,}$/.test(line)) return true;
  if (/[{}]{6,}/.test(line)) return true;
  if (/^\d+\s*$/.test(line) && line.length <= 3) return true;
  if (line.length > 30 && symbolRatio(line) > 0.45) return true;
  return false;
}

function symbolRatio(line: string): number {
  if (line.length === 0) return 0;
  const symbols = line.replace(/[A-Za-z0-9\s]/g, "").length;
  return symbols / line.length;
}
