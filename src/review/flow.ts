import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { loadConfig } from "../config/load.js";
import { nextCardIdentity, writeCardFile } from "../cards/materialize.js";
import {
  AUTHORED_BY_REGEX_BOOTSTRAP,
  getInboxItem,
  writeInboxItem,
} from "../inbox/items.js";
import type {
  ClarificationInboxItem,
  ClarificationRewriteRule,
  InboxItem,
  TraceHistoryEntry,
} from "../inbox/items.js";
import { openDb, closeDb } from "../store/db.js";
import { getChunksByStableKey } from "../store/chunks.js";

export type ReviewAcceptResult = {
  review_item_id: string;
  card_id: string;
  path: string;
};

export type ReviewAnswerInput = {
  choice_id?: string;
  free_text?: string;
};

export type ReviewAnswerResult = {
  review_item_id: string;
  answer_text: string;
  updated_candidate_ids: string[];
};

function reviewTraceDir(cwd: string): string {
  return join(cwd, ".contexttrail/review-trace");
}

function reviewTraceRelativePath(cardId: string): string {
  return `.contexttrail/review-trace/${cardId.toLowerCase()}.yml`;
}

function reviewTracePath(cwd: string, cardId: string): string {
  return join(cwd, reviewTraceRelativePath(cardId));
}

function normalizedTraceHistory(
  item: Extract<InboxItem, { review_type: "candidate_card" }>,
): TraceHistoryEntry[] {
  if (item.trace_history && item.trace_history.length > 0) return item.trace_history;
  return [
    {
      kind: "candidate_created",
      at: item.created_at,
      source_review_item_id: item.id,
      summary: "Candidate accepted without prior stored review history",
      materiality: "substantive",
    },
  ];
}

function materialReviewItemIds(
  traceHistory: TraceHistoryEntry[],
  sourceReviewItemId: string,
): string[] {
  const ids = new Set<string>([sourceReviewItemId]);
  for (const entry of traceHistory) {
    if (entry.materiality === "substantive") ids.add(entry.source_review_item_id);
  }
  return [...ids];
}

function writeReviewTraceFile(args: {
  cwd: string;
  card_id: string;
  item: Extract<InboxItem, { review_type: "candidate_card" }>;
}): string {
  const traceHistory = normalizedTraceHistory(args.item);
  const relativePath = reviewTraceRelativePath(args.card_id);
  const absolutePath = reviewTracePath(args.cwd, args.card_id);
  mkdirSync(reviewTraceDir(args.cwd), { recursive: true });
  const source = stringifyYaml({
    card_id: args.card_id,
    source_review_item_id: args.item.id,
    material_review_item_ids: materialReviewItemIds(traceHistory, args.item.id),
    entries: traceHistory,
  }).trimEnd();
  writeFileSync(absolutePath, `${source}\n`, "utf8");
  return relativePath;
}

function acceptedCardWrite(args: {
  cwd: string;
  card_id: string;
  item: Extract<InboxItem, { review_type: "candidate_card" }>;
  review_trace_path: string;
}): Omit<
  Extract<Parameters<typeof writeCardFile>[0], { kind: "materialized" }>,
  "path"
> {
  const { cwd, card_id, item, review_trace_path } = args;
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  try {
    const linkedChunks = item.supporting_chunks.flatMap((chunk) => {
      const current = getChunksByStableKey(db, chunk.chunk_stable_key).find(
        (candidate) => candidate.status === "current",
      );
      if (!current) return [];
      return [
        {
          chunk_stable_key: current.stable_key,
          version_pin: current.version_id,
          content_hash_pin: current.chunk_content_hash,
          link_type: "mentions",
          linked_at: item.updated_at,
        },
      ];
    });
    return {
      kind: "materialized" as const,
      card_id,
      card_type: item.candidate_type,
      title: item.title,
      authority: "accepted",
      provenance: "system_derived",
      authored_by: item.authored_by ?? AUTHORED_BY_REGEX_BOOTSTRAP,
      scope: item.scope,
      symbol_anchors: item.symbol_anchors ?? [],
      linked_chunks: linkedChunks,
      review_trace: {
        source_review_item_id: item.id,
        history_path: review_trace_path,
        material_review_item_ids: materialReviewItemIds(
          normalizedTraceHistory(item),
          item.id,
        ),
      },
      body: item.body.trim(),
    };
  } finally {
    closeDb(db);
  }
}

export function acceptCandidateReviewItem(
  cwd: string,
  id: string,
): ReviewAcceptResult | null {
  const item = getInboxItem(cwd, id);
  if (!item || item.review_type !== "candidate_card") return null;
  if (item.status !== "pending") return null;
  const cfg = loadConfig(cwd);
  const identity = nextCardIdentity(cwd, item.candidate_type, item.title);
  const cardId = identity.card_id;
  const reviewTracePath = writeReviewTraceFile({
    cwd,
    card_id: cardId,
    item,
  });
  const path = identity.path;
  mkdirSync(join(cwd, cfg.cards.source_dir), { recursive: true });
  const request = acceptedCardWrite({
    cwd,
    card_id: cardId,
    item,
    review_trace_path: reviewTracePath,
  });
  writeCardFile({ ...request, path });
  writeInboxItem(cwd, {
    ...item,
    status: "accepted",
    updated_at: new Date().toISOString(),
  });
  return {
    review_item_id: item.id,
    card_id: cardId,
    path,
  };
}

function resolveClarificationAnswer(
  item: ClarificationInboxItem,
  input: ReviewAnswerInput,
): { answer_text: string; answered_choice_id?: string } | null {
  if (input.choice_id) {
    const choice = item.choices.find((candidate) => candidate.id === input.choice_id);
    if (!choice) return null;
    return {
      answer_text: choice.label,
      answered_choice_id: choice.id,
    };
  }
  const freeText = input.free_text?.trim();
  if (!freeText) return null;
  return { answer_text: freeText };
}

function applyReplacementTemplate(template: string, answerText: string): string {
  return template.replaceAll("{{answer}}", answerText);
}

function applyRewriteRule(
  item: Extract<InboxItem, { review_type: "candidate_card" }>,
  rule: ClarificationRewriteRule,
  answerText: string,
): Extract<InboxItem, { review_type: "candidate_card" }> {
  const replacement = applyReplacementTemplate(rule.replacement_template, answerText);
  if (rule.target === "title") {
    return {
      ...item,
      title: rule.match ? item.title.replaceAll(rule.match, replacement) : replacement,
    };
  }
  if (rule.target === "body") {
    return {
      ...item,
      body: rule.match ? item.body.replaceAll(rule.match, replacement) : replacement,
    };
  }
  return {
    ...item,
    scope: {
      ...item.scope,
      module: replacement,
    },
  };
}

function clarificationTraceEntry(args: {
  clarificationId: string;
  answerText: string;
  materiality: "substantive" | "cosmetic";
  updatedAt: string;
}): TraceHistoryEntry {
  return {
    kind: "clarification_applied",
    at: args.updatedAt,
    source_review_item_id: args.clarificationId,
    materiality: args.materiality,
    summary: `Clarification answered with "${args.answerText}"`,
  };
}

export function answerClarificationReviewItem(
  cwd: string,
  id: string,
  input: ReviewAnswerInput,
): ReviewAnswerResult | null {
  const item = getInboxItem(cwd, id);
  if (!item || item.review_type !== "clarification_need") return null;
  const resolved = resolveClarificationAnswer(item, input);
  if (!resolved) return null;

  const updatedAt = new Date().toISOString();
  const updatedCandidateIds: string[] = [];
  for (const candidateId of item.affects_candidate_ids) {
    const candidate = getInboxItem(cwd, candidateId);
    if (!candidate || candidate.review_type !== "candidate_card" || candidate.status !== "pending") {
      continue;
    }
    let rewritten = candidate;
    for (const rule of item.rewrite_rules) {
      rewritten = applyRewriteRule(rewritten, rule, resolved.answer_text);
    }
    const traceMateriality = item.rewrite_rules.some(
      (rule) => rule.materiality === "substantive",
    )
      ? "substantive"
      : "cosmetic";
    writeInboxItem(cwd, {
      ...rewritten,
      updated_at: updatedAt,
      trace_history: [
        ...(rewritten.trace_history ?? []),
        clarificationTraceEntry({
          clarificationId: item.id,
          answerText: resolved.answer_text,
          materiality: traceMateriality,
          updatedAt,
        }),
      ],
    });
    updatedCandidateIds.push(candidate.id);
  }

  writeInboxItem(cwd, {
    ...item,
    status: "answered",
    updated_at: updatedAt,
    answered_choice_id: resolved.answered_choice_id,
    answered_text: resolved.answer_text,
  });

  return {
    review_item_id: item.id,
    answer_text: resolved.answer_text,
    updated_candidate_ids: updatedCandidateIds,
  };
}
