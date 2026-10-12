/**
 * Issue #1248 acceptance scope: `xkiro` vs the installed native `kiro` provider.
 *
 * OFFLINE ONLY. Fetch is mocked; no credentials, network, or account are used. This
 * file proves the installed `kiro` runtime path (executor headers/URL, live model
 * discovery) and that `xkiro` (an OpenAI-compatible gateway at api.xkiro.com upstream,
 * a different identity and transport) is NOT silently aliased to it or accepted by the
 * validator. It does not prove xkiro support, and live account-backed verification is
 * unavailable, so no xkiro capability is claimed. Static registry exports are metadata
 * only; runtime behavior is asserted through the validator, discovery, and executor.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));

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

describe("fleet provider xkiro acceptance (offline)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearKiroModelCache();
  });

  it("installed kiro: native eventstream transport, api-key auth headers", () => {
    const exec = new KiroExecutor();
    const url = exec.buildUrl("claude-sonnet-4.5", true, 0, kiroCreds);
    expect(url).toMatch(/^https:\/\/[^/]*(kiro\.dev|amazonaws\.com)\/generateAssistantResponse$/);
    expect(url).not.toContain("xkiro.com");

    const headers = exec.buildHeaders(kiroCreds);
    expect(headers.Authorization).toBe("Bearer kiro-api-key");
    expect(headers.tokentype).toBe("API_KEY");
    expect(headers.Accept).toBe("application/vnd.amazon.eventstream");
  });

  it("installed kiro: live model discovery hits the native catalog and maps models", async () => {
    mocks.proxyAwareFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        models: [{ modelId: "claude-opus-5", modelName: "Claude Opus 5", tokenLimits: { maxInputTokens: 1_000_000 } }],
      }),
    });
    const result = await resolveKiroModels(kiroCreds, { forceRefresh: true });
    expect(result.models.length).toBeGreaterThan(0);
    const [calledUrl, init] = mocks.proxyAwareFetch.mock.calls[0];
    expect(String(calledUrl)).not.toContain("xkiro.com");
    expect(JSON.stringify(init.headers)).toContain("Bearer kiro-api-key");
  });

  it("installed kiro: upstream auth rejection surfaces as an error, not a model list", async () => {
    mocks.proxyAwareFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
      json: async () => ({}),
    });
    const result = await resolveKiroModels(kiroCreds, { forceRefresh: true });
    // No refreshToken: no retry path, so no live catalog may be reported.
    expect(result?.models?.length ?? 0).toBe(0);
  });

  it("candidate xkiro: not a registered provider and not aliased to kiro", () => {
    expect(AI_PROVIDERS.xkiro).toBeUndefined();
    expect(PROVIDERS.xkiro).toBeUndefined();
    expect(normalizeProviderId("xkiro")).not.toBe("kiro");
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
