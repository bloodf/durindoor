import { describe, expect, it, vi } from "vitest";
import {
  fetchGeminiApiKeyQuota,
  normalizeGeminiApiKeyQuota,
  GEMINI_API_KEY_SOURCE_ID,
} from "../../src/lib/usage/geminiApiKeyQuotaAdapter.js";
import {
  fetchXaiQuota,
  normalizeXaiPrepaidBalance,
  XAI_QUOTA_SOURCE_ID,
  XAI_MANAGEMENT_API_BASE_URL,
} from "../../src/lib/usage/xaiQuotaAdapter.js";

const NOW = Date.parse("2026-01-01T00:00:00.000Z");

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("Quota Documented Snapshot Adapters (#1110)", () => {
  describe("Gemini API-key quota adapter", () => {
    it("reports missing credential when no apiKey is present and performs no network request", async () => {
      const fetchImpl = vi.fn();
      const context = {
        connection: { id: "gemini-conn-1", provider: "gemini", providerSpecificData: {} },
        fetchImpl,
        now: () => NOW,
      };

      const result = await fetchGeminiApiKeyQuota(context);
      expect(result).toMatchObject({
        outcome: "missing",
        sourceId: GEMINI_API_KEY_SOURCE_ID,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("preserves UNKNOWN state and creates no synthetic quota when an API key is present without an authoritative endpoint", async () => {
      const fetchImpl = vi.fn();
      const context = {
        connection: {
          id: "gemini-conn-2",
          provider: "gemini",
          apiKey: "AIzaSyFakeGeminiApiKey12345",
          providerSpecificData: {},
        },
        fetchImpl,
        now: () => NOW,
      };

      const result = await fetchGeminiApiKeyQuota(context);
      expect(result).toMatchObject({
        outcome: "unknown",
        reasonCode: "missing",
        sourceId: GEMINI_API_KEY_SOURCE_ID,
        rows: [],
      });
      // Verifies strict prohibition: no undocumented endpoint guessing or blind requests
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("normalizes bucket entries into canonical ratio quota rows when authoritative custom response is provided", () => {
      const payload = {
        buckets: [
          {
            modelId: "gemini-2.5-flash",
            displayName: "Gemini 2.5 Flash",
            remainingFraction: 0.75,
            resetTime: "2026-01-01T01:00:00.000Z",
          },
        ],
      };

      const rows = normalizeGeminiApiKeyQuota(payload, {
        accountKey: "project:h-abc1234",
        now: NOW,
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        accountKey: "project:h-abc1234",
        resourceKey: "model:gemini-2.5-flash",
        dimensionKey: "requests:quota",
        state: "available",
        amounts: {
          limitKind: "unknown",
          remainingRatio: 0.75,
        },
        resetAt: "2026-01-01T01:00:00.000Z",
      });
    });

    it("queries operator-configured quotaEndpoint over bounded HTTPS when provided", async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(
        jsonResponse({
          buckets: [
            {
              modelId: "gemini-pro",
              remainingFraction: 0.2,
              resetTime: "2026-01-01T02:00:00.000Z",
            },
          ],
        })
      );

      const context = {
        connection: {
          id: "gemini-custom",
          provider: "gemini",
          apiKey: "AIzaSyCustomKey",
          providerSpecificData: {
            quotaEndpoint: "https://custom-gcp-proxy.internal/quota",
          },
        },
        fetchImpl,
        proxyOptions: { strictProxy: true },
        signal: new AbortController().signal,
        now: () => NOW,
        timeoutMs: 5000,
        maxResponseBytes: 64 * 1024,
      };

      const result = await fetchGeminiApiKeyQuota(context);
      expect(result.outcome).toBe("success");
      expect(result.rows).toHaveLength(1);
      expect(fetchImpl).toHaveBeenCalledWith(
        "https://custom-gcp-proxy.internal/quota",
        expect.objectContaining({
          headers: expect.objectContaining({ "x-goog-api-key": "AIzaSyCustomKey" }),
        }),
        expect.any(Object)
      );
    });
  });

  describe("xAI quota adapter", () => {
    it("reports missing credential when no apiKey or managementApiKey is configured", async () => {
      const fetchImpl = vi.fn();
      const context = {
        connection: { id: "xai-conn-1", provider: "xai", providerSpecificData: {} },
        fetchImpl,
        now: () => NOW,
      };

      const result = await fetchXaiQuota(context);
      expect(result).toMatchObject({
        outcome: "missing",
        sourceId: XAI_QUOTA_SOURCE_ID,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("preserves UNKNOWN state and does not guess endpoints when only standard inference API key is present", async () => {
      const fetchImpl = vi.fn();
      const context = {
        connection: {
          id: "xai-conn-2",
          provider: "xai",
          apiKey: "xai-inference-secret-12345",
          providerSpecificData: {},
        },
        fetchImpl,
        now: () => NOW,
      };

      const result = await fetchXaiQuota(context);
      expect(result).toMatchObject({
        outcome: "unknown",
        reasonCode: "missing",
        sourceId: XAI_QUOTA_SOURCE_ID,
        rows: [],
      });
      // Verifies no calls made to api.x.ai for guessing non-existent balance endpoints
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("fetches authoritative prepaid credit balance from xAI Management API when teamId and managementApiKey are configured", async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(
        jsonResponse({
          balance: 85.5,
        })
      );

      const context = {
        connection: {
          id: "xai-team-conn",
          provider: "xai",
          apiKey: "xai-inference-key",
          providerSpecificData: {
            teamId: "team-42",
            managementApiKey: "xai-mgmt-key-999",
          },
        },
        fetchImpl,
        proxyOptions: { strictProxy: true },
        signal: new AbortController().signal,
        now: () => NOW,
        timeoutMs: 5000,
        maxResponseBytes: 64 * 1024,
      };

      const result = await fetchXaiQuota(context);
      expect(result).toMatchObject({
        outcome: "success",
        sourceId: XAI_QUOTA_SOURCE_ID,
      });
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        dimensionKey: "balance:usd",
        amounts: {
          remaining: 85.5,
          unit: "usd",
        },
        state: "available",
      });

      expect(fetchImpl).toHaveBeenCalledWith(
        `${XAI_MANAGEMENT_API_BASE_URL}/v1/billing/teams/team-42/prepaid/balance`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer xai-mgmt-key-999",
          }),
        }),
        expect.any(Object)
      );
    });

    it("correctly identifies exhausted balance when prepaid balance is zero", () => {
      const rows = normalizeXaiPrepaidBalance({ balance: 0.0 }, { accountKey: "account:h-test" });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        state: "exhausted",
        amounts: {
          remaining: 0,
        },
      });
    });

    it("handles structured balance object with custom currency", () => {
      const rows = normalizeXaiPrepaidBalance(
        { balance: { amount: 120.0, currency: "eur" } },
        { accountKey: "account:h-test" }
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        dimensionKey: "balance:eur",
        amounts: {
          remaining: 120.0,
          unit: "eur",
        },
      });
    });
  });
});
