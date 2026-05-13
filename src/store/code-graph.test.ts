import { describe, it, expect } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeDb, openDb } from "./db.js";
import {
  expandCodeGraph,
  hasCodeGraphNode,
  listCodeGraphNeighbors,
} from "./code-graph.js";
import { createTestCorpus } from "../eval/test-corpus.js";
import { runIndex } from "../cli/index-cmd.js";

describe("code graph", () => {
  it("answers outgoing import neighbors and incoming importers from the persisted graph", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-code-graph-" });
    const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "src"), { recursive: true });
      writeFileSync(
        join(cwd, "src/a.ts"),
        'import { b } from "./b.js";\nexport const a = b;\n',
      );
      writeFileSync(join(cwd, "src/b.ts"), "export const b = 1;\n");
      corpus.writeDoc("docs/a.md", "# A\n");

      corpus.importDocs();

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      try {
        expect(
          listCodeGraphNeighbors(db, {
            source_path: "src/a.ts",
            direction: "outgoing",
          }),
        ).toEqual(["src/b.ts"]);
        expect(
          listCodeGraphNeighbors(db, {
            source_path: "src/b.ts",
            direction: "incoming",
          }),
        ).toEqual(["src/a.ts"]);
      } finally {
        closeDb(db);
      }
    } finally {
      corpus.cleanup();
    }
  });

  it("expands a seed set by bounded outgoing and incoming traversal", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-code-graph-" });
    const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "src"), { recursive: true });
      writeFileSync(
        join(cwd, "src/a.ts"),
        'import { b } from "./b.js";\nexport const a = b;\n',
      );
      writeFileSync(
        join(cwd, "src/b.ts"),
        'import { c } from "./c.js";\nexport const b = c;\n',
      );
      writeFileSync(join(cwd, "src/c.ts"), "export const c = 1;\n");
      writeFileSync(
        join(cwd, "src/d.ts"),
        'import { b } from "./b.js";\nexport const d = b;\n',
      );
      corpus.writeDoc("docs/a.md", "# A\n");

      corpus.importDocs();

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      try {
        expect(
          [...expandCodeGraph(db, {
            seeds: ["src/b.ts"],
            directions: ["outgoing", "incoming"],
            maxHops: 1,
          })].sort(),
        ).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]);
      } finally {
        closeDb(db);
      }
    } finally {
      corpus.cleanup();
    }
  });

  it("drops deleted files from graph reads after index tombstones the missing code-source", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-code-graph-" });
    const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "src"), { recursive: true });
      const aPath = join(cwd, "src/a.ts");
      const bPath = join(cwd, "src/b.ts");
      writeFileSync(aPath, 'import { b } from "./b.js";\nexport const a = b;\n');
      writeFileSync(bPath, "export const b = 1;\n");
      corpus.writeDoc("docs/a.md", "# A\n");

      corpus.importDocs();

      rmSync(bPath);
      runIndex(cwd);

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      try {
        expect(hasCodeGraphNode(db, "src/b.ts")).toBe(false);
        expect(
          listCodeGraphNeighbors(db, {
            source_path: "src/a.ts",
            direction: "outgoing",
          }),
        ).toEqual([]);
      } finally {
        closeDb(db);
      }
    } finally {
      corpus.cleanup();
    }
  });
});
