import { describe, expect, it } from "vitest";
import codex from "../../open-sse/providers/registry/codex.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { stripCodexUnsupportedPatterns } from "../../open-sse/utils/codexToolSchema.js";

describe("Codex 6.2 support", () => {
  it.each([["gpt-6.2-sol", 500000, 2], ["gpt-6.2-astra", 272000, 8]])("registers %s and its scoped metadata", (id, window, input) => {
    expect(codex.models.find((model) => model.id === id)?.responsesLite).toBe(true);
    for (const provider of ["codex", "cx"]) {
      expect(getCapabilitiesForModel(provider, `${id}(high)`).contextWindow).toBe(window);
      expect(getPricingForModel(provider, `${id}(high)`).input).toBe(input);
    }
  });
  it("removes unsupported schema keywords while preserving names and literal data", () => {
    const schema = { properties: { uniqueItems: { type: "array", uniqueItems: true, items: { type: "string", pattern: "\\p{L}+" } } }, default: { uniqueItems: true }, $defs: { uniqueItems: { type: "array", uniqueItems: false } } };
    expect(stripCodexUnsupportedPatterns(schema)).toEqual({ properties: { uniqueItems: { type: "array", items: { type: "string" } } }, default: { uniqueItems: true }, $defs: { uniqueItems: { type: "array" } } });
    expect(schema.properties.uniqueItems.uniqueItems).toBe(true);
  });
});
