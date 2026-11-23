import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("port 9router ba3bba4709: NVIDIA-hosted Nemotron 3 Ultra capabilities", () => {
  it("advertises tools and the verified 1M hosted window", () => {
    expect(getCapabilitiesForModel("nvidia", "nvidia/nemotron-3-ultra-550b-a55b"))
      .toMatchObject({ contextWindow: 1000000, tools: true, reasoning: true, thinkingFormat: "openai" });
  });

  it("leaves the OpenRouter listing of the same model untouched", () => {
    expect(getCapabilitiesForModel("openrouter", "nvidia/nemotron-3-ultra-550b-a55b").contextWindow).toBe(128000);
  });
});
