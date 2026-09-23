import { describe, expect, it } from "vitest";
import { normalizeApiKeyPolicy, mergeApiKeyPolicy } from "../../src/lib/db/helpers/apiKeyPolicy.js";

describe("API-key policy allowAutoCombos", () => {
  it("passes through an explicit true/false", () => {
    expect(normalizeApiKeyPolicy({ allowAutoCombos: false }).allowAutoCombos).toBe(false);
    expect(normalizeApiKeyPolicy({ allowAutoCombos: true }).allowAutoCombos).toBe(true);
  });

  it("leaves the field unset when absent (default allowed)", () => {
    expect(normalizeApiKeyPolicy({})?.allowAutoCombos).toBeUndefined();
    expect(normalizeApiKeyPolicy(null)).toBeNull();
  });

  it("rejects a non-boolean value", () => {
    expect(() => normalizeApiKeyPolicy({ allowAutoCombos: "false" })).toThrow(TypeError);
    expect(() => normalizeApiKeyPolicy({ allowAutoCombos: 0 })).toThrow(TypeError);
  });

  it("merges a patch that flips allowAutoCombos without disturbing other fields", () => {
    const merged = mergeApiKeyPolicy({ allowedModels: ["openai/gpt-5"] }, { allowAutoCombos: false });
    expect(merged).toEqual({ allowedModels: ["openai/gpt-5"], allowAutoCombos: false });
  });
});
