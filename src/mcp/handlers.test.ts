import { describe, it, expect } from "vitest";
import { stubHandlers } from "./handlers.js";
import { schemas } from "./schemas.js";

describe("stub handlers", () => {
  it("retrieve_context_pack stub returns a schema-valid empty pack", async () => {
    const out = await stubHandlers.retrieve_context_pack({ task: "anything" });
    const r = schemas.retrieve_context_pack.output.safeParse(out);
    expect(r.success).toBe(true);
    expect(out.assembly_stage_reached).toBe("not_applicable");
    expect(out.locked).toEqual([]);
    expect(out.ranked).toEqual([]);
    expect(out.omitted).toEqual({ total: 0, by_reason: {}, top: [], truncated: false });
    expect(out.warnings).toEqual([]);
  });

  it("retrieve_context_pack stub keeps `omitted` summary present even when empty", async () => {
    const out = await stubHandlers.retrieve_context_pack({ task: "x" });
    expect(out.omitted.total).toBe(0);
    expect(Array.isArray(out.omitted.top)).toBe(true);
  });

  it("get_doc_chunk stub returns a schema-valid placeholder", async () => {
    const out = await stubHandlers.get_doc_chunk({ version_id: "v_x" });
    const r = schemas.get_doc_chunk.output.safeParse(out);
    expect(r.success).toBe(true);
  });

  it("get_card stub returns a schema-valid placeholder", async () => {
    const out = await stubHandlers.get_card({ id: "card_x" });
    const r = schemas.get_card.output.safeParse(out);
    expect(r.success).toBe(true);
  });

  it("agent rule stubs return schema-valid placeholders", async () => {
    const listed = await stubHandlers.list_agent_rules({});
    const listResult = schemas.list_agent_rules.output.safeParse(listed);
    expect(listResult.success).toBe(true);

    const saved = await stubHandlers.save_agent_rule({
      body: "Missing context requires adequate search.",
    });
    const saveResult = schemas.save_agent_rule.output.safeParse(saved);
    expect(saveResult.success).toBe(true);
  });

  it("list_context_sources stub returns an empty source list", async () => {
    const out = await stubHandlers.list_context_sources({});
    const r = schemas.list_context_sources.output.safeParse(out);
    expect(r.success).toBe(true);
    expect(out.sources).toEqual([]);
  });

  it("sync_ledger stub returns a schema-valid dry response", async () => {
    const out = await stubHandlers.sync_ledger({});
    const r = schemas.sync_ledger.output.safeParse(out);
    expect(r.success).toBe(true);
    expect(out.mode).toBe("check");
    expect(out.writes).toEqual([]);
  });
});
