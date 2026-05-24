import { describe, it, expect } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeDb, openDb } from "../../../../store/db.js";
import {
  expandCodeGraph,
  hasCodeGraphNode,
  listCodeGraphNeighbors,
  syncCodeGraph,
} from "./code-graph.js";
import { upsertCodeSource } from "./code-sources.js";
import { createTestCorpus } from "../../eval/test-corpus.js";
import { runIndex } from "../../cli/index-cmd.js";

describe("code graph", () => {
  it("answers outgoing import neighbors and incoming importers from the persisted graph", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-code-graph-" });
    const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "src"), { recursive: true });
      writeFileSync(
        join(cwd, "src/a.ts"),
        'import { b } from "./b.js";\nimport { feature } from "./feature";\nexport const a = b + feature;\n',
      );
      writeFileSync(join(cwd, "src/b.ts"), "export const b = 1;\n");
      mkdirSync(join(cwd, "src/feature"), { recursive: true });
      writeFileSync(
        join(cwd, "src/feature/index.ts"),
        "export const feature = 1;\n",
      );
      corpus.writeDoc("docs/a.md", "# A\n");

      corpus.importDocs();

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      try {
        expect(
          listCodeGraphNeighbors(db, {
            source_path: "src/a.ts",
            direction: "outgoing",
          }),
        ).toEqual(["src/b.ts", "src/feature/index.ts"]);
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

  it("resolves Rust crate-root module imports to src-relative files", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-code-graph-" });
    const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "crates/app/src/syntax"), { recursive: true });
      writeFileSync(
        join(cwd, "crates/app/src/lib.rs"),
        "use crate::syntax::selector;\npub fn run() {}\n",
      );
      writeFileSync(
        join(cwd, "crates/app/src/syntax/selector.rs"),
        "pub fn selector() {}\n",
      );
      corpus.writeDoc("docs/a.md", "# A\n");

      corpus.importDocs();

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      try {
        expect(
          listCodeGraphNeighbors(db, {
            source_path: "crates/app/src/lib.rs",
            direction: "outgoing",
          }),
        ).toEqual(["crates/app/src/syntax/selector.rs"]);
        expect(
          listCodeGraphNeighbors(db, {
            source_path: "crates/app/src/syntax/selector.rs",
            direction: "incoming",
          }),
        ).toEqual(["crates/app/src/lib.rs"]);
      } finally {
        closeDb(db);
      }
    } finally {
      corpus.cleanup();
    }
  });

  it("resolves monorepo package imports to package entrypoints", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-code-graph-" });
    const cwd = corpus.cwd;
    try {
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      try {
        upsertCodeSource(db, {
          facts: {
            file_path: "packages/app/src/main.ts",
            exported_symbols: [{ name: "main", kind: "function" }],
            exported_signatures: ["export function main(): void"],
            file_purpose: null,
            imports: ["@scope/core"],
            package_facts: {
              package_root: "packages/app",
              package_name: "@scope/app",
              manifest_path: "packages/app/package.json",
              internal_dependency_names: ["@scope/core"],
              internal_dependency_roots: ["packages/core"],
              internal_dependent_names: [],
              internal_dependent_roots: [],
              script_names: [],
              export_keys: [],
            },
          },
          source_content_hash: "hash:app",
          indexed_at: "2026-05-11T00:00:00Z",
        });
        upsertCodeSource(db, {
          facts: {
            file_path: "packages/core/src/index.ts",
            exported_symbols: [{ name: "core", kind: "function" }],
            exported_signatures: ["export function core(): void"],
            file_purpose: null,
            imports: [],
            package_facts: {
              package_root: "packages/core",
              package_name: "@scope/core",
              manifest_path: "packages/core/package.json",
              internal_dependency_names: [],
              internal_dependency_roots: [],
              internal_dependent_names: ["@scope/app"],
              internal_dependent_roots: ["packages/app"],
              script_names: [],
              export_keys: ["."],
            },
          },
          source_content_hash: "hash:core",
          indexed_at: "2026-05-11T00:00:00Z",
        });

        syncCodeGraph(db);

        expect(
          listCodeGraphNeighbors(db, {
            source_path: "packages/app/src/main.ts",
            direction: "outgoing",
          }),
        ).toEqual(["packages/core/src/index.ts"]);
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
