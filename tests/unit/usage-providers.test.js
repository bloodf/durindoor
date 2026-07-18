import { describe, it, expect, beforeEach, vi } from "vitest";

const mockFreeProviders = {
  opencode: {
    id: "opencode",
    name: "OpenCode",
    noAuth: true,
  },
  pollinations: {
    id: "pollinations",
    name: "Pollinations",
    noAuth: true,
  },
};

const mockAIProviders = {
  opencode: { serviceKinds: ["llm"] },
  pollinations: { serviceKinds: ["llm"] },
  openai: { serviceKinds: ["llm"] },
};

describe("buildUsageProviders", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it("retains enabled no-auth providers with an inactive saved connection", async () => {
    vi.doMock("@/shared/constants/providers", () => ({
      FREE_PROVIDERS: mockFreeProviders,
      AI_PROVIDERS: mockAIProviders,
    }));
    const { buildUsageProviders } = await import(
      "../../src/shared/utils/usageProviders.js"
    );

    const providers = buildUsageProviders(
      [{ provider: "opencode", authType: "oauth", isActive: false }],
      [],
      [],
    );

    expect(providers.map((p) => p.provider)).toContain("opencode");
  });

  it("does not duplicate a no-auth provider when its connection is active", async () => {
    vi.doMock("@/shared/constants/providers", () => ({
      FREE_PROVIDERS: mockFreeProviders,
      AI_PROVIDERS: mockAIProviders,
    }));
    const { buildUsageProviders } = await import(
      "../../src/shared/utils/usageProviders.js"
    );

    const providers = buildUsageProviders(
      [{ provider: "opencode", authType: "oauth", isActive: true, id: "c1" }],
      [],
      [],
    );

    const opencode = providers.filter((p) => p.provider === "opencode");
    expect(opencode.length).toBe(1);
    expect(opencode[0].id).toBe("c1");
  });

  it("honors disabledFreeProviders even when a saved connection is inactive", async () => {
    vi.doMock("@/shared/constants/providers", () => ({
      FREE_PROVIDERS: mockFreeProviders,
      AI_PROVIDERS: mockAIProviders,
    }));
    const { buildUsageProviders } = await import(
      "../../src/shared/utils/usageProviders.js"
    );

    const providers = buildUsageProviders(
      [{ provider: "opencode", authType: "oauth", isActive: false }],
      [],
      ["opencode"],
    );

    expect(providers.map((p) => p.provider)).not.toContain("opencode");
  });

  it("includes custom node names for active connections", async () => {
    vi.doMock("@/shared/constants/providers", () => ({
      FREE_PROVIDERS: mockFreeProviders,
      AI_PROVIDERS: mockAIProviders,
    }));
    const { buildUsageProviders } = await import(
      "../../src/shared/utils/usageProviders.js"
    );

    const providers = buildUsageProviders(
      [{ provider: "openai", authType: "apikey", isActive: true }],
      [{ id: "openai", name: "My OpenAI" }],
      [],
    );

    const openai = providers.find((p) => p.provider === "openai");
    expect(openai.nodeName).toBe("My OpenAI");
  });
});
