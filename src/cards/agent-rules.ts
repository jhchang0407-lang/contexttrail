import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { stringify as stringifyYaml } from "yaml";
import { init } from "../config/init.js";
import { loadConfig } from "../config/load.js";
import { importAcceptedCards, type CardImportSummary } from "./lifecycle.js";
import { nextCardIdentity } from "./materialize.js";
import { closeDb, openDb } from "../store/db.js";
import {
  getCardById,
  listCards,
  updateCardAuthorReview,
} from "../store/cards.js";
import type {
  Card,
  CardLink,
  FreshnessReason,
  FreshnessState,
  AuthorReviewState,
} from "../types/card.js";
import type { ChunkScopeLayer } from "../types/chunk.js";

export type AgentRuleScopeInput = {
  layer?: ChunkScopeLayer;
  company?: string;
  team?: string;
  project?: string;
  module?: string;
  feature?: string;
  domains?: string[];
  routes?: string[];
};

export type AgentRuleSummary = {
  id: string;
  title: string;
  body: string;
  scope: Record<string, unknown>;
  scope_summary: string;
  source_path: string;
  token_count: number;
  freshness_state: FreshnessState;
  freshness_reason: FreshnessReason;
  author_review_state: AuthorReviewState;
  updated_at: string;
};

export type ListAgentRulesOptions = {
  include_deprecated?: boolean;
  ignore_active_profile?: boolean;
};

export type SaveAgentRuleInput = {
  id?: string;
  title?: string;
  body?: string;
  scope?: AgentRuleScopeInput;
  authored_by?: string;
  update_reason?: string;
};

export type SaveAgentRuleResult = {
  action: "created" | "updated";
  rule: AgentRuleSummary;
  import_summary: CardImportSummary;
  writes: string[];
  warnings: string[];
};

export function listAgentRules(
  cwd: string,
  options: ListAgentRulesOptions = {},
): AgentRuleSummary[] {
  init(cwd);
  const cfg = loadConfig(cwd);
  const activeProfile = options.ignore_active_profile
    ? undefined
    : cfg.task_profiles.find((profile) => profile.id === cfg.active_task_profile_id);
  const activeRuleIds = activeProfile ? new Set(activeProfile.rule_ids) : null;
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  try {
    return listCards(db, { type: "constraint" })
      .filter((card) => options.include_deprecated || card.authority !== "deprecated")
      .filter((card) => !activeRuleIds || activeRuleIds.has(card.id))
      .map(summarizeAgentRule);
  } finally {
    closeDb(db);
  }
}

export function saveAgentRule(
  cwd: string,
  input: SaveAgentRuleInput,
): SaveAgentRuleResult {
  init(cwd);
  if (input.id) return updateAgentRule(cwd, input.id, input);
  return createAgentRule(cwd, input);
}

function createAgentRule(
  cwd: string,
  input: SaveAgentRuleInput,
): SaveAgentRuleResult {
  const body = input.body?.trim();
  if (!body) throw new Error("body is required when creating an agent rule");
  const title = normalizeTitle(input.title, body);
  const cfg = loadConfig(cwd);
  const identity = nextCardIdentity(cwd, "constraint", title);
  const sourcePath = relativeToCwd(cwd, identity.path);
  const frontmatter = {
    id: identity.card_id,
    type: "constraint",
    title,
    authority: "accepted",
    provenance: "human_authored",
    authored_by: input.authored_by?.trim() || "contexttrail-mcp",
    scope: normalizeScope(input.scope),
    symbol_anchors: [],
    linked_chunks: [],
    mcp_edit_history: [
      editHistoryEntry("created", input.update_reason, ["title", "body", "scope"]),
    ],
  };

  mkdirSync(join(cwd, cfg.cards.source_dir), { recursive: true });
  writeRuleFile(identity.path, frontmatter, body);
  const importSummary = importAcceptedCards(cwd);
  const rule = getRequiredRule(cwd, identity.card_id);
  return {
    action: "created",
    rule,
    import_summary: importSummary,
    writes: [sourcePath],
    warnings: importSummary.warnings,
  };
}

function updateAgentRule(
  cwd: string,
  id: string,
  input: SaveAgentRuleInput,
): SaveAgentRuleResult {
  if (!input.title && !input.body && !input.scope) {
    throw new Error("provide at least one of title, body, or scope when updating an agent rule");
  }

  // Re-import first so edits work after a user has manually changed Card files.
  importAcceptedCards(cwd);
  const existing = getRuleCard(cwd, id);
  if (!existing) throw new Error(`no agent rule with id=${id}`);
  if (existing.type !== "constraint") {
    throw new Error(`card ${id} is ${existing.type}; save_agent_rule only edits constraint rules`);
  }

  const absolutePath = join(cwd, existing.source_path);
  if (!existsSync(absolutePath)) {
    throw new Error(`agent rule source is missing: ${existing.source_path}`);
  }
  const parsed = matter(readFileSync(absolutePath, "utf8"));
  const frontmatter = {
    ...parsed.data,
    id: existing.id,
    type: "constraint",
    title: input.title?.trim() || existing.title,
    authority: parsed.data.authority ?? existing.authority,
    provenance: parsed.data.provenance ?? existing.provenance,
    authored_by: parsed.data.authored_by ?? existing.authored_by ?? "contexttrail-mcp",
    scope: input.scope ? normalizeScope(input.scope) : normalizeScope(existing.scope),
    symbol_anchors: parsed.data.symbol_anchors ?? existing.symbol_anchors,
    files: parsed.data.files ?? existing.file_anchors,
    routes: parsed.data.routes ?? existing.route_anchors,
    linked_chunks: parsed.data.linked_chunks ?? linksForFrontmatter(existing.links),
    mcp_edit_history: [
      ...asArray(parsed.data.mcp_edit_history),
      editHistoryEntry("updated", input.update_reason, changedFields(input)),
    ],
  };
  const nextBody = input.body?.trim() ?? existing.body;

  writeRuleFile(absolutePath, frontmatter, nextBody);
  const importSummary = importAcceptedCards(cwd);
  markRuleUnreviewed(cwd, id);
  const rule = getRequiredRule(cwd, id);
  return {
    action: "updated",
    rule,
    import_summary: importSummary,
    writes: [existing.source_path],
    warnings: importSummary.warnings,
  };
}

function getRuleCard(cwd: string, id: string): Card | null {
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  try {
    return getCardById(db, id);
  } finally {
    closeDb(db);
  }
}

function getRequiredRule(cwd: string, id: string): AgentRuleSummary {
  const card = getRuleCard(cwd, id);
  if (!card) throw new Error(`agent rule ${id} was not imported`);
  return summarizeAgentRule(card);
}

function markRuleUnreviewed(cwd: string, id: string): void {
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  try {
    updateCardAuthorReview(db, id, "unreviewed");
  } finally {
    closeDb(db);
  }
}

function summarizeAgentRule(card: Card): AgentRuleSummary {
  return {
    id: card.id,
    title: card.title,
    body: card.body,
    scope: normalizeScope(card.scope),
    scope_summary: summarizeScope(card.scope),
    source_path: card.source_path,
    token_count: card.token_count,
    freshness_state: card.freshness_state,
    freshness_reason: card.freshness_reason,
    author_review_state: card.author_review_state,
    updated_at: card.updated_at,
  };
}

function writeRuleFile(
  path: string,
  frontmatter: Record<string, unknown>,
  body: string,
): void {
  const source = `---\n${stringifyYaml(stripUndefined(frontmatter)).trimEnd()}\n---\n\n${body.trim()}\n`;
  writeFileSync(path, source, "utf8");
}

function normalizeTitle(title: string | undefined, body: string): string {
  const explicit = title?.trim();
  if (explicit) return explicit.slice(0, 80);
  return body
    .split(/\s+/)
    .slice(0, 8)
    .join(" ")
    .replace(/[.:;,\s]+$/g, "")
    .slice(0, 80) || "Agent rule";
}

function normalizeScope(input: AgentRuleScopeInput | Card["scope"] | undefined): Record<string, unknown> {
  const layer = input?.layer ?? "project";
  const scope: Record<string, unknown> = { layer };
  for (const key of ["company", "team", "project", "module", "feature"] as const) {
    const value = input?.[key];
    if (typeof value === "string" && value.trim()) scope[key] = value.trim();
  }
  if (Array.isArray(input?.domains) && input.domains.length > 0) {
    scope.domains = input.domains.map((v) => v.trim()).filter(Boolean);
  }
  if (Array.isArray(input?.routes) && input.routes.length > 0) {
    scope.routes = input.routes.map((v) => v.trim()).filter(Boolean);
  }
  return scope;
}

function summarizeScope(scope: Card["scope"]): string {
  if (scope.layer === "company") return `company:${scope.company ?? "*"}`;
  if (scope.layer === "team") return `team:${scope.team ?? "*"}`;
  if (scope.layer === "project") return `project:${scope.project ?? "*"}`;
  if (scope.layer === "module") return `module:${scope.module ?? "*"}`;
  return scope.layer;
}

function linksForFrontmatter(links: CardLink[]): Array<Record<string, string>> {
  return links.map((link) => ({
    chunk_stable_key: link.chunk_stable_key,
    version_pin: link.version_pin,
    content_hash_pin: link.content_hash_pin,
    link_type: link.link_type,
    linked_at: link.linked_at,
  }));
}

function changedFields(input: SaveAgentRuleInput): string[] {
  return [
    input.title ? "title" : undefined,
    input.body ? "body" : undefined,
    input.scope ? "scope" : undefined,
  ].filter((field): field is string => Boolean(field));
}

function editHistoryEntry(
  action: "created" | "updated",
  reason: string | undefined,
  fields: string[],
): Record<string, unknown> {
  return {
    at: new Date().toISOString(),
    action,
    actor: "contexttrail-mcp",
    reason: reason?.trim() || undefined,
    fields,
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUndefined);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const cleaned = stripUndefined(child);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  return value;
}

function relativeToCwd(cwd: string, path: string): string {
  return path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
}
