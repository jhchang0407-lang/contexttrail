import { describe, expect, it } from "vitest";
import { classifyOssCodeLanePromptMiss } from "./oss-code-lane-autopsy.js";

describe("classifyOssCodeLanePromptMiss", () => {
  it("labels top-3 misses with ranked hits as first-slate displacement", () => {
    expect(
      classifyOssCodeLanePromptMiss({
        query: "fix css parser operand ratio",
        changedFiles: ["crates/biome_css_parser/src/syntax/scss/expression/operand.rs"],
        topThreeCodeFiles: ["crates/biome_css_parser/src/syntax/mod.rs"],
        rankedCodeChangedFiles: [
          "crates/biome_css_parser/src/syntax/scss/expression/operand.rs",
        ],
        supportClusterChangedFiles: [],
        mentionedFiles: [],
        candidateRecall: [],
      }),
    ).toMatchObject({
      primaryCause: "ranked_below_top3",
      firstUsefulDepth: "ranked_pack",
    });
  });

  it("labels top-100 misses with no useful recall as generation misses", () => {
    expect(
      classifyOssCodeLanePromptMiss({
        query: "release ci workflow",
        changedFiles: ["crates/biome_js_analyze/src/lint/nursery/no_base_to_string.rs"],
        topThreeCodeFiles: ["scripts/release.rs"],
        rankedCodeChangedFiles: [],
        supportClusterChangedFiles: [],
        mentionedFiles: [],
        candidateRecall: [
          {
            depth: 10,
            codeFiles: [],
            changedFiles: [],
            fileHits: 0,
            fileTotal: 1,
            useful: false,
          },
          {
            depth: 100,
            codeFiles: [],
            changedFiles: [],
            fileHits: 0,
            fileTotal: 1,
            useful: false,
          },
        ],
      }),
    ).toMatchObject({
      primaryCause: "candidate_generation_miss",
      firstUsefulDepth: "missing_at_100",
    });
  });

  it("adds weak-prompt and large-target modifiers", () => {
    expect(
      classifyOssCodeLanePromptMiss({
        query: "perf reduced queries in rules",
        changedFiles: [
          "crates/biome_css_analyze/src/lint/style/no_descending_specificity.rs",
          "crates/biome_js_analyze/src/lint/complexity/no_extra_boolean_cast.rs",
          "crates/biome_js_analyze/src/lint/complexity/use_numeric_literals.rs",
          "crates/biome_js_analyze/src/lint/nursery/use_sorted_classes.rs",
        ],
        topThreeCodeFiles: ["crates/biome_analyze/src/query.rs"],
        rankedCodeChangedFiles: [],
        supportClusterChangedFiles: [],
        mentionedFiles: [],
        candidateRecall: [],
      }),
    ).toMatchObject({
      modifiers: expect.arrayContaining([
        "large_target_set",
        "weak_prompt_identity",
      ]),
    });
  });
});
