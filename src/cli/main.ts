#!/usr/bin/env node
import { Command } from "commander";
import { init } from "../config/init.js";
import { runImport } from "./import.js";
import { runIndex, formatIndexSummary } from "./index-cmd.js";
import { listScopeReport, renderScopeReport } from "./scope-inspect.js";
import { runContext } from "./context.js";
import { runCardImport } from "./card-import.js";
import { runCardBootstrap } from "./card-bootstrap.js";
import { runVerify } from "./verify.js";
import { runMcp } from "./mcp.js";
import {
  doctorMcpClient,
  installMcpClient,
  isMcpClient,
  manualMcpConfigSnippet,
  SUPPORTED_MCP_CLIENTS,
  type McpClient,
} from "../mcp/install.js";
import { migrateFlatToSubstrate, MigrationGateError } from "../store/migrate.js";
import { openDb, closeDb } from "../store/db.js";
import { join as joinPath } from "node:path";
import {
  runCardAdd,
  runCardList,
  renderCardList,
  runCardShow,
  renderCardShow,
  runCardVerify,
  runCardMarkNeedsReview,
  runCardLink,
  runCardUnlink,
  runCardSuggest,
} from "./card-cmds.js";
import {
  runInboxAccept,
  runInboxAnswer,
  renderInboxList,
  renderInboxShow,
  runInboxList,
  runInboxShow,
} from "./inbox-cmds.js";
import { createHandlers } from "../mcp/handlers.js";
import { renderSetupReadiness } from "../setup/render.js";
import {
  SetupQuestionAnswerError,
  renderSetupQuestions,
} from "../setup/questions.js";
import {
  answerCurrentSetupQuestion,
  runSetupConversation,
  setupReadinessOutput,
} from "../setup/conversation.js";
import {
  renderSetupQuickstart,
  runSetupQuickstart,
} from "../setup/quickstart.js";
import { renderLedgerSync, runLedgerSync } from "../sync/ledger-sync.js";
import type { CardType } from "../types/card.js";

const program = new Command();
program
  .name("contexttrail")
  .description("ContextTrail — context engine for AI software work")
  .version("0.1.0");

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

const setupCmd = program
  .command("setup")
  .description(
    "Scan repo readiness across the four dimensions and suggest the next step",
  )
  .option("--json", "emit structured JSON instead of plain text")
  .option(
    "--explain",
    "include per-dimension evidence and per-probe rationale",
  )
  .action(async (opts: { json?: boolean; explain?: boolean }) => {
    const cwd = process.cwd();
    const conversation = await runSetupConversation(cwd, createSetupProbeRetriever(cwd));
    if (opts.json) {
      // Match the MCP get_setup_readiness output shape so CLI --json and the
      // MCP tool are byte-equivalent for any given cwd.
      const json = setupReadinessOutput(conversation.readiness);
      process.stdout.write(JSON.stringify(json, null, 2) + "\n");
      return;
    }
    process.stdout.write(
      renderSetupReadiness({
        report: conversation.readiness.report,
        suggestion: conversation.readiness.suggestion,
        explain: opts.explain ?? false,
      }),
    );
  });

setupCmd
  .command("quickstart")
  .description("Initialize, import obvious docs, and show setup questions")
  .option(
    "--bootstrap-candidates",
    "draft candidate Cards into the review inbox after importing docs",
  )
  .option("--json", "emit structured JSON instead of plain text")
  .action(async function (
    this: Command,
    opts: { bootstrapCandidates?: boolean },
  ) {
    const result = await runSetupQuickstart(process.cwd(), {
      bootstrapCandidates: opts.bootstrapCandidates ?? false,
    });
    if (this.opts().json || this.parent?.opts().json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return;
    }
    process.stdout.write(renderSetupQuickstart(result));
  });

setupCmd
  .command("questions")
  .description("Show the highest-leverage setup questions for this repo")
  .option("--json", "emit structured JSON instead of plain text")
  .action(async function (this: Command) {
    const cwd = process.cwd();
    const { plan } = await runSetupConversation(cwd, createSetupProbeRetriever(cwd));
    if (this.opts().json || this.parent?.opts().json) {
      process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
      return;
    }
    process.stdout.write(renderSetupQuestions(plan));
  });

setupCmd
  .command("answer")
  .description("Answer a setup question and preview the resulting setup action")
  .argument("<question-id>", "setup question id from `contexttrail setup questions`")
  .option("--choice <choiceId>", "choose one offered setup answer")
  .option("--text <answer>", "provide a free-text setup answer")
  .option("--json", "emit structured JSON instead of plain text")
  .action(
    async function (
      this: Command,
      questionId: string,
      opts: { choice?: string; text?: string },
    ) {
      const cwd = process.cwd();
      try {
        const result = await answerCurrentSetupQuestion(cwd, createSetupProbeRetriever(cwd), {
          question_id: questionId,
          choice_id: opts.choice,
          free_text: opts.text,
        });
        if (this.opts().json || this.parent?.opts().json) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
          return;
        }
        console.log(`Setup answer: ${result.question_id}`);
        if (result.action.type === "command_preview") {
          console.log(`Preview: ${result.action.command}`);
        } else {
          console.log(`Inbox answer applied: ${result.action.review_item_id}`);
        }
        console.log(result.action.message);
      } catch (err) {
        if (err instanceof SetupQuestionAnswerError) {
          console.error(`contexttrail setup answer: ${err.message}`);
          process.exit(2);
        }
        throw err;
      }
    },
  );

program
  .command("import")
  .description("Import markdown sources matching the given glob(s)")
  .argument("<patterns...>", "glob patterns, e.g. docs/**/*.md")
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
  .description("Refresh ContextTrail cache, hidden Cards, and freshness for this repo")
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
  .description("Inspect resolved scope and code anchors per chunk")
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
  .description(
    "Run the flat → substrate migration (gated by ADR-0009 invariants)",
  )
  .option(
    "--gate-passed",
    "attest that round-trip + identical-pack invariant tests passed on the fixture",
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

function requireMcpClient(client: string, command = "contexttrail"): McpClient {
  if (isMcpClient(client)) return client;
  console.error(`contexttrail mcp: unsupported MCP client "${client}"`);
  console.error(`Supported clients: ${SUPPORTED_MCP_CLIENTS.join(", ")}`);
  console.error("If your client supports JSON MCP config, add this manually:");
  console.error(manualMcpConfigSnippet(command));
  process.exit(2);
}

function createSetupProbeRetriever(cwd: string) {
  const handlers = createHandlers({ cwd });
  return async (task: string) => {
    const pack = await handlers.retrieve_context_pack({ task });
    return { coverage_confidence: pack.coverage_confidence };
  };
}

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

const inboxCmd = program
  .command("inbox")
  .description("Inspect week-6 review items stored in .contexttrail/inbox/");

inboxCmd
  .command("list")
  .description("List inbox review items with optional filters and a count summary")
  .option(
    "--limit <n>",
    "Max items to display (default 20)",
    (v: string) => Number.parseInt(v, 10),
  )
  .option(
    "--type <reviewType>",
    "Filter by review type: candidate_card | clarification_need",
  )
  .option(
    "--status <status>",
    "Filter by status: pending | accepted | rejected | answered",
  )
  .action((opts: { limit?: number; type?: string; status?: string }) => {
    if (opts.type && opts.type !== "candidate_card" && opts.type !== "clarification_need") {
      console.error(
        `contexttrail inbox list: --type must be candidate_card or clarification_need (got ${opts.type})`,
      );
      process.exit(2);
    }
    if (
      opts.status &&
      !["pending", "accepted", "rejected", "answered"].includes(opts.status)
    ) {
      console.error(
        `contexttrail inbox list: --status must be pending|accepted|rejected|answered (got ${opts.status})`,
      );
      process.exit(2);
    }
    if (opts.limit !== undefined && (!Number.isFinite(opts.limit) || opts.limit <= 0)) {
      console.error(`contexttrail inbox list: --limit must be a positive integer`);
      process.exit(2);
    }
    process.stdout.write(
      renderInboxList(
        runInboxList(process.cwd(), {
          limit: opts.limit,
          type: opts.type as "candidate_card" | "clarification_need" | undefined,
          status: opts.status as
            | "pending"
            | "accepted"
            | "rejected"
            | "answered"
            | undefined,
        }),
      ),
    );
  });

inboxCmd
  .command("show <id>")
  .description("Show a single inbox review item")
  .action((id: string) => {
    const item = runInboxShow(process.cwd(), id);
    if (!item) {
      console.error(`contexttrail inbox show: no review item with id ${id}`);
      process.exit(1);
    }
    process.stdout.write(renderInboxShow(item));
  });

inboxCmd
  .command("accept <id>")
  .description("Accept a candidate-card inbox item into .contexttrail/cards/")
  .action((id: string) => {
    const accepted = runInboxAccept(process.cwd(), id);
    if (!accepted) {
      console.error(`contexttrail inbox accept: no candidate review item with id ${id}`);
      process.exit(1);
    }
    console.log(
      `contexttrail inbox accept: ${accepted.review_item_id} -> ${accepted.card_id} (${accepted.path})`,
    );
    console.log(
      "Accepted Card was written to .contexttrail/cards/ and imported into the cache.",
    );
  });

inboxCmd
  .command("answer <id>")
  .description("Answer a clarification review item and rewrite affected pending candidates")
  .option("--choice <choiceId>", "choose one constrained clarification option")
  .option("--text <answer>", "provide a free-text clarification answer")
  .action((id: string, opts: { choice?: string; text?: string }) => {
    if (!opts.choice && !opts.text) {
      console.error("contexttrail inbox answer: provide --choice <id> or --text <answer>");
      process.exit(2);
    }
    const answered = runInboxAnswer(process.cwd(), id, {
      choice_id: opts.choice,
      free_text: opts.text,
    });
    if (!answered) {
      console.error(`contexttrail inbox answer: could not answer clarification ${id}`);
      process.exit(1);
    }
    console.log(
      `contexttrail inbox answer: ${answered.review_item_id} updated ${answered.updated_candidate_ids.length} candidate(s)`,
    );
  });

const cardCmd = program
  .command("card")
  .description("Author and inspect Cards (constraint / symbol_note / evidence)");

cardCmd
  .command("bootstrap")
  .description("Generate candidate review items from imported docs")
  .option(
    "--llm",
    "Run LLM augmentation after regex bootstrap (PRD-0034). Requires ANTHROPIC_API_KEY.",
    false,
  )
  .action(async (cliOptions: { llm?: boolean }) => {
    const summary = await runCardBootstrap(process.cwd(), { llm: cliOptions.llm });
    console.log(
      `contexttrail card bootstrap: ${summary.constraint_candidates_written} constraint, ${summary.symbol_note_candidates_written} symbol_note, ${summary.clarification_needs_written} clarification from ${summary.chunks_considered} chunks (${summary.merged_duplicates} merged duplicates)`,
    );
    if (summary.llm_augmentation) {
      const llm = summary.llm_augmentation;
      const parts = [
        `LLM augmentation: ${llm.chunks_processed} chunk${llm.chunks_processed === 1 ? "" : "s"} processed`,
        `${llm.candidates_added} candidate${llm.candidates_added === 1 ? "" : "s"} added`,
        `${llm.clarifications_added} clarification${llm.clarifications_added === 1 ? "" : "s"} added`,
      ];
      if (llm.chunks_skipped_over_cap > 0) {
        parts.push(`${llm.chunks_skipped_over_cap} skipped over cap`);
      }
      if (llm.chunks_failed > 0) {
        parts.push(`${llm.chunks_failed} failed`);
      }
      console.log(parts.join(", "));
      for (const w of llm.warnings) {
        if (w.kind === "chunk_failed") {
          console.warn(`  warn: chunk ${w.chunk_stable_key} skipped — ${w.message}`);
        } else if (w.kind === "cap_exceeded") {
          console.warn(
            `  warn: ${w.qualifying_chunks} qualifying chunks exceeded the per-run cap of ${w.cap}; first ${w.cap} were processed`,
          );
        }
      }
    }
  });

cardCmd
  .command("add <type>")
  .description("Scaffold a new Card under .contexttrail/cards/")
  .action((type: string) => {
    if (type !== "constraint" && type !== "symbol_note" && type !== "evidence") {
      console.error("type must be one of: constraint | symbol_note | evidence");
      process.exit(2);
    }
    const r = runCardAdd(process.cwd(), type as CardType);
    console.log(`contexttrail card add: created ${r.path} (id=${r.id})`);
    console.log("Open this file in your editor, then run: contexttrail card import");
  });

cardCmd
  .command("import")
  .description("Re-import every Card under .contexttrail/cards/")
  .action(() => {
    const r = runCardImport(process.cwd());
    console.log(
      `contexttrail card import: ${r.cards_imported} imported, ${r.cards_skipped} skipped`,
    );
    for (const w of r.warnings) console.warn(`  warning: ${w}`);
  });

cardCmd
  .command("list")
  .description("List every Card with type, scope, freshness, link count")
  .option("--type <t>", "filter by type: constraint | symbol_note | evidence")
  .option("--scope <s>", "filter by scope summary substring")
  .option("--needs-review", "only Cards in needs_review state")
  .action((opts: { type?: string; scope?: string; needsReview?: boolean }) => {
    const rows = runCardList(process.cwd(), {
      type: opts.type as CardType | undefined,
      scope: opts.scope,
      needs_review: opts.needsReview,
    });
    process.stdout.write(renderCardList(rows));
  });

cardCmd
  .command("show <id>")
  .description("Show a Card's body, frontmatter, and linked-chunk contexttrails")
  .action((id: string) => {
    const r = runCardShow(process.cwd(), id);
    if (!r) {
      console.error(`contexttrail card show: no Card with id ${id}`);
      process.exit(1);
    }
    process.stdout.write(renderCardShow(r));
  });

cardCmd
  .command("verify <id>")
  .description("Flip author_review_state to verified (does not touch freshness_state)")
  .action((id: string) => {
    const ok = runCardVerify(process.cwd(), id);
    if (!ok) {
      console.error(`contexttrail card verify: no Card with id ${id}`);
      process.exit(1);
    }
    console.log(`contexttrail card verify: ${id} author_review_state -> verified`);
  });

cardCmd
  .command("mark-needs-review <id>")
  .description("Flip author_review_state to needs_review_manual")
  .action((id: string) => {
    const ok = runCardMarkNeedsReview(process.cwd(), id);
    if (!ok) {
      console.error(`contexttrail card mark-needs-review: no Card with id ${id}`);
      process.exit(1);
    }
    console.log(`contexttrail card mark-needs-review: ${id} flagged`);
  });

cardCmd
  .command("link <card> <chunk_version_id>")
  .description("Link a Card to a Doc Chunk (captures version_pin)")
  .option(
    "--type <t>",
    "evidences | mentions | covers (default: mentions)",
    "mentions",
  )
  .action(
    (
      card: string,
      chunk_version_id: string,
      opts: { type: "evidences" | "mentions" | "covers" },
    ) => {
      const ok = runCardLink(process.cwd(), card, chunk_version_id, opts.type);
      if (!ok) {
        console.error("contexttrail card link: card or chunk not found");
        process.exit(1);
      }
      console.log(`contexttrail card link: linked ${card} -> ${chunk_version_id} (${opts.type})`);
    },
  );

cardCmd
  .command("unlink <card> <chunk_version_id>")
  .description("Remove a link between a Card and a Doc Chunk")
  .option("--type <t>", "evidences | mentions | covers (default: mentions)", "mentions")
  .action(
    (
      card: string,
      chunk_version_id: string,
      opts: { type: "evidences" | "mentions" | "covers" },
    ) => {
      const ok = runCardUnlink(process.cwd(), card, chunk_version_id, opts.type);
      if (!ok) {
        console.error("contexttrail card unlink: chunk not found");
        process.exit(1);
      }
      console.log(`contexttrail card unlink: removed ${card} -> ${chunk_version_id}`);
    },
  );

cardCmd
  .command("suggest <id>")
  .description("Show top-N inline link candidates for a Card")
  .option("-n, --top <n>", "max suggestions", "5")
  .action((id: string, opts: { top: string }) => {
    const top = parseInt(opts.top, 10) || 5;
    const s = runCardSuggest(process.cwd(), id, top);
    if (s.length === 0) {
      console.log("contexttrail card suggest: no candidates");
      return;
    }
    for (const c of s) {
      console.log(
        `${c.version_id}  anchor=${c.anchor_overlap.toFixed(2)} scope=${c.scope_match.toFixed(2)}  ${c.source_path} > ${c.heading_path.join(" > ")}`,
      );
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
