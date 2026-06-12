/**
 * Deterministic source-family graph.
 *
 * Groups top-N candidate sources into families using path hierarchy,
 * sibling-index relationships, basename/title similarity, source
 * links, and shared SourceProfile aliases. Each family member gets a
 * relationship label (parent, child, sibling, cousin) so
 * ambiguity-aware packing can decide when to keep a compact top-3
 * family pack instead of fighting over isolated chunks.
 */
import { describe, expect, it } from "vitest";
import { buildSourceFamilyGraph } from "./source-family.js";
import type { SourceProfile } from "../types/source-profile.js";

function profile(overrides: Partial<SourceProfile> = {}): SourceProfile {
  return {
    source_path: "docs/x.md",
    source_content_hash: "h",
    title: "X",
    h1: null,
    intro: null,
    heading_outline: [],
    doc_role: "canonical",
    role_source: "default",
    doc_purpose: "unknown",
    purpose_source: "default",
    aliases: [],
    summary: null,
    summary_source: "empty",
    questions_answered: [],
    questions_answered_source: "empty",
    chunk_count: 1,
    token_count: 100,
    indexed_at: "2026-05-09T00:00:00Z",
    ...overrides,
  };
}

function input(source_path: string, p: Partial<SourceProfile> = {}) {
  return { source_path, profile: profile({ source_path, ...p }) };
}

describe("buildSourceFamilyGraph — parent / child via sibling-index", () => {
  it("groups `mocking.md` and `mocking/modules.md` into the same family", () => {
    const graph = buildSourceFamilyGraph([
      input("docs/mocking.md", { title: "Mocking" }),
      input("docs/mocking/modules.md", { title: "Modules" }),
      input("docs/unrelated.md", { title: "Unrelated" }),
    ]);
    const parentMember = graph.members.find((m) => m.source_path === "docs/mocking.md")!;
    const childMember = graph.members.find((m) => m.source_path === "docs/mocking/modules.md")!;
    const otherMember = graph.members.find((m) => m.source_path === "docs/unrelated.md")!;
    expect(parentMember.family_id).toBe(childMember.family_id);
    expect(otherMember.family_id).not.toBe(parentMember.family_id);
    expect(parentMember.relationship).toBe("parent");
    expect(childMember.relationship).toBe("child");
  });
});

describe("buildSourceFamilyGraph — siblings under the same parent dir", () => {
  it("labels two files in the same dir as siblings", () => {
    const graph = buildSourceFamilyGraph([
      input("docs/mocking/modules.md"),
      input("docs/mocking/timers.md"),
    ]);
    const a = graph.members.find((m) => m.source_path === "docs/mocking/modules.md")!;
    const b = graph.members.find((m) => m.source_path === "docs/mocking/timers.md")!;
    expect(a.family_id).toBe(b.family_id);
    expect(a.relationship).toBe("sibling");
    expect(b.relationship).toBe("sibling");
  });

  it("promotes the sibling-index parent over its siblings when the index is in the candidate set", () => {
    const graph = buildSourceFamilyGraph([
      input("docs/mocking/modules.md"),
      input("docs/mocking/timers.md"),
      input("docs/mocking.md"),
    ]);
    const idx = graph.members.find((m) => m.source_path === "docs/mocking.md")!;
    expect(idx.relationship).toBe("parent");
    const a = graph.members.find((m) => m.source_path === "docs/mocking/modules.md")!;
    expect(a.relationship).toBe("child");
  });
});

describe("buildSourceFamilyGraph — cousin via shared grandparent", () => {
  it("groups files in different sibling subdirs under the same grandparent into one family", () => {
    const graph = buildSourceFamilyGraph([
      input("docs/api/middleware.md", { title: "Middleware" }),
      input("docs/concepts/middleware.md", { title: "Middleware" }),
    ]);
    const a = graph.members.find((m) => m.source_path === "docs/api/middleware.md")!;
    const b = graph.members.find((m) => m.source_path === "docs/concepts/middleware.md")!;
    expect(a.family_id).toBe(b.family_id);
    expect(a.relationship).toBe("cousin");
    expect(b.relationship).toBe("cousin");
  });
});

describe("buildSourceFamilyGraph — basename similarity (no path overlap)", () => {
  it("groups two files with the same stem in unrelated dirs as cousins", () => {
    const graph = buildSourceFamilyGraph([
      input("packages/zod/error-handling.md", { title: "Error handling" }),
      input("packages/api/error-handling.md", { title: "Error handling" }),
    ]);
    const a = graph.members.find((m) => m.source_path === "packages/zod/error-handling.md")!;
    const b = graph.members.find((m) => m.source_path === "packages/api/error-handling.md")!;
    expect(a.family_id).toBe(b.family_id);
    expect(["sibling", "cousin"]).toContain(a.relationship);
  });
});

describe("buildSourceFamilyGraph — does not invent families from query overlap", () => {
  it("does not group two unrelated docs that just share a common word in their title", () => {
    const graph = buildSourceFamilyGraph([
      input("docs/router.md", { title: "Router" }),
      input("services/orders/router-decisions.md", { title: "Router decisions" }),
    ]);
    const a = graph.members.find((m) => m.source_path === "docs/router.md")!;
    const b = graph.members.find((m) => m.source_path === "services/orders/router-decisions.md")!;
    // Different stems (router vs router-decisions), different ancestor
    // chains, no shared aliases — must NOT be one family.
    expect(a.family_id).not.toBe(b.family_id);
  });
});

describe("buildSourceFamilyGraph — index / overview parents", () => {
  it("labels README.md / index.md as the family parent over its directory siblings", () => {
    const graph = buildSourceFamilyGraph([
      input("packages/zod/README.md", { doc_purpose: "package_readme" }),
      input("packages/zod/error-handling.md"),
      input("packages/zod/optionality.md"),
    ]);
    const idx = graph.members.find((m) => m.source_path === "packages/zod/README.md")!;
    expect(idx.relationship).toBe("parent");
  });

  it("treats a file in a fresh, unrelated directory as its own family", () => {
    const graph = buildSourceFamilyGraph([
      input("a/x.md"),
      input("b/y.md"),
    ]);
    const a = graph.members.find((m) => m.source_path === "a/x.md")!;
    const b = graph.members.find((m) => m.source_path === "b/y.md")!;
    expect(a.family_id).not.toBe(b.family_id);
  });
});

describe("buildSourceFamilyGraph — alias-based linking", () => {
  it("groups two paths that share a high-confidence package alias", () => {
    const graph = buildSourceFamilyGraph([
      input("packages/zod/README.md", {
        aliases: [{ kind: "package", value: "zod", confidence: "high", origin: "package_name" }],
      }),
      input("docs/zod-overview.md", {
        aliases: [{ kind: "package", value: "zod", confidence: "high", origin: "package_name" }],
      }),
    ]);
    const a = graph.members.find((m) => m.source_path === "packages/zod/README.md")!;
    const b = graph.members.find((m) => m.source_path === "docs/zod-overview.md")!;
    expect(a.family_id).toBe(b.family_id);
  });

  it("does not group two paths that share only a low-confidence alias", () => {
    const graph = buildSourceFamilyGraph([
      input("a/x.md", {
        aliases: [{ kind: "title", value: "router", confidence: "low", origin: "title" }],
      }),
      input("b/y.md", {
        aliases: [{ kind: "title", value: "router", confidence: "low", origin: "title" }],
      }),
    ]);
    const a = graph.members.find((m) => m.source_path === "a/x.md")!;
    const b = graph.members.find((m) => m.source_path === "b/y.md")!;
    expect(a.family_id).not.toBe(b.family_id);
  });
});

describe("buildSourceFamilyGraph — graph shape", () => {
  it("returns one entry per input candidate, in input order", () => {
    const graph = buildSourceFamilyGraph([
      input("a/x.md"),
      input("a/y.md"),
      input("b/z.md"),
    ]);
    expect(graph.members.map((m) => m.source_path)).toEqual([
      "a/x.md",
      "a/y.md",
      "b/z.md",
    ]);
  });

  it("emits a families list with stable family_id values", () => {
    const graph = buildSourceFamilyGraph([
      input("docs/mocking.md"),
      input("docs/mocking/modules.md"),
      input("docs/unrelated.md"),
    ]);
    expect(graph.families.length).toBe(2);
    const familyIds = new Set(graph.members.map((m) => m.family_id));
    expect(familyIds.size).toBe(2);
  });
});
