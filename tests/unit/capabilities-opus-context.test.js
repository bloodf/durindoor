import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// Claude Opus 4.6+ ships a 1M-token context window (GA, standard pricing).
// The registry exposes dashed ids (claude-opus-4-8, claude-opus-4-7), which
// must resolve to the 1M context + adaptive thinking caps rather than falling
// through to the generic *claude*opus* pattern (200k / budget thinking).
describe("Claude Opus 1M context capabilities", () => {
  const expected = {
    contextWindow: 1000000,
    maxOutput: 128000,
    thinkingFormat: "claude-adaptive",
    reasoning: true,
    vision: true,
    search: true,
  };

  for (const model of [
    "claude-opus-5",
    "claude-opus-5-thinking",
    "claude-sonnet-5",
    "claude-sonnet-5-thinking",
    "claude-sonnet-5-agentic",
    "claude-opus-4-8",
    "claude-opus-4.8",
    "claude-opus-4-7",
    "claude-opus-4.7",
    "claude-opus-4-6",
  ]) {
    it(`resolves ${model} to a 1M context window`, () => {
      expect(getCapabilitiesForModel("cc", model)).toMatchObject(expected);
    });
  }

  it("resolves every Claude 4.6+ pattern variant to 1M context and 128K output", () => {
    for (const model of [
      "claude-opus-4.6-preview",
      "claude-opus-4.7-fast",
      "claude-opus-4.8-preview",
      "claude-sonnet-4.6-preview",
      "claude-sonnet-4.7-fast",
    ]) {
      expect(getCapabilitiesForModel("cc", model)).toMatchObject(expected);
    }
  });

  it("keeps the older Opus 4.5 at the standard 200k context", () => {
    expect(getCapabilitiesForModel("cc", "claude-opus-4-5-20251101").contextWindow).toBe(200000);
  });
});

// MiniMax M3 native hosts (platform.minimax.io / minimaxi.com) serve the full
// 1M-token window; third-party resellers only guarantee the documented 512K
// minimum. The native providers must NOT inherit the conservative pattern row.
describe("MiniMax M3 context capabilities", () => {
  it("resolves native MiniMax providers to the full 1M window", () => {
    for (const provider of ["minimax", "minimax-cn"]) {
      expect(getCapabilitiesForModel(provider, "MiniMax-M3")).toMatchObject({
        contextWindow: 1000000,
        maxOutput: 131072,
        thinkingFormat: "minimax",
        reasoning: true,
        vision: true,
      });
    }
  });

  it("keeps third-party MiniMax M3 hosts at their guaranteed 512K minimum", () => {
    expect(getCapabilitiesForModel("nvidia", "minimaxai/minimax-m3").contextWindow).toBe(512000);
    expect(getCapabilitiesForModel("openrouter", "minimax-m3").contextWindow).toBe(512000);
  });

  it("leaves the smaller MiniMax families untouched", () => {
    expect(getCapabilitiesForModel("minimax", "MiniMax-M2.7-highspeed").contextWindow).toBe(204800);
  });
});
