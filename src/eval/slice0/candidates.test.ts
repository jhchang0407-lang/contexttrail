import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runImport } from "../../cli/import.js";
import { init } from "../../config/init.js";
import { loadConfig } from "../../config/load.js";
import { openDb, closeDb } from "../../store/db.js";
import { captureSlice0ChunkCandidates } from "./candidates.js";

function mkLab(): string {
  const cwd = mkdtempSync(join(tmpdir(), "slice0-cands-"));
  init(cwd);
  return cwd;
}

function writeDoc(cwd: string, relPath: string, body: string): void {
  const full = join(cwd, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body, "utf8");
}

describe("captureSlice0ChunkCandidates", () => {
  it("returns scored chunks ranked by final_score descending, before threshold/packing", () => {
    const cwd = mkLab();
    try {
      writeDoc(
        cwd,
        "docs/widgets.md",
        "# Widgets\n\nThe widget API lets you create widgets.\n\n## Create widget\n\nCall createWidget to make a widget.\n",
      );
      writeDoc(
        cwd,
        "docs/unrelated.md",
        "# Unrelated\n\nNothing matching here at all.\n\n## Other section\n\nMore unrelated text.\n",
      );
      runImport(cwd, ["docs/**/*.md"]);
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      try {
        const config = loadConfig(cwd);
        const result = captureSlice0ChunkCandidates({
          db,
          config,
          request: {
            task: "create widget API",
            query_anchors: {},
            budget: "default",
          },
        });

        // Every eligible chunk must appear (no thresholding, no packing).
        expect(result.chunk_candidates.length).toBeGreaterThanOrEqual(2);

        // Ranks are 1-based and ordered by final_score desc.
        for (let i = 0; i < result.chunk_candidates.length; i++) {
          expect(result.chunk_candidates[i]!.rank).toBe(i + 1);
        }
        for (let i = 1; i < result.chunk_candidates.length; i++) {
          expect(result.chunk_candidates[i - 1]!.final_score).toBeGreaterThanOrEqual(
            result.chunk_candidates[i]!.final_score,
          );
        }

        // Per-candidate fields required for downstream Slice 0 metrics.
        const top = result.chunk_candidates[0]!;
        expect(top).toMatchObject({
          version_id: expect.any(String),
          source_path: expect.any(String),
          final_score: expect.any(Number),
          packing_score: expect.any(Number),
          bm25_norm: expect.any(Number),
          heading_match: expect.any(Number),
          scope_match: expect.any(Number),
          mention_overlap: expect.any(Number),
          token_count: expect.any(Number),
        });
        // The widgets doc should win since the query matches it.
        expect(top.source_path).toContain("widgets");

        // Result also exposes pack-stage signals so post-pack loss can be computed later.
        expect(result.threshold).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(result.included_version_ids)).toBe(true);
        expect(result.budget_tokens).toBeGreaterThan(0);
      } finally {
        closeDb(db);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("includes chunks that fall below min_final_score (no thresholding applied)", () => {
    const cwd = mkLab();
    try {
      // Two docs, query that matches one strongly and the other not at all.
      writeDoc(cwd, "docs/alpha.md", "# Alpha topic\n\nThe alpha topic body matches the alpha query.\n");
      writeDoc(cwd, "docs/zeta.md", "# Zeta\n\nCompletely unrelated content with no overlap whatsoever.\n");
      runImport(cwd, ["docs/**/*.md"]);
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      try {
        const config = loadConfig(cwd);
        const result = captureSlice0ChunkCandidates({
          db,
          config,
          request: {
            task: "alpha topic alpha query",
            query_anchors: {},
            budget: "default",
          },
        });

        const sourcePaths = new Set(result.chunk_candidates.map((c) => c.source_path));
        expect(sourcePaths.size).toBeGreaterThanOrEqual(2);
        // Even very-low-scoring chunks survive in the diagnostic output.
        const minScore = Math.min(...result.chunk_candidates.map((c) => c.final_score));
        expect(minScore).toBeGreaterThanOrEqual(0);
        // All chunks captured, including ones that would drop below min_final_score.
        expect(result.chunk_candidates.length).toBeGreaterThanOrEqual(2);
      } finally {
        closeDb(db);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
