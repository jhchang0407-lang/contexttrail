import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ContextTrailConfig } from "../config/defaults.js";
import { loadConfig } from "../config/load.js";
import { closeDb, openDb, type Db } from "../store/db.js";

export type LedgerWorkspaceInput = {
  cwd?: string;
};

export type LedgerContextOptions = {
  defaultCwd: string;
  db?: Db;
  config?: ContextTrailConfig;
};

export type LedgerPaths = {
  configPath: string;
  cachePath: string;
  dbPath: string;
  inboxPath: string;
  cardsPath: string;
  mcpConfigPath: string;
};

export type LedgerContext = LedgerPaths & {
  cwd: string;
  config: ContextTrailConfig;
  initialized: boolean;
  useProvidedDb: boolean;
};

export function ledgerPaths(cwd: string): LedgerPaths {
  const contextTrailDir = join(cwd, ".contexttrail");
  const cachePath = join(contextTrailDir, "cache");
  return {
    configPath: join(contextTrailDir, "config.yaml"),
    cachePath,
    dbPath: join(cachePath, "contexttrail.db"),
    inboxPath: join(contextTrailDir, "inbox"),
    cardsPath: join(contextTrailDir, "cards"),
    mcpConfigPath: join(cwd, ".mcp.json"),
  };
}

export function isLedgerInitialized(cwd: string): boolean {
  const paths = ledgerPaths(cwd);
  return existsSync(paths.configPath) && existsSync(paths.dbPath);
}

export function resolveLedgerContext(
  options: LedgerContextOptions,
  input: LedgerWorkspaceInput = {},
): LedgerContext {
  const cwd = input.cwd ?? options.defaultCwd;
  const paths = ledgerPaths(cwd);
  const isDefaultWorkspace = cwd === options.defaultCwd;
  return {
    cwd,
    ...paths,
    config: isDefaultWorkspace && options.config ? options.config : loadConfig(cwd),
    initialized: existsSync(paths.configPath) && existsSync(paths.dbPath),
    useProvidedDb: isDefaultWorkspace && !!options.db,
  };
}

export function withLedgerDb<T>(
  context: LedgerContext,
  providedDb: Db | undefined,
  run: (db: Db, context: LedgerContext) => T,
): T {
  const db = context.useProvidedDb ? providedDb! : openDb(context.dbPath);
  try {
    return run(db, context);
  } finally {
    if (!context.useProvidedDb) closeDb(db);
  }
}
