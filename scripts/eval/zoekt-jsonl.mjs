#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const argv = process.argv.slice(2);
const queriesPath = argValue("queries");
const resultsPath = argValue("results");
const indexRoot = argValue("index-root") ?? ".contexttrail/evals/zoekt-index";
const maxResults = Number(argValue("max-results") ?? "100");
const limit = argValue("limit") ? Number(argValue("limit")) : undefined;
const force = argv.includes("--force-index");
const ignoreDirs =
  argValue("ignore-dirs") ??
  ".git,.hg,.svn,node_modules,target,dist,coverage,.codebase-context,.contexttrail";

if (!queriesPath || !resultsPath) {
  fail(
    "Usage: node scripts/eval/zoekt-jsonl.mjs --queries=.contexttrail/evals/oss-code-engine-query-panel-smoke-local.jsonl --results=.contexttrail/evals/zoekt-results.jsonl [--index-root=.contexttrail/evals/zoekt-index] [--force-index]",
  );
}
if (!Number.isInteger(maxResults) || maxResults <= 0) {
  fail("--max-results must be a positive integer");
}
if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
  fail("--limit must be a positive integer");
}
if (!commandExists("zoekt-index") || !commandExists("zoekt")) {
  fail("zoekt-index and zoekt are not installed. Run: go install github.com/sourcegraph/zoekt/cmd/zoekt-index@latest && go install github.com/sourcegraph/zoekt/cmd/zoekt@latest");
}

const queries = readJsonl(queriesPath).slice(0, limit);
const repoRoots = [...new Set(queries.map((query) => query.repoRoot))];
mkdirSync(indexRoot, { recursive: true });

for (const repoRoot of repoRoots) {
  ensureRepo(repoRoot);
  const repoIndexDir = indexDirForRepo(repoRoot);
  if (force) rmSync(repoIndexDir, { recursive: true, force: true });
  if (!existsSync(repoIndexDir) || !hasZoektShard(repoIndexDir)) {
    mkdirSync(repoIndexDir, { recursive: true });
    run("zoekt-index", [
      "-index",
      repoIndexDir,
      "-ignore_dirs",
      ignoreDirs,
      repoRoot,
    ]);
  }
}

const lines = [];
for (const [index, query] of queries.entries()) {
  const repoIndexDir = indexDirForRepo(query.repoRoot);
  const candidates = [];
  for (const zoektQuery of zoektQueries(query.query)) {
    const result = run("zoekt", ["-index_dir", repoIndexDir, "-l", zoektQuery]);
    for (const line of result.stdout.toString().split("\n")) {
      const path = normalizePath(line, query.repoRoot);
      if (path) candidates.push({ path });
      if (candidates.length >= maxResults) break;
    }
    if (candidates.length > 0) break;
  }
  lines.push(
    JSON.stringify({
      queryId: query.queryId,
      candidates: uniqueCandidates(candidates).slice(0, maxResults),
    }),
  );
  if ((index + 1) % 100 === 0 || index + 1 === queries.length) {
    process.stderr.write(`zoekt queries: ${index + 1}/${queries.length}\n`);
  }
}

writeFileSync(resultsPath, `${lines.join("\n")}\n`);
process.stderr.write(`Wrote Zoekt candidate results to ${resultsPath}\n`);

function zoektQueries(query) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [query];
  const core = tokens.slice(0, 12);
  const andQuery = core.join(" ");
  const orQuery = core.map((token) => `"${token}"`).join(" or ");
  return andQuery === orQuery ? [andQuery] : [andQuery, orQuery];
}

function tokenize(query) {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "into",
    "files",
    "implementation",
  ]);
  return query
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/g)
    .map((token) => token.replace(/^[-./_]+|[-./_]+$/g, ""))
    .filter((token) => token.length >= 3 && !stop.has(token));
}

function indexDirForRepo(repoRoot) {
  const safe = basename(repoRoot).replace(/[^A-Za-z0-9_.-]+/g, "_");
  return join(indexRoot, safe);
}

function hasZoektShard(dir) {
  return existsSync(dir) && spawnSync("sh", ["-lc", `ls ${JSON.stringify(dir)}/*.zoekt >/dev/null 2>&1`]).status === 0;
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

function normalizePath(path, repoRoot) {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (!normalized) return "";
  const normalizedRoot = repoRoot.replace(/\\/g, "/").replace(/\/$/, "");
  if (normalized.startsWith(`${normalizedRoot}/`)) {
    return normalized.slice(normalizedRoot.length + 1);
  }
  return normalized;
}

function run(command, args) {
  const result = spawnSync(command, args, {
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
