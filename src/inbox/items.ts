import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { loadConfig } from "../config/load.js";
import { CHUNK_SCOPE_LAYERS } from "../types/chunk.js";
import type { ChunkScopeLayer } from "../types/chunk.js";
import type { CardType } from "../types/card.js";

const InboxScopeSchema = z.object({
  layer: z.enum(CHUNK_SCOPE_LAYERS),
  company: z.string().optional(),
  team: z.string().optional(),
  project: z.string().optional(),
  module: z.string().optional(),
  feature: z.string().optional(),
  domains: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  symbols: z.array(z.string()).optional(),
  routes: z.array(z.string()).optional(),
});

const SupportingChunkSchema = z.object({
  chunk_stable_key: z.string(),
  source_path: z.string(),
  heading_path: z.array(z.string()).default([]),
  version_id: z.string().optional(),
});

const ClarificationChoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

const RewriteRuleSchema = z.object({
  target: z.enum(["title", "body", "scope.module"]),
  match: z.string().optional(),
  replacement_template: z.string().min(1),
  materiality: z.enum(["substantive", "cosmetic"]).default("substantive"),
});

const IsoDatetimeSchema = z.preprocess((value) => {
  if (value instanceof Date) return value.toISOString();
  return value;
}, z.string().datetime());

const TraceHistoryEntrySchema = z.object({
  kind: z.enum(["candidate_created", "clarification_applied"]),
  at: IsoDatetimeSchema,
  source_review_item_id: z.string().min(1),
  summary: z.string().min(1),
  materiality: z.enum(["substantive", "cosmetic"]).default("substantive"),
});

const InboxFrontmatterBaseSchema = z.object({
  id: z.string().min(1),
  review_type: z.enum(["candidate_card", "clarification_need"]),
  status: z.enum(["pending", "accepted", "rejected", "answered"]).default("pending"),
  title: z.string().min(1),
  created_at: IsoDatetimeSchema,
  updated_at: IsoDatetimeSchema,
  // PRD-0034 / slice 34.3: provenance of the authoring system.
  //   "contexttrail-bootstrap"     — regex bootstrap (PRD-0009)
  //   "contexttrail-bootstrap-llm" — LLM augmentation (PRD-0034)
  // Optional at the type level so pre-PRD-0034 items on disk load
  // cleanly without an explicit value. The serializer fills in the
  // regex-bootstrap default when none is supplied.
  authored_by: z.string().min(1).optional(),
});

const CandidateFrontmatterSchema = InboxFrontmatterBaseSchema.extend({
  review_type: z.literal("candidate_card"),
  candidate_type: z.enum(["constraint", "symbol_note", "evidence"]),
  scope: InboxScopeSchema,
  symbol_anchors: z.array(z.string()).default([]),
  supporting_chunks: z.array(SupportingChunkSchema).default([]),
  trace_history: z.array(TraceHistoryEntrySchema).default([]),
});

const ClarificationFrontmatterSchema = InboxFrontmatterBaseSchema.extend({
  review_type: z.literal("clarification_need"),
  choices: z.array(ClarificationChoiceSchema).default([]),
  free_text_allowed: z.boolean().default(true),
  affects_candidate_ids: z.array(z.string()).default([]),
  rewrite_rules: z.array(RewriteRuleSchema).default([]),
  answered_choice_id: z.string().optional(),
  answered_text: z.string().optional(),
});

export type InboxScope = {
  layer: ChunkScopeLayer;
  company?: string;
  team?: string;
  project?: string;
  module?: string;
  feature?: string;
  domains?: string[];
  files?: string[];
  symbols?: string[];
  routes?: string[];
};

export type SupportingChunk = z.infer<typeof SupportingChunkSchema>;
export type ClarificationChoice = z.infer<typeof ClarificationChoiceSchema>;
export type ClarificationRewriteRule = z.infer<typeof RewriteRuleSchema>;
export type TraceHistoryEntry = z.infer<typeof TraceHistoryEntrySchema>;

type InboxBase = z.infer<typeof InboxFrontmatterBaseSchema> & {
  body: string;
};

export const AUTHORED_BY_REGEX_BOOTSTRAP = "contexttrail-bootstrap";
export const AUTHORED_BY_LLM_BOOTSTRAP = "contexttrail-bootstrap-llm";

export type CandidateInboxItem = InboxBase & {
  review_type: "candidate_card";
  candidate_type: CardType;
  scope: InboxScope;
  symbol_anchors?: string[];
  supporting_chunks: SupportingChunk[];
  trace_history?: TraceHistoryEntry[];
};

export type ClarificationInboxItem = InboxBase & {
  review_type: "clarification_need";
  choices: ClarificationChoice[];
  free_text_allowed: boolean;
  affects_candidate_ids: string[];
  rewrite_rules: ClarificationRewriteRule[];
  answered_choice_id?: string;
  answered_text?: string;
};

export type InboxItem = CandidateInboxItem | ClarificationInboxItem;

function inboxDir(cwd: string): string {
  const cfg = loadConfig(cwd);
  return join(cwd, cfg.inbox.source_dir);
}

function inboxPath(cwd: string, id: string): string {
  return join(inboxDir(cwd), `${id}.md`);
}

function serializeFrontmatter(item: InboxItem): Record<string, unknown> {
  const authoredBy = item.authored_by ?? AUTHORED_BY_REGEX_BOOTSTRAP;
  if (item.review_type === "candidate_card") {
    return {
      id: item.id,
      review_type: item.review_type,
      status: item.status,
      title: item.title,
      created_at: item.created_at,
      updated_at: item.updated_at,
      authored_by: authoredBy,
      candidate_type: item.candidate_type,
      scope: item.scope,
      symbol_anchors: item.symbol_anchors ?? [],
      supporting_chunks: item.supporting_chunks,
      trace_history: item.trace_history ?? [],
    };
  }
  return {
    id: item.id,
    review_type: item.review_type,
    status: item.status,
    title: item.title,
    created_at: item.created_at,
    updated_at: item.updated_at,
    authored_by: authoredBy,
    choices: item.choices,
    free_text_allowed: item.free_text_allowed,
    affects_candidate_ids: item.affects_candidate_ids,
    rewrite_rules: item.rewrite_rules,
    answered_choice_id: item.answered_choice_id,
    answered_text: item.answered_text,
  };
}

export function serializeInboxItem(item: InboxItem): string {
  const fm = stringifyYaml(serializeFrontmatter(item)).trimEnd();
  const body = item.body.trim();
  return `---\n${fm}\n---\n\n${body}\n`;
}

export function parseInboxItem(source: string, source_path = "<inbox>"): InboxItem {
  const parsed = matter(source);
  const body = parsed.content.trim();
  const reviewType = parsed.data.review_type;
  if (reviewType === "candidate_card") {
    const fm = CandidateFrontmatterSchema.parse(parsed.data);
    return {
      ...fm,
      body,
      symbol_anchors: fm.symbol_anchors,
      supporting_chunks: fm.supporting_chunks,
      trace_history: fm.trace_history,
    };
  }
  if (reviewType === "clarification_need") {
    const fm = ClarificationFrontmatterSchema.parse(parsed.data);
    return {
      ...fm,
      body,
      choices: fm.choices,
      affects_candidate_ids: fm.affects_candidate_ids,
      rewrite_rules: fm.rewrite_rules,
      answered_choice_id: fm.answered_choice_id,
      answered_text: fm.answered_text,
    };
  }
  throw new Error(`Inbox item frontmatter invalid in ${source_path}: unknown review_type`);
}

export function writeInboxItem(cwd: string, item: InboxItem): { path: string } {
  const dir = inboxDir(cwd);
  mkdirSync(dir, { recursive: true });
  const path = inboxPath(cwd, item.id);
  writeFileSync(path, serializeInboxItem(item), "utf8");
  return { path };
}

export function listInboxItems(cwd: string): InboxItem[] {
  const dir = inboxDir(cwd);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => {
      const path = join(dir, name);
      return parseInboxItem(readFileSync(path, "utf8"), path);
    })
    .sort((a, b) => {
      if (a.created_at !== b.created_at) return a.created_at.localeCompare(b.created_at);
      return a.id.localeCompare(b.id);
    });
}

export function getInboxItem(cwd: string, id: string): InboxItem | null {
  const path = inboxPath(cwd, id);
  if (!existsSync(path)) return null;
  return parseInboxItem(readFileSync(path, "utf8"), path);
}
