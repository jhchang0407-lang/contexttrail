import { Command } from "commander";
import { createHandlers } from "../mcp/handlers.js";
import { renderSetupReadiness } from "../setup/render.js";
import {
  SetupQuestionAnswerError,
  renderSetupQuestions,
} from "../setup/questions.js";
import {
  answerCurrentSetupQuestion,
  runSetupConversation,
  setupReadinessOutput,
} from "../setup/conversation.js";
import {
  renderSetupQuickstart,
  runSetupQuickstart,
} from "../setup/quickstart.js";

function createSetupProbeRetriever(cwd: string) {
  const handlers = createHandlers({ cwd });
  return async (task: string) => {
    const pack = await handlers.retrieve_context_pack({ task });
    return { coverage_confidence: pack.coverage_confidence };
  };
}

export function registerSetupCommands(program: Command): void {
  const setupCmd = program
    .command("setup")
    .description(
      "Scan repo readiness across the four dimensions and suggest the next step",
    )
    .option("--json", "emit structured JSON instead of plain text")
    .option(
      "--explain",
      "include per-dimension evidence and per-probe rationale",
    )
    .action(async (opts: { json?: boolean; explain?: boolean }) => {
      const cwd = process.cwd();
      const conversation = await runSetupConversation(cwd, createSetupProbeRetriever(cwd));
      if (opts.json) {
        const json = setupReadinessOutput(conversation.readiness);
        process.stdout.write(JSON.stringify(json, null, 2) + "\n");
        return;
      }
      process.stdout.write(
        renderSetupReadiness({
          report: conversation.readiness.report,
          suggestion: conversation.readiness.suggestion,
          explain: opts.explain ?? false,
        }),
      );
    });

  setupCmd
    .command("quickstart")
    .description("Initialize, import obvious docs, and show setup questions")
    .option(
      "--bootstrap-candidates",
      "draft candidate Cards into the review inbox after importing docs",
    )
    .option("--json", "emit structured JSON instead of plain text")
    .action(async function (
      this: Command,
      opts: { bootstrapCandidates?: boolean },
    ) {
      const result = await runSetupQuickstart(process.cwd(), {
        bootstrapCandidates: opts.bootstrapCandidates ?? false,
      });
      if (this.opts().json || this.parent?.opts().json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        return;
      }
      process.stdout.write(renderSetupQuickstart(result));
    });

  setupCmd
    .command("questions")
    .description("Show curated setup triage prompts for this repo")
    .option("--json", "emit structured JSON instead of plain text")
    .action(async function (this: Command) {
      const cwd = process.cwd();
      const { plan } = await runSetupConversation(cwd, createSetupProbeRetriever(cwd));
      if (this.opts().json || this.parent?.opts().json) {
        process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
        return;
      }
      process.stdout.write(renderSetupQuestions(plan));
    });

  setupCmd
    .command("answer")
    .description("Answer a high-leverage setup question and preview the resulting setup action")
    .argument("<question-id>", "setup question id from `contexttrail setup questions`")
    .option("--choice <choiceId>", "choose one offered setup answer")
    .option("--text <answer>", "provide a free-text setup answer")
    .option("--json", "emit structured JSON instead of plain text")
    .action(
      async function (
        this: Command,
        questionId: string,
        opts: { choice?: string; text?: string },
      ) {
        const cwd = process.cwd();
        try {
          const result = await answerCurrentSetupQuestion(cwd, createSetupProbeRetriever(cwd), {
            question_id: questionId,
            choice_id: opts.choice,
            free_text: opts.text,
          });
          if (this.opts().json || this.parent?.opts().json) {
            process.stdout.write(JSON.stringify(result, null, 2) + "\n");
            return;
          }
          console.log(`Setup answer: ${result.question_id}`);
          if (result.action.type === "command_preview") {
            console.log(`Preview: ${result.action.command}`);
          } else {
            console.log(`Inbox answer applied: ${result.action.review_item_id}`);
          }
          console.log(result.action.message);
        } catch (err) {
          if (err instanceof SetupQuestionAnswerError) {
            console.error(`contexttrail setup answer: ${err.message}`);
            process.exit(2);
          }
          throw err;
        }
      },
    );
}
