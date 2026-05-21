#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const queriesPath = argValue("queries");
const resultsPath = argValue("results");
const mapTokens = Number(argValue("map-tokens") ?? "16384");
const limit = argValue("limit") ? Number(argValue("limit")) : undefined;
const allowFailures = argv.includes("--allow-failures");

if (!queriesPath || !resultsPath) {
  fail(
    "Usage: node scripts/eval/aider-repomap-jsonl.mjs --queries=.contexttrail/evals/oss-code-engine-query-panel-smoke-local.jsonl --results=.contexttrail/evals/aider-repomap-results.jsonl [--map-tokens=16384]",
  );
}
if (!Number.isInteger(mapTokens) || mapTokens <= 0) {
  fail("--map-tokens must be a positive integer");
}
if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
  fail("--limit must be a positive integer");
}
if (!commandExists("uvx")) {
  fail("uvx is not installed; install uv before running the Aider repo-map wrapper.");
}

const queries = readJsonl(queriesPath).slice(0, limit);
const repoRoots = [...new Set(queries.map((query) => query.repoRoot))];
const candidatesByRepoRoot = new Map();

for (const repoRoot of repoRoots) {
  ensureRepo(repoRoot);
  candidatesByRepoRoot.set(repoRoot, runAiderRepoMap(repoRoot));
  process.stderr.write(`aider repo-map indexed: ${repoRoot}\n`);
}

const lines = queries.map((query) =>
  JSON.stringify({
    queryId: query.queryId,
    candidates: candidatesByRepoRoot.get(query.repoRoot) ?? [],
  }),
);
writeFileSync(resultsPath, `${lines.join("\n")}\n`);
process.stderr.write(`Wrote Aider repo-map candidate results to ${resultsPath}\n`);

function runAiderRepoMap(repoRoot) {
  const result = spawnSync(
    "uvx",
    [
      "--from",
      "aider-chat",
      "aider",
      "--model",
      "gpt-4o-mini",
      "--show-repo-map",
      "--map-tokens",
      String(mapTokens),
      "--yes",
      "--no-auto-commits",
      "--no-gitignore",
      "--no-check-update",
      "--no-analytics",
      "--no-show-model-warnings",
      "--no-check-model-accepts-settings",
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        COLUMNS: "240",
        NO_COLOR: "1",
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || "dummy",
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    if (allowFailures) {
      process.stderr.write(
        `aider repo-map failed for ${repoRoot}; continuing with empty candidates\n`,
      );
      return [];
    }
    fail(`aider repo-map failed for ${repoRoot} with exit ${result.status}`);
  }
  return parseRepoMapCandidates(result.stdout.toString());
}

function parseRepoMapCandidates(output) {
  const candidates = [];
  for (const line of output.split("\n")) {
    const match = /^([A-Za-z0-9_@./()[\]\-+]+):\s*$/.exec(line.trim());
    if (!match) continue;
    const path = match[1];
    if (/\.(?:ts|tsx|js|jsx|py|go|rs)$/.test(path)) candidates.push({ path });
  }
  return uniqueCandidates(candidates);
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate.path || seen.has(candidate.path)) return false;
    seen.add(candidate.path);
    return true;
  });
}

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function commandExists(command) {
  return spawnSync("sh", ["-lc", `command -v ${command}`], {
    stdio: "ignore",
  }).status === 0;
}

function ensureRepo(repoRoot) {
  if (!existsSync(repoRoot)) fail(`Repo root does not exist: ${repoRoot}`);
}

function argValue(name) {
  return argv.find((arg) => arg.startsWith(`--${name}=`))?.replace(`--${name}=`, "");
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
