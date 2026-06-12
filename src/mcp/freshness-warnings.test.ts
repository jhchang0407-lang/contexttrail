/**
 * PRD-0035 / slice 35.2 — MCP-level integration:
 * `retrieve_context_pack` must surface `stale_source` / `missing_source`
 * warnings into `pack.warnings[]` before assembling the pack.
 */
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHandlers } from "./handlers.js";
import { schemas } from "./schemas.js";
import { createTestCorpus, type TestCorpus } from "../eval/test-corpus.js";
import { openDb, closeDb } from "../store/db.js";
import { listChunkVersionIdsForSource } from "../store/sources.js";
import { FRESHNESS_EARLY_EXIT_THRESHOLD } from "../retrieve/freshness-check.js";

let corpus: TestCorpus | null = null;

afterEach(() => {
  corpus?.cleanup();
  corpus = null;
  delete process.env.CONTEXTTRAIL_RETRIEVAL_AUTO_REINDEX;
});

describe("retrieve_context_pack — freshness warnings (PRD-0035 / 35.2)", () => {
  it("no freshness warnings when the corpus is fresh", async () => {
    corpus = createTestCorpus({ prefix: "contexttrail-fresh-mcp-" });
    corpus.writeDoc("docs/a.md", "# A\n\nbody.\n");
    corpus.importDocs();

    const pack = await createHandlers({ cwd: corpus.cwd }).retrieve_context_pack({
      task: "anything",
    });

    const kinds = pack.warnings.map((w) => w.kind);
    expect(kinds).not.toContain("stale_source");
    expect(kinds).not.toContain("missing_source");
  });

  it("emits stale_source warning when a doc has been edited without re-import", async () => {
    corpus = createTestCorpus({ prefix: "contexttrail-fresh-mcp-" });
    corpus.writeDoc("docs/a.md", "# A\n\noriginal body.\n");
    corpus.importDocs();

    writeFileSync(join(corpus.cwd, "docs/a.md"), "# A\n\nedited body now longer than before.\n");

    const pack = await createHandlers({ cwd: corpus.cwd }).retrieve_context_pack({
      task: "anything",
    });

    const stale = pack.warnings.find((w) => w.kind === "stale_source");
    expect(stale).toBeDefined();
    expect(stale!.hint).toMatch(/contexttrail import/);
    // The pack is still schema-valid with the new warning kind in place.
    expect(schemas.retrieve_context_pack.output.safeParse(pack).success).toBe(true);
  });

  it("emits missing_source warning when an indexed doc has been deleted", async () => {
    corpus = createTestCorpus({ prefix: "contexttrail-fresh-mcp-" });
    corpus.writeDoc("docs/gone.md", "# Gone\n\nbody.\n");
    corpus.importDocs();
    rmSync(join(corpus.cwd, "docs/gone.md"));

    const pack = await createHandlers({ cwd: corpus.cwd }).retrieve_context_pack({
      task: "anything",
    });

    const missing = pack.warnings.find((w) => w.kind === "missing_source");
    expect(missing).toBeDefined();
    expect(missing!.hint).toMatch(/contexttrail index/);
  });

  it("CONTEXTTRAIL_RETRIEVAL_AUTO_REINDEX=true reindexes stale sources inline (no stale_source warning)", async () => {
    corpus = createTestCorpus({ prefix: "contexttrail-fresh-mcp-" });
    corpus.writeDoc("docs/a.md", "# A\n\noriginal body.\n");
    corpus.importDocs();

    writeFileSync(join(corpus.cwd, "docs/a.md"), "# A\n\nedited body now longer than before.\n");

    process.env.CONTEXTTRAIL_RETRIEVAL_AUTO_REINDEX = "true";
    const pack = await createHandlers({ cwd: corpus.cwd }).retrieve_context_pack({
      task: "anything",
    });

    const kinds = pack.warnings.map((w) => w.kind);
    expect(kinds).not.toContain("stale_source");
    expect(kinds).not.toContain("missing_source");
  });

  it("CONTEXTTRAIL_RETRIEVAL_AUTO_REINDEX=true repairs the full missing-source set above the warning threshold", async () => {
    corpus = createTestCorpus({ prefix: "contexttrail-fresh-mcp-" });
    const N = FRESHNESS_EARLY_EXIT_THRESHOLD + 5;
    for (let i = 0; i < N; i++) {
      corpus.writeDoc(`docs/${String(i).padStart(4, "0")}.md`, `# ${i}\n\nbody.\n`);
    }
    corpus.importDocs();
    rmSync(join(corpus.cwd, "docs/0000.md"));
    rmSync(join(corpus.cwd, "docs/0001.md"));

    process.env.CONTEXTTRAIL_RETRIEVAL_AUTO_REINDEX = "true";
    await createHandlers({ cwd: corpus.cwd }).retrieve_context_pack({
      task: "body",
    });

    const db = openDb(join(corpus.cwd, ".contexttrail/cache/contexttrail.db"));
    try {
      expect(listChunkVersionIdsForSource(db, "docs/0000.md", "current")).toEqual([]);
      expect(listChunkVersionIdsForSource(db, "docs/0001.md", "current")).toEqual([]);
    } finally {
      closeDb(db);
    }
  });
});
