import { join } from "node:path";
import { closeDb, openDb, type Db } from "../store/db.js";
import { getAnchorsForChunk } from "../store/anchors.js";
import { listCurrentChunks } from "../store/chunks.js";
import { generateBootstrapProposals } from "../bootstrap/proposals.js";
import {
  materializeBootstrapProposals,
  type CardBootstrapSummary,
} from "../inbox/bootstrap.js";
import {
  runAugmentationPass,
  type AugmentationChunkRecord,
  type AugmentationRunSummary,
} from "../bootstrap/augmentation-run.js";
import { createAnthropicLlmClient } from "../bootstrap/llm-client.js";
import type { LlmClient } from "../bootstrap/llm-augment.js";

export type CardBootstrapOptions = {
  /** When true, run the LLM augmentation pass after regex bootstrap. */
  llm?: boolean;
  /**
   * Inject a specific `LlmClient`. Tests pass `createMockLlmClient(...)`.
   * When omitted but `llm` is true, the anthropic provider is constructed.
   */
  llmClient?: LlmClient;
};

export type CardBootstrapResult = CardBootstrapSummary & {
  llm_augmentation?: AugmentationRunSummary;
};

function readChunks(db: Db) {
  return listCurrentChunks(db)
    .filter((chunk) => chunk.doc_role === "canonical")
    .map((chunk) => ({
      stable_key: chunk.stable_key,
      source_path: chunk.source_path,
      heading_path: chunk.heading_path,
      version_id: chunk.version_id,
      body: chunk.body,
      scope: chunk.scope,
    }));
}

function envFlag(name: string): boolean {
  const value = process.env[name];
  if (!value) return false;
  const v = value.toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function isLlmFlagEnabled(options?: CardBootstrapOptions): boolean {
  if (options?.llm) return true;
  return envFlag("CONTEXTTRAIL_BOOTSTRAP_LLM_AUGMENT");
}

export async function runCardBootstrap(
  cwd: string,
  options: CardBootstrapOptions = {},
): Promise<CardBootstrapResult> {
  const db = openDb(join(cwd, ".contexttrail/cache/contexttrail.db"));
  try {
    const chunks = readChunks(db);
    const proposals = generateBootstrapProposals({
      listCanonicalChunks: () => chunks,
      getConfidentSymbolAnchors: (versionId) =>
        getAnchorsForChunk(db, versionId)
          .filter(
            (anchor) =>
              anchor.kind === "symbol" &&
              (anchor.confidence === "high" || anchor.confidence === "medium"),
          )
          .map((anchor) => anchor.value),
    });
    const regexSummary = materializeBootstrapProposals(cwd, proposals);

    if (!isLlmFlagEnabled(options)) {
      return { ...regexSummary };
    }

    const client = options.llmClient ?? createAnthropicLlmClient();

    // Per-chunk regex output for selective invocation. The proposals
    // arrays are repo-deduped — the counts here reflect what landed in
    // the inbox per stable_key, which is the right input for the
    // shouldAugment rule.
    const regexCountsByStableKey = new Map<string, { candidates: number; clarifications: number }>();
    const bump = (key: string, field: "candidates" | "clarifications") => {
      const entry = regexCountsByStableKey.get(key) ?? { candidates: 0, clarifications: 0 };
      entry[field] += 1;
      regexCountsByStableKey.set(key, entry);
    };
    for (const candidate of proposals.candidates) {
      for (const supporting of candidate.supporting_chunks) {
        bump(supporting.chunk_stable_key, "candidates");
      }
    }
    for (const clarification of proposals.clarifications) {
      for (const supporting of clarification.supporting_chunks ?? []) {
        bump(supporting.chunk_stable_key, "clarifications");
      }
    }

    const augmentationInput: AugmentationChunkRecord[] = chunks.map((chunk) => ({
      stable_key: chunk.stable_key,
      source_path: chunk.source_path,
      heading_path: chunk.heading_path,
      version_id: chunk.version_id,
      body: chunk.body,
      scope: chunk.scope,
      regex: regexCountsByStableKey.get(chunk.stable_key) ?? {
        candidates: 0,
        clarifications: 0,
      },
    }));

    const augmentation = await runAugmentationPass({
      chunks: augmentationInput,
      client,
    });

    if (augmentation.candidates.length > 0 || augmentation.clarifications.length > 0) {
      materializeBootstrapProposals(cwd, {
        candidates: augmentation.candidates,
        clarifications: augmentation.clarifications,
        summary: {
          chunks_considered: 0,
          candidate_sentences: 0,
          constraint_candidates_written: 0,
          symbol_note_candidates_written: 0,
          clarification_needs_written: 0,
          merged_duplicates: 0,
        },
      });
    }

    return {
      ...regexSummary,
      llm_augmentation: augmentation.summary,
    };
  } finally {
    closeDb(db);
  }
}
