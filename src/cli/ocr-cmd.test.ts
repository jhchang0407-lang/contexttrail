import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestCorpus, type TestCorpus } from "../eval/test-corpus.js";
import { loadDocumentForImport } from "../parse/document-text.js";
import {
  locateOcrTools,
  ocrCachePath,
  writeOcrCacheText,
  type LocalOcrPdfResult,
} from "../parse/ocr-local.js";
import { openDb, closeDb } from "../store/db.js";
import { getChunkByVersionId } from "../store/chunks.js";
import { listSourceExtractions } from "../store/source-extractions.js";
import { listChunkVersionIdsForSource, listSources } from "../store/sources.js";
import { runContext } from "./context.js";
import { runImport } from "./import.js";
import { runOcr } from "./ocr-cmd.js";

function setup(): TestCorpus {
  return createTestCorpus({ prefix: "contexttrail-ocr-cmd-" });
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

const FAKE_OCR_TEXT = [
  "CLAIM SUMMARY",
  "",
  "The water mitigation invoice total is $4,250 and was approved by the adjuster.",
  "\fPage two: the deductible for claim CL-2209 is $1,000.",
].join("\n");

function fakeOcrResult(overrides: Partial<LocalOcrPdfResult> = {}): LocalOcrPdfResult {
  return { text: FAKE_OCR_TEXT, page_count: 2, truncated: false, ...overrides };
}

describe("contexttrail ocr command", () => {
  it("OCRs needs_ocr sources via the injected runner, caches the text, and re-imports as ocr_local", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      const pdfPath = join(cwd, "docs/scanned-claim.pdf");
      writeFileSync(pdfPath, minimalPdf(""));
      expect(runImport(cwd, ["docs/**/*.pdf"]).files_imported).toBe(0);

      const logs: string[] = [];
      const summary = runOcr(cwd, [], {
        ocrPdf: () => fakeOcrResult(),
        log: (line) => logs.push(line),
      });

      expect(summary.status).toBe("ok");
      expect(summary.ocrd).toBe(1);
      expect(summary.failed).toBe(0);
      expect(summary.skipped).toBe(0);
      expect(summary.chunks_written).toBeGreaterThan(0);
      expect(logs.join("\n")).toContain("docs/scanned-claim.pdf");

      // OCR text is cached by source content hash.
      const cachePath = ocrCachePath(cwd, sha256(readFileSync(pdfPath)));
      expect(existsSync(cachePath)).toBe(true);
      expect(readFileSync(cachePath, "utf8")).toBe(FAKE_OCR_TEXT);

      // Re-import indexed the cached text under method ocr_local.
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const extraction = listSourceExtractions(db).find(
        (item) => item.source_path === "docs/scanned-claim.pdf",
      )!;
      expect(extraction.method).toBe("ocr_local");
      expect(extraction.status).toBe("indexed");
      expect(extraction.warnings.join("\n")).toContain("local OCR");
      const bodies = listChunkVersionIdsForSource(db, "docs/scanned-claim.pdf", "current")
        .map((versionId) => getChunkByVersionId(db, versionId)!.body)
        .join("\n");
      expect(bodies).toContain("$4,250");
      closeDb(db);

      // And the OCR'd content is retrievable.
      const r = runContext(cwd, "what was the water mitigation invoice total?", {});
      expect(r.pack.included.length).toBeGreaterThan(0);
      const retrieved = r.pack.included
        .map((t) => r.chunksByVersionId.get(t.version_id)!.body)
        .join("\n");
      expect(retrieved).toContain("$4,250");
    } finally {
      corpus.cleanup();
    }
  });

  it("skips OCR when cached text already exists and still re-imports the source", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      const pdfPath = join(cwd, "docs/scanned-claim.pdf");
      writeFileSync(pdfPath, minimalPdf(""));
      runImport(cwd, ["docs/**/*.pdf"]);
      writeOcrCacheText(cwd, sha256(readFileSync(pdfPath)), FAKE_OCR_TEXT);

      const summary = runOcr(cwd, [], {
        ocrPdf: () => {
          throw new Error("OCR runner must not be invoked for cached sources");
        },
        log: () => {},
      });

      expect(summary.ocrd).toBe(0);
      expect(summary.skipped).toBe(1);
      expect(summary.failed).toBe(0);
      expect(summary.chunks_written).toBeGreaterThan(0);

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const extraction = listSourceExtractions(db).find(
        (item) => item.source_path === "docs/scanned-claim.pdf",
      )!;
      expect(extraction.method).toBe("ocr_local");
      expect(extraction.status).toBe("indexed");
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("leaves sparse OCR output as needs_ocr with a warning instead of indexing noise", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      const pdfPath = join(cwd, "docs/blank-scan.pdf");
      writeFileSync(pdfPath, minimalPdf(""));
      runImport(cwd, ["docs/**/*.pdf"]);

      const summary = runOcr(cwd, [], {
        ocrPdf: () => fakeOcrResult({ text: "|.\n~~ __\f  -", page_count: 2 }),
        log: () => {},
      });

      expect(summary.ocrd).toBe(0);
      expect(summary.failed).toBe(1);
      expect(summary.chunks_written).toBe(0);
      expect(summary.warnings.join("\n")).toContain("almost no readable text");

      expect(existsSync(ocrCachePath(cwd, sha256(readFileSync(pdfPath))))).toBe(false);
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const extraction = listSourceExtractions(db).find(
        (item) => item.source_path === "docs/blank-scan.pdf",
      )!;
      expect(extraction.status).toBe("needs_ocr");
      expect(listSources(db)).toEqual([]);
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("warns and continues past per-file OCR failures and reports page-cap truncation", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      writeFileSync(join(cwd, "docs/good-scan.pdf"), minimalPdf("", 24));
      writeFileSync(join(cwd, "docs/bad-scan.pdf"), minimalPdf("", 23));
      runImport(cwd, ["docs/**/*.pdf"]);

      const summary = runOcr(cwd, [], {
        ocrPdf: (absPath) => {
          if (absPath.includes("bad-scan")) throw new Error("tesseract (OCR) failed: boom");
          return fakeOcrResult({ truncated: true });
        },
        log: () => {},
      });

      expect(summary.ocrd).toBe(1);
      expect(summary.failed).toBe(1);
      expect(summary.warnings.join("\n")).toContain("docs/bad-scan.pdf: tesseract (OCR) failed: boom");
      expect(summary.warnings.join("\n")).toContain("OCR capped at the first 100 page(s)");

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const byPath = new Map(
        listSourceExtractions(db).map((item) => [item.source_path, item] as const),
      );
      expect(byPath.get("docs/good-scan.pdf")!.status).toBe("indexed");
      expect(byPath.get("docs/bad-scan.pdf")!.status).toBe("needs_ocr");
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("filters needs_ocr sources by glob patterns", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs/claims"), { recursive: true });
      mkdirSync(join(cwd, "docs/hr"), { recursive: true });
      writeFileSync(join(cwd, "docs/claims/scan-a.pdf"), minimalPdf("", 24));
      writeFileSync(join(cwd, "docs/hr/scan-b.pdf"), minimalPdf("", 23));
      runImport(cwd, ["docs/**/*.pdf"]);

      const summary = runOcr(cwd, ["docs/claims/**/*.pdf"], {
        ocrPdf: () => fakeOcrResult(),
        log: () => {},
      });

      expect(summary.ocrd).toBe(1);
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const byPath = new Map(
        listSourceExtractions(db).map((item) => [item.source_path, item] as const),
      );
      expect(byPath.get("docs/claims/scan-a.pdf")!.status).toBe("indexed");
      expect(byPath.get("docs/hr/scan-b.pdf")!.status).toBe("needs_ocr");
      closeDb(db);
    } finally {
      corpus.cleanup();
    }
  });

  it("prints platform install guidance and exits without doing anything when tools are missing", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    const emptyPathDir = mkdtempSync(join(tmpdir(), "contexttrail-ocr-nopath-"));
    try {
      const summary = runOcr(cwd, [], { env: { PATH: emptyPathDir }, log: () => {} });
      expect(summary.status).toBe("tools_missing");
      expect(summary.guidance).toContain("tesseract");
      expect(summary.guidance).toMatch(
        /brew install tesseract poppler|apt install tesseract-ocr poppler-utils/,
      );
      expect(summary.ocrd + summary.failed + summary.skipped).toBe(0);
      expect(existsSync(join(cwd, ".contexttrail/cache/ocr"))).toBe(false);
    } finally {
      rmSync(emptyPathDir, { recursive: true, force: true });
      corpus.cleanup();
    }
  });

  it("reports cleanly when no sources are waiting on OCR", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      const logs: string[] = [];
      const summary = runOcr(cwd, [], {
        ocrPdf: () => fakeOcrResult(),
        log: (line) => logs.push(line),
      });
      expect(summary.status).toBe("ok");
      expect(summary.ocrd).toBe(0);
      expect(logs.join("\n")).toContain("no sources are waiting on OCR");
    } finally {
      corpus.cleanup();
    }
  });
});

describe("OCR cache import hook (loadDocumentForImport)", () => {
  it("indexes cached OCR text as ocr_local with page-tagged blocks and an OCR warning", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      const pdfPath = join(cwd, "docs/scan.pdf");
      writeFileSync(pdfPath, minimalPdf(""));
      writeOcrCacheText(cwd, sha256(readFileSync(pdfPath)), FAKE_OCR_TEXT);

      const loaded = loadDocumentForImport(pdfPath, "docs/scan.pdf", undefined, {
        workspaceRoot: cwd,
      });
      expect(loaded.ir.method).toBe("ocr_local");
      expect(loaded.ir.status).toBe("indexed");
      expect(loaded.text).toContain("invoice total is $4,250");
      expect(loaded.text).toContain("deductible for claim CL-2209");
      expect(loaded.warnings.join("\n")).toContain("local OCR");
      const pages = loaded.ir.blocks.map((block) => block.page);
      expect(pages[0]).toBe(1);
      expect(pages.at(-1)).toBe(2);
    } finally {
      corpus.cleanup();
    }
  });

  it("still reports needs_ocr when no workspace root or no cached text is available", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      const pdfPath = join(cwd, "docs/scan.pdf");
      writeFileSync(pdfPath, minimalPdf(""));

      // No cache yet, even with a workspace root.
      const noCache = loadDocumentForImport(pdfPath, "docs/scan.pdf", undefined, {
        workspaceRoot: cwd,
      });
      expect(noCache.ir.status).toBe("needs_ocr");

      // Cache present but no workspace root provided (legacy signature).
      writeOcrCacheText(cwd, sha256(readFileSync(pdfPath)), FAKE_OCR_TEXT);
      const noRoot = loadDocumentForImport(pdfPath, "docs/scan.pdf");
      expect(noRoot.ir.status).toBe("needs_ocr");
    } finally {
      corpus.cleanup();
    }
  });

  it("treats image-only PDFs (image XObject, no text operators) as needs_ocr", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      const pdfPath = join(cwd, "docs/image-only.pdf");
      // The image stream is intentionally junk: text extraction must not need
      // to decode it to classify the page as image-only.
      writeFileSync(pdfPath, imageOnlyPdf(Buffer.from("not a real jpeg"), 1275, 1650));
      const loaded = loadDocumentForImport(pdfPath, "docs/image-only.pdf");
      expect(loaded.ir.status).toBe("needs_ocr");
      expect(loaded.warnings.join("\n")).toContain("OCR");
    } finally {
      corpus.cleanup();
    }
  });
});

// Real-toolchain end-to-end: only runs when tesseract + pdftoppm are
// actually installed. The suite must stay green without them.
const realTools = locateOcrTools();

describe("contexttrail ocr end-to-end with real tesseract + pdftoppm", () => {
  it.skipIf(!realTools.ok)(
    "recovers text from a generated image-only PDF and indexes it",
    () => {
      if (!realTools.ok) return;
      const corpus = setup(); const cwd = corpus.cwd;
      const scratch = mkdtempSync(join(tmpdir(), "contexttrail-ocr-e2e-"));
      try {
        // Render a text PDF to a JPEG, then wrap the JPEG in an image-only
        // PDF: a real scan stand-in with no text layer at all.
        const textPdfPath = join(scratch, "text.pdf");
        writeFileSync(textPdfPath, minimalPdf("CLAIM TOTAL 4250 APPROVED"));
        execFileSync(realTools.tools.pdftoppm, [
          "-r", "150", "-gray", "-jpeg", "-singlefile",
          textPdfPath,
          join(scratch, "page"),
        ]);
        const jpeg = readFileSync(join(scratch, "page.jpg"));
        const { width, height } = jpegDimensions(jpeg);
        mkdirSync(join(cwd, "docs"), { recursive: true });
        writeFileSync(join(cwd, "docs/scanned.pdf"), imageOnlyPdf(jpeg, width, height));

        expect(runImport(cwd, ["docs/**/*.pdf"]).files_imported).toBe(0);

        const summary = runOcr(cwd, [], { log: () => {} });
        expect(summary.status).toBe("ok");
        expect(summary.ocrd).toBe(1);
        expect(summary.failed).toBe(0);

        const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
        const extraction = listSourceExtractions(db).find(
          (item) => item.source_path === "docs/scanned.pdf",
        )!;
        expect(extraction.method).toBe("ocr_local");
        expect(["indexed", "parsed_with_warnings"]).toContain(extraction.status);
        const bodies = listChunkVersionIdsForSource(db, "docs/scanned.pdf", "current")
          .map((versionId) => getChunkByVersionId(db, versionId)!.body)
          .join("\n");
        expect(bodies).toContain("4250");
        closeDb(db);
      } finally {
        rmSync(scratch, { recursive: true, force: true });
        corpus.cleanup();
      }
    },
  );
});

/**
 * Same minimal single-page text PDF used by import tests; an empty `text`
 * yields a PDF with no extractable text layer (status needs_ocr). The font
 * size parameter only exists to vary file bytes (and therefore content
 * hashes) between otherwise identical fixtures.
 */
function minimalPdf(text: string, fontSize = 24): Buffer {
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
  const stream = `BT /F1 ${fontSize} Tf 72 720 Td (${escaped}) Tj ET`;
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

/** Single-page PDF whose only content is a full-page JPEG image XObject. */
function imageOnlyPdf(jpeg: Buffer, width: number, height: number): Buffer {
  const contents = "q 612 0 0 792 0 0 cm /Im0 Do Q";
  const objects: Buffer[] = [
    Buffer.from("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"),
    Buffer.from("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"),
    Buffer.from(
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>\nendobj\n",
    ),
    Buffer.from(
      `4 0 obj\n<< /Length ${contents.length} >>\nstream\n${contents}\nendstream\nendobj\n`,
    ),
    Buffer.concat([
      Buffer.from(
        `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
          `/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      Buffer.from("\nendstream\nendobj\n"),
    ]),
  ];
  let body = Buffer.from("%PDF-1.4\n");
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(body.length);
    body = Buffer.concat([body, object]);
  }
  const xrefOffset = body.length;
  let trailer = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    trailer += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  trailer += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.concat([body, Buffer.from(trailer)]);
}

/** Reads width/height from a JPEG's SOF marker. */
function jpegDimensions(jpeg: Buffer): { width: number; height: number } {
  let i = 2;
  while (i + 9 < jpeg.length) {
    if (jpeg[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = jpeg[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: jpeg.readUInt16BE(i + 5), width: jpeg.readUInt16BE(i + 7) };
    }
    i += 2 + jpeg.readUInt16BE(i + 2);
  }
  throw new Error("no SOF marker found in JPEG");
}
