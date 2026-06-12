import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG_YAML } from "./defaults.js";
import { CONFIG_REL_PATH } from "./load.js";
import { openDb, closeDb } from "../store/db.js";

export const MCP_CONFIG_REL_PATH = ".mcp.json";

/**
 * `contexttrail init` writes a per-repo `.mcp.json` so a cold-start user has
 * a wire-up file for their agent. Write-only-if-absent — the user may
 * already have `.mcp.json` for other MCP servers; we never clobber. Uses the
 * globally-linked `contexttrail` command on PATH.
 */
export const DEFAULT_MCP_JSON = `${JSON.stringify(
  {
    mcpServers: {
      contexttrail: {
        command: "contexttrail",
        args: ["mcp"],
      },
    },
  },
  null,
  2,
)}\n`;

export type InitResult = {
  /** True if config.yaml was newly written this run. */
  created: boolean;
  config_path: string;
  cache_path: string;
  mcp_config_path: string;
  /** True if .mcp.json was newly written this run (false if it already existed). */
  mcp_config_created: boolean;
};

export function init(cwd: string): InitResult {
  const contextTrailDir = join(cwd, ".contexttrail");
  const cacheDir = join(contextTrailDir, "cache");
  const cardsDir = join(contextTrailDir, "cards");
  const inboxDir = join(contextTrailDir, "inbox");
  const cfgPath = join(cwd, CONFIG_REL_PATH);
  const cachePath = join(cacheDir, "contexttrail.db");
  const mcpPath = join(cwd, MCP_CONFIG_REL_PATH);

  mkdirSync(contextTrailDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(cardsDir, { recursive: true });
  mkdirSync(inboxDir, { recursive: true });

  let created = false;
  if (!existsSync(cfgPath)) {
    writeFileSync(cfgPath, DEFAULT_CONFIG_YAML, "utf8");
    created = true;
  }

  let mcpCreated = false;
  if (!existsSync(mcpPath)) {
    writeFileSync(mcpPath, DEFAULT_MCP_JSON, "utf8");
    mcpCreated = true;
  }

  // Touch the SQLite cache: open with WAL + DDL, then close. Idempotent.
  const db = openDb(cachePath);
  closeDb(db);

  return {
    created,
    config_path: cfgPath,
    cache_path: cachePath,
    mcp_config_path: mcpPath,
    mcp_config_created: mcpCreated,
  };
}
