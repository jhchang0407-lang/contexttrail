import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join, relative } from "node:path";
import { parseDocument } from "yaml";
import {
  importConfiguredDocumentSources,
  upgradeDocumentSourceDefaults,
} from "./document-sources.js";
import { init } from "./init.js";
import { CONFIG_REL_PATH, loadConfig } from "./load.js";
import { listAgentRules } from "../cards/agent-rules.js";
import type { ImportSummary } from "../cli/import.js";
import { tombstoneChunk } from "../store/chunks.js";
import { closeDb, openDb } from "../store/db.js";
import {
  deleteSourceProfile,
} from "../store/source-profiles.js";
import {
  deleteSource,
  listChunkVersionIdsForSource,
  listSources,
} from "../store/sources.js";
import { deleteSourceExtraction } from "../store/source-extractions.js";
import { absoluteSourcePath } from "../source-path.js";
import type { ContextTrailConfig } from "./defaults.js";

export type TaskProfile = ContextTrailConfig["task_profiles"][number];

export type SaveTaskProfileInput = {
  name: string;
  rule_ids?: string[];
  document_sources?: TaskProfile["document_sources"];
};

export type SaveTaskProfileResult = {
  action: "created" | "updated";
  profile: TaskProfile;
};

export type ApplyTaskProfileResult = {
  profile: TaskProfile;
  import_summary: ImportSummary;
  deactivated_sources: string[];
};

export function listTaskProfiles(cwd: string): TaskProfile[] {
  init(cwd);
  return loadConfig(cwd).task_profiles.map((profile) => ({
    ...profile,
    document_sources: upgradeDocumentSourceDefaults(profile.document_sources),
  }));
}

export function activeTaskProfileId(cwd: string): string | null {
  init(cwd);
  return loadConfig(cwd).active_task_profile_id;
}

export function saveTaskProfile(
  cwd: string,
  input: SaveTaskProfileInput,
): SaveTaskProfileResult {
  init(cwd);
  const name = input.name.trim();
  if (!name) throw new Error("profile name is required");
  const cfg = loadConfig(cwd);
  const now = new Date().toISOString();
  const existingIndex = cfg.task_profiles.findIndex(
    (profile) => profile.name.toLowerCase() === name.toLowerCase(),
  );
  const existing = existingIndex >= 0 ? cfg.task_profiles[existingIndex] : undefined;
  const profile: TaskProfile = {
    id: existing?.id ?? taskProfileId(name),
    name,
    document_sources: upgradeDocumentSourceDefaults(input.document_sources ?? cfg.document_sources),
    rule_ids: input.rule_ids
      ?? listAgentRules(cwd).map((rule) => rule.id),
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  const profiles = [...cfg.task_profiles];
  const action: SaveTaskProfileResult["action"] = existing ? "updated" : "created";
  if (existingIndex >= 0) profiles[existingIndex] = profile;
  else profiles.push(profile);
  writeTaskProfileConfig(cwd, {
    task_profiles: profiles,
    active_task_profile_id: profile.id,
  });
  return { action, profile };
}

export function addRuleToActiveTaskProfile(
  cwd: string,
  ruleId: string,
): TaskProfile | null {
  init(cwd);
  const cfg = loadConfig(cwd);
  if (!cfg.active_task_profile_id) return null;
  const index = cfg.task_profiles.findIndex(
    (profile) => profile.id === cfg.active_task_profile_id,
  );
  if (index < 0) return null;
  const existing = cfg.task_profiles[index]!;
  const profile: TaskProfile = {
    ...existing,
    document_sources: upgradeDocumentSourceDefaults(existing.document_sources),
    rule_ids: Array.from(new Set([...existing.rule_ids, ruleId])),
    updated_at: new Date().toISOString(),
  };
  const profiles = [...cfg.task_profiles];
  profiles[index] = profile;
  writeTaskProfileConfig(cwd, { task_profiles: profiles });
  return profile;
}

export function applyTaskProfile(
  cwd: string,
  profileId: string,
): ApplyTaskProfileResult {
  init(cwd);
  const profile = listTaskProfiles(cwd).find((item) => item.id === profileId);
  if (!profile) throw new Error(`no task profile with id=${profileId}`);
  writeTaskProfileConfig(cwd, {
    document_sources: profile.document_sources,
    active_task_profile_id: profile.id,
  });
  const deactivated_sources = deactivateSourcesOutsideProfile(cwd, profile);
  const import_summary = profile.document_sources.length > 0
    ? importConfiguredDocumentSources(cwd)
    : emptyImportSummary();
  return {
    profile,
    import_summary,
    deactivated_sources,
  };
}

function deactivateSourcesOutsideProfile(cwd: string, profile: TaskProfile): string[] {
  const activeRoots = profile.document_sources.map((source) => source.path);
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  const deactivated: string[] = [];
  try {
    for (const source of listSources(db)) {
      if (isSourceInActiveRoots(cwd, source.source_path, activeRoots)) continue;
      for (const versionId of listChunkVersionIdsForSource(db, source.source_path, "current")) {
        tombstoneChunk(db, versionId);
      }
      deleteSourceProfile(db, source.source_path);
      deleteSource(db, source.source_path);
      deleteSourceExtraction(db, source.source_path);
      deactivated.push(source.source_path);
    }
  } finally {
    closeDb(db);
  }
  return deactivated.sort();
}

function isSourceInActiveRoots(cwd: string, sourcePath: string, roots: string[]): boolean {
  if (roots.length === 0) return false;
  const abs = absoluteSourcePath(cwd, sourcePath);
  return roots.some((root) => {
    const rel = relative(root, abs);
    return rel !== "" && !rel.startsWith("..") && !rel.startsWith("/");
  });
}

function writeTaskProfileConfig(
  cwd: string,
  patch: Partial<Pick<
    ContextTrailConfig,
    "document_sources" | "active_task_profile_id" | "task_profiles"
  >>,
): void {
  const configPath = join(cwd, CONFIG_REL_PATH);
  const document = parseDocument(readFileSync(configPath, "utf8"));
  for (const [key, value] of Object.entries(patch)) {
    document.set(key, value);
  }
  writeFileSync(configPath, document.toString(), "utf8");
}

function taskProfileId(name: string): string {
  const safe = basename(name)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "profile";
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 8);
  return `profile-${safe}-${hash}`;
}

function emptyImportSummary(): ImportSummary {
  return {
    files_imported: 0,
    files_unchanged: 0,
    chunks_written: 0,
    warnings: [],
  };
}
