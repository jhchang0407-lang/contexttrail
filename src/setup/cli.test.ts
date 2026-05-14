/**
 * THO-251 (PRD-0033 / 33.3) — CLI + MCP integration tests.
 *
 * Cover the wire boundary: `contexttrail init` prints "Next: run contexttrail setup",
 * `contexttrail setup` runs end-to-end on a fresh fixture and produces stable
 * output, the MCP tool `get_setup_readiness` is registered and returns
 * the documented schema shape.
 */
import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestCorpus } from "../eval/test-corpus.js";
import { createHandlers } from "../mcp/handlers.js";
import { schemas } from "../mcp/schemas.js";
import { getInboxItem, listInboxItems, writeInboxItem } from "../inbox/items.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI_ENTRY = join(REPO_ROOT, "src/cli/main.ts");

function runCli(cwd: string, args: string[]): string {
  return execFileSync("npx", ["tsx", CLI_ENTRY, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function runCliFailure(cwd: string, args: string[]): { status: number; stderr: string } {
  try {
    runCli(cwd, args);
  } catch (err) {
    const failure = err as { status?: number; stderr?: Buffer | string };
    return {
      status: failure.status ?? 1,
      stderr: String(failure.stderr ?? ""),
    };
  }
  throw new Error(`expected drift ${args.join(" ")} to fail`);
}

function writeImportedDocs(corpus: ReturnType<typeof createTestCorpus>, count = 60): void {
  for (let i = 0; i < count; i++) {
    corpus.writeDoc(
      `docs/topic-${i}.md`,
      `# Topic ${i}\n\nLayer: module\n\nThis document explains setup behavior ${i}.\n`,
    );
  }
  corpus.importDocs();
}

function listRelativeFiles(cwd: string, dir = cwd): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const rel = path.slice(cwd.length + 1);
    if (statSync(path).isDirectory()) return listRelativeFiles(cwd, path);
    return [rel];
  }).sort();
}

describe("contexttrail init — output appends the setup pointer", () => {
  it("ends with `Next: run contexttrail setup`", () => {
    const cwd = mkdtempSync(join(tmpdir(), "contexttrail-init-cli-"));
    try {
      const out = runCli(cwd, ["init"]);
      expect(out).toMatch(/Next: run `contexttrail setup`/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30_000);

  // PRD-0036 / 36.1 (B8): contexttrail init writes .mcp.json on first run and mentions
  // the file in its trailing output so the user knows to restart their agent.
  it("mentions .mcp.json write and prompts a restart on first init", () => {
    const cwd = mkdtempSync(join(tmpdir(), "contexttrail-init-mcp-cli-"));
    try {
      const out = runCli(cwd, ["init"]);
      expect(out).toMatch(/wrote .*\.mcp\.json/);
      expect(out).toMatch(/restart your agent/i);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("contexttrail setup CLI — end-to-end on a fresh fixture (THO-251)", () => {
  it("runs plain-text mode and prints the four dimensions + a suggested next step", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-setup-cli-" });
    try {
      const out = runCli(corpus.cwd, ["setup"]);
      expect(out).toMatch(/ContextTrail setup readiness/);
      expect(out).toMatch(/corpus_coverage:/);
      expect(out).toMatch(/scope_coverage:/);
      expect(out).toMatch(/card_coverage:/);
      expect(out).toMatch(/retrieval_probes:/);
      expect(out).toMatch(/Suggested next step:/);
    } finally {
      corpus.cleanup();
    }
  }, 60_000);

  it("--json mode emits structured JSON validated by the MCP schema", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-setup-cli-" });
    try {
      const out = runCli(corpus.cwd, ["setup", "--json"]);
      const parsed = JSON.parse(out);
      const validation = schemas.get_setup_readiness.output.safeParse(parsed);
      expect(validation.success).toBe(true);
    } finally {
      corpus.cleanup();
    }
  }, 60_000);

  it("produces deterministic output across two sequential `contexttrail setup` runs", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-setup-cli-" });
    try {
      const out1 = runCli(corpus.cwd, ["setup", "--json"]);
      const out2 = runCli(corpus.cwd, ["setup", "--json"]);
      // JSON output is byte-stable — same probes, same input, same result.
      expect(JSON.parse(out2)).toEqual(JSON.parse(out1));
    } finally {
      corpus.cleanup();
    }
  }, 60_000);
});

describe("contexttrail setup quickstart CLI", () => {
  it("initializes a blank repo and returns readiness plus setup questions", () => {
    const cwd = mkdtempSync(join(tmpdir(), "contexttrail-quickstart-blank-"));
    try {
      const out = runCli(cwd, ["setup", "quickstart", "--json"]);
      const parsed = JSON.parse(out);

      expect(parsed.init.created).toBe(true);
      expect(parsed.import.files_imported).toBe(0);
      expect(parsed.import.chunks_written).toBe(0);
      expect(existsSync(join(cwd, ".contexttrail/config.yaml"))).toBe(true);
      expect(
        schemas.get_setup_readiness.output.safeParse(parsed.readiness).success,
      ).toBe(true);
      expect(parsed.questions.length).toBeGreaterThan(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60_000);

  it("imports obvious docs and is safe to rerun", () => {
    const cwd = mkdtempSync(join(tmpdir(), "contexttrail-quickstart-docs-"));
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      writeFileSync(
        join(cwd, "docs/setup.md"),
        "# Setup\n\nContextTrail must keep candidate cards in the inbox first.\n",
        "utf8",
      );

      const first = JSON.parse(
        runCli(cwd, ["setup", "quickstart", "--json"]),
      );
      const second = JSON.parse(
        runCli(cwd, ["setup", "quickstart", "--json"]),
      );

      expect(first.import.files_imported).toBe(1);
      expect(first.import.chunks_written).toBeGreaterThan(0);
      expect(second.init.created).toBe(false);
      expect(second.import.files_imported).toBe(0);
      expect(second.import.files_unchanged).toBe(1);
      expect(second.readiness.cwd).toBe(realpathSync(cwd));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60_000);

  it("prefers English docs for multilingual documentation trees", () => {
    const cwd = mkdtempSync(join(tmpdir(), "contexttrail-quickstart-i18n-docs-"));
    try {
      mkdirSync(join(cwd, "docs/en/docs/tutorial"), { recursive: true });
      mkdirSync(join(cwd, "docs/fr/docs/tutorial"), { recursive: true });
      writeFileSync(
        join(cwd, "docs/en/docs/tutorial/security.md"),
        "# Security\n\nUse password hashing for stored passwords.\n",
        "utf8",
      );
      writeFileSync(
        join(cwd, "docs/fr/docs/tutorial/security.md"),
        "# Securite\n\nUtilisez le hachage des mots de passe.\n",
        "utf8",
      );

      const parsed = JSON.parse(
        runCli(cwd, ["setup", "quickstart", "--json"]),
      );
      const db = readFileSync(join(cwd, ".contexttrail/cache/contexttrail.db"));

      expect(parsed.import.files_imported).toBe(1);
      expect(db.includes(Buffer.from("docs/en/docs/tutorial/security.md"))).toBe(
        true,
      );
      expect(db.includes(Buffer.from("docs/fr/docs/tutorial/security.md"))).toBe(
        false,
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60_000);

  it("does not bootstrap candidate cards unless explicitly requested", () => {
    const cwd = mkdtempSync(join(tmpdir(), "contexttrail-quickstart-no-bootstrap-"));
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      writeFileSync(
        join(cwd, "docs/rules.md"),
        "# Rules\n\nRefunds must never exceed the captured amount.\n",
        "utf8",
      );

      const parsed = JSON.parse(
        runCli(cwd, ["setup", "quickstart", "--json"]),
      );
      const items = listInboxItems(cwd);

      expect(parsed.candidate_bootstrap).toMatchObject({ enabled: false });
      expect(items.filter((item) => item.review_type === "candidate_card")).toEqual(
        [],
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60_000);

  it("bootstraps candidates into the inbox only and leaves accepted cards unchanged", () => {
    const cwd = mkdtempSync(join(tmpdir(), "contexttrail-quickstart-bootstrap-"));
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      mkdirSync(join(cwd, ".contexttrail/cards"), { recursive: true });
      writeFileSync(
        join(cwd, "docs/rules.md"),
        "# Rules\n\nRefunds must never exceed the captured amount.\n",
        "utf8",
      );
      const acceptedCardPath = join(cwd, ".contexttrail/cards/accepted.md");
      writeFileSync(
        acceptedCardPath,
        [
          "---",
          "id: C_ACCEPTED",
          "type: constraint",
          "title: Existing accepted card",
          "authority: accepted",
          "scope:",
          "  layer: project",
          "---",
          "",
          "Existing accepted truth.",
          "",
        ].join("\n"),
        "utf8",
      );
      const before = readFileSync(acceptedCardPath, "utf8");

      const parsed = JSON.parse(
        runCli(cwd, [
          "setup",
          "quickstart",
          "--bootstrap-candidates",
          "--json",
        ]),
      );
      const items = listInboxItems(cwd);

      expect(parsed.candidate_bootstrap.enabled).toBe(true);
      expect(
        parsed.candidate_bootstrap.summary.constraint_candidates_written,
      ).toBeGreaterThan(0);
      expect(items.some((item) => item.review_type === "candidate_card")).toBe(
        true,
      );
      expect(readFileSync(acceptedCardPath, "utf8")).toBe(before);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60_000);

  it("imports existing hidden Card files into the cache on rerun", () => {
    const cwd = mkdtempSync(join(tmpdir(), "contexttrail-quickstart-cards-"));
    try {
      mkdirSync(join(cwd, ".contexttrail/cards"), { recursive: true });
      writeFileSync(
        join(cwd, ".contexttrail/cards/c001.md"),
        [
          "---",
          "id: C001",
          "type: constraint",
          "title: Existing repo rule",
          "authority: accepted",
          "scope:",
          "  layer: project",
          "---",
          "",
          "Existing accepted truth survives ContextTrail restarts.",
          "",
        ].join("\n"),
        "utf8",
      );

      const parsed = JSON.parse(
        runCli(cwd, ["setup", "quickstart", "--json"]),
      );

      expect(parsed.card_import.cards_imported).toBe(1);
      expect(parsed.card_import.cards_skipped).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("contexttrail setup questions CLI — guided setup planning (THO-266)", () => {
  it("asks an initialized empty repo to import docs before reviewing cards", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-setup-questions-cli-" });
    try {
      const out = runCli(corpus.cwd, ["setup", "questions", "--json"]);
      const parsed = JSON.parse(out);

      expect(parsed.questions.length).toBeGreaterThan(0);
      expect(parsed.questions.length).toBeLessThanOrEqual(3);
      expect(parsed.questions[0]).toMatchObject({
        kind: "import_docs",
        command_preview: "contexttrail import docs/**/*.md",
      });
      expect(
        parsed.questions.some((q: { kind: string }) => q.kind === "review_inbox"),
      ).toBe(false);
    } finally {
      corpus.cleanup();
    }
  }, 60_000);

  it("routes imported repos with pending inbox work to candidate-card review first", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-setup-questions-inbox-" });
    try {
      writeImportedDocs(corpus);
      const now = "2026-05-11T00:00:00.000Z";
      writeInboxItem(corpus.cwd, {
        id: "candidate-a",
        review_type: "candidate_card",
        status: "pending",
        title: "Candidate A",
        created_at: now,
        updated_at: now,
        candidate_type: "constraint",
        scope: { layer: "module", module: "setup" },
        supporting_chunks: [],
        body: "A proposed setup constraint.",
      });
      writeInboxItem(corpus.cwd, {
        id: "clarify-a",
        review_type: "clarification_need",
        status: "pending",
        title: "Clarify A",
        created_at: now,
        updated_at: now,
        choices: [],
        free_text_allowed: true,
        affects_candidate_ids: ["candidate-a"],
        rewrite_rules: [],
        body: "A setup clarification.",
      });

      const out = runCli(corpus.cwd, ["setup", "questions", "--json"]);
      const parsed = JSON.parse(out);

      expect(parsed.questions[0]).toMatchObject({
        kind: "review_inbox",
        command_preview: "contexttrail inbox list --type candidate_card",
        impact: { affected_items: 2 },
      });
      expect(parsed.questions[0].prompt).toMatch(/curate/i);
      expect(parsed.questions[0].reason).toMatch(/curation stream/i);
      expect(parsed.questions[0].choices[0].id).toBe("candidate_cards");
      expect(parsed.questions[0].choices[0].label).toMatch(/curate/i);
      expect(parsed.questions[1]).toMatchObject({
        id: "clarification-clarify-a",
        command_preview: "contexttrail inbox answer clarify-a --text \"<answer>\"",
        impact: { affected_items: 1 },
      });
      expect(parsed.questions[1].reason).toMatch(/family/i);
    } finally {
      corpus.cleanup();
    }
  }, 60_000);

  it("does not surface zero-impact clarifications as top-level setup questions", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-setup-questions-low-leverage-" });
    try {
      writeImportedDocs(corpus);
      const now = "2026-05-11T00:00:00.000Z";
      writeInboxItem(corpus.cwd, {
        id: "candidate-low",
        review_type: "candidate_card",
        status: "pending",
        title: "Candidate Low",
        created_at: now,
        updated_at: now,
        candidate_type: "constraint",
        scope: { layer: "module", module: "setup" },
        supporting_chunks: [],
        body: "A proposed setup constraint.",
      });
      writeInboxItem(corpus.cwd, {
        id: "clarify-zero",
        review_type: "clarification_need",
        status: "pending",
        title: "Clarify a template fragment",
        created_at: now,
        updated_at: now,
        choices: [{ id: "ignore", label: "Ignore" }],
        free_text_allowed: false,
        affects_candidate_ids: [],
        rewrite_rules: [],
        body: "Expected: what should have happened.",
      });

      const out = runCli(corpus.cwd, ["setup", "questions", "--json"]);
      const parsed = JSON.parse(out);

      expect(parsed.questions.map((q: { id: string }) => q.id)).toContain(
        "review-inbox",
      );
      expect(parsed.questions.map((q: { id: string }) => q.id)).not.toContain(
        "clarification-clarify-zero",
      );
    } finally {
      corpus.cleanup();
    }
  }, 60_000);

  it("asks imported repos with low card coverage to bootstrap candidate cards", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-setup-questions-bootstrap-" });
    try {
      writeImportedDocs(corpus);

      const out = runCli(corpus.cwd, ["setup", "questions", "--json"]);
      const parsed = JSON.parse(out);

      expect(parsed.questions[0]).toMatchObject({
        kind: "review_inbox",
        command_preview: "contexttrail card bootstrap",
      });
    } finally {
      corpus.cleanup();
    }
  }, 60_000);

  it("caps questions at three in priority order without writing setup state", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-setup-questions-cap-" });
    try {
      corpus.writeDoc(
        "docs/imported.md",
        "# Imported\n\nThis imported document has intentionally weak scope.\n",
      );
      corpus.importDocs(["docs/imported.md"]);
      rmSync(join(corpus.cwd, ".mcp.json"), { force: true });
      const now = "2026-05-11T00:00:00.000Z";
      writeInboxItem(corpus.cwd, {
        id: "candidate-b",
        review_type: "candidate_card",
        status: "pending",
        title: "Candidate B",
        created_at: now,
        updated_at: now,
        candidate_type: "constraint",
        scope: { layer: "module", module: "setup" },
        supporting_chunks: [],
        body: "Another proposed setup constraint.",
      });
      const before = listRelativeFiles(corpus.cwd);

      const out = runCli(corpus.cwd, ["setup", "questions", "--json"]);
      const parsed = JSON.parse(out);

      expect(parsed.questions).toHaveLength(3);
      expect(parsed.questions.map((q: { kind: string }) => q.kind)).toEqual([
        "mcp_wiring",
        "import_docs",
        "review_inbox",
      ]);
      expect(listRelativeFiles(corpus.cwd)).toEqual(before);
    } finally {
      corpus.cleanup();
    }
  }, 60_000);
});

describe("contexttrail setup answer CLI — command preview flow (THO-268)", () => {
  it("answers an import-docs setup question with a command preview and no writes", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-setup-answer-cli-" });
    try {
      const before = listRelativeFiles(corpus.cwd);

      const out = runCli(corpus.cwd, [
        "setup",
        "answer",
        "import-docs",
        "--choice",
        "docs_glob",
        "--json",
      ]);
      const parsed = JSON.parse(out);

      expect(parsed).toMatchObject({
        question_id: "import-docs",
        kind: "import_docs",
        action: {
          type: "command_preview",
          command: "contexttrail import docs/**/*.md",
        },
        writes: [],
      });
      expect(listRelativeFiles(corpus.cwd)).toEqual(before);
    } finally {
      corpus.cleanup();
    }
  }, 60_000);

  it("rejects invalid choices for known setup questions", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-setup-answer-invalid-" });
    try {
      const failed = runCliFailure(corpus.cwd, [
        "setup",
        "answer",
        "import-docs",
        "--choice",
        "made_up",
      ]);

      expect(failed.status).toBe(2);
      expect(failed.stderr).toMatch(/invalid choice/i);
    } finally {
      corpus.cleanup();
    }
  }, 60_000);

  it("answers setup clarifications through inbox state without accepting cards", () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-setup-answer-clarification-" });
    try {
      writeImportedDocs(corpus);
      const now = "2026-05-11T00:00:00.000Z";
      writeInboxItem(corpus.cwd, {
        id: "candidate-module",
        review_type: "candidate_card",
        status: "pending",
        title: "Candidate Module",
        created_at: now,
        updated_at: now,
        candidate_type: "constraint",
        scope: { layer: "module", module: "unknown" },
        supporting_chunks: [],
        body: "This applies to module TBD.",
      });
      writeInboxItem(corpus.cwd, {
        id: "clarify-module",
        review_type: "clarification_need",
        status: "pending",
        title: "Which module owns this setup rule?",
        created_at: now,
        updated_at: now,
        choices: [{ id: "billing", label: "Billing" }],
        free_text_allowed: false,
        affects_candidate_ids: ["candidate-module"],
        rewrite_rules: [
          {
            target: "body",
            match: "module TBD",
            replacement_template: "{{answer}} module",
            materiality: "substantive",
          },
        ],
        body: "Pick the owning module.",
      });
      const cardsBefore = listRelativeFiles(corpus.cwd).filter((path) =>
        path.startsWith(".contexttrail/cards/"),
      );

      const out = runCli(corpus.cwd, [
        "setup",
        "answer",
        "clarification-clarify-module",
        "--choice",
        "billing",
        "--json",
      ]);
      const parsed = JSON.parse(out);

      expect(parsed.action).toMatchObject({
        type: "inbox_answer_applied",
        review_item_id: "clarify-module",
      });
      expect(parsed.writes).toEqual([
        ".contexttrail/inbox/clarify-module.md",
        ".contexttrail/inbox/candidate-module.md",
      ]);
      expect(getInboxItem(corpus.cwd, "clarify-module")?.status).toBe("answered");
      expect(getInboxItem(corpus.cwd, "candidate-module")?.body).toContain(
        "Billing module",
      );
      expect(
        listRelativeFiles(corpus.cwd).filter((path) =>
          path.startsWith(".contexttrail/cards/"),
        ),
      ).toEqual(cardsBefore);
    } finally {
      corpus.cleanup();
    }
  }, 60_000);

  it("supports init to questions to answer as a cold-start setup sequence", () => {
    const cwd = mkdtempSync(join(tmpdir(), "contexttrail-setup-cold-start-"));
    try {
      runCli(cwd, ["init"]);
      const questions = JSON.parse(runCli(cwd, ["setup", "questions", "--json"]));
      expect(questions.questions[0].id).toBe("import-docs");

      const answer = JSON.parse(
        runCli(cwd, [
          "setup",
          "answer",
          "import-docs",
          "--choice",
          "docs_glob",
          "--json",
        ]),
      );

      expect(answer.action).toMatchObject({
        type: "command_preview",
        command: "contexttrail import docs/**/*.md",
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("get_setup_readiness MCP handler (THO-251)", () => {
  it("registers in the schemas registry with the documented input/output shape", () => {
    expect(schemas.get_setup_readiness).toBeDefined();
    const empty = schemas.get_setup_readiness.input.safeParse({});
    expect(empty.success).toBe(true);
  });

  it("returns a schema-valid response from createHandlers on a fresh fixture", async () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-setup-mcp-" });
    try {
      const handlers = createHandlers({ cwd: corpus.cwd });
      const result = await handlers.get_setup_readiness({});
      const validation = schemas.get_setup_readiness.output.safeParse(result);
      expect(validation.success).toBe(true);
      expect(result.cwd).toBe(corpus.cwd);
      expect(result.dimensions.corpus_coverage.score).toBe("low");
      expect(result.suggestion.command).toBeTruthy();
    } finally {
      corpus.cleanup();
    }
  }, 30_000);

  it("returns schema-valid proposed setup questions from createHandlers", async () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-setup-questions-mcp-" });
    try {
      const handlers = createHandlers({ cwd: corpus.cwd });
      const result = await handlers.propose_setup_questions({});
      const validation = schemas.propose_setup_questions.output.safeParse(result);
      expect(validation.success).toBe(true);
      expect(result.cwd).toBe(corpus.cwd);
      expect(result.questions.length).toBeGreaterThan(0);
      expect(result.questions.length).toBeLessThanOrEqual(3);
      expect(result.questions[0].kind).toBe("import_docs");
    } finally {
      corpus.cleanup();
    }
  }, 30_000);

  it("returns a schema-valid command preview from answer_setup_question", async () => {
    const corpus = createTestCorpus({ prefix: "contexttrail-setup-answer-mcp-" });
    try {
      const handlers = createHandlers({ cwd: corpus.cwd });
      const result = await handlers.answer_setup_question({
        question_id: "import-docs",
        choice_id: "docs_glob",
      });
      const validation = schemas.answer_setup_question.output.safeParse(result);
      expect(validation.success).toBe(true);
      expect(result.action).toMatchObject({
        type: "command_preview",
        command: "contexttrail import docs/**/*.md",
      });
      expect(result.writes).toEqual([]);
    } finally {
      corpus.cleanup();
    }
  }, 30_000);
});
