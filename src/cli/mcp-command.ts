import { Command } from "commander";
import { runMcp } from "./mcp.js";
import {
  doctorMcpClient,
  installMcpClient,
  isMcpClient,
  manualMcpConfigSnippet,
  SUPPORTED_MCP_CLIENTS,
  type McpClient,
} from "../mcp/install.js";

function requireMcpClient(client: string, command = "contexttrail"): McpClient {
  if (isMcpClient(client)) return client;
  console.error(`contexttrail mcp: unsupported MCP client "${client}"`);
  console.error(`Supported clients: ${SUPPORTED_MCP_CLIENTS.join(", ")}`);
  console.error("If your client supports JSON MCP config, add this manually:");
  console.error(manualMcpConfigSnippet(command));
  process.exit(2);
}

export function registerMcpCommands(program: Command): void {
  const mcpCmd = program
    .command("mcp")
    .description("Start the MCP server over stdio, or manage MCP installation")
    .action(async () => {
      await runMcp();
    });

  mcpCmd
    .command("install")
    .description("Install ContextTrail into a user-level MCP client config")
    .requiredOption(
      "--client <client>",
      `MCP client: ${SUPPORTED_MCP_CLIENTS.join(", ")}`,
    )
    .option("--command <command>", "command for the MCP client to run", "contexttrail")
    .option("--dry-run", "preview the config change without writing")
    .option("--json", "emit structured JSON instead of plain text")
    .action(
      (
        opts: {
          client: McpClient;
          command?: string;
          dryRun?: boolean;
          json?: boolean;
        },
      ) => {
        const client = requireMcpClient(opts.client, opts.command);
        const result = installMcpClient({
          client,
          command: opts.command,
          dryRun: opts.dryRun,
        });
        if (opts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
          return;
        }
        const verb = result.dry_run ? "would update" : result.changed ? "updated" : "already configured";
        console.log(`contexttrail mcp install: ${verb} ${result.config_path}`);
      },
    );

  mcpCmd
    .command("doctor")
    .description("Check ContextTrail MCP installation for a client")
    .requiredOption(
      "--client <client>",
      `MCP client: ${SUPPORTED_MCP_CLIENTS.join(", ")}`,
    )
    .option("--json", "emit structured JSON instead of plain text")
    .action((opts: { client: McpClient; json?: boolean }) => {
      const client = requireMcpClient(opts.client);
      const result = doctorMcpClient({ client });
      if (opts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        return;
      }
      console.log(
        `contexttrail mcp doctor: ${result.client} ${result.installed ? "installed" : "not installed"}`,
      );
      for (const hint of result.hints) console.log(`  hint: ${hint}`);
    });
}
