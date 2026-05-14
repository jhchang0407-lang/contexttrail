import { AGENT_COMPLETION_CASES } from "./agent-completion-probe.js";

export type AgentTaskSuccessBudget = "small" | "default" | "large";
export type AgentTaskSuccessLowSignalExpectation =
  | "ordinary"
  | "low_signal"
  | "signal_empty";

export type AgentTaskSuccessAnchors = {
  files: string[];
  symbols: string[];
  routes: string[];
};

export type AgentTaskSuccessExpectedChangeTarget =
  | {
      kind: "all_of";
      files: string[];
    }
  | {
      kind: "any_of";
      file_sets: string[][];
    };

export type AgentTaskSuccessCase = {
  ticket: string;
  commit_sha: string;
  task: string;
  budget: AgentTaskSuccessBudget;
  expected_change_target: AgentTaskSuccessExpectedChangeTarget;
  acceptable_outcome_notes: string[];
  required_anchors: AgentTaskSuccessAnchors;
  low_signal_expectation: AgentTaskSuccessLowSignalExpectation;
};

export type AgentTaskSuccessObservation = {
  surfaced_files: string[];
  changed_files: string[];
  support_cluster_files?: string[];
  evaluation_only_judge?: {
    acceptable: boolean;
    prompt: string;
    result: string;
  };
};

export type AgentTaskSuccessVerdict = {
  ticket: string;
  commit_sha: string;
  task: string;
  budget: AgentTaskSuccessBudget;
  lowSignalExpectation: AgentTaskSuccessLowSignalExpectation;
  expectedChangeTargetText: string;
  reachedRightFiles: boolean;
  acceptableChange: boolean;
  missingSurfacedFiles: string[];
  missingChangedFiles: string[];
  supportClusterFiles: string[];
  supportClusterChangedFiles: string[];
  supportClusterContributed: boolean;
  evaluationMode: "deterministic_file_set" | "evaluation_only_judge";
  judgePrompt?: string;
  judgeResult?: string;
  acceptableOutcomeNotes: string[];
};

export const AGENT_TASK_SUCCESS_CASES: AgentTaskSuccessCase[] = [
  {
    ticket: "THO-227",
    commit_sha: "2ecd946",
    task: "Implement the PRD-0027 nav sidebar parser sub-parsers.",
    budget: "default",
    expected_change_target: {
      kind: "all_of",
      files: [
        "src/parse/nav-parser.ts",
        "src/parse/nav-parser/docusaurus.ts",
        "src/parse/nav-parser/frontmatter.ts",
        "src/parse/nav-parser/mkdocs.ts",
        "src/parse/nav-parser/readme-as-index.ts",
        "src/parse/nav-parser/vitepress.ts",
      ],
    },
    acceptable_outcome_notes: [
      "The core parser plus the format-specific sub-parsers should land together.",
      "A partial change to only one format is not an acceptable implementation outcome for this slice.",
    ],
    required_anchors: {
      files: ["src/parse/nav-parser.ts"],
      symbols: [],
      routes: [],
    },
    low_signal_expectation: "ordinary",
  },
  {
    ticket: "THO-219",
    commit_sha: "b4ca552",
    task: "Build the extractCodeFenceEntities extractor with synthetic property coverage.",
    budget: "small",
    expected_change_target: {
      kind: "all_of",
      files: ["src/retrieve/code-fence-entities.ts"],
    },
    acceptable_outcome_notes: [
      "The implementation should land in the extractor module itself.",
      "Test-only churn without touching the extractor is not enough.",
    ],
    required_anchors: {
      files: ["src/retrieve/code-fence-entities.ts"],
      symbols: ["extractCodeFenceEntities"],
      routes: [],
    },
    low_signal_expectation: "ordinary",
  },
  {
    ticket: "THO-218",
    commit_sha: "9b62fd0",
    task: "Wire heading_aliases into source-rerank and the held-out validation flag path.",
    budget: "default",
    expected_change_target: {
      kind: "any_of",
      file_sets: [
        ["src/retrieve/source-rerank.ts"],
        [
          "src/retrieve/source-rerank.ts",
          "src/retrieve/heading-aliases-flag.ts",
        ],
      ],
    },
    acceptable_outcome_notes: [
      "The core rerank wiring is mandatory.",
      "The companion flag file may also change if the validation or flip path needs it.",
    ],
    required_anchors: {
      files: ["src/retrieve/source-rerank.ts"],
      symbols: [],
      routes: [],
    },
    low_signal_expectation: "ordinary",
  },
];

export function validateAgentTaskSuccessCases(
  cases: AgentTaskSuccessCase[],
): void {
  const panelTickets = new Set(AGENT_COMPLETION_CASES.map((entry) => entry.ticket));
  const seen = new Set<string>();
  for (const entry of cases) {
    if (seen.has(entry.ticket)) {
      throw new Error(`duplicate task-success ticket '${entry.ticket}'`);
    }
    seen.add(entry.ticket);
    if (!panelTickets.has(entry.ticket)) {
      throw new Error(
        `task-success case '${entry.ticket}' must reference an existing commit-grounded panel ticket`,
      );
    }
    if (entry.acceptable_outcome_notes.length === 0) {
      throw new Error(
        `task-success case '${entry.ticket}' must include acceptable outcome notes`,
      );
    }
    if (entry.expected_change_target.kind === "all_of") {
      if (entry.expected_change_target.files.length === 0) {
        throw new Error(
          `task-success case '${entry.ticket}' must include at least one expected changed file`,
        );
      }
      continue;
    }
    if (entry.expected_change_target.file_sets.length === 0) {
      throw new Error(
        `task-success case '${entry.ticket}' must include at least one expected changed file set`,
      );
    }
    for (const set of entry.expected_change_target.file_sets) {
      if (set.length === 0) {
        throw new Error(
          `task-success case '${entry.ticket}' contains an empty expected changed file set`,
        );
      }
    }
  }
}

function expectedFileSets(
  target: AgentTaskSuccessExpectedChangeTarget,
): string[][] {
  if (target.kind === "all_of") return [target.files];
  return target.file_sets;
}

function missingFromBestMatchingSet(
  sets: string[][],
  actual: string[],
): string[] {
  let bestMissing: string[] | undefined;
  for (const set of sets) {
    const missing = set.filter((file) => !actual.includes(file));
    if (
      bestMissing === undefined ||
      missing.length < bestMissing.length
    ) {
      bestMissing = missing;
    }
  }
  return bestMissing ?? [];
}

export function evaluateTaskSuccessCase(args: {
  fixture: AgentTaskSuccessCase;
  observation: AgentTaskSuccessObservation;
}): AgentTaskSuccessVerdict {
  const sets = expectedFileSets(args.fixture.expected_change_target);
  const missingSurfacedFiles = missingFromBestMatchingSet(
    sets,
    args.observation.surfaced_files,
  );
  const missingChangedFiles = missingFromBestMatchingSet(
    sets,
    args.observation.changed_files,
  );
  const reachedRightFiles = missingSurfacedFiles.length === 0;
  const acceptableChange =
    args.observation.evaluation_only_judge?.acceptable ??
    missingChangedFiles.length === 0;
  const expectedFiles = new Set(sets.flat());
  const supportClusterFiles = args.observation.support_cluster_files ?? [];
  const supportClusterChangedFiles = supportClusterFiles.filter((file) =>
    expectedFiles.has(file),
  );

  return {
    ticket: args.fixture.ticket,
    commit_sha: args.fixture.commit_sha,
    task: args.fixture.task,
    budget: args.fixture.budget,
    lowSignalExpectation: args.fixture.low_signal_expectation,
    expectedChangeTargetText: renderExpectedTarget(
      args.fixture.expected_change_target,
    ),
    reachedRightFiles,
    acceptableChange,
    missingSurfacedFiles,
    missingChangedFiles,
    supportClusterFiles,
    supportClusterChangedFiles,
    supportClusterContributed: supportClusterChangedFiles.length > 0,
    evaluationMode:
      args.observation.evaluation_only_judge === undefined
        ? "deterministic_file_set"
        : "evaluation_only_judge",
    judgePrompt: args.observation.evaluation_only_judge?.prompt,
    judgeResult: args.observation.evaluation_only_judge?.result,
    acceptableOutcomeNotes: args.fixture.acceptable_outcome_notes,
  };
}

function renderExpectedTarget(target: AgentTaskSuccessExpectedChangeTarget): string {
  if (target.kind === "all_of") return target.files.join(", ");
  return target.file_sets.map((set) => `[${set.join(", ")}]`).join(" or ");
}

export function renderTaskSuccessReport(
  verdicts: AgentTaskSuccessVerdict[],
): string {
  const lines: string[] = [];
  lines.push("========== TASK-SUCCESS REPORT ==========");
  for (const verdict of verdicts) {
    lines.push("");
    lines.push(`${verdict.ticket} (${verdict.commit_sha})`);
    lines.push(`  task: ${verdict.task}`);
    lines.push(`  budget: ${verdict.budget}`);
    lines.push(`  low_signal_expectation: ${verdict.lowSignalExpectation}`);
    lines.push(`  expected_change_target: ${verdict.expectedChangeTargetText}`);
    lines.push(`  reached_right_files: ${verdict.reachedRightFiles ? "yes" : "no"}`);
    lines.push(`  acceptable_change: ${verdict.acceptableChange ? "yes" : "no"}`);
    if (verdict.missingSurfacedFiles.length > 0) {
      lines.push(`  missing_surfaced_files: ${verdict.missingSurfacedFiles.join(", ")}`);
    }
    if (verdict.missingChangedFiles.length > 0) {
      lines.push(`  missing_changed_files: ${verdict.missingChangedFiles.join(", ")}`);
    }
    lines.push(
      `  support_cluster_contributed: ${verdict.supportClusterContributed ? "yes" : "no"}`,
    );
    if (verdict.supportClusterFiles.length > 0) {
      lines.push(`  support_cluster_files: ${verdict.supportClusterFiles.join(", ")}`);
    }
    lines.push(`  evaluation_mode: ${verdict.evaluationMode}`);
    if (verdict.judgePrompt) lines.push(`  judge_prompt: ${verdict.judgePrompt}`);
    if (verdict.judgeResult) lines.push(`  judge_result: ${verdict.judgeResult}`);
    lines.push("  acceptable outcome notes:");
    for (const note of verdict.acceptableOutcomeNotes) {
      lines.push(`    - ${note}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
