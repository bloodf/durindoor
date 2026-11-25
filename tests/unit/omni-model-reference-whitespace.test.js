import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getModelAliases: async () => ({ favorite: "cx/gpt-5" }),
  getComboForModel: async () => null,
  getProviderNodes: async () => [],
  getProviderConnections: async () => [],
}));

import { normalizeModelReference, parseModel } from "../../open-sse/services/model.js";
import { getModelInfo } from "../../src/sse/services/model.js";
import { isModelAllowed } from "../../src/sse/services/apiKeyPolicy.js";
import { getModelAccessCandidateBuilder, isModelAccessAllowed } from "../../src/sse/services/modelAccess.js";

describe("model reference whitespace", () => {
  it.each([
    ["cx/gpt-5", "  cx / gpt-5  ", { provider: "codex", model: "gpt-5" }],
    ["favorite", "  favorite  ", { provider: "codex", model: "gpt-5" }],
    ["hf/Org/Model", " hf / Org/Model ", { provider: "huggingface", model: "Org/Model" }],
  ])("selects the same model for %s and its padded form", async (plain, padded, expected) => {
    expect(await getModelInfo(plain)).toEqual(expected);
    expect(await getModelInfo(padded)).toEqual(expected);
    const resolved = await getModelInfo(padded);
    const identity = `${resolved.provider}/${resolved.model}`;
    const candidatesFor = await getModelAccessCandidateBuilder();
    expect(isModelAllowed({ allowedModels: [identity] }, identity)).toBe(true);
    expect(isModelAllowed({ allowedModels: ["openai/other"] }, identity)).toBe(false);
    expect(isModelAccessAllowed({ mode: "allow", patterns: [identity] }, candidatesFor(identity))).toBe(true);
    expect(isModelAccessAllowed({ mode: "deny", patterns: [identity] }, candidatesFor(identity))).toBe(false);
  });

  it("preserves case, internal namespace whitespace, and malformed empty parts", () => {
    expect(normalizeModelReference("  CX / Org / Model  ")).toBe("CX/Org / Model");
    expect(parseModel(" / model ")).toMatchObject({ provider: "", model: "model" });
    expect(parseModel(" cx / ")).toMatchObject({ provider: "codex", model: "" });
    expect(parseModel("   ")).toMatchObject({ provider: null, model: null });
  });
});
