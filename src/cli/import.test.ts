import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, utimesSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { runIndex } from "./index-cmd.js";
import { runImport } from "./import.js";
import { listScopeReport } from "./scope-inspect.js";
import { openDb, closeDb } from "../store/db.js";
import { listSources, listChunkVersionIdsForSource } from "../store/sources.js";
import { listSourceExtractions } from "../store/source-extractions.js";
import { getAnchorsForChunk } from "../store/anchors.js";
import { getChunkByVersionId } from "../store/chunks.js";
import { createTestCorpus, type TestCorpus } from "../eval/test-corpus.js";

function setup(): TestCorpus {
  return createTestCorpus({ prefix: "contexttrail-import-" });
}

describe("contexttrail import → index → scope inspect lifecycle", () => {
  it("imports DOCX and PDF sources by extracting text before chunking", async () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      await writeDocxFixture(
        join(cwd, "docs/claim-intake.docx"),
        [
          "The DOCX intake packet says the mitigation invoice total is $4,250.",
          "The claim handler must verify the invoice against the claim number.",
        ],
      );
      writeFileSync(
        join(cwd, "docs/policy-excerpt.pdf"),
        minimalPdf("PDF draft notes are not final authority."),
      );

      const result = runImport(cwd, ["docs/**/*.{docx,pdf}"]);
      expect(result.files_imported).toBe(2);
      expect(result.warnings).toEqual([]);

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const sourcePaths = listSources(db).map((source) => source.source_path).sort();
      expect(sourcePaths).toEqual(["docs/claim-intake.docx", "docs/policy-excerpt.pdf"]);
      const bodies = sourcePaths
        .flatMap((sourcePath) => listChunkVersionIdsForSource(db, sourcePath))
        .map((versionId) => getChunkByVersionId(db, versionId)!.body)
        .join("\n");
      expect(bodies).toContain("mitigation invoice total is $4,250");
      expect(bodies).toContain("PDF draft notes are not final authority");
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("skips PDFs with no extractable text layer instead of indexing page markers", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      const pdfPath = join(cwd, "docs/scanned-contract.pdf");
      const docusignOnlyPath = join(cwd, "docs/docusign-header-only.pdf");
      writeFileSync(pdfPath, minimalPdf("Initial contract text is searchable."));

      expect(runImport(cwd, ["docs/**/*.pdf"]).files_imported).toBe(1);

      writeFileSync(pdfPath, minimalPdf(""));
      writeFileSync(docusignOnlyPath, minimalPdf("Docusign Envelope ID: ABCD1234-1111-2222-3333-ABCDEF123456"));
      const result = runImport(cwd, ["docs/**/*.pdf"]);

      expect(result.files_imported).toBe(0);
      expect(result.warnings.join("\n")).toContain("OCR is required");

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      expect(listSources(db)).toEqual([]);
      const extractions = listSourceExtractions(db);
      expect(extractions.map((item) => item.source_path).sort()).toEqual([
        "docs/docusign-header-only.pdf",
        "docs/scanned-contract.pdf",
      ]);
      expect(extractions.every((item) => item.status === "needs_ocr")).toBe(true);
      expect(listChunkVersionIdsForSource(db, "docs/scanned-contract.pdf", "current")).toEqual([]);
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("marks K-1-like PDFs as layout-sensitive while still indexing their text layer", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      writeFileSync(
        join(cwd, "docs/k1.pdf"),
        minimalPdfLines([
          "SCHEDULE K-1",
          "FORM 1065",
          "BOX 1",
          "ORDINARY BUSINESS INCOME",
          "123",
          "BOX 20",
          "CODE AJ",
          "DESCRIPTION PARTNER FILING INSTRUCTIONS",
          "ENDING CAPITAL ACCOUNT",
          "TAX BASIS",
          "PARTNER SHARE",
          "IRS CENTER",
        ]),
      );

      const result = runImport(cwd, ["docs/**/*.pdf"]);
      expect(result.files_imported).toBe(1);
      expect(result.warnings.join("\n")).toContain("layout-sensitive");

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const [extraction] = listSourceExtractions(db);
      expect(extraction?.status).toBe("layout_sensitive");
      expect(extraction?.quality).toBe("weak");
      expect(listSources(db)).toHaveLength(1);
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("reconstructs key-value structure from positioned K-1-style PDFs and upgrades their status", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      // Label/value pairs positioned in separate columns on shared baselines,
      // the way generated tax and corporate forms lay out their boxes.
      writeFileSync(
        join(cwd, "docs/k1-filled.pdf"),
        minimalPdfFromStream([
          "BT /F1 10 Tf 72 720 Td (SCHEDULE K-1) Tj ET",
          "BT /F1 10 Tf 72 706 Td (FORM 1065) Tj ET",
          "BT /F1 10 Tf 72 688 Td (Part III Partner's Share of Current Year Income) Tj ET",
          "BT /F1 10 Tf 72 670 Td (1  Ordinary business income \\(loss\\)) Tj ET",
          "BT /F1 10 Tf 300 670 Td (12,345) Tj ET",
          "BT /F1 10 Tf 72 656 Td (2  Net rental real estate income \\(loss\\)) Tj ET",
          "BT /F1 10 Tf 300 656 Td (-1,200) Tj ET",
          "BT /F1 10 Tf 72 642 Td (FINAL K-1) Tj ET",
          "BT /F1 10 Tf 72 628 Td (AMENDED K-1) Tj ET",
        ].join("\n")),
      );

      const result = runImport(cwd, ["docs/**/*.pdf"]);
      expect(result.files_imported).toBe(1);
      expect(result.warnings.join("\n")).toContain("reconstructed");

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const [extraction] = listSourceExtractions(db);
      expect(extraction?.status).toBe("parsed_with_warnings");
      expect(extraction?.quality).toBe("usable");
      const chunks = listChunkVersionIdsForSource(db, "docs/k1-filled.pdf", "current")
        .map((id) => getChunkByVersionId(db, id)!);
      const body = chunks.map((chunk) => chunk.body).join("\n");
      expect(body).toContain("- 1 Ordinary business income (loss): 12,345");
      expect(body).toContain("- 2 Net rental real estate income (loss): -1,200");
      // Detected headings become section structure for citations rather than
      // body text. Standard-encoding fonts surface the apostrophe as U+2019.
      const headingPaths = chunks.map((chunk) => chunk.heading_path.join(" > ")).join("\n");
      expect(headingPaths).toMatch(/Part III Partner.s Share of Current Year Income/);
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("extracts filled AcroForm field values that have no text-layer presence", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      writeFileSync(
        join(cwd, "docs/fillable-k1.pdf"),
        minimalPdfFromStream(
          "BT /F1 10 Tf 72 760 Td (Schedule K-1 Form 1065) Tj ET",
          {
            annotRefs: ["6 0 R", "7 0 R", "8 0 R"],
            extraObjects: [
              "6 0 obj\n<< /Type /Annot /Subtype /Widget /FT /Tx /T (f1_09) /TU (Partner's share of profit - ending) /V (45.5%) /Rect [300 700 450 715] /F 4 /P 3 0 R >>\nendobj\n",
              "7 0 obj\n<< /Type /Annot /Subtype /Widget /FT /Btn /T (c1_3) /TU (Final K-1) /V /On /AS /On /Rect [100 650 110 660] /F 4 /P 3 0 R >>\nendobj\n",
              "8 0 obj\n<< /Type /Annot /Subtype /Widget /FT /Tx /T (f1_10) /TU (Unfilled field) /Rect [300 600 450 615] /F 4 /P 3 0 R >>\nendobj\n",
            ],
          },
        ),
      );

      const result = runImport(cwd, ["docs/**/*.pdf"]);
      expect(result.files_imported).toBe(1);

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const body = listChunkVersionIdsForSource(db, "docs/fillable-k1.pdf", "current")
        .map((id) => getChunkByVersionId(db, id)!.body)
        .join("\n");
      expect(body).toContain("- Partner's share of profit - ending: 45.5%");
      expect(body).toContain("- Final K-1: checked");
      expect(body).not.toContain("Unfilled field");
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("extracts ruled-grid PDF tables into markdown table chunks without duplicating text", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      writeFileSync(
        join(cwd, "docs/capital-account.pdf"),
        minimalPdfFromStream([
          "1 w",
          "72 700 m 372 700 l S",
          "72 650 m 372 650 l S",
          "72 600 m 372 600 l S",
          "72 700 m 72 600 l S",
          "222 700 m 222 600 l S",
          "372 700 m 372 600 l S",
          "BT /F1 10 Tf 80 680 Td (Beginning capital) Tj ET",
          "BT /F1 10 Tf 230 680 Td (50,000) Tj ET",
          "BT /F1 10 Tf 80 630 Td (Ending capital) Tj ET",
          "BT /F1 10 Tf 230 630 Td (62,345) Tj ET",
        ].join("\n")),
      );

      const result = runImport(cwd, ["docs/**/*.pdf"]);
      expect(result.files_imported).toBe(1);

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const [extraction] = listSourceExtractions(db);
      expect(extraction?.metrics.table_count).toBe(1);
      expect(extraction?.quality).toBe("good");
      const body = listChunkVersionIdsForSource(db, "docs/capital-account.pdf", "current")
        .map((id) => getChunkByVersionId(db, id)!.body)
        .join("\n");
      expect(body).toContain("| Beginning capital | 50,000 |");
      expect(body).toContain("| Ending capital | 62,345 |");
      expect(body).not.toMatch(/^Beginning capital 50,000$/m);
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("renders DOCX tables into structured chunk text and extraction metadata", async () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      await writeDocxTableFixture(join(cwd, "docs/invoice.docx"));

      const result = runImport(cwd, ["docs/**/*.docx"]);
      expect(result.files_imported).toBe(1);

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const [extraction] = listSourceExtractions(db);
      expect(extraction?.method).toBe("docx");
      expect(extraction?.metrics.table_count).toBe(1);
      const body = listChunkVersionIdsForSource(db, "docs/invoice.docx", "current")
        .map((id) => getChunkByVersionId(db, id)!.body)
        .join("\n");
      expect(body).toContain("| Field | Value |");
      expect(body).toContain("| Total | $4,250 |");
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("repairs cached PDF chunks that still contain extraction page markers", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      const pdfPath = join(cwd, "docs/operating-agreement.pdf");
      writeFileSync(pdfPath, minimalPdf("Operating agreement text is searchable."));
      runImport(cwd, ["docs/**/*.pdf"]);

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const versionId = listChunkVersionIdsForSource(db, "docs/operating-agreement.pdf", "current")[0]!;
      db.prepare("UPDATE doc_chunks SET body = body || '\n-- 1 of 1 --' WHERE version_id=?").run(versionId);
      closeDb(db);

      const repaired = runImport(cwd, ["docs/**/*.pdf"]);
      expect(repaired.files_imported).toBe(1);

      const repairedDb = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const bodies = listChunkVersionIdsForSource(repairedDb, "docs/operating-agreement.pdf", "current")
        .map((id) => getChunkByVersionId(repairedDb, id)!.body)
        .join("\n");
      expect(bodies).toContain("Operating agreement text is searchable");
      expect(bodies).not.toContain("-- 1 of 1 --");
      closeDb(repairedDb);
    } finally {
      corpus.cleanup();
    }
  });

  it("imports markdown sources, populates chunks, anchors, and indexed_doc_sources", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs/payments"), { recursive: true });
      writeFileSync(
        join(cwd, "docs/payments/refunds.md"),
        `---\nscope:\n  layer: project\n  project: payments\n---\n\n# Refunds\n\nSee \`src/payments/refund.ts\` for the impl. The \`RefundService.processRefund\` method must be idempotent.\n\n## Edge Cases\n\nSet STRIPE_API_KEY before running.\n`,
      );

      const result = corpus.importDocs();
      expect(result.files_imported).toBe(1);
      expect(result.chunks_written).toBeGreaterThanOrEqual(2);

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const sources = listSources(db);
      expect(sources).toHaveLength(1);
      expect(sources[0]!.source_path).toBe("docs/payments/refunds.md");
      expect(sources[0]!.chunk_count).toBeGreaterThanOrEqual(2);

      const versionIds = listChunkVersionIdsForSource(db, "docs/payments/refunds.md");
      expect(versionIds.length).toBeGreaterThanOrEqual(2);

      // First chunk should carry frontmatter scope (project=payments)
      const refundsChunk = versionIds
        .map((v) => getChunkByVersionId(db, v)!)
        .find((c) => c.title === "Refunds")!;
      expect(refundsChunk.scope.layer).toBe("project");
      expect(refundsChunk.scope.project).toBe("payments");

      // Anchors extracted
      const anchors = getAnchorsForChunk(db, refundsChunk.version_id);
      const values = anchors.map((a) => a.value).sort();
      expect(values).toContain("src/payments/refund.ts");
      expect(values).toContain("RefundService.processRefund");

      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("populates doc_role with frontmatter overriding config/default", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      writeFileSync(
        join(cwd, ".contexttrail/config.yaml"),
        `version: 1
doc_roles:
  - pattern: "docs/**/*.md"
    role: ideation
`,
      );
      mkdirSync(join(cwd, "docs"), { recursive: true });
      writeFileSync(
        join(cwd, "docs/a.md"),
        `---
doc_role: example
---

# A

body.
`,
      );

      corpus.importDocs();

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const ids = listChunkVersionIdsForSource(db, "docs/a.md", "current");
      const c = getChunkByVersionId(db, ids[0]!)!;
      expect(c.doc_role).toBe("example");
      expect(c.role_source).toBe("frontmatter");
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("backfills doc_role for unchanged existing chunks on import", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      writeFileSync(join(cwd, "docs/a.md"), "# A\n\nbody.\n");
      corpus.importDocs();

      writeFileSync(
        join(cwd, ".contexttrail/config.yaml"),
        `version: 1
doc_roles:
  - pattern: "docs/**/*.md"
    role: ideation
`,
      );

      const result = corpus.importDocs();
      expect(result.files_unchanged).toBe(1);

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const ids = listChunkVersionIdsForSource(db, "docs/a.md", "current");
      const c = getChunkByVersionId(db, ids[0]!)!;
      expect(c.doc_role).toBe("ideation");
      expect(c.role_source).toBe("config_pattern");
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("re-import is idempotent (no duplicate sources, same version_ids)", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/a.md"), "# A\n\nbody.\n");
      const r1 = corpus.importDocs();
      expect(r1.files_imported).toBe(1);
      const r2 = corpus.importDocs();
      // Idempotent: second run sees the file unchanged and skips it.
      expect(r2.files_imported).toBe(0);
      expect(r2.files_unchanged).toBe(1);
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const sources = listSources(db);
      expect(sources).toHaveLength(1);
      const ids = listChunkVersionIdsForSource(db, "docs/a.md", "current");
      expect(ids).toHaveLength(1);
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("contexttrail index: no-op when mtime+size unchanged", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/a.md"), "# A\n\nbody.\n");
      corpus.importDocs();
      const r = runIndex(cwd);
      expect(r.unchanged).toBe(1);
      expect(r.reindexed).toBe(0);
      expect(r.tombstoned_chunks).toBe(0);
    } finally {
      corpus.cleanup();
    }
  });

  it("contexttrail index: reindexes when source content changes; rotates version_id, preserves stable_key", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      const path = join(cwd, "docs/a.md");
      writeFileSync(path, "# Sec\n\noriginal body.\n");
      corpus.importDocs();

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const beforeIds = listChunkVersionIdsForSource(db, "docs/a.md", "current");
      const beforeChunk = getChunkByVersionId(db, beforeIds[0]!)!;
      closeDb(db);

      // Edit content, advance mtime
      writeFileSync(path, "# Sec\n\ntotally rewritten body now.\n");
      const future = new Date(Date.now() + 5000);
      utimesSync(path, future, future);

      const r = runIndex(cwd);
      expect(r.reindexed).toBe(1);

      const db2 = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const currentIds = listChunkVersionIdsForSource(db2, "docs/a.md", "current");
      expect(currentIds).toHaveLength(1);
      const afterChunk = getChunkByVersionId(db2, currentIds[0]!)!;
      expect(afterChunk.stable_key).toBe(beforeChunk.stable_key);
      expect(afterChunk.version_id).not.toBe(beforeChunk.version_id);

      // Old version is tombstoned, not deleted
      const all = listChunkVersionIdsForSource(db2, "docs/a.md", "any");
      expect(all.length).toBe(2);
      closeDb(db2);
    } finally {
      corpus.cleanup();
    }
  });

  it("contexttrail index: frontmatter-declared anchors persist across re-index (regression)", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      const path = join(cwd, "docs/a.md");
      writeFileSync(
        path,
        `---\nscope:\n  layer: project\n  project: payments\n  files:\n    - src/payments/refund.ts\n  symbols:\n    - RefundService.processRefund\n  routes:\n    - POST /refunds\n---\n\n# Refunds\n\noriginal body.\n`,
      );
      corpus.importDocs();

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const beforeIds = listChunkVersionIdsForSource(db, "docs/a.md", "current");
      const beforeAnchors = getAnchorsForChunk(db, beforeIds[0]!);
      const beforeFmAnchors = beforeAnchors.filter((a) => a.source === "frontmatter");
      expect(beforeFmAnchors.length).toBe(3);
      closeDb(db);

      // Edit content, advance mtime — same frontmatter, different body.
      writeFileSync(
        path,
        `---\nscope:\n  layer: project\n  project: payments\n  files:\n    - src/payments/refund.ts\n  symbols:\n    - RefundService.processRefund\n  routes:\n    - POST /refunds\n---\n\n# Refunds\n\nrewritten body now.\n`,
      );
      const future = new Date(Date.now() + 5000);
      utimesSync(path, future, future);

      runIndex(cwd);

      const db2 = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const afterIds = listChunkVersionIdsForSource(db2, "docs/a.md", "current");
      const afterAnchors = getAnchorsForChunk(db2, afterIds[0]!);
      const afterFmAnchors = afterAnchors.filter((a) => a.source === "frontmatter");
      expect(afterFmAnchors.length).toBe(3);
      const values = afterFmAnchors.map((a) => a.value).sort();
      expect(values).toContain("src/payments/refund.ts");
      expect(values).toContain("RefundService.processRefund");
      expect(values).toContain("POST /refunds");
      closeDb(db2);
    } finally {
      corpus.cleanup();
    }
  });

  it("contexttrail index: tombstones chunks whose source file is removed", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      const path = join(cwd, "docs/a.md");
      writeFileSync(path, "# A\n\nbody.\n");
      corpus.importDocs();

      rmSync(path);
      const r = runIndex(cwd);
      expect(r.tombstoned_chunks).toBeGreaterThanOrEqual(1);

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const current = listChunkVersionIdsForSource(db, "docs/a.md", "current");
      expect(current).toHaveLength(0);
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("contexttrail scope inspect --unknown filters to unknown-layer chunks", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      mkdirSync(join(cwd, "random"));
      writeFileSync(join(cwd, "docs/a.md"), "# A\n\nbody.\n");
      writeFileSync(join(cwd, "random/b.md"), "# B\n\nbody.\n");
      corpus.importDocs(["docs/**/*.md", "random/**/*.md"]);

      const all = listScopeReport(cwd, { unknownOnly: false });
      const unknown = listScopeReport(cwd, { unknownOnly: true });
      expect(all.length).toBeGreaterThan(unknown.length);
      for (const r of unknown) {
        expect(r.scope_layer).toBe("unknown");
      }
      // doc/a.md is project (matched by docs-project-default rule); random/b.md is unknown.
      const fromDocs = all.filter((r) => r.source_path.startsWith("docs/"));
      expect(fromDocs.every((r) => r.scope_layer === "project")).toBe(true);
    } finally {
      corpus.cleanup();
    }
  });
});

async function writeDocxFixture(path: string, paragraphs: string[]): Promise<void> {
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
    ${paragraphs.map((paragraph) => `<w:p><w:r><w:t>${escapeXml(paragraph)}</w:t></w:r></w:p>`).join("\n    ")}
  </w:body>
</w:document>`,
  );
  writeFileSync(path, await zip.generateAsync({ type: "nodebuffer" }));
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
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
  const stream = `BT /F1 24 Tf 72 720 Td (${escaped}) Tj ET`;
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

function minimalPdfFromStream(
  stream: string,
  options: { extraObjects?: string[]; annotRefs?: string[] } = {},
): Buffer {
  const annots = options.annotRefs?.length
    ? ` /Annots [${options.annotRefs.join(" ")}]`
    : "";
  const acroForm = options.annotRefs?.length
    ? ` /AcroForm << /Fields [${options.annotRefs.join(" ")}] >>`
    : "";
  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R${acroForm} >>\nendobj\n`,
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >>${annots} >>\nendobj\n`,
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    ...(options.extraObjects ?? []),
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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
