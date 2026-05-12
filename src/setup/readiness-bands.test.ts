/**
 * THO-249 (PRD-0033 / 33.1) — setup readiness band tests.
 *
 * Bands are locked thresholds; future changes ship in the same commit as
 * the ADR-0022 amendment per the ADR-0021 Rule 3 convention.
 */
import { describe, expect, it } from "vitest";
import {
  SETUP_READINESS_BANDS,
  bandForCorpusCoverage,
  bandForScopeCoverage,
  bandForCardCoverage,
  bandForRetrievalProbes,
} from "./readiness-bands.js";

describe("SETUP_READINESS_BANDS constant", () => {
  it("locks the PRD-0033 four-dimension table verbatim", () => {
    expect(SETUP_READINESS_BANDS.corpus_coverage).toEqual({
      low_max: 0.30,
      partial_max: 0.70,
      minimum_chunk_floor: 5,
    });
    expect(SETUP_READINESS_BANDS.scope_coverage).toEqual({
      low_max: 0.50,
      partial_max: 0.80,
    });
    expect(SETUP_READINESS_BANDS.card_coverage).toEqual({
      partial_max_cards: 5,
      confident_min_cards: 6,
    });
    expect(SETUP_READINESS_BANDS.retrieval_probes).toEqual({
      low_max: 0.50,
      partial_max: 0.80,
    });
  });

  it("is frozen so callers cannot mutate thresholds at runtime", () => {
    expect(Object.isFrozen(SETUP_READINESS_BANDS)).toBe(true);
    expect(Object.isFrozen(SETUP_READINESS_BANDS.corpus_coverage)).toBe(true);
    expect(Object.isFrozen(SETUP_READINESS_BANDS.scope_coverage)).toBe(true);
    expect(Object.isFrozen(SETUP_READINESS_BANDS.card_coverage)).toBe(true);
    expect(Object.isFrozen(SETUP_READINESS_BANDS.retrieval_probes)).toBe(true);
  });
});

describe("bandForCorpusCoverage", () => {
  // Floor takes precedence: < 5 imported chunks → always low.
  it("returns low when importedChunks < 5 even at 100% file fraction", () => {
    expect(
      bandForCorpusCoverage({ discoverable: 4, imported: 4, importedChunks: 4 }),
    ).toBe("low");
  });
  it("clears the floor at exactly 5 imported chunks (and high fraction)", () => {
    expect(
      bandForCorpusCoverage({ discoverable: 5, imported: 5, importedChunks: 5 }),
    ).toBe("confident");
  });
  it("returns low when discoverable=0 (nothing to import against)", () => {
    expect(
      bandForCorpusCoverage({ discoverable: 0, imported: 0, importedChunks: 0 }),
    ).toBe("low");
  });

  // Just-below / just-above 30%
  it("returns low at 29/100 imported (just below 30%)", () => {
    expect(
      bandForCorpusCoverage({ discoverable: 100, imported: 29, importedChunks: 100 }),
    ).toBe("low");
  });
  it("returns partial at 30/100 imported (lower edge)", () => {
    expect(
      bandForCorpusCoverage({ discoverable: 100, imported: 30, importedChunks: 100 }),
    ).toBe("partial");
  });

  // Just-below / just-above 70%
  it("returns partial at 69/100 imported (just below 70%)", () => {
    expect(
      bandForCorpusCoverage({ discoverable: 100, imported: 69, importedChunks: 200 }),
    ).toBe("partial");
  });
  it("returns confident at 70/100 imported (upper edge)", () => {
    expect(
      bandForCorpusCoverage({ discoverable: 100, imported: 70, importedChunks: 200 }),
    ).toBe("confident");
  });
});

describe("bandForScopeCoverage", () => {
  it("returns low when no chunks at all", () => {
    expect(bandForScopeCoverage({ totalChunks: 0, scopedChunks: 0 })).toBe("low");
  });
  it("returns low at 49/100 scoped (just below 50%)", () => {
    expect(bandForScopeCoverage({ totalChunks: 100, scopedChunks: 49 })).toBe("low");
  });
  it("returns partial at 50/100 scoped (lower edge)", () => {
    expect(bandForScopeCoverage({ totalChunks: 100, scopedChunks: 50 })).toBe("partial");
  });
  it("returns partial at 79/100 scoped (just below 80%)", () => {
    expect(bandForScopeCoverage({ totalChunks: 100, scopedChunks: 79 })).toBe("partial");
  });
  it("returns confident at 80/100 scoped (upper edge)", () => {
    expect(bandForScopeCoverage({ totalChunks: 100, scopedChunks: 80 })).toBe("confident");
  });
});

describe("bandForCardCoverage", () => {
  it("returns low when there are 0 accepted cards", () => {
    expect(bandForCardCoverage({ acceptedCards: 0, constraintCards: 0 })).toBe("low");
  });
  it("returns partial with 1 accepted card and 0 constraints", () => {
    expect(bandForCardCoverage({ acceptedCards: 1, constraintCards: 0 })).toBe("partial");
  });
  it("returns partial at 5 accepted cards (upper edge of partial)", () => {
    expect(bandForCardCoverage({ acceptedCards: 5, constraintCards: 2 })).toBe("partial");
  });
  it("returns partial at ≥6 cards but 0 constraints (PRD says ≥1 constraint required for confident)", () => {
    expect(bandForCardCoverage({ acceptedCards: 10, constraintCards: 0 })).toBe("partial");
  });
  it("returns confident at exactly 6 cards including 1 constraint", () => {
    expect(bandForCardCoverage({ acceptedCards: 6, constraintCards: 1 })).toBe("confident");
  });
});

describe("bandForRetrievalProbes", () => {
  it("returns low when no probes ran", () => {
    expect(bandForRetrievalProbes({ totalProbes: 0, confidentProbes: 0 })).toBe("low");
  });
  it("returns low at 2/6 confident (just below 50%)", () => {
    expect(bandForRetrievalProbes({ totalProbes: 6, confidentProbes: 2 })).toBe("low");
  });
  it("returns partial at 3/6 confident (50% lower edge)", () => {
    expect(bandForRetrievalProbes({ totalProbes: 6, confidentProbes: 3 })).toBe("partial");
  });
  it("returns confident at 5/6 confident (≥80% upper edge)", () => {
    // 5/6 ≈ 0.833 ≥ 0.80
    expect(bandForRetrievalProbes({ totalProbes: 6, confidentProbes: 5 })).toBe("confident");
  });
  it("returns confident at 4/5 confident (exactly 80%)", () => {
    expect(bandForRetrievalProbes({ totalProbes: 5, confidentProbes: 4 })).toBe("confident");
  });
});
