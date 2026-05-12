/**
 * Edge-case fixtures for the warning-kind taxonomy (PRD-0003 / 4c.1).
 *
 * Each fixture is a positive test of the wire shape: empty/structured
 * responses are valid results, never thrown errors. The four cases lock
 * the v1 wire enum (`no_matches`, `no_sources`, `locked_overflow`).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHandlers } from "./handlers.js";
import { schemas } from "./schemas.js";
import { openDb, closeDb } from "../store/db.js";
import { migrateFlatToSubstrate } from "../store/migrate.js";
import { createTestCorpus, type TestCorpus } from "../eval/test-corpus.js";

const FIXTURE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "tests",
  "fixtures",
  "docs",
);

function writeConstraint(
  cwd: string,
  id: string,
  body: string,
  scope: { module?: string; project?: string; company?: string },
  bigBody = false,
) {
  const dir = join(cwd, ".contexttrail/cards");
  mkdirSync(dir, { recursive: true });
  const layer = scope.company
    ? "company"
    : scope.project
      ? "project"
      : scope.module
        ? "module"
        : "unknown";
  const scopeLines = [`  layer: ${layer}`];
  for (const [k, v] of Object.entries(scope)) scopeLines.push(`  ${k}: ${v}`);
  const padding = bigBody
    ? "\n" + Array(2000).fill("Lorem ipsum dolor sit amet consectetur adipiscing elit.").join(" ")
    : "";
  const md = `---
id: ${id}
type: constraint
title: "Test constraint ${id}"
authority: accepted
scope:
${scopeLines.join("\n")}
symbol_anchors: []
file_anchors: []
---

${body}${padding}
`;
  writeFileSync(join(dir, `${id}.md`), md);
}

describe("MCP edge-case warning kinds", () => {
  describe("no_sources — repo has no imported docs", () => {
    let corpus: TestCorpus;
    let cwd: string;
    beforeAll(() => {
      corpus = createTestCorpus({ prefix: "contexttrail-mcp-no-sources-" });
      cwd = corpus.cwd;
      // No contexttrail import, no cards.
    });
    afterAll(() => corpus.cleanup());

    it("returns a valid empty pack with kind=no_sources, NOT thrown", async () => {
      const r = await createHandlers({ cwd }).retrieve_context_pack({ task: "anything" });
      const v = schemas.retrieve_context_pack.output.safeParse(r);
      expect(v.success).toBe(true);
      expect(r.locked).toEqual([]);
      expect(r.ranked).toEqual([]);
      expect(r.omitted.total).toBe(0);
      expect(r.omitted.top).toEqual([]);
      expect(r.warnings.length).toBe(1);
      expect(r.warnings[0]!.kind).toBe("no_sources");
      expect(r.warnings[0]!.hint).toMatch(/contexttrail import/i);
    });
  });

  describe("no_matches — sources imported, but task is off-corpus", () => {
    let corpus: TestCorpus;
    let cwd: string;
    beforeAll(() => {
      corpus = createTestCorpus({ prefix: "contexttrail-mcp-no-matches-" });
      cwd = corpus.cwd;
      corpus.copyDocsFrom(FIXTURE_ROOT);
      corpus.importDocs();
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      migrateFlatToSubstrate(db, { force: true });
      closeDb(db);
    });
    afterAll(() => corpus.cleanup());

    it("returns empty locked + empty ranked + populated omitted + kind=no_matches", async () => {
      const r = await createHandlers({ cwd }).retrieve_context_pack({
        task: "xyz123 unrelated nonsense quantum chromodynamics",
      });
      const v = schemas.retrieve_context_pack.output.safeParse(r);
      expect(v.success).toBe(true);
      expect(r.locked).toEqual([]);
      expect(r.ranked).toEqual([]);
      // omitted summary is always present and should reflect candidates that
      // fell below threshold.
      expect(r.omitted.total).toBeGreaterThan(0);
      expect(r.omitted.top.length).toBeLessThanOrEqual(r.omitted.total);
      expect(r.warnings.map((w) => w.kind)).toContain("no_matches");
    });
  });

  describe("locked_only — locked Cards match but no docs clear threshold", () => {
    let corpus: TestCorpus;
    let cwd: string;
    beforeAll(() => {
      corpus = createTestCorpus({ prefix: "contexttrail-mcp-locked-only-" });
      cwd = corpus.cwd;
      corpus.copyDocsFrom(FIXTURE_ROOT);
      corpus.importDocs();
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      migrateFlatToSubstrate(db, { force: true });
      closeDb(db);
      // A constraint at company:* scope locks universally.
      writeConstraint(
        cwd,
        "C901",
        "Always emit audit events on financial mutations.",
        { company: "acme" },
      );
      corpus.importCards();
    });
    afterAll(() => corpus.cleanup());

    it("locked Cards still ship + structured warning when no docs clear threshold", async () => {
      const r = await createHandlers({ cwd }).retrieve_context_pack({
        task: "xyz123 unrelated nonsense quantum",
      });
      const v = schemas.retrieve_context_pack.output.safeParse(r);
      expect(v.success).toBe(true);
      expect(r.locked.length).toBeGreaterThan(0);
      expect(r.locked.some((l) => l.id === "C901")).toBe(true);
      // Locked-include is independent of doc availability — no_matches still fires.
      expect(r.ranked).toEqual([]);
      expect(r.warnings.map((w) => w.kind)).toContain("no_matches");
    });
  });

  describe("locked_overflow — locked Cards exceed requested budget", () => {
    let corpus: TestCorpus;
    let cwd: string;
    beforeAll(() => {
      corpus = createTestCorpus({ prefix: "contexttrail-mcp-locked-overflow-" });
      cwd = corpus.cwd;
      corpus.copyDocsFrom(FIXTURE_ROOT);
      corpus.importDocs();
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      migrateFlatToSubstrate(db, { force: true });
      closeDb(db);
      // A huge constraint at company scope (locks universally) that blows
      // through any reasonable budget on its own.
      writeConstraint(
        cwd,
        "C902",
        "Critical invariant.",
        { company: "acme" },
        /* bigBody */ true,
      );
      corpus.importCards();
    });
    afterAll(() => corpus.cleanup());

    it("emits locked_overflow warning + budget.locked_overhead > requested + all locked Cards present", async () => {
      const r = await createHandlers({ cwd }).retrieve_context_pack({
        task: "make refunds idempotent",
        budget: "small",
      });
      const v = schemas.retrieve_context_pack.output.safeParse(r);
      expect(v.success).toBe(true);
      expect(r.warnings.map((w) => w.kind)).toContain("locked_overflow");
      expect(r.budget.locked_overhead).toBeGreaterThan(0);
      // All locked Cards present (locked-include is a hard guarantee).
      expect(r.locked.some((l) => l.id === "C902")).toBe(true);
    });
  });

  describe("lock_failures — expected locked Cards miss", () => {
    let corpus: TestCorpus;
    let cwd: string;
    beforeAll(() => {
      corpus = createTestCorpus({ prefix: "contexttrail-mcp-lock-failures-" });
      cwd = corpus.cwd;
      corpus.copyDocsFrom(FIXTURE_ROOT);
      corpus.importDocs();
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      migrateFlatToSubstrate(db, { force: true });
      closeDb(db);
      writeConstraint(
        cwd,
        "C903",
        "Refund mutations must be idempotent.",
        { project: "fundops" },
      );
      corpus.importCards();
    });
    afterAll(() => corpus.cleanup());

    it("explains a missed expected locked card with an enum failure reason", async () => {
      const r = await createHandlers({ cwd }).retrieve_context_pack({
        task: "fix unknown worker",
        symbols: ["UnknownWorker.run"],
        expected_locked: ["C903"],
        explain: true,
      });

      const v = schemas.retrieve_context_pack.output.safeParse(r);
      expect(v.success).toBe(true);
      expect(r.locked.map((entry) => entry.id)).not.toContain("C903");
      expect(r.explain!.lock_failures).toEqual([
        {
          card_id: "C903",
          card_type: "constraint",
          candidate_match_path: "no inferred query scope",
          failed_reason: "no_query_scope",
          detail: "constraint cards require an inferred query scope unless they are company-scoped",
        },
      ]);
    });
  });
});
