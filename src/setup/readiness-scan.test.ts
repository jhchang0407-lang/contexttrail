/**
 * Readiness scan integration tests.
 *
 * Scenarios cover band edges and the absolute-count floor on a real
 * SQLite cache populated via direct INSERTs (no full import pipeline,
 * since the scan only reads metadata, not chunk bodies).
 */
import { describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../config/init.js";
import { openDb, closeDb } from "../store/db.js";
import { scanSetupReadiness } from "./readiness-scan.js";

function withTempCwd<T>(fn: (cwd: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "contexttrail-readiness-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeMd(cwd: string, rel: string, body: string): void {
  const full = join(cwd, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body, "utf8");
}

type ChunkRow = {
  source_path: string;
  scope_layer: string | null;
  chunk_index?: number;
};

function seedChunks(cwd: string, rows: ChunkRow[]): void {
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  try {
    const stmt = db.prepare(`
      INSERT INTO doc_chunks (
        version_id, stable_key, doc_id, source_path,
        heading_path, heading_level, chunk_index, chunk_count,
        title, body, token_count, chunk_content_hash, source_content_hash,
        start_line, end_line, heading_slug,
        status, scope_layer, scope_data,
        doc_role, role_source, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    rows.forEach((r, i) => {
      const idx = r.chunk_index ?? i;
      stmt.run(
        `v_${i}_${r.source_path}`,
        `sk_${i}_${r.source_path}`,
        `doc_${r.source_path}`,
        r.source_path,
        "[]",
        1,
        idx,
        rows.length,
        "Title",
        "Body",
        10,
        `hash_${i}`,
        `shash_${r.source_path}`,
        1,
        2,
        null,
        "current",
        r.scope_layer,
        r.scope_layer ? JSON.stringify({ layer: r.scope_layer }) : null,
        "canonical",
        "default",
        "2026-05-11T00:00:00Z",
      );
    });
  } finally {
    closeDb(db);
  }
}

type CardSeed = {
  id: string;
  type: "constraint" | "symbol_note" | "evidence";
  authority?: "accepted" | "provisional" | "deprecated";
};

function seedCards(cwd: string, cards: CardSeed[]): void {
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  try {
    const stmt = db.prepare(`
      INSERT INTO cards (
        id, type, title, body, authority, provenance, authored_by,
        scope_layer, scope_data, command, covers,
        source_path, source_hash,
        freshness_state, freshness_reason, author_review_state,
        token_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of cards) {
      stmt.run(
        c.id,
        c.type,
        `Title ${c.id}`,
        "Body",
        c.authority ?? "accepted",
        "human_authored",
        "test",
        null,
        null,
        c.type === "evidence" ? "echo hi" : null,
        c.type === "evidence" ? "[]" : null,
        `.contexttrail/cards/${c.id}.md`,
        `sh_${c.id}`,
        "verified",
        "no_links",
        "unreviewed",
        10,
        "2026-05-11T00:00:00Z",
      );
    }
  } finally {
    closeDb(db);
  }
}

describe("scanSetupReadiness — fresh repo (no .contexttrail)", () => {
  it("reports low across all stored dimensions when no cache exists", () => {
    withTempCwd((cwd) => {
      const report = scanSetupReadiness(cwd);
      expect(report.cwd).toBe(cwd);
      expect(report.dimensions.corpus_coverage.score).toBe("low");
      expect(report.dimensions.scope_coverage.score).toBe("low");
      expect(report.dimensions.card_coverage.score).toBe("low");
    });
  });

  it("stubs retrieval_probes to partial pending slice 33.2", () => {
    withTempCwd((cwd) => {
      const report = scanSetupReadiness(cwd);
      expect(report.dimensions.retrieval_probes.score).toBe("partial");
    });
  });
});

describe("scanSetupReadiness — corpus_coverage", () => {
  it("uses absolute-chunk floor: 1 README imported, 4 chunks → low", () => {
    withTempCwd((cwd) => {
      writeMd(cwd, "README.md", "# repo\n");
      init(cwd);
      seedChunks(cwd, [
        { source_path: "README.md", scope_layer: "project" },
        { source_path: "README.md", scope_layer: "project" },
        { source_path: "README.md", scope_layer: "project" },
        { source_path: "README.md", scope_layer: "project" },
      ]);
      const report = scanSetupReadiness(cwd);
      expect(report.dimensions.corpus_coverage.score).toBe("low");
      expect(report.dimensions.corpus_coverage.evidence).toMatchObject({
        discoverable_markdown: 1,
        imported_markdown: 1,
        imported_chunks: 4,
      });
    });
  });

  it("counts docs/ tree + repo-root README in discoverable set", () => {
    withTempCwd((cwd) => {
      writeMd(cwd, "README.md", "# r\n");
      writeMd(cwd, "docs/a.md", "# a\n");
      writeMd(cwd, "docs/sub/b.md", "# b\n");
      writeMd(cwd, "docs/sub/c.md", "# c\n");
      // ignored
      writeMd(cwd, "src/notes.md", "# not docs\n");
      init(cwd);
      // Import only README + docs/a.md → 2 of 4 discoverable (50% partial; floor cleared)
      seedChunks(cwd, [
        { source_path: "README.md", scope_layer: "project" },
        { source_path: "README.md", scope_layer: "project" },
        { source_path: "docs/a.md", scope_layer: "project" },
        { source_path: "docs/a.md", scope_layer: "project" },
        { source_path: "docs/a.md", scope_layer: "project" },
      ]);
      const report = scanSetupReadiness(cwd);
      expect(report.dimensions.corpus_coverage.evidence).toMatchObject({
        discoverable_markdown: 4,
        imported_markdown: 2,
        imported_chunks: 5,
      });
      expect(report.dimensions.corpus_coverage.score).toBe("partial");
    });
  });

  it("returns confident when ≥70% of discoverable markdown is imported (floor cleared)", () => {
    withTempCwd((cwd) => {
      // 10 discoverable, import 8 (80%); 6 chunks → floor cleared
      writeMd(cwd, "README.md", "# r\n");
      for (let i = 0; i < 9; i++) writeMd(cwd, `docs/f${i}.md`, "x");
      init(cwd);
      const chunks: ChunkRow[] = [];
      // Import 8 of the 10
      const imported = ["README.md", "docs/f0.md", "docs/f1.md", "docs/f2.md", "docs/f3.md", "docs/f4.md", "docs/f5.md", "docs/f6.md"];
      for (const p of imported) {
        chunks.push({ source_path: p, scope_layer: "project" });
      }
      seedChunks(cwd, chunks);
      const report = scanSetupReadiness(cwd);
      expect(report.dimensions.corpus_coverage.score).toBe("confident");
    });
  });
});

describe("scanSetupReadiness — scope_coverage", () => {
  it("counts non-unknown scope_layer chunks against the total", () => {
    withTempCwd((cwd) => {
      writeMd(cwd, "README.md", "x");
      init(cwd);
      // 10 chunks total: 8 with project, 1 with unknown, 1 with NULL → 8/10 = 80% confident
      const chunks: ChunkRow[] = [];
      for (let i = 0; i < 8; i++) chunks.push({ source_path: `docs/${i}.md`, scope_layer: "project" });
      chunks.push({ source_path: "docs/u.md", scope_layer: "unknown" });
      chunks.push({ source_path: "docs/n.md", scope_layer: null });
      seedChunks(cwd, chunks);
      const report = scanSetupReadiness(cwd);
      expect(report.dimensions.scope_coverage.evidence).toMatchObject({
        total_chunks: 10,
        scoped_chunks: 8,
      });
      expect(report.dimensions.scope_coverage.score).toBe("confident");
    });
  });

  it("returns low when all chunks are unknown/null scope", () => {
    withTempCwd((cwd) => {
      writeMd(cwd, "README.md", "x");
      init(cwd);
      seedChunks(cwd, [
        { source_path: "README.md", scope_layer: "unknown" },
        { source_path: "README.md", scope_layer: null },
      ]);
      const report = scanSetupReadiness(cwd);
      expect(report.dimensions.scope_coverage.score).toBe("low");
    });
  });
});

describe("scanSetupReadiness — card_coverage", () => {
  it("returns low when there are 0 accepted cards", () => {
    withTempCwd((cwd) => {
      writeMd(cwd, "README.md", "x");
      init(cwd);
      const report = scanSetupReadiness(cwd);
      expect(report.dimensions.card_coverage.score).toBe("low");
      expect(report.dimensions.card_coverage.evidence).toMatchObject({
        accepted_cards: 0,
        constraint_cards: 0,
      });
    });
  });

  it("returns partial when there are 6 cards but 0 constraints (PRD: ≥1 constraint required for confident)", () => {
    withTempCwd((cwd) => {
      writeMd(cwd, "README.md", "x");
      init(cwd);
      const cards: CardSeed[] = [];
      for (let i = 0; i < 6; i++) cards.push({ id: `S00${i}`, type: "symbol_note" });
      seedCards(cwd, cards);
      const report = scanSetupReadiness(cwd);
      expect(report.dimensions.card_coverage.score).toBe("partial");
      expect(report.dimensions.card_coverage.evidence).toMatchObject({
        accepted_cards: 6,
        constraint_cards: 0,
      });
    });
  });

  it("returns confident at ≥6 accepted cards including ≥1 constraint", () => {
    withTempCwd((cwd) => {
      writeMd(cwd, "README.md", "x");
      init(cwd);
      seedCards(cwd, [
        { id: "C001", type: "constraint" },
        { id: "S001", type: "symbol_note" },
        { id: "S002", type: "symbol_note" },
        { id: "S003", type: "symbol_note" },
        { id: "S004", type: "symbol_note" },
        { id: "S005", type: "symbol_note" },
      ]);
      const report = scanSetupReadiness(cwd);
      expect(report.dimensions.card_coverage.score).toBe("confident");
      expect(report.dimensions.card_coverage.evidence).toMatchObject({
        accepted_cards: 6,
        constraint_cards: 1,
      });
    });
  });

  it("does not count non-accepted cards (provisional / deprecated) toward the accepted count", () => {
    withTempCwd((cwd) => {
      writeMd(cwd, "README.md", "x");
      init(cwd);
      seedCards(cwd, [
        { id: "C001", type: "constraint", authority: "provisional" },
        { id: "C002", type: "constraint", authority: "deprecated" },
        { id: "C003", type: "constraint", authority: "accepted" },
      ]);
      const report = scanSetupReadiness(cwd);
      expect(report.dimensions.card_coverage.evidence).toMatchObject({
        accepted_cards: 1,
        constraint_cards: 1,
      });
      expect(report.dimensions.card_coverage.score).toBe("partial");
    });
  });
});

describe("scanSetupReadiness — retrieval_probes (no probeResults passed)", () => {
  it("reports partial with an explanatory note in evidence", () => {
    withTempCwd((cwd) => {
      writeMd(cwd, "README.md", "x");
      init(cwd);
      const report = scanSetupReadiness(cwd);
      expect(report.dimensions.retrieval_probes.score).toBe("partial");
      expect(JSON.stringify(report.dimensions.retrieval_probes.evidence))
        .toMatch(/probes not run/);
    });
  });
});

describe("scanSetupReadiness — retrieval_probes wired with probeResults (THO-250)", () => {
  function probeResults(plan: ("confident" | "uncertain" | "empty")[]) {
    return plan.map((cc, i) => ({
      id: `p_${i}`,
      task: `task_${i}`,
      coverage_confidence: cc,
      signal_empty: i === plan.length - 1,
      rationale: `r_${i}`,
    }));
  }

  it("returns confident when 5/6 probes are confident (≥80%)", () => {
    withTempCwd((cwd) => {
      writeMd(cwd, "README.md", "x");
      init(cwd);
      const report = scanSetupReadiness(cwd, {
        probeResults: probeResults([
          "confident",
          "confident",
          "confident",
          "confident",
          "confident",
          "empty",
        ]),
      });
      expect(report.dimensions.retrieval_probes.score).toBe("confident");
      expect(report.dimensions.retrieval_probes.evidence).toMatchObject({
        total_probes: 6,
        confident_probes: 5,
      });
    });
  });

  it("returns partial when 4/6 probes are confident (≥50%, <80%)", () => {
    withTempCwd((cwd) => {
      writeMd(cwd, "README.md", "x");
      init(cwd);
      const report = scanSetupReadiness(cwd, {
        probeResults: probeResults([
          "confident",
          "confident",
          "confident",
          "confident",
          "uncertain",
          "empty",
        ]),
      });
      expect(report.dimensions.retrieval_probes.score).toBe("partial");
    });
  });

  it("returns low when 2/6 probes are confident (<50%)", () => {
    withTempCwd((cwd) => {
      writeMd(cwd, "README.md", "x");
      init(cwd);
      const report = scanSetupReadiness(cwd, {
        probeResults: probeResults([
          "confident",
          "confident",
          "uncertain",
          "uncertain",
          "empty",
          "empty",
        ]),
      });
      expect(report.dimensions.retrieval_probes.score).toBe("low");
    });
  });

  it("records signal_empty + rationale on every probe result so --explain can show the rationale", () => {
    withTempCwd((cwd) => {
      writeMd(cwd, "README.md", "x");
      init(cwd);
      const results = probeResults(["confident", "uncertain", "empty"]);
      const report = scanSetupReadiness(cwd, { probeResults: results });
      const ev = report.dimensions.retrieval_probes.evidence as {
        per_probe: { id: string; signal_empty: boolean; rationale: string }[];
      };
      expect(ev.per_probe).toHaveLength(3);
      expect(ev.per_probe[2]!.signal_empty).toBe(true);
      for (const p of ev.per_probe) {
        expect(p.rationale.length).toBeGreaterThan(0);
      }
    });
  });

  it("returns low at 0/6 confident probes", () => {
    withTempCwd((cwd) => {
      writeMd(cwd, "README.md", "x");
      init(cwd);
      const report = scanSetupReadiness(cwd, {
        probeResults: probeResults([
          "empty",
          "empty",
          "uncertain",
          "uncertain",
          "empty",
          "empty",
        ]),
      });
      expect(report.dimensions.retrieval_probes.score).toBe("low");
    });
  });
});
