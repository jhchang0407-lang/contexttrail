/**
 * Integration (V2.5.2): the zod fixture declares the wiki import glob, so
 * wiki/optionality.md is in the imported inventory and Zod's holdout misses
 * on that file are no longer attributable to corpus coverage.
 */
import { describe, it, expect } from "vitest";
import { loadRealCorpusImportGlobs } from "./real-corpus-config.js";
import { realCorpusRoot } from "./real-corpus-fixture.js";

describe("zod fixture import globs (THO-135)", () => {
  it("declares the wiki layout so wiki/optionality.md is opted in", () => {
    const globs = loadRealCorpusImportGlobs({
      repo: "zod",
      root: realCorpusRoot(),
    });
    expect(globs).toContain("wiki/**/*.md");
  });

  it("ralph (no override) inherits deterministic defaults without wiki", () => {
    const globs = loadRealCorpusImportGlobs({
      repo: "ralph",
      root: realCorpusRoot(),
    });
    expect(globs).not.toContain("wiki/**/*.md");
  });
});
