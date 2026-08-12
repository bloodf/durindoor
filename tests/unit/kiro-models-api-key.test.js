import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

import {
  clearKiroModelCache,
  resolveKiroModels,
} from "../../open-sse/services/kiroModels.js";

const catalogResponse = () => ({
  ok: true,
  status: 200,
  json: async () => ({
    models: [{
      modelId: "claude-opus-5",
      modelName: "Claude Opus 5",
      tokenLimits: { maxInputTokens: 1_000_000, maxOutputTokens: 128_000 },
    }],
  }),
});

describe("Kiro API-key model discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearKiroModelCache();
    mocks.proxyAwareFetch.mockImplementation(async () => catalogResponse());
  });

  it("sends TokenType only for api_key auth and preserves maxOutputTokens on every variant", async () => {
    const apiKeyResult = await resolveKiroModels({
      accessToken: "kiro-api-key",
      providerSpecificData: { authMethod: "api_key", region: "us-west-2" },
    }, { forceRefresh: true });

    await resolveKiroModels({
      accessToken: "kiro-social-token",
      providerSpecificData: { authMethod: "social", region: "us-west-2" },
    }, { forceRefresh: true });

    expect(mocks.proxyAwareFetch.mock.calls[0][1].headers).toMatchObject({
      Authorization: "Bearer kiro-api-key",
      TokenType: "API_KEY",
    });
    expect(mocks.proxyAwareFetch.mock.calls[1][1].headers).not.toHaveProperty("TokenType");
    expect(apiKeyResult.models).toHaveLength(4);
    expect(apiKeyResult.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "claude-opus-5",
          contextLength: 1_000_000,
          maxOutputTokens: 128_000,
        }),
      ])
    );
    expect(apiKeyResult.models.every((model) => model.maxOutputTokens === 128_000)).toBe(true);
  });
});
