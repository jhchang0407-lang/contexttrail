import { Command } from "commander";
import {
  runInboxAccept,
  runInboxAnswer,
  renderInboxList,
  renderInboxShow,
  runInboxList,
  runInboxShow,
} from "./inbox-cmds.js";

export function registerInboxCommands(program: Command): void {
  const inboxCmd = program
    .command("inbox")
    .description("Inspect review items stored in .contexttrail/inbox/");

  inboxCmd
    .command("list")
    .description("List inbox review items with optional filters and a count summary")
    .option(
      "--limit <n>",
      "Max items to display (default 20)",
      (v: string) => Number.parseInt(v, 10),
    )
    .option(
      "--type <reviewType>",
      "Filter by review type: candidate_card | clarification_need",
    )
    .option(
      "--status <status>",
      "Filter by status: pending | accepted | rejected | answered",
    )
    .action((opts: { limit?: number; type?: string; status?: string }) => {
      if (opts.type && opts.type !== "candidate_card" && opts.type !== "clarification_need") {
        console.error(
          `contexttrail inbox list: --type must be candidate_card or clarification_need (got ${opts.type})`,
        );
        process.exit(2);
      }
      if (
        opts.status &&
        !["pending", "accepted", "rejected", "answered"].includes(opts.status)
      ) {
        console.error(
          `contexttrail inbox list: --status must be pending|accepted|rejected|answered (got ${opts.status})`,
        );
        process.exit(2);
      }
      if (opts.limit !== undefined && (!Number.isFinite(opts.limit) || opts.limit <= 0)) {
        console.error("contexttrail inbox list: --limit must be a positive integer");
        process.exit(2);
      }
      process.stdout.write(
        renderInboxList(
          runInboxList(process.cwd(), {
            limit: opts.limit,
            type: opts.type as "candidate_card" | "clarification_need" | undefined,
            status: opts.status as
              | "pending"
              | "accepted"
              | "rejected"
              | "answered"
              | undefined,
          }),
        ),
      );
    });

  inboxCmd
    .command("show <id>")
    .description("Show a single inbox review item")
    .action((id: string) => {
      const item = runInboxShow(process.cwd(), id);
      if (!item) {
        console.error(`contexttrail inbox show: no review item with id ${id}`);
        process.exit(1);
      }
      process.stdout.write(renderInboxShow(item));
    });

  inboxCmd
    .command("accept <id>")
    .description("Accept a candidate-card inbox item into .contexttrail/cards/")
    .action((id: string) => {
      const accepted = runInboxAccept(process.cwd(), id);
      if (!accepted) {
        console.error(`contexttrail inbox accept: no candidate review item with id ${id}`);
        process.exit(1);
      }
      console.log(
        `contexttrail inbox accept: ${accepted.review_item_id} -> ${accepted.card_id} (${accepted.path})`,
      );
      console.log(
        "Accepted Card was written to .contexttrail/cards/ and imported into the cache.",
      );
    });

  inboxCmd
    .command("answer <id>")
    .description("Answer a clarification review item and rewrite affected pending candidates")
    .option("--choice <choiceId>", "choose one constrained clarification option")
    .option("--text <answer>", "provide a free-text clarification answer")
    .action((id: string, opts: { choice?: string; text?: string }) => {
      if (!opts.choice && !opts.text) {
        console.error("contexttrail inbox answer: provide --choice <id> or --text <answer>");
        process.exit(2);
      }
      const answered = runInboxAnswer(process.cwd(), id, {
        choice_id: opts.choice,
        free_text: opts.text,
      });
      if (!answered) {
        console.error(`contexttrail inbox answer: could not answer clarification ${id}`);
        process.exit(1);
      }
      console.log(
        `contexttrail inbox answer: ${answered.review_item_id} updated ${answered.updated_candidate_ids.length} candidate(s)`,
      );
    });
}
