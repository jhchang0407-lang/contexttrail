import { describe, it, expect } from "vitest";
import { resolveLockedInclude, type LockReason } from "./locked-include.js";
import type { Card } from "../types/card.js";
import type { QueryScope } from "../retrieve/scope-match.js";
import type { QueryAnchors } from "../retrieve/score.js";

const fundopsLedger: QueryScope = {
  company: "acme",
  project: "fundops",
  module: "fundops/ledger",
};
const fundopsBilling: QueryScope = {
  company: "acme",
  project: "fundops",
  module: "fundops/billing",
};
const fundopsProject: QueryScope = { company: "acme", project: "fundops" };

function constraint(
  id: string,
  scope: Partial<Card["scope"]> & { layer: Card["scope"]["layer"] },
  symbol_anchors: string[] = [],
): Card {
  return {
    id,
    type: "constraint",
    title: id,
    body: "",
    authority: "accepted",
    scope: { ...scope, source: { frontmatter: true } },
    symbol_anchors,
    file_anchors: [],
    links: [],
    token_count: 0,
    freshness_state: "verified",
    freshness_reason: "no_links",
    author_review_state: "unreviewed",
    source_path: `${id}.md`,
    source_hash: "h",
    updated_at: "now",
  };
}

function symbolNote(id: string, anchors: string[]): Card {
  return {
    ...constraint(id, { layer: "module", project: "fundops", module: "fundops/ledger" }, anchors),
    type: "symbol_note",
  };
}

function evidence(id: string, covers: string[], freshness_state: Card["freshness_state"] = "verified"): Card {
  return {
    ...constraint(id, { layer: "module", project: "fundops", module: "fundops/ledger" }),
    type: "evidence",
    command: "npm test",
    covers,
    freshness_state,
  };
}

describe("locked-include resolver — constraint hierarchical-down (D38, ADR-0011)", () => {
  it("project-scope constraint locks for module within that project", () => {
    const c = constraint("C001", { layer: "project", project: "fundops" });
    const r = resolveLockedInclude([c], [fundopsLedger], {});
    expect(r.locked).toHaveLength(1);
    expect(r.locked[0]!.id).toBe("C001");
    expect(r.reasons.find((x) => x.card_id === "C001")?.kind).toBe(
      "constraint_scope_match",
    );
  });

  it("module-scope constraint does NOT lock for sibling module", () => {
    const c = constraint("C002", {
      layer: "module",
      project: "fundops",
      module: "fundops/ledger",
    });
    const r = resolveLockedInclude([c], [fundopsBilling], {});
    expect(r.locked).toHaveLength(0);
  });

  it("module-scope constraint does NOT lock for project-level task (descendant -> ancestor)", () => {
    const c = constraint("C003", {
      layer: "module",
      project: "fundops",
      module: "fundops/ledger",
    });
    const r = resolveLockedInclude([c], [fundopsProject], {});
    expect(r.locked).toHaveLength(0);
  });

  it("company-scope constraint locks universally and emits broad_scope flag", () => {
    const c = constraint("C004", { layer: "company", company: "acme" });
    const r = resolveLockedInclude([c], [fundopsLedger], {});
    expect(r.locked).toHaveLength(1);
    const reason = r.reasons.find((x) => x.card_id === "C004");
    expect(reason?.broad_scope).toBe(true);
  });

  it("multi-query scope: ancestor of either query scope locks (OR semantics)", () => {
    const c = constraint("C005", { layer: "project", project: "fundops" });
    const r = resolveLockedInclude([c], [fundopsLedger, fundopsBilling], {});
    expect(r.locked).toHaveLength(1);
  });
});

describe("locked-include resolver — symbol_note strict equality (D39, ADR-0011)", () => {
  it("locks on verbatim symbol match", () => {
    const c = symbolNote("S001", ["LedgerEntry.post"]);
    const anchors: QueryAnchors = { symbols: ["LedgerEntry.post"] };
    const r = resolveLockedInclude([c], [], anchors);
    expect(r.locked.map((x) => x.id)).toEqual(["S001"]);
    expect(r.reasons[0]!.kind).toBe("symbol_note_exact");
  });

  it("does NOT lock for bare class when card anchors a member", () => {
    const c = symbolNote("S002", ["LedgerEntry.post"]);
    const anchors: QueryAnchors = { symbols: ["LedgerEntry"] };
    const r = resolveLockedInclude([c], [], anchors);
    expect(r.locked).toHaveLength(0);
  });

  it("does NOT lock for member when card anchors only the bare class", () => {
    const c = symbolNote("S003", ["LedgerEntry"]);
    const anchors: QueryAnchors = { symbols: ["LedgerEntry.post"] };
    const r = resolveLockedInclude([c], [], anchors);
    expect(r.locked).toHaveLength(0);
  });

  it("multi-anchor symbol_note locks for both class and member queries", () => {
    const c = symbolNote("S004", ["LedgerEntry", "LedgerEntry.post"]);
    const r1 = resolveLockedInclude([c], [], { symbols: ["LedgerEntry"] });
    const r2 = resolveLockedInclude([c], [], { symbols: ["LedgerEntry.post"] });
    expect(r1.locked).toHaveLength(1);
    expect(r2.locked).toHaveLength(1);
  });

  it("symbol matching is case-sensitive", () => {
    const c = symbolNote("S005", ["LedgerEntry.post"]);
    const r = resolveLockedInclude([c], [], { symbols: ["ledgerentry.post"] });
    expect(r.locked).toHaveLength(0);
  });
});

describe("locked-include resolver — both signals", () => {
  it("a card matching both scope and symbol still locks once with priority reason", () => {
    const c: Card = {
      ...symbolNote("S006", ["LedgerEntry.post"]),
      scope: {
        layer: "project",
        project: "fundops",
        source: { frontmatter: true },
      },
    };
    // symbol_note types match strictly, scope match is irrelevant for them.
    const r = resolveLockedInclude([c], [fundopsLedger], { symbols: ["LedgerEntry.post"] });
    expect(r.locked).toHaveLength(1);
  });

  it("evidence cards do not lock as primary cards", () => {
    const c = evidence("E001", []);
    const r = resolveLockedInclude([c], [fundopsLedger], {});
    expect(r.locked).toHaveLength(0);
  });

  it("returns reasons in stable order matching locked array", () => {
    const a = constraint("C100", { layer: "project", project: "fundops" });
    const b = symbolNote("S100", ["X.y"]);
    const r = resolveLockedInclude([a, b], [fundopsLedger], { symbols: ["X.y"] });
    expect(r.locked.map((c) => c.id)).toEqual(["C100", "S100"]);
    expect(r.reasons.map((x: LockReason) => x.card_id)).toEqual(["C100", "S100"]);
  });
});

describe("locked-include resolver — one-hop evidence promotion (PRD-0005 / 5b)", () => {
  it("promotes evidence covering an already-locked primary card", () => {
    const primary = constraint("C200", { layer: "project", project: "fundops" });
    const ev = evidence("E200", ["C200"]);

    const r = resolveLockedInclude([primary, ev], [fundopsLedger], {});

    expect(r.locked.map((c) => c.id)).toEqual(["C200", "E200"]);
    expect(r.reasons.find((x) => x.card_id === "E200")).toEqual({
      card_id: "E200",
      kind: "evidence_covers_locked",
      derived_from: ["C200"],
    });
  });

  it("caps promotion at two evidence cards per primary and dedupes shared evidence", () => {
    const c1 = constraint("C300", { layer: "project", project: "fundops" });
    const c2 = symbolNote("S300", ["LedgerEntry.post"]);
    const e1 = evidence("E301", ["C300", "S300"]);
    const e2 = evidence("E302", ["C300"]);
    const e3 = evidence("E303", ["C300"]);

    const r = resolveLockedInclude(
      [c1, c2, e1, e2, e3],
      [fundopsLedger],
      { symbols: ["LedgerEntry.post"] },
    );

    expect(r.locked.map((c) => c.id)).toEqual(["C300", "S300", "E301", "E302"]);
    expect(r.reasons.find((x) => x.card_id === "E301")?.derived_from).toEqual([
      "C300",
      "S300",
    ]);
  });

  it("selects promoted evidence by freshness, coverage count, then stable id", () => {
    const primary = constraint("C400", { layer: "project", project: "fundops" });
    const stale = evidence("E401", ["C400", "C999"], "needs_review");
    const verified = evidence("E402", ["C400"], "verified");
    const unverifiedBroad = evidence("E403", ["C400", "C998", "C999"], "unverified");

    const r = resolveLockedInclude(
      [primary, stale, unverifiedBroad, verified],
      [fundopsLedger],
      {},
    );

    expect(r.locked.map((c) => c.id)).toEqual(["C400", "E402", "E403"]);
  });
});
