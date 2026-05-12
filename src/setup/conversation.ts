import {
  answerSetupQuestion,
  proposeSetupQuestions,
  type SetupQuestionAnswerInput,
  type SetupQuestionAnswerResult,
  type SetupQuestionPlan,
} from "./questions.js";
import {
  runSetupReadiness,
  type SetupReadinessRunResult,
} from "./run.js";
import type { ProbeRetriever } from "./probes.js";
import type { SetupReadinessReport } from "./readiness-scan.js";
import type { NextStepSuggestion } from "./next-step.js";

export type SetupConversationRun = {
  readiness: SetupReadinessRunResult;
  plan: SetupQuestionPlan;
};

export type SetupReadinessOutput = {
  cwd: string;
  dimensions: SetupReadinessReport["dimensions"];
  suggestion: NextStepSuggestion;
  pending_inbox_items: number;
};

export async function runSetupConversation(
  cwd: string,
  retriever: ProbeRetriever,
): Promise<SetupConversationRun> {
  const readiness = await runSetupReadiness(cwd, retriever);
  return {
    readiness,
    plan: proposeSetupQuestions(cwd, readiness),
  };
}

export async function answerCurrentSetupQuestion(
  cwd: string,
  retriever: ProbeRetriever,
  input: SetupQuestionAnswerInput,
): Promise<SetupQuestionAnswerResult> {
  const conversation = await runSetupConversation(cwd, retriever);
  return answerSetupQuestion(conversation.plan, input);
}

export function setupReadinessOutput(
  readiness: SetupReadinessRunResult,
): SetupReadinessOutput {
  return {
    cwd: readiness.report.cwd,
    dimensions: readiness.report.dimensions,
    suggestion: readiness.suggestion,
    pending_inbox_items: readiness.pending_inbox_items,
  };
}
