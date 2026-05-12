import { describe, expect, it } from "vitest";
import {
  augmentChunk,
  shouldAugment,
  validateAugmentationResult,
  type AugmentationChunkInput,
  type AugmentationRegexOutput,
  type LlmAugmentationResult,
  type LlmClient,
} from "./llm-augment.js";
import { createMockLlmClient } from "./llm-client.js";

const CHUNK: AugmentationChunkInput = {
  stable_key: "ch-test-001",
  source_path: "docs/runbooks/rotate.md",
  heading_path: ["Rotation runbook"],
  version_id: "v1",
  body: "Every 90 days, the rotation worker reads from KMS and re-writes the secret to Vault.",
  scope: { layer: "project", project: "contexttrail" },
};

describe("shouldAugment — selective invocation rule", () => {
  it("returns false when regex already produced a strong-rule candidate", () => {
    expect(shouldAugment({ candidates: 1, clarifications: 0 })).toBe(false);
  });

  it("returns false when regex produced multiple candidates", () => {
    expect(shouldAugment({ candidates: 2, clarifications: 1 })).toBe(false);
  });

  it("returns true when regex produced only a clarification", () => {
    expect(shouldAugment({ candidates: 0, clarifications: 1 })).toBe(true);
  });

  it("returns true when regex produced nothing", () => {
    expect(shouldAugment({ candidates: 0, clarifications: 0 })).toBe(true);
  });
});

describe("validateAugmentationResult — output constraints", () => {
  it("accepts an empty result", () => {
    expect(validateAugmentationResult({})).toEqual({});
  });

  it("accepts a constraint candidate with title + body", () => {
    const result: LlmAugmentationResult = {
      candidate: {
        candidate_type: "constraint",
        title: "Credential rotation cycle",
        body: "Credentials rotate every 90 days through the rotation worker.",
        scope: { layer: "project", project: "contexttrail" },
      },
    };
    expect(validateAugmentationResult(result)).toEqual(result);
  });

  it("accepts a symbol_note candidate when symbol_anchors is non-empty", () => {
    const result: LlmAugmentationResult = {
      candidate: {
        candidate_type: "symbol_note",
        title: "rotation worker entry point",
        body: "The rotation worker is the entry point for credential rotation.",
        scope: { layer: "project", project: "contexttrail" },
        symbol_anchors: ["rotation_worker"],
      },
    };
    expect(validateAugmentationResult(result)).toEqual(result);
  });

  it("rejects a symbol_note candidate without symbol_anchors", () => {
    const result: LlmAugmentationResult = {
      candidate: {
        candidate_type: "symbol_note",
        title: "broken",
        body: "no anchor",
        scope: { layer: "project", project: "contexttrail" },
      },
    };
    expect(() => validateAugmentationResult(result)).toThrow(/symbol_anchor/i);
  });

  it("rejects an empty candidate title", () => {
    const result: LlmAugmentationResult = {
      candidate: {
        candidate_type: "constraint",
        title: "",
        body: "non-empty",
        scope: { layer: "project", project: "contexttrail" },
      },
    };
    expect(() => validateAugmentationResult(result)).toThrow();
  });

  it("rejects an empty candidate body", () => {
    const result: LlmAugmentationResult = {
      candidate: {
        candidate_type: "constraint",
        title: "non-empty",
        body: "",
        scope: { layer: "project", project: "contexttrail" },
      },
    };
    expect(() => validateAugmentationResult(result)).toThrow();
  });

  it("accepts a clarification with 2 choices", () => {
    const result: LlmAugmentationResult = {
      clarification: {
        body: "Is the 90-day cycle a strict policy or a rough cadence?",
        scope: { layer: "project", project: "contexttrail" },
        choices: [
          { id: "strict", label: "Strict policy — must rotate at 90 days" },
          { id: "rough", label: "Rough cadence — drift is acceptable" },
        ],
      },
    };
    expect(validateAugmentationResult(result)).toEqual(result);
  });

  it("accepts a clarification with 4 choices", () => {
    const result: LlmAugmentationResult = {
      clarification: {
        body: "Which scope is correct?",
        scope: { layer: "project", project: "contexttrail" },
        choices: [
          { id: "a", label: "company" },
          { id: "b", label: "team" },
          { id: "c", label: "project" },
          { id: "d", label: "module" },
        ],
      },
    };
    expect(validateAugmentationResult(result)).toEqual(result);
  });

  it("rejects a clarification with only 1 choice", () => {
    const result: LlmAugmentationResult = {
      clarification: {
        body: "Question?",
        scope: { layer: "project", project: "contexttrail" },
        choices: [{ id: "only", label: "the only choice" }],
      },
    };
    expect(() => validateAugmentationResult(result)).toThrow(/choices/i);
  });

  it("rejects a clarification with 5 choices", () => {
    const result: LlmAugmentationResult = {
      clarification: {
        body: "Question?",
        scope: { layer: "project", project: "contexttrail" },
        choices: [
          { id: "a", label: "a" },
          { id: "b", label: "b" },
          { id: "c", label: "c" },
          { id: "d", label: "d" },
          { id: "e", label: "e" },
        ],
      },
    };
    expect(() => validateAugmentationResult(result)).toThrow(/choices/i);
  });

  it("rejects duplicate choice ids", () => {
    const result: LlmAugmentationResult = {
      clarification: {
        body: "Question?",
        scope: { layer: "project", project: "contexttrail" },
        choices: [
          { id: "a", label: "first" },
          { id: "a", label: "second" },
        ],
      },
    };
    expect(() => validateAugmentationResult(result)).toThrow(/duplicate/i);
  });
});

describe("augmentChunk — orchestration", () => {
  it("returns empty result and does not call the client when shouldAugment is false", async () => {
    const calls: AugmentationChunkInput[] = [];
    const client: LlmClient = {
      async generateBootstrapAugmentation(chunk) {
        calls.push(chunk);
        return {
          candidate: {
            candidate_type: "constraint",
            title: "should not appear",
            body: "should not appear",
            scope: { layer: "project", project: "contexttrail" },
          },
        };
      },
    };
    const regex: AugmentationRegexOutput = { candidates: 1, clarifications: 0 };
    const result = await augmentChunk(CHUNK, regex, client);
    expect(result).toEqual({});
    expect(calls).toHaveLength(0);
  });

  it("calls the client and returns its (validated) output when shouldAugment is true", async () => {
    const expected: LlmAugmentationResult = {
      candidate: {
        candidate_type: "constraint",
        title: "Credential rotation cycle",
        body: "Credentials rotate every 90 days through the rotation worker.",
        scope: { layer: "project", project: "contexttrail" },
      },
    };
    const client: LlmClient = {
      async generateBootstrapAugmentation() {
        return expected;
      },
    };
    const result = await augmentChunk(CHUNK, { candidates: 0, clarifications: 0 }, client);
    expect(result).toEqual(expected);
  });

  it("propagates validation errors from the client", async () => {
    const client: LlmClient = {
      async generateBootstrapAugmentation() {
        return {
          clarification: {
            body: "broken",
            scope: { layer: "project", project: "contexttrail" },
            choices: [{ id: "only", label: "single choice" }],
          },
        };
      },
    };
    await expect(
      augmentChunk(CHUNK, { candidates: 0, clarifications: 0 }, client),
    ).rejects.toThrow(/choices/i);
  });
});

describe("mock LLM client", () => {
  it("returns the canned result for a given chunk stable_key", async () => {
    const canned: LlmAugmentationResult = {
      candidate: {
        candidate_type: "constraint",
        title: "Canned",
        body: "Canned body.",
        scope: { layer: "project", project: "contexttrail" },
      },
    };
    const client = createMockLlmClient({
      [CHUNK.stable_key]: canned,
    });
    const result = await client.generateBootstrapAugmentation(CHUNK, {
      candidates: 0,
      clarifications: 0,
    });
    expect(result).toEqual(canned);
  });

  it("returns an empty result when the chunk stable_key is not in the fixture map", async () => {
    const client = createMockLlmClient({});
    const result = await client.generateBootstrapAugmentation(CHUNK, {
      candidates: 0,
      clarifications: 0,
    });
    expect(result).toEqual({});
  });

  it("is deterministic across repeat calls", async () => {
    const canned: LlmAugmentationResult = {
      clarification: {
        body: "Determinism check",
        scope: { layer: "project", project: "contexttrail" },
        choices: [
          { id: "y", label: "yes" },
          { id: "n", label: "no" },
        ],
      },
    };
    const client = createMockLlmClient({ [CHUNK.stable_key]: canned });
    const a = await client.generateBootstrapAugmentation(CHUNK, {
      candidates: 0,
      clarifications: 0,
    });
    const b = await client.generateBootstrapAugmentation(CHUNK, {
      candidates: 0,
      clarifications: 0,
    });
    expect(a).toEqual(b);
    expect(a).toEqual(canned);
  });
});
