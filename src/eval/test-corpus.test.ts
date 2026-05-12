import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestCorpus } from "./test-corpus.js";

describe("TestCorpus — shared fixture-setup builder", () => {
  it("creates an isolated temp .contexttrail repo with config + cache", () => {
    const corpus = createTestCorpus();
    try {
      expect(existsSync(join(corpus.cwd, ".contexttrail/config.yaml"))).toBe(true);
      expect(existsSync(join(corpus.cwd, ".contexttrail/cache/contexttrail.db"))).toBe(true);
      expect(existsSync(join(corpus.cwd, ".contexttrail/cards"))).toBe(true);
    } finally {
      corpus.cleanup();
    }
  });

  it("copyDocsFrom recursively copies a directory tree into <cwd>/docs", () => {
    const src = mkdtempSync(join(tmpdir(), "contexttrail-test-src-"));
    mkdirSync(join(src, "nested"), { recursive: true });
    writeFileSync(join(src, "a.md"), "# A\n", "utf8");
    writeFileSync(join(src, "nested/b.md"), "# B\n", "utf8");

    const corpus = createTestCorpus();
    try {
      corpus.copyDocsFrom(src);
      expect(existsSync(join(corpus.cwd, "docs/a.md"))).toBe(true);
      expect(existsSync(join(corpus.cwd, "docs/nested/b.md"))).toBe(true);
    } finally {
      corpus.cleanup();
    }
  });

  it("writeDoc writes arbitrary files, creating parent dirs", () => {
    const corpus = createTestCorpus();
    try {
      corpus.writeDoc("docs/payments/refunds.md", "# Refunds\nbody");
      const path = join(corpus.cwd, "docs/payments/refunds.md");
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, "utf8")).toContain("Refunds");
    } finally {
      corpus.cleanup();
    }
  });

  it("writeCard renders a typed Card fixture into .contexttrail/cards", () => {
    const corpus = createTestCorpus();
    try {
      corpus.writeCard({
        id: "C001",
        type: "constraint",
        title: "Audit on refund",
        scope: { layer: "module", project: "payments", module: "refunds" },
        body: "Every refund must emit an audit event.",
      });
      const path = join(corpus.cwd, ".contexttrail/cards/c001.md");
      expect(existsSync(path)).toBe(true);
      const content = readFileSync(path, "utf8");
      expect(content).toContain("id: C001");
      expect(content).toContain("Every refund must emit an audit event.");
    } finally {
      corpus.cleanup();
    }
  });

  it("importDocs + importCards round-trip via real CLI command paths", () => {
    const corpus = createTestCorpus();
    try {
      corpus.writeDoc(
        "docs/payments/refunds.md",
        "# Refunds\n\nRefunds use idempotency keys.\n",
      );
      corpus.writeCard({
        id: "C001",
        type: "constraint",
        title: "Refund audit",
        scope: { layer: "module", project: "payments", module: "refunds" },
        body: "Every refund must emit an audit event.",
      });

      corpus.importDocs();
      corpus.importCards();

      // The cache db now exists with content.
      const dbPath = join(corpus.cwd, ".contexttrail/cache/contexttrail.db");
      expect(existsSync(dbPath)).toBe(true);
    } finally {
      corpus.cleanup();
    }
  });

  it("cleanup removes the temp directory", () => {
    const corpus = createTestCorpus();
    expect(existsSync(corpus.cwd)).toBe(true);
    corpus.cleanup();
    expect(existsSync(corpus.cwd)).toBe(false);
  });
});
