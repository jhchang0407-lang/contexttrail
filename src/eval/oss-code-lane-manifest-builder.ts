#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  DEFAULT_OSS_CODE_LANE_GENERALIZATION_POLICY,
  summarizeOssCodeLaneManifest,
  type OssCodeLaneCase,
  type OssCodeLaneGeneralizationPolicy,
  type OssCodeLaneValidationRepo,
} from "./oss-code-lane-generalization.js";
import { isOssCodeLaneTargetFile } from "./oss-code-lane-targets.js";

export type OssCodeLaneSeedRepo = {
  id: string;
  name: string;
  remoteUrl: string;
  primaryLanguage: string;
  projectShape: string;
  defaultBranch?: string;
  whyRealistic?: string;
  whyUnfamiliar?: string;
  accessAssumptions?: string[];
};

export type OssCodeLaneRepoCorpusManifest = {
  policy: OssCodeLaneGeneralizationPolicy;
  repos: OssCodeLaneValidationRepo[];
};

export type BuildOssCodeLaneManifestOptions = {
  checkoutRoot?: string;
  seeds?: readonly OssCodeLaneSeedRepo[];
  maxCommitsPerRepo?: number;
  maxCasesPerRepo?: number;
  clone?: boolean;
  policy?: OssCodeLaneGeneralizationPolicy;
};

export type MineOssCodeLaneCasesOptions = {
  repoRoot: string;
  repoId: string;
  maxCommits?: number;
  maxCases?: number;
  minSourceFiles?: number;
};

export const DEFAULT_OSS_CODE_LANE_REPO_CORPUS_POLICY: OssCodeLaneGeneralizationPolicy = {
  ...DEFAULT_OSS_CODE_LANE_GENERALIZATION_POLICY,
  minRepos: 13,
  minCases: 600,
  minPromptVariants: 6000,
  minLanguages: 4,
  minProjectShapes: 5,
  minChangeTypes: 6,
};

export const DEFAULT_OSS_CODE_LANE_SEED_REPOS: readonly OssCodeLaneSeedRepo[] = [
  {
    id: "biome",
    name: "Biome",
    remoteUrl: "https://github.com/biomejs/biome.git",
    primaryLanguage: "Rust",
    projectShape: "toolchain-monorepo",
  },
  {
    id: "drizzle-orm",
    name: "Drizzle ORM",
    remoteUrl: "https://github.com/drizzle-team/drizzle-orm.git",
    primaryLanguage: "TypeScript",
    projectShape: "orm-monorepo",
  },
  {
    id: "effect",
    name: "Effect",
    remoteUrl: "https://github.com/Effect-TS/effect.git",
    primaryLanguage: "TypeScript",
    projectShape: "library-monorepo",
  },
  {
    id: "hono",
    name: "Hono",
    remoteUrl: "https://github.com/honojs/hono.git",
    primaryLanguage: "TypeScript",
    projectShape: "web-framework",
  },
  {
    id: "prisma",
    name: "Prisma",
    remoteUrl: "https://github.com/prisma/prisma.git",
    primaryLanguage: "TypeScript",
    projectShape: "database-tooling-monorepo",
  },
  {
    id: "tanstack-query",
    name: "TanStack Query",
    remoteUrl: "https://github.com/TanStack/query.git",
    primaryLanguage: "TypeScript",
    projectShape: "frontend-library-monorepo",
  },
  {
    id: "trpc",
    name: "tRPC",
    remoteUrl: "https://github.com/trpc/trpc.git",
    primaryLanguage: "TypeScript",
    projectShape: "api-framework-monorepo",
  },
  {
    id: "turborepo",
    name: "Turborepo",
    remoteUrl: "https://github.com/vercel/turborepo.git",
    primaryLanguage: "Rust",
    projectShape: "build-tool-monorepo",
  },
  {
    id: "valibot",
    name: "Valibot",
    remoteUrl: "https://github.com/fabian-hiller/valibot.git",
    primaryLanguage: "TypeScript",
    projectShape: "validation-library",
  },
  {
    id: "vitest",
    name: "Vitest",
    remoteUrl: "https://github.com/vitest-dev/vitest.git",
    primaryLanguage: "TypeScript",
    projectShape: "test-runner-monorepo",
  },
  {
    id: "zod",
    name: "Zod",
    remoteUrl: "https://github.com/colinhacks/zod.git",
    primaryLanguage: "TypeScript",
    projectShape: "validation-library",
  },
  {
    id: "fastify",
    name: "Fastify",
    remoteUrl: "https://github.com/fastify/fastify.git",
    primaryLanguage: "JavaScript",
    projectShape: "web-framework",
  },
  {
    id: "flask",
    name: "Flask",
    remoteUrl: "https://github.com/pallets/flask.git",
    primaryLanguage: "Python",
    projectShape: "web-framework",
  },
  {
    id: "cobra",
    name: "Cobra",
    remoteUrl: "https://github.com/spf13/cobra.git",
    primaryLanguage: "Go",
    projectShape: "cli-library",
  },
  {
    id: "bat",
    name: "bat",
    remoteUrl: "https://github.com/sharkdp/bat.git",
    primaryLanguage: "Rust",
    projectShape: "cli-application",
  },
  {
    id: "vite",
    name: "Vite",
    remoteUrl: "https://github.com/vitejs/vite.git",
    primaryLanguage: "TypeScript",
    projectShape: "build-tool-monorepo",
  },
];

const DEFAULT_CHECKOUT_ROOT = join(
  process.cwd(),
  ".contexttrail",
  "evals",
  "oss-code-lane-repos",
);
const DEFAULT_MANIFEST_PATH = join(
  process.cwd(),
  ".contexttrail",
  "evals",
  "oss-code-lane-manifest.json",
);
const SOURCE_FILE_PATTERN = /\.(?:ts|tsx|js|jsx|py|go|rs)$/;

export function buildOssCodeLaneManifest(
  options: BuildOssCodeLaneManifestOptions = {},
): OssCodeLaneRepoCorpusManifest {
  const checkoutRoot = options.checkoutRoot ?? DEFAULT_CHECKOUT_ROOT;
  const seeds = options.seeds ?? DEFAULT_OSS_CODE_LANE_SEED_REPOS;
  const maxCommitsPerRepo = options.maxCommitsPerRepo ?? 250;
  const maxCasesPerRepo = options.maxCasesPerRepo ?? 50;
  const shouldClone = options.clone ?? true;
  mkdirSync(checkoutRoot, { recursive: true });

  const repos: OssCodeLaneValidationRepo[] = [];
  for (const seed of seeds) {
    const repoRoot = checkoutSeedRepo({
      seed,
      checkoutRoot,
      maxCommitsPerRepo,
      clone: shouldClone,
    });
    const agentCompletionCases = mineOssCodeLaneCases({
      repoRoot,
      repoId: seed.id,
      maxCommits: maxCommitsPerRepo,
      maxCases: maxCasesPerRepo,
    });
    if (agentCompletionCases.length === 0) continue;
    repos.push({
      id: seed.id,
      name: seed.name,
      repoRoot,
      primaryLanguage: seed.primaryLanguage,
      projectShape: seed.projectShape,
      minimumTaskPanel: agentCompletionCases.map((testCase) => testCase.ticket),
      whyRealistic:
        seed.whyRealistic ??
        `${seed.name} is a public OSS ${seed.projectShape} with real commit history.`,
      whyUnfamiliar:
        seed.whyUnfamiliar ??
        "Mined from external OSS history rather than the local ContextTrail ticket panel.",
      accessAssumptions:
        seed.accessAssumptions ??
        ["repository checkout is available under the generated eval checkout root"],
      agentCompletionCases,
    });
  }

  return {
    policy: options.policy ?? DEFAULT_OSS_CODE_LANE_REPO_CORPUS_POLICY,
    repos,
  };
}

export function mineOssCodeLaneCases(
  options: MineOssCodeLaneCasesOptions,
): OssCodeLaneCase[] {
  const maxCommits = options.maxCommits ?? 250;
  const maxCases = options.maxCases ?? 50;
  const minSourceFiles = options.minSourceFiles ?? 1;
  const log = git(options.repoRoot, [
    "log",
    "--no-merges",
    `--max-count=${maxCommits}`,
    "--format=%H%x09%s",
  ]);
  const cases: OssCodeLaneCase[] = [];
  for (const line of log.split("\n").filter((value) => value.trim().length > 0)) {
    const [fullSha, ...subjectParts] = line.split("\t");
    const subject = subjectParts.join("\t").trim();
    if (!fullSha || subject.length === 0) continue;
    const changedSourceFiles = filesChangedInCommit(options.repoRoot, fullSha)
      .filter((file) =>
        isOssCodeLaneTargetFile({ file, repoRoot: options.repoRoot }),
      );
    if (changedSourceFiles.length < minSourceFiles) continue;
    const shortSha = git(options.repoRoot, [
      "rev-parse",
      "--short=12",
      fullSha,
    ]);
    cases.push({
      ticket: `${options.repoId}:${subject}`,
      commit_sha: shortSha,
      queries: buildQueriesForCommit(subject, changedSourceFiles),
      changeType: inferChangeType(subject, changedSourceFiles),
    });
    if (cases.length >= maxCases) break;
  }
  return cases;
}

function checkoutSeedRepo(args: {
  seed: OssCodeLaneSeedRepo;
  checkoutRoot: string;
  maxCommitsPerRepo: number;
  clone: boolean;
}): string {
  const repoRoot = join(args.checkoutRoot, args.seed.id);
  if (existsSync(join(repoRoot, ".git"))) {
    if (args.clone) {
      git(repoRoot, ["fetch", "--depth", String(args.maxCommitsPerRepo), "--prune"]);
      git(repoRoot, ["pull", "--ff-only"]);
    }
    return repoRoot;
  }
  if (!args.clone) return repoRoot;

  mkdirSync(dirname(repoRoot), { recursive: true });
  const cloneArgs = [
    "clone",
    "--depth",
    String(args.maxCommitsPerRepo),
    "--single-branch",
  ];
  if (args.seed.defaultBranch) {
    cloneArgs.push("--branch", args.seed.defaultBranch);
  }
  cloneArgs.push(args.seed.remoteUrl, repoRoot);
  execFileSync("git", cloneArgs, { stdio: "inherit" });
  return repoRoot;
}

function filesChangedInCommit(repoRoot: string, sha: string): string[] {
  return git(repoRoot, [
    "show",
    "--pretty=format:",
    "--name-only",
    "--diff-filter=ACMRT",
    sha,
  ])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function buildQueriesForCommit(
  subject: string,
  changedSourceFiles: readonly string[],
): string[] {
  const tokens = importantPathTokens(changedSourceFiles).slice(0, 6).join(" ");
  return uniqueNonEmpty([
    subject,
    `${subject} implementation files`,
    `${tokens} source implementation`,
  ]).slice(0, 3);
}

function importantPathTokens(files: readonly string[]): string[] {
  const tokens: string[] = [];
  for (const file of files) {
    const parts = file
      .replace(SOURCE_FILE_PATTERN, "")
      .split(/[\/_.-]+/)
      .filter((part) => part.length > 2 && !["src", "lib", "pkg"].includes(part));
    tokens.push(...parts);
    tokens.push(...basename(file).replace(SOURCE_FILE_PATTERN, "").split(/[_.-]+/));
  }
  return uniqueNonEmpty(tokens);
}

function inferChangeType(subject: string, files: readonly string[]): string {
  const haystack = `${subject} ${files.join(" ")}`.toLowerCase();
  if (/\b(parser|parse|grammar|ast|lexer)\b/.test(haystack)) return "parser";
  if (/\b(route|router|component|page|screen|view|web|ui)\b/.test(haystack)) {
    return "ui";
  }
  if (/\b(db|database|store|storage|persist|cache|migration)\b/.test(haystack)) {
    return "storage";
  }
  if (/\b(cli|command|cmd|flag|terminal)\b/.test(haystack)) {
    return "cli_workflow";
  }
  if (/\b(index|rank|ranking|retriev|search|query)\b/.test(haystack)) {
    return "retrieval_index";
  }
  if (/\b(config|option|schema|validation|validate)\b/.test(haystack)) {
    return "configuration";
  }
  if (/\b(api|server|handler|request|response|auth)\b/.test(haystack)) {
    return "api";
  }
  if (/\b(build|bundle|compile|plugin|loader|transform)\b/.test(haystack)) {
    return "build_tooling";
  }
  return "runtime";
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [
    ...new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ];
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function stringArg(argv: readonly string[], name: string): string | undefined {
  return argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.replace(`--${name}=`, "");
}

function numberArg(
  argv: readonly string[],
  name: string,
): number | undefined {
  const raw = stringArg(argv, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} must be a positive finite number`);
  }
  return value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const outPath = stringArg(argv, "out") ?? DEFAULT_MANIFEST_PATH;
  const manifest = buildOssCodeLaneManifest({
    checkoutRoot: stringArg(argv, "checkout-root") ?? DEFAULT_CHECKOUT_ROOT,
    maxCommitsPerRepo: numberArg(argv, "max-commits-per-repo"),
    maxCasesPerRepo: numberArg(argv, "max-cases-per-repo"),
    clone: !argv.includes("--no-clone"),
  });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const summary = summarizeOssCodeLaneManifest(manifest.repos);
  process.stdout.write(
    [
      "========== OSS CODE-LANE MANIFEST BUILDER ==========",
      `Manifest: ${outPath}`,
      `Repos with mined cases: ${summary.repoCount}`,
      `Cases: ${summary.caseCount}`,
      `Prompt variants before expansion: ${summary.promptVariantCount}`,
      `Languages: ${summary.languages.join(", ")}`,
      `Project shapes: ${summary.projectShapes.join(", ")}`,
      `Change types: ${summary.changeTypes.join(", ")}`,
      "",
    ].join("\n"),
  );
}

if (
  process.argv[1]?.endsWith("oss-code-lane-manifest-builder.js") ||
  process.argv[1]?.endsWith("oss-code-lane-manifest-builder.ts")
) {
  void main().catch((err) => {
    process.stderr.write(
      `${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
