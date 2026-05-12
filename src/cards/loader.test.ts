import { describe, it, expect } from "vitest";
import { parseCard } from "./loader.js";

describe("card markdown loader", () => {
  it("parses a constraint card with project scope", () => {
    const src = `---
id: C001
type: constraint
title: Money math goes through Money
authority: accepted
scope:
  layer: project
  project: fundops
---

All monetary amounts pass through Money. Never raw floats.
`;
    const card = parseCard(src, ".contexttrail/cards/c001.md");
    expect(card.id).toBe("C001");
    expect(card.type).toBe("constraint");
    expect(card.title).toBe("Money math goes through Money");
    expect(card.authority).toBe("accepted");
    expect(card.scope.layer).toBe("project");
    expect(card.scope.project).toBe("fundops");
    expect(card.body.trim()).toBe(
      "All monetary amounts pass through Money. Never raw floats.",
    );
    expect(card.symbol_anchors).toEqual([]);
    expect(card.freshness_state).toBe("verified");
    expect(card.freshness_reason).toBe("no_links");
    expect(card.author_review_state).toBe("unreviewed");
  });

  it("parses a symbol_note with multi-anchor declaration", () => {
    const src = `---
id: S001
type: symbol_note
title: LedgerEntry.post must be idempotent
authority: accepted
scope:
  layer: module
  project: fundops
  module: fundops/ledger
symbol_anchors:
  - LedgerEntry
  - LedgerEntry.post
---

LedgerEntry.post may be retried with the same key. Make it idempotent.
`;
    const c = parseCard(src, ".contexttrail/cards/s001.md");
    expect(c.type).toBe("symbol_note");
    expect(c.symbol_anchors).toEqual(["LedgerEntry", "LedgerEntry.post"]);
  });

  it("parses an evidence card with command and covers", () => {
    const src = `---
id: E001
type: evidence
title: Refund idempotency test
authority: accepted
scope:
  layer: module
  project: fundops
  module: fundops/billing
command: pnpm test -- src/billing/refund.test.ts
covers:
  - C001
  - S001
---

Run the refund idempotency suite to verify.
    `;
    const c = parseCard(src, ".contexttrail/cards/e001.md");
    expect(c.type).toBe("evidence");
    if (c.type !== "evidence") throw new Error("expected evidence card");
    expect(c.command).toBe("pnpm test -- src/billing/refund.test.ts");
    expect(c.covers).toEqual(["C001", "S001"]);
  });

  it("parses linked_chunks with version_pin", () => {
    const src = `---
id: C002
type: constraint
title: t
authority: accepted
scope:
  layer: project
  project: fundops
linked_chunks:
  - chunk_stable_key: sk_abc
    version_pin: v1
    content_hash_pin: h1
    link_type: evidences
    linked_at: "2026-05-06T00:00:00Z"
---

body
`;
    const c = parseCard(src, "x.md");
    expect(c.links).toHaveLength(1);
    expect(c.links[0]!.chunk_stable_key).toBe("sk_abc");
    expect(c.links[0]!.version_pin).toBe("v1");
  });

  it("rejects malformed frontmatter (missing id)", () => {
    const src = `---
type: constraint
title: x
authority: accepted
scope:
  layer: project
---

body
`;
    expect(() => parseCard(src, "x.md")).toThrowError(/id/i);
  });

  it("rejects unknown card type", () => {
    const src = `---
id: X001
type: feature_intent
title: x
authority: accepted
scope:
  layer: project
---

body
`;
    expect(() => parseCard(src, "x.md")).toThrowError(/type/i);
  });

  it("rejects card id whose prefix does not match its type", () => {
    const src = `---
id: C001
type: symbol_note
title: x
authority: accepted
scope:
  layer: project
symbol_anchors:
  - X
---

body
`;
    expect(() => parseCard(src, "x.md")).toThrowError(/prefix/i);
  });

  it("rejects symbol_note without symbol_anchors", () => {
    const src = `---
id: S001
type: symbol_note
title: x
authority: accepted
scope:
  layer: project
---

body
`;
    expect(() => parseCard(src, "x.md")).toThrowError(/symbol_anchors/i);
  });

  it("rejects evidence without command", () => {
    const src = `---
id: E001
type: evidence
title: x
authority: accepted
scope:
  layer: project
---

body
`;
    expect(() => parseCard(src, "x.md")).toThrowError(/command/i);
  });

  it("computes a stable content hash and a token count", () => {
    const src = `---
id: C001
type: constraint
title: t
authority: accepted
scope:
  layer: project
---

body content
`;
    const c1 = parseCard(src, "x.md");
    const c2 = parseCard(src, "x.md");
    expect(c1.source_hash).toBe(c2.source_hash);
    expect(c1.source_hash.length).toBeGreaterThan(8);
  });

  it("emits a FreshnessReason of 'all_links_current' when links are present", () => {
    const src = `---
id: C002
type: constraint
title: t
authority: accepted
scope:
  layer: project
linked_chunks:
  - chunk_stable_key: sk_a
    version_pin: v1
    content_hash_pin: h1
    link_type: evidences
    linked_at: "now"
---

body
`;
    const c = parseCard(src, "x.md");
    expect(c.freshness_reason).toBe("all_links_current");
    expect(c.freshness_state).toBe("verified");
  });

  it("parses authored freshness_state for stale card fixtures", () => {
    const src = `---
id: E001
type: evidence
title: stale proof
authority: accepted
scope:
  layer: module
  project: fundops
  module: billing
command: pnpm test -- stale
covers:
  - C001
freshness_state: potentially_superseded
freshness_reason: version_drift
---

This proof points at a superseded behavior.
`;
    const c = parseCard(src, "x.md");
    expect(c.freshness_state).toBe("potentially_superseded");
    expect(c.freshness_reason).toBe("version_drift");
  });
});
