import { describe, expect, it } from "vitest";
import { porter, stemmedTokenSet, tokenize } from "./tokenize.js";

describe("tokenize — basic behavior", () => {
  it("splits a simple sentence into lowercased word tokens", () => {
    expect(tokenize("hello world")).toEqual(["hello", "world"]);
  });

  it("drops common English stop words by default", () => {
    expect(tokenize("the quick brown fox jumps over a lazy dog")).not.toContain("the");
    expect(tokenize("the quick brown fox jumps over a lazy dog")).not.toContain("a");
    expect(tokenize("the quick brown fox jumps over a lazy dog")).not.toContain("over");
    // content words survive
    expect(tokenize("the quick brown fox jumps over a lazy dog")).toContain("quick");
  });

  it("keeps question words as signal (what/why/how/when)", () => {
    const out = tokenize("why does prisma need a shadow database");
    expect(out).toContain(porter("why"));
    expect(out).toContain(porter("prisma"));
    expect(out).toContain(porter("shadow"));
    expect(out).toContain(porter("database"));
    expect(out).not.toContain("a");
    expect(out).not.toContain(porter("does"));
  });
});

describe("porter — stemming", () => {
  it("collapses common verb / noun variants to a single stem", () => {
    expect(porter("deploy")).toBe(porter("deployment"));
    expect(porter("deploy")).toBe(porter("deploying"));
    expect(porter("deploy")).toBe(porter("deploys"));
    expect(porter("migrate")).toBe(porter("migration"));
    expect(porter("migrate")).toBe(porter("migrations"));
    expect(porter("migrate")).toBe(porter("migrating"));
  });

  it("is idempotent", () => {
    const w = porter("deployment");
    expect(porter(w)).toBe(w);
  });

  it("does not mangle short or already-stem-shaped words", () => {
    expect(porter("a")).toBe("a");
    expect(porter("be")).toBe("be");
    expect(porter("run")).toBe("run");
  });
});

describe("tokenize — Porter stemming wired in", () => {
  it("returns stems by default", () => {
    const out = tokenize("deploying deployments deploys");
    expect(new Set(out).size).toBe(1);
  });

  it("returns raw lowercased tokens when stem=false", () => {
    const out = tokenize("deploying deployments", { stem: false });
    expect(out).toEqual(["deploying", "deployments"]);
  });
});

describe("stemmedTokenSet", () => {
  it("returns a Set of stems suitable for membership checks", () => {
    const s = stemmedTokenSet("migrating database migration");
    expect(s.has(porter("migrate"))).toBe(true);
    expect(s.has(porter("database"))).toBe(true);
  });
});

describe("tokenize — code identifier awareness", () => {
  it("splits camelCase and keeps both parts and the whole identifier", () => {
    const s = stemmedTokenSet("normalizeTicket processes the input");
    expect(s.has(porter("normalize"))).toBe(true);
    expect(s.has(porter("ticket"))).toBe(true);
    // also keep the whole lowercased identifier so exact-match queries still bind
    expect(s.has(porter("normalizeticket"))).toBe(true);
  });

  it("splits snake_case and keeps both parts and the whole identifier", () => {
    const s = stemmedTokenSet("setup_sync runs at startup");
    expect(s.has(porter("setup"))).toBe(true);
    expect(s.has(porter("sync"))).toBe(true);
    expect(s.has(porter("setup_sync"))).toBe(true);
  });

  it("splits SCREAMING_SNAKE_CASE", () => {
    const s = stemmedTokenSet("MACHINE_BLOCK_SCHEMA validates the contract");
    expect(s.has(porter("machine"))).toBe(true);
    expect(s.has(porter("block"))).toBe(true);
    expect(s.has(porter("schema"))).toBe(true);
  });

  it("splits dotted symbol paths (e.g. RefundService.processRefund)", () => {
    const s = stemmedTokenSet("RefundService.processRefund handles the case");
    expect(s.has(porter("refund"))).toBe(true);
    expect(s.has(porter("service"))).toBe(true);
    expect(s.has(porter("process"))).toBe(true);
  });

  it("does not expand single-word lowercase tokens", () => {
    const out = tokenize("simple words", { stem: false });
    expect(out).toEqual(["simple", "words"]);
  });

  it("can be disabled via splitCodeIdentifiers=false", () => {
    const out = tokenize("normalizeTicket", { stem: false, splitCodeIdentifiers: false });
    expect(out).toEqual(["normalizeticket"]);
  });
});
