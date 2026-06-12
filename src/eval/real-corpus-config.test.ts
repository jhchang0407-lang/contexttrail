/**
 * Repo-configurable corpus import globs (V2.5.2).
 * Each real-corpus repo can declare its own import globs; Zod is the first
 * holdout consumer that opts into the wiki layout.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REAL_CORPUS_DEFAULT_IMPORT_GLOBS,
  loadRealCorpusImportGlobs,
} from "./real-corpus-config.js";

function withTempRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "contexttrail-rc-config-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("loadRealCorpusImportGlobs", () => {
  it("returns the deterministic defaults when no per-repo config file exists", () => {
    const { root, cleanup } = withTempRoot();
    try {
      const globs = loadRealCorpusImportGlobs({ repo: "anything", root });
      expect(globs).toEqual(REAL_CORPUS_DEFAULT_IMPORT_GLOBS);
    } finally {
      cleanup();
    }
  });

  it("reads import_globs from <repo>.config.yaml and replaces defaults", () => {
    const { root, cleanup } = withTempRoot();
    try {
      writeFileSync(
        join(root, "zod.config.yaml"),
        ["import_globs:", "  - 'README.md'", "  - 'wiki/**/*.md'", ""].join("\n"),
      );
      const globs = loadRealCorpusImportGlobs({ repo: "zod", root });
      expect(globs).toEqual(["README.md", "wiki/**/*.md"]);
    } finally {
      cleanup();
    }
  });

  it("does not affect other repos when one repo declares an override", () => {
    const { root, cleanup } = withTempRoot();
    try {
      writeFileSync(
        join(root, "zod.config.yaml"),
        ["import_globs:", "  - 'wiki/**/*.md'", ""].join("\n"),
      );
      const zod = loadRealCorpusImportGlobs({ repo: "zod", root });
      const ralph = loadRealCorpusImportGlobs({ repo: "ralph", root });
      expect(zod).toEqual(["wiki/**/*.md"]);
      expect(ralph).toEqual(REAL_CORPUS_DEFAULT_IMPORT_GLOBS);
    } finally {
      cleanup();
    }
  });

  it("returns defaults when the config file omits import_globs", () => {
    const { root, cleanup } = withTempRoot();
    try {
      writeFileSync(join(root, "zod.config.yaml"), "other_key: foo\n");
      expect(loadRealCorpusImportGlobs({ repo: "zod", root })).toEqual(
        REAL_CORPUS_DEFAULT_IMPORT_GLOBS,
      );
    } finally {
      cleanup();
    }
  });

  it("default globs DO NOT include 'wiki/**/*.md' (must be declared per-repo)", () => {
    // Precondition for the holdout fix: `wiki/` is non-standard and must be
    // opt-in so unrelated repos do not silently inherit it.
    expect(REAL_CORPUS_DEFAULT_IMPORT_GLOBS).not.toContain("wiki/**/*.md");
  });
});
