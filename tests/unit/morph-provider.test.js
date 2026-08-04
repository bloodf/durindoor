import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";

describe("Morph provider (upstream de2da19a9 morph slice)", () => {
  it("is registered as an OpenAI-compatible apikey provider", () => {
    const morph = REGISTRY.find((e) => e.id === "morph");
    expect(morph).toBeDefined();
    expect(morph.category).toBe("apikey");
    expect(morph.alias).toBe("morph");
    expect(morph.aliases).toContain("morphllm");
    expect(morph.transport.baseUrl).toBe("https://api.morphllm.com/v1/chat/completions");
    expect(morph.transport.validateUrl).toBe("https://api.morphllm.com/v1/models");
  });

  it("builds into the runtime PROVIDERS map with the openai format default", () => {
    expect(PROVIDERS.morph).toBeDefined();
    expect(PROVIDERS.morph.format).toBe("openai");
    expect(PROVIDERS.morph.baseUrl).toBe("https://api.morphllm.com/v1/chat/completions");
  });

  it("exposes exactly the upstream morph model list", () => {
    const morph = REGISTRY.find((e) => e.id === "morph");
    expect(morph.models).toEqual([
      { id: "morph-v3-large", name: "Morph v3 Large" },
      { id: "morph-v3-fast", name: "Morph v3 Fast" },
      { id: "morph-qwen35-397b", name: "Qwen 3.5 397B (Morph)", contextLength: 262144 },
      { id: "morph-minimax27-230b", name: "MiniMax M2.7 (Morph)", contextLength: 200704 },
      { id: "morph-qwen36-27b", name: "Qwen 3.6 27B (Morph)", contextLength: 131072 },
      { id: "morph-dsv4flash", name: "DeepSeek V4 Flash (Morph)", contextLength: 1048576 },
    ]);
  });
});
