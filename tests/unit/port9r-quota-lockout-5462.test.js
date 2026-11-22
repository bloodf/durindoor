import { describe, expect, it } from "vitest";
import { detectQuotaExhaustion, filterAvailableAccounts, isQuotaLockoutActive } from "../../open-sse/services/accountFallback.js";

describe("account quota lockout", () => {
  it("only detects quota wording in error messages, not echoed request fields", () => {
    expect(detectQuotaExhaustion({ error: { message: "quota exceeded", reset_at: "2099-01-01T00:00:00Z" } })).toEqual({ exhausted: true, resetAtMs: Date.parse("2099-01-01T00:00:00Z") });
    expect(detectQuotaExhaustion(JSON.stringify({ error: { message: "bad request" }, request: "quota exceeded" })).exhausted).toBe(false);
    expect(detectQuotaExhaustion("rate limit, slow down").exhausted).toBe(false);
  });
  it("excludes indefinite and future locks, and restores expired locks", () => {
    const accounts = [
      { id: "indefinite", quotaLockout: { status: "quota_exhausted", reactivateAt: null } },
      { id: "future", quotaLockout: { status: "quota_exhausted", reactivateAt: "2099-01-01T00:00:00Z" } },
      { id: "expired", quotaLockout: { status: "quota_exhausted", reactivateAt: "2020-01-01T00:00:00Z" } },
    ];
    expect(isQuotaLockoutActive(accounts[0])).toBe(true);
    expect(filterAvailableAccounts(accounts).map((account) => account.id)).toEqual(["expired"]);
  });
});

import { vi } from "vitest";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(), saveRequestDetail: vi.fn(), saveRequestUsage: vi.fn() }));

it("returns 429 for an HTTP 200 quota error without marking the request successful", async () => {
  const onRequestSuccess = vi.fn();
  const result = await handleNonStreamingResponse({
    providerResponse: new Response(JSON.stringify({ error: { message: "quota exceeded", reset_at: "2099-01-01T00:00:00Z" } }), { status: 200, headers: { "content-type": "application/json" } }),
    provider: "openai", model: "test", sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI,
    body: { model: "test", messages: [] }, stream: false, streamToClient: false,
    requestStartTime: Date.now(), reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    trackDone: vi.fn(), appendLog: vi.fn(), onRequestSuccess,
  });
  expect(result.status).toBe(429);
  expect(result.resetsAtMs).toBe(Date.parse("2099-01-01T00:00:00Z"));
  expect(onRequestSuccess).not.toHaveBeenCalled();
});

const db = vi.hoisted(() => ({ getProviderConnections: vi.fn(), getSettings: vi.fn(), updateProviderConnection: vi.fn(), validateApiKey: vi.fn(), getProxyPools: vi.fn(), getQuotaReservationPressure: vi.fn() }));
vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})), pickProxyPoolId: vi.fn() }));
const { getProviderCredentials, markAccountUnavailable } = await import("../../src/sse/services/auth.js");

it.each(["fill-first", "round-robin"])("excludes locked accounts for %s", async (strategy) => {
  const locked = { id: "locked", provider: "kiro", authType: "oauth", accessToken: "locked", isActive: true, priority: 1, quotaLockout: { status: "quota_exhausted", reactivateAt: null }, providerSpecificData: {} };
  const available = { id: "available", provider: "kiro", authType: "oauth", accessToken: "available", isActive: true, priority: 2, providerSpecificData: {} };
  db.getProviderConnections.mockResolvedValue([locked, available]);
  db.getSettings.mockResolvedValue({ routingStrategy: strategy, providerRoutingStrategies: { kiro: { strategy } } });
  db.updateProviderConnection.mockResolvedValue(available);
  expect((await getProviderCredentials("kiro", null, "model")).connectionId).toBe("available");
});

it("preserves a concurrent manual schedule when an automatic lock is written", async () => {
  const old = { id: "a", provider: "kiro", accessToken: "key", updatedAt: "2020-01-01T00:00:00Z" };
  db.getProviderConnections.mockResolvedValue([old]);
  db.updateProviderConnection.mockImplementation(async (_id, patch, options) => {
    const current = { ...old, quotaLockout: { status: "quota_exhausted", source: "manual", reactivateAt: null } };
    expect(options.shouldCommitConnection(current)).toBe(false);
    expect(patch.quotaLockout.source).toBe("auto");
  });
  await markAccountUnavailable("a", 429, "quota exceeded", "kiro");
});

it("detects a quota error in a buffered event-stream before returning a response", async () => {
  const result = await handleNonStreamingResponse({
    providerResponse: new Response('data: {"error":{"message":"quota exceeded"}}\n\ndata: [DONE]\n\n', { status: 200, headers: { "content-type": "text/event-stream" } }),
    provider: "openai", model: "test", sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI,
    body: { model: "test", messages: [] }, stream: false, streamToClient: false,
    requestStartTime: Date.now(), reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() }, trackDone: vi.fn(), appendLog: vi.fn(),
  });
  expect(result.status).toBe(429);
});
