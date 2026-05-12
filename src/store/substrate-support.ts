import type { Db } from "./db.js";

const substrateCache = new WeakMap<object, boolean>();

export function hasSubstrateTables(db: Db): boolean {
  const cached = substrateCache.get(db as object);
  if (cached !== undefined) return cached;
  const row = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'context_objects'",
    )
    .get() as { 1: number } | undefined;
  const present = !!row;
  substrateCache.set(db as object, present);
  return present;
}

