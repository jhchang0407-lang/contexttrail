import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { init } from "../config/init.js";
import {
  DEFAULT_DOCUMENT_SOURCE_GLOB,
  documentSourceImportPatterns,
  listDocumentSources,
  saveDocumentSource,
  type DocumentSource,
  type SaveDocumentSourceInput,
  type SaveDocumentSourceResult,
} from "../config/document-sources.js";
import {
  addRuleToActiveTaskProfile,
  activeTaskProfileId,
  applyTaskProfile,
  listTaskProfiles,
  saveTaskProfile,
  type ApplyTaskProfileResult,
  type SaveTaskProfileInput,
  type SaveTaskProfileResult,
  type TaskProfile,
} from "../config/task-profiles.js";
import { runImport, type ImportSummary } from "../cli/import.js";
import { runCardBootstrap, type CardBootstrapResult } from "../cli/card-bootstrap.js";
import {
  runInboxAccept,
  runInboxAnswer,
  runInboxList,
  runInboxShow,
  type InboxAcceptResult,
  type InboxAnswerResult,
} from "../cli/inbox-cmds.js";
import type { CardImportSummary } from "../cards/lifecycle.js";
import { saveAgentRule } from "../cards/agent-rules.js";
import { writeInboxItem, type CandidateInboxItem } from "../inbox/items.js";
import { createHandlers } from "../mcp/handlers.js";
import { doctorMcpClient } from "../mcp/install.js";
import { closeDb, openDb } from "../store/db.js";
import { listCards } from "../store/cards.js";
import { runLedgerSync, type LedgerSyncResult } from "../sync/ledger-sync.js";
import type { CardType } from "../types/card.js";
import type { ChunkScopeLayer } from "../types/chunk.js";

export type UploadedTextFile = {
  name: string;
  content?: string;
  data_base64?: string;
  content_type?: string;
};

export type UiRuleScopeInput = {
  layer?: ChunkScopeLayer;
  company?: string;
  team?: string;
  project?: string;
  module?: string;
};

export type UiCreateRuleInput = {
  title?: string;
  body: string;
  scope?: UiRuleScopeInput;
};

export type UiRule = {
  id: string;
  type: CardType;
  title: string;
  body: string;
  scope_summary: string;
  freshness_state: string;
  freshness_reason: string;
  author_review_state: string;
  source_path: string;
  token_count: number;
  updated_at: string;
};

export type UiRuleSource = {
  name: string;
  display_name: string;
  path: string;
  content: string;
  size: number;
  updated_at: string;
};

export type UiDocumentSource = DocumentSource & {
  exists: boolean;
  import_pattern: string;
};

export type UiTaskProfile = TaskProfile & {
  active: boolean;
  rule_titles: Array<{ id: string; title: string }>;
  missing_rule_ids: string[];
};

export type UiSuggestion = {
  id: string;
  review_type: "candidate_card" | "clarification_need";
  status: "pending" | "accepted" | "rejected" | "answered";
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  candidate_type?: CardType;
  choices?: Array<{ id: string; label: string; description?: string }>;
  supporting_chunks?: Array<{
    source_path: string;
    heading_path: string[];
    chunk_stable_key: string;
  }>;
};

export type UiState = {
  cwd: string;
  setup: Awaited<ReturnType<ReturnType<typeof createHandlers>["propose_setup_questions"]>>;
  document_sources: UiDocumentSource[];
  active_task_profile_id: string | null;
  task_profiles: UiTaskProfile[];
  sources: Awaited<ReturnType<ReturnType<typeof createHandlers>["list_context_sources"]>>["sources"];
  rules: UiRule[];
  rule_sources: UiRuleSource[];
  inbox: ReturnType<typeof runInboxList>;
  suggestions: UiSuggestion[];
  mcp: {
    codex: ReturnType<typeof doctorMcpClient>;
  };
};

export type UploadedDocumentsResult = {
  written: string[];
  import_summary: ImportSummary;
};

export type SavedDocumentSourceUiResult = SaveDocumentSourceResult & {
  source: UiDocumentSource;
  import_summary: ImportSummary;
};

export type ReplacedDocumentSourceUiResult = {
  action: SaveDocumentSourceResult["action"];
  source: UiDocumentSource;
  profile: UiTaskProfile;
  import_summary: ImportSummary;
  deactivated_sources: string[];
};

export type SavedTaskProfileUiResult = SaveTaskProfileResult & {
  profile: UiTaskProfile;
  import_summary?: ImportSummary;
  deactivated_sources?: string[];
};

export type AppliedTaskProfileUiResult = ApplyTaskProfileResult & {
  profile: UiTaskProfile;
};

export type UploadedRuleSourcesResult = {
  written: string[];
};

export type CreatedRuleResult = {
  id: string;
  path: string;
  import_summary: CardImportSummary;
};

export type RejectedSuggestionResult = {
  id: string;
  status: "rejected";
};

export type UiContextPreviewInput = {
  task?: string;
  budget?: "small" | "default" | "large";
};

export type UiContextPreviewResult = Awaited<
  ReturnType<ReturnType<typeof createHandlers>["retrieve_context_pack"]>
>;

export type UiSaveTaskProfileInput = Omit<SaveTaskProfileInput, "name"> & {
  name?: string;
  mode?: "current" | "empty";
};

export async function buildUiState(cwd: string): Promise<UiState> {
  init(cwd);
  const handlers = createHandlers({ cwd });
  const [setup, sourceList] = await Promise.all([
    handlers.propose_setup_questions({ cwd }),
    handlers.list_context_sources({ cwd }),
  ]);
  const allRules = listAcceptedRules(cwd);
  const activeProfileId = activeTaskProfileId(cwd);
  const profiles = listTaskProfiles(cwd);
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
  const activeRuleIds = activeProfile ? new Set(activeProfile.rule_ids) : null;
  const rules = activeRuleIds ? allRules.filter((rule) => activeRuleIds.has(rule.id)) : allRules;
  const suggestions = listSuggestions(cwd, rules);
  return {
    cwd,
    setup,
    document_sources: listUiDocumentSources(cwd),
    active_task_profile_id: activeProfileId,
    task_profiles: profiles.map((profile) => toUiTaskProfile(profile, allRules, activeProfileId)),
    sources: sourceList.sources,
    rules,
    rule_sources: listRuleSources(cwd),
    inbox: runInboxList(cwd, { limit: 100 }),
    suggestions,
    mcp: {
      codex: doctorMcpClient({ client: "codex" }),
    },
  };
}

export function importDocumentGlobs(cwd: string, patterns: string[]): ImportSummary {
  init(cwd);
  const usable = patterns.map((p) => p.trim()).filter(Boolean);
  return runImport(cwd, usable.length > 0 ? usable : [`docs/${DEFAULT_DOCUMENT_SOURCE_GLOB}`]);
}

export async function previewContextFromUi(
  cwd: string,
  input: UiContextPreviewInput,
): Promise<UiContextPreviewResult> {
  init(cwd);
  const task = input.task?.trim();
  if (!task) throw new Error("prompt is required");
  return createHandlers({ cwd }).retrieve_context_pack({
    cwd,
    task,
    budget: input.budget ?? "default",
    explain: true,
    include_rendered_text: true,
  });
}

export function saveDocumentSourceFromUi(
  cwd: string,
  input: SaveDocumentSourceInput,
): SavedDocumentSourceUiResult {
  init(cwd);
  const activeId = activeTaskProfileId(cwd);
  const result = saveDocumentSource(cwd, input);
  if (activeId) {
    const profile = listTaskProfiles(cwd).find((item) => item.id === activeId);
    if (profile) {
      const saved = saveTaskProfile(cwd, {
        name: profile.name,
        document_sources: upsertDocumentSource(profile.document_sources, result.source),
        rule_ids: profile.rule_ids,
      });
      const applied = applyTaskProfile(cwd, saved.profile.id);
      return {
        ...result,
        source: toUiDocumentSource(result.source),
        import_summary: applied.import_summary,
      };
    }
  }
  const import_summary = runImport(cwd, documentSourceImportPatterns([result.source]));
  return {
    ...result,
    source: toUiDocumentSource(result.source),
    import_summary,
  };
}

export function replaceDocumentSourceFromUi(
  cwd: string,
  input: SaveDocumentSourceInput,
): ReplacedDocumentSourceUiResult {
  init(cwd);
  const activeId = activeTaskProfileId(cwd);
  const activeProfile = activeId
    ? listTaskProfiles(cwd).find((item) => item.id === activeId)
    : undefined;
  const result = saveDocumentSource(cwd, input);
  const profileName = activeProfile?.name ?? documentSourceProfileName(cwd, result.source);
  const existingProfile = listTaskProfiles(cwd).find(
    (item) => item.name.toLowerCase() === profileName.toLowerCase(),
  );
  const saved = saveTaskProfile(cwd, {
    name: profileName,
    document_sources: [result.source],
    rule_ids: activeProfile?.rule_ids ?? existingProfile?.rule_ids ?? [],
  });
  const applied = applyTaskProfile(cwd, saved.profile.id);
  return {
    action: result.action,
    source: toUiDocumentSource(result.source),
    profile: toUiTaskProfile(applied.profile, listAcceptedRules(cwd), applied.profile.id),
    import_summary: applied.import_summary,
    deactivated_sources: applied.deactivated_sources,
  };
}

export function saveTaskProfileFromUi(
  cwd: string,
  input: UiSaveTaskProfileInput,
): SavedTaskProfileUiResult {
  init(cwd);
  const name = input.name?.trim() || nextDefaultTaskProfileName(cwd);
  const result = input.mode === "empty"
    ? saveTaskProfile(cwd, {
        name,
        document_sources: [],
        rule_ids: [],
      })
    : saveTaskProfile(cwd, {
        name,
        rule_ids: input.rule_ids,
        document_sources: input.document_sources,
      });
  if (input.mode === "empty") {
    const applied = applyTaskProfile(cwd, result.profile.id);
    return {
      ...result,
      profile: toUiTaskProfile(applied.profile, listAcceptedRules(cwd), applied.profile.id),
      import_summary: applied.import_summary,
      deactivated_sources: applied.deactivated_sources,
    };
  }
  return {
    ...result,
    profile: toUiTaskProfile(result.profile, listAcceptedRules(cwd), result.profile.id),
  };
}

export function applyTaskProfileFromUi(
  cwd: string,
  id: string,
): AppliedTaskProfileUiResult {
  init(cwd);
  const result = applyTaskProfile(cwd, id);
  return {
    ...result,
    profile: toUiTaskProfile(result.profile, listAcceptedRules(cwd), result.profile.id),
  };
}

export function uploadDocuments(
  cwd: string,
  files: UploadedTextFile[],
): UploadedDocumentsResult {
  init(cwd);
  const written = writeUploadedFiles(cwd, ".contexttrail/uploads/documents", files);
  const import_summary = written.length > 0
    ? runImport(cwd, written)
    : { files_imported: 0, files_unchanged: 0, chunks_written: 0, warnings: [] };
  return { written, import_summary };
}

export function uploadRuleSources(
  cwd: string,
  files: UploadedTextFile[],
): UploadedRuleSourcesResult {
  init(cwd);
  return {
    written: writeUploadedFiles(cwd, ".contexttrail/rule-sources", files),
  };
}

export function createAcceptedRule(
  cwd: string,
  input: UiCreateRuleInput,
): CreatedRuleResult {
  init(cwd);
  const body = input.body.trim();
  if (!body) throw new Error("rule body is required");
  const result = saveAgentRule(cwd, {
    title: input.title,
    body,
    scope: input.scope,
    authored_by: "contexttrail-ui",
  });
  addRuleToActiveTaskProfile(cwd, result.rule.id);
  return {
    id: result.rule.id,
    path: join(cwd, result.rule.source_path),
    import_summary: result.import_summary,
  };
}

export async function bootstrapSuggestions(cwd: string): Promise<CardBootstrapResult> {
  init(cwd);
  return runCardBootstrap(cwd, { llm: false });
}

export function acceptSuggestion(cwd: string, id: string): InboxAcceptResult {
  init(cwd);
  const result = runInboxAccept(cwd, id);
  if (!result) throw new Error(`no candidate suggestion with id ${id}`);
  addRuleToActiveTaskProfile(cwd, result.card_id);
  return result;
}

export function rejectSuggestion(cwd: string, id: string): RejectedSuggestionResult {
  init(cwd);
  const item = runInboxShow(cwd, id);
  if (!item) throw new Error(`no suggestion with id ${id}`);
  writeInboxItem(cwd, {
    ...item,
    status: "rejected",
    updated_at: new Date().toISOString(),
  });
  return { id, status: "rejected" };
}

export function answerSuggestion(
  cwd: string,
  id: string,
  input: { choice_id?: string; free_text?: string },
): InboxAnswerResult {
  init(cwd);
  const result = runInboxAnswer(cwd, id, input);
  if (!result) throw new Error(`could not answer clarification ${id}`);
  return result;
}

export function syncFromUi(
  cwd: string,
  input: { check?: boolean; refresh_candidates?: boolean } = {},
): Promise<LedgerSyncResult> {
  init(cwd);
  return runLedgerSync(cwd, {
    check: input.check ?? false,
    refreshCandidates: input.refresh_candidates ?? false,
  });
}

function writeUploadedFiles(
  cwd: string,
  relativeDir: string,
  files: UploadedTextFile[],
): string[] {
  const dir = join(cwd, relativeDir);
  mkdirSync(dir, { recursive: true });
  const now = Date.now();
  return files
    .map((file) => ({ file, bytes: uploadedFileBytes(file) }))
    .filter(({ file, bytes }) => file.name.trim() && bytes.length > 0)
    .map(({ file, bytes }, index) => {
      const name = `${now}-${index + 1}-${safeFilename(file.name)}`;
      const relativePath = `${relativeDir}/${name}`;
      writeFileSync(join(cwd, relativePath), bytes);
      return relativePath;
    });
}

function uploadedFileBytes(file: UploadedTextFile): Buffer {
  if (typeof file.data_base64 === "string" && file.data_base64.trim()) {
    return Buffer.from(file.data_base64, "base64");
  }
  return Buffer.from(file.content ?? "", "utf8");
}

function listAcceptedRules(cwd: string): UiRule[] {
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  try {
    return listCards(db, { authority: "accepted" }).map((card) => ({
      id: card.id,
      type: card.type,
      title: card.title,
      body: card.body,
      scope_summary: summarizeScope(card.scope),
      freshness_state: card.freshness_state,
      freshness_reason: card.freshness_reason,
      author_review_state: card.author_review_state,
      source_path: card.source_path,
      token_count: card.token_count,
      updated_at: card.updated_at,
    }));
  } finally {
    closeDb(db);
  }
}

function listRuleSources(cwd: string): UiRuleSource[] {
  const dir = join(cwd, ".contexttrail/rule-sources");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.startsWith("."))
    .map((name) => {
      const path = join(dir, name);
      const stat = statSync(path);
      return {
        name,
        display_name: displayFilename(name),
        path: `.contexttrail/rule-sources/${name}`,
        content: readFileSync(path, "utf8"),
        size: stat.size,
        updated_at: new Date(stat.mtimeMs).toISOString(),
      };
    })
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

function listUiDocumentSources(cwd: string): UiDocumentSource[] {
  return listDocumentSources(cwd).map(toUiDocumentSource);
}

function toUiDocumentSource(source: DocumentSource): UiDocumentSource {
  return {
    ...source,
    exists: existsSync(source.path),
    import_pattern: documentSourceImportPatterns([source])[0] ?? "",
  };
}

function toUiTaskProfile(
  profile: TaskProfile,
  rules: UiRule[],
  activeProfileId: string | null,
): UiTaskProfile {
  const rulesById = new Map(rules.map((rule) => [rule.id, rule]));
  return {
    ...profile,
    active: profile.id === activeProfileId,
    rule_titles: profile.rule_ids.flatMap((id) => {
      const rule = rulesById.get(id);
      return rule ? [{ id, title: rule.title }] : [];
    }),
    missing_rule_ids: profile.rule_ids.filter((id) => !rulesById.has(id)),
  };
}

function upsertDocumentSource(
  sources: DocumentSource[],
  source: DocumentSource,
): DocumentSource[] {
  const next = [...sources];
  const index = next.findIndex((item) => item.path === source.path);
  if (index >= 0) next[index] = source;
  else next.push(source);
  return next;
}

function documentSourceProfileName(cwd: string, source: DocumentSource): string {
  const existingForSource = listTaskProfiles(cwd).find((profile) =>
    profile.document_sources.some((item) => item.path === source.path),
  );
  if (existingForSource) return existingForSource.name;
  const base = basename(source.path) || "Workflow";
  const names = new Set(listTaskProfiles(cwd).map((profile) => profile.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
}

function nextDefaultTaskProfileName(cwd: string): string {
  const base = "Untitled Workflow";
  const names = new Set(listTaskProfiles(cwd).map((profile) => profile.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
}

function listSuggestions(cwd: string, acceptedRules: UiRule[]): UiSuggestion[] {
  const suggestions: UiSuggestion[] = [];
  for (const row of runInboxList(cwd, { status: "pending", limit: 100 }).rows) {
    const item = runInboxShow(cwd, row.id);
    if (!item) continue;
    if (item.review_type === "candidate_card" && isAcceptedRuleDuplicate(item, acceptedRules)) {
      continue;
    }
    if (item.review_type === "candidate_card") {
      suggestions.push({
        id: item.id,
        review_type: item.review_type,
        status: item.status,
        title: item.title,
        body: item.body,
        created_at: item.created_at,
        updated_at: item.updated_at,
        candidate_type: item.candidate_type,
        supporting_chunks: item.supporting_chunks.map((chunk) => ({
          source_path: chunk.source_path,
          heading_path: chunk.heading_path,
          chunk_stable_key: chunk.chunk_stable_key,
        })),
      });
      continue;
    }
    suggestions.push({
      id: item.id,
      review_type: item.review_type,
      status: item.status,
      title: item.title,
      body: item.body,
      created_at: item.created_at,
      updated_at: item.updated_at,
      choices: item.choices,
    });
  }
  return suggestions;
}

function isAcceptedRuleDuplicate(
  item: CandidateInboxItem,
  acceptedRules: UiRule[],
): boolean {
  const bodyKey = normalizeSuggestionText(item.body);
  const titleKey = normalizeSuggestionText(item.title);
  return acceptedRules.some((rule) =>
    rule.type === item.candidate_type &&
    (normalizeSuggestionText(rule.body) === bodyKey ||
      normalizeSuggestionText(rule.title) === titleKey),
  );
}

function normalizeSuggestionText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function safeFilename(name: string): string {
  const safe = basename(name)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return safe || "upload.md";
}

function displayFilename(name: string): string {
  return name.replace(/^\d{10,}-\d+-/, "");
}

function summarizeScope(scope: {
  layer: string;
  company?: string;
  team?: string;
  project?: string;
  module?: string;
}): string {
  if (scope.layer === "company") return `company:${scope.company ?? "*"}`;
  if (scope.layer === "team") return `team:${scope.team ?? "*"}`;
  if (scope.layer === "project") return `project:${scope.project ?? "*"}`;
  if (scope.layer === "module") return `module:${scope.module ?? "*"}`;
  return scope.layer;
}
