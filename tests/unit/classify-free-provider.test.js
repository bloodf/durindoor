import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyFreeProvider } from "../../src/shared/constants/providers.js";

vi.mock("open-sse/providers/registry/index.js", () => ({
  default: [
    { id: "mimo-free", category: "free", display: { name: "Mimo Free" } },
    { id: "ollama", category: "freeTier", display: { name: "Ollama Cloud" } },
    { id: "openai", category: "oauth", display: { name: "OpenAI" } },
  ],
}));

vi.mock("@/shared/constants/providersDisplay", () => ({
  RISK_NOTICE: "",
}));

import { FREE_PROVIDERS, FREE_TIER_PROVIDERS } from "../../src/shared/constants/providers.js";

describe("classifyFreeProvider", () => {
  it("returns free for free category providers", () => {
    expect(classifyFreeProvider("mimo-free")).toBe("free");
  });

  it("returns freeTier for freeTier category providers", () => {
    expect(classifyFreeProvider("ollama")).toBe("freeTier");
  });

  it("returns null for non-free providers", () => {
    expect(classifyFreeProvider("openai")).toBeNull();
  });

  it("returns null for non-strings", () => {
    expect(classifyFreeProvider(null)).toBeNull();
    expect(classifyFreeProvider(123)).toBeNull();
  });
});

export {};
