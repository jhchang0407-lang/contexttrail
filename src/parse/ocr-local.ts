/**
 * Local OCR toolchain for `contexttrail ocr`.
 *
 * Shells out to locally installed `pdftoppm` (poppler) to rasterize PDF
 * pages and `tesseract` to OCR them — both discovered on PATH, no npm
 * dependencies. Recovered text is cached per source content hash under
 * `.contexttrail/cache/ocr/<hash>.txt`, where the PDF import path
 * (`loadDocumentForImport`) picks it up instead of dead-ending at
 * `needs_ocr`.
 */
import { execFileSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

/** Resolved absolute paths of the two required external tools. */
export type LocalOcrTools = {
  tesseract: string;
  pdftoppm: string;
};

export type OcrToolsLookup =
  | { ok: true; tools: LocalOcrTools }
  | { ok: false; missing: string[]; guidance: string };

/** Hard cap on rasterized pages per PDF; beyond this OCR is truncated. */
export const OCR_PAGE_CAP = 100;

/** Rasterization resolution handed to pdftoppm. */
export const OCR_RASTER_DPI = 300;

/**
 * Minimum count of letter/digit characters before OCR output is trusted.
 * Below this the run is treated as garbage (blank scan, wrong language,
 * pure noise) and the source stays `needs_ocr` instead of indexing noise.
 */
export const OCR_MIN_ALNUM_CHARS = 32;

/** Per-page OCR text, joined with form-feed separators. */
export type LocalOcrPdfResult = {
  /** Page texts joined with form-feed (`\f`) separators. */
  text: string;
  /** Number of pages actually rasterized and OCRed. */
  page_count: number;
  /** True when rasterization hit the page cap. */
  truncated: boolean;
};

/**
 * Discovers `tesseract` and `pdftoppm` on PATH. On failure returns
 * platform-aware install guidance instead of throwing, so the CLI can print
 * it and exit without doing anything.
 */
export function locateOcrTools(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): OcrToolsLookup {
  const tesseract = findExecutableOnPath("tesseract", env, platform);
  const pdftoppm = findExecutableOnPath("pdftoppm", env, platform);
  if (tesseract && pdftoppm) {
    return { ok: true, tools: { tesseract, pdftoppm } };
  }
  const missing = [
    ...(tesseract ? [] : ["tesseract"]),
    ...(pdftoppm ? [] : ["pdftoppm (poppler)"]),
  ];
  return {
    ok: false,
    missing,
    guidance: missingOcrToolsMessage(missing, platform),
  };
}

export function missingOcrToolsMessage(
  missing: string[],
  platform: NodeJS.Platform = process.platform,
): string {
  const lines = [
    `contexttrail ocr needs ${missing.join(" and ")} on your PATH, but ${
      missing.length > 1 ? "they were" : "it was"
    } not found.`,
  ];
  if (platform === "darwin") {
    lines.push("Install with Homebrew, then re-run:", "  brew install tesseract poppler");
  } else if (platform === "linux") {
    lines.push(
      "Install with your package manager, then re-run (Debian/Ubuntu):",
      "  apt install tesseract-ocr poppler-utils",
    );
  } else {
    lines.push(
      "Install them, then re-run:",
      "  macOS:          brew install tesseract poppler",
      "  Debian/Ubuntu:  apt install tesseract-ocr poppler-utils",
    );
  }
  lines.push("Nothing was changed.");
  return lines.join("\n");
}

/** Finds an executable file named `name` on the given PATH, or null. */
export function findExecutableOnPath(
  name: string,
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const pathValue = env.PATH ?? env.Path ?? "";
  const candidates = platform === "win32" ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    for (const candidate of candidates) {
      const full = join(dir, candidate);
      try {
        if (!statSync(full).isFile()) continue;
        accessSync(full, constants.X_OK);
        return full;
      } catch {
        // Missing or not executable in this PATH entry; keep scanning.
      }
    }
  }
  return null;
}

/**
 * Rasterizes a PDF at OCR_RASTER_DPI into a temp dir and OCRs each page,
 * returning page texts joined with form-feed separators. The temp dir is
 * always removed, including on failure. Throws Error with a concise,
 * user-facing message when either tool fails.
 */
export function ocrPdfWithLocalTools(
  tools: LocalOcrTools,
  absPdfPath: string,
  opts: { maxPages?: number } = {},
): LocalOcrPdfResult {
  const maxPages = opts.maxPages ?? OCR_PAGE_CAP;
  const tempDir = mkdtempSync(join(tmpdir(), "contexttrail-ocr-"));
  try {
    runOcrTool(
      tools.pdftoppm,
      [
        "-r",
        String(OCR_RASTER_DPI),
        "-gray",
        "-png",
        "-f",
        "1",
        "-l",
        String(maxPages),
        absPdfPath,
        join(tempDir, "page"),
      ],
      "pdftoppm (page rasterization)",
    );
    const images = readdirSync(tempDir)
      .filter((fileName) => fileName.endsWith(".png"))
      .sort((a, b) => pageNumberOf(a) - pageNumberOf(b));
    if (images.length === 0) {
      throw new Error("pdftoppm (page rasterization) produced no page images");
    }
    const pageTexts = images.map((fileName) =>
      runOcrTool(tools.tesseract, [join(tempDir, fileName), "stdout"], "tesseract (OCR)"),
    );
    return {
      // tesseract sometimes emits its own trailing form feed per page; strip
      // it so the cache file has exactly one \f between pages.
      text: pageTexts.map((pageText) => pageText.replace(/[\f\s]+$/g, "")).join("\f"),
      page_count: images.length,
      truncated: images.length >= maxPages,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * pdftoppm pads page numbers to the width of the highest page it writes, so
 * lexical order is usually fine — but sort numerically anyway so a tool that
 * writes `page-10.png` next to `page-2.png` cannot scramble page order.
 */
function pageNumberOf(fileName: string): number {
  const match = /-(\d+)\.png$/.exec(fileName);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

/** Cap on tool stderr detail surfaced into user-facing warnings. */
const OCR_TOOL_REASON_MAX_CHARS = 300;

function runOcrTool(bin: string, args: string[], label: string): string {
  try {
    return execFileSync(bin, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error(`${label} failed: ${ocrToolFailureReason(err)}`);
  }
}

function ocrToolFailureReason(err: unknown): string {
  const failure = err as { status?: unknown; stderr?: unknown };
  const stderr =
    typeof failure?.stderr === "string"
      ? failure.stderr
      : Buffer.isBuffer(failure?.stderr)
        ? failure.stderr.toString("utf8")
        : "";
  const lastLine = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (lastLine) {
    return lastLine.length <= OCR_TOOL_REASON_MAX_CHARS
      ? lastLine
      : `${lastLine.slice(0, OCR_TOOL_REASON_MAX_CHARS)}…`;
  }
  if (typeof failure?.status === "number") return `exited with status ${failure.status}`;
  return err instanceof Error ? err.message : String(err);
}

/**
 * True when OCR output carries too few letter/digit characters to be worth
 * indexing — the caller should leave the source as `needs_ocr`.
 */
export function ocrTextTooSparse(text: string): boolean {
  let alnum = 0;
  for (const ch of text) {
    if (/[\p{L}\p{N}]/u.test(ch)) {
      alnum += 1;
      if (alnum >= OCR_MIN_ALNUM_CHARS) return false;
    }
  }
  return true;
}

/** `.contexttrail/cache/ocr/<source_content_hash>.txt` under the workspace. */
export function ocrCachePath(workspaceRoot: string, sourceContentHash: string): string {
  return join(workspaceRoot, ".contexttrail/cache/ocr", `${sourceContentHash}.txt`);
}

/** Cached OCR text for a content hash, or null when absent. */
export function readOcrCacheText(
  workspaceRoot: string,
  sourceContentHash: string,
): string | null {
  const path = ocrCachePath(workspaceRoot, sourceContentHash);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

/** Writes OCR text into the cache, creating directories; returns the path. */
export function writeOcrCacheText(
  workspaceRoot: string,
  sourceContentHash: string,
  text: string,
): string {
  const path = ocrCachePath(workspaceRoot, sourceContentHash);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
  return path;
}
