import type {
  DocumentExtractionMethod,
  DocumentExtractionQuality,
  DocumentExtractionStatus,
  DocumentIR,
} from "../parse/document-ir.js";
import type { Db } from "./db.js";

export type StoredSourceExtraction = {
  source_path: string;
  source_content_hash: string;
  method: DocumentExtractionMethod;
  status: DocumentExtractionStatus;
  quality: DocumentExtractionQuality;
  warnings: string[];
  metrics: DocumentIR["metrics"];
  text_hash: string;
  indexed_at: string;
};

type SourceExtractionRow = {
  source_path: string;
  source_content_hash: string;
  method: DocumentExtractionMethod;
  status: DocumentExtractionStatus;
  quality: DocumentExtractionQuality;
  warnings_json: string;
  metrics_json: string;
  text_hash: string;
  indexed_at: string;
};

const UPSERT_SQL = `
INSERT INTO source_extractions (
  source_path,
  source_content_hash,
  method,
  status,
  quality,
  warnings_json,
  metrics_json,
  text_hash,
  indexed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(source_path) DO UPDATE SET
  source_content_hash=excluded.source_content_hash,
  method=excluded.method,
  status=excluded.status,
  quality=excluded.quality,
  warnings_json=excluded.warnings_json,
  metrics_json=excluded.metrics_json,
  text_hash=excluded.text_hash,
  indexed_at=excluded.indexed_at
`;

export function upsertSourceExtraction(
  db: Db,
  extraction: StoredSourceExtraction,
): void {
  db.prepare(UPSERT_SQL).run(
    extraction.source_path,
    extraction.source_content_hash,
    extraction.method,
    extraction.status,
    extraction.quality,
    JSON.stringify(extraction.warnings),
    JSON.stringify(extraction.metrics),
    extraction.text_hash,
    extraction.indexed_at,
  );
}

export function getSourceExtraction(
  db: Db,
  sourcePath: string,
): StoredSourceExtraction | null {
  const row = db
    .prepare("SELECT * FROM source_extractions WHERE source_path=?")
    .get(sourcePath) as SourceExtractionRow | undefined;
  return row ? decodeSourceExtraction(row) : null;
}

export function listSourceExtractions(db: Db): StoredSourceExtraction[] {
  const rows = db
    .prepare("SELECT * FROM source_extractions ORDER BY source_path")
    .all() as SourceExtractionRow[];
  return rows.map(decodeSourceExtraction);
}

export function deleteSourceExtraction(db: Db, sourcePath: string): void {
  db.prepare("DELETE FROM source_extractions WHERE source_path=?").run(sourcePath);
}

function decodeSourceExtraction(row: SourceExtractionRow): StoredSourceExtraction {
  return {
    source_path: row.source_path,
    source_content_hash: row.source_content_hash,
    method: row.method,
    status: row.status,
    quality: row.quality,
    warnings: parseJsonArray(row.warnings_json),
    metrics: parseMetrics(row.metrics_json),
    text_hash: row.text_hash,
    indexed_at: row.indexed_at,
  };
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseMetrics(value: string): DocumentIR["metrics"] {
  try {
    const parsed = JSON.parse(value) as Partial<DocumentIR["metrics"]>;
    return {
      ...(typeof parsed.page_count === "number" ? { page_count: parsed.page_count } : {}),
      text_chars: typeof parsed.text_chars === "number" ? parsed.text_chars : 0,
      table_count: typeof parsed.table_count === "number" ? parsed.table_count : 0,
      suspicious_line_count:
        typeof parsed.suspicious_line_count === "number" ? parsed.suspicious_line_count : 0,
      extraction_quality: isQuality(parsed.extraction_quality)
        ? parsed.extraction_quality
        : "unusable",
    };
  } catch {
    return {
      text_chars: 0,
      table_count: 0,
      suspicious_line_count: 0,
      extraction_quality: "unusable",
    };
  }
}

function isQuality(value: unknown): value is DocumentExtractionQuality {
  return value === "good" || value === "usable" || value === "weak" || value === "unusable";
}
