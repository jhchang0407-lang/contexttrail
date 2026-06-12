import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runImport } from "../cli/import.js";
import { createTestCorpus } from "../eval/test-corpus.js";
import { createHandlers } from "./handlers.js";

describe("MCP extraction warnings", () => {
  it("warns agents when a source exists but needs OCR instead of indexed evidence", async () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-mcp-extraction-" });
    try {
      mkdirSync(join(corpus.cwd, "docs"), { recursive: true });
      writeFileSync(join(corpus.cwd, "docs/scanned.pdf"), minimalPdf(""));
      runImport(corpus.cwd, ["docs/**/*.pdf"]);

      const pack = await createHandlers({ cwd: corpus.cwd }).retrieve_context_pack({
        task: "Find the policy clause in the scanned packet.",
      });

      expect(pack.warnings.map((warning) => warning.kind)).toContain("needs_ocr");
    } finally {
      corpus.cleanup();
    }
  });

  it("warns agents when retrieved evidence comes from a layout-sensitive source", async () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-mcp-extraction-" });
    try {
      mkdirSync(join(corpus.cwd, "docs"), { recursive: true });
      writeFileSync(
        join(corpus.cwd, "docs/k1.pdf"),
        minimalPdfLines([
          "SCHEDULE K-1",
          "FORM 1065",
          "BOX 20",
          "CODE AJ",
          "DESCRIPTION PARTNER FILING INSTRUCTIONS",
          "ENDING CAPITAL ACCOUNT",
          "TAX BASIS",
          "PARTNER SHARE",
          "ORDINARY BUSINESS INCOME",
          "IRS CENTER",
          "CURRENT YEAR INCREASE",
          "FINAL K-1",
        ]),
      );
      runImport(corpus.cwd, ["docs/**/*.pdf"]);

      const pack = await createHandlers({ cwd: corpus.cwd }).retrieve_context_pack({
        task: "Find schedule K-1 partner share and code AJ filing instructions.",
      });

      expect(pack.ranked.map((entry) => entry.source_path)).toContain("docs/k1.pdf");
      expect(pack.warnings.map((warning) => warning.kind)).toContain("weak_extraction");
    } finally {
      corpus.cleanup();
    }
  });
});

function minimalPdf(text: string): Buffer {
  return minimalPdfFromStream(`BT /F1 24 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`);
}

function minimalPdfLines(lines: string[]): Buffer {
  const stream = [
    "BT /F1 10 Tf 72 720 Td",
    ...lines.flatMap((line, index) => [
      ...(index === 0 ? [] : ["0 -14 Td"]),
      `(${escapePdfText(line)}) Tj`,
    ]),
    "ET",
  ].join("\n");
  return minimalPdfFromStream(stream);
}

function minimalPdfFromStream(stream: string): Buffer {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += object;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "binary");
}

function escapePdfText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}
