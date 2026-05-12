import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestCorpus } from "../eval/test-corpus.js";
import { openDb, closeDb } from "../store/db.js";
import { getCardById } from "../store/cards.js";
import { getCodeSource } from "../store/code-sources.js";
import { getSource } from "../store/sources.js";
import { runCardVerify } from "../cli/card-cmds.js";
import { listInboxItems } from "../inbox/items.js";
import { createHandlers } from "../mcp/handlers.js";
import { schemas } from "../mcp/schemas.js";
import { proposeSetupQuestions } from "../setup/questions.js";
import type { SetupReadinessRunResult } from "../setup/run.js";
import { runLedgerSync } from "./ledger-sync.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI_ENTRY = join(REPO_ROOT, "src/cli/main.ts");

describe("runLedgerSync", () => {
  it("check mode reports stale and missing sources without mutating the cache", async () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-sync-check-" });
    try {
      corpus.writeDoc("docs/a.md", "# A\n\noriginal body.\n");
      corpus.writeDoc("docs/gone.md", "# Gone\n\nwill disappear.\n");
      mkdirSync(join(corpus.cwd, "src"), { recursive: true });
      writeFileSync(join(corpus.cwd, "src/foo.ts"), "export const foo = 1;\n");
      corpus.importDocs();

      const beforeDb = openDb(join(corpus.cwd, ".contexttrail/cache/contexttrail.db"));
      const docBefore = getSource(beforeDb, "docs/a.md")!;
      const codeBefore = getCodeSource(beforeDb, "src/foo.ts")!;
      closeDb(beforeDb);

      writeFileSync(join(corpus.cwd, "docs/a.md"), "# A\n\nedited body.\n");
      writeFileSync(join(corpus.cwd, "src/foo.ts"), "export const foo = 2;\n");
      rmSync(join(corpus.cwd, "docs/gone.md"));

      const result = await runLedgerSync(corpus.cwd, { check: true });

      expect(result.mode).toBe("check");
      expect(result.writes).toEqual([]);
      expect(result.freshness.stale_doc_sources).toEqual(["docs/a.md"]);
      expect(result.freshness.stale_code_sources).toEqual(["src/foo.ts"]);
      expect(result.freshness.missing_sources).toEqual(["docs/gone.md"]);
      expect(result.actions.map((action) => action.kind)).toEqual([
        "import_docs",
        "refresh_code_sources",
        "index_missing",
        "import_cards",
      ]);

      const afterDb = openDb(join(corpus.cwd, ".contexttrail/cache/contexttrail.db"));
      expect(getSource(afterDb, "docs/a.md")?.source_content_hash).toBe(
        docBefore.source_content_hash,
      );
      expect(getCodeSource(afterDb, "src/foo.ts")?.source_content_hash).toBe(
        codeBefore.source_content_hash,
      );
      closeDb(afterDb);
    } finally {
      corpus.cleanup();
    }
  });

  it("apply mode refreshes sources, preserves author review, and marks linked Cards that drifted", async () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-sync-apply-" });
    try {
      corpus.writeDoc("docs/rules.md", "# Rules\n\nRefunds must be audited.\n");
      corpus.importDocs();
      const chunk = currentChunk(corpus.cwd, "docs/rules.md");
      const cardPath = join(corpus.cwd, ".contexttrail/cards/c001.md");
      writeFileSync(
        cardPath,
        [
          "---",
          "id: C001",
          "type: constraint",
          "title: Refund audit rule",
          "authority: accepted",
          "scope:",
          "  layer: project",
          "  project: sync",
          "linked_chunks:",
          `  - chunk_stable_key: ${chunk.stable_key}`,
          `    version_pin: ${chunk.version_id}`,
          `    content_hash_pin: ${chunk.chunk_content_hash}`,
          "    link_type: evidences",
          "    linked_at: 2026-05-12T00:00:00.000Z",
          "---",
          "",
          "Refunds must be audited.",
          "",
        ].join("\n"),
      );
      corpus.importCards();
      expect(runCardVerify(corpus.cwd, "C001")).toBe(true);
      const acceptedCardBefore = readFileSync(cardPath, "utf8");

      writeFileSync(
        join(corpus.cwd, "docs/rules.md"),
        "# Rules\n\nRefunds must be audited with a trace id.\n",
      );

      const result = await runLedgerSync(corpus.cwd);

      expect(result.mode).toBe("apply");
      expect(result.doc_import?.files_imported).toBe(1);
      expect(result.card_import?.cards_imported).toBe(1);
      expect(result.cards.before.needs_review).toBe(0);
      expect(result.cards.after.needs_review).toBe(1);
      expect(result.cards.newly_needs_review).toEqual([
        {
          id: "C001",
          title: "Refund audit rule",
          freshness_reason: "version_drift",
        },
      ]);
      expect(readFileSync(cardPath, "utf8")).toBe(acceptedCardBefore);

      const db = openDb(join(corpus.cwd, ".contexttrail/cache/contexttrail.db"));
      const card = getCardById(db, "C001")!;
      const source = getSource(db, "docs/rules.md")!;
      closeDb(db);
      expect(card.author_review_state).toBe("verified");
      expect(card.freshness_state).toBe("needs_review");
      expect(card.freshness_reason).toBe("version_drift");
      expect(source.source_content_hash).not.toBe(chunk.source_content_hash);

      const second = await runLedgerSync(corpus.cwd);
      expect(second.freshness).toEqual({
        stale_doc_sources: [],
        stale_code_sources: [],
        missing_sources: [],
      });
      expect(second.cards.newly_needs_review).toEqual([]);
      expect(second.cards.already_needs_review).toEqual(["C001"]);
    } finally {
      corpus.cleanup();
    }
  });

  it("can explicitly refresh provisional candidates without editing accepted Cards", async () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-sync-candidates-" });
    try {
      corpus.writeDoc("docs/rules.md", "# Rules\n\nRefunds must never exceed capture.\n");
      corpus.importDocs();
      const cardPath = join(corpus.cwd, ".contexttrail/cards/c001.md");
      writeFileSync(
        cardPath,
        [
          "---",
          "id: C001",
          "type: constraint",
          "title: Existing accepted rule",
          "authority: accepted",
          "scope:",
          "  layer: project",
          "---",
          "",
          "Existing accepted truth.",
          "",
        ].join("\n"),
      );
      corpus.importCards();
      const before = readFileSync(cardPath, "utf8");

      const result = await runLedgerSync(corpus.cwd, { refreshCandidates: true });

      expect(result.candidate_refresh?.constraint_candidates_written).toBeGreaterThan(0);
      expect(listInboxItems(corpus.cwd).some((item) => item.review_type === "candidate_card")).toBe(
        true,
      );
      expect(readFileSync(cardPath, "utf8")).toBe(before);
    } finally {
      corpus.cleanup();
    }
  });

  it("MCP sync_ledger defaults to check mode and applies only when requested", async () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-sync-mcp-" });
    try {
      corpus.writeDoc("docs/a.md", "# A\n\noriginal body.\n");
      corpus.importDocs();
      const beforeDb = openDb(join(corpus.cwd, ".contexttrail/cache/contexttrail.db"));
      const beforeHash = getSource(beforeDb, "docs/a.md")!.source_content_hash;
      closeDb(beforeDb);
      writeFileSync(join(corpus.cwd, "docs/a.md"), "# A\n\nedited body.\n");

      const handlers = createHandlers({ cwd: corpus.cwd });
      const check = await handlers.sync_ledger({});

      expect(check.mode).toBe("check");
      expect(check.writes).toEqual([]);
      expect(schemas.sync_ledger.output.safeParse(check).success).toBe(true);
      const afterCheckDb = openDb(join(corpus.cwd, ".contexttrail/cache/contexttrail.db"));
      expect(getSource(afterCheckDb, "docs/a.md")?.source_content_hash).toBe(beforeHash);
      closeDb(afterCheckDb);

      const apply = await handlers.sync_ledger({ check: false });

      expect(apply.mode).toBe("apply");
      expect(apply.doc_import?.files_imported).toBe(1);
      expect(schemas.sync_ledger.output.safeParse(apply).success).toBe(true);
    } finally {
      corpus.cleanup();
    }
  });

  it("contexttrail sync --json emits the MCP sync schema shape", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-sync-cli-" });
    try {
      corpus.writeDoc("docs/a.md", "# A\n\noriginal body.\n");
      corpus.importDocs();
      writeFileSync(join(corpus.cwd, "docs/a.md"), "# A\n\nedited body.\n");

      const out = execFileSync(
        "npx",
        ["tsx", CLI_ENTRY, "sync", "--check", "--json"],
        {
          cwd: corpus.cwd,
          encoding: "utf8",
          env: { ...process.env, NO_COLOR: "1" },
        },
      );
      const parsed = JSON.parse(out);

      expect(schemas.sync_ledger.output.safeParse(parsed).success).toBe(true);
      expect(parsed.mode).toBe("check");
      expect(parsed.writes).toEqual([]);
      expect(parsed.freshness.stale_doc_sources).toEqual(["docs/a.md"]);
    } finally {
      corpus.cleanup();
    }
  }, 30_000);

  it("post-sync setup questions surface stale accepted Cards before more bootstrap", async () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-sync-questions-" });
    try {
      corpus.writeDoc("docs/rules.md", "# Rules\n\nRefunds must be audited.\n");
      corpus.importDocs();
      const chunk = currentChunk(corpus.cwd, "docs/rules.md");
      writeFileSync(
        join(corpus.cwd, ".contexttrail/cards/c001.md"),
        [
          "---",
          "id: C001",
          "type: constraint",
          "title: Refund audit rule",
          "authority: accepted",
          "scope:",
          "  layer: project",
          "linked_chunks:",
          `  - chunk_stable_key: ${chunk.stable_key}`,
          `    version_pin: ${chunk.version_id}`,
          `    content_hash_pin: ${chunk.chunk_content_hash}`,
          "    link_type: evidences",
          "    linked_at: 2026-05-12T00:00:00.000Z",
          "---",
          "",
          "Refunds must be audited.",
          "",
        ].join("\n"),
      );
      corpus.importCards();
      writeFileSync(
        join(corpus.cwd, "docs/rules.md"),
        "# Rules\n\nRefunds must be audited with a trace id.\n",
      );
      await runLedgerSync(corpus.cwd);

      const plan = proposeSetupQuestions(corpus.cwd, confidentReadiness(corpus.cwd));

      expect(plan.questions[0]).toMatchObject({
        id: "review-stale-cards",
        kind: "review_stale_cards",
        command_preview: "contexttrail card list --needs-review",
      });
    } finally {
      corpus.cleanup();
    }
  });
});

function currentChunk(cwd: string, sourcePath: string): {
  stable_key: string;
  version_id: string;
  chunk_content_hash: string;
  source_content_hash: string;
} {
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  try {
    return db
      .prepare(
        "SELECT stable_key, version_id, chunk_content_hash, source_content_hash FROM doc_chunks WHERE source_path = ? AND status = 'current' LIMIT 1",
      )
      .get(sourcePath) as {
      stable_key: string;
      version_id: string;
      chunk_content_hash: string;
      source_content_hash: string;
    };
  } finally {
    closeDb(db);
  }
}

function confidentReadiness(cwd: string): SetupReadinessRunResult {
  const dimension = { score: "confident" as const, evidence: {} };
  return {
    report: {
      cwd,
      dimensions: {
        corpus_coverage: dimension,
        scope_coverage: dimension,
        card_coverage: dimension,
        retrieval_probes: dimension,
      },
    },
    suggestion: {
      row_name: "ready",
      command: null,
      message: "Ready.",
    },
    pending_inbox_items: 0,
  };
}
