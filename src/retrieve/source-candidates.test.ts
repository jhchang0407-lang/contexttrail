import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, closeDb } from "../store/db.js";
import { upsertSourceProfile } from "../store/source-profiles.js";
import type { SourceProfile } from "../types/source-profile.js";
import {
  buildProfileEnrichedSourceCandidates,
  type SourceCandidateChunk,
} from "./source-candidates.js";

const NOW = "2026-05-08T00:00:00Z";

function makeProfile(p: Partial<SourceProfile> & { source_path: string }): SourceProfile {
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

function chunk(args: {
  rank: number;
  source_path: string;
  version_id: string;
  score: number;
  kind?: "doc_chunk" | "card";
}): SourceCandidateChunk {
  return {
    rank: args.rank,
    version_id: args.version_id,
    source_path: args.kind === "card" ? null : args.source_path,
    final_score: args.score,
    kind: args.kind ?? "doc_chunk",
  };
}

describe("buildProfileEnrichedSourceCandidates", () => {
  it("groups chunks by source_path and preserves contributing chunk traces", () => {
    const tmp = mkdtempSync(join(tmpdir(), "contexttrail-pesc-"));
    const db = openDb(join(tmp, "contexttrail.db"));
    try {
      const chunks: SourceCandidateChunk[] = [
        chunk({ rank: 1, source_path: "docs/a.md", version_id: "v1", score: 0.9 }),
        chunk({ rank: 2, source_path: "docs/b.md", version_id: "v2", score: 0.8 }),
        chunk({ rank: 3, source_path: "docs/a.md", version_id: "v3", score: 0.6 }),
      ];
      const result = buildProfileEnrichedSourceCandidates({ db, chunks });
      expect(result.map((s) => s.source_path)).toEqual(["docs/a.md", "docs/b.md"]);
      expect(result[0]!.best_chunk_rank).toBe(1);
      expect(result[0]!.best_chunk_score).toBeCloseTo(0.9);
      expect(result[0]!.contributing_chunks.map((c) => c.version_id)).toEqual(["v1", "v3"]);
    } finally {
      closeDb(db);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("attaches SourceProfile metadata when the profile exists", () => {
    const tmp = mkdtempSync(join(tmpdir(), "contexttrail-pesc-"));
    const db = openDb(join(tmp, "contexttrail.db"));
    try {
      upsertSourceProfile(
        db,
        makeProfile({ source_path: "docs/a.md", doc_purpose: "concept" }),
      );
      const result = buildProfileEnrichedSourceCandidates({
        db,
        chunks: [chunk({ rank: 1, source_path: "docs/a.md", version_id: "v1", score: 0.9 })],
      });
      expect(result[0]!.profile?.doc_purpose).toBe("concept");
    } finally {
      closeDb(db);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("leaves profile=null when no profile exists, but still emits the candidate", () => {
    const tmp = mkdtempSync(join(tmpdir(), "contexttrail-pesc-"));
    const db = openDb(join(tmp, "contexttrail.db"));
    try {
      const result = buildProfileEnrichedSourceCandidates({
        db,
        chunks: [chunk({ rank: 1, source_path: "docs/a.md", version_id: "v1", score: 0.9 })],
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.profile).toBeNull();
    } finally {
      closeDb(db);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("excludes Card candidates from source aggregation (Card separation)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "contexttrail-pesc-"));
    const db = openDb(join(tmp, "contexttrail.db"));
    try {
      const result = buildProfileEnrichedSourceCandidates({
        db,
        chunks: [
          chunk({ rank: 1, source_path: "", version_id: "card-x", score: 0.95, kind: "card" }),
          chunk({ rank: 2, source_path: "docs/a.md", version_id: "v1", score: 0.9 }),
        ],
      });
      expect(result.map((s) => s.source_path)).toEqual(["docs/a.md"]);
    } finally {
      closeDb(db);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("orders candidates deterministically: best_chunk_rank, then best_chunk_score desc, then path", () => {
    const tmp = mkdtempSync(join(tmpdir(), "contexttrail-pesc-"));
    const db = openDb(join(tmp, "contexttrail.db"));
    try {
      const chunks: SourceCandidateChunk[] = [
        chunk({ rank: 5, source_path: "docs/c.md", version_id: "v5", score: 0.5 }),
        chunk({ rank: 2, source_path: "docs/b.md", version_id: "v2", score: 0.7 }),
        chunk({ rank: 2, source_path: "docs/a.md", version_id: "v1", score: 0.6 }),
      ];
      const result = buildProfileEnrichedSourceCandidates({ db, chunks });
      // a.md and b.md tie on rank=2; b.md has higher best_chunk_score and so wins.
      expect(result.map((s) => s.source_path)).toEqual([
        "docs/b.md",
        "docs/a.md",
        "docs/c.md",
      ]);
      expect(result.map((s) => s.rank)).toEqual([1, 2, 3]);
    } finally {
      closeDb(db);
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
