/**
 * THO-161 (PRD-0016 / P16.3): deterministic source role and canonicality
 * classifier.
 *
 * The existing `SourceProfile` already carries a coarse `doc_purpose`
 * (api_reference / concept / guide / migration / changelog / runbook /
 * adr / readme / example / …). PRD-0016 needs a richer overlay that
 * speaks the precision-layer vocabulary — overview, guide, reference,
 * api, config, concept, decision, changelog, migration,
 * troubleshooting, example, child_detail, parent_container — and
 * carries explicit provenance + confidence so weak inferences cannot
 * silently overrule strong evidence.
 *
 * The synthetic probes below walk the failure cohorts the PRD calls
 * out:
 *   - parent guide vs child detail
 *   - concept vs procedural leaf
 *   - changelog vs README / migration
 *   - guide vs API reference
 *   - config / reference roles
 */
import { describe, expect, it } from "vitest";
import { classifySourceRole } from "./source-role.js";
import type { SourceProfile } from "../types/source-profile.js";

function profile(overrides: Partial<SourceProfile> = {}): SourceProfile {
  return {
    source_path: "docs/x.md",
    source_content_hash: "h1",
    title: "X",
    h1: "X",
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

describe("classifySourceRole — doc_purpose mapping", () => {
  it("maps api_reference to role=api with provenance from doc_purpose", () => {
    const out = classifySourceRole({
      source_path: "docs/api/reference.md",
      profile: profile({
        source_path: "docs/api/reference.md",
        doc_purpose: "api_reference",
        purpose_source: "frontmatter",
      }),
    });
    expect(out.role).toBe("api");
    expect(out.confidence).toBe("high");
    expect(out.provenance.map((p) => p.signal)).toContain("doc_purpose");
  });

  it("maps concept to role=concept", () => {
    const out = classifySourceRole({
      source_path: "docs/concepts/middleware.md",
      profile: profile({
        source_path: "docs/concepts/middleware.md",
        doc_purpose: "concept",
        purpose_source: "path_rule",
      }),
    });
    expect(out.role).toBe("concept");
  });

  it("maps changelog and release_note to role=changelog", () => {
    expect(
      classifySourceRole({
        source_path: "CHANGELOG.md",
        profile: profile({ source_path: "CHANGELOG.md", doc_purpose: "changelog", purpose_source: "title_rule" }),
      }).role,
    ).toBe("changelog");
    expect(
      classifySourceRole({
        source_path: "RELEASES.md",
        profile: profile({ source_path: "RELEASES.md", doc_purpose: "release_note", purpose_source: "title_rule" }),
      }).role,
    ).toBe("changelog");
  });

  it("maps migration to role=migration distinct from changelog", () => {
    const out = classifySourceRole({
      source_path: "MIGRATION.md",
      profile: profile({ source_path: "MIGRATION.md", doc_purpose: "migration", purpose_source: "title_rule" }),
    });
    expect(out.role).toBe("migration");
  });

  it("maps adr/prd to role=decision", () => {
    expect(
      classifySourceRole({
        source_path: "docs/adr/0007-hybrid.md",
        profile: profile({ source_path: "docs/adr/0007-hybrid.md", doc_purpose: "adr", purpose_source: "path_rule" }),
      }).role,
    ).toBe("decision");
    expect(
      classifySourceRole({
        source_path: "docs/prd/0016.md",
        profile: profile({ source_path: "docs/prd/0016.md", doc_purpose: "prd", purpose_source: "path_rule" }),
      }).role,
    ).toBe("decision");
  });

  it("maps runbook to role=troubleshooting", () => {
    const out = classifySourceRole({
      source_path: "docs/runbooks/incident.md",
      profile: profile({
        source_path: "docs/runbooks/incident.md",
        doc_purpose: "runbook",
        purpose_source: "path_rule",
      }),
    });
    expect(out.role).toBe("troubleshooting");
  });

  it("maps readme/package_readme to role=overview", () => {
    expect(
      classifySourceRole({
        source_path: "README.md",
        profile: profile({ source_path: "README.md", doc_purpose: "readme", purpose_source: "title_rule" }),
      }).role,
    ).toBe("overview");
    expect(
      classifySourceRole({
        source_path: "packages/zod/README.md",
        profile: profile({
          source_path: "packages/zod/README.md",
          doc_purpose: "package_readme",
          purpose_source: "path_rule",
        }),
      }).role,
    ).toBe("overview");
  });

  it("maps example to role=example", () => {
    const out = classifySourceRole({
      source_path: "examples/basic.md",
      profile: profile({ source_path: "examples/basic.md", doc_purpose: "example", purpose_source: "path_rule" }),
    });
    expect(out.role).toBe("example");
  });

  it("maps guide and quick_start to role=guide", () => {
    expect(
      classifySourceRole({
        source_path: "docs/guides/getting-started.md",
        profile: profile({
          source_path: "docs/guides/getting-started.md",
          doc_purpose: "guide",
          purpose_source: "path_rule",
        }),
      }).role,
    ).toBe("guide");
    expect(
      classifySourceRole({
        source_path: "docs/quickstart.md",
        profile: profile({
          source_path: "docs/quickstart.md",
          doc_purpose: "quick_start",
          purpose_source: "path_rule",
        }),
      }).role,
    ).toBe("guide");
  });
});

describe("classifySourceRole — config detection", () => {
  it("detects config role from path basename even when doc_purpose is unknown", () => {
    const out = classifySourceRole({
      source_path: "docs/configuration.md",
      profile: profile({ source_path: "docs/configuration.md", doc_purpose: "unknown" }),
    });
    expect(out.role).toBe("config");
    expect(out.provenance.map((p) => p.signal)).toContain("path_basename");
  });

  it("detects config role from a `config/` parent directory", () => {
    const out = classifySourceRole({
      source_path: "docs/config/database.md",
      profile: profile({ source_path: "docs/config/database.md", doc_purpose: "unknown" }),
    });
    expect(out.role).toBe("config");
  });
});

describe("classifySourceRole — troubleshooting detection without runbook label", () => {
  it("detects troubleshooting from path basename or parent dir", () => {
    expect(
      classifySourceRole({
        source_path: "docs/troubleshooting.md",
        profile: profile({ source_path: "docs/troubleshooting.md", doc_purpose: "unknown" }),
      }).role,
    ).toBe("troubleshooting");
    expect(
      classifySourceRole({
        source_path: "docs/faq.md",
        profile: profile({ source_path: "docs/faq.md", doc_purpose: "unknown" }),
      }).role,
    ).toBe("troubleshooting");
  });
});

describe("classifySourceRole — canonicality (parent / child / leaf)", () => {
  it("labels README.md / index.md as parent_container", () => {
    const out = classifySourceRole({
      source_path: "docs/middleware/index.md",
      profile: profile({ source_path: "docs/middleware/index.md", doc_purpose: "concept" }),
    });
    expect(out.canonicality).toBe("parent");
    // Role can still come from doc_purpose; canonicality is independent.
    expect(out.role).toBe("concept");
  });

  it("labels a file with the same basename as its parent dir as parent_container", () => {
    // e.g. `mocking/mocking.md` is the canonical entry into the
    // mocking subtree even when sibling chapters exist.
    const out = classifySourceRole({
      source_path: "docs/mocking/mocking.md",
      profile: profile({ source_path: "docs/mocking/mocking.md", doc_purpose: "guide" }),
    });
    expect(out.canonicality).toBe("parent");
  });

  it("labels a leaf file under a same-name parent index as child_detail", () => {
    // e.g. parent index `mocking.md` exists, leaf `mocking/modules.md` is a detail.
    const out = classifySourceRole({
      source_path: "docs/mocking/modules.md",
      profile: profile({ source_path: "docs/mocking/modules.md", doc_purpose: "guide" }),
      sibling_paths: ["docs/mocking.md"],
    });
    expect(out.canonicality).toBe("child");
    // Role overlay: a child file under a guide directory is also
    // labeled child_detail when no other strong role applies.
    expect(["guide", "child_detail"]).toContain(out.role);
  });

  it("labels a generic doc with no parent-style basename as a leaf", () => {
    const out = classifySourceRole({
      source_path: "docs/random-note.md",
      profile: profile({ source_path: "docs/random-note.md", doc_purpose: "unknown" }),
    });
    expect(out.canonicality).toBe("leaf");
  });
});

describe("classifySourceRole — degrades gracefully with weak evidence", () => {
  it("returns unknown role / unknown confidence when nothing matches", () => {
    const out = classifySourceRole({
      source_path: "docs/whatever.md",
      profile: profile({ source_path: "docs/whatever.md", doc_purpose: "unknown" }),
    });
    expect(out.role).toBe("unknown");
    expect(out.confidence).toBe("unknown");
  });

  it("survives a missing profile", () => {
    const out = classifySourceRole({
      source_path: "docs/configuration.md",
      profile: null,
    });
    expect(out.role).toBe("config");
    expect(out.provenance.map((p) => p.signal)).toContain("path_basename");
  });

  it("downgrades confidence when doc_purpose was inferred only from default", () => {
    const out = classifySourceRole({
      source_path: "docs/something.md",
      profile: profile({
        source_path: "docs/something.md",
        doc_purpose: "concept",
        purpose_source: "default",
      }),
    });
    // Default-source purpose should not be treated as high confidence.
    expect(out.confidence === "low" || out.confidence === "medium").toBe(true);
  });
});

describe("classifySourceRole — title and heading rules", () => {
  it("falls back to title-derived migration role when path is generic", () => {
    const out = classifySourceRole({
      source_path: "docs/upgrade.md",
      profile: profile({
        source_path: "docs/upgrade.md",
        title: "Migration guide",
        h1: "Migration guide",
        doc_purpose: "unknown",
      }),
    });
    expect(out.role).toBe("migration");
    expect(out.provenance.map((p) => p.signal)).toContain("title");
  });

  it("does not let a low-confidence title hint override a high-confidence doc_purpose", () => {
    // Title says "Configuration", but doc_purpose is api_reference with
    // purpose_source=frontmatter (high). The api role wins.
    const out = classifySourceRole({
      source_path: "docs/api/reference.md",
      profile: profile({
        source_path: "docs/api/reference.md",
        title: "Configuration",
        doc_purpose: "api_reference",
        purpose_source: "frontmatter",
      }),
    });
    expect(out.role).toBe("api");
  });
});
