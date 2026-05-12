import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "./db.js";
import { openDb, closeDb } from "./db.js";
import {
  upsertSourceProfile,
  getSourceProfile,
  listSourceProfiles,
  deleteSourceProfile,
} from "./source-profiles.js";
import type { SourceProfile } from "../types/source-profile.js";

const NOW = "2026-05-08T00:00:00Z";

function makeProfile(overrides: Partial<SourceProfile> = {}): SourceProfile {
  return {
    source_path: "docs/foo.md",
    source_content_hash: "h0",
    title: "Foo",
    h1: "Foo",
    intro: "An intro paragraph.",
    heading_outline: [
      { level: 1, text: "Foo", slug: "foo" },
      { level: 2, text: "Setup", slug: "setup" },
    ],
    doc_role: "canonical",
    role_source: "default",
    doc_purpose: "concept",
    purpose_source: "path_rule",
    aliases: [
      { kind: "filename", value: "foo", confidence: "high", origin: "filename" },
      { kind: "title", value: "Foo", confidence: "high", origin: "title" },
    ],
    summary: "Foo\n\nAn intro paragraph.",
    summary_source: "deterministic_intro",
    questions_answered: [],
    questions_answered_source: "empty",
    chunk_count: 3,
    token_count: 250,
    indexed_at: NOW,
    ...overrides,
  };
}

let tmp: string;
let db: Db;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "contexttrail-sp-"));
  db = openDb(join(tmp, "contexttrail.db"));
});

afterEach(() => {
  closeDb(db);
  rmSync(tmp, { recursive: true, force: true });
});

describe("source profile storage", () => {
  it("round-trips a profile by source_path", () => {
    const p = makeProfile();
    upsertSourceProfile(db, p);
    const got = getSourceProfile(db, "docs/foo.md");
    expect(got).toEqual(p);
  });

  it("upsert replaces previous content (heading outline, aliases, purpose)", () => {
    upsertSourceProfile(db, makeProfile());
    const p2 = makeProfile({
      title: "Foo v2",
      doc_purpose: "guide",
      purpose_source: "title_rule",
      heading_outline: [{ level: 1, text: "Foo v2", slug: "foo-v2" }],
      aliases: [{ kind: "title", value: "Foo v2", confidence: "high", origin: "title" }],
      source_content_hash: "h1",
    });
    upsertSourceProfile(db, p2);
    const got = getSourceProfile(db, "docs/foo.md");
    expect(got).toEqual(p2);
  });

  it("listSourceProfiles returns all profiles sorted by source_path", () => {
    upsertSourceProfile(db, makeProfile({ source_path: "docs/b.md" }));
    upsertSourceProfile(db, makeProfile({ source_path: "docs/a.md" }));
    const got = listSourceProfiles(db);
    expect(got.map((p) => p.source_path)).toEqual(["docs/a.md", "docs/b.md"]);
  });

  it("deleteSourceProfile removes the profile and its aliases", () => {
    upsertSourceProfile(db, makeProfile());
    deleteSourceProfile(db, "docs/foo.md");
    expect(getSourceProfile(db, "docs/foo.md")).toBeNull();
  });

  it("PRD-0024 / 24.2.2 round-trips code_fence_entities through the JSON column", () => {
    const p = makeProfile({
      code_fence_entities: [
        {
          kind: "symbol",
          value: "publicProcedure",
          normalized: "publicprocedure",
          language: "ts",
          section_heading: "Routers",
        },
        {
          kind: "package_name",
          value: "@trpc/server",
          normalized: "@trpc/server",
          language: "ts",
          section_heading: "Routers",
        },
      ],
    });
    upsertSourceProfile(db, p);
    const got = getSourceProfile(db, "docs/foo.md");
    expect(got?.code_fence_entities).toEqual(p.code_fence_entities);
  });

  it("loads code_fence_entities as undefined when the column is null (pre-PRD-0024 row)", () => {
    upsertSourceProfile(db, makeProfile());
    const got = getSourceProfile(db, "docs/foo.md");
    expect(got?.code_fence_entities).toBeUndefined();
  });

  it("PRD-0027 / 27.1.2 round-trips nav fields", () => {
    const p = makeProfile({
      nav_section_id: "server",
      nav_position: 1,
      nav_label: "Routers",
      is_nav_landing: true,
      nav_origin: "vitepress",
      nav_provenance: "explicit_config",
    });
    upsertSourceProfile(db, p);
    const got = getSourceProfile(db, "docs/foo.md");
    expect(got?.nav_section_id).toBe("server");
    expect(got?.nav_position).toBe(1);
    expect(got?.nav_label).toBe("Routers");
    expect(got?.is_nav_landing).toBe(true);
    expect(got?.nav_origin).toBe("vitepress");
    expect(got?.nav_provenance).toBe("explicit_config");
  });

  it("loads nav fields as undefined when the columns are null (pre-PRD-0027 row)", () => {
    upsertSourceProfile(db, makeProfile());
    const got = getSourceProfile(db, "docs/foo.md");
    expect(got?.nav_section_id).toBeUndefined();
    expect(got?.nav_position).toBeUndefined();
    expect(got?.nav_label).toBeUndefined();
    expect(got?.is_nav_landing).toBeUndefined();
    expect(got?.nav_origin).toBeUndefined();
    expect(got?.nav_provenance).toBeUndefined();
  });
});
