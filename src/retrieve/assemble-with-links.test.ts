import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runImport } from "../cli/import.js";
import { init } from "../config/init.js";
import { closeDb, openDb } from "../store/db.js";
import { assembleContextPackWithLinks } from "./assemble-with-links.js";

function setupMiniCorpus(cwd: string): void {
  mkdirSync(join(cwd, "docs"), { recursive: true });
  mkdirSync(join(cwd, "docs/prd"), { recursive: true });
  mkdirSync(join(cwd, "docs/adr"), { recursive: true });
  writeFileSync(
    join(cwd, "docs/prd/0021-policy.md"),
    [
      "# PRD-0021 Policy decision tree",
      "",
      "Builds on [PRD-0012 source-rerank](../foundation/source-rerank.md) and",
      "[ADR-0014 authority](../adr/0014-authority.md).",
      "",
      "## Decision tree",
      "",
      "Five-state policy: ambiguity_high, anchor_missing, fallback, ready, policy_active.",
    ].join("\n"),
  );
  mkdirSync(join(cwd, "docs/foundation"), { recursive: true });
  writeFileSync(
    join(cwd, "docs/foundation/source-rerank.md"),
    "# Source rerank foundation\n\nFoundational doc for source ranking.",
  );
  writeFileSync(
    join(cwd, "docs/adr/0014-authority.md"),
    "# ADR-0014 Authority boundary\n\nWho decides what at setup vs query time.",
  );
}

describe("assembleContextPackWithLinks (engine integration)", () => {
  let cwd: string;
  let db: ReturnType<typeof openDb>;

  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), "contexttrail-assemble-test-"));
    init(cwd);
    setupMiniCorpus(cwd);
    runImport(cwd, ["docs/**/*.md"]);
    db = openDb(join(cwd, ".contexttrail", "cache", "contexttrail.db"));
  });

  afterAll(() => {
    closeDb(db);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("adds link-target chunks to ranked when a referencing doc surfaces", () => {
    const { pack, linkPulledSources } = assembleContextPackWithLinks({
      db,
      request: {
        task: "PRD-0021 policy decision tree five-state",
        query_anchors: { files: [], symbols: [], routes: [] },
        budget: "default",
        expected_locked: [],
        explain: false,
      },
      cwd,
      maxHops: 2,
    });

    const sources = new Set(
      pack.ranked
        .filter((r) => r.kind === "chunk")
        .map((r) => /^Source:\s+([^>]+?)(?:\s+>|$)/.exec(r.contexttrail)?.[1]?.trim() ?? ""),
    );

    expect(sources.has("docs/prd/0021-policy.md")).toBe(true);
    expect(linkPulledSources).toContain("docs/foundation/source-rerank.md");
    expect(linkPulledSources).toContain("docs/adr/0014-authority.md");
  });

  it("does not add link-target entries when maxHops=0", () => {
    const { pack, linkPulledSources } = assembleContextPackWithLinks({
      db,
      request: {
        task: "PRD-0021 policy decision tree",
        query_anchors: { files: [], symbols: [], routes: [] },
        budget: "default",
        expected_locked: [],
        explain: false,
      },
      cwd,
      maxHops: 0,
    });

    expect(linkPulledSources).toEqual([]);
    const linkTraversedTagged = pack.ranked.filter((r) => r.contexttrail.includes("(link-traversed)"));
    expect(linkTraversedTagged).toHaveLength(0);
  });

  it("emits inherited-score entries that rank below the raw retrieval entries", () => {
    const { pack } = assembleContextPackWithLinks({
      db,
      request: {
        task: "PRD-0021 policy decision tree",
        query_anchors: { files: [], symbols: [], routes: [] },
        budget: "default",
        expected_locked: [],
        explain: false,
      },
      cwd,
      maxHops: 2,
    });

    const raw = pack.ranked.filter((r) => !r.contexttrail.includes("(link-traversed)"));
    const traversed = pack.ranked.filter((r) => r.contexttrail.includes("(link-traversed)"));
    if (raw.length > 0 && traversed.length > 0) {
      const minRaw = Math.min(...raw.map((r) => r.score));
      const maxTraversed = Math.max(...traversed.map((r) => r.score));
      expect(maxTraversed).toBeLessThanOrEqual(minRaw);
    }
  });
});
