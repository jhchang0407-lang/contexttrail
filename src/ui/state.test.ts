import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildUiState,
  applyTaskProfileFromUi,
  createAcceptedRule,
  replaceDocumentSourceFromUi,
  saveDocumentSourceFromUi,
  saveTaskProfileFromUi,
  syncFromUi,
  uploadDocuments,
  uploadRuleSources,
} from "./state.js";
import { writeInboxItem } from "../inbox/items.js";

const tempDirs: string[] = [];

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "contexttrail-ui-state-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("ui state adapter", () => {
  it("keeps uploaded documents and rule sources in separate stores", async () => {
    const cwd = tempWorkspace();

    const docs = uploadDocuments(cwd, [
      {
        name: "client-notes.md",
        data_base64: Buffer.from(
          "# Client Notes\n\nSigned agreement controls payment release.\n",
          "utf8",
        ).toString("base64"),
      },
    ]);
    const ruleSources = uploadRuleSources(cwd, [
      {
        name: "soul.md",
        content: "# Agent Rules\n\nDo not cite drafts as authority.\n",
      },
    ]);

    const state = await buildUiState(cwd);

    expect(docs.written[0]).toContain(".contexttrail/uploads/documents/");
    expect(ruleSources.written[0]).toContain(".contexttrail/rule-sources/");
    expect(state.sources.map((source) => source.source_path)).toEqual(docs.written);
    expect(state.rule_sources.map((source) => source.path)).toEqual(ruleSources.written);
    expect(state.rule_sources[0]?.display_name).toBe("soul.md");
    expect(state.rule_sources[0]?.content).toContain("Do not cite drafts as authority.");
  });

  it("creates accepted rules as constraint cards", async () => {
    const cwd = tempWorkspace();

    const created = createAcceptedRule(cwd, {
      title: "Signed docs outrank drafts",
      body: "Signed source documents outrank draft notes when they conflict.",
      scope: { layer: "project", project: "Nimbus" },
    });
    const state = await buildUiState(cwd);

    expect(created.id).toMatch(/^C\d{3,}$/);
    expect(state.rules).toMatchObject([
      {
        id: created.id,
        type: "constraint",
        title: "Signed docs outrank drafts",
        scope_summary: "project:Nimbus",
      },
    ]);
  });

  it("saves a local document folder and syncs new files without another upload", async () => {
    const cwd = tempWorkspace();
    const docsDir = join(cwd, "client-folder", "docs");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(
      join(docsDir, "claim-summary.md"),
      "# Claim Summary\n\nEmergency mitigation invoice total is 1840 USD.\n",
      "utf8",
    );

    const saved = saveDocumentSourceFromUi(cwd, { path: docsDir });
    expect(saved.action).toBe("created");
    expect(saved.source.path).toBe(docsDir);
    expect(saved.source.glob).toBe("**/*.{md,markdown,txt,docx,pdf}");
    expect(saved.import_summary.files_imported).toBe(1);

    const config = readFileSync(join(cwd, ".contexttrail/config.yaml"), "utf8");
    expect(config).toContain("document_sources:");
    expect(config).toContain(docsDir);

    writeFileSync(
      join(docsDir, "adjuster-notes.md"),
      "# Adjuster Notes\n\nCause confirmation is still missing from inspection notes.\n",
      "utf8",
    );

    const sync = await syncFromUi(cwd);
    expect(sync.document_source_import?.files_imported).toBe(1);

    const state = await buildUiState(cwd);
    expect(state.document_sources).toMatchObject([
      {
        path: docsDir,
        exists: true,
      },
    ]);
    expect(state.sources.map((source) => source.source_path).sort()).toEqual([
      "client-folder/docs/adjuster-notes.md",
      "client-folder/docs/claim-summary.md",
    ]);
  });

  it("upgrades old default synced-folder globs to include office documents", async () => {
    const cwd = tempWorkspace();
    const docsDir = join(cwd, "client-folder", "docs");
    mkdirSync(join(cwd, ".contexttrail"), { recursive: true });
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(
      join(cwd, ".contexttrail/config.yaml"),
      [
        "version: 1",
        "document_sources:",
        "  - id: old-default",
        `    path: ${JSON.stringify(docsDir)}`,
        "    glob: \"**/*.{md,markdown,txt}\"",
        "task_profiles:",
        "  - id: old-profile",
        "    name: Old Profile",
        "    document_sources:",
        "      - id: old-default",
        `        path: ${JSON.stringify(docsDir)}`,
        "        glob: \"**/*.{md,markdown,txt}\"",
        "    rule_ids: []",
        "    created_at: \"2026-05-27T00:00:00.000Z\"",
        "    updated_at: \"2026-05-27T00:00:00.000Z\"",
      ].join("\n"),
      "utf8",
    );

    const state = await buildUiState(cwd);

    expect(state.document_sources[0]?.glob).toBe("**/*.{md,markdown,txt,docx,pdf}");
    expect(state.document_sources[0]?.import_pattern).toContain("docx,pdf");
    expect(state.task_profiles[0]?.document_sources[0]?.glob).toBe("**/*.{md,markdown,txt,docx,pdf}");
  });

  it("shows only open suggestions in the review list", async () => {
    const cwd = tempWorkspace();
    writeInboxItem(cwd, {
      id: "accepted-rule",
      review_type: "candidate_card",
      status: "accepted",
      title: "Accepted rule",
      candidate_type: "constraint",
      scope: { layer: "project", project: "UiMap" },
      body: "Accepted rule body.",
      supporting_chunks: [],
      created_at: "2026-05-27T00:00:00.000Z",
      updated_at: "2026-05-27T00:00:00.000Z",
    });
    writeInboxItem(cwd, {
      id: "open-rule",
      review_type: "candidate_card",
      status: "pending",
      title: "Open rule",
      candidate_type: "constraint",
      scope: { layer: "project", project: "UiMap" },
      body: "Open rule body.",
      supporting_chunks: [],
      created_at: "2026-05-27T00:00:01.000Z",
      updated_at: "2026-05-27T00:00:01.000Z",
    });

    const state = await buildUiState(cwd);

    expect(state.suggestions.map((suggestion) => suggestion.id)).toEqual(["open-rule"]);
    expect(state.inbox.status_counts.accepted).toBe(1);
  });

  it("hides open suggestions that already exist as accepted rules", async () => {
    const cwd = tempWorkspace();
    createAcceptedRule(cwd, {
      title: "Signed docs outrank drafts",
      body: "Signed source documents outrank draft notes when they conflict.",
      scope: { layer: "project", project: "UiMap" },
    });
    writeInboxItem(cwd, {
      id: "duplicate-open-rule",
      review_type: "candidate_card",
      status: "pending",
      title: "Signed docs outrank drafts",
      candidate_type: "constraint",
      scope: { layer: "project", project: "UiMap" },
      body: "Signed source documents outrank draft notes when they conflict.",
      supporting_chunks: [],
      created_at: "2026-05-27T00:00:00.000Z",
      updated_at: "2026-05-27T00:00:00.000Z",
    });

    const state = await buildUiState(cwd);

    expect(state.suggestions).toEqual([]);
    expect(state.rules).toHaveLength(1);
  });

  it("saves named task profiles and applies one as the active document corpus", async () => {
    const cwd = tempWorkspace();
    const claimsDir = join(cwd, "claims");
    const salesDir = join(cwd, "sales");
    mkdirSync(claimsDir, { recursive: true });
    mkdirSync(salesDir, { recursive: true });
    writeFileSync(join(claimsDir, "policy.md"), "# Policy\n\nCoverage depends on cause.\n", "utf8");
    writeFileSync(join(salesDir, "account.md"), "# Account\n\nThe buyer asked for security review.\n", "utf8");

    const claimRule = createAcceptedRule(cwd, {
      title: "Claims evidence",
      body: "Claims answers must cite policy and adjuster sources.",
    });
    saveDocumentSourceFromUi(cwd, { path: claimsDir });
    const claimsProfile = saveTaskProfileFromUi(cwd, { name: "Claims Review" });

    const salesProfile = saveTaskProfileFromUi(cwd, { name: "Sales Follow-up", mode: "empty" });
    saveDocumentSourceFromUi(cwd, { path: salesDir });
    const salesRule = createAcceptedRule(cwd, {
      title: "Sales commitments",
      body: "Sales follow-up must include open commitments.",
    });
    expect(salesProfile.profile.active).toBe(true);

    const applied = applyTaskProfileFromUi(cwd, claimsProfile.profile.id);
    expect(applied.profile.active).toBe(true);
    expect(applied.profile.rule_titles.map((rule) => rule.id)).toContain(claimRule.id);
    expect(applied.profile.rule_titles.map((rule) => rule.id)).not.toContain(salesRule.id);
    expect(applied.deactivated_sources).toContain("sales/account.md");

    const state = await buildUiState(cwd);
    expect(state.active_task_profile_id).toBe(claimsProfile.profile.id);
    expect(state.document_sources.map((source) => source.path)).toEqual([claimsDir]);
    expect(state.sources.map((source) => source.source_path)).toEqual(["claims/policy.md"]);
    expect(state.task_profiles.map((profile) => [profile.name, profile.active])).toEqual([
      ["Claims Review", true],
      ["Sales Follow-up", false],
    ]);
  });

  it("can start an empty task profile and attach newly-created rules to it", async () => {
    const cwd = tempWorkspace();
    const docsDir = join(cwd, "claims");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, "policy.md"), "# Policy\n\nCoverage depends on cause.\n", "utf8");
    createAcceptedRule(cwd, {
      title: "Existing claims rule",
      body: "Claims answers must cite policy and adjuster sources.",
    });
    saveDocumentSourceFromUi(cwd, { path: docsDir });

    const empty = saveTaskProfileFromUi(cwd, { name: "Blank Work Packet", mode: "empty" });
    expect(empty.profile).toMatchObject({
      name: "Blank Work Packet",
      active: true,
      document_sources: [],
      rule_ids: [],
    });
    expect(empty.deactivated_sources).toEqual(["claims/policy.md"]);

    const emptyState = await buildUiState(cwd);
    expect(emptyState.document_sources).toEqual([]);
    expect(emptyState.sources).toEqual([]);
    expect(emptyState.rules).toEqual([]);

    const created = createAcceptedRule(cwd, {
      title: "Blank profile rule",
      body: "This rule belongs to the blank work packet.",
    });
    const stateWithRule = await buildUiState(cwd);

    expect(stateWithRule.rules.map((rule) => rule.id)).toEqual([created.id]);
    expect(stateWithRule.task_profiles.find((profile) => profile.active)?.rule_ids).toEqual([
      created.id,
    ]);
  });

  it("keeps added folders scoped to the active task profile", async () => {
    const cwd = tempWorkspace();
    const claimsDir = join(cwd, "claims");
    const salesDir = join(cwd, "sales");
    mkdirSync(claimsDir, { recursive: true });
    mkdirSync(salesDir, { recursive: true });
    writeFileSync(join(claimsDir, "policy.md"), "# Policy\n\nCoverage depends on cause.\n", "utf8");
    writeFileSync(join(salesDir, "account.md"), "# Account\n\nBuyer wants security review.\n", "utf8");

    saveDocumentSourceFromUi(cwd, { path: claimsDir });
    const empty = saveTaskProfileFromUi(cwd, { name: "Sales Work", mode: "empty" });
    saveDocumentSourceFromUi(cwd, { path: salesDir });

    const state = await buildUiState(cwd);
    expect(state.active_task_profile_id).toBe(empty.profile.id);
    expect(state.document_sources.map((source) => source.path)).toEqual([salesDir]);
    expect(state.sources.map((source) => source.source_path)).toEqual(["sales/account.md"]);
    expect(
      state.task_profiles.find((profile) => profile.id === empty.profile.id)?.document_sources.map((source) => source.path),
    ).toEqual([salesDir]);
  });

  it("can replace the visible corpus with a single-folder workflow", async () => {
    const cwd = tempWorkspace();
    const claimsDir = join(cwd, "claims");
    const salesDir = join(cwd, "sales");
    mkdirSync(claimsDir, { recursive: true });
    mkdirSync(salesDir, { recursive: true });
    writeFileSync(join(claimsDir, "policy.md"), "# Policy\n\nCoverage depends on cause.\n", "utf8");
    writeFileSync(join(salesDir, "account.md"), "# Account\n\nBuyer wants security review.\n", "utf8");

    saveDocumentSourceFromUi(cwd, { path: claimsDir });
    const replaced = replaceDocumentSourceFromUi(cwd, { path: salesDir });

    const state = await buildUiState(cwd);
    expect(replaced.profile.name).toBe("sales");
    expect(state.active_task_profile_id).toBe(replaced.profile.id);
    expect(state.document_sources.map((source) => source.path)).toEqual([salesDir]);
    expect(state.sources.map((source) => source.source_path)).toEqual(["sales/account.md"]);
    expect(replaced.deactivated_sources).toContain("claims/policy.md");
  });
});
