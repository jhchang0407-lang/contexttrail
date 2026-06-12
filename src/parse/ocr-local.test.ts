import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OCR_MIN_ALNUM_CHARS,
  OCR_PAGE_CAP,
  findExecutableOnPath,
  locateOcrTools,
  missingOcrToolsMessage,
  ocrCachePath,
  ocrPdfWithLocalTools,
  ocrTextTooSparse,
  readOcrCacheText,
  writeOcrCacheText,
} from "./ocr-local.js";

function withTempDir<T>(run: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "contexttrail-ocrlocal-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeFakeTool(dir: string, name: string, script: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${script}\n`, "utf8");
  chmodSync(path, 0o755);
  return path;
}

describe("locateOcrTools", () => {
  it("finds tesseract and pdftoppm on a PATH that contains them", () => {
    withTempDir((dir) => {
      const tesseract = writeFakeTool(dir, "tesseract", "exit 0");
      const pdftoppm = writeFakeTool(dir, "pdftoppm", "exit 0");
      const lookup = locateOcrTools({ PATH: dir }, "darwin");
      expect(lookup.ok).toBe(true);
      if (lookup.ok) {
        expect(lookup.tools.tesseract).toBe(tesseract);
        expect(lookup.tools.pdftoppm).toBe(pdftoppm);
      }
    });
  });

  it("reports both tools missing on a stripped PATH without touching anything", () => {
    withTempDir((dir) => {
      const lookup = locateOcrTools({ PATH: dir }, "darwin");
      expect(lookup.ok).toBe(false);
      if (!lookup.ok) {
        expect(lookup.missing).toEqual(["tesseract", "pdftoppm (poppler)"]);
        expect(lookup.guidance).toContain("brew install tesseract poppler");
      }
    });
  });

  it("reports only the missing tool when the other is present", () => {
    withTempDir((dir) => {
      writeFakeTool(dir, "tesseract", "exit 0");
      const lookup = locateOcrTools({ PATH: dir }, "linux");
      expect(lookup.ok).toBe(false);
      if (!lookup.ok) {
        expect(lookup.missing).toEqual(["pdftoppm (poppler)"]);
        expect(lookup.guidance).toContain("apt install tesseract-ocr poppler-utils");
      }
    });
  });

  it("skips non-executable files when scanning PATH", () => {
    withTempDir((dir) => {
      const path = join(dir, "tesseract");
      writeFileSync(path, "not executable", "utf8");
      chmodSync(path, 0o644);
      expect(findExecutableOnPath("tesseract", { PATH: dir }, "darwin")).toBeNull();
    });
  });
});

describe("missingOcrToolsMessage", () => {
  it("gives brew guidance on macOS and apt guidance on Debian/Ubuntu", () => {
    const mac = missingOcrToolsMessage(["tesseract"], "darwin");
    expect(mac).toContain("brew install tesseract poppler");
    const linux = missingOcrToolsMessage(["tesseract"], "linux");
    expect(linux).toContain("apt install tesseract-ocr poppler-utils");
    const other = missingOcrToolsMessage(["tesseract"], "win32");
    expect(other).toContain("brew install tesseract poppler");
    expect(other).toContain("apt install tesseract-ocr poppler-utils");
  });
});

describe("ocrPdfWithLocalTools", () => {
  it("rasterizes pages, OCRs each one in numeric order, and joins with form feeds", () => {
    withTempDir((dir) => {
      // Fake pdftoppm: writes 11 unpadded page images so numeric ordering is
      // exercised (lexical order would put page-10 before page-2). Fake
      // tesseract: echoes a marker derived from the image file's content.
      const pdftoppm = writeFakeTool(
        dir,
        "pdftoppm",
        [
          'for last; do :; done',
          'for i in 1 2 3 4 5 6 7 8 9 10 11; do',
          '  printf "img-%s" "$i" > "${last}-${i}.png"',
          "done",
        ].join("\n"),
      );
      const tesseract = writeFakeTool(dir, "tesseract", 'printf "text from %s\\n" "$(cat "$1")"');
      const pdfPath = join(dir, "scan.pdf");
      writeFileSync(pdfPath, "%PDF-fake");

      const result = ocrPdfWithLocalTools({ tesseract, pdftoppm }, pdfPath);

      const pages = result.text.split("\f");
      expect(pages).toHaveLength(11);
      expect(pages[0]).toBe("text from img-1");
      expect(pages[1]).toBe("text from img-2");
      expect(pages[10]).toBe("text from img-11");
      expect(result.page_count).toBe(11);
      expect(result.truncated).toBe(false);
    });
  });

  it("reports truncation when the page cap is hit", () => {
    withTempDir((dir) => {
      const pdftoppm = writeFakeTool(
        dir,
        "pdftoppm",
        ['for last; do :; done', 'printf "x" > "${last}-1.png"', 'printf "y" > "${last}-2.png"'].join(
          "\n",
        ),
      );
      const tesseract = writeFakeTool(dir, "tesseract", 'printf "page text"');
      const pdfPath = join(dir, "scan.pdf");
      writeFileSync(pdfPath, "%PDF-fake");

      const result = ocrPdfWithLocalTools({ tesseract, pdftoppm }, pdfPath, { maxPages: 2 });
      expect(result.page_count).toBe(2);
      expect(result.truncated).toBe(true);
    });
  });

  it("surfaces a concise tool failure message from stderr", () => {
    withTempDir((dir) => {
      const pdftoppm = writeFakeTool(
        dir,
        "pdftoppm",
        'echo "Syntax Error: file is damaged" >&2; exit 1',
      );
      const tesseract = writeFakeTool(dir, "tesseract", "exit 0");
      const pdfPath = join(dir, "scan.pdf");
      writeFileSync(pdfPath, "%PDF-fake");

      expect(() => ocrPdfWithLocalTools({ tesseract, pdftoppm }, pdfPath)).toThrowError(
        /pdftoppm \(page rasterization\) failed: Syntax Error: file is damaged/,
      );
    });
  });

  it("fails clearly when rasterization produces no page images", () => {
    withTempDir((dir) => {
      const pdftoppm = writeFakeTool(dir, "pdftoppm", "exit 0");
      const tesseract = writeFakeTool(dir, "tesseract", "exit 0");
      const pdfPath = join(dir, "scan.pdf");
      writeFileSync(pdfPath, "%PDF-fake");

      expect(() => ocrPdfWithLocalTools({ tesseract, pdftoppm }, pdfPath)).toThrowError(
        /produced no page images/,
      );
    });
  });

  it("caps pages at 100 by default", () => {
    expect(OCR_PAGE_CAP).toBe(100);
  });
});

describe("ocrTextTooSparse", () => {
  it("treats symbol noise and near-empty output as garbage", () => {
    expect(ocrTextTooSparse("")).toBe(true);
    expect(ocrTextTooSparse("|. ~~ __ -- \f \n |")).toBe(true);
    expect(ocrTextTooSparse("ok")).toBe(true);
  });

  it("accepts real page text", () => {
    const text =
      "CLAIM SUMMARY\n\nThe water mitigation invoice total is $4,250 and was approved.";
    expect(text.replace(/[^\p{L}\p{N}]/gu, "").length).toBeGreaterThanOrEqual(
      OCR_MIN_ALNUM_CHARS,
    );
    expect(ocrTextTooSparse(text)).toBe(false);
  });
});

describe("OCR cache", () => {
  it("round-trips text under .contexttrail/cache/ocr/<hash>.txt", () => {
    withTempDir((dir) => {
      const hash = "ab12cd34";
      expect(readOcrCacheText(dir, hash)).toBeNull();
      const path = writeOcrCacheText(dir, hash, "Page one\fPage two");
      expect(path).toBe(join(dir, ".contexttrail/cache/ocr", "ab12cd34.txt"));
      expect(path).toBe(ocrCachePath(dir, hash));
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, "utf8")).toBe("Page one\fPage two");
      expect(readOcrCacheText(dir, hash)).toBe("Page one\fPage two");
    });
  });
});
