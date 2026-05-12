import { describe, expect, it } from "vitest";
import { createTestCorpus } from "../eval/test-corpus.js";
import {
  answerCurrentSetupQuestion,
  runSetupConversation,
  setupReadinessOutput,
} from "./conversation.js";

describe("setup conversation module", () => {
  it("runs readiness, proposes setup questions, and answers the current plan", async () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-setup-conversation-" });
    try {
      const conversation = await runSetupConversation(corpus.cwd, async () => ({
        coverage_confidence: "empty",
      }));

      expect(setupReadinessOutput(conversation.readiness).cwd).toBe(corpus.cwd);
      expect(conversation.plan.questions.map((question) => question.id)).toContain(
        "import-docs",
      );

      const answer = await answerCurrentSetupQuestion(
        corpus.cwd,
        async () => ({ coverage_confidence: "empty" }),
        {
          question_id: "import-docs",
          choice_id: "docs_glob",
        },
      );

      expect(answer.action).toEqual({
        type: "command_preview",
        command: "contexttrail import docs/**/*.md",
        message:
          "Preview only. Run the command yourself when you are ready; setup answers do not execute operational commands.",
      });
      expect(answer.writes).toEqual([]);
    } finally {
      corpus.cleanup();
    }
  });
});
