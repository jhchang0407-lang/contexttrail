import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runImport } from "../src/cli/import.js";
import { init } from "../src/config/init.js";
import { closeDb, openDb } from "../src/store/db.js";
import { listSourceProfiles } from "../src/store/source-profiles.js";

function copyDirSync(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const sp = join(src, name);
    const dp = join(dst, name);
    if (statSync(sp).isDirectory()) copyDirSync(sp, dp);
    else copyFileSync(sp, dp);
  }
}

const root = process.argv[2] ?? join(process.cwd(), "tests/fixtures/real-corpus/valibot");
const cwd = mkdtempSync(join(tmpdir(), "contexttrail-nav-check-"));
init(cwd);
copyDirSync(join(root, "docs"), join(cwd, "docs"));
runImport(cwd, ["*.md", "docs/**/*.md"]);
const db = openDb(join(cwd, ".contexttrail", "cache", "contexttrail.db"));
try {
  const profiles = listSourceProfiles(db);
  console.log(`${profiles.length} profiles. Nav presence breakdown:`);
  let withSection = 0;
  let byProv: Record<string, number> = {};
  for (const p of profiles) {
    if (p.nav_section_id) withSection += 1;
    const prov = p.nav_provenance ?? "(undef)";
    byProv[prov] = (byProv[prov] ?? 0) + 1;
  }
  console.log(`  has nav_section_id: ${withSection}/${profiles.length}`);
  for (const [k, v] of Object.entries(byProv)) console.log(`  provenance=${k}: ${v}`);
  console.log(`\nSample (first 5):`);
  for (const p of profiles.slice(0, 5)) {
    console.log(`  ${p.source_path}  section=${p.nav_section_id ?? "-"}  prov=${p.nav_provenance ?? "-"}`);
  }
} finally {
  closeDb(db);
  rmSync(cwd, { recursive: true, force: true });
}
