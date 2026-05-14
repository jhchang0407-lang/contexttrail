import type {
  RetrieveContextPackOutputT,
  SyncLedgerOutputT,
  ToolName,
} from "./schemas.js";

export type McpToolRegistryEntry = {
  name: ToolName;
  description: string;
};

export const TOOL_REGISTRY: readonly McpToolRegistryEntry[] = [
  {
    name: "retrieve_context_pack",
    description:
      "Retrieve a Context Pack of locked Cards + ranked Doc Chunks for a coding task. Before coding, call get_setup_readiness or propose_setup_questions for the repo cwd; if setup has pending work, curate obvious inbox items and ask only high-leverage semantic questions before retrieval.",
  },
  {
    name: "get_doc_chunk",
    description:
      "Fetch a single Doc Chunk by `version_id` or `stable_key`, returning body, scope, code anchors, and freshness.",
  },
  {
    name: "get_code_chunk",
    description:
      "Fetch a single code chunk by exact `version_id` or logical `source_path` + `symbol_path`, returning body and exact navigation fields.",
  },
  {
    name: "get_card",
    description:
      "Fetch a single Card by id, returning body, frontmatter, linked_chunks (with version_pin), freshness_state, and author_review_state.",
  },
  {
    name: "list_context_sources",
    description:
      "Enumerate every imported source with chunk counts, scope summary, and last index time. Cheap; safe on session-start.",
  },
  {
    name: "get_setup_readiness",
    description:
      "Repo-level setup readiness across four dimensions (corpus_coverage, scope_coverage, card_coverage, retrieval_probes) with a deterministic next-step suggestion. Call this at session-start before coding work.",
  },
  {
    name: "propose_setup_questions",
    description:
      "Return setup readiness plus the 0-3 highest-leverage setup questions for an agent-guided setup conversation. Agents should treat pending inbox work as a curation stream, not a raw approval queue: accept/ignore obvious items and present only high-leverage semantic questions as multiple-choice questions when the host UI supports it. Read-only and safe on session-start before coding.",
  },
  {
    name: "answer_setup_question",
    description:
      "Answer one proposed setup question and return a typed setup action preview. This does not accept Cards, edit accepted Cards, execute commands, or silently promote candidates into truth; Card acceptance stays in explicit inbox triage/curation.",
  },
  {
    name: "sync_ledger",
    description:
      "Check or apply ContextTrail session-resume sync for this repo. Defaults to check mode over MCP; pass check=false only when the user wants writes. After apply, call propose_setup_questions to surface stale Card review prompts.",
  },
] as const;

export const TOOL_NAMES: readonly ToolName[] = TOOL_REGISTRY.map((tool) => tool.name);

const MAX_MODEL_VISIBLE_RANKED_REFS = 8;
const MAX_MODEL_VISIBLE_LOCKED_REFS = 5;
const MAX_MODEL_VISIBLE_WARNINGS = 5;
const MAX_BREADCRUMB_CHARS = 180;

export function isToolName(name: string): name is ToolName {
  return TOOL_NAMES.includes(name as ToolName);
}

export function formatModelVisibleToolText(name: ToolName, result: unknown): string {
  if (name === "retrieve_context_pack") {
    return formatRetrieveContextPackRefs(result as RetrieveContextPackOutputT);
  }
  if (name === "sync_ledger") {
    return formatSyncLedgerRefs(result as SyncLedgerOutputT);
  }
  return JSON.stringify(result);
}

function formatSyncLedgerRefs(result: SyncLedgerOutputT): string {
  const lines = [
    `ContextTrail sync ${result.mode}`,
    `sources: ${result.freshness.stale_doc_sources.length} stale doc, ${result.freshness.stale_code_sources.length} stale code, ${result.freshness.missing_sources.length} missing`,
    `cards: ${result.cards.after.total} total, ${result.cards.after.needs_review} needs_review`,
    `writes: ${result.writes.length}`,
  ];
  if (result.actions.length > 0) {
    lines.push("actions:");
    for (const action of result.actions.slice(0, 8)) {
      lines.push(`- ${action.kind}: ${truncate(action.description, 140)}`);
    }
    if (result.actions.length > 8) {
      lines.push(`- ... ${result.actions.length - 8} more action(s)`);
    }
  }
  if (result.cards.newly_needs_review.length > 0) {
    lines.push("review Cards:");
    for (const card of result.cards.newly_needs_review.slice(0, 8)) {
      lines.push(`- ${card.id}: ${truncate(card.title, 120)} (${card.freshness_reason})`);
    }
  }
  return lines.join("\n");
}

function formatRetrieveContextPackRefs(pack: RetrieveContextPackOutputT): string {
  const lines: string[] = [
    "ContextTrail context refs",
    `coverage=${pack.coverage_confidence} query_mode=${pack.query_mode} assembly=${pack.assembly_stage_reached}`,
    `budget=${pack.budget.used}/${pack.budget.requested} tokens locked_overhead=${pack.budget.locked_overhead}`,
  ];
  if (pack.budget.code_lane) {
    lines.push(
      `code_lane=triggered reserved=${pack.budget.code_lane.reserved} used=${pack.budget.code_lane.used}`,
    );
  }

  if (pack.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const w of pack.warnings.slice(0, MAX_MODEL_VISIBLE_WARNINGS)) {
      lines.push(`- ${w.kind}: ${truncate(w.message, 160)}${w.hint ? ` (${truncate(w.hint, 120)})` : ""}`);
    }
    if (pack.warnings.length > MAX_MODEL_VISIBLE_WARNINGS) {
      lines.push(`- ... ${pack.warnings.length - MAX_MODEL_VISIBLE_WARNINGS} more warning(s)`);
    }
  }

  if (pack.recovery_plan !== undefined) {
    lines.push("", "Recovery plan:");
    lines.push(`- action: ${pack.recovery_plan.action}`);
    lines.push(`- hint: ${truncate(pack.recovery_plan.hint, 180)}`);
    if (pack.recovery_plan.follow_up_searches.length > 0) {
      lines.push(`- follow-up searches: ${pack.recovery_plan.follow_up_searches.slice(0, 3).join(" | ")}`);
    }
    if (pack.recovery_plan.anchor_requests.length > 0) {
      lines.push(`- useful anchors: ${pack.recovery_plan.anchor_requests.slice(0, 3).join(", ")}`);
    }
  }

  if (pack.locked.length > 0) {
    lines.push("", "Locked cards:");
    for (const entry of pack.locked.slice(0, MAX_MODEL_VISIBLE_LOCKED_REFS)) {
      lines.push(
        `- ${entry.id} ${truncate(entry.contexttrail, MAX_BREADCRUMB_CHARS)} ` +
          `[${entry.card_type}, tokens=${entry.tokens}, freshness=${entry.freshness_state}]`,
      );
    }
    if (pack.locked.length > MAX_MODEL_VISIBLE_LOCKED_REFS) {
      lines.push(`- ... ${pack.locked.length - MAX_MODEL_VISIBLE_LOCKED_REFS} more locked card(s)`);
    }
  }

  if (pack.ranked.length > 0) {
    lines.push("", "Ranked refs:");
    for (const [i, entry] of pack.ranked.slice(0, MAX_MODEL_VISIBLE_RANKED_REFS).entries()) {
      lines.push(
        `${i + 1}. ${entry.id} ${truncate(entry.contexttrail, MAX_BREADCRUMB_CHARS)} ` +
          `[${entry.kind}, score=${entry.score.toFixed(3)}, tokens=${entry.tokens}]`,
      );
    }
    if (pack.ranked.length > MAX_MODEL_VISIBLE_RANKED_REFS) {
      lines.push(`... ${pack.ranked.length - MAX_MODEL_VISIBLE_RANKED_REFS} more ranked ref(s) in structuredContent`);
    }
  } else {
    lines.push("", "Ranked refs: none");
  }

  lines.push(
    "",
    `Omitted: ${pack.omitted.total} total` +
      (pack.omitted.truncated ? `, ${pack.omitted.top.length} sampled in structuredContent` : ""),
    "Fetch exact bodies with get_doc_chunk({ version_id }), get_code_chunk({ version_id }), or get_card({ id }) for the refs you will use.",
  );

  if (pack.rendered_text !== undefined) {
    lines.push("Full rendered_text is present in structuredContent because include_rendered_text=true.");
  }

  return lines.join("\n");
}

function truncate(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(0, maxChars - 3))}...`;
}
