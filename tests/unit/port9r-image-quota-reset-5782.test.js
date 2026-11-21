import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ credentials: vi.fn(), mark: vi.fn(), usage: vi.fn() }));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentialsWithQuotaPreflight: m.credentials,
  getNoAuthProviderCredentials: vi.fn(), markAccountUnavailable: m.mark, clearAccountError: vi.fn(),
  resolveClientApiKey: async () => ({ apiKey: null, auth: { ok: true, apiKeyId: null, billingEpoch: null } })
}));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({}), getApiKeyByKey: vi.fn(), getComboForModel: vi.fn() }));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: async () => ({ provider: "codex", model: "gpt-6-sol-image" }),
  getComboModels: async () => null, getComboCanonicalName: async () => null
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_p, c) => c, updateProviderCredentials: vi.fn() }));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: async () => null, recordApiKeyUsageForResponse: m.usage, recordApiKeyUsage: vi.fn()
}));
vi.mock("../../src/sse/utils/requestCorrelation.js", () => ({ captureRequestBillingEpoch: async () => {}, getRequestId: () => "fixture", withRequestCorrelation: (fn) => fn }));
vi.mock("../../src/sse/services/mediaRoutes.js", () => ({ wantsDefaultRoute: () => false, resolveMediaRoute: vi.fn(), defaultRouteComboOptions: () => ({}) }));
vi.mock("../../open-sse/services/comboRoutingPolicy.js", () => ({ getComboRoutingPolicy: vi.fn() }));

import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import { handleImageGeneration } from "../../src/sse/handlers/imageGeneration.js";

const now = 1800000000000;
const core = () => handleImageGenerationCore({ body: { prompt: "fixture" }, modelInfo: { provider: "codex", model: "gpt-6-sol-image" }, credentials: { accessToken: "fixture" } });
const failure = (error) => Response.json({ error }, { status: 429 });
const request = () => new Request("http://localhost/v1/images/generations", { method: "POST", body: JSON.stringify({ model: "codex/gpt-6-sol-image", prompt: "fixture" }) });

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  vi.stubGlobal("fetch", vi.fn());
  m.credentials.mockReset(); m.mark.mockReset(); m.usage.mockReset();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("pinned image quota reset port", () => {
  it.each([
    [{ resets_at: now / 1000 + 600 }, now + 600000],
    [{ resets_in_seconds: 600 }, now + 600000]
  ])("retains a bounded Codex reset %#", async (fields, expected) => {
    fetch.mockResolvedValueOnce(failure({ type: "usage_limit_reached", ...fields }));
    const result = await core();
    expect(result.rateLimitEvidence).toMatchObject({ state: "exhausted", resetAtMs: expected });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    { type: "usage_limit_reached" },
    { type: "usage_limit_reached", resets_in_seconds: 999999999 },
    { type: "rate_limit_exceeded", resets_at: now / 1000 + 600 }
  ])("keeps ordinary fallback when exhaustion and a bounded reset are not both proven %#", async (error) => {
    fetch.mockResolvedValueOnce(failure(error));
    const result = await core();
    expect(result.rateLimitEvidence).toBeUndefined();
    expect(result.resetsAtMs).toBeUndefined();
  });
  it("locks only the failed account and model, then charges the successful fallback once", async () => {
    m.credentials.mockResolvedValueOnce({ connectionId: "a", accessToken: "fixture-a" }).mockResolvedValueOnce({ connectionId: "b", accessToken: "fixture-b" });
    m.mark.mockResolvedValue({ shouldFallback: true });
    m.usage.mockImplementation(async (_key, response) => response);
    fetch.mockResolvedValueOnce(failure({ type: "usage_limit_reached", resets_in_seconds: 600 }))
      .mockResolvedValueOnce(new Response('event: response.completed\ndata: {"response":{"status":"completed","output":[{"type":"image_generation_call","result":"eA=="}]}}\n\n', { headers: { "content-type": "text/event-stream" } }));
    const response = await handleImageGeneration(request());
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(m.mark).toHaveBeenCalledTimes(1);
    expect(m.mark.mock.calls[0]).toMatchObject({ 0: "a", 1: 429, 3: "codex", 4: "gpt-6-sol-image", 5: now + 600000, 6: { rateLimitEvidence: { state: "exhausted", resetAtMs: now + 600000 }, usedCredential: "fixture-a" } });
    expect(m.credentials.mock.calls[1][1]).toEqual(new Set(["a"]));
    expect(m.usage).toHaveBeenCalledTimes(1);
  });

  // The selector summary describes the accounts that were already unavailable
  // before this request; the attempted account proves its own bounded reset.
  // Both describe the same requested image route, so the earliest valid
  // deadline is the honest retry time.
  it("keeps the earliest valid retry hint across the selector summary and an attempted account", async () => {
    m.credentials.mockResolvedValueOnce({ connectionId: "a", accessToken: "fixture-a" })
      .mockResolvedValueOnce({
        allRateLimited: true,
        lastError: "Rate limited",
        lastErrorCode: 429,
        // The account that was already unavailable before this request.
        retryAfter: new Date(now + 1200000).toISOString(),
        retryAfterHuman: "reset after 20m"
      });
    m.mark.mockResolvedValue({ shouldFallback: true, retryAt: new Date(now + 600000).toISOString(), retryAtKnown: true });
    fetch.mockResolvedValueOnce(failure({ type: "usage_limit_reached", resets_in_seconds: 600 }));
    const response = await handleImageGeneration(request());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("600");
    const body = await response.json();
    expect(body.error.retry_after).toBe(new Date(now + 600000).toISOString());
    expect(body.error.message).toContain("reset after 10m");
    expect(m.usage).not.toHaveBeenCalled();
  });

  it("keeps the selector summary unchanged when no account was attempted", async () => {
    m.credentials.mockResolvedValue({
      allRateLimited: true,
      lastError: "Rate limited",
      lastErrorCode: 429,
      retryAfter: new Date(now + 1200000).toISOString(),
      retryAfterHuman: "reset after 20m"
    });
    const response = await handleImageGeneration(request());
    expect(fetch).not.toHaveBeenCalled();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1200");
    const body = await response.json();
    expect(body.error.retry_after).toBe(new Date(now + 1200000).toISOString());
    expect(body.error.message).toContain("reset after 20m");
    expect(m.usage).not.toHaveBeenCalled();
  });

  it("invents no retry hint when the selector summary is not a route rate limit", async () => {
    m.credentials.mockResolvedValueOnce({ connectionId: "a", accessToken: "fixture-a" })
      .mockResolvedValueOnce({
        allRateLimited: true,
        modelDisabled: true,
        lastError: "Model 'codex/gpt-6-sol-image' is disabled.",
        lastErrorCode: 403
      });
    m.mark.mockResolvedValue({ shouldFallback: true, retryAt: new Date(now + 600000).toISOString(), retryAtKnown: true });
    fetch.mockResolvedValueOnce(failure({ type: "usage_limit_reached", resets_in_seconds: 600 }));
    const response = await handleImageGeneration(request());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeNull();
    expect((await response.json()).error.retry_after).toBeUndefined();
    expect(m.usage).not.toHaveBeenCalled();
  });
});

// Private fixture: the real local health policy and SQLite store in a throwaway
// data directory. Only the provider responses (fetch) and quota refresh are fake.
describe("real health policy keeps image quota evidence scoped", () => {
  const MODEL = "gpt-6-sol-image";
  const exhausted = (seconds) => failure({ type: "usage_limit_reached", resets_in_seconds: seconds });
  const success = () => new Response('event: response.completed\ndata: {"response":{"status":"completed","output":[{"type":"image_generation_call","result":"eA=="}]}}\n\n', { headers: { "content-type": "text/event-stream" } });
  let dir; let db; let handler; let auth; let previousDataDir; let refresh;

  const connection = (name) => db.createProviderConnection({ provider: "codex", authType: "oauth", email: `${name}@fixture.invalid`, name, accessToken: `fixture-${name}`, refreshToken: `fixture-rt-${name}`, isActive: true, testStatus: "active", providerSpecificData: { chatgptAccountId: `fixture-${name}` } });
  const resources = async (id) => (await db.listProviderQuotaSnapshots({ connectionId: id, includeStale: true, now })).filter((s) => s.provenance?.sourceType === "response_headers").map((s) => ({ key: s.identity.resourceKey, state: s.state }));

  beforeEach(async () => {
    previousDataDir = process.env.DATA_DIR;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-image-quota-"));
    process.env.DATA_DIR = dir;
    delete global._dbAdapter;
    vi.resetModules();
    vi.doUnmock("../../src/sse/services/auth.js");
    vi.doUnmock("@/lib/localDb");
    refresh = vi.fn(async () => ({ refreshed: false }));
    vi.doMock("@/shared/services/providerQuotaTracker", () => ({ refreshProviderQuota: refresh }));
    db = await import("../../src/lib/db/index.js");
    await db.initDb();
    db = await import("@/lib/localDb");
    auth = await import("../../src/sse/services/auth.js");
    handler = (await import("../../src/sse/handlers/imageGeneration.js")).handleImageGeneration;
    // Importing the runtime may wrap the global fetch; the provider stays fake.
    vi.stubGlobal("fetch", vi.fn());
    m.usage.mockImplementation(async (_key, response) => response);
  });
  afterEach(() => {
    try { global._dbAdapter?.instance?.close?.(); } catch { /* fixture teardown */ }
    delete global._dbAdapter;
    if (previousDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousDataDir;
    fs.rmSync(dir, { recursive: true, force: true });
    vi.doUnmock("@/shared/services/providerQuotaTracker");
  });

  it("persists classified image exhaustion on the failed model only and keeps other models available", async () => {
    const a = await connection("a");
    fetch.mockResolvedValueOnce(exhausted(600));
    const response = await handler(request());
    expect(response.status).toBe(429);

    expect(await resources(a.id)).toEqual([{ key: `model:${MODEL}`, state: "exhausted" }]);
    const row = await db.getProviderConnectionById(a.id);
    expect(row[`modelLock_${MODEL}`]).toBeTruthy();
    expect(row.modelLock___all).toBeUndefined();
    // Chat and other image models on the same account stay selectable.
    for (const other of ["gpt-5.4", "gpt-image-2.5"]) {
      const picked = await auth.getProviderCredentialsWithQuotaPreflight("codex", null, other);
      expect(picked?.connectionId).toBe(a.id);
    }
    expect(refresh).not.toHaveBeenCalledWith(expect.objectContaining({ resourceKey: "scope:account" }));
  });

  it("keeps explicit account-wide exhaustion on ordinary Codex chat paths", async () => {
    const a = await connection("a");
    await auth.markAccountUnavailable(a.id, 429, JSON.stringify({ error: { type: "usage_limit_reached", resets_in_seconds: 600 } }), "codex", "gpt-5.4", now + 600000, {
      rateLimitEvidence: { state: "exhausted", resetAtMs: now + 600000 }
    });
    expect(await resources(a.id)).toEqual([{ key: "scope:account", state: "exhausted" }]);
    const picked = await auth.getProviderCredentialsWithQuotaPreflight("codex", null, MODEL);
    expect(picked?.connectionId).not.toBe(a.id);
  });

  it("preserves the bounded retry delay on the final 429 after every account is exhausted", async () => {
    const a = await connection("a"); const b = await connection("b");
    fetch.mockResolvedValueOnce(exhausted(900)).mockResolvedValueOnce(exhausted(300));
    const response = await handler(request());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("300");
    expect((await response.json()).error.retry_after).toBe(new Date(now + 300000).toISOString());
    expect(m.usage).not.toHaveBeenCalled();
    expect((await resources(a.id))[0].key).toBe(`model:${MODEL}`);
    expect((await resources(b.id))[0].key).toBe(`model:${MODEL}`);
  });

  it("adds no delay to ordinary 429s once failover is exhausted", async () => {
    await connection("a"); await connection("b");
    fetch.mockResolvedValueOnce(failure({ type: "rate_limit_exceeded" })).mockResolvedValueOnce(failure({ type: "rate_limit_exceeded" }));
    const ordinary = await handler(request());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(ordinary.status).toBe(429);
    expect(ordinary.headers.get("retry-after")).toBeNull();
  });

  it("keeps a successful fallback and its single charge unchanged", async () => {
    const a = await connection("a"); await connection("b");
    fetch.mockResolvedValueOnce(exhausted(600)).mockResolvedValueOnce(success());
    const ok = await handler(request());
    expect(ok.status).toBe(200);
    expect(ok.headers.get("retry-after")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(m.usage).toHaveBeenCalledTimes(1);
    expect(await resources(a.id)).toEqual([{ key: `model:${MODEL}`, state: "exhausted" }]);
  });
});
