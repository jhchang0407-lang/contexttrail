#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { runImport } from "../cli/import.js";
import { createHandlers } from "../mcp/handlers.js";
import { createTestCorpus } from "./test-corpus.js";
import { openDb, closeDb } from "../store/db.js";
import { listSources } from "../store/sources.js";
import { listSourceExtractions } from "../store/source-extractions.js";

type ExpectedStatus = {
  source_path: string;
  status: "indexed" | "parsed_with_warnings" | "layout_sensitive" | "needs_ocr" | "failed";
};

const EXPECTED: ExpectedStatus[] = [
  { source_path: "docs/contract.pdf", status: "indexed" },
  { source_path: "docs/scanned.pdf", status: "needs_ocr" },
  { source_path: "docs/k1.pdf", status: "layout_sensitive" },
  { source_path: "docs/invoice.docx", status: "indexed" },
  { source_path: "docs/noisy-ocr.txt", status: "indexed" },
];

export async function runDocumentFormatStressEval(): Promise<Record<string, unknown>> {
  const corpus = createTestCorpus({ prefix: "contexttrail-format-stress-" });
  try {
    mkdirSync(join(corpus.cwd, "docs"), { recursive: true });
    writeFileSync(join(corpus.cwd, "docs/contract.pdf"), minimalPdf("The signed contract requires invoice approval before payment release."));
    writeFileSync(join(corpus.cwd, "docs/scanned.pdf"), minimalPdf(""));
    writeFileSync(join(corpus.cwd, "docs/k1.pdf"), minimalPdfLines([
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
    ]));
    await writeDocxTableFixture(join(corpus.cwd, "docs/invoice.docx"));
    writeFileSync(
      join(corpus.cwd, "docs/noisy-ocr.txt"),
      "Invoice OCR\n||||||||||||||||\nTOTAL     $4,250\n}}}}}}}}}}}}\nVendor: North Shore Mitigation\n",
    );

    const import_summary = runImport(corpus.cwd, ["docs/**/*.{pdf,docx,txt}"], {
      skipCodeSources: true,
    });
    const db = openDb(join(corpus.cwd, ".contexttrail/cache/contexttrail.db"));
    const extractions = listSourceExtractions(db);
    const sources = listSources(db);
    closeDb(db);

    const actualByPath = new Map(extractions.map((extraction) => [extraction.source_path, extraction]));
    const statusChecks = EXPECTED.map((expected) => ({
      source_path: expected.source_path,
      expected_status: expected.status,
      actual_status: actualByPath.get(expected.source_path)?.status ?? "missing",
      pass: actualByPath.get(expected.source_path)?.status === expected.status,
    }));
    const blockedPack = await createHandlers({ cwd: corpus.cwd }).retrieve_context_pack({
      task: "Find the policy clause in the scanned PDF.",
    });
    const extraction_status_accuracy =
      statusChecks.filter((check) => check.pass).length / statusChecks.length;
    return {
      eval_name: "document_format_stress",
      extraction_status_accuracy,
      indexed_file_count: sources.length,
      ocr_needed_count: extractions.filter((extraction) => extraction.status === "needs_ocr").length,
      layout_sensitive_count: extractions.filter((extraction) => extraction.status === "layout_sensitive").length,
      retrieval_blocked_by_extraction_count: blockedPack.warnings.some((warning) => warning.kind === "needs_ocr") ? 1 : 0,
      import_summary,
      status_checks: statusChecks,
      extraction_diagnosis: extractions.map((extraction) => ({
        source_path: extraction.source_path,
        method: extraction.method,
        status: extraction.status,
        quality: extraction.quality,
        metrics: extraction.metrics,
        warnings: extraction.warnings,
      })),
    };
  } finally {
    corpus.cleanup();
  }
}

if (process.argv[1]?.endsWith("document-format-stress.js") || process.argv[1]?.endsWith("document-format-stress.ts")) {
  runDocumentFormatStressEval()
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    });
}

async function writeDocxTableFixture(path: string): Promise<void> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.folder("_rels")?.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.folder("word")?.file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Invoice Evidence</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Field</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Value</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Total</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>$4,250</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`,
  );
  writeFileSync(path, await zip.generateAsync({ type: "nodebuffer" }));
}

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
