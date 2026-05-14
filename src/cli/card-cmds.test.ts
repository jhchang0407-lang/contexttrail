import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  runCardAdd,
  runCardList,
  runCardShow,
  runCardVerify,
  runCardMarkNeedsReview,
  runCardLink,
  runCardUnlink,
  runCardSuggest,
} from "./card-cmds.js";
import { openDb, closeDb } from "../store/db.js";
import { getCardById } from "../store/cards.js";
import { createTestCorpus, type TestCorpus } from "../eval/test-corpus.js";

function fixture(): TestCorpus {
  const corpus = createTestCorpus({ prefix: "contexttrail-cards-cmd-" });
  mkdirSync(join(corpus.cwd, ".contexttrail/cards"), { recursive: true });
  return corpus;
}

describe("contexttrail card add", () => {
  it("scaffolds a Card markdown file with a generated id (C### / S### / E###)", () => {
    const corpus = fixture(); const cwd = corpus.cwd;
    try {
      const r1 = runCardAdd(cwd, "constraint");
      expect(r1.id).toMatch(/^C\d{3}$/);
      const r2 = runCardAdd(cwd, "symbol_note");
      expect(r2.id).toMatch(/^S\d{3}$/);
      const r3 = runCardAdd(cwd, "evidence");
      expect(r3.id).toMatch(/^E\d{3}$/);
    } finally {
      corpus.cleanup();
    }
  });

  it("increments id within type (C001 -> C002 after first import)", () => {
    const corpus = fixture(); const cwd = corpus.cwd;
    try {
      writeFileSync(
        join(cwd, ".contexttrail/cards/c001.md"),
        `---\nid: C001\ntype: constraint\ntitle: t\nauthority: accepted\nscope:\n  layer: project\n  project: x\n---\n\nbody\n`,
      );
      corpus.importCards();
      const r = runCardAdd(cwd, "constraint");
      expect(r.id).toBe("C002");
    } finally {
      corpus.cleanup();
    }
  });

  it("scaffold avoids literal TODO placeholders in accepted-card frontmatter", () => {
    const corpus = fixture(); const cwd = corpus.cwd;
    try {
      const created = runCardAdd(cwd, "constraint");
      const source = readFileSync(created.path, "utf8");
      expect(source).not.toContain("TODO");
      expect(source).toContain("authored_by: unknown");
      expect(source).toContain("project: unset");
    } finally {
      corpus.cleanup();
    }
  });
});

describe("contexttrail card list / show", () => {
  it("lists every imported Card with type, freshness, link_count", () => {
    const corpus = fixture(); const cwd = corpus.cwd;
    try {
      writeFileSync(
        join(cwd, ".contexttrail/cards/c001.md"),
        `---\nid: C001\ntype: constraint\ntitle: T1\nauthority: accepted\nscope:\n  layer: project\n  project: x\n---\n\nbody\n`,
      );
      writeFileSync(
        join(cwd, ".contexttrail/cards/e001.md"),
        `---\nid: E001\ntype: evidence\ntitle: T2\nauthority: accepted\nscope:\n  layer: project\n  project: x\ncommand: echo hi\n---\n\nbody\n`,
      );
      corpus.importCards();

      const rows = runCardList(cwd);
      expect(rows).toHaveLength(2);
      const e001 = rows.find((r) => r.id === "E001")!;
      expect(e001.unlinked).toBe(true);
    } finally {
      corpus.cleanup();
    }
  });

  it("show returns body, frontmatter, and link contexttrails", () => {
    const corpus = fixture(); const cwd = corpus.cwd;
    try {
      writeFileSync(
        join(cwd, ".contexttrail/cards/c001.md"),
        `---\nid: C001\ntype: constraint\ntitle: Money rule\nauthority: accepted\nscope:\n  layer: project\n  project: fundops\n---\n\nthe body\n`,
      );
      corpus.importCards();
      const r = runCardShow(cwd, "C001")!;
      expect(r.card.title).toBe("Money rule");
      expect(r.card.body.trim()).toBe("the body");
    } finally {
      corpus.cleanup();
    }
  });
});

describe("contexttrail card verify / mark-needs-review", () => {
  it("verify flips author_review_state but NOT freshness_state", () => {
    const corpus = fixture(); const cwd = corpus.cwd;
    try {
      writeFileSync(
        join(cwd, ".contexttrail/cards/c001.md"),
        `---\nid: C001\ntype: constraint\ntitle: t\nauthority: accepted\nscope:\n  layer: project\n  project: x\n---\n\nbody\n`,
      );
      corpus.importCards();
      expect(runCardVerify(cwd, "C001")).toBe(true);

      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const c = getCardById(db, "C001")!;
      closeDb(db);
      expect(c.author_review_state).toBe("verified");
      // freshness_state stays at its materialized value.
      expect(c.freshness_state).toBe("verified");
    } finally {
      corpus.cleanup();
    }
  });

  it("mark-needs-review flips author_review_state to needs_review_manual", () => {
    const corpus = fixture(); const cwd = corpus.cwd;
    try {
      writeFileSync(
        join(cwd, ".contexttrail/cards/c001.md"),
        `---\nid: C001\ntype: constraint\ntitle: t\nauthority: accepted\nscope:\n  layer: project\n  project: x\n---\n\nbody\n`,
      );
      corpus.importCards();
      expect(runCardMarkNeedsReview(cwd, "C001")).toBe(true);
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const c = getCardById(db, "C001")!;
      closeDb(db);
      expect(c.author_review_state).toBe("needs_review_manual");
    } finally {
      corpus.cleanup();
    }
  });
});

describe("contexttrail card link / unlink", () => {
  it("link captures version_pin from the chunk and re-materializes freshness", () => {
    const corpus = fixture(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/x.md"), "# X\n\nbody\n");
      corpus.importDocs();
      writeFileSync(
        join(cwd, ".contexttrail/cards/c001.md"),
        `---\nid: C001\ntype: constraint\ntitle: t\nauthority: accepted\nscope:\n  layer: project\n  project: x\n---\n\nbody\n`,
      );
      corpus.importCards();

      // Find the imported chunk's version_id.
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const row = db
        .prepare("SELECT version_id FROM doc_chunks WHERE status='current' LIMIT 1")
        .get() as { version_id: string };
      closeDb(db);

      expect(runCardLink(cwd, "C001", row.version_id, "evidences")).toBe(true);

      const db2 = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const c = getCardById(db2, "C001")!;
      closeDb(db2);
      expect(c.links).toHaveLength(1);
      expect(c.links[0]!.version_pin).toBe(row.version_id);
      expect(c.freshness_state).toBe("verified"); // pinned to current
    } finally {
      corpus.cleanup();
    }
  });

  it("unlink removes the link", () => {
    const corpus = fixture(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/x.md"), "# X\n\nbody\n");
      corpus.importDocs();
      writeFileSync(
        join(cwd, ".contexttrail/cards/c001.md"),
        `---\nid: C001\ntype: constraint\ntitle: t\nauthority: accepted\nscope:\n  layer: project\n  project: x\n---\n\nbody\n`,
      );
      corpus.importCards();
      const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const row = db
        .prepare("SELECT version_id FROM doc_chunks WHERE status='current' LIMIT 1")
        .get() as { version_id: string };
      closeDb(db);
      runCardLink(cwd, "C001", row.version_id, "evidences");
      expect(runCardUnlink(cwd, "C001", row.version_id, "evidences")).toBe(true);
      const db2 = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
      const c = getCardById(db2, "C001")!;
      closeDb(db2);
      expect(c.links).toHaveLength(0);
    } finally {
      corpus.cleanup();
    }
  });
});

describe("contexttrail card suggest (used inline by `contexttrail card add`)", () => {
  it("returns up to N candidate chunks ranked by anchor overlap then scope", () => {
    const corpus = fixture(); const cwd = corpus.cwd;
    try {
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/a.md"), "# A\n\nrelated to X\n");
      writeFileSync(join(cwd, "docs/b.md"), "# B\n\nunrelated\n");
      corpus.importDocs();
      writeFileSync(
        join(cwd, ".contexttrail/cards/c001.md"),
        `---\nid: C001\ntype: constraint\ntitle: t\nauthority: accepted\nscope:\n  layer: project\n  project: x\n---\n\nbody\n`,
      );
      corpus.importCards();
      const s = runCardSuggest(cwd, "C001", 3);
      expect(s.length).toBeGreaterThan(0);
      expect(s.length).toBeLessThanOrEqual(3);
    } finally {
      corpus.cleanup();
    }
  });
});
