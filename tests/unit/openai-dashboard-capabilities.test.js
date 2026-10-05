import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ values: [] }));
vi.mock("react", () => ({
  useState: () => [state.values.shift() || {}, () => {}],
  useEffect: () => {},
}));

import { useModelCaps } from "../../src/shared/hooks/useModelCaps.js";

function lookup(key, full = {}, bare = {}, combos = {}) {
  state.values = [full, bare, combos];
  return useModelCaps(false).getCaps(key);
}

describe("provider-scoped dashboard capabilities", () => {
  it("does not borrow a sibling provider's limits or text-only flag", () => {
    const sibling = { vision: false, contextWindow: 200000 };
    const result = lookup("codex/gpt-6-sol", {}, { "gpt-6-sol": sibling });
    expect(result.vision).toBe(true);
    expect(result.contextWindow).toBe(272000);
  });

  it("resolves canonical provider IDs to alias-scoped live metadata", () => {
    const result = lookup("codex/gpt-6-sol", {
      "cx/gpt-6-sol": { vision: false, contextWindow: 196000, maxOutput: 16000 },
    }, { "gpt-6-sol": { vision: true, contextWindow: 1050000 } });
    expect(result).toMatchObject({ vision: false, contextWindow: 196000, maxOutput: 16000 });
  });

  it("keeps documented API capabilities and output limits on cold lookup", () => {
    expect(lookup("openai/gpt-6.1-sol")).toMatchObject({
      vision: true, pdf: true, structuredOutput: true, promptCaching: true,
      contextWindow: 1050000, maxOutput: 128000, thinkingCanDisable: false,
      supportedTools: expect.arrayContaining(["web_search", "image_generation"]),
      audioInput: false, videoInput: false, imageOutput: false, audioOutput: false,
    });
  });

  it("does not display an invented 200K context for an unknown model", () => {
    expect(lookup("openai/unpublished-model").contextWindow).toBeUndefined();
  });
});
