import { describe, it, expect } from "vitest";
import { PROVIDER_CAPABILITIES, getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("NVIDIA MiniMax capability precedence", () => {
  it("keeps the retired NVIDIA ID OpenAI-safe without changing MiniMax itself", () => {
    expect(PROVIDER_CAPABILITIES.nvidia["minimaxai/minimax-m2.7"]).toMatchObject({
      reasoning: false,
      maxOutput: 131072,
    });

    const directMinimax = getCapabilitiesForModel("minimax", "MiniMax-M2.7");
    expect(directMinimax).toMatchObject({
      reasoning: true,
      thinkingFormat: "minimax",
    });
  });

  it("keeps NVIDIA's OpenAI override ahead of the generic MiniMax pattern", () => {
    const nvidiaMinimax = getCapabilitiesForModel("nvidia", "minimaxai/minimax-m3");
    const genericMinimax = getCapabilitiesForModel(null, "minimaxai/minimax-m3");

    expect(nvidiaMinimax.thinkingFormat).toBe("openai");
    expect(genericMinimax.thinkingFormat).toBe("minimax");
  });
});
