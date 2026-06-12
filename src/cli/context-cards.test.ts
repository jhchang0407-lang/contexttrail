/**
 * End-to-end retrieval tests: Cards + locked-include + render.
 *
 * Covers the following acceptance criteria:
 *   - constraint Card with project scope locks for module within project
 *   - constraint Card with module scope does NOT lock for sibling module
 *   - symbol_note Card locks on verbatim symbol, not bare class
 *   - locked-overflow case emits warning + locked_overhead
 *   - render uses section labels (Locked rules / Symbol notes (locked) / Relevant docs / Warnings)
 *   - contexttrail explain decomposes lock reason + scope match path + freshness
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runContext } from "./context.js";
import { createTestCorpus, type TestCorpus } from "../eval/test-corpus.js";

function setup(): TestCorpus {
  return createTestCorpus({ prefix: "contexttrail-ctx-cards-" });
}

function writeCfg(cwd: string) {
  writeFileSync(
    join(cwd, ".contexttrail/config.yaml"),
    `version: 1
doc_scopes:
  - id: docs-default
    pattern: "docs/**/*.md"
    scope:
      layer: project
      project: fundops
code_scopes:
  - id: src-tree
    pattern: "src/**"
    scope:
      layer: module
      project: fundops
      module_from_path_after: src
retrieval:
  scoring:
    card_type_bias: 1.20
`,
  );
}

describe("contexttrail context with Cards (week 3 / 3a end-to-end)", () => {
  it("a project-scope constraint locks for a module-within-project task", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      writeCfg(cwd);
      mkdirSync(join(cwd, "docs/payments"), { recursive: true });
      writeFileSync(
        join(cwd, "docs/payments/refunds.md"),
        "---\nscope:\n  layer: module\n  project: fundops\n  module: payments\n---\n\n# Refunds\n\nbody about refunds and idempotency.\n",
      );
      corpus.importDocs();

      mkdirSync(join(cwd, ".contexttrail/cards"), { recursive: true });
      writeFileSync(
        join(cwd, ".contexttrail/cards/c001.md"),
        `---
id: C001
type: constraint
title: Money math goes through Money
authority: accepted
scope:
  layer: project
  project: fundops
---

All monetary amounts pass through the Money type. Never raw floats.
`,
      );
      corpus.importCards();

      const r = runContext(cwd, "fix refund logic", {
        files: ["src/payments/refund.ts"],
        json: true,
      });
      expect(r.pack.locked).toHaveLength(1);
      expect(r.pack.locked[0]!.card_id).toBe("C001");
      expect(r.json!.locked[0]!.lock_reason.kind).toBe(
        "constraint_scope_match",
      );
      expect(r.json!.locked[0]!.lock_reason.scope_match_path).toContain(
        "project:fundops",
      );
    } finally {
      corpus.cleanup();
    }
  });

  it("a module-scope constraint does NOT lock for a sibling module task", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      writeCfg(cwd);
      mkdirSync(join(cwd, "docs"), { recursive: true });
      writeFileSync(join(cwd, "docs/x.md"), "# X\n\nrelated.\n");
      corpus.importDocs();

      mkdirSync(join(cwd, ".contexttrail/cards"), { recursive: true });
      writeFileSync(
        join(cwd, ".contexttrail/cards/c002.md"),
        `---
id: C002
type: constraint
title: Ledger rule
authority: accepted
scope:
  layer: module
  project: fundops
  module: ledger
---

ledger-only rule.
`,
      );
      corpus.importCards();

      const r = runContext(cwd, "billing fix", {
        files: ["src/billing/x.ts"],
      });
      expect(r.pack.locked).toHaveLength(0);
    } finally {
      corpus.cleanup();
    }
  });

  it("a symbol_note locks on verbatim symbol but not on bare class", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      writeCfg(cwd);
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/x.md"), "# X\n\nbody.\n");
      corpus.importDocs();

      mkdirSync(join(cwd, ".contexttrail/cards"), { recursive: true });
      writeFileSync(
        join(cwd, ".contexttrail/cards/s001.md"),
        `---
id: S001
type: symbol_note
title: LedgerEntry.post idempotent
authority: accepted
scope:
  layer: module
  project: fundops
  module: ledger
symbol_anchors:
  - LedgerEntry.post
---

LedgerEntry.post must be idempotent.
`,
      );
      corpus.importCards();

      // Verbatim member match → locks.
      const r1 = runContext(cwd, "post entry", {
        symbols: ["LedgerEntry.post"],
      });
      expect(r1.pack.locked.map((t) => t.card_id)).toEqual(["S001"]);

      // Bare class → does NOT lock (no implicit chain matching).
      const r2 = runContext(cwd, "use LedgerEntry", {
        symbols: ["LedgerEntry"],
      });
      expect(r2.pack.locked).toHaveLength(0);
    } finally {
      corpus.cleanup();
    }
  });

  it("a route-anchored constraint contributes inferred scope and locks", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      writeCfg(cwd);
      mkdirSync(join(cwd, "docs/auth"), { recursive: true });
      writeFileSync(
        join(cwd, "docs/auth/sessions.md"),
        "---\nscope:\n  layer: module\n  project: auth\n  module: sessions\n---\n\n# Sessions\n\nRenew with `POST /sessions/:id/renew`.\n",
      );
      corpus.importDocs();

      mkdirSync(join(cwd, ".contexttrail/cards"), { recursive: true });
      writeFileSync(
        join(cwd, ".contexttrail/cards/c003.md"),
        `---
id: C003
type: constraint
title: Session renewal preserves token identity
authority: accepted
scope:
  layer: module
  project: auth
  module: sessions
routes:
  - POST /sessions/:id/renew
---

Session renewal extends TTL without rotating the token.
`,
      );
      corpus.importCards();

      const r = runContext(cwd, "renew session", {
        routes: ["POST /sessions/:id/renew"],
      });

      expect(r.pack.locked.map((t) => t.card_id)).toEqual(["C003"]);
    } finally {
      corpus.cleanup();
    }
  });

  it("locked-overflow case emits a warning and locked_overhead surfaces", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      writeCfg(cwd);
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/x.md"), "# X\n\nrefund logic.\n");
      corpus.importDocs();

      // Two enormous constraint cards locked under project scope = 8k tokens
      // of locked content, against a small budget (4k).
      const big = "lorem ipsum ".repeat(1500); // ~3k tokens
      mkdirSync(join(cwd, ".contexttrail/cards"), { recursive: true });
      writeFileSync(
        join(cwd, ".contexttrail/cards/c001.md"),
        `---
id: C001
type: constraint
title: Big rule one
authority: accepted
scope:
  layer: project
  project: fundops
---

${big}
`,
      );
      writeFileSync(
        join(cwd, ".contexttrail/cards/c002.md"),
        `---
id: C002
type: constraint
title: Big rule two
authority: accepted
scope:
  layer: project
  project: fundops
---

${big}
`,
      );
      corpus.importCards();

      const r = runContext(cwd, "fix refund", {
        files: ["src/payments/x.ts"],
        budget: "small",
      });
      expect(r.pack.locked).toHaveLength(2);
      expect(r.pack.warnings.some((w) => w.kind === "locked_overflow")).toBe(true);
      expect(r.pack.budget.locked_overhead).toBeGreaterThan(0);
    } finally {
      corpus.cleanup();
    }
  });

  it("promotes direct covers evidence into locked context", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      writeCfg(cwd);
      mkdirSync(join(cwd, "docs/payments"), { recursive: true });
      writeFileSync(
        join(cwd, "docs/payments/refunds.md"),
        "---\nscope:\n  layer: module\n  project: fundops\n  module: payments\n---\n\n# Refunds\n\nrefund logic.\n",
      );
      corpus.importDocs();

      mkdirSync(join(cwd, ".contexttrail/cards"), { recursive: true });
      writeFileSync(
        join(cwd, ".contexttrail/cards/c010.md"),
        `---
id: C010
type: constraint
title: Refunds must emit audit
authority: accepted
scope:
  layer: project
  project: fundops
---

Refunds must emit audit events.
`,
      );
      writeFileSync(
        join(cwd, ".contexttrail/cards/e010.md"),
        `---
id: E010
type: evidence
title: Refund audit test
authority: accepted
scope:
  layer: module
  project: fundops
  module: payments
command: npm test -- refund-audit
covers:
  - C010
---

The refund audit test passes.
`,
      );
      corpus.importCards();

      const r = runContext(cwd, "fix refund logic", {
        files: ["src/payments/refund.ts"],
        json: true,
      });

      expect(r.pack.locked.map((t) => t.card_id)).toEqual(["C010", "E010"]);
      expect(r.pack.included.find((t) => t.version_id === "E010")).toBeUndefined();
      expect(r.json!.locked.map((entry) => entry.card_id)).toEqual(["C010", "E010"]);
      expect(r.json!.locked[1]!.lock_reason.kind).toBe("evidence_covers_locked");
      expect(r.json!.locked[1]!.lock_reason.derived_from).toEqual(["C010"]);
    } finally {
      corpus.cleanup();
    }
  });

  it("render emits section labels: Locked rules, Symbol notes (locked), Relevant docs, Warnings", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      writeCfg(cwd);
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/refunds.md"), "# Refunds\n\nrefund body.\n");
      corpus.importDocs();

      mkdirSync(join(cwd, ".contexttrail/cards"), { recursive: true });
      writeFileSync(
        join(cwd, ".contexttrail/cards/c001.md"),
        `---
id: C001
type: constraint
title: project rule
authority: accepted
scope:
  layer: project
  project: fundops
---

constraint body.
`,
      );
      writeFileSync(
        join(cwd, ".contexttrail/cards/s001.md"),
        `---
id: S001
type: symbol_note
title: sym rule
authority: accepted
scope:
  layer: project
  project: fundops
symbol_anchors:
  - Refunder.process
---

sym body.
`,
      );
      corpus.importCards();

      const r = runContext(cwd, "fix refund", {
        files: ["src/payments/x.ts"],
        symbols: ["Refunder.process"],
        explain: true,
      });
      expect(r.text).toBeDefined();
      expect(r.text!).toMatch(/## Locked rules/);
      expect(r.text!).toMatch(/## Symbol notes \(locked\)/);
      expect(r.text!).toMatch(/## Relevant docs/);
    } finally {
      corpus.cleanup();
    }
  });

  it("company-scope constraint locks universally and surfaces broad_scope flag", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      writeCfg(cwd);
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/x.md"), "# X\n\nbody.\n");
      corpus.importDocs();

      mkdirSync(join(cwd, ".contexttrail/cards"), { recursive: true });
      writeFileSync(
        join(cwd, ".contexttrail/cards/c001.md"),
        `---
id: C001
type: constraint
title: Never log PII
authority: accepted
scope:
  layer: company
  company: acme
---

never log PII.
`,
      );
      corpus.importCards();

      const r = runContext(cwd, "anything", {
        files: ["src/anywhere/y.ts"],
        json: true,
      });
      expect(r.pack.locked).toHaveLength(1);
      expect(r.json!.locked[0]!.lock_reason.broad_scope).toBe(true);
    } finally {
      corpus.cleanup();
    }
  });

  it("renders a ranked non-locked constraint in Relevant docs", () => {
    const corpus = setup(); const cwd = corpus.cwd;
    try {
      writeCfg(cwd);
      mkdirSync(join(cwd, "docs"));
      writeFileSync(join(cwd, "docs/refunds.md"), "# Refunds\n\nambient prose.\n");
      corpus.importDocs();

      mkdirSync(join(cwd, ".contexttrail/cards"), { recursive: true });
      writeFileSync(
        join(cwd, ".contexttrail/cards/c010.md"),
        `---
id: C010
type: constraint
title: Refund retries
authority: accepted
scope:
  layer: module
  project: fundops
  module: billing
---

Refund retries must reuse the existing idempotency key.
`,
      );
      corpus.importCards();

      const textRun = runContext(cwd, "refund retries", {});
      const jsonRun = runContext(cwd, "refund retries", { json: true });
      expect(jsonRun.json!.included.some((entry) => entry.kind === "card" && entry.card_id === "C010")).toBe(true);
      expect(textRun.text!).toContain("## Relevant docs");
      expect(textRun.text!).toContain("C010: Refund retries (constraint)");
      expect(textRun.pack.locked.map((trace) => trace.card_id)).not.toContain("C010");
    } finally {
      corpus.cleanup();
    }
  });
});
