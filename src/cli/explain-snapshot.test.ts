/**
 * Snapshot tests for `contexttrail context --explain` text output (PRD-0002 / 3c).
 *
 * Each snapshot captures the section labels, freshness lines, lock_reason
 * decoration, and the first line of every chunk's score trace. These are the
 * primary debugging surfaces for retrieval; silent regressions here are
 * exactly the kind of thing the snapshot pinpoints.
 *
 * Snapshots are stable because:
 *   - chunk content is fixed
 *   - scoring is deterministic (no randomness)
 *   - score traces are normalized (we compare structural shape, not exact floats)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runContext } from "./context.js";
import { createTestCorpus, type TestCorpus } from "../eval/test-corpus.js";

let CORPUS: TestCorpus;
let CWD: string;

beforeAll(() => {
  CORPUS = createTestCorpus({ prefix: "contexttrail-explain-snap-" });
  CWD = CORPUS.cwd;
  writeFileSync(
    join(CWD, ".contexttrail/config.yaml"),
    `version: 1
doc_scopes:
  - id: payments-docs
    pattern: "docs/payments/**/*.md"
    scope:
      layer: module
      project: fundops
      module: payments
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
  mkdirSync(join(CWD, "docs/payments"), { recursive: true });
  writeFileSync(
    join(CWD, "docs/payments/refunds.md"),
    "# Refunds\n\nRefunds use idempotency keys.\n",
  );
  CORPUS.importDocs();

  mkdirSync(join(CWD, ".contexttrail/cards"), { recursive: true });
  writeFileSync(
    join(CWD, ".contexttrail/cards/c001.md"),
    `---
id: C001
type: constraint
title: Money rule
authority: accepted
scope:
  layer: project
  project: fundops
---

money rule body.
`,
  );
  writeFileSync(
    join(CWD, ".contexttrail/cards/s001.md"),
    `---
id: S001
type: symbol_note
title: processRefund idempotent
authority: accepted
scope:
  layer: module
  project: fundops
  module: payments
symbol_anchors:
  - RefundService.processRefund
---

processRefund body.
`,
  );
  writeFileSync(
    join(CWD, ".contexttrail/cards/c003.md"),
    `---
id: C003
type: constraint
title: Never log PII
authority: accepted
scope:
  layer: company
  company: acme
---

PII rule body.
`,
  );
  CORPUS.importCards();
});

afterAll(() => {
  CORPUS.cleanup();
});

/** Replace floating-point fields in score traces with stable placeholders so
 *  the snapshot is stable across micro-variations in scoring. */
function normalize(s: string): string {
  return s
    .replace(/bm25=\d+\.\d+/g, "bm25=N.NNN")
    .replace(/heading=\d+\.\d+/g, "heading=N.NNN")
    .replace(/scope=\d+\.\d+/g, "scope=N.NNN")
    .replace(/mentions=\d+\.\d+/g, "mentions=N.NNN")
    .replace(/spec=\d+\.\d+/g, "spec=N.NN")
    .replace(/text=\d+\.\d+/g, "text=N.NNN")
    .replace(/final=\d+\.\d+/g, "final=N.NNN")
    .replace(/packing=\d+\.\d+/g, "packing=N.NNN")
    .replace(/tokens=\d+/g, "tokens=N");
}

describe("contexttrail context --explain — snapshot stability", () => {
  it("locked-only Pack: project + symbol + company-broad", () => {
    const r = runContext(CWD, "fix refund logic", {
      files: ["src/payments/x.ts"],
      symbols: ["RefundService.processRefund"],
      explain: true,
    });
    expect(normalize(r.text!)).toMatchSnapshot();
  });

  it("unscoped query: only company-broad locks", () => {
    const r = runContext(CWD, "anything", { explain: true });
    expect(normalize(r.text!)).toMatchSnapshot();
  });

  it("multi-file scope OR semantics", () => {
    const r = runContext(CWD, "broad task", {
      files: ["src/payments/a.ts", "src/ledger/b.ts"],
      explain: true,
    });
    expect(normalize(r.text!)).toMatchSnapshot();
  });
});
