import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_SYSTEM_PROMPT,
  buildAnthropicUserPrompt,
  createAnthropicLlmClient,
  createMockLlmClient,
  parseAnthropicResultBlock,
} from "./llm-client.js";
import type {
  AugmentationChunkInput,
  AugmentationRegexOutput,
} from "./llm-augment.js";

const CHUNK: AugmentationChunkInput = {
  stable_key: "ch-001",
  source_path: "docs/rotate.md",
  heading_path: ["Rotation"],
  version_id: "v1",
  body: "Every 90 days, rotation worker reads from KMS.",
  scope: { layer: "project", project: "contexttrail" },
};
const REGEX: AugmentationRegexOutput = { candidates: 0, clarifications: 0 };

describe("ANTHROPIC_SYSTEM_PROMPT", () => {
  it("contains the ADR-0014 authority-boundary statement", () => {
    expect(ANTHROPIC_SYSTEM_PROMPT).toMatch(/provisional/i);
    expect(ANTHROPIC_SYSTEM_PROMPT).toMatch(/reviewed by a human/i);
  });

  it("documents the output limits (one candidate, one clarification, 2..4 choices)", () => {
    expect(ANTHROPIC_SYSTEM_PROMPT).toMatch(/at most ONE candidate/i);
    expect(ANTHROPIC_SYSTEM_PROMPT).toMatch(/at most ONE clarification/i);
    expect(ANTHROPIC_SYSTEM_PROMPT).toMatch(/2 to 4/i);
  });

  it("requires the structured-output markers", () => {
    expect(ANTHROPIC_SYSTEM_PROMPT).toMatch(/<result>/);
    expect(ANTHROPIC_SYSTEM_PROMPT).toMatch(/<\/result>/);
  });
});

describe("buildAnthropicUserPrompt", () => {
  it("includes the chunk body and regex output", () => {
    const prompt = buildAnthropicUserPrompt(CHUNK, REGEX);
    expect(prompt).toContain(CHUNK.body);
    expect(prompt).toContain("candidates: 0");
    expect(prompt).toContain("clarifications: 0");
    expect(prompt).toContain(CHUNK.source_path);
    expect(prompt).toContain("Rotation");
  });
});

describe("parseAnthropicResultBlock", () => {
  it("parses a valid result block", () => {
    const text = `Some prelude.<result>
{
  "candidate": {
    "candidate_type": "constraint",
    "title": "rotation cycle",
    "body": "Credentials rotate every 90 days.",
    "scope": { "layer": "project", "project": "contexttrail" }
  }
}
</result>`;
    const result = parseAnthropicResultBlock(text);
    expect(result.candidate?.candidate_type).toBe("constraint");
    expect(result.candidate?.title).toBe("rotation cycle");
  });

  it("throws when no result block is present", () => {
    expect(() => parseAnthropicResultBlock("no markers here")).toThrow(/result/i);
  });

  it("throws when the block is not valid JSON", () => {
    expect(() =>
      parseAnthropicResultBlock("<result>{not-json}</result>"),
    ).toThrow(/JSON/i);
  });

  it("throws when the validation rejects (e.g., 1-choice clarification)", () => {
    const text = `<result>
{
  "clarification": {
    "body": "single?",
    "scope": { "layer": "project", "project": "contexttrail" },
    "choices": [{ "id": "only", "label": "only" }]
  }
}
</result>`;
    expect(() => parseAnthropicResultBlock(text)).toThrow();
  });
});

describe("createAnthropicLlmClient — fetch contract", () => {
  it("throws at construction when ANTHROPIC_API_KEY is absent and no apiKey option is given", () => {
    const prevKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => createAnthropicLlmClient()).toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });

  it("sends the system prompt, user prompt, and headers to the configured endpoint", async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const stubFetch: typeof fetch = async (url, init) => {
      captured.url = typeof url === "string" ? url : url.toString();
      captured.init = init;
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: `<result>
{ "candidate": { "candidate_type": "constraint", "title": "t", "body": "b", "scope": { "layer": "project", "project": "contexttrail" } } }
</result>`,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const client = createAnthropicLlmClient({
      apiKey: "stub-key",
      fetchFn: stubFetch,
      endpoint: "https://example.invalid/messages",
    });
    const result = await client.generateBootstrapAugmentation(CHUNK, REGEX);
    expect(result.candidate?.title).toBe("t");
    expect(captured.url).toBe("https://example.invalid/messages");
    const headers = captured.init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("stub-key");
    expect(headers["anthropic-version"]).toBeTruthy();
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(captured.init?.body as string);
    expect(body.system).toBe(ANTHROPIC_SYSTEM_PROMPT);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toContain(CHUNK.body);
    expect(body.temperature).toBe(0);
  });

  it("throws on non-2xx with the response status in the message", async () => {
    const stubFetch: typeof fetch = async () =>
      new Response("rate limited", { status: 429 });
    const client = createAnthropicLlmClient({
      apiKey: "stub",
      fetchFn: stubFetch,
    });
    await expect(
      client.generateBootstrapAugmentation(CHUNK, REGEX),
    ).rejects.toThrow(/429/);
  });

  it("aborts after the configured timeout", async () => {
    let aborted = false;
    const stubFetch: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("aborted", "AbortError"));
          });
        }
      });
    const client = createAnthropicLlmClient({
      apiKey: "stub",
      fetchFn: stubFetch,
      timeoutMs: 25,
    });
    await expect(
      client.generateBootstrapAugmentation(CHUNK, REGEX),
    ).rejects.toThrow();
    expect(aborted).toBe(true);
  });
});

describe("createMockLlmClient (smoke re-test from llm-augment.test.ts coverage)", () => {
  it("is reusable across calls and rejects fixtures that fail validation", async () => {
    const client = createMockLlmClient({
      "bad-fixture": {
        clarification: {
          body: "broken",
          scope: { layer: "project", project: "contexttrail" },
          // @ts-expect-error intentional bad fixture: only one choice
          choices: [{ id: "only", label: "only" }],
        },
      },
    });
    await expect(
      client.generateBootstrapAugmentation(
        { ...CHUNK, stable_key: "bad-fixture" },
        REGEX,
      ),
    ).rejects.toThrow();
  });
});

describe("createAnthropicLlmClient — live integration (skipped without ANTHROPIC_API_KEY)", () => {
  it.runIf(process.env.ANTHROPIC_API_KEY != null && process.env.CONTEXTTRAIL_LLM_LIVE === "1")(
    "round-trips a small request against the real Anthropic API",
    async () => {
      const client = createAnthropicLlmClient({});
      const result = await client.generateBootstrapAugmentation(CHUNK, REGEX);
      // Don't assert on the exact content — provider determinism is not
      // promised. We only assert that the response parses through the
      // validator without throwing.
      expect(typeof result).toBe("object");
    },
    60_000,
  );
});
