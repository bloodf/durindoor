import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

vi.mock("open-sse/index.js", () => ({}), { virtual: true });

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(), getApiKeyByKey: vi.fn(), getApiKeyUsageLimitStatus: vi.fn(),
  getComboModels: vi.fn(), getModelInfo: vi.fn(), getProviderCredentials: vi.fn(),
  projectProviderCredentials: vi.fn(), markAccountUnavailable: vi.fn(), clearAccountError: vi.fn(),
  evaluateApiKeyAuth: vi.fn(), execute: vi.fn(), refreshAndUpdateCredentials: vi.fn(), refreshProviderQuota: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, getApiKeyByKey: mocks.getApiKeyByKey, getApiKeyUsageLimitStatus: mocks.getApiKeyUsageLimitStatus }));
vi.mock("../../src/sse/services/model.js", async (original) => ({ ...(await original()), getComboModels: mocks.getComboModels, getModelInfo: mocks.getModelInfo, loadCustomCapabilities: async () => null }));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials, getProviderCredentialsWithQuotaPreflight: mocks.getProviderCredentials,
  projectProviderCredentials: mocks.projectProviderCredentials, markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError, extractApiKey: vi.fn(() => null), evaluateApiKeyAuth: mocks.evaluateApiKeyAuth,
  resolveClientApiKey: async (request, options) => ({ apiKey: null, auth: await mocks.evaluateApiKeyAuth(null, { ...options, request }) }),
  providerAllowsPublicNoAuthFallback: vi.fn(() => false),
}));
vi.mock("@/shared/services/providerCredentials", () => ({ refreshAndUpdateCredentials: mocks.refreshAndUpdateCredentials }));
vi.mock("@/shared/services/providerQuotaTracker", () => ({ refreshProviderQuota: mocks.refreshProviderQuota }));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("../../open-sse/services/projectId.js", () => ({ getProjectIdForConnection: vi.fn() }));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({ enforceApiKeyModelPolicy: vi.fn(async () => null) }));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: true, execute: mocks.execute }) }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({ createRequestLogger: async () => ({ logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(), logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn() }) }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), recordTokenSaverEvent: vi.fn(async () => {}) }));

const { handleChat } = await import("../../src/sse/handlers/chat.js");
const account = { id: "only-account", provider: "codex", authType: "oauth", accessToken: "test", providerSpecificData: {} };
function request() {
  return new Request("http://localhost/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "codex/gpt-5.4", stream: false, messages: [{ role: "user", content: "hello" }] }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({ requireApiKey: false, rtkEnabled: false, headroomEnabled: false, cavemanEnabled: false, ponytailEnabled: false });
  mocks.getApiKeyByKey.mockResolvedValue(null);
  mocks.getApiKeyUsageLimitStatus.mockResolvedValue({ exceeded: false });
  mocks.evaluateApiKeyAuth.mockResolvedValue({ ok: true, stored: false });
  mocks.getComboModels.mockResolvedValue(null);
  mocks.getModelInfo.mockResolvedValue({ provider: "codex", model: "gpt-5.4" });
  mocks.getProviderCredentials.mockResolvedValue({ connectionId: account.id, connectionName: account.id, accessToken: account.accessToken, providerSpecificData: {}, _connection: account, _quotaPreflight: { eligible: true, skip: false } });
  mocks.refreshAndUpdateCredentials.mockImplementation(async (connection) => ({ connection, refreshed: false }));
  mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false, cooldownMs: 0 });
});
describe("local executor failure provenance", () => {
  it("returns a malformed executor result without cooling or retrying the only account", async () => {
    mocks.execute.mockResolvedValue({ response: null });
    const response = await handleChat(request());
    expect(response.status).toBe(502);
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });
  it("continues to send a provider 429 to account cooldown", async () => {
    mocks.execute.mockResolvedValue({ response: Response.json({ error: { message: "rate limited" } }, { status: 429 }) });
    const response = await handleChat(request());
    expect(response.status).toBe(429);
    expect(mocks.markAccountUnavailable).toHaveBeenCalledOnce();
  });
});
