/**
 * PRD-0028 / slice 28.3 — flag-reader tests.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  CODE_SOURCE_INDEX_DEFAULT_ON,
  codeSourceIndexEnabledFromEnv,
} from "./code-source-flag.js";

const ENV_KEY = "RETRIEVAL_CODE_SOURCE_INDEX";

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe("RETRIEVAL_CODE_SOURCE_INDEX flag", () => {
  it("default is ON after slice-28.4 promotion gates passed", () => {
    expect(CODE_SOURCE_INDEX_DEFAULT_ON).toBe(true);
    delete process.env[ENV_KEY];
    expect(codeSourceIndexEnabledFromEnv()).toBe(true);
  });

  it("env=on enables the index", () => {
    process.env[ENV_KEY] = "on";
    expect(codeSourceIndexEnabledFromEnv()).toBe(true);
  });

  it("env=off disables the index", () => {
    process.env[ENV_KEY] = "off";
    expect(codeSourceIndexEnabledFromEnv()).toBe(false);
  });

  it("falls back to default for unrecognized values", () => {
    process.env[ENV_KEY] = "maybe";
    expect(codeSourceIndexEnabledFromEnv()).toBe(CODE_SOURCE_INDEX_DEFAULT_ON);
  });
});
