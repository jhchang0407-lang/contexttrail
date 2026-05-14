import { describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runImport } from "../cli/import.js";
import { init } from "../config/init.js";
import { closeDb, openDb } from "../store/db.js";
import { listCurrentChunksCanonical } from "../store/read-model.js";
import { listCurrentCodeChunks } from "../store/code-chunks.js";
import {
  COMMIT_GROUNDED_EVAL_IMPORT_GLOBS,
  prepareCommitGroundedEvalWorkspace,
  shouldCopyCommitGroundedEvalSource,
} from "./import-globs.js";

describe("COMMIT_GROUNDED_EVAL_IMPORT_GLOBS", () => {
  it("keeps source-truth docs while excluding generated docs/evals artifacts", () => {
    const cwd = mkdtempSync(join(tmpdir(), "contexttrail-eval-imports-"));
    try {
      init(cwd);
      mkdirSync(join(cwd, "docs/evals/reports"), { recursive: true });
      writeFileSync(join(cwd, "README.md"), "# Root doc\n", "utf8");
      writeFileSync(join(cwd, "docs/guide.md"), "# Guide\n", "utf8");
      writeFileSync(
        join(cwd, "docs/evals/reports/leak.md"),
        "# Generated report\n\nsrc/secret.ts\n",
        "utf8",
      );

      runImport(cwd, COMMIT_GROUNDED_EVAL_IMPORT_GLOBS);

      const db = openDb(join(cwd, ".contexttrail", "cache", "contexttrail.db"));
      try {
        const importedSources = new Set(
          listCurrentChunksCanonical(db).map((chunk) => chunk.source_path),
        );

        expect(importedSources.has("README.md")).toBe(true);
        expect(importedSources.has("docs/guide.md")).toBe(true);
        expect(importedSources.has("docs/evals/reports/leak.md")).toBe(false);
      } finally {
        closeDb(db);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("prepareCommitGroundedEvalWorkspace", () => {
  it("copies product source while excluding measurement sources under src/eval", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "contexttrail-eval-src-root-"));
    const cwd = mkdtempSync(join(tmpdir(), "contexttrail-eval-src-workspace-"));
    try {
      mkdirSync(join(repoRoot, "docs"), { recursive: true });
      mkdirSync(join(repoRoot, "src/eval"), { recursive: true });
      mkdirSync(join(repoRoot, "src/retrieve"), { recursive: true });
      writeFileSync(join(repoRoot, "docs/guide.md"), "# Guide\n", "utf8");
      writeFileSync(
        join(repoRoot, "src/retrieve/product.ts"),
        "export function productPath() { return 'ok'; }\n",
        "utf8",
      );
      writeFileSync(
        join(repoRoot, "src/eval/leak.ts"),
        "export const ticket = 'THO-228';\n",
        "utf8",
      );

      init(cwd);
      prepareCommitGroundedEvalWorkspace({ repoRoot, cwd });
      runImport(cwd, [...COMMIT_GROUNDED_EVAL_IMPORT_GLOBS]);

      const db = openDb(join(cwd, ".contexttrail", "cache", "contexttrail.db"));
      try {
        const importedDocs = new Set(
          listCurrentChunksCanonical(db).map((chunk) => chunk.source_path),
        );
        const importedCode = new Set(
          listCurrentCodeChunks(db).map((chunk) => chunk.source_path),
        );

        expect(importedDocs.has("docs/guide.md")).toBe(true);
        expect(importedCode.has("src/retrieve/product.ts")).toBe(true);
        expect(importedCode.has("src/eval/leak.ts")).toBe(false);
      } finally {
        closeDb(db);
      }
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("shouldCopyCommitGroundedEvalSource", () => {
  it("rejects measurement sources under src/eval while keeping product code", () => {
    expect(shouldCopyCommitGroundedEvalSource("src/eval/agent-completion-probe.ts")).toBe(false);
    expect(shouldCopyCommitGroundedEvalSource("src/retrieve/source-rerank.ts")).toBe(true);
    expect(shouldCopyCommitGroundedEvalSource("docs/guide.md")).toBe(true);
  });
});
