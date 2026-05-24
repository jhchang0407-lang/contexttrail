import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "../../../../store/db.js";
import { closeDb, openDb } from "../../../../store/db.js";
import {
  getCodeChunkByVersionId,
  listCodeChunksForSource,
  replaceCodeChunksForSource,
} from "./code-chunks.js";
import type { ExtractedCodeChunk } from "../types/code-source.js";

const NOW = "2026-05-13T00:00:00Z";

function makeChunk(
  overrides: Partial<ExtractedCodeChunk> = {},
): ExtractedCodeChunk {
  return {
    source_path: "src/retrieve/foo.ts",
    stable_key: "src/retrieve/foo.ts::buildPlan",
    symbol_path: "buildPlan",
    code_role: "declaration",
    declaration_kind: "function",
    exported: true,
    body: "export function buildPlan(): string { return 'ok'; }",
    start_line: 3,
    end_line: 5,
    ...overrides,
  };
}

let tmp: string;
let db: Db;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "contexttrail-code-chunks-"));
  db = openDb(join(tmp, "contexttrail.db"));
});

afterEach(() => {
  closeDb(db);
  rmSync(tmp, { recursive: true, force: true });
});

describe("code_chunks storage", () => {
  it("atomically replaces one file's current chunk set", () => {
    replaceCodeChunksForSource(db, {
      source_path: "src/retrieve/foo.ts",
      source_content_hash: "hash-v1",
      indexed_at: NOW,
      chunks: [
        makeChunk({
          stable_key: "src/retrieve/foo.ts::orientation",
          symbol_path: null,
          code_role: "orientation",
          declaration_kind: null,
          exported: false,
          body: 'import { helper } from "./helper.js";',
          start_line: 1,
          end_line: 1,
        }),
        makeChunk(),
      ],
    });

    const first = listCodeChunksForSource(db, "src/retrieve/foo.ts");
    expect(first).toHaveLength(2);
    const oldVersionIds = first.map((chunk) => chunk.version_id);

    replaceCodeChunksForSource(db, {
      source_path: "src/retrieve/foo.ts",
      source_content_hash: "hash-v2",
      indexed_at: NOW,
      chunks: [
        makeChunk({
          body: "export function buildPlan(): string { return 'new'; }",
        }),
      ],
    });

    const second = listCodeChunksForSource(db, "src/retrieve/foo.ts");
    expect(second).toHaveLength(1);
    expect(second[0]?.source_content_hash).toBe("hash-v2");
    expect(second[0]?.body).toContain("return 'new';");
    for (const versionId of oldVersionIds) {
      expect(getCodeChunkByVersionId(db, versionId)).toBeNull();
    }
  });

  it("persists duplicate symbol/body chunks from real OSS files without version-id collisions", () => {
    replaceCodeChunksForSource(db, {
      source_path: "packages/framework/src/routes.ts",
      source_content_hash: "hash-v1",
      indexed_at: NOW,
      chunks: [
        makeChunk({
          source_path: "packages/framework/src/routes.ts",
          stable_key: "packages/framework/src/routes.ts::default",
          symbol_path: "default",
          body: "export default function route() { return null; }",
          start_line: 10,
          end_line: 12,
        }),
        makeChunk({
          source_path: "packages/framework/src/routes.ts",
          stable_key: "packages/framework/src/routes.ts::default",
          symbol_path: "default",
          body: "export default function route() { return null; }",
          start_line: 42,
          end_line: 44,
        }),
      ],
    });

    const chunks = listCodeChunksForSource(db, "packages/framework/src/routes.ts");

    expect(chunks).toHaveLength(2);
    expect(new Set(chunks.map((chunk) => chunk.version_id)).size).toBe(2);
  });
});
