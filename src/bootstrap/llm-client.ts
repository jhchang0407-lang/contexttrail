/**
 * PRD-0034 / slice 34.2 — LlmClient providers.
 *
 * Two providers ship in this slice:
 *
 *   - `mock`     — deterministic in-memory map keyed by chunk stable_key.
 *                  Used by unit tests so they don't depend on a network
 *                  call or an API key.
 *
 *   - `anthropic` — hosted Claude via the Messages API. Uses fetch (no
 *                  SDK dep). Reads `ANTHROPIC_API_KEY` from the env at
 *                  construction time. Integration tests that exercise
 *                  the real provider live behind an explicit env check
 *                  and skip when the key is absent.
 *
 * The boundary statement in the system prompt is the load-bearing piece
 * of ADR-0014 compliance: the LLM is told its output is provisional and
 * reviewed by a human. The structural enforcement still happens in
 * `validateAugmentationResult` and in the slice-34.3 inbox flow.
 */
import {
  validateAugmentationResult,
  type AugmentationChunkInput,
  type AugmentationRegexOutput,
  type LlmAugmentationResult,
  type LlmClient,
} from "./llm-augment.js";

// ─────────────────────────────────────────────────────────────────────
// Mock provider
// ─────────────────────────────────────────────────────────────────────

export function createMockLlmClient(
  fixture: Record<string, LlmAugmentationResult>,
): LlmClient {
  return {
    async generateBootstrapAugmentation(chunk) {
      const canned = fixture[chunk.stable_key];
      if (!canned) return {};
      // Validate the fixture eagerly so test-time mistakes surface
      // immediately rather than as silent data inconsistencies.
      return validateAugmentationResult(canned);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Anthropic provider
// ─────────────────────────────────────────────────────────────────────

export const ANTHROPIC_SYSTEM_PROMPT = [
  "You augment a deterministic regex bootstrap with additional candidate cards",
  "and clarification needs drawn from a single documentation chunk.",
  "",
  "Authority boundary (load-bearing): your output is provisional and will be",
  "reviewed by a human before anything is written as accepted truth. Do not",
  "produce content that would be misleading if accepted verbatim. If you are",
  "uncertain whether the chunk implies a rule, prefer a clarification need",
  "with options over a confident candidate card.",
  "",
  "Output limits:",
  "  - emit at most ONE candidate card",
  "  - emit at most ONE clarification need",
  "  - clarification needs must include 2 to 4 multiple-choice options",
  "  - symbol_note candidates must include at least one symbol_anchor",
  "",
  "Output format: a single JSON object between <result> and </result> tags,",
  "with optional fields `candidate` and `clarification`. Omit fields you do",
  "not want to emit. No prose outside the tags.",
].join("\n");

export type AnthropicLlmClientOptions = {
  apiKey?: string;
  model?: string;
  endpoint?: string;
  apiVersion?: string;
  /** Override fetch for testing. Defaults to globalThis.fetch. */
  fetchFn?: typeof fetch;
  /** Hard per-request timeout in ms; default 30000 (per PRD-0034 § 34.3 lock). */
  timeoutMs?: number;
};

type AnthropicMessageResponse = {
  content?: { type: string; text?: string }[];
};

export function buildAnthropicUserPrompt(
  chunk: AugmentationChunkInput,
  regexOutput: AugmentationRegexOutput,
): string {
  return [
    `Chunk source: ${chunk.source_path}`,
    `Heading: ${chunk.heading_path.join(" / ")}`,
    `Scope (JSON): ${JSON.stringify(chunk.scope)}`,
    "",
    `Regex bootstrap output for this chunk:`,
    `  - candidates: ${regexOutput.candidates}`,
    `  - clarifications: ${regexOutput.clarifications}`,
    "",
    "Chunk body:",
    '"""',
    chunk.body,
    '"""',
    "",
    "Return a JSON object between <result> and </result> with optional",
    "`candidate` and `clarification` fields. Example shape:",
    "<result>",
    "{",
    '  "candidate": {',
    '    "candidate_type": "constraint" | "symbol_note",',
    '    "title": "<short title>",',
    '    "body": "<one or two sentences>",',
    `    "scope": ${JSON.stringify(chunk.scope)},`,
    '    "symbol_anchors": []',
    "  },",
    '  "clarification": {',
    '    "body": "<question to ask the human>",',
    `    "scope": ${JSON.stringify(chunk.scope)},`,
    '    "choices": [',
    '      { "id": "<short_id>", "label": "<readable label>" },',
    '      { "id": "<short_id>", "label": "<readable label>" }',
    "    ]",
    "  }",
    "}",
    "</result>",
  ].join("\n");
}

export function parseAnthropicResultBlock(text: string): LlmAugmentationResult {
  const match = text.match(/<result>([\s\S]*?)<\/result>/);
  if (!match) {
    throw new Error("anthropic response missing <result>...</result> block");
  }
  const json = match[1]!.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `anthropic <result> block was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return validateAugmentationResult(parsed);
}

export function createAnthropicLlmClient(
  options: AnthropicLlmClientOptions = {},
): LlmClient {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "createAnthropicLlmClient: ANTHROPIC_API_KEY is not set (pass apiKey option or export the env var)",
    );
  }
  const model = options.model ?? "claude-sonnet-4-6";
  const endpoint = options.endpoint ?? "https://api.anthropic.com/v1/messages";
  const apiVersion = options.apiVersion ?? "2023-06-01";
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30000;

  return {
    async generateBootstrapAugmentation(chunk, regexOutput) {
      const userPrompt = buildAnthropicUserPrompt(chunk, regexOutput);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchFn(endpoint, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": apiVersion,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            temperature: 0,
            system: ANTHROPIC_SYSTEM_PROMPT,
            messages: [{ role: "user", content: userPrompt }],
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const errBody = await response.text().catch(() => "<no-body>");
          throw new Error(
            `anthropic API ${response.status}: ${errBody.slice(0, 500)}`,
          );
        }
        const body = (await response.json()) as AnthropicMessageResponse;
        const text =
          body.content?.find((b) => b.type === "text")?.text ?? "";
        return parseAnthropicResultBlock(text);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
