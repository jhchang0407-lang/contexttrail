#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const queriesPath = argValue("queries");
const resultsPath = argValue("results");
const maxResults = Number(argValue("max-results") ?? "100");
const limit = argValue("limit") ? Number(argValue("limit")) : undefined;
const skipIndex = argv.includes("--skip-index");

if (!queriesPath || !resultsPath) {
  fail(
    "Usage: node scripts/eval/octocode-jsonl.mjs --queries=.contexttrail/evals/oss-code-engine-query-panel-local.jsonl --results=.contexttrail/evals/octocode-results.jsonl [--max-results=100] [--skip-index] [--limit=10]",
  );
}
if (!Number.isInteger(maxResults) || maxResults <= 0) {
  fail("--max-results must be a positive integer");
}
if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
  fail("--limit must be a positive integer");
}
if (!commandExists("octocode")) {
  fail(
    "octocode is not installed. Install it first, then rerun this wrapper. See https://github.com/Muvon/octocode",
  );
}

const queries = readJsonl(queriesPath).slice(0, limit);
const repoRoots = [...new Set(queries.map((query) => query.repoRoot))];

if (!skipIndex) {
  for (const repoRoot of repoRoots) {
    ensureRepo(repoRoot);
    run("octocode", ["index"], { cwd: repoRoot });
  }
}

const lines = [];
for (const [index, query] of queries.entries()) {
  ensureRepo(query.repoRoot);
  const result = run(
    "octocode",
    [
      "search",
      "--mode",
      "code",
      "--format",
      "json",
      query.query,
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
    process.stderr.write(`octocode queries: ${index + 1}/${queries.length}\n`);
  }
}

writeFileSync(resultsPath, `${lines.join("\n")}\n`);
process.stderr.write(`Wrote Octocode candidate results to ${resultsPath}\n`);

function extractCandidates(stdout, repoRoot) {
  const parsed = JSON.parse(stdout);
  const candidates = [];
  visit(parsed, (node) => {
    if (!node || Array.isArray(node) || typeof node !== "object") return;
    const path =
      stringField(node, "path") ??
      stringField(node, "source_path") ??
      stringField(node, "file_path") ??
      stringField(node, "relative_path") ??
      stringField(node, "file");
    if (!path) return;
    candidates.push({
      path: normalizePath(path, repoRoot),
      score:
        numberField(node, "score") ??
        numberField(node, "similarity") ??
        numberField(node, "relevance"),
    });
  });
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate.path || seen.has(candidate.path)) return false;
    seen.add(candidate.path);
    return true;
  });
}

function visit(value, fn) {
  fn(value);
  if (Array.isArray(value)) {
    for (const item of value) visit(item, fn);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) visit(item, fn);
  }
}

function stringField(node, key) {
  const value = node[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberField(node, key) {
  const value = node[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizePath(path, repoRoot) {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  const normalizedRoot = repoRoot.replace(/\\/g, "/").replace(/\/$/, "");
  if (normalized.startsWith(`${normalizedRoot}/`)) {
    return normalized.slice(normalizedRoot.length + 1);
  }
  return normalized;
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
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    fail(`${command} ${args.join(" ")} failed with exit ${result.status}`);
  }
  return result;
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
