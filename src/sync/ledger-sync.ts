import { join } from "node:path";
import { importAcceptedCards, type CardImportSummary } from "../cards/lifecycle.js";
import { runCardBootstrap, type CardBootstrapResult } from "../cli/card-bootstrap.js";
import type { ImportSummary } from "../cli/import.js";
import type { IndexSummary } from "../cli/index-cmd.js";
import {
  documentSourceImportPatterns,
  importConfiguredDocumentSources,
  listDocumentSources,
} from "../config/document-sources.js";
import { init, type InitResult } from "../config/init.js";
import { listInboxItems } from "../inbox/items.js";
import { isLedgerInitialized } from "../ledger/context.js";
import { closeDb, openDb } from "../store/db.js";
import { listCards } from "../store/cards.js";
import type { Card, FreshnessState } from "../types/card.js";
import {
  applyFreshnessRepair,
  detectLedgerFreshness,
  type FreshnessResult,
} from "./freshness-repair.js";

export type LedgerSyncActionKind =
  | "init"
  | "sync_document_sources"
  | "import_docs"
  | "index_missing"
  | "import_cards"
  | "refresh_candidates";

export type LedgerSyncAction = {
  kind: LedgerSyncActionKind;
  description: string;
  paths: string[];
};

export type CardFreshnessCounts = Record<FreshnessState, number> & {
  total: number;
  manual_needs_review: number;
};

export type NewlyNeedsReviewCard = {
  id: string;
  title: string;
  freshness_reason: Card["freshness_reason"];
};

export type LedgerSyncResult = {
  cwd: string;
  mode: "check" | "apply";
  initialized: boolean;
  actions: LedgerSyncAction[];
  writes: string[];
  freshness: FreshnessResult;
  cards: {
    before: CardFreshnessCounts;
    after: CardFreshnessCounts;
    newly_needs_review: NewlyNeedsReviewCard[];
    already_needs_review: string[];
  };
  inbox: {
    pending_total: number;
    candidate_cards: number;
    clarification_needs: number;
  };
  init?: InitResult;
  doc_import?: ImportSummary;
  document_source_import?: ImportSummary;
  index?: IndexSummary;
  card_import?: CardImportSummary;
  candidate_refresh?: CardBootstrapResult;
};

export type LedgerSyncOptions = {
  /** When true, report the sync plan without writing. */
  check?: boolean;
  /**
   * Candidate bootstrap stays explicit because provisional candidate refreshes
   * can be noisy on large repos. Accepted Cards are still imported every run.
   */
  refreshCandidates?: boolean;
};

export type RenderLedgerSyncOptions = {
  explain?: boolean;
};

const EMPTY_FRESHNESS: FreshnessResult = {
  stale_doc_sources: [],
  missing_sources: [],
};

export async function runLedgerSync(
  cwd: string,
  options: LedgerSyncOptions = {},
): Promise<LedgerSyncResult> {
  const mode = options.check ? "check" : "apply";
  const initialized = isLedgerInitialized(cwd);

  if (!initialized && options.check) {
    return {
      cwd,
      mode,
      initialized: false,
      actions: [
        {
          kind: "init",
          description: "Initialize ContextTrail cache and hidden repo directories.",
          paths: [".contexttrail/config.yaml", ".contexttrail/cache/contexttrail.db"],
        },
      ],
      writes: [],
      freshness: { ...EMPTY_FRESHNESS },
      cards: {
        before: emptyCardCounts(),
        after: emptyCardCounts(),
        newly_needs_review: [],
        already_needs_review: [],
      },
      inbox: inboxSummary(cwd),
    };
  }

  let initResult: InitResult | undefined;
  const writes: string[] = [];
  if (!initialized) {
    initResult = init(cwd);
    writes.push(".contexttrail/config.yaml", ".contexttrail/cache/contexttrail.db");
    if (initResult.mcp_config_created) writes.push(".mcp.json");
  }

  const beforeCards = readCards(cwd);
  const documentSources = listDocumentSources(cwd);
  let documentSourceImport: ImportSummary | undefined;
  if (!options.check && documentSources.length > 0) {
    documentSourceImport = importConfiguredDocumentSources(cwd);
    writes.push(".contexttrail/cache/contexttrail.db");
  }
  const freshness = detectFreshness(cwd);
  const actions = buildActions({
    initialized,
    freshness,
    documentSourcePaths: documentSourceImportPatterns(documentSources),
    refreshCandidates: options.refreshCandidates ?? false,
  });

  if (options.check) {
    return {
      cwd,
      mode,
      initialized,
      actions,
      writes: [],
      freshness,
      cards: {
        before: countCards(beforeCards),
        after: countCards(beforeCards),
        newly_needs_review: [],
        already_needs_review: beforeCards
          .filter((card) => card.freshness_state === "needs_review")
          .map((card) => card.id),
      },
      inbox: inboxSummary(cwd),
    };
  }

  let docImport: ImportSummary | undefined;
  let indexSummary: IndexSummary | undefined;
  let cardImport: CardImportSummary | undefined;
  let candidateRefresh: CardBootstrapResult | undefined;

  const repair = applyFreshnessRepair(cwd, freshness);
  docImport = repair.doc_import;
  indexSummary = repair.index;
  writes.push(...repair.writes);

  cardImport = importAcceptedCards(cwd);
  writes.push(".contexttrail/cache/contexttrail.db");

  if (options.refreshCandidates) {
    candidateRefresh = await runCardBootstrap(cwd, { llm: false });
    writes.push(".contexttrail/inbox");
  }

  const afterCards = readCards(cwd);
  const transitions = cardTransitions(beforeCards, afterCards);

  return {
    cwd,
    mode,
    initialized: initialized || !!initResult,
    actions,
    writes: unique(writes),
    freshness,
    cards: {
      before: countCards(beforeCards),
      after: countCards(afterCards),
      newly_needs_review: transitions.newly_needs_review,
      already_needs_review: transitions.already_needs_review,
    },
    inbox: inboxSummary(cwd),
    init: initResult,
    doc_import: docImport,
    document_source_import: documentSourceImport,
    index: indexSummary,
    card_import: cardImport,
    candidate_refresh: candidateRefresh,
  };
}

export function renderLedgerSync(
  result: LedgerSyncResult,
  options: RenderLedgerSyncOptions = {},
): string {
  const lines: string[] = [];
  lines.push(`ContextTrail sync (${result.mode})`);
  lines.push(`initialized: ${result.initialized ? "yes" : "no"}`);
  lines.push(
    `sources: ${result.freshness.stale_doc_sources.length} stale doc, ` +
      `${result.freshness.missing_sources.length} missing`,
  );
  if (result.document_source_import) {
    lines.push(
      `document folders: ${result.document_source_import.files_imported} imported, ` +
        `${result.document_source_import.files_unchanged} unchanged`,
    );
  }
  lines.push(
    `cards: ${result.cards.after.total} total, ${result.cards.after.needs_review} needs_review`,
  );
  if (result.actions.length === 0) {
    lines.push("actions: none");
  } else {
    lines.push("actions:");
    for (const action of result.actions) {
      const suffix = action.paths.length > 0 ? ` (${action.paths.length} path(s))` : "";
      lines.push(`- ${action.kind}: ${action.description}${suffix}`);
      if (options.explain) {
        for (const path of action.paths.slice(0, 20)) {
          lines.push(`  - ${path}`);
        }
        if (action.paths.length > 20) {
          lines.push(`  - ... ${action.paths.length - 20} more path(s)`);
        }
      }
    }
  }
  if (options.explain && result.writes.length > 0) {
    lines.push("writes:");
    for (const write of result.writes) lines.push(`- ${write}`);
  }
  if (result.cards.newly_needs_review.length > 0) {
    lines.push("review next:");
    for (const card of result.cards.newly_needs_review) {
      lines.push(`- ${card.id}: ${card.title} (${card.freshness_reason})`);
    }
    lines.push("next: contexttrail card list --needs-review");
  } else if (result.inbox.pending_total > 0) {
    lines.push("next: contexttrail inbox list");
  } else {
    lines.push("next: contexttrail setup questions");
  }
  return `${lines.join("\n")}\n`;
}

function detectFreshness(cwd: string): FreshnessResult {
  return detectLedgerFreshness(cwd, { earlyExit: false });
}

function buildActions(args: {
  initialized: boolean;
  freshness: FreshnessResult;
  documentSourcePaths: string[];
  refreshCandidates: boolean;
}): LedgerSyncAction[] {
  const actions: LedgerSyncAction[] = [];
  if (!args.initialized) {
    actions.push({
      kind: "init",
      description: "Initialize ContextTrail cache and hidden repo directories.",
      paths: [".contexttrail/config.yaml", ".contexttrail/cache/contexttrail.db"],
    });
  }
  if (args.documentSourcePaths.length > 0) {
    actions.push({
      kind: "sync_document_sources",
      description: "Import files from saved local document folders.",
      paths: args.documentSourcePaths,
    });
  }
  if (args.freshness.stale_doc_sources.length > 0) {
    actions.push({
      kind: "import_docs",
      description: "Re-import docs whose on-disk content changed.",
      paths: args.freshness.stale_doc_sources,
    });
  }
  if (args.freshness.missing_sources.length > 0) {
    actions.push({
      kind: "index_missing",
      description: "Tombstone indexed sources that no longer exist on disk.",
      paths: args.freshness.missing_sources,
    });
  }
  actions.push({
    kind: "import_cards",
    description: "Re-import hidden accepted Card files and rebuild freshness.",
    paths: [".contexttrail/cards"],
  });
  if (args.refreshCandidates) {
    actions.push({
      kind: "refresh_candidates",
      description: "Explicitly refresh provisional candidate Cards in the review inbox.",
      paths: [".contexttrail/inbox"],
    });
  }
  return actions;
}

function readCards(cwd: string): Card[] {
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  try {
    return listCards(db);
  } finally {
    closeDb(db);
  }
}

function countCards(cards: Card[]): CardFreshnessCounts {
  const counts = emptyCardCounts();
  for (const card of cards) {
    counts.total += 1;
    counts[card.freshness_state] += 1;
    if (card.author_review_state === "needs_review_manual") {
      counts.manual_needs_review += 1;
    }
  }
  return counts;
}

function emptyCardCounts(): CardFreshnessCounts {
  return {
    total: 0,
    verified: 0,
    unverified: 0,
    needs_review: 0,
    maybe_affected: 0,
    potentially_superseded: 0,
    manual_needs_review: 0,
  };
}

function cardTransitions(
  beforeCards: Card[],
  afterCards: Card[],
): {
  newly_needs_review: NewlyNeedsReviewCard[];
  already_needs_review: string[];
} {
  const beforeById = new Map(beforeCards.map((card) => [card.id, card]));
  const newly_needs_review: NewlyNeedsReviewCard[] = [];
  const already_needs_review: string[] = [];
  for (const after of afterCards) {
    if (after.freshness_state !== "needs_review") continue;
    const before = beforeById.get(after.id);
    if (before?.freshness_state === "needs_review") {
      already_needs_review.push(after.id);
    } else {
      newly_needs_review.push({
        id: after.id,
        title: after.title,
        freshness_reason: after.freshness_reason,
      });
    }
  }
  return {
    newly_needs_review,
    already_needs_review,
  };
}

function inboxSummary(cwd: string): LedgerSyncResult["inbox"] {
  try {
    const pending = listInboxItems(cwd).filter((item) => item.status === "pending");
    return {
      pending_total: pending.length,
      candidate_cards: pending.filter((item) => item.review_type === "candidate_card").length,
      clarification_needs: pending.filter((item) => item.review_type === "clarification_need").length,
    };
  } catch {
    return { pending_total: 0, candidate_cards: 0, clarification_needs: 0 };
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
