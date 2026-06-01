import { describe, expect, it } from "vitest";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestCorpus } from "../eval/test-corpus.js";
import { saveTaskProfile } from "../config/task-profiles.js";
import { createHandlers } from "./handlers.js";

describe("MCP agent rule editing", () => {
  it("creates, lists, and updates accepted agent rules through MCP handlers", async () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-mcp-agent-rules-" });
    try {
      const handlers = createHandlers({ cwd: corpus.cwd });

      const created = await handlers.save_agent_rule({
        title: "Missing context requires search",
        body: "Missing-context claims require adequate search before reporting absence.",
        scope: { layer: "project", project: "ClaimsOps" },
        update_reason: "User wants agents to avoid false absence claims.",
      });

      expect(created.action).toBe("created");
      expect(created.rule.id).toMatch(/^C\d{3,}$/);
      expect(created.rule.scope_summary).toBe("project:ClaimsOps");
      expect(created.writes).toHaveLength(1);

      const listed = await handlers.list_agent_rules({});
      expect(listed.rules.map((rule) => rule.id)).toEqual([created.rule.id]);

      const updated = await handlers.save_agent_rule({
        id: created.rule.id,
        body: "Missing-context claims require adequate search across expected source types before reporting absence.",
        update_reason: "Clarify what adequate search means.",
      });

      expect(updated.action).toBe("updated");
      expect(updated.rule.body).toContain("expected source types");
      expect(updated.rule.author_review_state).toBe("unreviewed");

      const card = await handlers.get_card({ id: created.rule.id });
      expect(card.body).toContain("expected source types");
      expect(card.author_review_state).toBe("unreviewed");

      const raw = readFileSync(join(corpus.cwd, updated.rule.source_path), "utf8");
      expect(raw).toContain("mcp_edit_history:");
      expect(raw).toContain("Clarify what adequate search means.");
    } finally {
      corpus.cleanup();
    }
  });

  it("lists only active-profile agent rules when a task profile is active", async () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-mcp-agent-rules-profile-" });
    try {
      const handlers = createHandlers({ cwd: corpus.cwd });
      const first = await handlers.save_agent_rule({
        title: "Claims rule",
        body: "Claims tasks must cite policy evidence.",
      });
      const second = await handlers.save_agent_rule({
        title: "Sales rule",
        body: "Sales tasks must include open commitments.",
      });

      saveTaskProfile(corpus.cwd, {
        name: "Claims Review",
        rule_ids: [first.rule.id],
      });

      const listed = await handlers.list_agent_rules({});
      expect(listed.rules.map((rule) => rule.id)).toEqual([first.rule.id]);
      expect(listed.rules.map((rule) => rule.id)).not.toContain(second.rule.id);
    } finally {
      corpus.cleanup();
    }
  });

  it("rejects attempts to edit non-rule cards with save_agent_rule", async () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-mcp-agent-rules-reject-" });
    try {
      corpus.writeCard({
        id: "E001",
        type: "evidence",
        title: "Evidence card",
        scope: { layer: "project", project: "ClaimsOps" },
        command: "npm test",
        body: "This is evidence, not an agent rule.",
      });
      corpus.importCards();

      await expect(
        createHandlers({ cwd: corpus.cwd }).save_agent_rule({
          id: "E001",
          body: "Do not rewrite evidence as a rule.",
        }),
      ).rejects.toThrow(McpError);
    } finally {
      corpus.cleanup();
    }
  });
});
