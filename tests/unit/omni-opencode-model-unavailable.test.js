import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkFallbackError, isModelLockActive } from "../../open-sse/services/accountFallback.js";
import { setOperatorProviderErrorRules } from "../../open-sse/config/providerErrorRules.js";

const mocks = vi.hoisted(() => ({ getProviderConnections: vi.fn(), updateProviderConnection: vi.fn(), getSettings: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections, updateProviderConnection: mocks.updateProviderConnection,
  getProviderConnectionById: vi.fn(), getApiKeyByKey: vi.fn(), validateApiKey: vi.fn(),
  getSettings: mocks.getSettings, getProxyPools: vi.fn(), getQuotaReservationPressure: vi.fn(),
}));
vi.mock("@/shared/services/providerRateLimitEvidence", () => ({ recordProviderRateLimitEvidence: mocks.record, clearProviderRateLimitEvidence: vi.fn() }));
const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
const NOW = 1_800_000_000_000;
const body = { error: { message: "Upstream request failed: Endpoint is unavailable." } };
const text = JSON.stringify(body);
const cases = [["opencode", "x-preview-f-free"], ["opencode-zen", "big-pickle"], ["opencode-go", "mimo-v2.5"]];

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  mocks.getProviderConnections.mockResolvedValue([{ id: "account-1", backoffLevel: 0 }]);
  mocks.updateProviderConnection.mockResolvedValue({});
  mocks.getSettings.mockResolvedValue({ retryDelayByProvider: {} });
  mocks.record.mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); setOperatorProviderErrorRules(null); });

async function mark(provider, model, status = 429, reset = null, context = {}) {
  const result = await markAccountUnavailable("account-1", status, text, provider, model, reset, { attemptStartedAt: NOW, errorBody: body, ...context });
  return { result, update: mocks.updateProviderConnection.mock.calls.at(-1)?.[1] };
}

describe("OpenCode endpoint unavailable", () => {
  it.each(cases.flatMap(([p, m]) => [400, 429].map((s) => [p, m, s])))("locks only catalog model %s/%s on %i", async (provider, model, status) => {
    expect(checkFallbackError(status, text, 0, provider, null, body)).toMatchObject({ shouldFallback: true, scope: "model", cooldownMs: 300_000 });
    const { result, update } = await mark(provider, model, status);
    const effectiveCooldown = provider === "opencode" ? 60_000 : 300_000;
    expect(result.cooldownMs).toBe(effectiveCooldown);
    expect(Date.parse(update[`modelLock_${model}`])).toBe(NOW + effectiveCooldown);
    expect(update).not.toHaveProperty("modelLock___all");
    expect(isModelLockActive(update, model)).toBe(true);
    expect(isModelLockActive(update, "another-model")).toBe(false);
  });
  it("bounds unknown model keys to the account scope", async () => {
    const { update } = await mark("opencode-go", "unknown-model");
    expect(update).toHaveProperty("modelLock___all");
    expect(update).not.toHaveProperty("modelLock_unknown-model");
  });
  it("preserves configured retry delay and authoritative reset precedence", async () => {
    mocks.getSettings.mockResolvedValue({ retryDelayByProvider: { "opencode-go": 120 } });
    expect((await mark("opencode-go", "mimo-v2.5")).result.cooldownMs).toBe(120_000);
    expect((await mark("opencode-go", "mimo-v2.5", 429, NOW + 420_000)).result.cooldownMs).toBe(420_000);
  });
  it("retains caller account-wide exhaustion evidence", async () => {
    const { update } = await mark("opencode-go", "mimo-v2.5", 429, null, { rateLimitEvidence: { state: "exhausted", resetAtMs: NOW + 600_000 } });
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ state: "exhausted", resetAtMs: NOW + 600_000 }));
    expect(update).toBeDefined();
  });
  it("honors operator rules", () => {
    setOperatorProviderErrorRules({ "opencode-go": [{ status: 429, match: "endpoint is unavailable", scope: "connection", reason: "custom", cooldownMs: 12_000 }] });
    expect(checkFallbackError(429, text, 0, "opencode-go", null, body)).toMatchObject({ scope: "connection", cooldownMs: 12_000 });
  });
  it("preserves billing and generic responses and ignores other providers", () => {
    const billing = { error: { message: "Endpoint is unavailable. Insufficient credits" } };
    expect(checkFallbackError(400, JSON.stringify(billing), 0, "opencode-go", null, billing).terminal).toBe(true);
    for (const status of [400, 429, 503]) {
      expect(checkFallbackError(status, text, 0, "other", null, body).scope).toBeNull();
      expect(checkFallbackError(status, "ordinary failure", 0, "opencode-go", null, { error: { message: "ordinary failure" } }).scope).toBeNull();
    }
    expect(checkFallbackError(503, text, 0, "opencode-go", null, body).scope).toBeNull();
  });
});
