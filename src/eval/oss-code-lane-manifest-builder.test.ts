import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OSS_CODE_LANE_REPO_CORPUS_POLICY,
  DEFAULT_OSS_CODE_LANE_SEED_REPOS,
  buildOssCodeLaneManifest,
  mineOssCodeLaneCases,
} from "./oss-code-lane-manifest-builder.js";
import { classifyOssCodeLaneTargetFile } from "./oss-code-lane-targets.js";

describe("OSS code-lane repo corpus defaults", () => {
  it("starts from a real 13+ repo corpus instead of a tiny local panel", () => {
    expect(DEFAULT_OSS_CODE_LANE_REPO_CORPUS_POLICY.minRepos).toBeGreaterThanOrEqual(13);
    expect(DEFAULT_OSS_CODE_LANE_SEED_REPOS.length).toBeGreaterThanOrEqual(13);
    expect(new Set(DEFAULT_OSS_CODE_LANE_SEED_REPOS.map((repo) => repo.primaryLanguage)).size)
      .toBeGreaterThanOrEqual(4);
    expect(new Set(DEFAULT_OSS_CODE_LANE_SEED_REPOS.map((repo) => repo.projectShape)).size)
      .toBeGreaterThanOrEqual(5);
  });
});

describe("mineOssCodeLaneCases", () => {
  it("mines commit-grounded code cases from package-style OSS repos and skips docs-only commits", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "contexttrail-oss-source-"));
    try {
      initGitRepo(repoRoot);
      mkdirSync(join(repoRoot, "packages/parser/src"), { recursive: true });
      mkdirSync(join(repoRoot, "docs"), { recursive: true });
      writeFileSync(join(repoRoot, "README.md"), "# Fixture\n", "utf8");
      commitAll(repoRoot, "Initial fixture");

      writeFileSync(
        join(repoRoot, "packages/parser/src/options.ts"),
        "export function parseOptions(input: string) { return input.trim(); }\n",
        "utf8",
      );
      const codeCommit = commitAll(repoRoot, "Add parser options from config");

      writeFileSync(join(repoRoot, "docs/guide.md"), "# Guide\n", "utf8");
      commitAll(repoRoot, "Update parser docs");

      mkdirSync(join(repoRoot, "examples/demo"), { recursive: true });
      writeFileSync(
        join(repoRoot, "examples/demo/parser.ts"),
        "export const demoParser = true;\n",
        "utf8",
      );
      commitAll(repoRoot, "Add parser example");

      mkdirSync(join(repoRoot, "test"), { recursive: true });
      writeFileSync(
        join(repoRoot, "test/parser.ts"),
        "export const parserTestFixture = true;\n",
        "utf8",
      );
      commitAll(repoRoot, "Move parser test fixture");

      const cases = mineOssCodeLaneCases({
        repoRoot,
        repoId: "fixture",
        maxCommits: 10,
        maxCases: 2,
      });

      expect(cases).toHaveLength(1);
      expect(cases[0]).toMatchObject({
        ticket: "fixture:Add parser options from config",
        commit_sha: codeCommit,
        changeType: "parser",
      });
      expect(cases[0]?.queries.join("\n")).toContain("parser options");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("classifies root-level noisy OSS paths with the same target policy used by scoring", () => {
    expect(classifyOssCodeLaneTargetFile({ file: "src/parser.ts" })).toMatchObject({
      eligible: true,
      bucket: "eligible",
    });
    expect(classifyOssCodeLaneTargetFile({ file: "examples/demo.ts" }).bucket)
      .toBe("examples");
    expect(classifyOssCodeLaneTargetFile({ file: "test/parser.ts" }).bucket)
      .toBe("test");
    expect(classifyOssCodeLaneTargetFile({ file: "build/syntax_mapping.rs" }).bucket)
      .toBe("build_tooling");
    expect(classifyOssCodeLaneTargetFile({
      file: "src/generated/node_factory.rs",
    }).bucket).toBe("generated_or_snapshot");
  });
});

describe("buildOssCodeLaneManifest", () => {
  it("clones seed repos into a checkout root and emits a generalization manifest", () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), "contexttrail-oss-remote-"));
    const checkoutRoot = mkdtempSync(join(tmpdir(), "contexttrail-oss-checkouts-"));
    try {
      initGitRepo(sourceRoot);
      mkdirSync(join(sourceRoot, "apps/web/src"), { recursive: true });
      writeFileSync(join(sourceRoot, "README.md"), "# Fixture\n", "utf8");
      commitAll(sourceRoot, "Initial fixture");
      writeFileSync(
        join(sourceRoot, "apps/web/src/router.tsx"),
        "export function buildRouter() { return '/home'; }\n",
        "utf8",
      );
      const codeCommit = commitAll(sourceRoot, "Add web router entrypoint");

      const manifest = buildOssCodeLaneManifest({
        checkoutRoot,
        seeds: [
          {
            id: "fixture-web",
            name: "Fixture Web",
            remoteUrl: sourceRoot,
            primaryLanguage: "TypeScript",
            projectShape: "monorepo-web-app",
          },
        ],
        maxCommitsPerRepo: 10,
        maxCasesPerRepo: 5,
      });

      expect(manifest.policy).toMatchObject({ minRepos: 13 });
      expect(manifest.repos).toHaveLength(1);
      expect(manifest.repos[0]).toMatchObject({
        id: "fixture-web",
        name: "Fixture Web",
        primaryLanguage: "TypeScript",
        projectShape: "monorepo-web-app",
      });
      expect(manifest.repos[0]?.repoRoot).toBe(join(checkoutRoot, "fixture-web"));
      expect(manifest.repos[0]?.minimumTaskPanel).toEqual([
        "fixture-web:Add web router entrypoint",
      ]);
      expect(manifest.repos[0]?.agentCompletionCases[0]).toMatchObject({
        ticket: "fixture-web:Add web router entrypoint",
        commit_sha: codeCommit,
        changeType: "ui",
      });
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(checkoutRoot, { recursive: true, force: true });
    }
  });
});

function initGitRepo(cwd: string): void {
  git(cwd, ["init"]);
  git(cwd, ["checkout", "-b", "main"]);
  git(cwd, ["config", "user.email", "eval@example.com"]);
  git(cwd, ["config", "user.name", "Eval Fixture"]);
}

function commitAll(cwd: string, message: string): string {
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", message]);
  return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd,
    encoding: "utf8",
  }).trim();
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}
