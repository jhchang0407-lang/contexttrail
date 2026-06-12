import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeTextBytes,
  extractorFailureMessage,
  loadDocumentForImport,
} from "./document-text.js";

function withTempDir<T>(run: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "contexttrail-doctext-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("loadDocumentForImport PDF failure messages", () => {
  it("fails a zero-byte PDF with concise warnings instead of a 66KB error blob", () => {
    withTempDir((dir) => {
      const path = join(dir, "empty.pdf");
      writeFileSync(path, Buffer.alloc(0));
      const loaded = loadDocumentForImport(path, "docs/empty.pdf");
      expect(["failed", "needs_ocr"]).toContain(loaded.ir.status);
      expect(loaded.ir.metrics.extraction_quality).toBe("unusable");
      expect(loaded.warnings.length).toBeGreaterThan(0);
      for (const warning of loaded.warnings) {
        expect(warning.length).toBeLessThan(400);
      }
      expect(loaded.warnings.join("\n")).toContain("PDF extraction failed");
      // The raw execFileSync message embeds the whole inline extractor script.
      expect(loaded.warnings.join("\n")).not.toContain("input-type=module");
    });
  });

  it("fails a corrupt PDF with the child's actual error reason", () => {
    withTempDir((dir) => {
      const path = join(dir, "corrupt.pdf");
      writeFileSync(path, Buffer.from("this is definitely not a pdf"));
      const loaded = loadDocumentForImport(path, "docs/corrupt.pdf");
      expect(["failed", "needs_ocr"]).toContain(loaded.ir.status);
      expect(loaded.warnings.length).toBeGreaterThan(0);
      for (const warning of loaded.warnings) {
        expect(warning.length).toBeLessThan(400);
      }
      expect(loaded.warnings.join("\n")).toContain("PDF extraction failed");
    });
  });
});

describe("extractorFailureMessage", () => {
  it("reports an ENOBUFS overflow as a buffer-size problem", () => {
    const message = extractorFailureMessage({ code: "ENOBUFS" }, "PDF");
    expect(message).toBe(
      "PDF text layer too large to extract (exceeded 256MB extractor buffer)",
    );
  });

  it("extracts the child's sentinel failure line from stderr", () => {
    const stderr = [
      "Warning: pdf.js produced some noise first",
      "EXTRACTOR_ERROR: The PDF file is empty, i.e. its size is zero bytes.",
      "",
    ].join("\n");
    const message = extractorFailureMessage({ status: 1, stderr }, "PDF");
    expect(message).toBe(
      "PDF extraction failed: The PDF file is empty, i.e. its size is zero bytes.",
    );
  });

  it("caps sentinel-less stderr (e.g. a 64KB minified code frame) near 300 chars", () => {
    const stderr = `node_modules/pdf-parse/dist/index.cjs:1\n${"x".repeat(70_000)}`;
    const message = extractorFailureMessage({ status: 1, stderr }, "PDF");
    expect(message.length).toBeLessThan(400);
    expect(message.startsWith("PDF extraction failed: ")).toBe(true);
  });

  it("skips stack frames and falls back to the exit status when stderr is empty", () => {
    const stackOnly = ["at load (file:///x.mjs:3:11)", "at async main"].join("\n");
    expect(extractorFailureMessage({ status: 1, stderr: stackOnly }, "DOCX")).toBe(
      "DOCX extraction failed: extractor exited with status 1",
    );
    expect(extractorFailureMessage({ status: 7, stderr: "" }, "PDF")).toBe(
      "PDF extraction failed: extractor exited with status 7",
    );
  });
});

describe("plain-text encoding detection", () => {
  it("round-trips a UTF-16LE .txt with BOM to searchable text", () => {
    withTempDir((dir) => {
      const path = join(dir, "notes.txt");
      const body = "Refund totals must match the mitigation invoice: $4,250.";
      writeFileSync(path, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, "utf16le")]));
      const loaded = loadDocumentForImport(path, "docs/notes.txt");
      expect(loaded.text).toBe(body);
      expect(loaded.ir.status).toBe("indexed");
      expect(loaded.ir.metrics.extraction_quality).toBe("good");
      expect(loaded.warnings).toEqual([]);
    });
  });

  it("decodes a UTF-16BE .txt with BOM", () => {
    withTempDir((dir) => {
      const path = join(dir, "notes-be.txt");
      const body = "Vendor onboarding requires a signed W-9.";
      const be = Buffer.from(body, "utf16le");
      be.swap16();
      writeFileSync(path, Buffer.concat([Buffer.from([0xfe, 0xff]), be]));
      const loaded = loadDocumentForImport(path, "docs/notes-be.txt");
      expect(loaded.text).toBe(body);
      expect(loaded.ir.status).toBe("indexed");
    });
  });

  it("recovers BOM-less UTF-16LE (PowerShell redirect output)", () => {
    withTempDir((dir) => {
      const path = join(dir, "redirected.txt");
      const body = "PowerShell redirected output: refund policy applies to all claims.";
      writeFileSync(path, Buffer.from(body, "utf16le"));
      const loaded = loadDocumentForImport(path, "docs/redirected.txt");
      expect(loaded.text).toBe(body);
      expect(loaded.text).not.toContain("\u0000");
      expect(loaded.ir.status).toBe("indexed");
      expect(loaded.ir.metrics.extraction_quality).toBe("good");
    });
  });

  it("strips a UTF-8 BOM from markdown so headings parse from the first char", () => {
    withTempDir((dir) => {
      const path = join(dir, "readme.md");
      writeFileSync(path, Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("# Refunds\n\nBody text.", "utf8"),
      ]));
      const loaded = loadDocumentForImport(path, "docs/readme.md");
      expect(loaded.text.startsWith("# Refunds")).toBe(true);
      expect(loaded.text).not.toContain("\uFEFF");
      expect(loaded.ir.method).toBe("markdown");
    });
  });

  it("flags binary-ish content as degraded instead of indexing it as good", () => {
    withTempDir((dir) => {
      const path = join(dir, "binary.txt");
      writeFileSync(path, Buffer.alloc(512, 0xfa));
      const loaded = loadDocumentForImport(path, "docs/binary.txt");
      expect(loaded.warnings.join("\n")).toContain("does not look like UTF-8 text");
      expect(loaded.ir.status).toBe("parsed_with_warnings");
      expect(loaded.ir.metrics.extraction_quality).not.toBe("good");
    });
  });

  it("keeps plain ASCII text on the clean indexed path", () => {
    withTempDir((dir) => {
      const path = join(dir, "plain.txt");
      writeFileSync(path, "Plain ASCII notes about the refund workflow.\n");
      const loaded = loadDocumentForImport(path, "docs/plain.txt");
      expect(loaded.ir.status).toBe("indexed");
      expect(loaded.ir.metrics.extraction_quality).toBe("good");
      expect(loaded.warnings).toEqual([]);
    });
  });

  it("fails an empty .txt with a clear warning instead of needs_ocr", () => {
    withTempDir((dir) => {
      const path = join(dir, "empty.txt");
      writeFileSync(path, "");
      const loaded = loadDocumentForImport(path, "docs/empty.txt");
      expect(loaded.ir.status).toBe("failed");
      expect(loaded.ir.metrics.extraction_quality).toBe("unusable");
      expect(loaded.warnings.join("\n")).toContain("contains no text");
    });
  });
});

describe("decodeTextBytes", () => {
  it("does not retry UTF-16 for text with only an incidental NUL", () => {
    const body = `header\u0000${"normal ascii text ".repeat(20)}`;
    const decoded = decodeTextBytes(Buffer.from(body, "utf8"));
    expect(decoded.text).toBe(body);
    expect(decoded.warnings).toEqual([]);
  });

  it("warns when best-effort decoding still leaves replacement characters", () => {
    const decoded = decodeTextBytes(Buffer.from([0x41, 0x42, 0xc3, 0x28, 0xa0, 0xa1, 0x43]));
    expect(decoded.warnings.join("\n")).toContain("could not be decoded");
  });
});
