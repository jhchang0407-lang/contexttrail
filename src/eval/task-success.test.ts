import { describe, expect, it } from "vitest";
import {
  AGENT_TASK_SUCCESS_CASES,
  evaluateTaskSuccessCase,
  renderTaskSuccessReport,
  validateAgentTaskSuccessCases,
  type AgentTaskSuccessCase,
} from "./task-success.js";

describe("AGENT_TASK_SUCCESS_CASES", () => {
  it("stays adjacent to the commit-grounded panel and validates required fields", () => {
    expect(AGENT_TASK_SUCCESS_CASES.length).toBeGreaterThan(0);
    expect(() => validateAgentTaskSuccessCases(AGENT_TASK_SUCCESS_CASES)).not.toThrow();
  });
});

describe("evaluateTaskSuccessCase", () => {
  it("distinguishes reaching the right files from producing an acceptable change", () => {
    const verdict = evaluateTaskSuccessCase({
      fixture: {
        ticket: "THO-999",
        commit_sha: "abc1234",
        task: "Update the parser sub-parsers",
        budget: "default",
        expected_change_target: {
          kind: "all_of",
          files: ["src/parse/nav-parser.ts", "src/parse/nav-parser/vitepress.ts"],
        },
        acceptable_outcome_notes: ["Parser and vitepress sub-parser land together."],
        required_anchors: {
          files: ["src/parse/nav-parser.ts"],
          symbols: [],
          routes: [],
        },
        low_signal_expectation: "ordinary",
      },
      observation: {
        surfaced_files: ["src/parse/nav-parser.ts", "src/parse/nav-parser/vitepress.ts"],
        changed_files: ["src/parse/nav-parser.ts"],
      },
    });

    expect(verdict.reachedRightFiles).toBe(true);
    expect(verdict.acceptableChange).toBe(false);
    expect(verdict.missingChangedFiles).toEqual(["src/parse/nav-parser/vitepress.ts"]);
    expect(verdict.evaluationMode).toBe("deterministic_file_set");
  });

  it("supports any-of file-set targets and evaluation-only judge results", () => {
    const fixture: AgentTaskSuccessCase = {
      ticket: "THO-998",
      commit_sha: "def5678",
      task: "Wire heading aliases into source rerank",
      budget: "small",
      expected_change_target: {
        kind: "any_of",
        file_sets: [
          ["src/retrieve/source-rerank.ts"],
          ["src/retrieve/source-rerank.ts", "src/retrieve/heading-aliases-flag.ts"],
        ],
      },
      acceptable_outcome_notes: ["Either the core rerank file alone or the paired flag flip is acceptable."],
      required_anchors: {
        files: ["src/retrieve/source-rerank.ts"],
        symbols: ["scoreSourceRerank"],
        routes: [],
      },
      low_signal_expectation: "ordinary",
    };

    const verdict = evaluateTaskSuccessCase({
      fixture,
      observation: {
        surfaced_files: ["src/retrieve/source-rerank.ts"],
        changed_files: ["src/retrieve/source-rerank.ts"],
        evaluation_only_judge: {
          acceptable: true,
          prompt: "Judge whether the diff satisfied the rerank wiring task.",
          result: "Acceptable because the rerank path was wired without unnecessary churn.",
        },
      },
    });

    expect(verdict.reachedRightFiles).toBe(true);
    expect(verdict.acceptableChange).toBe(true);
    expect(verdict.evaluationMode).toBe("evaluation_only_judge");
    expect(verdict.judgePrompt).toContain("Judge whether the diff");
    expect(verdict.judgeResult).toContain("Acceptable because");
  });

  it("attributes task-success reachability to support-cluster files", () => {
    const verdict = evaluateTaskSuccessCase({
      fixture: {
        ticket: "THO-997",
        commit_sha: "fedcba9",
        task: "Implement schema-backed source rerank support.",
        budget: "default",
        expected_change_target: {
          kind: "all_of",
          files: ["src/retrieve/source-rerank.ts", "src/store/schema.ts"],
        },
        acceptable_outcome_notes: ["The owner and schema support file should both be visible."],
        required_anchors: {
          files: ["src/retrieve/source-rerank.ts"],
          symbols: ["scoreSourceRerank"],
          routes: [],
        },
        low_signal_expectation: "ordinary",
      },
      observation: {
        surfaced_files: ["src/retrieve/source-rerank.ts", "src/store/schema.ts"],
        changed_files: ["src/retrieve/source-rerank.ts", "src/store/schema.ts"],
        support_cluster_files: ["src/store/schema.ts"],
      },
    });

    expect(verdict.supportClusterContributed).toBe(true);
    expect(verdict.supportClusterChangedFiles).toEqual(["src/store/schema.ts"]);
    expect(renderTaskSuccessReport([verdict])).toContain("support_cluster_contributed: yes");
  });
});

describe("renderTaskSuccessReport", () => {
  it("renders visible file-vs-outcome verdicts without private evaluator internals", () => {
    const report = renderTaskSuccessReport([
      evaluateTaskSuccessCase({
        fixture: AGENT_TASK_SUCCESS_CASES[0]!,
        observation: {
          surfaced_files: [...("files" in AGENT_TASK_SUCCESS_CASES[0]!.expected_change_target ? [] : [])],
          changed_files: [],
        },
      }),
    ]);

    expect(report).toContain("TASK-SUCCESS REPORT");
    expect(report).toContain("expected_change_target");
    expect(report).toContain("reached_right_files");
    expect(report).toContain("acceptable_change");
    expect(report).toContain("acceptable outcome notes");
    expect(report).toContain(AGENT_TASK_SUCCESS_CASES[0]!.ticket);
  });
});
