import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildCodeCochangeFactsBySourcePath } from "./code-cochange-facts.js";

describe("buildCodeCochangeFactsBySourcePath", () => {
  it("extracts historical file co-change pairs from git", () => {
    const cwd = mkdtempSync(join(tmpdir(), "contexttrail-cochange-"));
    try {
      git(cwd, "init");
      git(cwd, "config", "user.email", "test@example.com");
      git(cwd, "config", "user.name", "Test");
      write(cwd, "src/owner.ts", "export const owner = 1;\n");
      write(cwd, "src/helper.ts", "export const helper = 1;\n");
      git(cwd, "add", ".");
      git(cwd, "commit", "-m", "initial");

      write(cwd, "src/owner.ts", "export const owner = 2;\n");
      write(cwd, "src/helper.ts", "export const helper = 2;\n");
      git(cwd, "add", ".");
      git(cwd, "commit", "-m", "change together");

      const facts = buildCodeCochangeFactsBySourcePath({
        cwd,
        source_paths: ["src/owner.ts", "src/helper.ts"],
      });
      expect(facts.get("src/owner.ts")?.related_paths).toEqual([
        { source_path: "src/helper.ts", count: 2 },
      ]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

function write(cwd: string, rel: string, body: string): void {
  const path = join(cwd, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body, "utf8");
}

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}
