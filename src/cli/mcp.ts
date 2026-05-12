/**
 * `contexttrail mcp` — start the MCP server over stdio.
 *
 * Thin orchestration: createServer() does the heavy lifting; this file just
 * wires the stdio transport and keeps the process alive while the agent
 * holds the connection open.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../mcp/server.js";
import { createHandlers } from "../mcp/handlers.js";
import { loadConfig } from "../config/load.js";
import { openDb, closeDb } from "../store/db.js";
import { defaultRetrievalDbPath } from "../retrieve/runtime.js";

export async function runMcp(cwd: string = process.cwd()): Promise<void> {
  const config = loadConfig(cwd);
  const db = openDb(defaultRetrievalDbPath(cwd));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    closeDb(db);
  };

  process.once("exit", close);
  process.once("SIGINT", close);
  process.once("SIGTERM", close);

  const server = createServer({ handlers: createHandlers({ cwd, db, config }) });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
