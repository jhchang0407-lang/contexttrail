import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestCorpus } from "../eval/test-corpus.js";
import { closeDb, openDb } from "../store/db.js";
import { migrateFlatToSubstrate } from "../store/migrate.js";
import { createHandlers } from "./handlers.js";
import { schemas } from "./schemas.js";

describe("MCP workspace routing", () => {
  it("preserves explicit cwd in tool input schemas", () => {
    const parsed = schemas.list_context_sources.input.parse({
      cwd: "/tmp/contexttrail-target",
    }) as { cwd?: string };

    expect(parsed.cwd).toBe("/tmp/contexttrail-target");
  });

  it("routes tool calls to the requested workspace cwd", async () => {
    const defaultWorkspace = createTestCorpus({
      prefix: "contexttrail-mcp-default-workspace-",
    });
    const targetWorkspace = createTestCorpus({
      prefix: "contexttrail-mcp-target-workspace-",
    });
    try {
      defaultWorkspace.writeDoc(
        "docs/alpha.md",
        "# Alpha Notes\n\nAlpha-only context about billing ledgers.",
      );
      targetWorkspace.writeDoc(
        "docs/beta.md",
        "# Beta Notes\n\nBeta-only context about refund checksum routing.",
      );
      defaultWorkspace.importDocs();
      targetWorkspace.importDocs();
      migrate(defaultWorkspace.cwd);
      migrate(targetWorkspace.cwd);

      const handlers = createHandlers({ cwd: defaultWorkspace.cwd });

      const defaultSources = await handlers.list_context_sources({});
      expect(defaultSources.sources.map((s) => s.source_path)).toContain(
        "docs/alpha.md",
      );
      expect(defaultSources.sources.map((s) => s.source_path)).not.toContain(
        "docs/beta.md",
      );

      const routedSources = await handlers.list_context_sources({
        cwd: targetWorkspace.cwd,
      });
      expect(routedSources.sources.map((s) => s.source_path)).toContain(
        "docs/beta.md",
      );
      expect(routedSources.sources.map((s) => s.source_path)).not.toContain(
        "docs/alpha.md",
      );

      const readiness = await handlers.get_setup_readiness({
        cwd: targetWorkspace.cwd,
      });
      expect(readiness.cwd).toBe(targetWorkspace.cwd);
    } finally {
      defaultWorkspace.cleanup();
      targetWorkspace.cleanup();
    }
  });
});

function migrate(cwd: string): void {
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  try {
    migrateFlatToSubstrate(db, { force: true });
  } finally {
    closeDb(db);
  }
}
