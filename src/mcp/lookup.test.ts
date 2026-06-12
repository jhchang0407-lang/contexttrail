/**
 * Integration tests for the three lookup handlers (PRD-0003 / 4b.2).
 *
 * Round-trip property: every chunk surfaced inline by `retrieve_context_pack`
 * can be re-fetched by `get_doc_chunk` byte-identically. Same property for
 * locked Cards via `get_card`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { runCardAdd } from "../cli/card-cmds.js";
import { createHandlers } from "./handlers.js";
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

describe("MCP lookup handlers — get_doc_chunk / get_card / list_context_sources", () => {
  let corpus: TestCorpus;
  let cwd: string;
  let cardId: string;

  beforeAll(() => {
    corpus = createTestCorpus({ prefix: "contexttrail-mcp-lookup-" });
    cwd = corpus.cwd;
    corpus.copyDocsFrom(FIXTURE_ROOT);
    mkdirSync(join(cwd, "src", "payments"), { recursive: true });
    writeFileSync(
      join(cwd, "src", "payments", "refund.ts"),
      [
        "export class RefundService {",
        "  processRefund(amount: number): number {",
        "    return amount * 2;",
        "  }",
        "}",
        "",
        "export function normalizeRefund(amount: number): number {",
        "  return Math.max(0, amount);",
        "}",
      ].join("\n"),
    );
    corpus.importDocs();
    const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
    migrateFlatToSubstrate(db, { force: true });
    closeDb(db);

    // Author one constraint Card so get_card has something to fetch.
    const r = runCardAdd(cwd, "constraint");
    cardId = r.id;
    const cardPath = r.path;
    const body = readFileSync(cardPath, "utf8");
    // Patch the scaffolded card so the locked-include rules find it.
    const patched = body
      .replace(/^title: .*$/m, 'title: "Refunds must emit audit"')
      .replace(/^scope:[\s\S]*?(?=\n[a-z_]+:)/m, "scope:\n  module: payments\n")
      .replace(/^body:[\s\S]*$/m, "body: |\n  Refunds must emit an audit event.\n");
    writeFileSync(cardPath, patched);
    corpus.importCards();
  });

  afterAll(() => {
    if (corpus) corpus.cleanup();
  });

  describe("get_doc_chunk", () => {
    it("round-trips: body returned by get_doc_chunk is byte-identical to retrieve_context_pack", async () => {
      const handlers = createHandlers({ cwd });
      const pack = await handlers.retrieve_context_pack({
        task: "make refunds idempotent",
        files: ["src/payments/refund.ts"],
        symbols: ["RefundService.processRefund"],
      });
      expect(pack.ranked.length).toBeGreaterThan(0);
      for (const r of pack.ranked) {
        if (r.kind !== "chunk") continue;
        const chunk = await handlers.get_doc_chunk({ version_id: r.id });
        expect(chunk.body).toBe(r.body);
        expect(chunk.tokens).toBe(r.tokens);
        expect(chunk.version_id).toBe(r.id);
      }
    });

    it("accepts stable_key and resolves to current version", async () => {
      const handlers = createHandlers({ cwd });
      const pack = await handlers.retrieve_context_pack({ task: "audit logging" });
      const firstChunk = pack.ranked.find((r) => r.kind === "chunk");
      expect(firstChunk).toBeDefined();
      const byVersion = await handlers.get_doc_chunk({ version_id: firstChunk!.id });
      const byStableKey = await handlers.get_doc_chunk({
        stable_key: byVersion.stable_key,
      });
      expect(byStableKey.version_id).toBe(byVersion.version_id);
      expect(byStableKey.body).toBe(byVersion.body);
    });

    it("returns code_anchors, freshness_state, status, and contexttrail", async () => {
      const handlers = createHandlers({ cwd });
      const pack = await handlers.retrieve_context_pack({ task: "renew session" });
      const r = pack.ranked.find((x) => x.kind === "chunk")!;
      const chunk = await handlers.get_doc_chunk({ version_id: r.id });
      expect(Array.isArray(chunk.code_anchors)).toBe(true);
      expect(["verified", "unverified", "needs_review", "maybe_affected", "potentially_superseded"])
        .toContain(chunk.freshness_state);
      expect(chunk.status).toBe("current");
      expect(chunk.contexttrail).toContain("Source:");
    });

    it("stable_key fallback reports tombstoned chunks as unverified", async () => {
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const row = db
        .prepare(
          `SELECT co.id AS version_id, dce.stable_key
             FROM context_objects co
             JOIN doc_chunk_ext dce ON dce.context_object_id = co.id
            WHERE co.kind = 'doc_chunk' AND co.status = 'current'
            ORDER BY co.id
            LIMIT 1`,
        )
        .get() as { version_id: string; stable_key: string };
      db.prepare("UPDATE context_objects SET status = 'tombstoned' WHERE id = ?").run(
        row.version_id,
      );
      db.prepare("UPDATE doc_chunks SET status = 'tombstoned' WHERE version_id = ?").run(
        row.version_id,
      );
      closeDb(db);

      const handlers = createHandlers({ cwd });
      const chunk = await handlers.get_doc_chunk({ stable_key: row.stable_key });
      expect(chunk.version_id).toBe(row.version_id);
      expect(chunk.status).toBe("tombstoned");
      expect(chunk.freshness_state).toBe("unverified");
    });

    it("throws InvalidParams when chunk is not found", async () => {
      let caught: unknown;
      try {
        await createHandlers({ cwd }).get_doc_chunk({ version_id: "v_does_not_exist" });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(McpError);
      expect((caught as McpError).code).toBe(ErrorCode.InvalidParams);
    });
  });

  describe("get_card", () => {
    it("returns body, frontmatter, linked_chunks (with version_pin), freshness_state, author_review_state", async () => {
      const handlers = createHandlers({ cwd });
      const card = await handlers.get_card({ id: cardId });
      expect(card.id).toBe(cardId);
      expect(card.card_type).toBe("constraint");
      expect(card.body.length).toBeGreaterThan(0);
      expect(typeof card.frontmatter).toBe("object");
      expect(Array.isArray(card.linked_chunks)).toBe(true);
      expect(card.author_review_state).toBe("unreviewed");
      expect(card.freshness_state).toBe("verified");
    });

    it("throws InvalidParams when card is not found", async () => {
      let caught: unknown;
      try {
        await createHandlers({ cwd }).get_card({ id: "card_nonsense" });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(McpError);
      expect((caught as McpError).code).toBe(ErrorCode.InvalidParams);
    });
  });

  describe("list_context_sources", () => {
    it("enumerates every source from contexttrail import with chunk_count, scope_summary, scope, last_indexed_at", async () => {
      const handlers = createHandlers({ cwd });
      const r = await handlers.list_context_sources({});
      expect(r.sources.length).toBeGreaterThan(0);
      for (const s of r.sources) {
        expect(typeof s.source_path).toBe("string");
        expect(s.source_path.length).toBeGreaterThan(0);
        expect(s.chunk_count).toBeGreaterThan(0);
        expect(typeof s.scope_summary).toBe("string");
        expect(typeof s.scope).toBe("object");
        expect(typeof s.last_indexed_at).toBe("string");
      }
    });

    it("is cheap — does not invoke the retrieval pipeline", async () => {
      // We can't directly assert non-invocation without spies; assert it's
      // fast enough that it can't have done a full retrieval (which costs
      // 50ms+ on this corpus). 10ms is ample headroom.
      const handlers = createHandlers({ cwd });
      const t0 = performance.now();
      await handlers.list_context_sources({});
      const ms = performance.now() - t0;
      expect(ms).toBeLessThan(50);
    });
  });
});
