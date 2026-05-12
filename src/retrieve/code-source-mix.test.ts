/**
 * PRD-0028 / slice 28.3 — code-source mixer tests.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "../store/db.js";
import { closeDb, openDb } from "../store/db.js";
import { upsertCodeSource } from "../store/code-sources.js";
import { buildCodeRankedEntries } from "./code-source-mix.js";

let tmp: string;
let db: Db;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "contexttrail-csmix-"));
  db = openDb(join(tmp, "contexttrail.db"));
  upsertCodeSource(db, {
    facts: {
      file_path: "src/retrieve/source-rerank.ts",
      exported_symbols: [
        { name: "scoreSourceRerank", kind: "function" },
        { name: "tokenizeForRerank", kind: "function" },
      ],
      exported_signatures: [
        "export function scoreSourceRerank(args: Args): Score",
      ],
      file_purpose: "Source-level reranker for retrieval candidates.",
      imports: [],
    },
    source_content_hash: "h",
    indexed_at: "2026-05-11T00:00:00Z",
  });
  upsertCodeSource(db, {
    facts: {
      file_path: "src/store/cards.ts",
      exported_symbols: [{ name: "upsertCard", kind: "function" }],
      exported_signatures: ["export function upsertCard(db: Db, c: Card): void"],
      file_purpose: "Card persistence layer.",
      imports: [],
    },
    source_content_hash: "h",
    indexed_at: "2026-05-11T00:00:00Z",
  });
});

afterEach(() => {
  closeDb(db);
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.RETRIEVAL_CODE_SOURCE_INDEX;
});

describe("buildCodeRankedEntries", () => {
  it("returns nothing when the flag is off", () => {
    const out = buildCodeRankedEntries({
      db,
      query: "source rerank",
      enabled: false,
    });
    expect(out).toEqual([]);
  });

  it("returns code entries with kind='code' and a code-shaped contexttrail", () => {
    const out = buildCodeRankedEntries({
      db,
      query: "scoreSourceRerank",
      enabled: true,
    });
    expect(out.length).toBeGreaterThan(0);
    const top = out[0]!;
    expect(top.kind).toBe("code");
    expect(top.contexttrail).toContain("src/retrieve/source-rerank.ts");
    expect(top.body).toContain("src/retrieve/source-rerank.ts");
    expect(top.body).toContain("scoreSourceRerank");
  });

  it("body includes the file path so the agent-completion probe regex matches", () => {
    const out = buildCodeRankedEntries({
      db,
      query: "card persistence",
      enabled: true,
    });
    expect(out.some((e) => e.body.includes("src/store/cards.ts"))).toBe(true);
  });

  it("ranks the topically-matching code source above unrelated ones", () => {
    const out = buildCodeRankedEntries({
      db,
      query: "reranker for retrieval",
      enabled: true,
    });
    expect(out[0]?.contexttrail).toContain("source-rerank.ts");
  });

  it("returns nothing on an empty or operator-only query (no FTS crash)", () => {
    expect(buildCodeRankedEntries({ db, query: "", enabled: true })).toEqual([]);
    expect(buildCodeRankedEntries({ db, query: "   :", enabled: true })).toEqual([]);
  });

  it("scores fall in [floor, 1]", () => {
    const out = buildCodeRankedEntries({
      db,
      query: "source rerank cards",
      enabled: true,
    });
    for (const e of out) {
      expect(e.score).toBeGreaterThanOrEqual(0);
      expect(e.score).toBeLessThanOrEqual(1);
    }
  });
});
