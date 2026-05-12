import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI_ENTRY = join(REPO_ROOT, "src/cli/main.ts");

function runCli(home: string, args: string[]): string {
  return execFileSync("npx", ["tsx", CLI_ENTRY, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, HOME: home, NO_COLOR: "1" },
  });
}

function runCliFailure(home: string, args: string[]): {
  status: number | null;
  stderr: string;
  stdout: string;
} {
  const result = spawnSync("npx", ["tsx", CLI_ENTRY, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, HOME: home, NO_COLOR: "1" },
  });
  expect(result.status).not.toBe(0);
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

describe("contexttrail mcp install", () => {
  it("writes Codex user-level MCP config without touching real HOME", () => {
    const home = mkdtempSync(join(tmpdir(), "contexttrail-mcp-install-"));
    try {
      const out = runCli(home, ["mcp", "install", "--client", "codex", "--json"]);
      const parsed = JSON.parse(out);
      const configPath = join(home, ".codex/config.toml");

      expect(parsed).toMatchObject({
        client: "codex",
        config_path: configPath,
        changed: true,
        dry_run: false,
      });
      expect(existsSync(configPath)).toBe(true);
      expect(readFileSync(configPath, "utf8")).toContain(
        "[mcp_servers.contexttrail]",
      );
      expect(readFileSync(configPath, "utf8")).toContain('command = "contexttrail"');
      expect(readFileSync(configPath, "utf8")).toContain('args = ["mcp"]');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);

  it("is idempotent and preserves unrelated Codex MCP servers", () => {
    const home = mkdtempSync(join(tmpdir(), "contexttrail-mcp-install-"));
    try {
      const configPath = join(home, ".codex/config.toml");
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(
        configPath,
        [
          "[mcp_servers.other]",
          'command = "other-tool"',
          'args = ["mcp"]',
          "",
        ].join("\n"),
        "utf8",
      );

      const first = JSON.parse(
        runCli(home, ["mcp", "install", "--client", "codex", "--json"]),
      );
      const afterFirst = readFileSync(configPath, "utf8");
      const second = JSON.parse(
        runCli(home, ["mcp", "install", "--client", "codex", "--json"]),
      );

      expect(first.changed).toBe(true);
      expect(second.changed).toBe(false);
      expect(readFileSync(configPath, "utf8")).toBe(afterFirst);
      expect(afterFirst).toContain("[mcp_servers.other]");
      expect(afterFirst).toContain('command = "other-tool"');
      expect(afterFirst.match(/\[mcp_servers\.contexttrail\]/g)).toHaveLength(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);

  it("previews Codex install with --dry-run without writing config", () => {
    const home = mkdtempSync(join(tmpdir(), "contexttrail-mcp-install-"));
    try {
      const configPath = join(home, ".codex/config.toml");
      const parsed = JSON.parse(
        runCli(home, [
          "mcp",
          "install",
          "--client",
          "codex",
          "--dry-run",
          "--json",
        ]),
      );

      expect(parsed).toMatchObject({
        client: "codex",
        config_path: configPath,
        changed: true,
        dry_run: true,
      });
      expect(existsSync(configPath)).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);

  it.each([
    {
      client: "claude-code",
      path: ".claude.json",
    },
    {
      client: "cursor",
      path: ".cursor/mcp.json",
    },
    {
      client: "claude-desktop",
      path: "Library/Application Support/Claude/claude_desktop_config.json",
    },
  ])("writes %s user-level JSON MCP config", ({ client, path }) => {
    const home = mkdtempSync(join(tmpdir(), "contexttrail-mcp-install-"));
    try {
      const configPath = join(home, path);
      const parsed = JSON.parse(
        runCli(home, ["mcp", "install", "--client", client, "--json"]),
      );
      const config = JSON.parse(readFileSync(configPath, "utf8"));

      expect(parsed).toMatchObject({
        client,
        config_path: configPath,
        changed: true,
      });
      expect(config.mcpServers.contexttrail).toEqual({
        command: "contexttrail",
        args: ["mcp"],
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);

  it("writes OpenCode user-level MCP config", () => {
    const home = mkdtempSync(join(tmpdir(), "contexttrail-mcp-install-"));
    try {
      const configPath = join(home, ".config/opencode/opencode.json");
      const parsed = JSON.parse(
        runCli(home, ["mcp", "install", "--client", "opencode", "--json"]),
      );
      const config = JSON.parse(readFileSync(configPath, "utf8"));

      expect(parsed).toMatchObject({
        client: "opencode",
        config_path: configPath,
        changed: true,
      });
      expect(config).toMatchObject({
        $schema: "https://opencode.ai/config.json",
        mcp: {
          contexttrail: {
            type: "local",
            command: ["contexttrail", "mcp"],
          },
        },
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);

  it("preserves unrelated OpenCode MCP servers", () => {
    const home = mkdtempSync(join(tmpdir(), "contexttrail-mcp-install-"));
    try {
      const configPath = join(home, ".config/opencode/opencode.json");
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(
        configPath,
        JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            mcp: {
              existing: {
                type: "local",
                command: ["existing-tool"],
              },
            },
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      runCli(home, ["mcp", "install", "--client", "opencode", "--json"]);
      const config = JSON.parse(readFileSync(configPath, "utf8"));

      expect(config.mcp.existing).toEqual({
        type: "local",
        command: ["existing-tool"],
      });
      expect(config.mcp.contexttrail).toEqual({
        type: "local",
        command: ["contexttrail", "mcp"],
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails safely for unsupported MCP clients with a manual config snippet", () => {
    const home = mkdtempSync(join(tmpdir(), "contexttrail-mcp-install-"));
    try {
      const result = runCliFailure(home, [
        "mcp",
        "install",
        "--client",
        "zed",
      ]);

      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/unsupported MCP client/i);
      expect(result.stderr).toMatch(/codex/);
      expect(result.stderr).toMatch(/claude-code/);
      expect(result.stderr).toMatch(/cursor/);
      expect(result.stderr).toMatch(/opencode/);
      expect(result.stderr).toContain('"contexttrail"');
      expect(result.stderr).toContain('"command": "contexttrail"');
      expect(result.stderr).toContain('"args": [');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("contexttrail mcp doctor", () => {
  it("reports installed Codex config and command availability", () => {
    const home = mkdtempSync(join(tmpdir(), "contexttrail-mcp-doctor-"));
    try {
      runCli(home, [
        "mcp",
        "install",
        "--client",
        "codex",
        "--command",
        "node",
        "--json",
      ]);

      const parsed = JSON.parse(
        runCli(home, ["mcp", "doctor", "--client", "codex", "--json"]),
      );

      expect(parsed).toMatchObject({
        client: "codex",
        installed: true,
        command: "node",
        command_resolved: true,
      });
      expect(parsed.hints).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);

  it("reports installed OpenCode config and command availability", () => {
    const home = mkdtempSync(join(tmpdir(), "contexttrail-mcp-doctor-"));
    try {
      runCli(home, [
        "mcp",
        "install",
        "--client",
        "opencode",
        "--command",
        "node",
        "--json",
      ]);

      const parsed = JSON.parse(
        runCli(home, ["mcp", "doctor", "--client", "opencode", "--json"]),
      );

      expect(parsed).toMatchObject({
        client: "opencode",
        installed: true,
        command: "node",
        command_resolved: true,
      });
      expect(parsed.hints).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);

  it("reports a broken Codex command with an actionable hint", () => {
    const home = mkdtempSync(join(tmpdir(), "contexttrail-mcp-doctor-"));
    try {
      runCli(home, [
        "mcp",
        "install",
        "--client",
        "codex",
        "--command",
        "definitely-not-contexttrail",
        "--json",
      ]);

      const parsed = JSON.parse(
        runCli(home, ["mcp", "doctor", "--client", "codex", "--json"]),
      );

      expect(parsed).toMatchObject({
        client: "codex",
        installed: true,
        command: "definitely-not-contexttrail",
        command_resolved: false,
      });
      expect(parsed.hints.join("\n")).toMatch(/not found on PATH/i);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);
});
