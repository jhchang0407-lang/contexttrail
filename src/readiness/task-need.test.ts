/**
 * Deterministic task-need extractor.
 *
 * The extractor reads existing retrieval inputs (task text, query mode,
 * provided anchors, query intent) and emits stable task-need categories
 * that the pack readiness verifier and source-scoped chunk selector can
 * consume. No model dependency. No fixture-id rules.
 *
 * Need vocabulary:
 *   - exact_symbol_behavior
 *   - overview_orientation
 *   - setup_install
 *   - decision_rationale
 *   - cross_module_boundary
 *   - sibling_support
 */
import { describe, it, expect } from "vitest";
import { extractTaskNeeds, TASK_NEEDS } from "./task-need.js";

describe("extractTaskNeeds — vocabulary", () => {
  it("exposes a stable, alphabetical-friendly need vocabulary", () => {
    expect(TASK_NEEDS).toEqual([
      "exact_symbol_behavior",
      "overview_orientation",
      "setup_install",
      "decision_rationale",
      "cross_module_boundary",
      "sibling_support",
    ]);
  });
});

describe("extractTaskNeeds — exact-symbol", () => {
  it("classifies a query with a symbol anchor as exact_symbol_behavior", () => {
    const needs = extractTaskNeeds({
      task: "use Bun.Glob to walk files matching a pattern",
      query_mode: "anchored",
      query_intent: "exact_symbol",
      symbols: ["Bun.Glob"],
    });
    expect(needs).toContain("exact_symbol_behavior");
  });

  it("classifies symbols-only inputs as exact_symbol_behavior even without query_intent", () => {
    const needs = extractTaskNeeds({
      task: "what does HTMLRewriter.transform do?",
      query_mode: "anchored",
      symbols: ["HTMLRewriter"],
    });
    expect(needs).toContain("exact_symbol_behavior");
  });

  it("does not classify a broad-domain query as exact_symbol_behavior", () => {
    const needs = extractTaskNeeds({
      task: "how do I read and write files efficiently in Bun",
      query_mode: "unanchored",
      query_intent: "broad_domain",
    });
    expect(needs).not.toContain("exact_symbol_behavior");
  });
});

describe("extractTaskNeeds — setup/install", () => {
  it("classifies installation tasks as setup_install", () => {
    const needs = extractTaskNeeds({
      task: "how do I install Drizzle in a Next.js project",
      query_mode: "unanchored",
      query_intent: "broad_domain",
    });
    expect(needs).toContain("setup_install");
  });

  it("classifies 'getting started' tasks as setup_install", () => {
    const needs = extractTaskNeeds({
      task: "getting started with Hono",
      query_mode: "unanchored",
    });
    expect(needs).toContain("setup_install");
  });

  it("classifies 'configure' tasks as setup_install", () => {
    const needs = extractTaskNeeds({
      task: "configure tRPC with custom error handling",
      query_mode: "unanchored",
    });
    expect(needs).toContain("setup_install");
  });

  it("does not classify a pure exact-symbol task as setup_install", () => {
    const needs = extractTaskNeeds({
      task: "what does Bun.Glob.scan return",
      query_mode: "anchored",
      symbols: ["Bun.Glob.scan"],
    });
    expect(needs).not.toContain("setup_install");
  });
});

describe("extractTaskNeeds — overview/orientation", () => {
  it("classifies broad-domain unanchored queries as overview_orientation", () => {
    const needs = extractTaskNeeds({
      task: "how does Vitest's test runner work",
      query_mode: "unanchored",
      query_intent: "broad_domain",
    });
    expect(needs).toContain("overview_orientation");
  });

  it("classifies 'what is X' tasks as overview_orientation", () => {
    const needs = extractTaskNeeds({
      task: "what is tRPC",
      query_mode: "unanchored",
    });
    expect(needs).toContain("overview_orientation");
  });

  it("classifies 'overview' tasks as overview_orientation", () => {
    const needs = extractTaskNeeds({
      task: "give me an overview of Hono middleware",
      query_mode: "unanchored",
    });
    expect(needs).toContain("overview_orientation");
  });

  it("does not classify a tightly-anchored exact-symbol task as overview_orientation", () => {
    const needs = extractTaskNeeds({
      task: "what does Bun.Glob.scan return",
      query_mode: "anchored",
      query_intent: "exact_symbol",
      symbols: ["Bun.Glob.scan"],
    });
    expect(needs).not.toContain("overview_orientation");
  });
});

describe("extractTaskNeeds — decision/rationale", () => {
  it("classifies decision_lookup intent as decision_rationale", () => {
    const needs = extractTaskNeeds({
      task: "why does Drizzle use a query builder over an ORM",
      query_mode: "unanchored",
      query_intent: "decision_lookup",
    });
    expect(needs).toContain("decision_rationale");
  });

  it("classifies 'why' tasks as decision_rationale", () => {
    const needs = extractTaskNeeds({
      task: "why was the new router introduced in tRPC v10",
      query_mode: "unanchored",
    });
    expect(needs).toContain("decision_rationale");
  });

  it("classifies 'tradeoff' tasks as decision_rationale", () => {
    const needs = extractTaskNeeds({
      task: "what are the tradeoffs of using Bun's bundler vs esbuild",
      query_mode: "unanchored",
    });
    expect(needs).toContain("decision_rationale");
  });

  it("does not classify a plain setup task as decision_rationale", () => {
    const needs = extractTaskNeeds({
      task: "install Drizzle in a Next.js project",
      query_mode: "unanchored",
    });
    expect(needs).not.toContain("decision_rationale");
  });
});

describe("extractTaskNeeds — cross-module boundary", () => {
  it("classifies cross_module intent as cross_module_boundary", () => {
    const needs = extractTaskNeeds({
      task: "how does the auth middleware hand off to the request handler",
      query_mode: "anchored",
      query_intent: "cross_module",
    });
    expect(needs).toContain("cross_module_boundary");
  });

  it("classifies multiple files spanning different directories as cross_module_boundary", () => {
    const needs = extractTaskNeeds({
      task: "how does the request flow",
      query_mode: "anchored",
      files: ["src/auth/middleware.ts", "src/api/handler.ts"],
    });
    expect(needs).toContain("cross_module_boundary");
  });

  it("does not classify two files in the same directory as cross_module_boundary", () => {
    const needs = extractTaskNeeds({
      task: "how does the request flow",
      query_mode: "anchored",
      files: ["src/auth/login.ts", "src/auth/middleware.ts"],
    });
    expect(needs).not.toContain("cross_module_boundary");
  });

  it("does not classify a single-file query as cross_module_boundary", () => {
    const needs = extractTaskNeeds({
      task: "what does this file do",
      query_mode: "anchored",
      query_intent: "file_anchored",
      files: ["src/auth/middleware.ts"],
    });
    expect(needs).not.toContain("cross_module_boundary");
  });
});

describe("extractTaskNeeds — sibling support", () => {
  it("classifies comparison/'vs' tasks as sibling_support", () => {
    const needs = extractTaskNeeds({
      task: "compare Bun's bundler and esbuild",
      query_mode: "unanchored",
    });
    expect(needs).toContain("sibling_support");
  });

  it("classifies 'difference between' tasks as sibling_support", () => {
    const needs = extractTaskNeeds({
      task: "the difference between Drizzle and Prisma",
      query_mode: "unanchored",
    });
    expect(needs).toContain("sibling_support");
  });

  it("does not classify a pure exact-symbol task as sibling_support", () => {
    const needs = extractTaskNeeds({
      task: "what does Bun.Glob.scan return",
      query_mode: "anchored",
      query_intent: "exact_symbol",
      symbols: ["Bun.Glob.scan"],
    });
    expect(needs).not.toContain("sibling_support");
  });
});

describe("extractTaskNeeds — multi-need composition", () => {
  it("emits multiple needs when the task has multiple deterministic signals", () => {
    const needs = extractTaskNeeds({
      task: "why was setup configured this way for Drizzle",
      query_mode: "unanchored",
      query_intent: "decision_lookup",
    });
    expect(needs).toEqual(expect.arrayContaining(["setup_install", "decision_rationale"]));
  });

  it("returns an empty list when no signals fire (and never throws)", () => {
    const needs = extractTaskNeeds({
      task: "asdfqwerty",
      query_mode: "signal_empty",
    });
    expect(needs).toEqual([]);
  });
});
