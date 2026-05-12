import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runImport } from "./import.js";
import { runIndex } from "./index-cmd.js";
import { openDb, closeDb } from "../store/db.js";
import {
  getSourceProfile,
  listSourceProfiles,
} from "../store/source-profiles.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "contexttrail-import-sp-"));
  mkdirSync(join(cwd, "docs/concepts"), { recursive: true });
  mkdirSync(join(cwd, "docs/adr"), { recursive: true });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("import wires SourceProfiles", () => {
  it("materializes profiles for every imported markdown source", () => {
    writeFileSync(
      join(cwd, "docs/concepts/foo.md"),
      "# Foo concept\n\nIntro paragraph.\n\n## Setup\n",
    );
    writeFileSync(
      join(cwd, "docs/adr/0001-test.md"),
      "# ADR-0001\n\nDecision body.\n",
    );

    runImport(cwd, ["docs/**/*.md"]);

    const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
    try {
      const profiles = listSourceProfiles(db);
      expect(profiles.map((p) => p.source_path)).toEqual([
        "docs/adr/0001-test.md",
        "docs/concepts/foo.md",
      ]);
      const concept = getSourceProfile(db, "docs/concepts/foo.md");
      expect(concept?.doc_purpose).toBe("concept");
      expect(concept?.title).toBe("Foo concept");
      expect(concept?.aliases.some((a) => a.kind === "filename" && a.value === "foo")).toBe(true);

      const adr = getSourceProfile(db, "docs/adr/0001-test.md");
      expect(adr?.doc_purpose).toBe("adr");
      expect(adr?.doc_role).toBe("canonical");
    } finally {
      closeDb(db);
    }
  });

  it("refreshes profile when source content changes via reindex", () => {
    const path = join(cwd, "docs/concepts/foo.md");
    writeFileSync(path, "# Foo concept\n\nFirst intro.\n");
    runImport(cwd, ["docs/**/*.md"]);

    let db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
    const before = getSourceProfile(db, "docs/concepts/foo.md")!;
    closeDb(db);

    writeFileSync(path, "# Foo concept v2\n\nUpdated intro.\n\n## How do I use it?\n");
    runIndex(cwd);

    db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
    try {
      const after = getSourceProfile(db, "docs/concepts/foo.md")!;
      expect(after.title).toBe("Foo concept v2");
      expect(after.source_content_hash).not.toBe(before.source_content_hash);
      expect(after.questions_answered).toContain("How do I use it?");
    } finally {
      closeDb(db);
    }
  });

  it("removes profile when source disappears via reindex", () => {
    const path = join(cwd, "docs/concepts/foo.md");
    writeFileSync(path, "# Foo\n\nIntro.\n");
    runImport(cwd, ["docs/**/*.md"]);
    rmSync(path);

    runIndex(cwd);

    const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
    try {
      expect(getSourceProfile(db, "docs/concepts/foo.md")).toBeNull();
    } finally {
      closeDb(db);
    }
  });
});
