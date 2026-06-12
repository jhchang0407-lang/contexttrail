/**
 * LLM clarification generator (conditional).
 *
 * `augmentChunk` is the pure orchestrator. Given a chunk + the regex
 * bootstrap's output for that chunk, it either skips (regex already
 * produced a strong-rule candidate) or invokes the provided `LlmClient`
 * and returns a validated augmentation result.
 *
 * Validation enforces the output constraints:
 *   - at most one candidate per chunk
 *   - at most one clarification per chunk
 *   - clarifications include 2..4 multiple-choice options
 *   - symbol_note candidates carry at least one symbol_anchor
 *
 * Authority boundary: this module produces *drafts*. Nothing is truth
 * until a human accepts the resulting inbox item. Authoring provenance
 * (`authored_by: contexttrail-bootstrap-llm`) is recorded when
 * the drafts flow through the inbox materialization path.
 */
import { z } from "zod";
import { CHUNK_SCOPE_LAYERS } from "../types/chunk.js";
import type { InboxScope } from "../inbox/items.js";

export type AugmentationChunkInput = {
  stable_key: string;
  source_path: string;
  heading_path: string[];
  version_id: string;
  body: string;
  scope: InboxScope;
};

export type AugmentationRegexOutput = {
  candidates: number;
  clarifications: number;
};

const ScopeSchema = z.object({
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

const CandidateSchema = z
  .object({
    candidate_type: z.enum(["constraint", "symbol_note"]),
    title: z.string().min(1),
    body: z.string().min(1),
    scope: ScopeSchema,
    symbol_anchors: z.array(z.string().min(1)).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.candidate_type === "symbol_note") {
      const anchors = c.symbol_anchors ?? [];
      if (anchors.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "symbol_note candidates require at least one symbol_anchor",
        });
      }
    }
  });

const ChoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

const ClarificationSchema = z
  .object({
    body: z.string().min(1),
    scope: ScopeSchema,
    choices: z.array(ChoiceSchema).min(2).max(4),
  })
  .superRefine((c, ctx) => {
    const ids = new Set<string>();
    for (const choice of c.choices) {
      if (ids.has(choice.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate choice id "${choice.id}"`,
        });
        return;
      }
      ids.add(choice.id);
    }
  });

const AugmentationResultSchema = z.object({
  candidate: CandidateSchema.optional(),
  clarification: ClarificationSchema.optional(),
});

export type LlmAugmentationCandidate = z.infer<typeof CandidateSchema>;
export type LlmAugmentationClarificationChoice = z.infer<typeof ChoiceSchema>;
export type LlmAugmentationClarification = z.infer<typeof ClarificationSchema>;
export type LlmAugmentationResult = z.infer<typeof AugmentationResultSchema>;

export type LlmClient = {
  generateBootstrapAugmentation(
    chunk: AugmentationChunkInput,
    regexOutput: AugmentationRegexOutput,
  ): Promise<LlmAugmentationResult>;
};

export function shouldAugment(regexOutput: AugmentationRegexOutput): boolean {
  return regexOutput.candidates === 0;
}

export function validateAugmentationResult(
  raw: unknown,
): LlmAugmentationResult {
  const parsed = AugmentationResultSchema.parse(raw);
  // Normalize: strip the candidate/clarification fields if absent so the
  // returned object is structurally minimal.
  const out: LlmAugmentationResult = {};
  if (parsed.candidate) out.candidate = parsed.candidate;
  if (parsed.clarification) out.clarification = parsed.clarification;
  return out;
}

export async function augmentChunk(
  chunk: AugmentationChunkInput,
  regexOutput: AugmentationRegexOutput,
  client: LlmClient,
): Promise<LlmAugmentationResult> {
  if (!shouldAugment(regexOutput)) return {};
  const raw = await client.generateBootstrapAugmentation(chunk, regexOutput);
  return validateAugmentationResult(raw);
}
