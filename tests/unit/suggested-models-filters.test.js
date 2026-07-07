// Guards the dashboard suggested-models filter registry. Providers declaring
// `modelsFetcher.type: "openai"` (crof, dit, freeaiapikey, featherless-ai, …)
// need a matching FILTERS entry, or the API route 400s with "Unknown filter type"
// and the dashboard model dropdown silently shows nothing. See review PRRT_kwDOTM9Pps6OxECl.
import { describe, expect, it } from "vitest";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";

describe("suggested-models FILTERS.openai-compatible", () => {
  it("exists as a registered filter type", () => {
    expect(typeof FILTERS["openai-compatible"]).toBe("function");
  });

  it("maps a plain OpenAI-compatible /v1/models list to { id, name, contextLength }", () => {
    const raw = [
      { id: "gpt-5.4", context_length: 400000 },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", context_length: 200000 },
      { id: "no-context-model" },
    ];

    expect(FILTERS["openai-compatible"](raw)).toEqual([
      { id: "gpt-5.4", name: "gpt-5.4", contextLength: 400000 },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", contextLength: 200000 },
      { id: "no-context-model", name: "no-context-model" },
    ]);
  });

  it("drops entries without an id and tolerates non-array input", () => {
    expect(FILTERS["openai-compatible"]([{ name: "no id" }, null])).toEqual([]);
    expect(FILTERS["openai-compatible"](null)).toEqual([]);
  });
});
