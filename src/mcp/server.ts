/**
 * MCP server entrypoint for ContextTrail.
 *
 * Wires the four read-only tools to a low-level `Server` so we control how
 * zod schemas → JSONSchema → registration works. Validation runs against the
 * canonical zod schemas in `schemas.ts`; failures surface as `InvalidParams`
 * MCP errors so agents get a structured signal rather than a silent crash.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z, ZodError } from "zod";

import {
  schemas,
  type ToolName,
} from "./schemas.js";
import { stubHandlers } from "./handlers.js";
import {
  TOOL_REGISTRY,
  formatModelVisibleToolText,
  isToolName,
} from "./tool-registry.js";

type Handler<K extends ToolName> = (
  input: z.infer<(typeof schemas)[K]["input"]>,
) => Promise<z.infer<(typeof schemas)[K]["output"]>>;

export type Handlers = {
  [K in ToolName]: Handler<K>;
};

export type CreateServerOptions = {
  handlers?: Handlers;
  name?: string;
  version?: string;
};

export function createServer(opts: CreateServerOptions = {}): Server {
  const handlers = opts.handlers ?? stubHandlers;

  const server = new Server(
    { name: opts.name ?? "contexttrail", version: opts.version ?? "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_REGISTRY.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(schemas[tool.name].input, {
        $refStrategy: "none",
      }) as { type: "object" } & Record<string, unknown>,
      outputSchema: zodToJsonSchema(schemas[tool.name].output, {
        $refStrategy: "none",
      }) as { type: "object" } & Record<string, unknown>,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const rawName = req.params.name;
    if (!isToolName(rawName)) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${rawName}`);
    }
    const name = rawName;
    const tool = schemas[name];
    const parsed = tool.input.safeParse(req.params.arguments ?? {});
    if (!parsed.success) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments for ${name}: ${formatZodError(parsed.error)}`,
        parsed.error.issues,
      );
    }
    const result = await dispatch(handlers, name, parsed.data);
    return {
      content: [{ type: "text", text: formatModelVisibleToolText(name, result) }],
      structuredContent: result,
    };
  });

  return server;
}

async function dispatch<K extends ToolName>(
  handlers: Handlers,
  name: K,
  input: z.infer<(typeof schemas)[K]["input"]>,
): Promise<z.infer<(typeof schemas)[K]["output"]>> {
  const handler = handlers[name] as Handler<K>;
  return handler(input);
}

function formatZodError(err: ZodError): string {
  return err.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}
