import { describe, expect, it } from "vitest";
import { schemas, type SyncLedgerOutputT } from "./schemas.js";
import {
  TOOL_REGISTRY,
  TOOL_NAMES,
  formatModelVisibleToolText,
} from "./tool-registry.js";

describe("MCP tool registry", () => {
  it("keeps tool metadata aligned with schemas", () => {
    expect(TOOL_NAMES).toEqual(Object.keys(schemas));
    expect(TOOL_REGISTRY.map((tool) => tool.name)).toEqual(TOOL_NAMES);
    expect(TOOL_REGISTRY.every((tool) => tool.description.length > 0)).toBe(true);
  });

  it("owns compact model-visible text for non-JSON tool summaries", () => {
    const sync: SyncLedgerOutputT = {
      cwd: "/tmp/repo",
      mode: "check",
      initialized: true,
      actions: [
        {
          kind: "import_cards",
          description: "Re-import hidden accepted Card files and rebuild freshness.",
          paths: [".contexttrail/cards"],
        },
      ],
      writes: [],
      freshness: {
        stale_doc_sources: [],
            missing_sources: [],
      },
      cards: {
        before: {
          total: 1,
          verified: 1,
          unverified: 0,
          needs_review: 0,
          maybe_affected: 0,
          potentially_superseded: 0,
          manual_needs_review: 0,
        },
        after: {
          total: 1,
          verified: 1,
          unverified: 0,
          needs_review: 0,
          maybe_affected: 0,
          potentially_superseded: 0,
          manual_needs_review: 0,
        },
        newly_needs_review: [],
        already_needs_review: [],
      },
      inbox: {
        pending_total: 0,
        candidate_cards: 0,
        clarification_needs: 0,
      },
    };

    expect(formatModelVisibleToolText("sync_ledger", sync)).toContain(
      "ContextTrail sync check",
    );
  });
});
