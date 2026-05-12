import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildWildLogEntry, isWildLogEnabled, logWildQuery, wildLogPath } from "./wild-log.js";

describe("wild-log", () => {
  const original = { ...process.env };
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "contexttrail-wild-log-"));
    delete process.env.CONTEXTTRAIL_WILD_LOG;
    delete process.env.CONTEXTTRAIL_SESSION_TAG;
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    process.env = { ...original };
  });

  it("is off by default", () => {
    expect(isWildLogEnabled()).toBe(false);
  });

  it("recognizes truthy values", () => {
    for (const value of ["1", "true", "yes", "on", "TRUE", "True"]) {
      process.env.CONTEXTTRAIL_WILD_LOG = value;
      expect(isWildLogEnabled()).toBe(true);
    }
    for (const value of ["0", "false", "no", "off", ""]) {
      process.env.CONTEXTTRAIL_WILD_LOG = value;
      expect(isWildLogEnabled()).toBe(false);
    }
  });

  it("does not write when disabled", () => {
    const entry = buildWildLogEntry(
      { task: "hello" },
      { query_mode: "anchored", ranked: [], locked: [], warnings: [], budget: { used: 0 } },
    );
    logWildQuery(cwd, entry);
    expect(existsSync(wildLogPath(cwd))).toBe(false);
  });

  it("appends JSONL when enabled", () => {
    process.env.CONTEXTTRAIL_WILD_LOG = "1";
    const entry = buildWildLogEntry(
      { task: "implement refunds", files: ["src/payments/refund.ts"] },
      {
        query_mode: "anchored",
        ranked: [{ kind: "chunk", contexttrail: "Source: docs/payments/refunds.md > Section: Refunds" }],
        locked: [{ id: "C001" }],
        warnings: [],
        budget: { used: 1234 },
      },
    );
    logWildQuery(cwd, entry);
    logWildQuery(cwd, entry);
    const contents = readFileSync(wildLogPath(cwd), "utf8");
    const lines = contents.trim().split("\n");
    expect(lines).toHaveLength(2);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.task).toBe("implement refunds");
    expect(parsed.files).toEqual(["src/payments/refund.ts"]);
    expect(parsed.query_mode).toBe("anchored");
    expect(parsed.ranked_count).toBe(1);
    expect(parsed.locked_count).toBe(1);
    expect(parsed.packTokensUsed).toBe(1234);
    expect(parsed.top1).toContain("docs/payments/refunds.md");
  });

  it("includes session tag when set", () => {
    process.env.CONTEXTTRAIL_WILD_LOG = "1";
    process.env.CONTEXTTRAIL_SESSION_TAG = "ralph-add-feature";
    const entry = buildWildLogEntry(
      { task: "x" },
      { query_mode: "unanchored", ranked: [], locked: [], warnings: [], budget: { used: 0 } },
    );
    expect(entry.session_tag).toBe("ralph-add-feature");
    logWildQuery(cwd, entry);
    const parsed = JSON.parse(readFileSync(wildLogPath(cwd), "utf8").trim());
    expect(parsed.session_tag).toBe("ralph-add-feature");
  });

  it("captures warning kinds", () => {
    process.env.CONTEXTTRAIL_WILD_LOG = "1";
    const entry = buildWildLogEntry(
      { task: "x" },
      {
        query_mode: "signal_empty",
        ranked: [],
        locked: [],
        warnings: [{ kind: "no_matches" }, { kind: "anchors_unrecognized" }],
        budget: { used: 0 },
      },
    );
    expect(entry.warning_kinds).toEqual(["no_matches", "anchors_unrecognized"]);
  });
});
