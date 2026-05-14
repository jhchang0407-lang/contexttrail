import { Command } from "commander";
import { runCardImport } from "./card-import.js";
import { runCardBootstrap } from "./card-bootstrap.js";
import {
  runCardAdd,
  runCardList,
  renderCardList,
  runCardShow,
  renderCardShow,
  runCardVerify,
  runCardMarkNeedsReview,
  runCardLink,
  runCardUnlink,
  runCardSuggest,
} from "./card-cmds.js";
import type { CardType } from "../types/card.js";

export function registerCardCommands(program: Command): void {
  const cardCmd = program
    .command("card")
    .description("Author and inspect Cards (constraint / symbol_note / evidence)");

  cardCmd
    .command("bootstrap")
    .description("Generate candidate review items from imported docs")
    .option(
      "--llm",
      "Run LLM augmentation after regex bootstrap (PRD-0034). Requires ANTHROPIC_API_KEY.",
      false,
    )
    .action(async (cliOptions: { llm?: boolean }) => {
      const summary = await runCardBootstrap(process.cwd(), { llm: cliOptions.llm });
      console.log(
        `contexttrail card bootstrap: ${summary.constraint_candidates_written} constraint, ${summary.symbol_note_candidates_written} symbol_note, ${summary.clarification_needs_written} clarification from ${summary.chunks_considered} chunks (${summary.merged_duplicates} merged duplicates)`,
      );
      if (summary.llm_augmentation) {
        const llm = summary.llm_augmentation;
        const parts = [
          `LLM augmentation: ${llm.chunks_processed} chunk${llm.chunks_processed === 1 ? "" : "s"} processed`,
          `${llm.candidates_added} candidate${llm.candidates_added === 1 ? "" : "s"} added`,
          `${llm.clarifications_added} clarification${llm.clarifications_added === 1 ? "" : "s"} added`,
        ];
        if (llm.chunks_skipped_over_cap > 0) {
          parts.push(`${llm.chunks_skipped_over_cap} skipped over cap`);
        }
        if (llm.chunks_failed > 0) {
          parts.push(`${llm.chunks_failed} failed`);
        }
        console.log(parts.join(", "));
        for (const w of llm.warnings) {
          if (w.kind === "chunk_failed") {
            console.warn(`  warn: chunk ${w.chunk_stable_key} skipped — ${w.message}`);
          } else if (w.kind === "cap_exceeded") {
            console.warn(
              `  warn: ${w.qualifying_chunks} qualifying chunks exceeded the per-run cap of ${w.cap}; first ${w.cap} were processed`,
            );
          }
        }
      }
    });

  cardCmd
    .command("add <type>")
    .description("Scaffold a new Card under .contexttrail/cards/")
    .action((type: string) => {
      if (type !== "constraint" && type !== "symbol_note" && type !== "evidence") {
        console.error("type must be one of: constraint | symbol_note | evidence");
        process.exit(2);
      }
      const r = runCardAdd(process.cwd(), type as CardType);
      console.log(`contexttrail card add: created ${r.path} (id=${r.id})`);
      console.log("Open this file in your editor, then run: contexttrail card import");
    });

  cardCmd
    .command("import")
    .description("Re-import every Card under .contexttrail/cards/")
    .action(() => {
      const r = runCardImport(process.cwd());
      console.log(
        `contexttrail card import: ${r.cards_imported} imported, ${r.cards_skipped} skipped`,
      );
      for (const w of r.warnings) console.warn(`  warning: ${w}`);
    });

  cardCmd
    .command("list")
    .description("List every Card with type, scope, freshness, link count")
    .option("--type <t>", "filter by type: constraint | symbol_note | evidence")
    .option("--scope <s>", "filter by scope summary substring")
    .option("--needs-review", "only Cards in needs_review state")
    .action((opts: { type?: string; scope?: string; needsReview?: boolean }) => {
      const rows = runCardList(process.cwd(), {
        type: opts.type as CardType | undefined,
        scope: opts.scope,
        needs_review: opts.needsReview,
      });
      process.stdout.write(renderCardList(rows));
    });

  cardCmd
    .command("show <id>")
    .description("Show a Card's body, frontmatter, and linked-chunk contexttrails")
    .action((id: string) => {
      const r = runCardShow(process.cwd(), id);
      if (!r) {
        console.error(`contexttrail card show: no Card with id ${id}`);
        process.exit(1);
      }
      process.stdout.write(renderCardShow(r));
    });

  cardCmd
    .command("verify <id>")
    .description("Flip author_review_state to verified (does not touch freshness_state)")
    .action((id: string) => {
      const ok = runCardVerify(process.cwd(), id);
      if (!ok) {
        console.error(`contexttrail card verify: no Card with id ${id}`);
        process.exit(1);
      }
      console.log(`contexttrail card verify: ${id} author_review_state -> verified`);
    });

  cardCmd
    .command("mark-needs-review <id>")
    .description("Flip author_review_state to needs_review_manual")
    .action((id: string) => {
      const ok = runCardMarkNeedsReview(process.cwd(), id);
      if (!ok) {
        console.error(`contexttrail card mark-needs-review: no Card with id ${id}`);
        process.exit(1);
      }
      console.log(`contexttrail card mark-needs-review: ${id} flagged`);
    });

  cardCmd
    .command("link <card> <chunk_version_id>")
    .description("Link a Card to a Doc Chunk (captures version_pin)")
    .option(
      "--type <t>",
      "evidences | mentions | covers (default: mentions)",
      "mentions",
    )
    .action(
      (
        card: string,
        chunkVersionId: string,
        opts: { type: "evidences" | "mentions" | "covers" },
      ) => {
        const ok = runCardLink(process.cwd(), card, chunkVersionId, opts.type);
        if (!ok) {
          console.error("contexttrail card link: card or chunk not found");
          process.exit(1);
        }
        console.log(`contexttrail card link: linked ${card} -> ${chunkVersionId} (${opts.type})`);
      },
    );

  cardCmd
    .command("unlink <card> <chunk_version_id>")
    .description("Remove a link between a Card and a Doc Chunk")
    .option("--type <t>", "evidences | mentions | covers (default: mentions)", "mentions")
    .action(
      (
        card: string,
        chunkVersionId: string,
        opts: { type: "evidences" | "mentions" | "covers" },
      ) => {
        const ok = runCardUnlink(process.cwd(), card, chunkVersionId, opts.type);
        if (!ok) {
          console.error("contexttrail card unlink: chunk not found");
          process.exit(1);
        }
        console.log(`contexttrail card unlink: removed ${card} -> ${chunkVersionId}`);
      },
    );

  cardCmd
    .command("suggest <id>")
    .description("Show top-N inline link candidates for a Card")
    .option("-n, --top <n>", "max suggestions", "5")
    .action((id: string, opts: { top: string }) => {
      const top = parseInt(opts.top, 10) || 5;
      const s = runCardSuggest(process.cwd(), id, top);
      if (s.length === 0) {
        console.log("contexttrail card suggest: no candidates");
        return;
      }
      for (const c of s) {
        console.log(
          `${c.version_id}  anchor=${c.anchor_overlap.toFixed(2)} scope=${c.scope_match.toFixed(2)}  ${c.source_path} > ${c.heading_path.join(" > ")}`,
        );
      }
    });
}
