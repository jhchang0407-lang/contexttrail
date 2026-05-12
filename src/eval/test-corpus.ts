/**
 * TestCorpus — shared fixture-setup builder for tests that need a populated
 * `.contexttrail` repo. Wraps tempdir lifecycle, init, doc/card writing, and
 * the actual import paths (`runImport`, `importAcceptedCards`) so tests still
 * exercise real import behavior but stop reinventing the boilerplate.
 *
 * Used by:
 *   - `src/eval/lab.ts` (eval fixture)
 *   - tests under `src/mcp/` and `src/cli/` that build ad-hoc temp repos
 *
 * Intentionally NOT used by:
 *   - `src/cli/cold-install.test.ts` — that test exercises a subprocess on
 *     purpose; its seam is the wire boundary, not the fixture boundary.
 */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { importAcceptedCards, type CardImportSummary } from "../cards/lifecycle.js";
import { runImport, type ImportSummary } from "../cli/import.js";
import { init } from "../config/init.js";
import { writeCardFixture, type EvalCardFixture } from "./card-fixtures.js";

/** Generalized name for a typed Card fixture. Same shape as `EvalCardFixture`. */
export type TestCardSpec = EvalCardFixture & {
  /** Optional override for the card filename (default: derived from id). */
  filename?: string;
};

export type TestCorpus = {
  /** Working directory of the temp repo. */
  cwd: string;
  /** Recursively copy a directory into `<cwd>/docs/`. */
  copyDocsFrom(src: string): void;
  /** Recursively copy a directory of card markdown files into `<cwd>/.contexttrail/cards/`. */
  copyCardsFrom(src: string): void;
  /** Write an arbitrary file at `<cwd>/<path>`, creating parent dirs. */
  writeDoc(path: string, contents: string): void;
  /** Write a typed Card fixture into `<cwd>/.contexttrail/cards/`. */
  writeCard(spec: TestCardSpec): void;
  /** Run `contexttrail import` over the given globs (defaults to `["docs/**\/*.md"]`). */
  importDocs(globs?: string[]): ImportSummary;
  /** Run `contexttrail card import`. */
  importCards(): CardImportSummary;
  /** Recursively delete the temp repo. */
  cleanup(): void;
};

export type CreateTestCorpusOptions = {
  /** Filesystem prefix for the tempdir name. Default: "contexttrail-test-". */
  prefix?: string;
};

const DEFAULT_DOCS_GLOB = ["docs/**/*.md"];

export function createTestCorpus(opts: CreateTestCorpusOptions = {}): TestCorpus {
  const prefix = opts.prefix ?? "contexttrail-test-";
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  init(cwd);

  return {
    cwd,
    copyDocsFrom(src: string): void {
      copyDirSync(src, join(cwd, "docs"));
    },
    copyCardsFrom(src: string): void {
      copyDirSync(src, join(cwd, ".contexttrail/cards"));
    },
    writeDoc(path: string, contents: string): void {
      const target = join(cwd, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents, "utf8");
    },
    writeCard(spec: TestCardSpec): void {
      const cardsDir = join(cwd, ".contexttrail/cards");
      mkdirSync(cardsDir, { recursive: true });
      const filename = spec.filename ?? `${spec.id.toLowerCase()}.md`;
      writeCardFixture(cardsDir, filename, spec);
    },
    importDocs(globs: string[] = DEFAULT_DOCS_GLOB): ImportSummary {
      return runImport(cwd, globs);
    },
    importCards(): CardImportSummary {
      return importAcceptedCards(cwd);
    },
    cleanup(): void {
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}

function copyDirSync(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const sp = join(src, name);
    const dp = join(dst, name);
    if (statSync(sp).isDirectory()) copyDirSync(sp, dp);
    else copyFileSync(sp, dp);
  }
}
