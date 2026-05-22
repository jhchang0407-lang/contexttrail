/**
 * Single source of truth for MCP tool contracts.
 *
 * Each tool exposes `.input` and `.output` zod schemas. JSONSchema for MCP
 * `tools/list` registration is derived once via `toJSONSchema()`; TypeScript
 * types are derived via `z.infer<>` so handler signatures cannot drift from
 * the wire format.
 *
 * Contract is locked at PRD-0003 checkpoint 4b. After that, breaking shape
 * changes require a new ADR.
 */
import { z } from "zod";
import {
  AUTHOR_REVIEW_STATES,
  CARD_LINK_TYPES,
  CARD_TYPES,
  FRESHNESS_STATES,
} from "../types/card.js";
import { CHUNK_STATUSES } from "../types/chunk.js";
import { OMITTED_REASONS } from "../retrieve/pack.js";
import {
  CODE_CHUNK_ROLES,
  CODE_DECLARATION_KINDS,
} from "../types/code-source.js";

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

const ScopeShape = z.object({}).passthrough();

const WorkspaceInput = {
  cwd: z.string().min(1).optional(),
};

const FreshnessState = z.enum(FRESHNESS_STATES);

const FreshnessReason = z.enum([
  "all_links_current",
  "no_links",
  "version_drift",
  "tombstoned_link",
]);

const CardType = z.enum(CARD_TYPES);
const CodeRole = z.enum(CODE_CHUNK_ROLES);
const CodeDeclarationKind = z.enum(CODE_DECLARATION_KINDS);

const LockReason = z.enum([
  "constraint_scope_match",
  "symbol_note_exact",
  "evidence_covers_locked",
]);

const WarningKind = z.enum([
  "no_matches",
  "no_sources",
  "locked_overflow",
  "anchors_unrecognized",
  "low_confidence",
  // PRD-0035 / slice 35.2 — pre-retrieve freshness check.
  "stale_source",
  "missing_source",
]);

const OmittedReason = z.enum(OMITTED_REASONS);

const QueryMode = z.enum(["anchored", "signal_empty", "unanchored"]);
const AssemblyStage = z
  .enum(["not_applicable", "primary_only", "parent", "siblings", "source_sibling", "linked_neighbor"])
  .default("not_applicable");

const LockFailureReason = z.enum([
  "missing_inferred_scope_field",
  "scope_mismatch",
  "no_query_scope",
  "symbol_not_exact",
  "filtered_stale",
  "not_lockable_type",
]);

// ---------------------------------------------------------------------------
// retrieve_context_pack
// ---------------------------------------------------------------------------

const RetrieveContextPackInput = z.object({
  ...WorkspaceInput,
  task: z.string().min(1),
  files: z.array(z.string()).optional(),
  symbols: z.array(z.string()).optional(),
  routes: z.array(z.string()).optional(),
  budget: z.enum(["small", "default", "large"]).optional(),
  expected_locked: z.array(z.string()).optional(),
  explain: z.boolean().optional(),
  include_rendered_text: z.boolean().optional(),
});

const LockedEntry = z.object({
  id: z.string(),
  kind: z.literal("card"),
  card_type: CardType,
  scope: ScopeShape,
  tokens: z.number().int().nonnegative(),
  body: z.string(),
  contexttrail: z.string(),
  lock_reason: LockReason,
  derived_from: z.array(z.string()).optional(),
  broad_scope: z.boolean(),
  freshness_state: FreshnessState,
  freshness_warnings: z.array(z.string()),
});

const RankedEntry = z.object({
  id: z.string(),
  // PRD-0028 / slice 28.3 adds "code" as a peer kind alongside "chunk" /
  // "card". Code entries are sourced from the code_sources FTS index and
  // gated by the RETRIEVAL_CODE_SOURCE_INDEX flag.
  kind: z.enum(["chunk", "card", "code"]),
  scope: ScopeShape,
  tokens: z.number().int().nonnegative(),
  score: z.number(),
  body: z.string(),
  contexttrail: z.string(),
  type_bias_applied: z.boolean(),
  source_path: z.string().optional(),
  start_line: z.number().int().positive().optional(),
  end_line: z.number().int().positive().optional(),
  symbol_path: z.string().nullable().optional(),
  code_role: CodeRole.optional(),
  support_cluster: z
    .object({
      role: z.enum(["primary", "support"]),
      seed_source_path: z.string(),
      distance: z.number().int().nonnegative(),
      reason: z.enum([
        "primary_winner",
        "code_family_evidence",
        "owner_fanout",
        "shared_support_import",
        "support_config",
        "support_substrate_bundle",
        "outgoing_import",
        "incoming_import",
        "nearby_import",
        "same_family_substrate",
      ]),
      relevance: z.number(),
      family_evidence: z
        .object({
          families: z.array(z.string()),
          roles: z.array(z.string()),
          direct_query_tokens: z.array(z.string()),
          reasons: z.array(z.string()),
          score: z.number(),
          first_slate_promotable: z.boolean(),
          support_admissible: z.boolean(),
        })
        .optional(),
      facility_evidence: z
        .object({
          facility_tags: z.array(z.string()),
          query_intents: z.array(z.string()),
          direct_query_tokens: z.array(z.string()),
          shared_domain_tokens: z.array(z.string()),
          reasons: z.array(z.string()),
          score: z.number(),
          support_admissible: z.boolean(),
        })
        .optional(),
    })
    .optional(),
});

const OmittedEntry = z.object({
  id: z.string(),
  kind: z.enum(["chunk", "card", "code"]),
  reason: OmittedReason,
  score: z.number(),
});

const OmittedSummary = z.object({
  total: z.number().int().nonnegative(),
  by_reason: z.record(OmittedReason, z.number().int().nonnegative()),
  top: z.array(OmittedEntry),
  truncated: z.boolean(),
});

const Warning = z.object({
  kind: WarningKind,
  message: z.string(),
  hint: z.string().optional(),
});

const BudgetBlock = z.object({
  requested: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
  locked_overhead: z.number().int().nonnegative(),
  code_lane: z
    .object({
      triggered: z.boolean(),
      reserved: z.number().int().nonnegative(),
      used: z.number().int().nonnegative(),
    })
    .optional(),
});

const ExplainPerChunk = z.object({
  id: z.string(),
  bm25_norm: z.number(),
  heading_match: z.number(),
  scope_match: z.number(),
  mention_overlap: z.number(),
  specificity: z.number(),
  text_score: z.number(),
  final_score: z.number(),
  packing_score: z.number(),
  structural_multiplier: z.number().optional(),
  doc_role: z.enum(["canonical", "ideation", "example", "archive"]).optional(),
  role_source: z.enum(["frontmatter", "config_pattern", "default"]).optional(),
  role_multiplier: z.number().optional(),
  included: z.boolean(),
  reason: z.string(),
});

const QueryCompilationAnchor = z.object({
  anchor: z.object({
    kind: z.enum(["file", "symbol", "route"]),
    value: z.string(),
  }),
  recognition: z.enum(["scope_inferred", "exact_anchor_only", "none"]),
  mode: z.enum(["anchor_derived", "source_profile_alias", "code_scopes_fallback", "none"]),
  scopes: z.array(ScopeShape),
  contributing_anchors: z.array(
    z.object({
      object_id: z.string(),
      kind: z.enum(["card", "chunk"]),
      value: z.string(),
      confidence: z.enum(["high", "medium", "low", "ambiguous"]),
      match_source: z
        .enum(["code_anchor", "source_profile", "code_scope", "path_component"])
        .optional(),
      match_kind: z
        .enum([
          "exact",
          "case_insensitive",
          "symbol_form_variant",
          "source_path_exact",
          "source_path_suffix",
          "source_basename",
          "source_basename_without_extension",
          "source_alias_path",
          "source_alias_filename",
          "source_alias_package",
          "source_text_filename",
          "code_scope_rule",
          "path_component_segment",
        ])
        .optional(),
      source_path: z.string().optional(),
    }),
  ),
});

const QueryCompilation = z.object({
  query_mode: QueryMode,
  provided_anchor_count: z.number().int().nonnegative(),
  recognized_anchor_count: z.number().int().nonnegative(),
  anchors: z.array(QueryCompilationAnchor),
});

const PackReadinessExplain = z.object({
  state: z.enum(["ready", "partial", "needs_anchors", "unsupported"]),
  needs: z.array(z.string()),
  satisfied_needs: z.array(z.string()),
  missing_needs: z.array(z.string()),
  reason_codes: z.array(z.string()),
});

const RecoveryAction = z.enum([
  "answer",
  "answer_with_caveat",
  "inspect_pack_or_retry",
  "retry_with_followup_searches",
  "ask_for_anchors",
  "abstain",
]);

const RecoveryPlanReasonCode = z.enum([
  "no_evidence",
  "anchors_unrecognized",
  "coverage_uncertain",
  "must_include_missing",
  "primary_missing",
  "intro_missing",
  "sibling_missing",
  "parent_missing",
  "exact_symbol_missing",
  "cross_module_boundary_missing",
  "all_needs_satisfied",
  "ambiguous_top_family",
  "pack_ready",
  "ranked_context_available",
  "insufficient_ranked_context",
  "needs_user_anchor",
  "retry_can_expand_query",
  "safe_to_answer_with_caveat",
]);

const RecoveryPlan = z.object({
  action: RecoveryAction,
  reason_codes: z.array(RecoveryPlanReasonCode),
  hint: z.string(),
  follow_up_searches: z.array(z.string()),
  anchor_requests: z.array(z.string()),
});

const ExplainBlock = z.object({
  per_chunk: z.array(ExplainPerChunk),
  query_compilation: QueryCompilation,
  lock_failures: z.array(
    z.object({
      card_id: z.string(),
      card_type: CardType,
      candidate_match_path: z.string(),
      failed_reason: LockFailureReason,
      detail: z.string().optional(),
    }),
  ).default([]),
  assembly: z
    .object({
      root_version_id: z.string().optional(),
      selected_neighbors: z.array(
        z.object({
          version_id: z.string(),
          relation: z.enum(["parent", "siblings", "source_sibling", "linked_neighbor"]),
          reason: z.string(),
        }),
      ),
      early_stop_reason: z.string().optional(),
    })
    .optional(),
  /** PRD-0015 Slice 5: internal pack-readiness diagnostics. Surfaced
   *  under `explain` so the public response shape stays unchanged for
   *  callers that don't request explain. Promotion to a top-level
   *  `task_readiness` contract is deferred (THO-157). */
  pack_readiness: PackReadinessExplain.optional(),
});

const CoverageConfidence = z.enum(["confident", "uncertain", "empty"]);

const RetrieveContextPackOutput = z.object({
  rendered_text: z.string().optional(),
  query_mode: QueryMode,
  /** ADR-0019 Phase C1: corpus-coverage state of the resulting top-1.
   *  Distinguishes "the engine returned a confident answer" from "engine
   *  returned its best guess but corpus has nothing relevant." This is
   *  separate from `query_mode`, which reports anchor-recognition state
   *  (whether caller-supplied anchors resolved). */
  coverage_confidence: CoverageConfidence,
  assembly_stage_reached: AssemblyStage,
  locked: z.array(LockedEntry),
  ranked: z.array(RankedEntry),
  omitted: OmittedSummary,
  warnings: z.array(Warning),
  budget: BudgetBlock,
  recovery_plan: RecoveryPlan.optional(),
  explain: ExplainBlock.optional(),
});

// ---------------------------------------------------------------------------
// get_doc_chunk
// ---------------------------------------------------------------------------

const ChunkStatus = z.enum(CHUNK_STATUSES);

const CodeAnchor = z.object({}).passthrough();

const GetDocChunkInput = z
  .object({
    ...WorkspaceInput,
    version_id: z.string().optional(),
    stable_key: z.string().optional(),
  })
  .refine((v) => !!v.version_id || !!v.stable_key, {
    message: "one of `version_id` or `stable_key` is required",
  });

const GetDocChunkOutput = z.object({
  version_id: z.string(),
  stable_key: z.string(),
  source_path: z.string(),
  heading_path: z.array(z.string()),
  contexttrail: z.string(),
  scope: ScopeShape,
  body: z.string(),
  code_anchors: z.array(CodeAnchor),
  freshness_state: FreshnessState,
  status: ChunkStatus,
  tokens: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// get_code_chunk
// ---------------------------------------------------------------------------

const GetCodeChunkInput = z
  .object({
    ...WorkspaceInput,
    version_id: z.string().min(1).optional(),
    source_path: z.string().min(1).optional(),
    symbol_path: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const hasVersion = value.version_id !== undefined;
    const hasLogical = value.source_path !== undefined || value.symbol_path !== undefined;
    if (!hasVersion && !(value.source_path && value.symbol_path)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "provide either version_id or source_path + symbol_path",
      });
    }
    if (hasVersion && hasLogical) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "use either version_id or source_path + symbol_path, not both",
      });
    }
    if (!hasVersion && (value.source_path === undefined || value.symbol_path === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "source_path and symbol_path must be provided together",
      });
    }
  });

const GetCodeChunkOutput = z.object({
  version_id: z.string(),
  stable_key: z.string(),
  source_path: z.string(),
  symbol_path: z.string().nullable(),
  code_role: CodeRole,
  declaration_kind: CodeDeclarationKind.nullable(),
  exported: z.boolean(),
  body: z.string(),
  contexttrail: z.string(),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  status: z.literal("current"),
  tokens: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// get_card
// ---------------------------------------------------------------------------

const AuthorReviewState = z.enum(AUTHOR_REVIEW_STATES);

const LinkType = z.enum(CARD_LINK_TYPES);

const LinkedChunk = z.object({
  version_pin: z.string(),
  contexttrail: z.string(),
  link_type: LinkType,
});

const GetCardInput = z.object({
  ...WorkspaceInput,
  id: z.string().min(1),
});

const GetCardOutput = z.object({
  id: z.string(),
  card_type: CardType,
  scope: ScopeShape,
  body: z.string(),
  frontmatter: z.object({}).passthrough(),
  linked_chunks: z.array(LinkedChunk),
  freshness_state: FreshnessState,
  freshness_warnings: z.array(z.string()),
  author_review_state: AuthorReviewState,
});

// ---------------------------------------------------------------------------
// list_context_sources
// ---------------------------------------------------------------------------

const ContextSource = z.object({
  source_path: z.string(),
  scope_summary: z.string(),
  scope: ScopeShape,
  chunk_count: z.number().int().nonnegative(),
  last_indexed_at: z.string(),
});

const ListContextSourcesInput = z.object(WorkspaceInput);

const ListContextSourcesOutput = z.object({
  sources: z.array(ContextSource),
});

// ---------------------------------------------------------------------------
// get_setup_readiness (PRD-0033 / THO-251)
// ---------------------------------------------------------------------------

const ReadinessBandEnum = z.enum(["low", "partial", "confident"]);

const DimensionReport = z.object({
  score: ReadinessBandEnum,
  evidence: z.object({}).passthrough(),
});

const NextStepSuggestion = z.object({
  row_name: z.string(),
  command: z.string().nullable(),
  message: z.string(),
});

const GetSetupReadinessInput = z.object(WorkspaceInput);

const GetSetupReadinessOutput = z.object({
  cwd: z.string(),
  dimensions: z.object({
    corpus_coverage: DimensionReport,
    scope_coverage: DimensionReport,
    card_coverage: DimensionReport,
    retrieval_probes: DimensionReport,
  }),
  suggestion: NextStepSuggestion,
  pending_inbox_items: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// propose_setup_questions (PRD-0037 / THO-267)
// ---------------------------------------------------------------------------

const SetupQuestionKind = z.enum([
  "import_docs",
  "review_inbox",
  "review_stale_cards",
  "doc_role_choice",
  "scope_recovery",
  "mcp_wiring",
  "validate_context",
]);

const SetupQuestionImpactDimension = z.enum([
  "corpus_coverage",
  "scope_coverage",
  "card_coverage",
  "retrieval_probes",
]);

const SetupQuestion = z.object({
  id: z.string().min(1),
  kind: SetupQuestionKind,
  prompt: z.string().min(1),
  reason: z.string().min(1),
  impact: z.object({
    dimensions: z.array(SetupQuestionImpactDimension).min(1),
    affected_items: z.number().int().nonnegative().optional(),
  }),
  choices: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      description: z.string().optional(),
    }),
  ),
  free_text_allowed: z.boolean(),
  command_preview: z.string().optional(),
});

const ProposeSetupQuestionsInput = z.object(WorkspaceInput);

const ProposeSetupQuestionsOutput = GetSetupReadinessOutput.extend({
  questions: z.array(SetupQuestion).max(3),
});

// ---------------------------------------------------------------------------
// answer_setup_question (PRD-0037 / THO-268)
// ---------------------------------------------------------------------------

const AnswerSetupQuestionInput = z.object({
  ...WorkspaceInput,
  question_id: z.string().min(1),
  choice_id: z.string().min(1).optional(),
  free_text: z.string().min(1).optional(),
});

const AnswerSetupQuestionOutput = z.object({
  cwd: z.string(),
  question_id: z.string().min(1),
  kind: SetupQuestionKind,
  choice_id: z.string().optional(),
  text: z.string().optional(),
  action: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("command_preview"),
      command: z.string().min(1),
      message: z.string().min(1),
    }),
    z.object({
      type: z.literal("inbox_answer_applied"),
      review_item_id: z.string().min(1),
      answer_text: z.string().min(1),
      updated_candidate_ids: z.array(z.string()),
      message: z.string().min(1),
    }),
  ]),
  writes: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// sync_ledger (PRD-0039)
// ---------------------------------------------------------------------------

const SyncLedgerInput = z.object({
  ...WorkspaceInput,
  check: z.boolean().optional(),
  refresh_candidates: z.boolean().optional(),
});

const SyncFreshness = z.object({
  stale_doc_sources: z.array(z.string()),
  stale_code_sources: z.array(z.string()),
  missing_sources: z.array(z.string()),
});

const SyncActionKind = z.enum([
  "init",
  "import_docs",
  "refresh_code_sources",
  "index_missing",
  "import_cards",
  "refresh_candidates",
]);

const SyncAction = z.object({
  kind: SyncActionKind,
  description: z.string().min(1),
  paths: z.array(z.string()),
});

const SyncCardCounts = z.object({
  total: z.number().int().nonnegative(),
  verified: z.number().int().nonnegative(),
  unverified: z.number().int().nonnegative(),
  needs_review: z.number().int().nonnegative(),
  maybe_affected: z.number().int().nonnegative(),
  potentially_superseded: z.number().int().nonnegative(),
  manual_needs_review: z.number().int().nonnegative(),
});

const SyncLedgerOutput = z.object({
  cwd: z.string(),
  mode: z.enum(["check", "apply"]),
  initialized: z.boolean(),
  actions: z.array(SyncAction),
  writes: z.array(z.string()),
  freshness: SyncFreshness,
  cards: z.object({
    before: SyncCardCounts,
    after: SyncCardCounts,
    newly_needs_review: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        freshness_reason: FreshnessReason,
      }),
    ),
    already_needs_review: z.array(z.string()),
  }),
  inbox: z.object({
    pending_total: z.number().int().nonnegative(),
    candidate_cards: z.number().int().nonnegative(),
    clarification_needs: z.number().int().nonnegative(),
  }),
  init: z.object({}).passthrough().optional(),
  doc_import: z.object({}).passthrough().optional(),
  code_import: z.object({ files_indexed: z.number().int().nonnegative() }).optional(),
  index: z.object({}).passthrough().optional(),
  card_import: z.object({}).passthrough().optional(),
  candidate_refresh: z.object({}).passthrough().optional(),
});

// ---------------------------------------------------------------------------
// schemas registry
// ---------------------------------------------------------------------------

export const schemas = {
  retrieve_context_pack: {
    input: RetrieveContextPackInput,
    output: RetrieveContextPackOutput,
  },
  get_doc_chunk: {
    input: GetDocChunkInput,
    output: GetDocChunkOutput,
  },
  get_code_chunk: {
    input: GetCodeChunkInput,
    output: GetCodeChunkOutput,
  },
  get_card: {
    input: GetCardInput,
    output: GetCardOutput,
  },
  list_context_sources: {
    input: ListContextSourcesInput,
    output: ListContextSourcesOutput,
  },
  get_setup_readiness: {
    input: GetSetupReadinessInput,
    output: GetSetupReadinessOutput,
  },
  propose_setup_questions: {
    input: ProposeSetupQuestionsInput,
    output: ProposeSetupQuestionsOutput,
  },
  answer_setup_question: {
    input: AnswerSetupQuestionInput,
    output: AnswerSetupQuestionOutput,
  },
  sync_ledger: {
    input: SyncLedgerInput,
    output: SyncLedgerOutput,
  },
} as const;

export type ToolName = keyof typeof schemas;

export type RetrieveContextPackOutputT = z.infer<typeof RetrieveContextPackOutput>;
export type GetDocChunkOutputT = z.infer<typeof GetDocChunkOutput>;
export type GetCodeChunkOutputT = z.infer<typeof GetCodeChunkOutput>;
export type GetCardOutputT = z.infer<typeof GetCardOutput>;
export type ListContextSourcesOutputT = z.infer<typeof ListContextSourcesOutput>;
export type GetSetupReadinessOutputT = z.infer<typeof GetSetupReadinessOutput>;
export type ProposeSetupQuestionsOutputT = z.infer<typeof ProposeSetupQuestionsOutput>;
export type AnswerSetupQuestionOutputT = z.infer<typeof AnswerSetupQuestionOutput>;
export type SyncLedgerOutputT = z.infer<typeof SyncLedgerOutput>;
