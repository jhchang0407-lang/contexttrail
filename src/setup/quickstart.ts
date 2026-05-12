import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runImport, type ImportSummary } from "../cli/import.js";
import {
  runCardBootstrap,
  type CardBootstrapResult,
} from "../cli/card-bootstrap.js";
import { importAcceptedCards, type CardImportSummary } from "../cards/lifecycle.js";
import { init, type InitResult } from "../config/init.js";
import { createHandlers } from "../mcp/handlers.js";
import type { SetupQuestion } from "./questions.js";
import { runSetupConversation, setupReadinessOutput } from "./conversation.js";
import type { SetupReadinessReport } from "./readiness-scan.js";
import type { NextStepSuggestion } from "./next-step.js";

export const QUICKSTART_IMPORT_PATTERNS = ["README.md", "docs/**/*.md"];

export type SetupQuickstartReadiness = {
  cwd: string;
  dimensions: SetupReadinessReport["dimensions"];
  suggestion: NextStepSuggestion;
  pending_inbox_items: number;
};

export type SetupQuickstartResult = {
  init: InitResult;
  import: ImportSummary;
  card_import: CardImportSummary;
  candidate_bootstrap:
    | {
        enabled: false;
        reason: string;
      }
    | {
        enabled: true;
        summary: CardBootstrapResult;
        guardrail: string;
      };
  readiness: SetupQuickstartReadiness;
  questions: SetupQuestion[];
};

export type SetupQuickstartOptions = {
  bootstrapCandidates?: boolean;
};

export async function runSetupQuickstart(
  cwd: string,
  options: SetupQuickstartOptions = {},
): Promise<SetupQuickstartResult> {
  const initResult = init(cwd);
  const importSummary = runImport(cwd, quickstartImportPatterns(cwd));
  const cardImportSummary = importAcceptedCards(cwd);
  const candidateBootstrap = options.bootstrapCandidates
    ? {
        enabled: true as const,
        summary: await runCardBootstrap(cwd, { llm: false }),
        guardrail:
          "Candidate bootstrap writes pending inbox items only; accepted Cards are not created or edited.",
      }
    : {
        enabled: false as const,
        reason:
          "Candidate bootstrap is opt-in. Rerun with --bootstrap-candidates to draft review inbox items.",
      };
  const handlers = createHandlers({ cwd });
  const conversation = await runSetupConversation(cwd, async (task) => {
    const pack = await handlers.retrieve_context_pack({ task });
    return { coverage_confidence: pack.coverage_confidence };
  });
  const readiness = setupReadinessOutput(conversation.readiness);

  return {
    init: initResult,
    import: importSummary,
    card_import: cardImportSummary,
    candidate_bootstrap: candidateBootstrap,
    readiness,
    questions: conversation.plan.questions,
  };
}

export function quickstartImportPatterns(cwd: string): string[] {
  if (hasMultilingualDocsTree(cwd)) return ["README.md", "docs/en/**/*.md"];
  return QUICKSTART_IMPORT_PATTERNS;
}

function hasMultilingualDocsTree(cwd: string): boolean {
  const docsDir = join(cwd, "docs");
  if (!existsSync(join(docsDir, "en", "docs"))) return false;
  try {
    const localeDocDirs = readdirSync(docsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => existsSync(join(docsDir, entry.name, "docs")));
    return localeDocDirs.length > 1;
  } catch {
    return false;
  }
}

export function renderSetupQuickstart(result: SetupQuickstartResult): string {
  const lines = [
    "ContextTrail quickstart",
    `init: ${result.init.created ? "created config" : "already initialized"}`,
    `import: ${result.import.files_imported} imported, ${result.import.files_unchanged} unchanged, ${result.import.chunks_written} chunks`,
    `cards: ${result.card_import.cards_imported} imported, ${result.card_import.cards_skipped} skipped`,
    `candidate bootstrap: ${result.candidate_bootstrap.enabled ? "wrote review inbox drafts" : "skipped"}`,
    `next: ${result.readiness.suggestion.message}`,
  ];
  if (result.questions.length > 0) {
    lines.push("questions:");
    for (const question of result.questions) {
      lines.push(`- ${question.prompt}`);
      if (question.command_preview) lines.push(`  preview: ${question.command_preview}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
