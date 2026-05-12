import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runImport } from "../src/cli/import.js";
import { init } from "../src/config/init.js";
import { closeDb, openDb } from "../src/store/db.js";
import { getCodeSource, listCodeSources } from "../src/store/code-sources.js";

function copyDirSync(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const sp = join(src, name);
    const dp = join(dst, name);
    if (statSync(sp).isDirectory()) copyDirSync(sp, dp);
    else copyFileSync(sp, dp);
  }
}

const REPO = process.argv[2] ?? process.cwd();
const cwd = mkdtempSync(join(tmpdir(), "contexttrail-check-imports-"));
init(cwd);
copyDirSync(join(REPO, "docs"), join(cwd, "docs"));
copyDirSync(join(REPO, "src"), join(cwd, "src"));
runImport(cwd, ["*.md", "docs/**/*.md"]);
const db = openDb(join(cwd, ".contexttrail", "cache", "contexttrail.db"));
try {
  for (const path of [
    "src/retrieve/bm25.ts",
    "src/retrieve/source-rerank.ts",
    "src/retrieve/retrieve.ts",
    "src/retrieve/heading-aliases-flag.ts",
    "src/parse/source-profile.ts",
    "src/store/db.ts",
    "src/store/chunks.ts",
  ]) {
    const s = getCodeSource(db, path);
    console.log(`${path}: imports=${JSON.stringify(s?.facts.imports ?? "NOT INDEXED")}`);
  }
  console.log(`Total code sources: ${listCodeSources(db).length}`);
} finally {
  closeDb(db);
  rmSync(cwd, { recursive: true, force: true });
}
