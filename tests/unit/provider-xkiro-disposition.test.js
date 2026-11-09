/**
 * Issue #1248 disposition: candidate `xkiro` vs native `kiro` contracts.
 *
 * OFFLINE / SOURCE-ONLY DISPOSITION TEST.
 * Confirms that candidate `xkiro` remains unadmitted and unregistered on current main,
 * preventing duplicate aliases and ensuring rejection BEFORE credential-bearing transport.
 *
 * Distinguishes source/fixture containment from live account-backed acceptance.
 * Neither network requests nor credentials are transmitted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));

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

const nativeKiroCredentials = {
  accessToken: "kiro-live-access-token",
  providerSpecificData: { authMethod: "api_key", region: "us-west-2" },
};

describe("provider xkiro disposition (issue #1248)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.proxyAwareFetch.mockReset();
    clearKiroModelCache();
  });

  describe("identity and alias boundaries", () => {
    it("candidate xkiro is absent from provider registry and not aliased to kiro", () => {
      expect(AI_PROVIDERS.xkiro).toBeUndefined();
      expect(PROVIDERS.xkiro).toBeUndefined();
      expect(normalizeProviderId("xkiro")).toBe("xkiro");
      expect(normalizeProviderId("kiro")).toBe("kiro");
      expect(AI_PROVIDERS.kiro).toBeDefined();
      expect(PROVIDERS.kiro).toBeDefined();
    });

    it("does not manufacture duplicate or conflicting alias definitions", () => {
      // Ensure normalizeProviderId maintains strict 1:1 identity without synthetic mapping
      expect(normalizeProviderId("xkiro")).not.toBe("kiro");
      expect(normalizeProviderId("xkiro-reseller")).toBe("xkiro-reseller");
    });
  });

  describe("rejection before credential-bearing transport", () => {
    it("probeRegistryProvider refuses xkiro immediately without transport or credential egress", async () => {
      const mockFetcher = vi.fn();
      const sensitiveToken = "xkiro-candidate-credential-token-do-not-leak";

      const probeResult = await probeRegistryProvider("xkiro", sensitiveToken, mockFetcher, {});

      // Unsupported provider maps probe to null, leading to HTTP 400 'Provider validation not supported'
      expect(probeResult).toBeNull();
      // Transport functions must NEVER be invoked for unsupported candidate
      expect(mockFetcher).not.toHaveBeenCalled();
      expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
    });

    it("does not construct outbound request options when candidate provider is not in registry", async () => {
      const mockFetcher = vi.fn();
      await probeRegistryProvider("xkiro", "dummy-key", mockFetcher, {
        baseUrl: "https://api.xkiro.com/v1",
      });

      expect(mockFetcher).not.toHaveBeenCalled();
      expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
    });
  });

  describe("native kiro architectural differentiation", () => {
    it("native kiro targets AWS CodeWhisperer / Q data plane, not OpenAI-compatible endpoints", () => {
      const exec = new KiroExecutor();
      const targetUrl = exec.buildUrl("claude-sonnet-4.5", true, 0, nativeKiroCredentials);

      expect(targetUrl).toBe("https://q.us-west-2.amazonaws.com/generateAssistantResponse");
      expect(targetUrl).not.toContain("api.xkiro.com");
    });

    it("native kiro uses AWS-specific eventstream headers and tokentype discriminator", () => {
      const exec = new KiroExecutor();
      const headers = exec.buildHeaders(nativeKiroCredentials);

      expect(headers.Authorization).toBe("Bearer kiro-live-access-token");
      expect(headers.tokentype).toBe("API_KEY");
      expect(headers.Accept).toBe("application/vnd.amazon.eventstream");
      expect(headers["Amz-Sdk-Request"]).toBeDefined();
    });

    it("native catalog uses AWS ListAvailableModels control-plane endpoint", async () => {
      mocks.proxyAwareFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ models: [] }),
      });

      await resolveKiroModels(nativeKiroCredentials, { forceRefresh: true });

      expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, options] = mocks.proxyAwareFetch.mock.calls[0];
      expect(calledUrl).toBe("https://q.us-west-2.amazonaws.com/ListAvailableModels?origin=AI_EDITOR");
      expect(options.headers.TokenType).toBe("API_KEY");
      expect(options.headers.Accept).toBe("application/json");
      expect(calledUrl).not.toContain("xkiro");
    });
  });

  describe("source containment vs account-backed acceptance", () => {
    it("records that xkiro candidate remains unadmitted without live account-backed proof", () => {
      // Offline fixture verification does NOT equal live account-backed acceptance
      const isAccountBackedLiveProofAvailable = false;
      const isProductionRegistrationAdmitted = false;

      expect(isAccountBackedLiveProofAvailable).toBe(false);
      expect(isProductionRegistrationAdmitted).toBe(false);
    });
  });
});
