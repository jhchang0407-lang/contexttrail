import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startUiServer, type StartedUiServer } from "./server.js";

const tempDirs: string[] = [];
const servers: StartedUiServer[] = [];

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "contexttrail-ui-server-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (started) => new Promise<void>((resolve) => started.server.close(() => resolve())),
    ),
  );
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("ui server", () => {
  it("serves state and accepts rule creation over JSON", async () => {
    const cwd = tempWorkspace();
    const started = await startUiServer({ cwd, port: 0 });
    servers.push(started);

    const html = await fetch(started.url).then((response) => response.text());
    expect(html).toContain("ContextTrail Setup");
    expect(html).toContain("Sync Folders");
    expect(html).toContain("Reload UI");
    expect(html).toContain("Import docs folder");
    expect(html).toContain("Advanced file filter");
    expect(html).toContain("Start Empty");
    expect(html).toContain("Use Only This Folder");
    expect(html).toContain("**/*.{md,markdown,txt,docx,pdf}");
    for (const id of [
      "syncButton",
      "refreshButton",
      "importDocsButton",
      "docSourcePath",
      "docSourceGlob",
      "browseDocSourceButton",
      "saveDocSourceButton",
      "replaceDocSourceButton",
      "docSourcesList",
      "docFiles",
      "uploadDocsButton",
      "contextPrompt",
      "contextBudget",
      "contextPreviewButton",
      "contextPreviewResult",
      "ruleTitle",
      "ruleBody",
      "ruleProject",
      "ruleLayer",
      "saveRuleButton",
      "ruleSourceFiles",
      "uploadRuleSourcesButton",
      "bootstrapButton",
      "suggestionsList",
      "profileName",
      "saveProfileButton",
      "emptyProfileButton",
      "profilesList",
      "stateJson",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }

    const created = await fetch(`${started.url}/api/rules`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Missing context requires search",
        body: "Missing-context claims require adequate search before reporting absence.",
      }),
    }).then((response) => response.json() as Promise<{ id: string }>);

    const state = await fetch(`${started.url}/api/state`)
      .then((response) => response.json() as Promise<{ rules: Array<{ id: string }> }>);

    expect(state.rules.map((rule) => rule.id)).toContain(created.id);
  });

  it("maps every setup UI API action to a working state mutation", async () => {
    const cwd = tempWorkspace();
    mkdirSync(join(cwd, "docs"), { recursive: true });
    writeFileSync(
      join(cwd, "docs/payment.md"),
      [
        "---",
        "scope:",
        "  layer: project",
        "  project: UiMap",
        "---",
        "",
        "# Payment",
        "",
        "Payment release must include invoice and approval evidence.",
        "",
        "Managers should review vendor statements before release.",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(cwd, "docs/authority.md"),
      [
        "---",
        "scope:",
        "  layer: project",
        "  project: UiMap",
        "---",
        "",
        "# Authority",
        "",
        "Signed agreements always outrank draft policy memos.",
        "",
      ].join("\n"),
      "utf8",
    );

    const started = await startUiServer({ cwd, port: 0 });
    servers.push(started);

    const imported = await postJson<{
      files_imported: number;
      chunks_written: number;
    }>(started.url, "/api/documents/import", { patterns: ["docs/**/*.md"] });
    expect(imported.files_imported).toBe(2);
    expect(imported.chunks_written).toBeGreaterThanOrEqual(2);

    const uploadedDocs = await postJson<{
      written: string[];
      import_summary: { files_imported: number };
    }>(started.url, "/api/documents/upload", {
      files: [
        {
          name: "uploaded-policy.md",
          content: "# Uploaded Policy\n\nUploaded approvals must cite the signed source document.\n",
        },
      ],
    });
    expect(uploadedDocs.written[0]).toContain(".contexttrail/uploads/documents/");
    expect(uploadedDocs.import_summary.files_imported).toBe(1);

    const uploadedRules = await postJson<{ written: string[] }>(
      started.url,
      "/api/rule-sources/upload",
      {
        files: [
          {
            name: "soul.md",
            content: "# Agent Rules\n\nDo not cite drafts as final authority.\n",
          },
        ],
      },
    );
    expect(uploadedRules.written[0]).toContain(".contexttrail/rule-sources/");

    const savedFolder = await postJson<{
      source: { path: string; glob: string; exists: boolean };
      import_summary: { files_unchanged: number };
    }>(started.url, "/api/document-sources", { path: join(cwd, "docs") });
    expect(savedFolder.source).toMatchObject({
      path: join(cwd, "docs"),
      glob: "**/*.{md,markdown,txt,docx,pdf}",
      exists: true,
    });
    expect(savedFolder.import_summary.files_unchanged).toBeGreaterThanOrEqual(2);
    const replacementDir = join(cwd, "replacement-docs");
    mkdirSync(replacementDir, { recursive: true });
    writeFileSync(
      join(replacementDir, "packet.md"),
      "# Replacement Packet\n\nThis workflow has a clean replacement corpus.\n",
      "utf8",
    );
    const replacedFolder = await postJson<{
      source: { path: string; glob: string; exists: boolean };
      profile: { active: boolean; document_sources: Array<{ path: string }> };
      deactivated_sources: string[];
    }>(started.url, "/api/document-sources/replace", { path: replacementDir });
    expect(replacedFolder.source.path).toBe(replacementDir);
    expect(replacedFolder.profile.active).toBe(true);
    expect(replacedFolder.profile.document_sources.map((source) => source.path)).toEqual([
      replacementDir,
    ]);
    expect(replacedFolder.deactivated_sources).toContain("docs/payment.md");
    await postJson(started.url, "/api/document-sources/replace", { path: join(cwd, "docs") });
    writeFileSync(
      join(cwd, "docs/new-client-note.md"),
      "# New Client Note\n\nThe requester added a late supporting statement.\n",
      "utf8",
    );

    const createdRule = await postJson<{ id: string; path: string }>(
      started.url,
      "/api/rules",
      {
        title: "Signed source authority",
        body: "Signed source documents outrank draft notes when they conflict.",
        scope: { layer: "project", project: "UiMap" },
      },
    );
    expect(createdRule.id).toMatch(/^C\d{3,}$/);
    expect(createdRule.path).toContain(".contexttrail/cards/");

    const preview = await postJson<{
      coverage_confidence: string;
      ranked: Array<{ source_path?: string; body: string }>;
      rendered_text: string;
      budget: { used: number; requested: number };
    }>(started.url, "/api/context/preview", {
      task: "Find payment release evidence and authority for the invoice approval.",
      budget: "small",
    });
    expect(["confident", "uncertain", "empty"]).toContain(preview.coverage_confidence);
    expect(preview.budget.requested).toBeGreaterThan(0);
    expect(preview.ranked.map((entry) => `${entry.source_path ?? ""} ${entry.body}`).join("\n")).toContain("Payment release");
    expect(preview.rendered_text).toContain("Context Pack");

    const savedProfile = await postJson<{
      action: string;
      profile: { id: string; name: string; active: boolean; document_sources: unknown[]; rule_ids: string[] };
    }>(started.url, "/api/task-profiles", { name: "UiMap Review" });
    expect(savedProfile.action).toBe("created");
    expect(savedProfile.profile).toMatchObject({
      name: "UiMap Review",
      active: true,
    });
    expect(savedProfile.profile.document_sources).toHaveLength(1);
    expect(savedProfile.profile.rule_ids).toContain(createdRule.id);

    const blankProfile = await postJson<{
      profile: { name: string; active: boolean; document_sources: unknown[]; rule_ids: string[] };
      deactivated_sources: string[];
    }>(started.url, "/api/task-profiles", { name: "Blank Packet", mode: "empty" });
    expect(blankProfile.profile).toMatchObject({
      name: "Blank Packet",
      active: true,
      document_sources: [],
      rule_ids: [],
    });
    expect(blankProfile.deactivated_sources.length).toBeGreaterThan(0);

    const appliedProfile = await postJson<{
      profile: { id: string; active: boolean };
      import_summary: { files_imported: number; files_unchanged: number };
    }>(
      started.url,
      `/api/task-profiles/${encodeURIComponent(savedProfile.profile.id)}/apply`,
      {},
    );
    expect(appliedProfile.profile.active).toBe(true);
    expect(
      appliedProfile.import_summary.files_unchanged +
        appliedProfile.import_summary.files_imported,
    ).toBeGreaterThanOrEqual(2);
    writeFileSync(
      join(cwd, "docs/final-late-note.md"),
      "# Final Late Note\n\nA second late note should arrive through Sync.\n",
      "utf8",
    );

    const bootstrap = await postJson<{
      constraint_candidates_written: number;
      clarification_needs_written: number;
    }>(started.url, "/api/suggestions/bootstrap", {});
    expect(bootstrap.constraint_candidates_written).toBeGreaterThan(0);
    expect(bootstrap.clarification_needs_written).toBeGreaterThan(0);

    const stateAfterBootstrap = await getJson<{
      suggestions: Array<{ id: string; review_type: string; status: string }>;
    }>(`${started.url}/api/state`);
    const candidateIds = stateAfterBootstrap.suggestions
      .filter((item) => item.review_type === "candidate_card" && item.status === "pending")
      .map((item) => item.id);
    const clarificationId = stateAfterBootstrap.suggestions.find(
      (item) => item.review_type === "clarification_need",
    )?.id;
    expect(candidateIds.length).toBeGreaterThanOrEqual(2);
    expect(clarificationId).toBeDefined();

    const accepted = await postJson<{ card_id: string }>(
      started.url,
      `/api/suggestions/${encodeURIComponent(candidateIds[0]!)}/accept`,
      {},
    );
    expect(accepted.card_id).toMatch(/^C\d{3,}$/);

    const rejected = await postJson<{ status: string }>(
      started.url,
      `/api/suggestions/${encodeURIComponent(candidateIds[1]!)}/reject`,
      {},
    );
    expect(rejected.status).toBe("rejected");

    const answered = await postJson<{ review_item_id: string; answer_text: string }>(
      started.url,
      `/api/suggestions/${encodeURIComponent(clarificationId!)}/answer`,
      { choice_id: "ignore" },
    );
    expect(answered.review_item_id).toBe(clarificationId);
    expect(answered.answer_text).toContain("Do not create");

    const sync = await postJson<{
      mode: string;
      writes: string[];
      document_source_import?: { files_imported: number };
    }>(
      started.url,
      "/api/sync",
      { check: false },
    );
    expect(sync.mode).toBe("apply");
    expect(sync.document_source_import?.files_imported).toBe(1);

    const finalState = await getJson<{
      sources: unknown[];
      document_sources: unknown[];
      task_profiles: unknown[];
      rules: unknown[];
      rule_sources: Array<{ content: string }>;
      inbox: { status_counts: Record<string, number> };
    }>(`${started.url}/api/state`);
    expect(finalState.sources.length).toBeGreaterThanOrEqual(3);
    expect(finalState.document_sources).toHaveLength(1);
    expect(finalState.task_profiles.length).toBeGreaterThanOrEqual(2);
    expect(finalState.rules.length).toBeGreaterThanOrEqual(1);
    expect(finalState.rule_sources).toHaveLength(1);
    expect(finalState.rule_sources[0]?.content).toContain("Do not cite drafts");
    expect(finalState.inbox.status_counts.accepted).toBeGreaterThanOrEqual(1);
    expect(finalState.inbox.status_counts.rejected).toBeGreaterThanOrEqual(1);
    expect(finalState.inbox.status_counts.answered).toBeGreaterThanOrEqual(1);
  });
});

async function postJson<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (response) => {
    const payload = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(payload));
    return payload as T;
  });
}

async function getJson<T>(url: string): Promise<T> {
  return fetch(url).then(async (response) => {
    const payload = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(payload));
    return payload as T;
  });
}
