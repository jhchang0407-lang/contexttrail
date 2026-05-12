import { describe, expect, it } from "vitest";
import {
  BOT_EMOJI_PREFIXES,
  generateBootstrapProposals,
  isBootstrapNoise,
  isBotEmojiNoise,
  isTranslationGlossaryNoise,
} from "./proposals.js";

describe("bootstrap proposal generation", () => {
  it("returns separate deduped candidate and clarification proposal collections", () => {
    const proposals = generateBootstrapProposals({
      listCanonicalChunks: () => [
        {
          stable_key: "chunk-1",
          source_path: "docs/runbooks/refunds.md",
          heading_path: ["Refund runbook"],
          version_id: "v1",
          body: "Refunds must never exceed the captured amount.",
          scope: { layer: "project", project: "contexttrail" },
        },
        {
          stable_key: "chunk-2",
          source_path: "docs/adr/refunds.md",
          heading_path: ["Refund decision"],
          version_id: "v2",
          body: [
            "Refunds must never exceed the captured amount.",
            "",
            "Operators should not bypass the ledger review step.",
          ].join("\n"),
          scope: { layer: "project", project: "contexttrail" },
        },
      ],
      getConfidentSymbolAnchors: () => [],
    });

    expect(proposals.candidates).toHaveLength(1);
    expect(proposals.clarifications).toHaveLength(1);
    expect(proposals.summary).toEqual({
      chunks_considered: 2,
      candidate_sentences: 3,
      constraint_candidates_written: 1,
      symbol_note_candidates_written: 0,
      clarification_needs_written: 1,
      merged_duplicates: 1,
    });

    expect(proposals.candidates[0]).toMatchObject({
      candidate_type: "constraint",
      body: "Refunds must never exceed the captured amount.",
      scope: { layer: "project", project: "contexttrail" },
    });
    expect(proposals.candidates[0]?.supporting_chunks).toHaveLength(2);

    expect(proposals.clarifications[0]).toMatchObject({
      body: "Operators should not bypass the ledger review step.",
      scope: { layer: "project", project: "contexttrail" },
    });
    expect(proposals.clarifications[0]?.supporting_chunks).toEqual([
      expect.objectContaining({
        chunk_stable_key: "chunk-2",
        source_path: "docs/adr/refunds.md",
      }),
    ]);
  });
});

// PRD-0036 / 36.4 (B5): Phase 0 fastapi findings — narrow, high-precision
// detectors that skip noisy sentences BEFORE the tone match fires.
describe("bootstrap noise filtering — PRD-0036 / 36.4", () => {
  describe("isBotEmojiNoise (B5a)", () => {
    it("matches every documented bot-tag emoji prefix", () => {
      for (const emoji of BOT_EMOJI_PREFIXES) {
        expect(isBotEmojiNoise(`${emoji} something must happen here.`)).toBe(true);
      }
    });

    it("matches after leading whitespace", () => {
      expect(isBotEmojiNoise("   👷 must update CI workflows.")).toBe(true);
    });

    // Real ContextTrail / fastapi rules don't lead with these emojis — guard
    // against false-positive regressions on representative genuine sentences.
    it("does not false-positive on real ContextTrail-style rules", () => {
      const realRules = [
        "Refunds must never exceed the captured amount.",
        "All retry work must run through the queue worker.",
        "Operators should not bypass the ledger review step.",
        "Bootstrap must always emit deterministic candidate ordering.",
        "Card authors should not duplicate symbol_note bodies across scopes.",
        "Do not commit secrets to this repository.",
      ];
      for (const r of realRules) {
        expect(isBotEmojiNoise(r)).toBe(false);
      }
    });
  });

  describe("isTranslationGlossaryNoise (B5b)", () => {
    it("matches fastapi-style translation-glossary entries", () => {
      const fastapiSamples = [
        "Media type: media type (do not translate to a localized form).",
        "API key: API key (do not translate this term).",
        "HTTP: HTTP (do not translate, keep as-is in all languages).",
      ];
      for (const s of fastapiSamples) {
        expect(isTranslationGlossaryNoise(s)).toBe(true);
      }
    });

    it("does not false-positive on real rules that happen to use colons", () => {
      const realRules = [
        "Note: refunds must never exceed the captured amount.",
        "Warning: bootstrap should not bypass the inbox review step.",
        "Refund flow: operators must record a reason before issuing.",
        "Symbol overview: LedgerEntry coordinates billing writes.",
      ];
      for (const r of realRules) {
        expect(isTranslationGlossaryNoise(r)).toBe(false);
      }
    });

    it("requires the literal '(do not translate' trigger", () => {
      expect(
        isTranslationGlossaryNoise("Word: word (this is just a parenthetical)."),
      ).toBe(false);
    });
  });

  it("isBootstrapNoise is the union of both detectors", () => {
    expect(isBootstrapNoise("👷 bot tag prefix line.")).toBe(true);
    expect(
      isBootstrapNoise("Term: term (do not translate this entry)."),
    ).toBe(true);
    expect(
      isBootstrapNoise("Refunds must never exceed the captured amount."),
    ).toBe(false);
  });

  it("integration: detectors actually filter inside generateBootstrapProposals", () => {
    const proposals = generateBootstrapProposals({
      listCanonicalChunks: () => [
        {
          stable_key: "chunk-bot",
          source_path: "docs/release-notes.md",
          heading_path: ["Release notes"],
          version_id: "v-bot",
          body: [
            // Bot-emoji prefix — would otherwise match `must` and become a candidate.
            "👷 GitHub Actions workflow must run on every push.",
            // Genuine rule with no emoji prefix — should survive.
            "Operators must record a reason before issuing refunds.",
          ].join("\n\n"),
          scope: { layer: "project", project: "fastapi" },
        },
        {
          stable_key: "chunk-glossary",
          source_path: "docs/contributing.md",
          heading_path: ["Style guide"],
          version_id: "v-glossary",
          body: [
            // Translation-glossary — would otherwise match `do not` (strong tone).
            "Media type: media type (do not translate to a localized form).",
            // Genuine rule — should survive.
            "Pull requests must include a changelog entry.",
          ].join("\n\n"),
          scope: { layer: "project", project: "fastapi" },
        },
      ],
      getConfidentSymbolAnchors: () => [],
    });

    // Both real rules survived; both noisy ones were dropped.
    expect(proposals.candidates).toHaveLength(2);
    const bodies = proposals.candidates.map((c) => c.body);
    expect(bodies).toContain("Operators must record a reason before issuing refunds.");
    expect(bodies).toContain("Pull requests must include a changelog entry.");
    for (const c of proposals.candidates) {
      expect(c.body).not.toMatch(/^👷/);
      expect(c.body).not.toMatch(/\(do not translate/);
    }
  });
});
