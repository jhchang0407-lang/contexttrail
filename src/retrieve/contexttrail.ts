import type { DocChunk } from "../types/chunk.js";

export function chunkContextTrail(chunk: Pick<DocChunk, "source_path" | "heading_path" | "chunk_index" | "chunk_count">): string {
  return `Source: ${chunk.source_path} > Section: ${chunk.heading_path.join(" > ")} > Part: ${chunk.chunk_index}/${chunk.chunk_count}`;
}

