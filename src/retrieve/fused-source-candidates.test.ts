/**
 * THO-137 / PRD-0013 V2.5.4 — fused source candidates.
 *
 * `buildFusedSourceCandidates` merges chunk-aggregated candidates with
 * multi-path fusion so the source rerank input carries a post-RRF
 * `fused_rank`. Sources that have no chunks but match anchor/alias paths
 * still produce a fused candidate ONLY when they also have a chunk to cite —
 * Context Packs continue to require chunk evidence.
 */
import { describe, it, expect } from "vitest";
import { buildFusedSourceCandidates } from "./fused-source-candidates.js";
import type { LexicalChunkHit } from "./multi-path-candidates.js";
import type { SourceProfile } from "../types/source-profile.js";

const NOW = "2026-05-08T00:00:00Z";

function profile(p: Partial<SourceProfile> & { source_path: string }): SourceProfile {
  return {
    source_path: p.source_path,
    source_content_hash: "h0",
    title: p.title ?? p.source_path,
    h1: p.h1 ?? null,
    intro: p.intro ?? null,
    heading_outline: p.heading_outline ?? [],
    doc_role: p.doc_role ?? "canonical",
    role_source: p.role_source ?? "default",
    doc_purpose: p.doc_purpose ?? "unknown",
    purpose_source: p.purpose_source ?? "default",
    aliases: p.aliases ?? [],
    summary: p.summary ?? null,
    summary_source: p.summary_source ?? "empty",
    questions_answered: p.questions_answered ?? [],
    questions_answered_source: p.questions_answered_source ?? "empty",
    chunk_count: p.chunk_count ?? 1,
    token_count: p.token_count ?? 100,
    indexed_at: NOW,
  };
}

function lex(rank: number, source_path: string, score = 0.5): LexicalChunkHit {
  return { rank, source_path, final_score: score };
}

describe("buildFusedSourceCandidates", () => {
  it("emits one ProfileEnrichedSourceCandidate per chunk-supported source", () => {
    const out = buildFusedSourceCandidates({
      lexical_chunks: [
        { rank: 1, version_id: "v1", source_path: "docs/a.md", final_score: 0.9, kind: "doc_chunk" },
        { rank: 2, version_id: "v2", source_path: "docs/b.md", final_score: 0.5, kind: "doc_chunk" },
      ],
      profiles: [profile({ source_path: "docs/a.md" }), profile({ source_path: "docs/b.md" })],
      query_tokens: ["hello"],
      anchors: { files: [], symbols: [], routes: [] },
      profileBySource: (p) => null,
    });
    expect(out.map((c) => c.source_path).sort()).toEqual(["docs/a.md", "docs/b.md"]);
  });

  it("attaches the post-RRF fused_rank and path_count from multi-path fusion", () => {
    const out = buildFusedSourceCandidates({
      lexical_chunks: [
        { rank: 3, version_id: "v1", source_path: "docs/multi.md", final_score: 0.4, kind: "doc_chunk" },
        { rank: 1, version_id: "v2", source_path: "docs/strong.md", final_score: 0.9, kind: "doc_chunk" },
      ],
      profiles: [
        profile({
          source_path: "docs/multi.md",
          title: "Multi",
          aliases: [{ kind: "symbol", value: "FooBar", confidence: "high", origin: "intro" }],
        }),
        profile({ source_path: "docs/strong.md", title: "Strong" }),
      ],
      query_tokens: ["multi", "FooBar"],
      anchors: { files: [], symbols: [], routes: [] },
      profileBySource: () => null,
    });
    const multi = out.find((c) => c.source_path === "docs/multi.md")!;
    const strong = out.find((c) => c.source_path === "docs/strong.md")!;
    expect(multi.fused_rank).toBeDefined();
    expect(strong.fused_rank).toBeDefined();
    // multi has more contributing paths (lexical + alias + title), so its
    // fused_rank should be at least as good (lower or equal) as strong's.
    expect(multi.fused_path_count!).toBeGreaterThan(strong.fused_path_count!);
    expect(multi.fused_rank!).toBeLessThanOrEqual(strong.fused_rank!);
  });

  it("preserves contributing_chunks from the lexical input", () => {
    const out = buildFusedSourceCandidates({
      lexical_chunks: [
        { rank: 1, version_id: "vA1", source_path: "docs/a.md", final_score: 0.9, kind: "doc_chunk" },
        { rank: 5, version_id: "vA2", source_path: "docs/a.md", final_score: 0.7, kind: "doc_chunk" },
      ],
      profiles: [],
      query_tokens: [],
      anchors: { files: [], symbols: [], routes: [] },
      profileBySource: () => null,
    });
    const a = out[0];
    expect(a.contributing_chunks.map((c) => c.version_id).sort()).toEqual(["vA1", "vA2"]);
    expect(a.best_chunk_rank).toBe(1);
  });

  it("does not invent a candidate for a source that has no chunks", () => {
    // Final Context Packs cite Doc Chunks only; alias/anchor-only matches
    // can lift fused_rank but cannot synthesise a new candidate.
    const out = buildFusedSourceCandidates({
      lexical_chunks: [],
      profiles: [
        profile({
          source_path: "wiki/no-chunks.md",
          aliases: [{ kind: "symbol", value: "Foo", confidence: "high", origin: "intro" }],
        }),
      ],
      query_tokens: ["foo"],
      anchors: { files: [], symbols: [], routes: [] },
      profileBySource: () => null,
    });
    expect(out).toEqual([]);
  });
});
