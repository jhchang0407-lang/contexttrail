import { Command } from "commander";
import { runUiServer } from "../ui/server.js";

export function registerUiCommand(program: Command): void {
  program
    .command("ui")
    .description("Start the local ContextTrail setup UI")
    .option("--host <host>", "host to bind", "127.0.0.1")
    .option("--port <port>", "preferred port", (value: string) => Number.parseInt(value, 10), 4317)
    .action(async (opts: { host: string; port: number }) => {
      await runUiServer({
        cwd: process.cwd(),
        host: opts.host,
        port: Number.isFinite(opts.port) ? opts.port : 4317,
      });
    });
}
