/**
 * THO-250 (PRD-0033 / 33.2) — setup probe set tests.
 *
 * Probes are corpus-independent — no ContextTrail-specific paths, scopes,
 * or keywords. The stability test asserts that runProbes is itself
 * deterministic: probes are processed in a fixed order, results carry
 * through unchanged, and re-running yields the identical row sequence.
 */
import { describe, expect, it } from "vitest";
import { SETUP_PROBES, runProbes, type ProbeResult } from "./probes.js";

const FORBIDDEN_TERMS = [
  "contexttrail",
  "drift ",
  ".contexttrail",
  "ledger",
  "card",
  "constraint",
  "symbol_note",
  "fundops",
];

describe("SETUP_PROBES constant", () => {
  it("contains exactly the six probes named in PRD-0033", () => {
    expect(SETUP_PROBES).toHaveLength(6);
    expect(SETUP_PROBES.map((p) => p.id)).toEqual([
      "project_overview",
      "configuration_options",
      "test_setup",
      "build_deployment",
      "architecture_decisions",
      "primary_contributors",
    ]);
  });

  it("is frozen so callers cannot mutate the probe set at runtime", () => {
    expect(Object.isFrozen(SETUP_PROBES)).toBe(true);
    for (const p of SETUP_PROBES) {
      expect(Object.isFrozen(p)).toBe(true);
    }
  });

  it("flags exactly one probe (primary_contributors) as the signal_empty negative test", () => {
    const flagged = SETUP_PROBES.filter((p) => p.signal_empty);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.id).toBe("primary_contributors");
  });

  it("uses corpus-independent task strings (no ContextTrail-specific terminology)", () => {
    for (const p of SETUP_PROBES) {
      const lower = p.task.toLowerCase();
      for (const forbidden of FORBIDDEN_TERMS) {
        expect(lower).not.toContain(forbidden);
      }
    }
  });

  it("uses corpus-independent task strings (no anchored paths or scope tags)", () => {
    for (const p of SETUP_PROBES) {
      // No file path separators / extensions / scope-prefixed strings
      expect(p.task).not.toMatch(/[\\/]/);
      expect(p.task).not.toMatch(/\.(md|ts|js|py|go|rs)/);
      expect(p.task).not.toMatch(/^(project|team|module|company|decision):/);
    }
  });

  it("includes a rationale on every probe", () => {
    for (const p of SETUP_PROBES) {
      expect(p.rationale.length).toBeGreaterThan(0);
    }
  });
});

describe("runProbes", () => {
  it("invokes the retriever once per probe in SETUP_PROBES order", async () => {
    const called: string[] = [];
    const results = await runProbes(async (task: string) => {
      called.push(task);
      return { coverage_confidence: "confident" as const };
    });
    expect(called).toEqual(SETUP_PROBES.map((p) => p.task));
    expect(results.map((r) => r.id)).toEqual(SETUP_PROBES.map((p) => p.id));
  });

  it("propagates each retriever's coverage_confidence into the matching probe result", async () => {
    // Distinct coverage_confidence per probe so we can verify pass-through.
    const plan: Record<string, "confident" | "uncertain" | "empty"> = {
      project_overview: "confident",
      configuration_options: "uncertain",
      test_setup: "confident",
      build_deployment: "empty",
      architecture_decisions: "uncertain",
      primary_contributors: "empty",
    };
    const lookup = new Map(SETUP_PROBES.map((p) => [p.task, plan[p.id]!]));
    const results = await runProbes(async (task: string) => ({
      coverage_confidence: lookup.get(task)!,
    }));
    for (const r of results) {
      expect(r.coverage_confidence).toBe(plan[r.id]!);
    }
  });

  it("marks the primary_contributors result with signal_empty=true and the rest false", async () => {
    const results = await runProbes(async () => ({
      coverage_confidence: "confident" as const,
    }));
    for (const r of results) {
      expect(r.signal_empty).toBe(r.id === "primary_contributors");
    }
  });

  it("is deterministic — three sequential runs against an identical retriever produce identical results", async () => {
    // Same deterministic retriever; assert row-for-row equality.
    const retriever = async (task: string) => ({
      coverage_confidence: (task.length % 2 === 0
        ? "confident"
        : task.length % 3 === 0
          ? "uncertain"
          : "empty") as "confident" | "uncertain" | "empty",
    });
    const a = await runProbes(retriever);
    const b = await runProbes(retriever);
    const c = await runProbes(retriever);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("returns ProbeResult rows with the documented evidence shape", async () => {
    const results = await runProbes(async () => ({
      coverage_confidence: "uncertain" as const,
    }));
    for (const r of results) {
      const expected: ProbeResult = {
        id: r.id,
        task: r.task,
        coverage_confidence: "uncertain",
        signal_empty: r.id === "primary_contributors",
        rationale: r.rationale,
      };
      expect(r).toEqual(expected);
    }
  });
});
