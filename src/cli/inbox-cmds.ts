import { getInboxItem, listInboxItems } from "../inbox/items.js";
import type {
  InboxItem,
} from "../inbox/items.js";
import {
  acceptCandidateReviewItem,
  answerClarificationReviewItem,
  type ReviewAcceptResult,
  type ReviewAnswerInput,
  type ReviewAnswerResult,
} from "../review/flow.js";
import { importAcceptedCards } from "../cards/lifecycle.js";

export type InboxListEntry = {
  id: string;
  review_type: InboxItem["review_type"];
  status: InboxItem["status"];
  title: string;
  created_at: string;
};

export type InboxListFilters = {
  /** Max rows to return; default 20. */
  limit?: number;
  type?: InboxItem["review_type"];
  status?: InboxItem["status"];
};

export type InboxListView = {
  rows: InboxListEntry[];
  /** Total items in the inbox (unfiltered). */
  total: number;
  /** Total items after filters applied (before limit). */
  total_filtered: number;
  type_counts: Record<InboxItem["review_type"], number>;
  status_counts: Record<InboxItem["status"], number>;
  /** Inclusive 1-based shown range; null when total_filtered is 0. */
  shown_range: { start: number; end: number } | null;
  filters: { type?: InboxItem["review_type"]; status?: InboxItem["status"]; limit: number };
};

export const DEFAULT_INBOX_LIST_LIMIT = 20;

const STATUS_ORDER: Record<InboxItem["status"], number> = {
  pending: 0,
  answered: 1,
  accepted: 2,
  rejected: 3,
};
const TYPE_ORDER: Record<InboxItem["review_type"], number> = {
  candidate_card: 0,
  clarification_need: 1,
};

function toEntry(item: InboxItem): InboxListEntry {
  return {
    id: item.id,
    review_type: item.review_type,
    status: item.status,
    title: item.title,
    created_at: item.created_at,
  };
}

/**
 * Sort pending first, candidate_card before clarification_need, then id
 * ascending. Higher-value review work surfaces first when a user runs
 * `contexttrail inbox list`.
 */
function compareEntries(a: InboxListEntry, b: InboxListEntry): number {
  const sa = STATUS_ORDER[a.status] ?? 99;
  const sb = STATUS_ORDER[b.status] ?? 99;
  if (sa !== sb) return sa - sb;
  const ta = TYPE_ORDER[a.review_type] ?? 99;
  const tb = TYPE_ORDER[b.review_type] ?? 99;
  if (ta !== tb) return ta - tb;
  return a.id.localeCompare(b.id);
}

export function runInboxList(
  cwd: string,
  filters: InboxListFilters = {},
): InboxListView {
  const all = listInboxItems(cwd).map(toEntry);
  const total = all.length;
  const type_counts: Record<InboxItem["review_type"], number> = {
    candidate_card: 0,
    clarification_need: 0,
  };
  const status_counts: Record<InboxItem["status"], number> = {
    pending: 0,
    accepted: 0,
    rejected: 0,
    answered: 0,
  };
  for (const e of all) {
    type_counts[e.review_type]++;
    status_counts[e.status]++;
  }

  const limit = filters.limit && filters.limit > 0
    ? filters.limit
    : DEFAULT_INBOX_LIST_LIMIT;
  const filtered = all
    .filter((e) => !filters.type || e.review_type === filters.type)
    .filter((e) => !filters.status || e.status === filters.status);
  filtered.sort(compareEntries);
  const rows = filtered.slice(0, limit);
  const shown_range = rows.length === 0
    ? null
    : { start: 1, end: rows.length };
  return {
    rows,
    total,
    total_filtered: filtered.length,
    type_counts,
    status_counts,
    shown_range,
    filters: { type: filters.type, status: filters.status, limit },
  };
}

export function renderInboxList(view: InboxListView): string {
  if (view.total === 0) {
    return "contexttrail inbox list: no review items\n";
  }
  const lines: string[] = [];
  // Header: total + type breakdown
  lines.push(
    `Inbox: ${view.total} total — ${view.type_counts.candidate_card} candidate_card, ${view.type_counts.clarification_need} clarification_need`,
  );
  lines.push(
    `Pending: ${view.status_counts.pending}  Answered: ${view.status_counts.answered}  Accepted: ${view.status_counts.accepted}  Rejected: ${view.status_counts.rejected}`,
  );
  const filterBits: string[] = [];
  if (view.filters.type) filterBits.push(`type=${view.filters.type}`);
  if (view.filters.status) filterBits.push(`status=${view.filters.status}`);
  const filterSummary = filterBits.length > 0
    ? ` (filtered: ${filterBits.join(", ")})`
    : "";
  if (view.shown_range) {
    lines.push(
      `Showing ${view.shown_range.start}-${view.shown_range.end} of ${view.total_filtered}${filterSummary} (use --limit, --type, --status to refine)`,
    );
  } else {
    lines.push(`No items match the current filters${filterSummary}.`);
  }
  lines.push("");

  if (view.rows.length > 0) {
    const header = ["id", "type", "status", "created", "title"];
    const widths = [14, 20, 10, 20, 48];
    const cells = [
      header,
      ...view.rows.map((row) => [
        row.id,
        row.review_type,
        row.status,
        row.created_at.slice(0, 19),
        row.title.length > 48 ? row.title.slice(0, 45) + "..." : row.title,
      ]),
    ];
    lines.push(
      cells
        .map((row) => row.map((cell, i) => cell.padEnd(widths[i] ?? 8)).join(" "))
        .join("\n"),
    );
  }

  // Footer: pagination hint when there are more items than shown.
  if (view.shown_range && view.total_filtered > view.shown_range.end) {
    lines.push("");
    lines.push(
      `Showing ${view.shown_range.start}-${view.shown_range.end} of ${view.total_filtered}. More items exist; use --limit or --type to refine.`,
    );
  }
  return lines.join("\n") + "\n";
}

export function runInboxShow(cwd: string, id: string): InboxItem | null {
  return getInboxItem(cwd, id);
}

export type InboxAcceptResult = ReviewAcceptResult;
export type InboxAnswerInput = ReviewAnswerInput;
export type InboxAnswerResult = ReviewAnswerResult;

export function runInboxAccept(cwd: string, id: string): InboxAcceptResult | null {
  const accepted = acceptCandidateReviewItem(cwd, id);
  if (!accepted) return null;
  importAcceptedCards(cwd);
  return accepted;
}

export function runInboxAnswer(
  cwd: string,
  id: string,
  input: InboxAnswerInput,
): InboxAnswerResult | null {
  return answerClarificationReviewItem(cwd, id, input);
}

function scopeSummary(scope: {
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

export function renderInboxShow(item: InboxItem): string {
  const lines = [
    `id: ${item.id}`,
    `type: ${item.review_type}`,
    `status: ${item.status}`,
    `title: ${item.title}`,
    `created_at: ${item.created_at}`,
    `updated_at: ${item.updated_at}`,
    `authored_by: ${item.authored_by ?? "contexttrail-bootstrap"}`,
  ];
  if (item.review_type === "candidate_card") {
    lines.push(`candidate_type: ${item.candidate_type}`);
    lines.push(`scope: ${scopeSummary(item.scope)}`);
    if (item.symbol_anchors && item.symbol_anchors.length > 0) {
      lines.push(`symbol_anchors: ${item.symbol_anchors.join(", ")}`);
    }
    lines.push("trace_history:");
    const traceHistory = item.trace_history ?? [];
    if (traceHistory.length === 0) {
      lines.push("  - none");
    } else {
      for (const entry of traceHistory) {
        lines.push(
          `  - ${entry.kind} ${entry.source_review_item_id} (${entry.materiality}) — ${entry.summary}`,
        );
      }
    }
    lines.push("supporting chunks:");
    if (item.supporting_chunks.length === 0) {
      lines.push("  - none");
    } else {
      for (const chunk of item.supporting_chunks) {
        const heading = chunk.heading_path.length > 0 ? `#${chunk.heading_path.join(" > ")}` : "";
        lines.push(`  - ${chunk.source_path}${heading} (${chunk.chunk_stable_key})`);
      }
    }
  } else {
    lines.push("choices:");
    if (item.choices.length === 0) {
      lines.push("  - none");
    } else {
      for (const choice of item.choices) {
        const description = choice.description ? ` — ${choice.description}` : "";
        lines.push(`  - ${choice.id}: ${choice.label}${description}`);
      }
    }
    lines.push(`free_text_allowed: ${item.free_text_allowed ? "yes" : "no"}`);
    lines.push(
      `affects_candidates: ${item.affects_candidate_ids.length > 0 ? item.affects_candidate_ids.join(", ") : "none"}`,
    );
    if (item.rewrite_rules.length > 0) {
      lines.push("rewrite_rules:");
      for (const rule of item.rewrite_rules) {
        const match = rule.match ? ` match=${rule.match}` : "";
        lines.push(
          `  - ${rule.target}${match} -> ${rule.replacement_template} (${rule.materiality})`,
        );
      }
    }
    if (item.answered_text) {
      lines.push(`answer: ${item.answered_text}`);
    }
  }
  lines.push("");
  lines.push(item.body);
  lines.push("");
  return lines.join("\n");
}
