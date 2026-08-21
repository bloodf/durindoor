import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  testProxyUrl: vi.fn(),
  getProviderNodeById: vi.fn(),
  proxyAwareFetch: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl: mocks.testProxyUrl }));
vi.mock("@/models", () => ({ getProviderNodeById: mocks.getProviderNodeById }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

import { PROVIDERS } from "../../open-sse/providers/index.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { POST } from "../../src/app/api/providers/validate/route.js";
import {
  __setProviderTestFetchForTesting,
  testSingleConnection,
} from "../../src/app/api/providers/[id]/test/testUtils.js";

const originalFetch = global.fetch;
const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const SPENT = '{"error":{"type":"CreditsError","message":"Insufficient balance."}}';
const INVALID = '{"error":{"type":"AuthError","message":"Invalid API key."}}';

function jsonResponse(body, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function validateRequest(provider, apiKey) {
  return new Request("http://localhost/api/providers/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, ...(apiKey ? { apiKey } : {}) }),
  });
}

async function validateBoth(body, status = 401) {
  const routeFetch = vi.fn().mockResolvedValueOnce(jsonResponse(body, status));
  const connectionFetch = vi.fn().mockResolvedValueOnce(jsonResponse(body, status));
  global.fetch = routeFetch;
  const restore = __setProviderTestFetchForTesting(connectionFetch);
  try {
    const routeResult = await (await POST(validateRequest("opencode-go", "sk-test"))).json();
    const connectionResult = await testSingleConnection("opencode-go-connection");
    return { routeResult, connectionResult, routeFetch, connectionFetch };
  } finally {
    restore();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  mocks.testProxyUrl.mockResolvedValue({ ok: true });
  mocks.updateProviderConnection.mockResolvedValue(undefined);
  mocks.getProviderConnectionById.mockResolvedValue({
    id: "opencode-go-connection",
    provider: "opencode-go",
    authType: "apikey",
    apiKey: "sk-test",
    providerSpecificData: {},
  });
});

afterEach(() => {
  global.fetch = originalFetch;
  __setProviderTestFetchForTesting(null);
});

describe("OpenCode Go usage", () => {
  it("maps authenticated used-percent windows to dashboard quotas", async () => {
    mocks.proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      usage: {
        rolling: { status: "ok", percent: 35, resetsAt: "2026-08-21T10:00:00.000Z" },
        monthly: { status: "rate-limited", percent: 100, resetsAt: "2026-08-22T10:00:00.000Z" },
      },
    }));

    const result = await getUsageForProvider({ provider: "opencode-go", apiKey: "sk-test" });

    expect(PROVIDERS["opencode-go"].usage.url).toBe(USAGE_URL);
    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      USAGE_URL,
      expect.objectContaining({
        headers: { Authorization: "Bearer sk-test", Accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
      null,
    );
    expect(result.plan).toBe("OpenCode Go");
    expect(result.limitReached).toBe(true);
    expect(result.quotas.Rolling.used).toBe(35);
    expect(result.quotas.Rolling.total).toBe(100);
    expect(result.quotas.Rolling.remainingPercentage).toBe(65);
    expect(result.quotas.Rolling.resetAt).toBe("2026-08-21T10:00:00.000Z");
    expect(result.quotas.Rolling.unlimited).toBe(false);
    expect(result.quotas.Monthly.used).toBe(100);
    expect(result.quotas.Monthly.total).toBe(100);
    expect(result.quotas.Monthly.remainingPercentage).toBe(0);
    expect(result.quotas.Monthly.resetAt).toBe("2026-08-22T10:00:00.000Z");
    expect(result.quotas.Monthly.unlimited).toBe(false);
  });

  it("accepts an authenticated key whose credits are exhausted in both validators", async () => {
    const { routeResult, connectionResult, routeFetch, connectionFetch } = await validateBoth(SPENT);

    expect(routeResult).toEqual({ valid: true, error: null });
    expect(connectionResult.valid).toBe(true);
    expect(connectionResult.error).toBeNull();
    expect(routeFetch).toHaveBeenCalledWith(USAGE_URL, expect.objectContaining({
      headers: { Authorization: "Bearer sk-test", Accept: "application/json" },
      redirect: "manual",
    }));
    expect(connectionFetch).toHaveBeenCalledWith(
      USAGE_URL,
      expect.objectContaining({
        headers: { Authorization: "Bearer sk-test", Accept: "application/json" },
        redirect: "manual",
      }),
      {},
    );
    expect(routeFetch.mock.calls[0][1].method ?? "GET").toBe("GET");
    expect(connectionFetch.mock.calls[0][1].method ?? "GET").toBe("GET");
  });

  it("distinguishes invalid authentication from transient upstream failure in both validators", async () => {
    const invalid = await validateBoth(INVALID);

    expect(invalid.routeResult).toEqual({ valid: false, error: "Invalid API key" });
    expect(invalid.connectionResult.valid).toBe(false);
    expect(invalid.connectionResult.error).toBe("Invalid API key");

    const transient = await validateBoth({}, 503);
    expect(transient.routeResult).toEqual({ valid: false, error: "Provider unavailable - try again later" });
    expect(transient.connectionResult.valid).toBe(false);
    expect(transient.connectionResult.error).toBe("Provider unavailable - try again later");
  });

  it("keeps keyless opencode valid without probing OpenCode Go usage", async () => {
    global.fetch = vi.fn();

    const result = await (await POST(validateRequest("opencode"))).json();

    expect(PROVIDERS.opencode.noAuth).toBe(true);
    expect(result).toEqual({ valid: true, error: null });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
  });
});
