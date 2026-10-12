/**
 * Issue #1248 acceptance scope: `xkiro` vs the installed native `kiro` provider.
 *
 * OFFLINE ONLY. Fetch and the import-time Kimchi updater are explicitly mocked;
 * no credentials, network, or account are used. This file pins the installed
 * `kiro` API-key transport and catalog mapping, and proves that `xkiro` (an
 * OpenAI-compatible gateway at api.xkiro.com upstream) is not silently aliased
 * to it or accepted by the validator. Live account-backed verification is
 * UNAVAILABLE; this is partial offline evidence, not proof of xkiro support.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));

// The real module starts a native dynamic import and periodic network updater.
// Mock the module before runtime imports; loader failure is not offline isolation.
vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/0.1.01",
  updateKimchiUserAgent: vi.fn().mockResolvedValue("kimchi/0.1.01"),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

import { AI_PROVIDERS } from "@/shared/constants/providers";
import { normalizeProviderId } from "@/lib/providerNormalization";
import { probeRegistryProvider } from "@/app/api/providers/providerProbe.js";
import { PROVIDERS } from "open-sse/config/providers.js";
import { KiroExecutor } from "open-sse/executors/kiro.js";
import { clearKiroModelCache, resolveKiroModels } from "open-sse/services/kiroModels.js";

const kiroCreds = {
  accessToken: "kiro-api-key",
  providerSpecificData: { authMethod: "api_key", region: "us-west-2" },
};
const catalogUrl = "https://q.us-west-2.amazonaws.com/ListAvailableModels?origin=AI_EDITOR";

const catalogFixture = [
  {
    modelId: "claude-opus-5",
    modelName: "Claude Opus 5",
    tokenLimits: { maxInputTokens: 1_000_000, maxOutputTokens: 32_768 },
  },
  {
    modelId: "auto",
    modelName: "Auto",
    tokenLimits: { maxInputTokens: 200_000, maxOutputTokens: 8_192 },
  },
];

describe("fleet provider xkiro acceptance (offline)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.proxyAwareFetch.mockReset();
    clearKiroModelCache();
  });

  it("installed kiro: native eventstream transport, api-key auth headers", () => {
    const exec = new KiroExecutor();
    expect(exec.buildUrl("claude-sonnet-4.5", true, 0, kiroCreds)).toBe(
      "https://q.us-west-2.amazonaws.com/generateAssistantResponse",
    );

    const headers = exec.buildHeaders(kiroCreds);
    expect(headers.Authorization).toBe("Bearer kiro-api-key");
    expect(headers.tokentype).toBe("API_KEY");
    expect(headers.Accept).toBe("application/vnd.amazon.eventstream");
  });

  it("installed kiro: native catalog GET maps fixture IDs and token limits", async () => {
    mocks.proxyAwareFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ models: catalogFixture }),
    });
    const result = await resolveKiroModels(kiroCreds, { forceRefresh: true });
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      catalogUrl,
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer kiro-api-key",
          TokenType: "API_KEY",
          Accept: "application/json",
        }),
      }),
      null,
    );
    expect(result.rawModels).toEqual(catalogFixture);
    expect(result.models.map(({ id, upstreamModelId, contextLength, maxOutputTokens }) => ({
      id, upstreamModelId, contextLength, maxOutputTokens,
    }))).toEqual([
      { id: "claude-opus-5", upstreamModelId: "claude-opus-5", contextLength: 1_000_000, maxOutputTokens: 32_768 },
      { id: "claude-opus-5-thinking", upstreamModelId: "claude-opus-5", contextLength: 1_000_000, maxOutputTokens: 32_768 },
      { id: "claude-opus-5-agentic", upstreamModelId: "claude-opus-5", contextLength: 1_000_000, maxOutputTokens: 32_768 },
      { id: "claude-opus-5-thinking-agentic", upstreamModelId: "claude-opus-5", contextLength: 1_000_000, maxOutputTokens: 32_768 },
      { id: "auto", upstreamModelId: "auto", contextLength: 200_000, maxOutputTokens: 8_192 },
      { id: "auto-thinking", upstreamModelId: "auto", contextLength: 200_000, maxOutputTokens: 8_192 },
    ]);
  });

  it("installed kiro: 401 returns exactly null with one catalog fetch and no refresh retry", async () => {
    mocks.proxyAwareFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    });
    const onCredentialsRefreshed = vi.fn();
    const result = await resolveKiroModels(kiroCreds, {
      forceRefresh: true,
      onCredentialsRefreshed,
    });
    // API-key fixture has no refreshToken; rejection must not retry or persist tokens.
    expect(result).toBeNull();
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      catalogUrl,
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer kiro-api-key",
          TokenType: "API_KEY",
        }),
      }),
      null,
    );
    expect(onCredentialsRefreshed).not.toHaveBeenCalled();
  });

  it("candidate xkiro: not a registered provider and not aliased to kiro", () => {
    expect(AI_PROVIDERS.xkiro).toBeUndefined();
    expect(PROVIDERS.xkiro).toBeUndefined();
    expect(normalizeProviderId("xkiro")).toBe("xkiro");
    expect(AI_PROVIDERS.kiro).toBeDefined();
  });

  it("candidate xkiro: validator refuses it and sends no request", async () => {
    const fetcher = vi.fn();
    const result = await probeRegistryProvider("xkiro", "sk-test-not-real", fetcher, {});
    expect(result).toBeNull(); // route maps null to 400 "Provider validation not supported"
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
  });
});
