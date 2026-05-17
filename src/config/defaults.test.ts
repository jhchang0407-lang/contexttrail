import { describe, expect, it } from "vitest";
import { ConfigSchema } from "./defaults.js";

describe("default code indexing config", () => {
  it("covers common OSS source roots beyond src/packages/apps", () => {
    const cfg = ConfigSchema.parse({});

    expect(cfg.code_globs).toEqual(expect.arrayContaining([
      "**/*.ts",
      "**/*.tsx",
      "**/*.js",
      "**/*.jsx",
      "**/*.go",
      "**/*.rs",
      "**/*.py",
    ]));
    expect(cfg.code_ignore).toEqual(expect.arrayContaining([
      "**/__tests__/**",
      "**/tests/**",
      "**/fixtures/**",
      "**/examples/**",
      "**/*.spec.ts",
      "**/*_test.go",
    ]));
  });
});
