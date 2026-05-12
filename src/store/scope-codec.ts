import type { ChunkScope } from "../types/chunk.js";

export function decodeChunkScope(raw: string | null | undefined): ChunkScope {
  if (!raw) return { layer: "unknown", source: {} };
  return JSON.parse(raw) as ChunkScope;
}

export function encodeChunkScope(scope: ChunkScope): string {
  return JSON.stringify(scope);
}
