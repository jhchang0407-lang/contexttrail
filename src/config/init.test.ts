import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init, DEFAULT_MCP_JSON, MCP_CONFIG_REL_PATH } from "./init.js";
import { loadConfig } from "./load.js";

function withTempCwd<T>(fn: (cwd: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "contexttrail-init-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("contexttrail init", () => {
  it("creates .contexttrail/ with config.yaml and cache/contexttrail.db", () => {
    withTempCwd((cwd) => {
      const result = init(cwd);
      expect(result.created).toBe(true);
      expect(existsSync(join(cwd, ".contexttrail/config.yaml"))).toBe(true);
      expect(existsSync(join(cwd, ".contexttrail/cache/contexttrail.db"))).toBe(true);
      expect(existsSync(join(cwd, ".contexttrail/inbox"))).toBe(true);
    });
  });

  it("is idempotent (rerun is a no-op for existing config)", () => {
    withTempCwd((cwd) => {
      init(cwd);
      const cfgPath = join(cwd, ".contexttrail/config.yaml");
      const before = readFileSync(cfgPath, "utf8");
      const second = init(cwd);
      expect(second.created).toBe(false);
      const after = readFileSync(cfgPath, "utf8");
      expect(after).toBe(before);
    });
  });

  it("does not clobber a hand-edited config", () => {
    withTempCwd((cwd) => {
      init(cwd);
      const cfgPath = join(cwd, ".contexttrail/config.yaml");
      writeFileSync(cfgPath, "version: 1\nchunking:\n  target_tokens: 250\n");
      init(cwd);
      const cfg = loadConfig(cwd);
      expect(cfg.chunking.target_tokens).toBe(250);
    });
  });

  it("rejects unsupported tokenizer encodings at config-load time", () => {
    withTempCwd((cwd) => {
      init(cwd);
      const cfgPath = join(cwd, ".contexttrail/config.yaml");
      writeFileSync(cfgPath, "version: 1\ntokenizer:\n  encoding: o200k_base\n");
      expect(() => loadConfig(cwd)).toThrow(/encoding/);
    });
  });

  // contexttrail init writes .mcp.json so a cold-start user has a wire-up
  // file for their agent. Write-only-if-absent — never clobbers.
  it("writes .mcp.json at repo root on first init with the documented shape", () => {
    withTempCwd((cwd) => {
      const result = init(cwd);
      const mcpPath = join(cwd, MCP_CONFIG_REL_PATH);
      expect(result.mcp_config_created).toBe(true);
      expect(result.mcp_config_path).toBe(mcpPath);
      expect(existsSync(mcpPath)).toBe(true);
      const parsed = JSON.parse(readFileSync(mcpPath, "utf8"));
      expect(parsed).toEqual({
        mcpServers: {
          contexttrail: { command: "contexttrail", args: ["mcp"] },
        },
      });
      expect(readFileSync(mcpPath, "utf8")).toBe(DEFAULT_MCP_JSON);
    });
  });

  it("does not clobber an existing .mcp.json (other MCP servers may be wired in)", () => {
    withTempCwd((cwd) => {
      const mcpPath = join(cwd, MCP_CONFIG_REL_PATH);
      const userBody = JSON.stringify(
        { mcpServers: { othertool: { command: "othertool" } } },
        null,
        2,
      );
      writeFileSync(mcpPath, userBody, "utf8");
      const result = init(cwd);
      expect(result.mcp_config_created).toBe(false);
      expect(readFileSync(mcpPath, "utf8")).toBe(userBody);
    });
  });

  it("loadConfig returns defaults applied for missing fields", () => {
    withTempCwd((cwd) => {
      init(cwd);
      const cfg = loadConfig(cwd);
      expect(cfg.chunking.target_tokens).toBe(500);
      expect(cfg.chunking.max_tokens).toBe(900);
      expect(cfg.chunking.overlap_tokens).toBe(0);
      expect(cfg.tokenizer.encoding).toBe("cl100k_base");
      expect(cfg.retrieval.scoring.w_bm25).toBeCloseTo(0.7);
      expect(cfg.retrieval.budgets.default).toBe(6000);
      expect(cfg.retrieval.min_final_score).toBeCloseTo(0.05);
    });
  });
});
