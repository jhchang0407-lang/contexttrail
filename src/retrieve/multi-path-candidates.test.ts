/**
 * THO-136 / PRD-0013 V2.5.3 — multi-path source candidates with deterministic
 * fusion. Verifies each candidate path can independently surface a source and
 * that reciprocal-rank fusion preserves per-path explanations.
 */
import { describe, it, expect } from "vitest";
import {
  fuseSourceCandidates,
  generateMultiPathSourceCandidates,
  RRF_K,
  SOURCE_CANDIDATE_PATHS,
  type PathCandidate,
} from "./multi-path-candidates.js";

function pc(
  path: PathCandidate["path"],
  source: string,
  rank: number,
  reason = "test",
): PathCandidate {
  return {
    path,
    source_path: source,
    rank,
    score: 1 / rank,
    reason,
    matched: [],
  };
}

describe("fuseSourceCandidates", () => {
  it("orders sources by reciprocal-rank fusion across paths", () => {
    const fused = fuseSourceCandidates([
      pc("lexical_chunk", "docs/a.md", 1),
      pc("title_h1", "docs/a.md", 1),
      pc("lexical_chunk", "docs/b.md", 2),
    ]);
    expect(fused[0].source_path).toBe("docs/a.md");
    expect(fused[0].path_count).toBe(2);
    expect(fused[0].rrf_score).toBeCloseTo(2 / (RRF_K + 1), 6);
    expect(fused[1].source_path).toBe("docs/b.md");
  });

  it("preserves per-path traces on every fused candidate", () => {
    const fused = fuseSourceCandidates([
      pc("lexical_chunk", "docs/a.md", 3, "bm25 hit"),
      pc("alias", "docs/a.md", 1, "alias hit on 'foo'"),
    ]);
    const a = fused.find((f) => f.source_path === "docs/a.md")!;
    expect(a.contributing_paths.map((p) => p.path).sort()).toEqual([
      "alias",
      "lexical_chunk",
    ]);
    expect(a.contributing_paths.find((p) => p.path === "alias")?.reason).toBe(
      "alias hit on 'foo'",
    );
  });

  it("breaks ties deterministically by source_path", () => {
    const fused = fuseSourceCandidates([
      pc("title_h1", "docs/zeta.md", 1),
      pc("title_h1", "docs/alpha.md", 1),
    ]);
    expect(fused.map((f) => f.source_path)).toEqual([
      "docs/alpha.md",
      "docs/zeta.md",
    ]);
  });

  it("assigns 1-indexed ranks in fused order", () => {
    const fused = fuseSourceCandidates([
      pc("lexical_chunk", "docs/a.md", 1),
      pc("lexical_chunk", "docs/b.md", 2),
      pc("lexical_chunk", "docs/c.md", 3),
    ]);
    expect(fused.map((f) => f.rank)).toEqual([1, 2, 3]);
  });

  it("multi-weak beats single-strong: two weak paths can outrank one strong", () => {
    const fused = fuseSourceCandidates([
      // single strong: docs/strong.md only via lexical, rank 1
      pc("lexical_chunk", "docs/strong.md", 1),
      // multi-weak: docs/multi.md via two paths but at lower ranks
      pc("title_h1", "docs/multi.md", 3),
      pc("alias", "docs/multi.md", 3),
    ]);
    // strong = 1/(K+1) ; multi = 2/(K+3). With K=60: 1/61 ≈ 0.01639,
    // 2/63 ≈ 0.03175 — multi wins.
    expect(fused[0].source_path).toBe("docs/multi.md");
    expect(fused[1].source_path).toBe("docs/strong.md");
  });

  it("declares the canonical set of candidate paths", () => {
    expect(SOURCE_CANDIDATE_PATHS).toEqual([
      "lexical_chunk",
      "path_filename",
      "title_h1",
      "heading",
      "alias",
      "anchor",
      "question_heading",
    ]);
  });
});

describe("generateMultiPathSourceCandidates", () => {
  it("emits a lexical_chunk candidate for each unique source from chunk hits", () => {
    const out = generateMultiPathSourceCandidates({
      query_tokens: ["foo", "bar"],
      anchors: { files: [], symbols: [], routes: [] },
      lexical_chunk_candidates: [
        { rank: 1, source_path: "docs/a.md", final_score: 0.9 },
        { rank: 2, source_path: "docs/a.md", final_score: 0.8 }, // dup source
        { rank: 3, source_path: "docs/b.md", final_score: 0.4 },
      ],
      profiles: [],
    });
    const lex = out.filter((p) => p.path === "lexical_chunk");
    expect(lex.map((p) => p.source_path)).toEqual(["docs/a.md", "docs/b.md"]);
    // Best (lowest) rank wins per source.
    expect(lex.find((p) => p.source_path === "docs/a.md")?.rank).toBe(1);
  });

  it("emits a path_filename candidate when query tokens hit the path or filename", () => {
    const out = generateMultiPathSourceCandidates({
      query_tokens: ["routing"],
      anchors: { files: [], symbols: [], routes: [] },
      lexical_chunk_candidates: [],
      profiles: [
        {
          source_path: "docs/api/routing.md",
          title: "API Reference",
          h1: null,
          heading_outline: [],
          aliases: [],
          questions_answered: [],
        },
      ],
    });
    expect(out.some((p) => p.path === "path_filename" && p.source_path === "docs/api/routing.md")).toBe(true);
  });

  it("emits a title_h1 candidate when query tokens hit the title or h1", () => {
    const out = generateMultiPathSourceCandidates({
      query_tokens: ["routing"],
      anchors: { files: [], symbols: [], routes: [] },
      lexical_chunk_candidates: [],
      profiles: [
        {
          source_path: "docs/x.md",
          title: "Routing",
          h1: "Routing",
          heading_outline: [],
          aliases: [],
          questions_answered: [],
        },
      ],
    });
    expect(out.some((p) => p.path === "title_h1" && p.source_path === "docs/x.md")).toBe(true);
  });

  it("emits a heading candidate when query tokens hit any heading text", () => {
    const out = generateMultiPathSourceCandidates({
      query_tokens: ["middleware"],
      anchors: { files: [], symbols: [], routes: [] },
      lexical_chunk_candidates: [],
      profiles: [
        {
          source_path: "docs/x.md",
          title: "X",
          h1: null,
          heading_outline: [
            { level: 2, text: "Using Middleware", slug: "using-middleware" },
          ],
          aliases: [],
          questions_answered: [],
        },
      ],
    });
    expect(out.some((p) => p.path === "heading" && p.source_path === "docs/x.md")).toBe(true);
  });

  it("emits an alias candidate when a SourceProfile alias matches a query token", () => {
    const out = generateMultiPathSourceCandidates({
      query_tokens: ["zodoptional"],
      anchors: { files: [], symbols: [], routes: [] },
      lexical_chunk_candidates: [],
      profiles: [
        {
          source_path: "wiki/optionality.md",
          title: "Optionality",
          h1: null,
          heading_outline: [],
          aliases: [
            { kind: "symbol", value: "ZodOptional", confidence: "high", origin: "intro" },
          ],
          questions_answered: [],
        },
      ],
    });
    expect(out.some((p) => p.path === "alias" && p.source_path === "wiki/optionality.md")).toBe(true);
  });

  it("emits an anchor candidate when a request file anchor matches the source path", () => {
    const out = generateMultiPathSourceCandidates({
      query_tokens: [],
      anchors: { files: ["docs/api/routing.md"], symbols: [], routes: [] },
      lexical_chunk_candidates: [],
      profiles: [
        {
          source_path: "docs/api/routing.md",
          title: "Routing",
          h1: null,
          heading_outline: [],
          aliases: [],
          questions_answered: [],
        },
      ],
    });
    expect(out.some((p) => p.path === "anchor" && p.source_path === "docs/api/routing.md")).toBe(true);
  });

  it("emits a question_heading candidate when the query echoes a recorded question", () => {
    const out = generateMultiPathSourceCandidates({
      query_tokens: ["how", "to", "configure", "routes"],
      anchors: { files: [], symbols: [], routes: [] },
      lexical_chunk_candidates: [],
      profiles: [
        {
          source_path: "docs/howto.md",
          title: "How-to",
          h1: null,
          heading_outline: [],
          aliases: [],
          questions_answered: ["How to configure routes?"],
        },
      ],
    });
    expect(out.some((p) => p.path === "question_heading" && p.source_path === "docs/howto.md")).toBe(true);
  });

  it("all generated candidates carry a path-specific rank starting at 1", () => {
    const out = generateMultiPathSourceCandidates({
      query_tokens: ["routing"],
      anchors: { files: [], symbols: [], routes: [] },
      lexical_chunk_candidates: [
        { rank: 1, source_path: "docs/api/routing.md", final_score: 0.9 },
      ],
      profiles: [
        {
          source_path: "docs/api/routing.md",
          title: "Routing",
          h1: null,
          heading_outline: [],
          aliases: [],
          questions_answered: [],
        },
      ],
    });
    // For each path that emits anything, ranks must start at 1 with no gaps.
    const groups = new Map<string, number[]>();
    for (const c of out) {
      const arr = groups.get(c.path) ?? [];
      arr.push(c.rank);
      groups.set(c.path, arr);
    }
    for (const ranks of groups.values()) {
      const sorted = [...ranks].sort((a, b) => a - b);
      expect(sorted[0]).toBe(1);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]).toBe(sorted[i - 1] + 1);
      }
    }
  });
});
