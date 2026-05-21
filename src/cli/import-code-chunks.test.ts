import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "../store/db.js";
import { closeDb, openDb } from "../store/db.js";
import { listCodeChunksForSource } from "../store/code-chunks.js";
import { getCodeSource } from "../store/code-sources.js";
import { importCodeSources } from "./import.js";

const NOW = "2026-05-13T00:00:00Z";

let cwd: string;
let db: Db;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "contexttrail-import-code-"));
  mkdirSync(join(cwd, "src/retrieve"), { recursive: true });
  db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
});

afterEach(() => {
  closeDb(db);
  rmSync(cwd, { recursive: true, force: true });
});

describe("importCodeSources", () => {
  it("indexes file identity and child code chunks in the same import pass", () => {
    writeFileSync(
      join(cwd, "src/retrieve/foo.ts"),
      `/** Build the retrieval plan. */
import { helper } from "./helper.js";

export function buildPlan(): string {
  return helper();
}

export class Planner {
  execute(): string {
    return buildPlan();
  }
}
`,
      "utf8",
    );
    closeSync(openSync(join(cwd, "src/retrieve/helper.ts"), "w"));

    const result = importCodeSources({
      cwd,
      db,
      indexed_at: NOW,
      globs: ["src/**/*.ts"],
      ignore: [],
    });

    expect(result.files_indexed).toBe(2);
    expect(getCodeSource(db, "src/retrieve/foo.ts")).not.toBeNull();
    const chunks = listCodeChunksForSource(db, "src/retrieve/foo.ts");
    expect(chunks.some((chunk) => chunk.code_role === "orientation")).toBe(true);
    expect(chunks.some((chunk) => chunk.symbol_path === "buildPlan")).toBe(true);
    expect(chunks.some((chunk) => chunk.symbol_path === "Planner.execute")).toBe(true);
  });

  it("indexes Rust files as searchable code chunks, not only file-level metadata", () => {
    mkdirSync(join(cwd, "src/bin"), { recursive: true });
    writeFileSync(
      join(cwd, "src/bin/lessopen.rs"),
      `//! lessopen integration.

fn render_lessopen() -> String {
  String::new()
}
`,
      "utf8",
    );

    const result = importCodeSources({
      cwd,
      db,
      indexed_at: NOW,
      globs: ["src/**/*.rs"],
      ignore: [],
    });

    expect(result.files_indexed).toBe(1);
    expect(getCodeSource(db, "src/bin/lessopen.rs")).not.toBeNull();
    const chunks = listCodeChunksForSource(db, "src/bin/lessopen.rs");
    expect(chunks).toContainEqual(expect.objectContaining({
      source_path: "src/bin/lessopen.rs",
      code_role: "orientation",
      symbol_path: null,
    }));
    expect(chunks).toContainEqual(expect.objectContaining({
      source_path: "src/bin/lessopen.rs",
      code_role: "declaration",
      symbol_path: "render_lessopen",
    }));
    expect(chunks.map((chunk) => chunk.body).join("\n")).toContain("lessopen");
  });
});
