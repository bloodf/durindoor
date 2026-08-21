import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
const routeDbMocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  getProxyPoolById: vi.fn(),
  updateProviderConnection: vi.fn(),
  deleteProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: dbMocks.getProviderConnections,
  updateProviderConnection: dbMocks.updateProviderConnection,
  getProviderConnectionById: vi.fn(),
  getApiKeyByKey: vi.fn(),
  validateApiKey: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  getQuotaReservationPressure: vi.fn(),
}));
vi.mock("@/models", () => routeDbMocks);
vi.mock("@/shared/services/quotaAutoPing", () => ({
  notifyQuotaAutoPingSettingChanged: vi.fn(),
}));
vi.mock("@/shared/services/providerRateLimitEvidence", () => ({
  recordProviderRateLimitEvidence: vi.fn(),
  clearProviderRateLimitEvidence: vi.fn(),
}));

const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
const { PUT } = await import("../../src/app/api/providers/[id]/route.js");
const { getConnectionErrorDisplay, replaceUpdatedConnections } = await import("../../src/shared/utils/connectionStatus.js");
const { mergeProviderConnection } = await import("../../src/lib/db/helpers/mergeProviderMetadata.js");

const MODEL = "qoder/ultimate";
const QODER_QUOTA_BODY = '{"code":"112","message":"Quota exhausted"}';
const QODER_QUOTA_ERROR_BODY = { error: { message: QODER_QUOTA_BODY, code: 403 } };
const AUTO_DISABLED_AT = "2026-08-21T12:00:00.000Z";

function putRequest(body) {
  return new Request("http://localhost/api/providers/qoder-a", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-21T12:00:00.000Z"));
  dbMocks.updateProviderConnection.mockResolvedValue({});
  routeDbMocks.getProviderConnectionById.mockResolvedValue({
    id: "qoder-a",
    provider: "qoder",
    authType: "apikey",
    isActive: false,
    lastError: "Qoder quota exhausted (code 112)",
    lastErrorAt: AUTO_DISABLED_AT,
    autoDisabledReason: "Qoder quota exhausted (code 112)",
    autoDisabledAt: AUTO_DISABLED_AT,
  });
  routeDbMocks.updateProviderConnection.mockImplementation(async (_id, patch) => (
    mergeProviderConnection(await routeDbMocks.getProviderConnectionById(), patch)
  ));
  dbMocks.getProviderConnections.mockResolvedValue([{
    id: "qoder-a",
    provider: "qoder",
    name: "qoder-a",
    backoffLevel: 2,
  }]);
});

afterEach(() => vi.useRealTimers());

// Pins the fork-side persistence half of decolua/9router#3331.
describe("Qoder quota exhaustion persistence", () => {
  it("permanently disables a genuine structured Qoder code 112 without a cooldown", async () => {
    const result = await markAccountUnavailable(
      "qoder-a",
      403,
      `[403]: ${QODER_QUOTA_BODY}`,
      "qoder",
      MODEL,
      null,
      { errorBody: QODER_QUOTA_ERROR_BODY },
    );

    expect(result).toEqual({ shouldFallback: true, cooldownMs: 0 });
    expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith(
      "qoder-a",
      expect.objectContaining({
        isActive: false,
        backoffLevel: 0,
        errorCode: 403,
        lastError: expect.stringContaining('"code":"112"'),
        lastErrorAt: "2026-08-21T12:00:00.000Z",
        autoDisabledReason: expect.stringContaining('"code":"112"'),
        autoDisabledAt: AUTO_DISABLED_AT,
      }),
    );
    const update = dbMocks.updateProviderConnection.mock.calls[0][1];
    expect(Object.keys(update).some((key) => key.startsWith("modelLock_"))).toBe(false);
  });

  it("recognizes a leading top-level Qoder code 112 when structured context is absent", async () => {
    const result = await markAccountUnavailable(
      "qoder-a",
      403,
      `[403]: ${QODER_QUOTA_BODY}`,
      "qoder",
      MODEL,
    );

    expect(result).toEqual({ shouldFallback: true, cooldownMs: 0 });
    expect(dbMocks.updateProviderConnection.mock.calls[0][1]).toHaveProperty("isActive", false);
  });

  it.each([
    ["Qoder code 10605", "qoder", '{"code":"10605","message":"Queue limit"}', { error: { message: '{"code":"10605","message":"Queue limit"}', code: 403 } }],
    ["Qoder pricing hint", "qoder", '{"pricingUrl":"https://qoder.com/pricing"}', { error: { message: '{"pricingUrl":"https://qoder.com/pricing"}', code: 403 } }],
    ["nested Qoder code 112", "qoder", '{"error":{"details":{"code":"112"}}}', { error: { details: { code: "112" } } }],
    ["echoed code 112 text", "qoder", 'Request echoed {"code":"112"}', { error: { message: 'Request echoed {"code":"112"}', code: 403 } }],
    ["non-Qoder code 112", "github", QODER_QUOTA_BODY, QODER_QUOTA_ERROR_BODY],
    ["numeric Qoder code 112", "qoder", '{"code":112,"message":"Quota exhausted"}', { error: { message: '{"code":112,"message":"Quota exhausted"}', code: 403 } }],
    ["spaced Qoder code 112", "qoder", '{"code":"112 ","message":"Quota exhausted"}', { error: { message: '{"code":"112 ","message":"Quota exhausted"}', code: 403 } }],
  ])("keeps %s on transient cooldown", async (_label, provider, body, errorBody) => {
    const result = await markAccountUnavailable(
      "qoder-a",
      403,
      `[403]: ${body}`,
      provider,
      MODEL,
      null,
      { errorBody },
    );

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
    const update = dbMocks.updateProviderConnection.mock.calls[0][1];
    expect(Object.keys(update).some((key) => key.startsWith("modelLock_"))).toBe(true);
    expect(update.backoffLevel).toBe(2);
    expect(update).not.toHaveProperty("isActive");
  });

  it("keeps Qoder code 112 transient when the status is not 403", async () => {
    const result = await markAccountUnavailable(
      "qoder-a",
      502,
      `[502]: ${QODER_QUOTA_BODY}`,
      "qoder",
      MODEL,
      null,
      { errorBody: QODER_QUOTA_ERROR_BODY },
    );

    expect(result.cooldownMs).toBeGreaterThan(0);
    const update = dbMocks.updateProviderConnection.mock.calls[0][1];
    expect(Object.keys(update).some((key) => key.startsWith("modelLock_"))).toBe(true);
    expect(update).not.toHaveProperty("isActive");
  });

  it("shows only a dedicated automatic-disable reason and formatted time on disabled rows", () => {
    const autoDisabled = getConnectionErrorDisplay({
      isActive: false,
      lastError: "stale generic failure",
      lastErrorAt: "2026-08-20T12:00:00.000Z",
      autoDisabledReason: "Qoder quota exhausted (code 112)",
      autoDisabledAt: AUTO_DISABLED_AT,
    });
    expect(autoDisabled).toEqual({
      reason: "Qoder quota exhausted (code 112)",
      time: new Date(AUTO_DISABLED_AT).toLocaleString(),
    });

    expect(getConnectionErrorDisplay({
      isActive: false,
      lastError: "stale generic failure",
      lastErrorAt: "2026-08-20T12:00:00.000Z",
    })).toBeNull();

    expect(getConnectionErrorDisplay({
      isActive: true,
      lastError: "ordinary active failure",
      lastErrorAt: "2026-08-20T12:00:00.000Z",
    })).toEqual({ reason: "ordinary active failure", time: null });
  });

  it("clears automatic-disable metadata when an API client re-enables the connection", async () => {
    const response = await PUT(putRequest({ isActive: true }), {
      params: Promise.resolve({ id: "qoder-a" }),
    });
    const { connection } = await response.json();

    expect(response.status).toBe(200);
    expect(routeDbMocks.updateProviderConnection).toHaveBeenCalledWith("qoder-a", {
      isActive: true,
    });
    expect(connection).toMatchObject({
      isActive: true,
      testStatus: null,
      lastError: null,
      errorCode: null,
      lastErrorAt: null,
      autoDisabledReason: null,
      autoDisabledAt: null,
    });
  });

  it("preserves automatic-disable and ordinary error history on unrelated API updates", async () => {
    await PUT(putRequest({ name: "renamed" }), {
      params: Promise.resolve({ id: "qoder-a" }),
    });

    expect(routeDbMocks.updateProviderConnection).toHaveBeenCalledWith("qoder-a", {
      name: "renamed",
    });
  });

  it("normalizes automatic-disable lifecycle only at an inactive-to-active transition", () => {
    const autoDisabled = {
      id: "qoder-a",
      isActive: false,
      testStatus: "unavailable",
      lastError: "Qoder quota exhausted (code 112)",
      errorCode: 403,
      lastErrorAt: AUTO_DISABLED_AT,
      autoDisabledReason: "Qoder quota exhausted (code 112)",
      autoDisabledAt: AUTO_DISABLED_AT,
    };

    expect(mergeProviderConnection(autoDisabled, { isActive: true })).toMatchObject({
      isActive: true,
      testStatus: null,
      lastError: null,
      errorCode: null,
      lastErrorAt: null,
      autoDisabledReason: null,
      autoDisabledAt: null,
    });
    expect(mergeProviderConnection(autoDisabled, { name: "renamed" })).toMatchObject({
      name: "renamed",
      lastError: autoDisabled.lastError,
      autoDisabledReason: autoDisabled.autoDisabledReason,
      autoDisabledAt: autoDisabled.autoDisabledAt,
    });

    const activeOrdinaryError = {
      id: "active",
      isActive: true,
      lastError: "ordinary active failure",
      lastErrorAt: "2026-08-20T12:00:00.000Z",
    };
    expect(mergeProviderConnection(activeOrdinaryError, { isActive: true })).toMatchObject(activeOrdinaryError);
  });

  it("replaces dashboard rows with the cleared PUT response for single and bulk toggles", () => {
    const stale = {
      id: "qoder-a",
      isActive: false,
      lastError: "Qoder quota exhausted (code 112)",
      lastErrorAt: AUTO_DISABLED_AT,
      autoDisabledReason: "Qoder quota exhausted (code 112)",
      autoDisabledAt: AUTO_DISABLED_AT,
    };
    const cleared = mergeProviderConnection(stale, { isActive: true });

    const single = replaceUpdatedConnections([stale], [cleared]);
    expect(single[0]).toEqual(cleared);
    expect(getConnectionErrorDisplay(single[0])).toBeNull();
    expect(getConnectionErrorDisplay({ ...single[0], isActive: false })).toBeNull();

    const untouched = { id: "other", isActive: false, lastError: "ordinary history" };
    const bulk = replaceUpdatedConnections([stale, untouched], [cleared]);
    expect(bulk).toEqual([cleared, untouched]);
    expect(getConnectionErrorDisplay(bulk[0])).toBeNull();
  });
});
