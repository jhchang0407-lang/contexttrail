/**
 * Chunk-correctness helper.
 *
 * `evaluateChunkCorrectness` decides whether the engine picked the right
 * section inside a selected source. It returns null when the case has no
 * chunk-level expectation declared, so summary metrics can correctly omit
 * unscored cases, preserving the distinction between source correctness
 * and chunk correctness.
 */
import { describe, it, expect } from "vitest";
import { evaluateChunkCorrectness } from "./chunk-correctness.js";

describe("evaluateChunkCorrectness", () => {
  it("returns null when no expected chunk headings are declared", () => {
    expect(
      evaluateChunkCorrectness(undefined, "Source: docs/x.md > Section: Intro > Part: 1/3"),
    ).toBeNull();
    expect(
      evaluateChunkCorrectness([], "Source: docs/x.md > Section: Intro > Part: 1/3"),
    ).toBeNull();
  });

  it("returns false when the top chunk is missing entirely", () => {
    expect(evaluateChunkCorrectness(["Install"], undefined)).toBe(false);
  });

  it("returns true when any expected heading appears as a substring in the contexttrail", () => {
    expect(
      evaluateChunkCorrectness(
        ["Install"],
        "Source: docs/setup.md > Section: Install > Part: 1/2",
      ),
    ).toBe(true);
  });

  it("matches case-insensitively to tolerate heading capitalization contexttrail", () => {
    expect(
      evaluateChunkCorrectness(
        ["install"],
        "Source: docs/setup.md > Section: Install > Part: 1/2",
      ),
    ).toBe(true);
  });

  it("returns false when none of the expected headings match", () => {
    expect(
      evaluateChunkCorrectness(
        ["Migration", "Upgrade"],
        "Source: docs/setup.md > Section: Install > Part: 1/2",
      ),
    ).toBe(false);
  });

  it("treats a list of expected headings as OR — any match suffices", () => {
    expect(
      evaluateChunkCorrectness(
        ["Migration", "Install"],
        "Source: docs/setup.md > Section: Install > Part: 1/2",
      ),
    ).toBe(true);
  });
});
