import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEvalFixtureLab } from "./lab.js";

describe("retrieval eval lab", () => {
  it("creates an importable fixture repo with docs and Cards", () => {
    const lab = createEvalFixtureLab();
    try {
      expect(existsSync(join(lab.cwd, "docs/payments/refunds.md"))).toBe(true);
      expect(existsSync(join(lab.cwd, ".contexttrail/cards/c-payments.md"))).toBe(true);

      lab.importCorpus();

      expect(existsSync(join(lab.cwd, ".contexttrail/cache/contexttrail.db"))).toBe(true);
    } finally {
      lab.cleanup();
    }
  });
});
