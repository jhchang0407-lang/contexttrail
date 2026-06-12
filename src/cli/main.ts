#!/usr/bin/env node
import { Command } from "commander";
import { createRequire } from "node:module";
import { init } from "../config/init.js";
import { runImport } from "./import.js";
import { runIndex, formatIndexSummary } from "./index-cmd.js";
import { listScopeReport, renderScopeReport } from "./scope-inspect.js";
import { runContext } from "./context.js";
import { runVerify } from "./verify.js";
import { migrateFlatToSubstrate, MigrationGateError } from "../store/migrate.js";
import { openDb, closeDb } from "../store/db.js";
import { join as joinPath } from "node:path";
import { renderLedgerSync, runLedgerSync } from "../sync/ledger-sync.js";
import { registerSetupCommands } from "./setup-command.js";
import { registerMcpCommands } from "./mcp-command.js";
import { registerInboxCommands } from "./inbox-command.js";
import { registerCardCommands } from "./card-command.js";
import { registerUiCommand } from "./ui-command.js";

const { version: packageVersion } = createRequire(import.meta.url)(
  "../../package.json",
) as { version: string };

const program = new Command();
program
  .name("contexttrail")
  .description("ContextTrail — local context engine for document-heavy agent work")
  .version(packageVersion);

program
  .command("init")
  .description("Initialize .contexttrail/ in the current directory (idempotent)")
  .action(() => {
    const r = init(process.cwd());
    if (r.created) {
      console.log(`contexttrail: created ${r.config_path}`);
    } else {
      console.log(`contexttrail: ${r.config_path} already exists (no changes)`);
    }
    console.log(`contexttrail: cache ready at ${r.cache_path}`);
    if (r.mcp_config_created) {
      console.log(
        `contexttrail: wrote ${r.mcp_config_path} (restart your agent to pick up the ContextTrail MCP server)`,
      );
    } else {
      console.log(
        `contexttrail: ${r.mcp_config_path} already exists — left untouched`,
      );
    }
    console.log("Next: run `contexttrail setup`");
  });

registerSetupCommands(program);

program
  .command("import")
  .description("Import document sources matching the given glob(s)")
  .argument("<patterns...>", "glob patterns, e.g. docs/**/*.{md,txt,docx,pdf}")
  .action((patterns: string[]) => {
    const r = runImport(process.cwd(), patterns);
    console.log(
      `contexttrail import: ${r.files_imported} files imported, ${r.files_unchanged} unchanged, ${r.chunks_written} chunks written`,
    );
    for (const w of r.warnings) console.warn(`  warning: ${w}`);
  });

program
  .command("index")
  .description("Re-scan indexed sources; tombstone chunks whose source is gone")
  .action(() => {
    const r = runIndex(process.cwd());
    console.log(`contexttrail index: ${formatIndexSummary(r)}`);
  });

program
  .command("sync")
  .description("Refresh ContextTrail cache, Agent Rules, and freshness for this workspace")
  .option("--check", "show planned sync actions without writing")
  .option(
    "--refresh-candidates",
    "also refresh provisional candidate Cards in the review inbox",
  )
  .option("--explain", "include per-action path and write details")
  .option("--json", "emit structured JSON instead of plain text")
  .action(
    async (opts: {
      check?: boolean;
      refreshCandidates?: boolean;
      explain?: boolean;
      json?: boolean;
    }) => {
      const result = await runLedgerSync(process.cwd(), {
        check: opts.check ?? false,
        refreshCandidates: opts.refreshCandidates ?? false,
      });
      if (opts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        return;
      }
      process.stdout.write(renderLedgerSync(result, { explain: opts.explain ?? false }));
    },
  );

program
  .command("scope")
  .description("Inspect resolved scope and anchors per chunk")
  .addCommand(
    new Command("inspect")
      .option("--unknown", "Only show chunks with layer=unknown")
      .action((opts: { unknown?: boolean }) => {
        const rows = listScopeReport(process.cwd(), {
          unknownOnly: !!opts.unknown,
        });
        process.stdout.write(renderScopeReport(rows));
      }),
  );

program
  .command("context")
  .description("Retrieve a Context Pack for the given task")
  .argument("<query>", "free-text task description")
  .option("--files <paths...>", "files relevant to the task (one or more)")
  .option("--symbols <symbols...>", "symbols relevant to the task")
  .option("--routes <routes...>", "routes relevant to the task")
  .option(
    "--budget <size>",
    "small | default | large (token budget)",
    "default",
  )
  .option("--json", "emit stable JSON instead of text")
  .option("--explain", "include per-chunk score breakdown")
  .action(
    (
      query: string,
      opts: {
        files?: string[];
        symbols?: string[];
        routes?: string[];
        budget?: "small" | "default" | "large";
        json?: boolean;
        explain?: boolean;
      },
    ) => {
      const r = runContext(process.cwd(), query, opts);
      if (r.json) {
        process.stdout.write(JSON.stringify(r.json, null, 2) + "\n");
      } else if (r.text) {
        process.stdout.write(r.text);
      }
    },
  );

program
  .command("migrate")
  .description("Run internal cache migrations")
  .option(
    "--gate-passed",
    "attest that cache migration invariant tests passed on the fixture",
    false,
  )
  .action((opts: { gatePassed?: boolean }) => {
    const dbPath = joinPath(process.cwd(), ".contexttrail/cache/contexttrail.db");
    const db = openDb(dbPath);
    try {
      const r = migrateFlatToSubstrate(db, { gate_passed: !!opts.gatePassed });
      console.log(
        `contexttrail migrate: ${r.context_objects_written} objects, ${r.code_anchors_v2_written} anchors, ${r.links_written} links`,
      );
    } catch (err) {
      if (err instanceof MigrationGateError) {
        console.error(`contexttrail migrate: ${err.message}`);
        console.error(
          "Run `npx vitest run src/store/migrate.test.ts` and rerun with --gate-passed.",
        );
        process.exit(2);
      }
      throw err;
    } finally {
      closeDb(db);
    }
  });

registerMcpCommands(program);
registerUiCommand(program);

program
  .command("verify")
  .description("Integrity check over the cache (orphan links, freshness drift, etc.)")
  .action(() => {
    const r = runVerify(process.cwd());
    if (r.ok) {
      console.log(
        `contexttrail verify: OK (doc_role sources checked=${r.checked.doc_role_sources})`,
      );
      return;
    }
    console.error(`contexttrail verify: ${r.failures.length} failure(s)`);
    for (const f of r.failures) {
      console.error(`  [${f.kind}] ${f.message}`);
    }
    process.exit(1);
  });

registerInboxCommands(program);
registerCardCommands(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
