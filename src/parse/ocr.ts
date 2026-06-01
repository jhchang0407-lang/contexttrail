import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type OcrResult = {
  text: string;
  warnings: string[];
};

export type OcrProvider = {
  id: "local";
  isAvailable(): boolean;
  extract(sourcePath: string): Promise<OcrResult>;
};

export function localOcrUnavailableMessage(): string {
  return "Local OCR is not configured. Install a local OCR toolchain, then rerun OCR explicitly for this source.";
}

export function createUnavailableLocalOcrProvider(): OcrProvider {
  return {
    id: "local",
    isAvailable: () => false,
    async extract() {
      throw new Error(localOcrUnavailableMessage());
    },
  };
}

export function cachedOcrPath(cwd: string, sourceContentHash: string): string {
  return join(cwd, ".contexttrail/extractions", `${sourceContentHash}.txt`);
}

export function readCachedOcrResult(
  cwd: string,
  sourceContentHash: string,
): OcrResult | null {
  const path = cachedOcrPath(cwd, sourceContentHash);
  if (!existsSync(path)) return null;
  return {
    text: readFileSync(path, "utf8"),
    warnings: [],
  };
}

export function writeCachedOcrResult(
  cwd: string,
  sourceContentHash: string,
  result: OcrResult,
): string {
  const path = cachedOcrPath(cwd, sourceContentHash);
  mkdirSync(join(cwd, ".contexttrail/extractions"), { recursive: true });
  writeFileSync(path, result.text, "utf8");
  return path;
}
