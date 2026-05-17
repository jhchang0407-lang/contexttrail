import type { AgentCompletionCase } from "./agent-completion-probe.js";

export type ExpandedPromptPanelOptions = {
  targetPromptVariantsPerCase?: number;
};

export const DEFAULT_TARGET_PROMPT_VARIANTS_PER_CASE = 10;

const PROMPT_LENSES: Array<(args: {
  ticket: string;
  query: string;
}) => string> = [
  ({ query }) => `implementation files for ${query}`,
  ({ query }) => `code owner and support files for ${query}`,
  ({ query }) => `where is ${query} wired in the code`,
  ({ query }) => `modify ${query} safely`,
  ({ query }) => `debug the implementation path for ${query}`,
  ({ query }) => `entrypoint and data flow for ${query}`,
  ({ query }) => `minimal code context for ${query}`,
  ({ ticket, query }) => `${ticket} code change path ${query}`,
  ({ query }) => `supporting schema parser store workflow for ${query}`,
  ({ query }) => `rank the files needed to implement ${query}`,
];

export function expandAgentCompletionPromptPanel<T extends AgentCompletionCase>(
  cases: readonly T[],
  options: ExpandedPromptPanelOptions = {},
): T[] {
  const targetPromptVariantsPerCase =
    options.targetPromptVariantsPerCase ??
    DEFAULT_TARGET_PROMPT_VARIANTS_PER_CASE;

  return cases.map((testCase) => ({
    ...testCase,
    queries: expandQueriesForCase(testCase, targetPromptVariantsPerCase),
  }));
}

export function countPrompts(
  cases: readonly Pick<AgentCompletionCase, "queries">[],
): number {
  return cases.reduce((sum, testCase) => sum + testCase.queries.length, 0);
}

function expandQueriesForCase(
  testCase: AgentCompletionCase,
  targetPromptVariantsPerCase: number,
): string[] {
  const out = new Set(testCase.queries);
  let lensIndex = 0;
  while (out.size < targetPromptVariantsPerCase) {
    const query = testCase.queries[lensIndex % testCase.queries.length]!;
    const lens = PROMPT_LENSES[lensIndex % PROMPT_LENSES.length]!;
    out.add(normalizePrompt(lens({ ticket: testCase.ticket, query })));
    lensIndex += 1;
  }
  return [...out].slice(0, targetPromptVariantsPerCase);
}

function normalizePrompt(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim();
}
