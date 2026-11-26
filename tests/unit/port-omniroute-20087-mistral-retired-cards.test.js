import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS_CONFIG } from "@/app/api/providers/[id]/models/modelsConfig.js";

const parse = PROVIDER_MODELS_CONFIG.mistral.parseResponse;
const DAY_MS = 86_400_000;
const dayFromNow = (days) => new Date(Date.now() + days * DAY_MS).toISOString();

describe("OmniRoute #20087: Mistral discovery skips retired model cards", () => {
  it("drops a card whose deprecation date has passed", () => {
    const cards = [
      { id: "retired", deprecation: dayFromNow(-1), deprecation_replacement_model: "current" },
      { id: "current", deprecation: null },
    ];

    expect(parse({ object: "list", data: cards }).map(({ id }) => id)).toEqual(["current"]);
  });

  it("keeps future, missing and unreadable dates, and archived fine-tuned cards", () => {
    const cards = [
      { id: "announced", deprecation: dayFromNow(30) },
      { id: "undated" },
      { id: "unreadable", deprecation: "soon" },
      { id: "ft:own", archived: true },
    ];

    expect(parse({ data: cards })).toEqual(cards);
  });
});
