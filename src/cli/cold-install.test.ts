/**
 * End-to-end cold-install acceptance test.
 *
 * Blank tempdir → contexttrail init → contexttrail import → contexttrail card import → drift
 * context → assert Pack shape and section presence → contexttrail verify.
 * Must run in <30s in CI.
 */
import { describe, it, expect } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { init } from "../config/init.js";
import { runImport } from "./import.js";
import { runCardImport } from "./card-import.js";
import { runContext } from "./context.js";
import { runVerify } from "./verify.js";

describe("cold-install E2E", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const cliEntry = join(repoRoot, "src/cli/main.ts");

  it(
    "blank tempdir → init → import → card import → context → verify (<30s)",
    () => {
      const t0 = Date.now();
      const cwd = mkdtempSync(join(tmpdir(), "contexttrail-cold-"));
      try {
        // 1. contexttrail init
        const initResult = init(cwd);
        expect(initResult.cache_path).toContain("contexttrail.db");

        // Custom config so src/** infers fundops/payments scope.
        writeFileSync(
          join(cwd, ".contexttrail/config.yaml"),
          `version: 1
doc_scopes:
  - id: payments-docs
    pattern: "docs/payments/**/*.md"
    scope:
      layer: module
      project: fundops
      module: payments
code_scopes:
  - id: src-tree
    pattern: "src/**"
    scope:
      layer: module
      project: fundops
      module_from_path_after: src
retrieval:
  scoring:
    card_type_bias: 1.20
`,
        );

        // 2. Author docs and import them.
        mkdirSync(join(cwd, "docs/payments"), { recursive: true });
        writeFileSync(
          join(cwd, "docs/payments/refunds.md"),
          "# Refunds\n\nRefunds use idempotency keys via `RefundService.processRefund`.\n",
        );
        writeFileSync(
          join(cwd, "docs/payments/audit.md"),
          "# Payment audit\n\nUse `AuditLogger.record` to write events.\n",
        );
        const importSummary = runImport(cwd, ["docs/**/*.md"]);
        expect(importSummary.files_imported).toBe(2);
        expect(importSummary.chunks_written).toBeGreaterThan(0);

        // 3. Author cards and run card import.
        mkdirSync(join(cwd, ".contexttrail/cards"), { recursive: true });
        writeFileSync(
          join(cwd, ".contexttrail/cards/c001.md"),
          `---
id: C001
type: constraint
title: Money math goes through Money
authority: accepted
scope:
  layer: project
  project: fundops
---

money rule body.
`,
        );
        writeFileSync(
          join(cwd, ".contexttrail/cards/s001.md"),
          `---
id: S001
type: symbol_note
title: processRefund idempotent
authority: accepted
scope:
  layer: module
  project: fundops
  module: payments
symbol_anchors:
  - RefundService.processRefund
---

processRefund body.
`,
        );
        const cardSummary = runCardImport(cwd);
        expect(cardSummary.cards_imported).toBe(2);
        expect(cardSummary.cards_skipped).toBe(0);

        // 4. contexttrail context — assert Pack shape and section presence.
        const r = runContext(cwd, "fix refund logic", {
          files: ["src/payments/refund.ts"],
          symbols: ["RefundService.processRefund"],
        });
        expect(r.pack).toBeDefined();
        expect(r.pack.locked.length).toBeGreaterThan(0);
        expect(r.pack.locked.map((t) => t.card_id).sort()).toEqual([
          "C001",
          "S001",
        ]);
        expect(r.text).toContain("## Locked rules");
        expect(r.text).toContain("## Symbol notes (locked)");
        expect(r.text).toContain("## Relevant docs");

        // 5. contexttrail verify — must pass on a healthy cache.
        const v = runVerify(cwd);
        expect(v.ok).toBe(true);

        const elapsed = Date.now() - t0;
        // Soft assertion: log if we slip past 30s.
        if (elapsed > 30_000) {
          throw new Error(`Cold-install exceeded 30s budget (${elapsed}ms)`);
        }
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    "first-run smoke: mcp install → setup quickstart → routed MCP call (<60s)",
    async () => {
      const t0 = Date.now();
      const home = mkdtempSync(join(tmpdir(), "contexttrail-cold-home-"));
      const cwd = mkdtempSync(join(tmpdir(), "contexttrail-cold-quickstart-"));
      let client: Client | undefined;
      try {
        const installOut = execFileSync(
          "npx",
          [
            "tsx",
            cliEntry,
            "mcp",
            "install",
            "--client",
            "codex",
            "--json",
          ],
          {
            cwd: repoRoot,
            encoding: "utf8",
            env: { ...process.env, HOME: home, NO_COLOR: "1" },
          },
        );
        const install = JSON.parse(installOut);
        const codexConfig = join(home, ".codex/config.toml");
        expect(install.config_path).toBe(codexConfig);
        expect(existsSync(codexConfig)).toBe(true);
        expect(readFileSync(codexConfig, "utf8")).toContain(
          "[mcp_servers.contexttrail]",
        );

        mkdirSync(join(cwd, "docs"), { recursive: true });
        writeFileSync(
          join(cwd, "docs/rules.md"),
          "# Rules\n\nRefunds must never exceed the captured amount.\n",
          "utf8",
        );
        const quickstartOut = execFileSync(
          "npx",
          [
            "tsx",
            cliEntry,
            "setup",
            "quickstart",
            "--bootstrap-candidates",
            "--json",
          ],
          {
            cwd,
            encoding: "utf8",
            env: { ...process.env, NO_COLOR: "1" },
          },
        );
        const quickstart = JSON.parse(quickstartOut);
        expect(quickstart.import.files_imported).toBe(1);
        expect(quickstart.candidate_bootstrap.enabled).toBe(true);
        expect(
          quickstart.candidate_bootstrap.summary.constraint_candidates_written,
        ).toBeGreaterThan(0);

        const transport = new StdioClientTransport({
          command: "npx",
          args: ["tsx", cliEntry, "mcp"],
          cwd: repoRoot,
          env: { ...process.env } as Record<string, string>,
        });
        client = new Client(
          { name: "cold-install-quickstart", version: "0.0.0" },
          { capabilities: {} },
        );
        await client.connect(transport);

        const sources = await client.callTool({
          name: "list_context_sources",
          arguments: { cwd },
        });
        const sBody = sources.structuredContent as {
          sources: { source_path: string }[];
        };
        expect(sBody.sources.map((source) => source.source_path)).toContain(
          "docs/rules.md",
        );

        const readiness = await client.callTool({
          name: "get_setup_readiness",
          arguments: { cwd },
        });
        const rBody = readiness.structuredContent as { cwd: string };
        expect(realpathSync(rBody.cwd)).toBe(realpathSync(cwd));
      } finally {
        if (client) {
          await client.close().catch(() => {});
        }
        rmSync(home, { recursive: true, force: true });
        rmSync(cwd, { recursive: true, force: true });
      }
      const elapsed = Date.now() - t0;
      if (elapsed > 60_000) {
        throw new Error(`First-run smoke exceeded 60s budget (${elapsed}ms)`);
      }
    },
    60_000,
  );

  it(
    "MCP leg: init → import → card import → contexttrail mcp subprocess → retrieve_context_pack → assert structure (<60s total)",
    async () => {
      const t0 = Date.now();
      const cwd = mkdtempSync(join(tmpdir(), "contexttrail-cold-mcp-"));
      let client: Client | undefined;
      try {
        // Reuse the same setup as the CLI cold-install: scaffold a small repo
        // with a doc + a constraint + a symbol_note.
        init(cwd);
        writeFileSync(
          join(cwd, ".contexttrail/config.yaml"),
          `version: 1
doc_scopes:
  - id: payments-docs
    pattern: "docs/payments/**/*.md"
    scope:
      layer: module
      project: fundops
      module: payments
code_scopes:
  - id: src-tree
    pattern: "src/**"
    scope:
      layer: module
      project: fundops
      module_from_path_after: src
`,
        );
        mkdirSync(join(cwd, "docs/payments"), { recursive: true });
        writeFileSync(
          join(cwd, "docs/payments/refunds.md"),
          "# Refunds\n\nRefunds use idempotency keys via `RefundService.processRefund`.\n",
        );
        runImport(cwd, ["docs/**/*.md"]);
        mkdirSync(join(cwd, ".contexttrail/cards"), { recursive: true });
        writeFileSync(
          join(cwd, ".contexttrail/cards/c001.md"),
          `---
id: C001
type: constraint
title: Money math goes through Money
authority: accepted
scope:
  layer: project
  project: fundops
---
money rule body.
`,
        );
        runCardImport(cwd);

        // Spawn `contexttrail mcp` as a real subprocess, exactly as a Claude Code /
        // Cursor / Codex harness would, and connect via stdio.
        const repoRoot = resolve(
          dirname(fileURLToPath(import.meta.url)),
          "..",
          "..",
        );
        const transport = new StdioClientTransport({
          command: "npx",
          args: ["tsx", join(repoRoot, "src/cli/main.ts"), "mcp"],
          cwd,
          env: { ...process.env } as Record<string, string>,
        });
        client = new Client({ name: "cold-install", version: "0.0.0" }, { capabilities: {} });
        await client.connect(transport);

        // tools/list — retrieval and setup-conversation tools discoverable.
        const list = await client.listTools();
        const names = list.tools.map((t) => t.name).sort();
        expect(names).toEqual([
          "answer_setup_question",
          "get_card",
          "get_doc_chunk",
          "get_setup_readiness",
          "list_agent_rules",
          "list_context_sources",
          "propose_setup_questions",
          "retrieve_context_pack",
          "save_agent_rule",
          "sync_ledger",
        ]);

        // tools/call retrieve_context_pack — full structured response from a
        // real subprocess, assert the load-bearing fields.
        const r = await client.callTool({
          name: "retrieve_context_pack",
          arguments: {
            task: "fix refund logic",
            files: ["src/payments/refund.ts"],
            symbols: ["RefundService.processRefund"],
            // Cold-install E2E covers the rendered_text path explicitly so the
            // legacy convenience surface stays exercised end-to-end.
            include_rendered_text: true,
          },
        });
        expect(r.isError).toBeFalsy();
        const body = r.structuredContent as {
          rendered_text: string;
          locked: { id: string }[];
          ranked: unknown[];
          omitted: { total: number; top: unknown[]; truncated: boolean; by_reason: Record<string, number> };
          warnings: { kind: string }[];
          budget: { requested: number; used: number; locked_overhead: number };
        };
        expect(body.locked.some((l) => l.id === "C001")).toBe(true);
        expect(body.rendered_text).toContain("## Locked rules");
        expect(typeof body.omitted.total).toBe("number");
        expect(Array.isArray(body.omitted.top)).toBe(true);
        expect(typeof body.budget.requested).toBe("number");

        // list_context_sources — the imported source is enumerated.
        const sources = await client.callTool({
          name: "list_context_sources",
          arguments: {},
        });
        const sBody = sources.structuredContent as {
          sources: { source_path: string; chunk_count: number }[];
        };
        expect(sBody.sources.length).toBeGreaterThan(0);
        expect(sBody.sources[0]!.source_path).toMatch(/payments/);
      } finally {
        if (client) {
          await client.close().catch(() => {});
        }
        rmSync(cwd, { recursive: true, force: true });
      }
      const elapsed = Date.now() - t0;
      if (elapsed > 60_000) {
        throw new Error(`Cold-install MCP leg exceeded 60s budget (${elapsed}ms)`);
      }
    },
    60_000,
  );
});
