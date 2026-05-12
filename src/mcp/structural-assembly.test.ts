import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandlers } from "./handlers.js";
import { createTestCorpus, type TestCorpus } from "../eval/test-corpus.js";

describe("retrieve_context_pack structural assembly integration", () => {
  let corpus: TestCorpus;
  let cwd: string;

  beforeAll(() => {
    corpus = createTestCorpus({ prefix: "contexttrail-mcp-assembly-" });
    cwd = corpus.cwd;

    corpus.writeDoc(
      "docs/payments/refunds.md",
      `---
scope:
  layer: module
  project: payments
  module: refunds
  files:
    - src/payments/refund.ts
  symbols:
    - RefundService.processRefund
---

# Refunds

RefundService.processRefund is idempotent and is the only refund entry point.

## Partial refunds

A partial refund reuses the same idempotency key and ledger path as the original charge.

## Edge cases

Duplicate partial refunds should return the existing refund record instead of creating another one.
`,
    );

    corpus.writeDoc(
      "docs/adr/0001-idempotency-keys.md",
      `---
scope:
  layer: decision
  project: payments
---

# ADR-0001: Idempotency keys for payment retries

RefundService.processRefund relies on the provider idempotency key as the source of truth.
`,
    );

    corpus.importDocs();
  });

  afterAll(() => corpus.cleanup());

  it("surfaces parent-stage assembly for nested anchored roots", async () => {
    const response = await createHandlers({ cwd }).retrieve_context_pack({
      task: "partial refund idempotency key",
      files: ["src/payments/refund.ts"],
      explain: true,
    });

    expect(response.assembly_stage_reached).toBe("parent");
    expect(response.ranked.map((entry) => entry.contexttrail)).toContain(
      "Source: docs/payments/refunds.md > Section: Refunds > Part: 1/1",
    );
    expect(response.explain?.assembly).toEqual({
      root_version_id: expect.any(String),
      selected_neighbors: [
        {
          version_id: expect.any(String),
          relation: "parent",
          reason: "immediate parent section",
        },
      ],
      early_stop_reason: "first sufficient structural stage",
    });
  });

  it("surfaces sibling-stage assembly when the anchored task asks for adjacent same-doc context", async () => {
    const response = await createHandlers({ cwd }).retrieve_context_pack({
      task: "partial refunds and edge cases",
      files: ["src/payments/refund.ts"],
      explain: true,
    });

    expect(response.assembly_stage_reached).toBe("siblings");
    expect(
      response.ranked.some((entry) => entry.contexttrail.includes("Section: Refunds > Edge cases")),
    ).toBe(true);
    expect(response.explain?.assembly?.selected_neighbors[0]).toEqual({
      version_id: expect.any(String),
      relation: "siblings",
      reason: "adjacent sibling with lexical overlap",
    });
  });

  it("surfaces linked-neighbor assembly for rationale-seeking anchored queries", async () => {
    const response = await createHandlers({ cwd }).retrieve_context_pack({
      task: "why do refunds use provider idempotency keys",
      files: ["src/payments/refund.ts"],
      symbols: ["RefundService.processRefund"],
      explain: true,
    });

    expect(response.assembly_stage_reached).toBe("linked_neighbor");
    expect(
      response.ranked.some((entry) => entry.contexttrail.includes("docs/adr/0001-idempotency-keys.md")),
    ).toBe(true);
    expect(response.explain?.assembly?.selected_neighbors[0]).toEqual({
      version_id: expect.any(String),
      relation: "linked_neighbor",
      reason: "shared anchored rationale signal",
    });
  });
});
