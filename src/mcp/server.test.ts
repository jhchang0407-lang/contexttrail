import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { createServer, type Handlers } from "./server.js";
import { stubHandlers } from "./handlers.js";
import { schemas } from "./schemas.js";

async function setupClient(handlers: Handlers = stubHandlers) {
  const server = createServer({ handlers });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe("MCP server", () => {
  let ctx: Awaited<ReturnType<typeof setupClient>>;

  beforeEach(async () => {
    ctx = await setupClient();
  });

  afterEach(async () => {
    await ctx.client.close();
    await ctx.server.close();
  });

  it("tools/list returns the registered tools", async () => {
    const r = await ctx.client.listTools();
    const names = r.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "answer_setup_question",
        "get_card",
        "get_code_chunk",
        "get_doc_chunk",
        "get_setup_readiness",
        "list_context_sources",
        "propose_setup_questions",
        "retrieve_context_pack",
        "sync_ledger",
      ],
    );
  });

  it("every tool has a valid JSONSchema input + output schema", async () => {
    const r = await ctx.client.listTools();
    for (const t of r.tools) {
      expect(t.inputSchema).toBeTypeOf("object");
      expect(t.inputSchema.type).toBe("object");
      expect(t.outputSchema).toBeTypeOf("object");
      expect((t.outputSchema as { type?: string }).type).toBe("object");
    }
  });

  it("tool descriptions tell agents to run setup questions before coding", async () => {
    const r = await ctx.client.listTools();
    const byName = new Map(r.tools.map((tool) => [tool.name, tool]));

    expect(byName.get("retrieve_context_pack")?.description).toMatch(
      /before coding/i,
    );
    expect(byName.get("retrieve_context_pack")?.description).toMatch(
      /propose_setup_questions/i,
    );
    expect(byName.get("propose_setup_questions")?.description).toMatch(
      /multiple-choice/i,
    );
    expect(byName.get("propose_setup_questions")?.description).toMatch(
      /curation stream/i,
    );
    expect(byName.get("answer_setup_question")?.description).toMatch(
      /does not accept Cards/i,
    );
    expect(byName.get("answer_setup_question")?.description).toMatch(
      /triage\/curation/i,
    );
    expect(byName.get("sync_ledger")?.description).toMatch(/Defaults to check mode/i);
  });

  it("retrieve_context_pack stub returns a well-formed empty pack", async () => {
    const r = await ctx.client.callTool({
      name: "retrieve_context_pack",
      arguments: { task: "anything" },
    });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toBeDefined();
    const v = schemas.retrieve_context_pack.output.safeParse(r.structuredContent);
    expect(v.success).toBe(true);
  });

  it("retrieve_context_pack exposes compact model-visible refs while preserving full structuredContent", async () => {
    await ctx.client.close();
    await ctx.server.close();

    const hugeBody = "body ".repeat(5000);
    ctx = await setupClient({
      ...stubHandlers,
      async retrieve_context_pack() {
        return {
          query_mode: "unanchored",
          coverage_confidence: "confident",
          assembly_stage_reached: "primary_only",
          locked: [],
          ranked: Array.from({ length: 12 }, (_, i) => ({
            id: `chunk_${i}`,
            kind: "chunk" as const,
            scope: {},
            tokens: 250,
            score: 1 - i / 100,
            body: hugeBody,
            contexttrail: `Source: docs/en/very-long-guide-${i}.md > Section: ${"Detailed setup ".repeat(20)} > Part: 1/1`,
            type_bias_applied: false,
          })),
          omitted: { total: 200, by_reason: { budget: 200 }, top: [], truncated: true },
          warnings: [],
          budget: { requested: 4000, used: 3000, locked_overhead: 0 },
        };
      },
    });

    const r = await ctx.client.callTool({
      name: "retrieve_context_pack",
      arguments: { task: "find docs before editing tests" },
    });

    const textItem = r.content[0];
    expect(textItem.type).toBe("text");
    const text = textItem.type === "text" ? textItem.text : "";
    expect(Buffer.byteLength(text, "utf8")).toBeLessThan(2500);
    expect(text).toContain("Ranked refs:");
    expect(text).toContain("get_doc_chunk");
    expect(text).not.toContain(hugeBody);
    expect(JSON.stringify(r.structuredContent)).toContain(hugeBody);
  });

  it("get_doc_chunk stub returns a schema-valid response", async () => {
    const r = await ctx.client.callTool({
      name: "get_doc_chunk",
      arguments: { version_id: "v_x" },
    });
    expect(r.isError).toBeFalsy();
    const v = schemas.get_doc_chunk.output.safeParse(r.structuredContent);
    expect(v.success).toBe(true);
  });

  it("get_card stub returns a schema-valid response", async () => {
    const r = await ctx.client.callTool({
      name: "get_card",
      arguments: { id: "card_x" },
    });
    expect(r.isError).toBeFalsy();
    const v = schemas.get_card.output.safeParse(r.structuredContent);
    expect(v.success).toBe(true);
  });

  it("list_context_sources stub returns an empty source list", async () => {
    const r = await ctx.client.callTool({
      name: "list_context_sources",
      arguments: {},
    });
    expect(r.isError).toBeFalsy();
    const v = schemas.list_context_sources.output.safeParse(r.structuredContent);
    expect(v.success).toBe(true);
  });

  it("propose_setup_questions stub returns a schema-valid response", async () => {
    const r = await ctx.client.callTool({
      name: "propose_setup_questions",
      arguments: {},
    });
    expect(r.isError).toBeFalsy();
    const v = schemas.propose_setup_questions.output.safeParse(r.structuredContent);
    expect(v.success).toBe(true);
  });

  it("answer_setup_question stub returns a schema-valid response", async () => {
    const r = await ctx.client.callTool({
      name: "answer_setup_question",
      arguments: { question_id: "stub", choice_id: "docs_glob" },
    });
    expect(r.isError).toBeFalsy();
    const v = schemas.answer_setup_question.output.safeParse(r.structuredContent);
    expect(v.success).toBe(true);
  });

  it("sync_ledger stub returns a schema-valid response", async () => {
    const r = await ctx.client.callTool({
      name: "sync_ledger",
      arguments: {},
    });
    expect(r.isError).toBeFalsy();
    const v = schemas.sync_ledger.output.safeParse(r.structuredContent);
    expect(v.success).toBe(true);
  });

  it("malformed input returns a structured MCP error (InvalidParams)", async () => {
    let caught: unknown;
    try {
      await ctx.client.callTool({
        name: "retrieve_context_pack",
        arguments: { not_task: 42 },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(McpError);
    expect((caught as McpError).code).toBe(ErrorCode.InvalidParams);
  });

  it("missing required field on get_card returns InvalidParams", async () => {
    let caught: unknown;
    try {
      await ctx.client.callTool({ name: "get_card", arguments: {} });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(McpError);
    expect((caught as McpError).code).toBe(ErrorCode.InvalidParams);
  });

  it("unknown tool name returns a structured error", async () => {
    let caught: unknown;
    try {
      await ctx.client.callTool({ name: "does_not_exist", arguments: {} });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(McpError);
  });
});
