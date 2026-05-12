/**
 * MCP tool handlers.
 *
 * Two flavors live here:
 *
 *   - `stubHandlers` — return well-formed empty responses. Used by 4a tests
 *     and any caller that doesn't want a real cache (e.g. cold-start probes).
 *   - `createHandlers({ cwd })` — real handlers backed by the retrieval
 *     pipeline and the substrate cache at `cwd/.contexttrail/cache/contexttrail.db`.
 *
 * The two share the same wire signatures, so the server doesn't care which
 * is wired in.
 */
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { z } from "zod";
import matter from "gray-matter";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { schemas } from "./schemas.js";
import { presentContextPack } from "./presenter.js";
import type { Db } from "../store/db.js";
import type { ChunkScope } from "../types/chunk.js";
import type { ContextTrailConfig } from "../config/defaults.js";
import {
  resolveLedgerContext,
  withLedgerDb,
  type LedgerContext,
  type LedgerWorkspaceInput,
} from "../ledger/context.js";
import { runRetrievalPipeline } from "../retrieve/runtime.js";
import { chunkContextTrail } from "../retrieve/contexttrail.js";
import { runFreshnessPrePass } from "../sync/freshness-repair.js";
import { buildWildLogEntry, logWildQuery } from "./wild-log.js";
import {
  getCardByIdCanonical,
  getChunkLookupCanonical,
  getChunkByVersionIdCanonical,
  getAnchorsForChunkCanonical,
  listCurrentChunksCanonical,
  listLinksForCardCanonical,
  listSourcesCanonical,
} from "../store/read-model.js";
import {
  answerCurrentSetupQuestion,
  runSetupConversation,
  setupReadinessOutput,
} from "../setup/conversation.js";
import { runLedgerSync } from "../sync/ledger-sync.js";

type Input<K extends keyof typeof schemas> = z.infer<(typeof schemas)[K]["input"]>;
type Output<K extends keyof typeof schemas> = z.infer<(typeof schemas)[K]["output"]>;

export type CreateHandlersOpts = {
  cwd: string;
  db?: Db;
  config?: ContextTrailConfig;
};

export function createHandlers(opts: CreateHandlersOpts) {
  const contextOptions = {
    defaultCwd: opts.cwd,
    db: opts.db,
    config: opts.config,
  };

  function resolveWorkspace(input: LedgerWorkspaceInput = {}): LedgerContext {
    return resolveLedgerContext(contextOptions, input);
  }

  function withDb<T>(
    input: LedgerWorkspaceInput,
    run: (db: Db, workspace: LedgerContext) => T,
  ): T {
    return withLedgerDb(resolveWorkspace(input), opts.db, run);
  }

  // Forward-declared so get_setup_readiness can re-enter retrieve_context_pack
  // via the same handler instance. Populated immediately below the literal.
  let self: {
    retrieve_context_pack: (
      input: Input<"retrieve_context_pack">,
    ) => Promise<Output<"retrieve_context_pack">>;
  };

  const handlers = {
    async retrieve_context_pack(
      input: Input<"retrieve_context_pack">,
    ): Promise<Output<"retrieve_context_pack">> {
      // PRD-0035 / slice 35.2: pre-retrieve freshness check. Runs before
      // pack assembly. Default behavior is detect-and-warn; the env var
      // CONTEXTTRAIL_RETRIEVAL_AUTO_REINDEX=true opts into inline reindex of the
      // stale set (auto-reindex changes retrieval's latency contract from
      // "deterministic" to "unbounded when stale", so it's opt-in only).
      const workspace = resolveWorkspace(input);
      const autoReindex = process.env.CONTEXTTRAIL_RETRIEVAL_AUTO_REINDEX === "true";
      const pre = runFreshnessPrePass(workspace.cwd, {
        autoReindex,
        earlyExit: !autoReindex,
      });
      const freshnessWarnings = pre.warnings;
      return withLedgerDb(workspace, opts.db, (db) => {
        const requested_budget =
          workspace.config.retrieval.budgets[input.budget ?? "default"];
        const has_sources = listSourcesCanonical(db).length > 0;
        const result = runRetrievalPipeline({ db, config: workspace.config }, {
          task: input.task,
          query_anchors: {
            files: input.files,
            symbols: input.symbols,
            routes: input.routes,
          },
          budget: input.budget ?? "default",
          expected_locked: input.expected_locked,
          explain: input.explain ?? false,
        });
        const pack = presentContextPack({
          query: input.task,
          result,
          requested_budget,
          has_sources,
          explain: input.explain ?? false,
          include_rendered_text: input.include_rendered_text ?? false,
          min_final_score: workspace.config.retrieval.min_final_score,
        });
        logWildQuery(workspace.cwd, buildWildLogEntry({
          task: input.task,
          files: input.files,
          symbols: input.symbols,
          routes: input.routes,
          budget: input.budget,
        }, pack));
        if (freshnessWarnings.length > 0) {
          pack.warnings = [...pack.warnings, ...freshnessWarnings];
        }
        return pack;
      });
    },

    async get_doc_chunk(input: Input<"get_doc_chunk">): Promise<Output<"get_doc_chunk">> {
      return withDb(input, (db) => {
        const chunk = resolveChunk(db, input);
        if (!chunk) {
          throw new McpError(
            ErrorCode.InvalidParams,
            input.version_id
              ? `no chunk with version_id=${input.version_id}`
              : `no current chunk for stable_key=${input.stable_key}`,
          );
        }
        const anchors = getAnchorsForChunkCanonical(db, chunk.version_id);
        return {
          version_id: chunk.version_id,
          stable_key: chunk.stable_key,
          source_path: chunk.source_path,
          heading_path: chunk.heading_path,
          contexttrail: chunkContextTrail(chunk),
          scope: chunk.scope,
          body: chunk.body,
          code_anchors: anchors.map((a) => ({
            kind: a.kind,
            value: a.value,
            confidence: a.confidence,
            source: a.source,
          })),
          freshness_state: chunk.freshness_state,
          status: chunk.status,
          tokens: chunk.token_count,
        };
      });
    },

    async get_card(input: Input<"get_card">): Promise<Output<"get_card">> {
      return withDb(input, (db, workspace) => {
        const card = getCardByIdCanonical(db, input.id);
        if (!card) {
          throw new McpError(ErrorCode.InvalidParams, `no card with id=${input.id}`);
        }
        const links = listLinksForCardCanonical(db, card.id);
        const linked_chunks = links.map((l) => {
          const chunk = getChunkByVersionIdCanonical(db, l.version_pin);
          const contexttrail = chunk ? chunkContextTrail(chunk) : `(tombstoned: ${l.version_pin})`;
          return {
            version_pin: l.version_pin,
            contexttrail,
            link_type: l.link_type,
          };
        });
        const frontmatter = readCardFrontmatter(workspace.cwd, card.source_path);
        const freshness_warnings: string[] =
          card.freshness_state === "verified"
            ? []
            : [`${card.freshness_state} (${card.freshness_reason})`];
        return {
          id: card.id,
          card_type: card.type,
          scope: card.scope,
          body: card.body,
          frontmatter,
          linked_chunks,
          freshness_state: card.freshness_state,
          freshness_warnings,
          author_review_state: card.author_review_state,
        };
      });
    },

    async list_context_sources(
      input: Input<"list_context_sources">,
    ): Promise<Output<"list_context_sources">> {
      return withDb(input, (db) => {
        const sources = listSourcesCanonical(db);
        if (sources.length === 0) return { sources: [] };
        const chunks = listCurrentChunksCanonical(db);
        const scopeBySource = new Map<string, ChunkScope>();
        for (const c of chunks) {
          if (!scopeBySource.has(c.source_path)) scopeBySource.set(c.source_path, c.scope);
        }
        return {
          sources: sources.map((s) => ({
            source_path: s.source_path,
            scope_summary: summarizeScope(scopeBySource.get(s.source_path)),
            scope: scopeBySource.get(s.source_path) ?? { layer: "unknown", source: {} },
            chunk_count: s.chunk_count,
            last_indexed_at: s.last_indexed_at,
          })),
        };
      });
    },

    async get_setup_readiness(
      input: Input<"get_setup_readiness">,
    ): Promise<Output<"get_setup_readiness">> {
      const cwd = resolveWorkspace(input).cwd;
      const conversation = await runSetupConversation(cwd, async (task) => {
        const pack = await self.retrieve_context_pack({ task, cwd });
        return { coverage_confidence: pack.coverage_confidence };
      });
      return setupReadinessOutput(conversation.readiness);
    },

    async propose_setup_questions(
      input: Input<"propose_setup_questions">,
    ): Promise<Output<"propose_setup_questions">> {
      const cwd = resolveWorkspace(input).cwd;
      const conversation = await runSetupConversation(cwd, async (task) => {
        const pack = await self.retrieve_context_pack({ task, cwd });
        return { coverage_confidence: pack.coverage_confidence };
      });
      return conversation.plan;
    },

    async answer_setup_question(
      input: Input<"answer_setup_question">,
    ): Promise<Output<"answer_setup_question">> {
      const cwd = resolveWorkspace(input).cwd;
      return answerCurrentSetupQuestion(cwd, async (task) => {
        const pack = await self.retrieve_context_pack({ task, cwd });
        return { coverage_confidence: pack.coverage_confidence };
      }, input);
    },

    async sync_ledger(input: Input<"sync_ledger">): Promise<Output<"sync_ledger">> {
      const cwd = resolveWorkspace(input).cwd;
      return runLedgerSync(cwd, {
        check: input.check ?? true,
        refreshCandidates: input.refresh_candidates ?? false,
      });
    },
  };

  self = handlers;
  return handlers;
}

function resolveChunk(
  db: Db,
  input: { version_id?: string; stable_key?: string },
) {
  return getChunkLookupCanonical(db, input);
}

function summarizeScope(scope: ChunkScope | undefined): string {
  if (!scope) return "unknown";
  if (scope.layer === "module" && scope.module) return `module:${scope.module}`;
  if (scope.layer === "project" && scope.project) return `project:${scope.project}`;
  if (scope.layer === "team" && scope.team) return `team:${scope.team}`;
  if (scope.layer === "company" && scope.company) return `company:${scope.company}`;
  if (scope.layer === "decision") return "decision";
  return scope.layer;
}

function readCardFrontmatter(cwd: string, sourcePath: string): Record<string, unknown> {
  try {
    const raw = readFileSync(join(cwd, sourcePath), "utf8");
    const fm = matter(raw).data;
    return fm as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const stubHandlers = {
  async retrieve_context_pack(
    _input: Input<"retrieve_context_pack">,
  ): Promise<Output<"retrieve_context_pack">> {
    return {
      query_mode: "unanchored",
      coverage_confidence: "empty",
      assembly_stage_reached: "not_applicable",
      locked: [],
      ranked: [],
      omitted: { total: 0, by_reason: {}, top: [], truncated: false },
      warnings: [],
      budget: { requested: 0, used: 0, locked_overhead: 0 },
    };
  },

  async get_doc_chunk(_input: Input<"get_doc_chunk">): Promise<Output<"get_doc_chunk">> {
    return {
      version_id: "",
      stable_key: "",
      source_path: "",
      heading_path: [],
      contexttrail: "",
      scope: {},
      body: "",
      code_anchors: [],
      freshness_state: "verified",
      status: "current",
      tokens: 0,
    };
  },

  async get_card(_input: Input<"get_card">): Promise<Output<"get_card">> {
    return {
      id: "",
      card_type: "constraint",
      scope: {},
      body: "",
      frontmatter: {},
      linked_chunks: [],
      freshness_state: "verified",
      freshness_warnings: [],
      author_review_state: "unreviewed",
    };
  },

  async list_context_sources(
    _input: Input<"list_context_sources">,
  ): Promise<Output<"list_context_sources">> {
    return { sources: [] };
  },

  async get_setup_readiness(
    _input: Input<"get_setup_readiness">,
  ): Promise<Output<"get_setup_readiness">> {
    return {
      cwd: "",
      dimensions: emptySetupDimensions(),
      suggestion: {
        row_name: "import_more_docs",
        command: "contexttrail import docs/**/*.md",
        message: "stub handler — no scan performed",
      },
      pending_inbox_items: 0,
    };
  },

  async propose_setup_questions(
    _input: Input<"propose_setup_questions">,
  ): Promise<Output<"propose_setup_questions">> {
    return {
      cwd: "",
      dimensions: emptySetupDimensions(),
      suggestion: {
        row_name: "import_more_docs",
        command: "contexttrail import docs/**/*.md",
        message: "stub handler — no scan performed",
      },
      pending_inbox_items: 0,
      questions: [],
    };
  },

  async answer_setup_question(
    _input: Input<"answer_setup_question">,
  ): Promise<Output<"answer_setup_question">> {
    return {
      cwd: "",
      question_id: "stub",
      kind: "import_docs",
      action: {
        type: "command_preview",
        command: "contexttrail import docs/**/*.md",
        message: "stub handler — no setup answer applied",
      },
      writes: [],
    };
  },

  async sync_ledger(
    _input: Input<"sync_ledger">,
  ): Promise<Output<"sync_ledger">> {
    return {
      cwd: "",
      mode: "check",
      initialized: false,
      actions: [],
      writes: [],
      freshness: {
        stale_doc_sources: [],
        stale_code_sources: [],
        missing_sources: [],
      },
      cards: {
        before: emptyCardCounts(),
        after: emptyCardCounts(),
        newly_needs_review: [],
        already_needs_review: [],
      },
      inbox: {
        pending_total: 0,
        candidate_cards: 0,
        clarification_needs: 0,
      },
    };
  },
} as const;

function emptySetupDimensions(): Output<"get_setup_readiness">["dimensions"] {
  const emptyDim = { score: "low" as const, evidence: {} };
  return {
    corpus_coverage: emptyDim,
    scope_coverage: emptyDim,
    card_coverage: emptyDim,
    retrieval_probes: emptyDim,
  };
}

function emptyCardCounts(): Output<"sync_ledger">["cards"]["before"] {
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
