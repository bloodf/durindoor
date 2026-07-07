import { describe, expect, it } from "vitest";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";

describe("suggested-models openai filter", () => {
  it("maps OpenAI /v1/models shape to id/name pairs", () => {
    const models = [
      { id: "gpt-4o", object: "model", owned_by: "openai" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", object: "model" },
    ];
    expect(FILTERS.openai(models)).toEqual([
      { id: "gpt-4o", name: "gpt-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    ]);
  });

  it("falls back to empty array for non-array input", () => {
    expect(FILTERS.openai(null)).toEqual([]);
    expect(FILTERS.openai(undefined)).toEqual([]);
    expect(FILTERS.openai({ object: "list" })).toEqual([]);
  });

  it("ignores entries without a string id", () => {
    const models = [{ id: "valid" }, { id: 123 }, { name: "no-id" }];
    expect(FILTERS.openai(models)).toEqual([{ id: "valid", name: "valid" }]);
  });
});
