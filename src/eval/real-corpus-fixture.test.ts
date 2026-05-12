import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import fg from "fast-glob";
import { describe, expect, it } from "vitest";
import {
  loadRealCorpusEvalSet,
  realCorpusDocsPath,
  realCorpusRoot,
} from "./real-corpus-fixture.js";
import { loadRealCorpusImportGlobs } from "./real-corpus-config.js";

function discoverRepos(): string[] {
  const root = realCorpusRoot();
  return readdirSync(root)
    .filter((name) => name.endsWith(".yaml"))
    .filter((name) => !name.endsWith(".config.yaml"))
    .map((name) => name.replace(/\.yaml$/, ""))
    .filter((repo) => statSync(realCorpusDocsPath(repo)).isDirectory())
    .sort();
}

describe("real-corpus fixture import coverage", () => {
  it("imports every source referenced by eval expectations", () => {
    for (const repo of discoverRepos()) {
      const importable = new Set(
        fg.sync(loadRealCorpusImportGlobs({ repo, root: realCorpusRoot() }), {
          cwd: realCorpusDocsPath(repo),
          onlyFiles: true,
        }),
      );
      const referenced = new Set<string>();
      for (const entry of loadRealCorpusEvalSet(repo)) {
        if (entry.expected_top_source) referenced.add(entry.expected_top_source);
        for (const source of entry.acceptable_top_sources ?? []) referenced.add(source);
        for (const source of entry.must_include_sources) referenced.add(source);
      }

      const fixtureRoot = realCorpusDocsPath(repo);
      const existingReferenced = [...referenced].filter((source) =>
        existsSync(join(fixtureRoot, source)),
      );
      const missing = existingReferenced.filter((source) => !importable.has(source));
      expect(missing, `${repo} references sources outside REAL_CORPUS_IMPORT_GLOBS`).toEqual([]);
    }
  });
});
