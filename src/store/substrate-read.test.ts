/**
 * Substrate-side read parity tests.
 *
 * After migration, reading Doc Chunks and Cards through the substrate must
 * return content equivalent to the flat-side reads. These tests cover the
 * "retrieval reads every path through context_objects + extension tables"
 * acceptance from PRD-0002 § Checkpoint 3b.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../config/init.js";
import { runImport } from "../cli/import.js";
import { runCardImport } from "../cli/card-import.js";
import { openDb, closeDb } from "./db.js";
import { listCurrentChunks } from "./chunks.js";
import { listCards } from "./cards.js";
import {
  listCurrentChunksFromSubstrate,
  listCardsFromSubstrate,
} from "./substrate-read.js";
import { migrateFlatToSubstrate } from "./migrate.js";

function withFixture<T>(fn: (cwd: string) => T): T {
  const cwd = mkdtempSync(join(tmpdir(), "contexttrail-substrate-read-"));
  try {
    init(cwd);
    mkdirSync(join(cwd, "docs/payments"), { recursive: true });
    writeFileSync(
      join(cwd, "docs/payments/refunds.md"),
      "# Refunds\n\nRefunds use idempotency keys.\n",
    );
    runImport(cwd, ["docs/**/*.md"]);
    mkdirSync(join(cwd, ".contexttrail/cards"), { recursive: true });
    writeFileSync(
      join(cwd, ".contexttrail/cards/c001.md"),
      `---\nid: C001\ntype: constraint\ntitle: t\nauthority: accepted\nscope:\n  layer: project\n  project: x\n---\n\nbody\n`,
    );
    runCardImport(cwd);
    const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
    migrateFlatToSubstrate(db, { force: true });
    closeDb(db);
    return fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe("substrate-side reads after migration", () => {
  it("listCurrentChunksFromSubstrate returns the same chunks as the flat path", () => {
    withFixture((cwd) => {
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const flat = listCurrentChunks(db);
      const sub = listCurrentChunksFromSubstrate(db);
      closeDb(db);
      expect(sub.length).toBe(flat.length);
      const flatMap = new Map(flat.map((c) => [c.version_id, c]));
      for (const c of sub) {
        const f = flatMap.get(c.version_id)!;
        expect(c.body).toBe(f.body);
        expect(c.stable_key).toBe(f.stable_key);
        expect(c.scope).toEqual(f.scope);
        expect(c.token_count).toBe(f.token_count);
      }
    });
  });

  it("listCardsFromSubstrate returns the same cards as the flat path", () => {
    withFixture((cwd) => {
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const flat = listCards(db);
      const sub = listCardsFromSubstrate(db);
      closeDb(db);
      expect(sub.length).toBe(flat.length);
      const flatMap = new Map(flat.map((c) => [c.id, c]));
      for (const c of sub) {
        const f = flatMap.get(c.id)!;
        expect(c.title).toBe(f.title);
        expect(c.body).toBe(f.body);
        expect(c.type).toBe(f.type);
        expect(c.authority).toBe(f.authority);
        expect(c.scope).toEqual(f.scope);
        expect(c.symbol_anchors.sort()).toEqual(f.symbol_anchors.sort());
        expect(c.token_count).toBe(f.token_count);
      }
    });
  });
});
