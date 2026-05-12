import { join } from "node:path";
import { loadConfig } from "../config/load.js";
import type { ContextTrailConfig } from "../config/defaults.js";
import { openDb, closeDb, type Db } from "../store/db.js";
import { retrieve, type RetrievalRequest, type RetrievalResult } from "./retrieve.js";

export type RetrievalRuntime = {
  cwd: string;
  config: ContextTrailConfig;
  db: Db;
  owns_db: boolean;
};

export type RetrievalRuntimeOpts = {
  cwd: string;
  config?: ContextTrailConfig;
  db?: Db;
};

export function defaultRetrievalDbPath(cwd: string): string {
  return join(cwd, ".contexttrail/cache/contexttrail.db");
}

export function openRetrievalRuntime(opts: RetrievalRuntimeOpts): RetrievalRuntime {
  return {
    cwd: opts.cwd,
    config: opts.config ?? loadConfig(opts.cwd),
    db: opts.db ?? openDb(defaultRetrievalDbPath(opts.cwd)),
    owns_db: opts.db === undefined,
  };
}

export function closeRetrievalRuntime(runtime: RetrievalRuntime): void {
  if (runtime.owns_db) closeDb(runtime.db);
}

export function runRetrievalPipeline(
  runtime: Pick<RetrievalRuntime, "config" | "db">,
  request: RetrievalRequest,
): RetrievalResult {
  return retrieve(runtime.db, request, runtime.config);
}

