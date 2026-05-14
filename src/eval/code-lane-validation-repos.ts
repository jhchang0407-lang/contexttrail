import {
  AGENT_COMPLETION_CASES,
  type AgentCompletionCase,
} from "./agent-completion-probe.js";

export type CodeLaneValidationRepo = {
  id: string;
  name: string;
  repoRoot: string;
  minimumTaskPanel: string[];
  whyRealistic: string;
  whyUnfamiliar: string;
  accessAssumptions: string[];
  agentCompletionCases: AgentCompletionCase[];
};

export const PRIMARY_CODE_LANE_VALIDATION_REPO: CodeLaneValidationRepo = {
  id: "contexttrail",
  name: "ContextTrail",
  repoRoot: process.cwd(),
  minimumTaskPanel: ["THO-228", "THO-227", "THO-229", "THO-225"],
  whyRealistic:
    "Primary production repo with the existing 14-ticket commit-grounded panel already used by the agent-completion probe.",
  whyUnfamiliar:
    "Serves as the baseline repo only; it is intentionally the familiar control surface rather than the unfamiliar expansion surface.",
  accessAssumptions: [
    "Run from the current DriftLedger checkout.",
    "No extra language support is required beyond the existing TS/JS and markdown import path.",
  ],
  agentCompletionCases: AGENT_COMPLETION_CASES,
};

export const RALPH_CODE_LANE_VALIDATION_REPO: CodeLaneValidationRepo = {
  id: "ralph",
  name: "Ralph",
  repoRoot: "/Users/thomaschang/Repos/Ralph",
  minimumTaskPanel: ["THO-25", "THO-24", "THO-23", "THO-17"],
  whyRealistic:
    "Ralph is a separate working TypeScript CLI with its own PRD, ADRs, architecture docs, test suite, and ticket-shaped implementation history.",
  whyUnfamiliar:
    "Its autonomous queue-runner and Linear workflow domain is meaningfully different from ContextTrail's retrieval engine while staying inside the same TS/markdown technical envelope.",
  accessAssumptions: [
    "Use the local checkout at /Users/thomaschang/Repos/Ralph.",
    "Assume the repo stays within TS/JS + markdown so PRD-0042 does not expand language support.",
    "Ground the panel in shipped commits rather than synthetic prompts.",
  ],
  agentCompletionCases: [
    {
      ticket: "THO-25",
      commit_sha: "13e51ae",
      queries: [
        "THO-25 markdown summary rendering of JSON artifacts",
        "render markdown summaries for run manifest worker validator artifacts",
        "ticket summary run summary iteration summary markdown",
      ],
    },
    {
      ticket: "THO-24",
      commit_sha: "1e56bad",
      queries: [
        "THO-24 takeover command adopts blocked or in-progress tickets",
        "takeoverTicket autonomous human_steered blocked in-progress",
        "reuse retry budget from prior handoff takeover branch strategy",
      ],
    },
    {
      ticket: "THO-23",
      commit_sha: "ca325d2",
      queries: [
        "THO-23 reset command clears stale lock and run state",
        "resetRunState clear repo lock active run preserve manifests",
        "stale lock reset active-run confirm",
      ],
    },
    {
      ticket: "THO-17",
      commit_sha: "b42194d",
      queries: [
        "THO-17 validator command runner with failure classification",
        "validateWorkerOutput policy_failure command_failure scope_failure",
        "worker result validator commands forbidden path scan",
      ],
    },
  ],
};
