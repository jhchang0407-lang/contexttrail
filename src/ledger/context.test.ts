import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createTestCorpus } from "../eval/test-corpus.js";
import { init } from "../config/init.js";
import { loadConfig } from "../config/load.js";
import {
  isLedgerInitialized,
  ledgerPaths,
  resolveLedgerContext,
} from "./context.js";

describe("repo-local Ledger context", () => {
  it("resolves repo-local paths and initialized state from a cwd", () => {
    const cwd = mkdtempSync(join(tmpdir(), "contexttrail-ledger-context-"));
    try {
      const paths = ledgerPaths(cwd);
      expect(paths.configPath).toBe(join(cwd, ".contexttrail/config.yaml"));
      expect(paths.dbPath).toBe(join(cwd, ".contexttrail/cache/contexttrail.db"));
      expect(isLedgerInitialized(cwd)).toBe(false);

      init(cwd);

      const context = resolveLedgerContext({ defaultCwd: cwd });
      expect(context.cwd).toBe(cwd);
      expect(context.initialized).toBe(true);
      expect(context.useProvidedDb).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("uses provided db/config only for the default workspace", () => {
    const defaultWorkspace = createTestCorpus({ prefix: "contexttrail-ledger-default-" });
    const otherWorkspace = createTestCorpus({ prefix: "contexttrail-ledger-other-" });
    try {
      const defaultConfig = loadConfig(defaultWorkspace.cwd);
      const context = resolveLedgerContext({
        defaultCwd: defaultWorkspace.cwd,
        db: {} as never,
        config: defaultConfig,
      });
      expect(context.useProvidedDb).toBe(true);
      expect(context.config).toBe(defaultConfig);

      const routed = resolveLedgerContext(
        {
          defaultCwd: defaultWorkspace.cwd,
          db: {} as never,
          config: defaultConfig,
        },
        { cwd: otherWorkspace.cwd },
      );
      expect(routed.cwd).toBe(otherWorkspace.cwd);
      expect(routed.useProvidedDb).toBe(false);
      expect(routed.config).not.toBe(defaultConfig);
    } finally {
      defaultWorkspace.cleanup();
      otherWorkspace.cleanup();
    }
  });
});
