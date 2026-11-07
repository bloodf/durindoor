import { beforeEach, describe, expect, it, vi } from "vitest";
import { quotaIdentityKey } from "../../src/shared/utils/quotaSnapshot.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

vi.mock("open-sse/index.js", () => ({}), { virtual: true });

const mocks = vi.hoisted(() => ({
  retrySleep: vi.fn(async () => {}),
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
  execute: vi.fn(),
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
  getApiKeyByKey: vi.fn(),
  getApiKeyUsageLimitStatus: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  getProviderCredentials: vi.fn(),
  projectProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  evaluateApiKeyAuth: vi.fn(),
  handleChatCore: vi.fn(),
  refreshAndUpdateCredentials: vi.fn(),
  refreshProviderQuota: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  getProviderConnectionById: vi.fn(), getProxyPools: async () => [],
  getQuotaReservationPressure: async () => null,
  getApiKeyProviderConnectionIds: async () => [],
  listProviderQuotaSnapshots: async () => [], getQuotaFetchState: async () => null,
  validateApiKey: vi.fn(),
  getSettings: mocks.getSettings,
  getApiKeyByKey: mocks.getApiKeyByKey,
  getApiKeyUsageLimitStatus: mocks.getApiKeyUsageLimitStatus,
}));

vi.mock("../../src/sse/services/model.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getComboModels: mocks.getComboModels,
  getModelInfo: mocks.getModelInfo,
  loadCustomCapabilities: async () => null,
}));

vi.mock("../../src/sse/services/auth.js", async (importOriginal) => ({
  ...(await importOriginal()),
  markAccountUnavailable: mocks.markAccountUnavailable,
  extractApiKey: vi.fn(() => null),
  evaluateApiKeyAuth: mocks.evaluateApiKeyAuth,
  resolveClientApiKey: async () => ({ apiKey: null, auth: { ok: true, stored: false } }),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig, pickProxyPoolId: () => null,
}));
vi.mock("@/shared/services/providerRateLimitEvidence", () => ({
  clearProviderRateLimitEvidence: async () => {}, recordProviderRateLimitEvidence: vi.fn(),
}));

vi.mock("@/shared/services/providerCredentials", () => ({
  refreshAndUpdateCredentials: mocks.refreshAndUpdateCredentials,
}));

vi.mock("@/shared/services/providerQuotaTracker", () => ({
  refreshProviderQuota: mocks.refreshProviderQuota,
}));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
}));

// Keep the real core/admission path, but fail before any external dispatch.
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: false, execute: mocks.execute }),
}));

vi.mock("../../open-sse/handlers/chatCore.js", () => ({
  handleChatCore: mocks.handleChatCore,
}));

vi.mock("../../open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: vi.fn(),
}));

vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: vi.fn(async () => null),
}));


const { handleChat, rankComboModelsByQuota, __resetAntigravity429StrikesForTests } = await import("../../src/sse/handlers/chat.js");


import { globalCircuitManager } from "../../src/lib/routing/connectionCircuitState.js";
import { getProviderCredentials } from "../../src/sse/services/auth.js";
import { acquireSlot, releaseSlot, _resetGates, getGateStats } from "../../open-sse/services/concurrencyGate.js";
import { resetPayloadAdmission } from "../../open-sse/services/payloadAdmission.js";
import "../translator/registerAll.js";

// Exercise the real outer retry policy while observing any backoff directly.
vi.mock("../../open-sse/services/transientBackendRetry.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runWithTransientBackendRetry: (action, options) =>
    actual.runWithTransientBackendRetry(action, { ...options, sleep: mocks.retrySleep }) };
});

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({ logClientRawRequest: vi.fn(), logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(), logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn() }),
}));

let row;
function request(model = "gpt-5.4", pinned = false) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST", headers: { "content-type": "application/json", ...(pinned ? { "x-connection-id": row.id } : {}) },
    body: JSON.stringify({ model: `codex/${model}`, stream: true, messages: [{ role: "user", content: "hi" }] }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveConnectionProxyConfig.mockReset().mockResolvedValue({});
  globalCircuitManager.reset("recovery-caller-account");
  _resetGates(); resetPayloadAdmission();
  row = { id: "recovery-caller-account", provider: "codex", authType: "apikey", apiKey: "fixture-only", isActive: true,
    "modelLock_gpt-5.4": new Date(Date.now() - 1000).toISOString() };
  mocks.getProviderConnections.mockImplementation(async () => [structuredClone(row)]);
  mocks.updateProviderConnection.mockImplementation(async (_id, patch) => { Object.assign(row, patch); return structuredClone(row); });
  mocks.getSettings.mockResolvedValue({ requireApiKey: false });
  mocks.getApiKeyByKey.mockResolvedValue(null);
  mocks.getApiKeyUsageLimitStatus.mockResolvedValue({ exceeded: false });
  mocks.getComboModels.mockResolvedValue(null);
  mocks.getModelInfo.mockImplementation(async (name) => ({ provider: "codex", model: name.split("/").at(-1) }));
  mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 2000 });
});

describe("real chat recovery selection", () => {
  it.each([false, true])("returns selection-busy once without outer reselection, sleep or dispatch, pinned=%s", async (pinned) => {
    const lease = globalCircuitManager.acquireRecoveryLease(row.id, "gpt-5.4", row["modelLock_gpt-5.4"]);
    expect(lease.acquired).toBe(true);
    const response = await handleChat(request("gpt-5.4", pinned));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Connection recovery in progress");
    expect(mocks.getProviderConnections).toHaveBeenCalledTimes(pinned ? 2 : 1);
    expect(mocks.retrySleep).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
    globalCircuitManager.releaseLease(row.id, "gpt-5.4", lease.leaseToken);
  });

  it("returns pinned dispatch-claim contention once without outer reselection, sleep or dispatch", async () => {
    // Acquire after eligibility filtering but before dispatch, during the actual
    // selector's credential projection. This exercises the second busy return.
    let lease;
    mocks.resolveConnectionProxyConfig.mockImplementationOnce(async () => {
      lease = globalCircuitManager.acquireRecoveryLease(row.id, "gpt-5.4", row["modelLock_gpt-5.4"]);
      return {};
    });
    const response = await handleChat(request("gpt-5.4", true));
    expect(lease.acquired).toBe(true);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Connection recovery in progress");
    expect(mocks.getProviderConnections).toHaveBeenCalledTimes(2);
    expect(mocks.retrySleep).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
    globalCircuitManager.releaseLease(row.id, "gpt-5.4", lease.leaseToken);
  });

  it.each([false, true])("reports a busy probe as 503 after sibling success lazily clears its lock, pinned=%s", async (pinned) => {
    mocks.handleChatCore.mockImplementation(async (options) => {
      if (options.modelInfo.model === "gpt-5.4") {
        return { success: true, response: new Response(new ReadableStream({ start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
        } }), { headers: { "content-type": "text/event-stream" } }) };
      }
      const attemptStartedAt = options.onProviderAttempt();
      await options.onRequestSuccess({ attemptStartedAt });
      return { success: true, response: new Response("ok") };
    });
    const first = await handleChat(request("gpt-5.4", true));
    expect(first.status).toBe(200);
    const sibling = await handleChat(request("gpt-5.3-codex", true));
    expect(sibling.status).toBe(200);
    expect(row["modelLock_gpt-5.4"]).toBeNull();
    const selected = await getProviderCredentials("codex", null, "gpt-5.4", { connectionRecovery: true });
    expect(selected).toEqual({ connectionRecoveryBusy: true });
    const blocked = await handleChat(request("gpt-5.4", pinned));
    expect(blocked.status).toBe(503);
    expect(blocked.headers.has("retry-after")).toBe(false);
    expect(await blocked.text()).toContain("Connection recovery in progress");
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(2);
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
    await first.body.cancel();
    await sibling.body.cancel();
    expect((await getProviderCredentials("codex", null, "gpt-5.4", { connectionRecovery: true })).connectionId).toBe(row.id);
  });

  it("keeps healthy unpinned accounts eligible after real core queue timeout without trying a sibling", async () => {
    const { handleChatCore } = await vi.importActual("../../open-sse/handlers/chatCore.js");
    mocks.handleChatCore.mockImplementation(handleChatCore);
    // Both saved accounts are healthy. The saturated provider gate is local
    // pressure, not evidence against either connection's credentials.
    delete row["modelLock_gpt-5.4"];
    const sibling = { ...row, id: "healthy-sibling-account" };
    mocks.getProviderConnections.mockImplementation(async () => structuredClone([row, sibling]));
    mocks.getSettings.mockResolvedValue({ requireApiKey: false, providerConcurrencyLimits: { codex: 1 } });
    await acquireSlot("codex", 1);
    vi.useFakeTimers();
    try {
      const pending = handleChat(request("gpt-5.4"));
      await vi.waitFor(() => expect(getGateStats().codex?.queued).toBe(1));
      await vi.advanceTimersByTimeAsync(120001);
      const response = await pending;
      expect(response.status).toBe(503);
      expect(await response.text()).toContain("timed out");
      expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
      expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
      expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
      expect(mocks.handleChatCore.mock.calls[0][0].connectionId).toBe(row.id);
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(getGateStats().codex).toEqual({ current: 1, queued: 0 });
      const selected = await getProviderCredentials("codex", null, "gpt-5.4", { connectionRecovery: true });
      expect(selected.connectionId).toBe(row.id);
    } finally { vi.useRealTimers(); releaseSlot("codex"); _resetGates(); resetPayloadAdmission(); }
  });

  it("returns real core queue timeout without provider cooldown writes", async () => {
    const { handleChatCore } = await vi.importActual("../../open-sse/handlers/chatCore.js");
    mocks.handleChatCore.mockImplementation(handleChatCore);
    mocks.getSettings.mockResolvedValue({ requireApiKey: false, providerConcurrencyLimits: { codex: 1 } });
    await acquireSlot("codex", 1);
    vi.useFakeTimers();
    try {
      const pending = handleChat(request("gpt-5.4", true));
      await vi.waitFor(() => expect(getGateStats().codex?.queued).toBe(1));
      await vi.advanceTimersByTimeAsync(120001);
      const response = await pending;
      expect(response.status).toBe(503);
      expect(await response.text()).toContain("timed out");
      expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
      expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); releaseSlot("codex"); _resetGates(); resetPayloadAdmission(); }
  });
});
