import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "../store/db.js";
import { closeDb, openDb } from "../store/db.js";
import { upsertCodeSource } from "../store/code-sources.js";
import { replaceCodeChunksForSource } from "../store/code-chunks.js";
import { loadConfig } from "../config/load.js";
import { retrieve } from "./retrieve.js";

let cwd: string;
let db: Db;
let oldCodeSourceIndex: string | undefined;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "contexttrail-code-trigger-"));
  db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  oldCodeSourceIndex = process.env.RETRIEVAL_CODE_SOURCE_INDEX;
  process.env.RETRIEVAL_CODE_SOURCE_INDEX = "on";
});

afterEach(() => {
  closeDb(db);
  rmSync(cwd, { recursive: true, force: true });
  if (oldCodeSourceIndex === undefined) {
    delete process.env.RETRIEVAL_CODE_SOURCE_INDEX;
  } else {
    process.env.RETRIEVAL_CODE_SOURCE_INDEX = oldCodeSourceIndex;
  }
});

describe("code lane trigger", () => {
  it("runs code retrieval for conventional feature titles", () => {
    upsertCodeSource(db, {
      facts: {
        file_path: "crates/biome_css_parser/src/syntax/scss/value/interpolated_value.rs",
        exported_symbols: [{ name: "parse_interpolated_value", kind: "function" }],
        exported_signatures: ["fn parse_interpolated_value()"],
        file_purpose: "SCSS parser support for interpolated values.",
        imports: [],
      },
      source_content_hash: "hash:scss",
      indexed_at: "2026-05-16T00:00:00Z",
    });
    replaceCodeChunksForSource(db, {
      source_path: "crates/biome_css_parser/src/syntax/scss/value/interpolated_value.rs",
      source_content_hash: "hash:scss",
      indexed_at: "2026-05-16T00:00:00Z",
      chunks: [{
        source_path: "crates/biome_css_parser/src/syntax/scss/value/interpolated_value.rs",
        stable_key: "crates/biome_css_parser/src/syntax/scss/value/interpolated_value.rs::parse",
        symbol_path: "parse_interpolated_value",
        code_role: "declaration",
        declaration_kind: "function",
        exported: false,
        body: "fn parse_interpolated_value() { /* support SCSS interpolation */ }",
        start_line: 1,
        end_line: 20,
      }],
    });

    const result = retrieve(
      db,
      {
        task: "feat(css_parser): support SCSS interpolation in values",
        query_anchors: {},
        budget: "default",
      },
      loadConfig(cwd),
    );

    expect(result.pack.budget.code_lane?.triggered).toBe(true);
    expect(
      result.pack.included.some(
        (entry) =>
          entry.kind === "code" &&
          entry.source_path ===
            "crates/biome_css_parser/src/syntax/scss/value/interpolated_value.rs",
      ),
    ).toBe(true);
  });

  it("runs code retrieval for natural bug-fix wording, not only explicit implementation prompts", () => {
    upsertCodeSource(db, {
      facts: {
        file_path: "src/flask/sansio/app.py",
        exported_symbols: [{ name: "App", kind: "class" }],
        exported_signatures: ["class App"],
        file_purpose: "Flask sans-IO application object.",
        imports: [],
      },
      source_content_hash: "hash:app",
      indexed_at: "2026-05-16T00:00:00Z",
    });
    replaceCodeChunksForSource(db, {
      source_path: "src/flask/sansio/app.py",
      source_content_hash: "hash:app",
      indexed_at: "2026-05-16T00:00:00Z",
      chunks: [{
        source_path: "src/flask/sansio/app.py",
        stable_key: "src/flask/sansio/app.py::orientation",
        symbol_path: null,
        code_role: "orientation",
        declaration_kind: null,
        exported: false,
        body: "Code file: src/flask/sansio/app.py\nBody terms: case insensitive comparison setup finished",
        start_line: 1,
        end_line: 20,
      }],
    });

    const result = retrieve(
      db,
      {
        task: "case-insensitive comparison",
        query_anchors: {},
        budget: "default",
      },
      loadConfig(cwd),
    );

    expect(result.pack.budget.code_lane?.triggered).toBe(true);
    expect(
      result.pack.included.some(
        (entry) =>
          entry.kind === "code" &&
          entry.source_path === "src/flask/sansio/app.py",
      ),
    ).toBe(true);
  });
});
