import { describe, expect, it } from "vitest";
import { buildDocumentIr, type DocumentExtractionMethod } from "./document-ir.js";

function emptyIrInput(method: DocumentExtractionMethod) {
  return {
    source_path: `docs/empty.${method}`,
    source_content_hash: "hash",
    method,
    blocks: [],
  };
}

describe("buildDocumentIr empty-text status", () => {
  it("marks empty plain-text documents as failed, not needs_ocr", () => {
    const ir = buildDocumentIr(emptyIrInput("plain_text"));
    expect(ir.status).toBe("failed");
    expect(ir.metrics.extraction_quality).toBe("unusable");
    expect(ir.warnings.join("\n")).toContain("contains no text");
  });

  it("marks empty markdown documents as failed, not needs_ocr", () => {
    const ir = buildDocumentIr(emptyIrInput("markdown"));
    expect(ir.status).toBe("failed");
    expect(ir.warnings.join("\n")).toContain("contains no text");
  });

  it("marks empty docx documents as failed, not needs_ocr", () => {
    const ir = buildDocumentIr(emptyIrInput("docx"));
    expect(ir.status).toBe("failed");
    expect(ir.warnings.join("\n")).toContain("contains no text");
  });

  it("keeps needs_ocr for empty PDF text-layer extractions", () => {
    const ir = buildDocumentIr(emptyIrInput("pdf_text_layer"));
    expect(ir.status).toBe("needs_ocr");
    expect(ir.metrics.extraction_quality).toBe("unusable");
    expect(ir.warnings).toEqual([]);
  });

  it("keeps needs_ocr for empty local OCR extractions", () => {
    const ir = buildDocumentIr(emptyIrInput("ocr_local"));
    expect(ir.status).toBe("needs_ocr");
  });

  it("respects an explicitly provided status and does not append the empty-file warning", () => {
    const ir = buildDocumentIr({
      ...emptyIrInput("docx"),
      status: "failed",
      warnings: ["DOCX produced no structured HTML blocks; falling back to raw text extraction."],
    });
    expect(ir.status).toBe("failed");
    expect(ir.warnings).toHaveLength(1);
    expect(ir.warnings.join("\n")).not.toContain("contains no text");
  });

  it("leaves non-empty documents on the indexed/parsed_with_warnings path", () => {
    const ir = buildDocumentIr({
      source_path: "docs/note.txt",
      source_content_hash: "hash",
      method: "plain_text",
      blocks: [{ type: "paragraph", text: "Refunds must be idempotent." }],
    });
    expect(ir.status).toBe("indexed");
    expect(ir.metrics.extraction_quality).toBe("good");
  });
});
