#!/usr/bin/env node
import {
  AGENT_COMPLETION_CASES,
  runAgentCompletionEvalDetailedForPanel,
  type AgentCompletionCase,
  type AgentCompletionDetailedSummary,
} from "./agent-completion-probe.js";
import {
  wilsonLowerBound,
  type OssCodeLaneGeneralizationMetric,
} from "./oss-code-lane-generalization.js";
import {
  countPrompts,
  expandAgentCompletionPromptPanel,
} from "./prompt-panel-expansion.js";

export {
  expandAgentCompletionPromptPanel,
  type ExpandedPromptPanelOptions,
} from "./prompt-panel-expansion.js";

export type ExpandedPromptPanelSummary = {
  basePromptCount: number;
  expandedPromptCount: number;
  confidence: number;
  promptTop3: OssCodeLaneGeneralizationMetric;
  promptRanked: OssCodeLaneGeneralizationMetric;
  ticketsTop3Robust: OssCodeLaneGeneralizationMetric;
  misses: ExpandedPromptPanelMiss[];
};

export type ExpandedPromptPanelMiss = {
  ticket: string;
  query: string;
  topThreeCodeFiles: string[];
  rankedCodeChangedFiles: string[];
};

export type RunExpandedPromptPanelEvalOptions = {
  repoRoot?: string;
  cases?: readonly AgentCompletionCase[];
  targetPromptVariantsPerCase?: number;
  confidence?: number;
};

const DEFAULT_CONFIDENCE = 0.99;
const REPO_ROOT = process.env.AGENT_COMPLETION_REPO_ROOT ?? process.cwd();

export async function runExpandedPromptPanelEval(
  options: RunExpandedPromptPanelEvalOptions = {},
): Promise<ExpandedPromptPanelSummary> {
  const cases = options.cases ?? AGENT_COMPLETION_CASES;
  const expandedCases = expandAgentCompletionPromptPanel(cases, {
    targetPromptVariantsPerCase: options.targetPromptVariantsPerCase,
  });
  const summary = await runAgentCompletionEvalDetailedForPanel({
    repoRoot: options.repoRoot ?? REPO_ROOT,
    cases: expandedCases,
    codeSourceIndexEnabled: true,
  });
  return summarizePromptPanel({
    basePromptCount: countPrompts(cases),
    expandedPromptCount: countPrompts(expandedCases),
    confidence: options.confidence ?? DEFAULT_CONFIDENCE,
    summary,
  });
}

export function summarizePromptPanel(args: {
  basePromptCount: number;
  expandedPromptCount: number;
  confidence: number;
  summary: AgentCompletionDetailedSummary;
}): ExpandedPromptPanelSummary {
  const promptSummary = args.summary.promptVariantSummary;
  return {
    basePromptCount: args.basePromptCount,
    expandedPromptCount: args.expandedPromptCount,
    confidence: args.confidence,
    promptTop3: metric(
      promptSummary?.promptTop3Useful ?? 0,
      promptSummary?.promptCount ?? 0,
      args.confidence,
    ),
    promptRanked: metric(
      promptSummary?.promptRankedUseful ?? 0,
      promptSummary?.promptCount ?? 0,
      args.confidence,
    ),
    ticketsTop3Robust: metric(
      promptSummary?.ticketsTop3Robust ?? 0,
      promptSummary?.ticketsWithPromptVariants ?? 0,
      args.confidence,
    ),
    misses: collectPromptMisses(args.summary),
  };
}

export function renderExpandedPromptPanelReport(
  summary: ExpandedPromptPanelSummary,
): string {
  const lines = [
    "========== EXPANDED CODE-LANE PROMPT PANEL ==========",
    `Base prompts: ${summary.basePromptCount}`,
    `Expanded prompts: ${summary.expandedPromptCount}`,
    `Confidence: ${pct(summary.confidence)}`,
    "",
    "Metrics:",
    `  prompt top-3 useful: ${renderMetric(
      summary.promptTop3,
      summary.confidence,
    )}`,
    `  prompt ranked useful: ${renderMetric(
      summary.promptRanked,
      summary.confidence,
    )}`,
    `  tickets top-3 robust: ${renderMetric(
      summary.ticketsTop3Robust,
      summary.confidence,
    )}`,
  ];
  if (summary.misses.length > 0) {
    lines.push("");
    lines.push("Top misses:");
    for (const miss of summary.misses.slice(0, 20)) {
      lines.push(`  ${miss.ticket}: ${miss.query}`);
      lines.push(
        `    top3=${joinOrNone(miss.topThreeCodeFiles)} ranked_changed=${joinOrNone(
          miss.rankedCodeChangedFiles,
        )}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function collectPromptMisses(
  summary: AgentCompletionDetailedSummary,
): ExpandedPromptPanelMiss[] {
  return (summary.rows ?? []).flatMap((row) =>
    (row.promptVariants ?? [])
      .filter((variant) => !variant.topThreeCodeUseful)
      .map((variant) => ({
        ticket: row.ticket,
        query: variant.query,
        topThreeCodeFiles: variant.topThreeCodeFiles,
        rankedCodeChangedFiles: variant.rankedCodeChangedFiles,
      })),
  );
}

function metric(
  hits: number,
  total: number,
  confidence: number,
): OssCodeLaneGeneralizationMetric {
  return {
    hits,
    total,
    rate: total === 0 ? 0 : hits / total,
    lowerConfidenceBound: wilsonLowerBound(hits, total, confidence),
  };
}

function renderMetric(
  metric: OssCodeLaneGeneralizationMetric,
  confidence: number,
): string {
  return `${metric.hits}/${metric.total} (${formatRate(
    metric.rate,
  )}, lower${pct(confidence)}=${formatRate(metric.lowerConfidenceBound)})`;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function joinOrNone(values: readonly string[]): string {
  return values.length === 0 ? "(none)" : values.join(", ");
}

function numberArg(
  argv: readonly string[],
  name: string,
): number | undefined {
  const raw = argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) return undefined;
  const value = Number(raw.replace(`--${name}=`, ""));
  if (!Number.isFinite(value)) {
    throw new Error(`--${name} must be a finite number`);
  }
  return value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const summary = await runExpandedPromptPanelEval({
    targetPromptVariantsPerCase:
      numberArg(argv, "target-prompts-per-case") ??
      (process.env.CODE_LANE_EXPANDED_PROMPTS_PER_CASE
        ? Number(process.env.CODE_LANE_EXPANDED_PROMPTS_PER_CASE)
        : undefined),
    confidence: numberArg(argv, "confidence") ?? DEFAULT_CONFIDENCE,
  });
  process.stdout.write(renderExpandedPromptPanelReport(summary));
}

if (
  process.argv[1]?.endsWith("code-lane-expanded-prompt-panel.js") ||
  process.argv[1]?.endsWith("code-lane-expanded-prompt-panel.ts")
) {
  void main().catch((err) => {
    process.stderr.write(
      `${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
