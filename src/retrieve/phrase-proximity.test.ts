/**
 * Phrase / proximity feature extractor.
 *
 * Synthetic probes for the deterministic feature shape the extractor
 * needs to cover:
 *   - exact phrase vs scattered terms (and the unhit "none" case)
 *   - title/H1 phrase vs body density
 *   - heading phrase vs body density
 *   - path phrase
 *   - near phrase (one intervening token)
 *   - ordered token window (multi-word filename / topic phrases)
 *
 * The extractor is deterministic and pure — no IO, no production rank
 * change. It is the diagnostic surface a planned pairwise-adjudication
 * stage will consume; these tests only ensure the evidence is correct
 * and visible.
 */
import { describe, expect, it } from "vitest";
import {
  extractPhraseProximity,
  type PhraseProximityFields,
} from "./phrase-proximity.js";

const blankFields: PhraseProximityFields = {
  path: "",
  title: "",
  h1: "",
  headings: [],
  intro: "",
  body: "",
};

describe("extractPhraseProximity — exact vs scattered", () => {
  it("reports exact when query tokens appear consecutively in the field", () => {
    const out = extractPhraseProximity("browser mode", {
      ...blankFields,
      title: "Browser mode",
    });
    expect(out.title).toBe("exact");
    expect(out.best_field).toBe("title");
    expect(out.best_hit).toBe("exact");
  });

  it("reports scattered when all query tokens appear but not adjacent", () => {
    const out = extractPhraseProximity("browser mode", {
      ...blankFields,
      body: "Use mode-aware tools when running in the browser. Other notes.",
    });
    // "browser" and "mode" both appear but not within near/ordered windows.
    expect(out.body === "scattered" || out.body === "ordered").toBe(true);
    expect(out.body).not.toBe("exact");
    expect(out.body).not.toBe("near");
  });

  it("reports none when any query token is missing", () => {
    const out = extractPhraseProximity("browser mode", {
      ...blankFields,
      body: "Some other content about runtimes.",
    });
    expect(out.body).toBe("none");
    expect(out.best_field).toBe("none");
  });
});

describe("extractPhraseProximity — title and H1 vs body density", () => {
  it("prefers a title phrase hit over heavy body term density", () => {
    const out = extractPhraseProximity("error handling", {
      ...blankFields,
      title: "Error handling",
      body: "errors errors errors errors handling handling handling",
    });
    expect(out.title).toBe("exact");
    expect(out.best_field).toBe("title");
  });

  it("recognizes phrase in H1 separately from generic heading evidence", () => {
    const out = extractPhraseProximity("shadow database", {
      ...blankFields,
      h1: "Shadow database",
    });
    expect(out.h1).toBe("exact");
    expect(out.best_field).toBe("h1");
  });
});

describe("extractPhraseProximity — heading phrase vs body density", () => {
  it("reports heading hit when a phrase appears in a non-H1 heading", () => {
    const out = extractPhraseProximity("shadow database", {
      ...blankFields,
      headings: ["Configuration", "Advanced > Shadow database > Notes"],
      body: "shadow shadow shadow shadow database database database",
    });
    expect(out.heading).toBe("exact");
    // best_field should prefer the structural heading hit over body.
    expect(out.best_field === "heading").toBe(true);
  });
});

describe("extractPhraseProximity — path phrase", () => {
  it("recognizes hyphenated path basenames as exact phrase hits", () => {
    const out = extractPhraseProximity("error handling", {
      ...blankFields,
      path: "packages/zod/docs/error-handling.md",
    });
    // Path tokenization splits on `-`, `/`, etc., so "error" and
    // "handling" are adjacent in path tokens.
    expect(out.path).toBe("exact");
  });

  it("does not count an unrelated path basename as a phrase hit", () => {
    const out = extractPhraseProximity("browser mode", {
      ...blankFields,
      path: "packages/some-other/docs/runtimes.md",
    });
    expect(out.path).toBe("none");
  });
});

describe("extractPhraseProximity — near phrase (one intervening token)", () => {
  it("reports near when a single intervening token separates the phrase", () => {
    const out = extractPhraseProximity("browser mode", {
      ...blankFields,
      body: "the browser preview mode is enabled in tests",
    });
    // One intervening token ("preview") between query tokens — near, not exact.
    expect(out.body).toBe("near");
  });

  it("ranks near above ordered/scattered for the best_hit summary", () => {
    const out = extractPhraseProximity("error handling", {
      ...blankFields,
      headings: ["custom error handling"],
      body: "errors are surfaced; handling is delegated; other content.",
    });
    expect(out.heading).toBe("exact");
    expect(["exact", "near"]).toContain(out.best_hit);
  });
});

describe("extractPhraseProximity — multi-token ordered window", () => {
  it("recognizes an ordered window when tokens appear in order with gaps", () => {
    const out = extractPhraseProximity("error handling middleware", {
      ...blankFields,
      body: "error logs use the handling layer to feed the middleware pipeline",
    });
    // "error" ... "handling" ... "middleware" all appear in order within
    // a small window — that's the "ordered" tier.
    expect(["exact", "near", "ordered"]).toContain(out.body);
    expect(out.body).not.toBe("scattered");
  });

  it("falls back to scattered when tokens are out of order or far apart", () => {
    const out = extractPhraseProximity("error handling middleware", {
      ...blankFields,
      body:
        "middleware setup is documented elsewhere. " +
        "Many sentences here describe other concerns. ".repeat(20) +
        "Eventually, handling concerns are addressed. " +
        "Errors come up too in unrelated paragraphs at the end of the doc.",
    });
    expect(out.body).toBe("scattered");
  });
});

describe("extractPhraseProximity — best_field precedence", () => {
  it("prefers path/title/h1 over heading/intro/body when tied at exact", () => {
    const out = extractPhraseProximity("router", {
      ...blankFields,
      path: "router.md",
      title: "Router",
      h1: "Router",
      headings: ["Router"],
      intro: "router",
      body: "router router router",
    });
    expect(["path", "title", "h1"]).toContain(out.best_field);
    expect(out.best_hit).toBe("exact");
  });

  it("falls back to body when only body has any hit", () => {
    const out = extractPhraseProximity("snapshot testing", {
      ...blankFields,
      body: "snapshot testing is a technique used here.",
    });
    expect(out.best_field).toBe("body");
    expect(out.body).toBe("exact");
  });
});

describe("extractPhraseProximity — single-token query (degenerate)", () => {
  it("treats a single query token as exact when present in any field", () => {
    const out = extractPhraseProximity("typescript", {
      ...blankFields,
      title: "TypeScript",
    });
    expect(out.title).toBe("exact");
  });

  it("reports none when the single token is missing", () => {
    const out = extractPhraseProximity("typescript", {
      ...blankFields,
      title: "JavaScript guide",
    });
    expect(out.title).toBe("none");
  });
});
