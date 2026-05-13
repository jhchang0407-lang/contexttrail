import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildResolvedImportsFromGraph,
  classifyMissShape,
  renderMissShapeAuditTable,
  type AuditCase,
} from "./prd-0031-miss-shape-audit.js";
import type { Db } from "../store/db.js";
import { closeDb, openDb } from "../store/db.js";
import { upsertCodeSource } from "../store/code-sources.js";
import { syncCodeGraph } from "../store/code-graph.js";

let tmp: string;
let db: Db;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "contexttrail-audit-graph-"));
  db = openDb(join(tmp, "contexttrail.db"));
});

afterEach(() => {
  closeDb(db);
  rmSync(tmp, { recursive: true, force: true });
});

describe("classifyMissShape", () => {
  const baseCase: AuditCase = {
    ticket: "THO-X",
    miss_kind: "agent_completion_file",
    target: "src/missed.ts",
  };

  it("flags target_imports_surfaced_seed=true when target imports a surfaced seed", () => {
    const row = classifyMissShape({
      caseInfo: baseCase,
      surfacedSeeds: ["src/seed-a.ts", "src/seed-b.ts"],
      importsByPath: new Map([
        ["src/missed.ts", ["src/seed-a.ts", "src/util.ts"]],
        ["src/other.ts", ["src/missed.ts"]],
      ]),
      knownSources: new Set([
        "src/missed.ts",
        "src/seed-a.ts",
        "src/seed-b.ts",
        "src/util.ts",
        "src/other.ts",
      ]),
      seedsReverseVisitTarget: false,
      targetInCandidates: false,
      reverseNeighborCountsBySeed: new Map([
        ["src/seed-a.ts", 1],
        ["src/seed-b.ts", 0],
      ]),
      hasSymbols: true,
    });
    expect(row.target_imports_surfaced_seed).toBe(true);
    expect(row.has_outgoing_imports).toBe(true);
    expect(row.has_incoming_imports).toBe(true);
    expect(row.hub_dilution_evidence).toBe(false);
    // Proceed-eligible because target_imports_surfaced_seed && !seeds_reverse_visit_target.
    expect(row.proceed_eligible).toBe(true);
    expect(row.proceed_reason).toMatch(/reachable in principle/i);
  });

  it("flags hub_dilution_evidence when any seed has >8 reverse neighbors", () => {
    const row = classifyMissShape({
      caseInfo: baseCase,
      surfacedSeeds: ["src/hub.ts"],
      importsByPath: new Map([
        ["src/missed.ts", []],
      ]),
      knownSources: new Set(["src/missed.ts", "src/hub.ts"]),
      seedsReverseVisitTarget: false,
      targetInCandidates: false,
      reverseNeighborCountsBySeed: new Map([["src/hub.ts", 12]]),
      hasSymbols: false,
    });
    expect(row.hub_dilution_evidence).toBe(true);
    expect(row.proceed_eligible).toBe(true);
    expect(row.proceed_reason).toMatch(/hub/i);
  });

  it("flags proceed-eligible when visited AND in candidates (out-ranked)", () => {
    const row = classifyMissShape({
      caseInfo: baseCase,
      surfacedSeeds: ["src/seed.ts"],
      importsByPath: new Map([
        ["src/missed.ts", []],
        ["src/seed.ts", []],
      ]),
      knownSources: new Set(["src/missed.ts", "src/seed.ts"]),
      seedsReverseVisitTarget: true,
      targetInCandidates: true,
      reverseNeighborCountsBySeed: new Map([["src/seed.ts", 3]]),
      hasSymbols: false,
    });
    expect(row.proceed_eligible).toBe(true);
    expect(row.proceed_reason).toMatch(/out-ranked/i);
  });

  it("classifies as not proceed-eligible when target is reverse-unreachable and not in candidates", () => {
    // The THO-225 expected shape: no incoming or outgoing edges.
    const row = classifyMissShape({
      caseInfo: { ...baseCase, target: "src/flag.ts" },
      surfacedSeeds: ["src/seed.ts"],
      importsByPath: new Map([
        ["src/flag.ts", []], // no outgoing
        ["src/seed.ts", []],
      ]),
      knownSources: new Set(["src/flag.ts", "src/seed.ts"]),
      seedsReverseVisitTarget: false,
      targetInCandidates: false,
      reverseNeighborCountsBySeed: new Map([["src/seed.ts", 0]]),
      hasSymbols: false,
    });
    expect(row.target_imports_surfaced_seed).toBe(false);
    expect(row.has_outgoing_imports).toBe(false);
    expect(row.has_incoming_imports).toBe(false);
    expect(row.proceed_eligible).toBe(false);
  });

  it("reports n/a for code-graph fields on workflow doc misses", () => {
    const row = classifyMissShape({
      caseInfo: {
        ticket: "THO-225",
        miss_kind: "workflow_doc",
        target: "docs/ARCHITECTURE.md",
      },
      surfacedSeeds: [],
      importsByPath: new Map(),
      knownSources: new Set(["docs/ARCHITECTURE.md"]),
      seedsReverseVisitTarget: false,
      targetInCandidates: false,
      reverseNeighborCountsBySeed: new Map(),
      hasSymbols: false,
    });
    expect(row.target_imports_surfaced_seed).toBe("n/a");
    expect(row.has_outgoing_imports).toBe("n/a");
    expect(row.has_incoming_imports).toBe("n/a");
    expect(row.proceed_eligible).toBe(false);
    expect(row.proceed_reason).toMatch(/doc miss/i);
  });

  it("reports target not in corpus when target isn't a known source", () => {
    // Rolled-back files: present in a historical commit's diff but no
    // longer in the corpus today. Reverse-import (or any other lever)
    // cannot lift a target that isn't in the corpus.
    const row = classifyMissShape({
      caseInfo: {
        ticket: "THO-225",
        miss_kind: "agent_completion_file",
        target: "src/retrieve/rolled-back.ts",
      },
      surfacedSeeds: ["src/seed.ts"],
      importsByPath: new Map([
        ["src/seed.ts", []],
      ]),
      knownSources: new Set(["src/seed.ts"]),
      seedsReverseVisitTarget: false,
      targetInCandidates: false,
      reverseNeighborCountsBySeed: new Map([["src/seed.ts", 0]]),
      hasSymbols: false,
    });
    expect(row.target_imports_surfaced_seed).toBe("n/a");
    expect(row.has_outgoing_imports).toBe("n/a");
    expect(row.has_incoming_imports).toBe("n/a");
    expect(row.proceed_eligible).toBe(false);
    expect(row.proceed_reason).toMatch(/not in corpus/i);
  });

  it("computes has_incoming_imports from forward edges", () => {
    const row = classifyMissShape({
      caseInfo: baseCase,
      surfacedSeeds: [],
      importsByPath: new Map([
        ["src/missed.ts", []],
        ["src/consumer.ts", ["src/missed.ts"]],
      ]),
      knownSources: new Set(["src/missed.ts", "src/consumer.ts"]),
      seedsReverseVisitTarget: false,
      targetInCandidates: false,
      reverseNeighborCountsBySeed: new Map(),
      hasSymbols: true,
    });
    expect(row.has_incoming_imports).toBe(true);
    expect(row.has_outgoing_imports).toBe(false);
  });
});

describe("renderMissShapeAuditTable", () => {
  it("emits a markdown table with one row per audit row and a proceed summary", () => {
    const rows = [
      classifyMissShape({
        caseInfo: {
          ticket: "THO-X",
          miss_kind: "agent_completion_file",
          target: "src/a.ts",
        },
        surfacedSeeds: ["src/seed.ts"],
        importsByPath: new Map([
          ["src/a.ts", ["src/seed.ts"]],
          ["src/seed.ts", []],
        ]),
        knownSources: new Set(["src/a.ts", "src/seed.ts"]),
        seedsReverseVisitTarget: false,
        targetInCandidates: false,
        reverseNeighborCountsBySeed: new Map([["src/seed.ts", 1]]),
        hasSymbols: true,
      }),
      classifyMissShape({
        caseInfo: {
          ticket: "THO-Y",
          miss_kind: "agent_completion_file",
          target: "src/b.ts",
        },
        surfacedSeeds: ["src/seed.ts"],
        importsByPath: new Map([
          ["src/b.ts", []],
          ["src/seed.ts", []],
        ]),
        knownSources: new Set(["src/b.ts", "src/seed.ts"]),
        seedsReverseVisitTarget: false,
        targetInCandidates: false,
        reverseNeighborCountsBySeed: new Map([["src/seed.ts", 0]]),
        hasSymbols: false,
      }),
    ];
    const md = renderMissShapeAuditTable(rows);
    expect(md).toMatch(/ticket/);
    expect(md).toMatch(/target_imports_surfaced_seed/);
    expect(md).toMatch(/THO-X/);
    expect(md).toMatch(/THO-Y/);
    // Summary line names the proceed count.
    expect(md).toMatch(/proceed-eligible: 1\s*\/\s*2/i);
  });
});

describe("buildResolvedImportsFromGraph", () => {
  it("reads the persisted code graph instead of reconstructing from raw code-source rows", () => {
    upsertCodeSource(db, {
      facts: {
        file_path: "src/retrieve/source-rerank.ts",
        exported_symbols: [{ name: "scoreSourceRerank", kind: "function" }],
        exported_signatures: ["export function scoreSourceRerank(): number"],
        file_purpose: "Rerank entry point.",
        imports: ["src/retrieve/bm25"],
      },
      source_content_hash: "h1",
      indexed_at: "2026-05-11T00:00:00Z",
    });
    upsertCodeSource(db, {
      facts: {
        file_path: "src/retrieve/bm25.ts",
        exported_symbols: [{ name: "scoreBm25", kind: "function" }],
        exported_signatures: ["export function scoreBm25(): number"],
        file_purpose: "BM25 support.",
        imports: [],
      },
      source_content_hash: "h1",
      indexed_at: "2026-05-11T00:00:00Z",
    });
    syncCodeGraph(db);

    upsertCodeSource(db, {
      facts: {
        file_path: "src/retrieve/source-rerank.ts",
        exported_symbols: [{ name: "scoreSourceRerank", kind: "function" }],
        exported_signatures: ["export function scoreSourceRerank(): number"],
        file_purpose: "Rerank entry point.",
        imports: [],
      },
      source_content_hash: "h2",
      indexed_at: "2026-05-11T00:00:01Z",
    });

    const { importsByPath, knownSources } = buildResolvedImportsFromGraph(db);

    expect(knownSources.has("src/retrieve/source-rerank.ts")).toBe(true);
    expect(importsByPath.get("src/retrieve/source-rerank.ts")).toEqual([
      "src/retrieve/bm25.ts",
    ]);
  });
});
