import { describe, expect, it } from "vitest";
import { renderCardFixture } from "./card-fixtures.js";
import { parseCard } from "../cards/loader.js";

describe("eval card fixtures", () => {
  it("renders typed Card fixtures as parseable card markdown", () => {
    const markdown = renderCardFixture({
      id: "S001",
      type: "symbol_note",
      title: "RefundService.processRefund is idempotent",
      scope: {
        layer: "module",
        project: "payments",
        module: "refunds",
      },
      symbol_anchors: ["RefundService.processRefund"],
      body: "RefundService.processRefund returns the existing refund for duplicate retries.",
    });

    const card = parseCard(markdown, ".contexttrail/cards/s-refund.md");

    expect(card.id).toBe("S001");
    expect(card.type).toBe("symbol_note");
    expect(card.scope.project).toBe("payments");
    expect(card.symbol_anchors).toEqual(["RefundService.processRefund"]);
  });
});
