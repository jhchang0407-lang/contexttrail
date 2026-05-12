import { describe, expect, it } from "vitest";
import { createMockLlmClient } from "./llm-client.js";
import {
  runAugmentationPass,
  type AugmentationChunkRecord,
  type AugmentationRunOptions,
} from "./augmentation-run.js";
import type { InboxScope } from "../inbox/items.js";

const SCOPE: InboxScope = { layer: "project", project: "contexttrail" };

function makeChunk(
  id: string,
  regex: { candidates: number; clarifications: number },
): AugmentationChunkRecord {
  return {
    stable_key: id,
    source_path: `docs/${id}.md`,
    heading_path: [id],
    version_id: id,
    body: `Body for chunk ${id}`,
    scope: SCOPE,
    regex,
  };
}

describe("runAugmentationPass — selective invocation + cap", () => {
  it("skips chunks where regex already produced a strong candidate", async () => {
    const calls: string[] = [];
    const client = {
      async generateBootstrapAugmentation(chunk: { stable_key: string }) {
        calls.push(chunk.stable_key);
        return {};
      },
    };
    const result = await runAugmentationPass({
      chunks: [
        makeChunk("a", { candidates: 1, clarifications: 0 }),
        makeChunk("b", { candidates: 0, clarifications: 1 }),
        makeChunk("c", { candidates: 0, clarifications: 0 }),
      ],
      client,
    });
    expect(calls.sort()).toEqual(["b", "c"]);
    expect(result.summary.chunks_processed).toBe(2);
    expect(result.summary.candidates_added).toBe(0);
    expect(result.summary.clarifications_added).toBe(0);
  });

  it("processes qualifying chunks in stable_key order and stops at the cap", async () => {
    const calls: string[] = [];
    const client = {
      async generateBootstrapAugmentation(chunk: { stable_key: string }) {
        calls.push(chunk.stable_key);
        return {};
      },
    };
    const chunks = Array.from({ length: 6 }).map((_, i) =>
      // Deliberately non-alphabetic order so we can verify the sort.
      makeChunk(`ch-${String(6 - i).padStart(2, "0")}`, { candidates: 0, clarifications: 0 }),
    );
    const options: AugmentationRunOptions = {
      chunks,
      client,
      perRunCap: 3,
    };
    const result = await runAugmentationPass(options);
    expect(calls).toEqual(["ch-01", "ch-02", "ch-03"]);
    expect(result.summary.chunks_processed).toBe(3);
    expect(result.summary.chunks_skipped_over_cap).toBe(3);
    expect(result.summary.warnings).toContainEqual(
      expect.objectContaining({ kind: "cap_exceeded" }),
    );
  });

  it("emits a candidate draft with authored_by: contexttrail-bootstrap-llm when the client returns a candidate", async () => {
    const client = createMockLlmClient({
      "ch-01": {
        candidate: {
          candidate_type: "constraint",
          title: "Rotation cycle",
          body: "Rotation runs every 90 days.",
          scope: SCOPE,
        },
      },
    });
    const result = await runAugmentationPass({
      chunks: [makeChunk("ch-01", { candidates: 0, clarifications: 0 })],
      client,
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.authored_by).toBe("contexttrail-bootstrap-llm");
    expect(result.candidates[0]?.body).toBe("Rotation runs every 90 days.");
    expect(result.candidates[0]?.supporting_chunks?.[0]?.chunk_stable_key).toBe("ch-01");
    expect(result.summary.candidates_added).toBe(1);
  });

  it("emits a clarification draft with authored_by + choices + free_text_allowed=false", async () => {
    const client = createMockLlmClient({
      "ch-01": {
        clarification: {
          body: "Is the 90-day cycle a strict policy?",
          scope: SCOPE,
          choices: [
            { id: "strict", label: "Strict policy" },
            { id: "loose", label: "Rough cadence" },
          ],
        },
      },
    });
    const result = await runAugmentationPass({
      chunks: [makeChunk("ch-01", { candidates: 0, clarifications: 0 })],
      client,
    });
    expect(result.clarifications).toHaveLength(1);
    expect(result.clarifications[0]?.authored_by).toBe("contexttrail-bootstrap-llm");
    expect(result.clarifications[0]?.choices.map((c) => c.id)).toEqual(["strict", "loose"]);
    expect(result.clarifications[0]?.free_text_allowed).toBe(false);
    expect(result.summary.clarifications_added).toBe(1);
  });

  it("records a warning and continues when the client throws on one chunk", async () => {
    let calls = 0;
    const client = {
      async generateBootstrapAugmentation(chunk: { stable_key: string }) {
        calls += 1;
        if (chunk.stable_key === "ch-02") {
          throw new Error("AbortError: timeout");
        }
        return {
          candidate: {
            candidate_type: "constraint" as const,
            title: chunk.stable_key,
            body: `Body for ${chunk.stable_key}`,
            scope: SCOPE,
          },
        };
      },
    };
    const result = await runAugmentationPass({
      chunks: [
        makeChunk("ch-01", { candidates: 0, clarifications: 0 }),
        makeChunk("ch-02", { candidates: 0, clarifications: 0 }),
        makeChunk("ch-03", { candidates: 0, clarifications: 0 }),
      ],
      client,
    });
    expect(calls).toBe(3);
    expect(result.candidates.map((c) => c.title)).toEqual(["ch-01", "ch-03"]);
    expect(result.summary.warnings).toContainEqual(
      expect.objectContaining({
        kind: "chunk_failed",
        chunk_stable_key: "ch-02",
      }),
    );
    expect(result.summary.candidates_added).toBe(2);
  });

  it("formats the cost-summary string using the summary counters", async () => {
    const client = createMockLlmClient({
      "ch-01": {
        candidate: {
          candidate_type: "constraint",
          title: "t",
          body: "b",
          scope: SCOPE,
        },
      },
    });
    const result = await runAugmentationPass({
      chunks: [makeChunk("ch-01", { candidates: 0, clarifications: 0 })],
      client,
    });
    const line = formatAugmentationSummary(result.summary);
    expect(line).toMatch(/LLM augmentation/);
    expect(line).toMatch(/1 chunk/);
    expect(line).toMatch(/1 candidate/);
    expect(line).toMatch(/0 clarification/);
  });
});

// Imported lazily so the symbol exists for the assertion above without a
// top-level cycle.
import { formatAugmentationSummary } from "./augmentation-run.js";
