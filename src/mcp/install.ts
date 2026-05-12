import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

export type McpClient =
  | "codex"
  | "claude-code"
  | "claude-desktop"
  | "cursor"
  | "opencode";

export const SUPPORTED_MCP_CLIENTS = [
  "codex",
  "claude-code",
  "claude-desktop",
  "cursor",
  "opencode",
] as const satisfies readonly McpClient[];

export type McpInstallOptions = {
  client: McpClient;
  home?: string;
  command?: string;
  dryRun?: boolean;
};

export type McpInstallResult = {
  client: McpClient;
  config_path: string;
  changed: boolean;
  created: boolean;
  dry_run: boolean;
  server_name: "contexttrail";
};

export type McpDoctorOptions = {
  client: McpClient;
  home?: string;
};

export type McpDoctorResult = {
  client: McpClient;
  config_path: string;
  installed: boolean;
  command?: string;
  command_resolved: boolean;
  hints: string[];
};

export function isMcpClient(value: string): value is McpClient {
  return SUPPORTED_MCP_CLIENTS.includes(value as McpClient);
}

export function manualMcpConfigSnippet(command = "contexttrail"): string {
  return JSON.stringify(
    {
      mcpServers: {
        contexttrail: {
          command,
          args: ["mcp"],
        },
      },
    },
    null,
    2,
  );
}

export function installMcpClient(
  opts: McpInstallOptions,
): McpInstallResult {
  const home = opts.home ?? process.env.HOME;
  if (!home) throw new Error("HOME is not set");
  const command = opts.command ?? "contexttrail";
  const configPath = configPathForClient(opts.client, home);
  const existedBefore = existsSync(configPath);
  const before = existedBefore ? readFileSync(configPath, "utf8") : "";
  const after = upsertDriftledgerEntry(opts.client, before, command);
  const changed = after !== before;

  if (changed && !opts.dryRun) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, after, "utf8");
  }

  return {
    client: opts.client,
    config_path: configPath,
    changed,
    created: !existedBefore,
    dry_run: opts.dryRun ?? false,
    server_name: "contexttrail",
  };
}

export function doctorMcpClient(opts: McpDoctorOptions): McpDoctorResult {
  const home = opts.home ?? process.env.HOME;
  if (!home) throw new Error("HOME is not set");
  const configPath = configPathForClient(opts.client, home);
  if (!existsSync(configPath)) {
    return {
      client: opts.client,
      config_path: configPath,
      installed: false,
      command_resolved: false,
      hints: [`No ${opts.client} MCP config found at ${configPath}. Run contexttrail mcp install --client ${opts.client}.`],
    };
  }
  const source = readFileSync(configPath, "utf8");
  const command = readDriftledgerCommand(opts.client, source);
  if (!command) {
    return {
      client: opts.client,
      config_path: configPath,
      installed: false,
      command_resolved: false,
      hints: [`No ContextTrail MCP server entry found. Run contexttrail mcp install --client ${opts.client}.`],
    };
  }
  const commandResolved = commandExists(command);
  return {
    client: opts.client,
    config_path: configPath,
    installed: true,
    command,
    command_resolved: commandResolved,
    hints: commandResolved
      ? []
      : [`Configured command "${command}" was not found on PATH. Install ContextTrail globally or rerun install with --command <path>.`],
  };
}

function configPathForClient(client: McpClient, home: string): string {
  if (client === "codex") return join(home, ".codex/config.toml");
  if (client === "claude-code") return join(home, ".claude.json");
  if (client === "cursor") return join(home, ".cursor/mcp.json");
  if (client === "opencode") {
    return join(home, ".config/opencode/opencode.json");
  }
  if (client === "claude-desktop") {
    return join(
      home,
      "Library/Application Support/Claude/claude_desktop_config.json",
    );
  }
  const exhaustive: never = client;
  throw new Error(`unsupported MCP client: ${exhaustive}`);
}

function upsertDriftledgerEntry(
  client: McpClient,
  source: string,
  command: string,
): string {
  if (client === "codex") return upsertCodexDriftledgerBlock(source, command);
  if (client === "opencode") return upsertOpenCodeContextTrailEntry(source, command);
  return upsertJsonDriftledgerEntry(source, command);
}

function upsertCodexDriftledgerBlock(source: string, command: string): string {
  const block = [
    "[mcp_servers.contexttrail]",
    `command = ${quoteTomlString(command)}`,
    'args = ["mcp"]',
    "",
  ].join("\n");
  const normalized = source.trimEnd();
  if (!normalized) return block;

  const pattern =
    /(?:^|\n)\[mcp_servers\.contexttrail\]\n(?:[^\n]*\n?)*?(?=\n\[|$)/m;
  if (pattern.test(normalized)) {
    return `${normalized.replace(pattern, `\n${block.trimEnd()}`)}\n`;
  }
  return `${normalized}\n\n${block}`;
}

function quoteTomlString(value: string): string {
  return JSON.stringify(value);
}

function upsertJsonDriftledgerEntry(source: string, command: string): string {
  const parsed = source.trim() ? JSON.parse(source) : {};
  const root = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  const existingServers = root["mcpServers"];
  const mcpServers =
    existingServers && typeof existingServers === "object" && !Array.isArray(existingServers)
      ? existingServers as Record<string, unknown>
      : {};
  root["mcpServers"] = {
    ...mcpServers,
    contexttrail: { command, args: ["mcp"] },
  };
  return JSON.stringify(root, null, 2) + "\n";
}

function upsertOpenCodeContextTrailEntry(
  source: string,
  command: string,
): string {
  const parsed = source.trim() ? JSON.parse(source) : {};
  const root = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  const existingMcp = root["mcp"];
  const mcp =
    existingMcp && typeof existingMcp === "object" && !Array.isArray(existingMcp)
      ? existingMcp as Record<string, unknown>
      : {};
  root["$schema"] = typeof root["$schema"] === "string"
    ? root["$schema"]
    : "https://opencode.ai/config.json";
  root["mcp"] = {
    ...mcp,
    contexttrail: {
      type: "local",
      command: [command, "mcp"],
    },
  };
  return JSON.stringify(root, null, 2) + "\n";
}

function readDriftledgerCommand(
  client: McpClient,
  source: string,
): string | undefined {
  if (client === "codex") return readCodexDriftledgerCommand(source);
  if (client === "opencode") return readOpenCodeContextTrailCommand(source);
  return readJsonDriftledgerCommand(source);
}

function readCodexDriftledgerCommand(source: string): string | undefined {
  const match = source.match(
    /(?:^|\n)\[mcp_servers\.contexttrail\]\n([\s\S]*?)(?=\n\[|$)/m,
  );
  if (!match) return undefined;
  const body = match[1] ?? "";
  const command = body.match(/^\s*command\s*=\s*"([^"]+)"/m);
  return command?.[1];
}

function readJsonDriftledgerCommand(source: string): string | undefined {
  const parsed = JSON.parse(source);
  const servers = parsed?.mcpServers;
  const entry = servers?.contexttrail;
  return typeof entry?.command === "string" ? entry.command : undefined;
}

function readOpenCodeContextTrailCommand(source: string): string | undefined {
  const parsed = JSON.parse(source);
  const entry = parsed?.mcp?.contexttrail;
  const command = entry?.command;
  if (Array.isArray(command) && typeof command[0] === "string") {
    return command[0];
  }
  return undefined;
}

function commandExists(command: string): boolean {
  if (command.includes("/") || isAbsolute(command)) {
    return isExecutable(command);
  }
  const path = process.env.PATH ?? "";
  return path.split(":").some((dir) => isExecutable(join(dir, command)));
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
