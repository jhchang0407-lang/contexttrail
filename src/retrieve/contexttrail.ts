import type { DocChunk } from "../types/chunk.js";
import type { CodeSupportCluster, StoredCodeChunk } from "../types/code-source.js";

export function chunkContextTrail(chunk: Pick<DocChunk, "source_path" | "heading_path" | "chunk_index" | "chunk_count">): string {
  return `Source: ${chunk.source_path} > Section: ${chunk.heading_path.join(" > ")} > Part: ${chunk.chunk_index}/${chunk.chunk_count}`;
}

export function codeContextTrail(
  chunk: Pick<
    StoredCodeChunk,
    "source_path" | "symbol_path" | "code_role" | "start_line" | "end_line"
  >,
  opts: { import_traversed?: boolean; support_cluster?: CodeSupportCluster } = {},
): string {
  const parts = [`Code: ${chunk.source_path}`];
  if (chunk.symbol_path) parts.push(`Symbol: ${chunk.symbol_path}`);
  parts.push(`Role: ${chunk.code_role}`);
  parts.push(`Lines: ${chunk.start_line}-${chunk.end_line}`);
  if (opts.import_traversed) parts.push("import-traversed");
  if (opts.support_cluster) {
    parts.push(
      opts.support_cluster.role === "primary"
        ? "support-cluster primary"
        : `support-cluster support of ${opts.support_cluster.seed_source_path}`,
    );
    if (opts.support_cluster.family_evidence?.reasons.length) {
      parts.push(
        `family-evidence ${opts.support_cluster.family_evidence.reasons.join(",")}`,
      );
    }
    if (opts.support_cluster.facility_evidence?.facility_tags.length) {
      parts.push(
        `facility-evidence ${opts.support_cluster.facility_evidence.facility_tags.join(",")}`,
      );
    }
  }
  return parts.join(" > ");
}
