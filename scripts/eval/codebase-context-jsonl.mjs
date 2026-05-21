#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const queriesPath = argValue("queries");
const resultsPath = argValue("results");
const maxResults = Number(argValue("max-results") ?? "100");
const limit = argValue("limit") ? Number(argValue("limit")) : undefined;
const skipIndex = argv.includes("--skip-index");
const cliPath =
  argValue("cli") ??
  ".codex/oss-tools/codebase-context/node_modules/codebase-context/dist/index.js";
const resolvedCliPath = resolve(cliPath);

if (!queriesPath || !resultsPath) {
  fail(
    "Usage: node scripts/eval/codebase-context-jsonl.mjs --queries=.contexttrail/evals/oss-code-engine-query-panel-smoke-local.jsonl --results=.contexttrail/evals/codebase-context-results.jsonl [--max-results=100] [--skip-index]",
  );
}
if (!Number.isInteger(maxResults) || maxResults <= 0) {
  fail("--max-results must be a positive integer");
}
if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
  fail("--limit must be a positive integer");
}
if (!existsSync(resolvedCliPath)) {
  fail(
    `codebase-context CLI not found at ${cliPath}. Install it with: mkdir -p .codex/oss-tools/codebase-context && cd .codex/oss-tools/codebase-context && npm install codebase-context@latest`,
  );
}

const queries = readJsonl(queriesPath).slice(0, limit);
const repoRoots = [...new Set(queries.map((query) => query.repoRoot))];

if (!skipIndex) {
  for (const repoRoot of repoRoots) {
    ensureRepo(repoRoot);
    const indexDir = join(repoRoot, ".codebase-context", "index");
    if (!existsSync(indexDir)) {
      run(process.execPath, [resolvedCliPath, "reindex", "--reason", "eval", "--json"], {
        cwd: repoRoot,
      });
      process.stderr.write(`codebase-context indexed: ${repoRoot}\n`);
    }
  }
}

const lines = [];
for (const [index, query] of queries.entries()) {
  ensureRepo(query.repoRoot);
  const result = run(
    process.execPath,
    [
      resolvedCliPath,
      "search",
      "--query",
      query.query,
      "--limit",
      String(maxResults),
      "--json",
    ],
    { cwd: query.repoRoot },
  );
  lines.push(
    JSON.stringify({
      queryId: query.queryId,
      candidates: extractCandidates(result.stdout.toString(), query.repoRoot).slice(
        0,
        maxResults,
      ),
    }),
  );
  if ((index + 1) % 25 === 0 || index + 1 === queries.length) {
    process.stderr.write(`codebase-context queries: ${index + 1}/${queries.length}\n`);
  }
}

writeFileSync(resultsPath, `${lines.join("\n")}\n`);
process.stderr.write(`Wrote codebase-context candidate results to ${resultsPath}\n`);

function extractCandidates(stdout, repoRoot) {
  const parsed = parseTrailingJson(stdout);
  const candidates = [];
  for (const result of parsed.results ?? []) {
    if (typeof result.file !== "string") continue;
    candidates.push({
      path: normalizePath(stripLineSuffix(result.file), repoRoot),
      score: typeof result.score === "number" ? result.score : undefined,
    });
  }
  return uniqueCandidates(candidates);
}

function parseTrailingJson(stdout) {
  const text = stdout.trim();
  const objectStart = text.indexOf("{");
  if (objectStart === -1) return {};
  return JSON.parse(text.slice(objectStart));
}

function stripLineSuffix(path) {
  return path.replace(/:\d+(?:-\d+)?$/, "");
}

function normalizePath(path, repoRoot) {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  const normalizedRoot = repoRoot.replace(/\\/g, "/").replace(/\/$/, "");
  if (normalized.startsWith(`${normalizedRoot}/`)) {
    return normalized.slice(normalizedRoot.length + 1);
  }
  return normalized;
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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 200 * 1024 * 1024,
  });
  if (result.status !== 0) {
    process.stderr.write((result.stdout ?? "").slice(-4000));
    process.stderr.write((result.stderr ?? "").slice(-4000));
    fail(`${command} ${args.join(" ")} failed with exit ${result.status}`);
  }
  return result;
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
