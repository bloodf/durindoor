import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: vi.fn(), key: vi.fn(), credentials: vi.fn(), noAuth: vi.fn(), policy: vi.fn(),
  save: vi.fn(), search: vi.fn(), fetch: vi.fn(), rerank: vi.fn(), moderation: vi.fn(),
  combos: vi.fn(), combo: vi.fn(), executor: vi.fn(), unavailable: vi.fn(),
  providers: {
    paid: { id: "paid", searchConfig: { costPerQuery: 0.02 }, fetchConfig: { costPerQuery: 0.03 } },
    unknown: { id: "unknown", searchConfig: {}, fetchConfig: {} },
    free: { id: "free", noAuth: true, searchConfig: { costPerQuery: 0 }, fetchConfig: { costPerQuery: 0 } },
    chat: { id: "chat", searchViaChat: true }
  }
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.settings, getApiKeyByKey: mocks.key, getCombos: mocks.combos,
  getComboForModel: mocks.combo, getProviderConnections: vi.fn(), saveRequestUsage: mocks.save,
  getApiKeyUsageTotals: vi.fn(), getApiKeyById: vi.fn()
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  resolveClientApiKey: vi.fn(async () => ({ apiKey: "caller-key", auth: { ok: true, apiKeyId: "key-id" } })),
  getProviderCredentialsWithQuotaPreflight: mocks.credentials, getNoAuthProviderCredentials: mocks.noAuth,
  markAccountUnavailable: mocks.unavailable, clearAccountError: vi.fn(), projectProviderCredentials: vi.fn(),
  extractApiKey: vi.fn(), hasValidCliToken: vi.fn(async () => false)
}));
vi.mock("../../src/sse/services/apiKeyPolicy.js", async (importOriginal) => ({
  ...await importOriginal(), enforceApiKeyModelPolicy: mocks.policy
}));
vi.mock("@/shared/constants/providers.js", () => ({ AI_PROVIDERS: mocks.providers, resolveProviderId: (id) => id }));
vi.mock("../../src/sse/utils/requestCorrelation.js", async (importOriginal) => ({
  ...await importOriginal(), withRequestCorrelation: (handler) => handler
}));
vi.mock("../../src/sse/utils/logger.js", () => ({ request: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), maskKey: () => "masked" }));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_p, c) => c, updateProviderCredentials: vi.fn() }));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: async (id) => { const [provider, model] = id.split("/"); return { provider, model }; },
  getAutoComboCatalog: vi.fn()
}));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: mocks.executor }));
vi.mock("open-sse/handlers/search/index.js", () => ({ handleSearchCore: mocks.search }));
vi.mock("open-sse/handlers/fetch/index.js", () => ({ handleFetchCore: mocks.fetch }));
vi.mock("open-sse/handlers/rerankCore.js", () => ({ handleRerankCore: mocks.rerank }));
vi.mock("open-sse/handlers/moderationsCore.js", () => ({ handleModerationsCore: mocks.moderation }));
vi.mock("open-sse/providers/pricing.js", () => ({ filterPaidModels: (models) => models }));
vi.mock("open-sse/services/comboRoutingPolicy.js", () => ({ getComboRoutingPolicy: async () => ({ allowedConnectionIds: ["account-b"] }) }));
vi.mock("open-sse/services/autoComboResolver.js", () => ({ isAutoComboId: () => false }));
vi.mock("open-sse/services/combo.js", () => ({
  getComboModelsFromData: (name) => name === "bundle" ? ["unknown", "paid"] : null,
  handleComboChat: async ({ body, models, handleSingleModel }) => {
    let response;
    for (const model of models) { response = await handleSingleModel(body, model); if (response.ok) return response; }
    return response;
  }
}));
vi.mock("../../src/sse/services/mediaRoutes.js", () => ({
  wantsDefaultRoute: (id) => !id,
  resolveMediaRoute: async () => ({ models: ["paid"] }),
  defaultRouteComboOptions: (kind) => ({ comboName: `media-route:${kind}` })
}));
vi.mock("@/shared/utils/ssrfGuard.js", () => ({ assertPublicUrlResolved: vi.fn() }));

import { handleSearch } from "../../src/sse/handlers/search.js";
import { handleFetch } from "../../src/sse/handlers/fetch.js";
import { handleRerank } from "../../src/sse/handlers/rerank.js";
import { handleModerations } from "../../src/sse/handlers/moderations.js";
import { getRequestId } from "../../src/sse/utils/requestCorrelation.js";

const cases = [
  ["search", handleSearch, mocks.search, { provider: "paid", query: "hello" }, "webSearch", "search"],
  ["fetch", handleFetch, mocks.fetch, { provider: "paid", url: "https://example.com" }, "webFetch", "fetch"],
  ["rerank", handleRerank, mocks.rerank, { model: "paid/rank", query: "hello", documents: ["a", "b"], top_n: 1 }, "rerank", "rank"],
  ["moderations", handleModerations, mocks.moderation, { model: "paid/mod", input: [{ type: "text", text: "hello" }, { type: "image_url", image_url: { url: "https://example.com/a.png" } }] }, "moderation", "mod"]
];
const request = (endpoint, body) => new Request(`http://localhost/v1/${endpoint}`, {
  method: "POST", headers: { "content-type": "application/json", "x-request-id": "reused-client-id" }, body: JSON.stringify(body)
});
const accounting = (overrides = {}) => ({
  state: "complete", tokens: {}, nativeUnits: {}, cost: null,
  costStatus: "unknown", costSource: "unavailable", meta: {}, ...overrides
});
const receipt = (cost = 0.17) => accounting({
  tokens: { input_tokens: 12, output_tokens: 3 }, nativeUnits: { operations: 2 },
  cost, costStatus: "known", costSource: "provider",
  meta: { providerUsage: { path: "usage", value: { input_tokens: 12, output_tokens: 3, cost_usd: cost } } }
});
const success = (usage = accounting()) => ({ success: true, accounting: usage, response: new Response('{"untouched":true}'), data: { usage: { search_cost_usd: 0, fetch_cost_usd: 0 } } });
const failure = () => ({ success: false, status: 503, error: "unavailable", response: new Response("unavailable", { status: 503 }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue({});
  mocks.key.mockResolvedValue(null);
  mocks.combos.mockResolvedValue([]);
  mocks.combo.mockResolvedValue({ id: "combo-id", name: "bundle" });
  mocks.credentials.mockResolvedValue({ connectionId: "account-b", apiKey: "provider-secret" });
  mocks.noAuth.mockResolvedValue({ connectionId: null });
  mocks.executor.mockReturnValue({ noAuth: false });
  mocks.policy.mockResolvedValue(null);
  mocks.unavailable.mockResolvedValue({ shouldFallback: false });
  mocks.save.mockResolvedValue(true);
  for (const core of [mocks.search, mocks.fetch, mocks.rerank, mocks.moderation]) core.mockImplementation(async () => success());
});

describe("query handlers normalized successful usage", () => {
  it.each(cases)("%s preserves identity without inventing native units or tokens", async (endpoint, handler, core, body, modality, model) => {
    const result = success();
    core.mockResolvedValue(result);
    const response = await handler(request(endpoint, body));
    expect(response.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    const event = mocks.save.mock.calls[0][0];
    expect(event).toMatchObject({ apiKey: "caller-key", provider: "paid", model, connectionId: "account-b", endpoint: `/v1/${endpoint}`, modality, tokens: {}, nativeUnits: {}, status: "ok", strict: true });
    expect(event.usageEventId).toEqual(expect.any(String));
    expect(event).toMatchObject({ cost: null, costStatus: "unknown", costSource: "unavailable" });
    if (endpoint !== "fetch") {
      expect(response).toBe(result.response);
      expect(response.bodyUsed).toBe(false);
      expect(await response.text()).toBe('{"untouched":true}');
    } else {
      expect(response.bodyUsed).toBe(false);
      expect(await response.text()).toBe(JSON.stringify(result.data));
    }
    await handler(request(endpoint, body));
    expect(mocks.save.mock.calls[1][0].usageEventId).not.toBe(event.usageEventId);
  });

  it.each(cases)("%s reuses the event identity when the same Request is retried", async (endpoint, handler, _core, body) => {
    const req = request(endpoint, body);
    // Re-dispatch the same logical request with its already-parsed body.
    vi.spyOn(req, "json").mockResolvedValue(body);
    await handler(req);
    await handler(req);
    const [first, retry] = mocks.save.mock.calls.map(([event]) => event);
    expect(first.usageEventId).toBe(retry.usageEventId);
    expect(first.usageEventId.endsWith(`:/v1/${endpoint}`)).toBe(true);
    expect(first).toEqual(retry);
  });

  it.each(cases)("%s never counts policy denials or upstream failures", async (endpoint, handler, core, body) => {
    mocks.policy.mockResolvedValueOnce(new Response("denied", { status: 403 }));
    expect((await handler(request(endpoint, body))).status).toBe(403);
    expect(core).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    core.mockResolvedValue(failure());
    expect((await handler(request(endpoint, body))).status).toBe(503);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each(cases)("%s preserves the winning receipt and body after account retry", async (endpoint, handler, core, body) => {
    mocks.credentials.mockResolvedValueOnce({ connectionId: "account-a", apiKey: "failed-secret" });
    mocks.unavailable.mockResolvedValueOnce({ shouldFallback: true });
    const result = success(receipt());
    core.mockResolvedValueOnce({ ...failure(), accounting: receipt(99) }).mockResolvedValueOnce(result);
    const req = request(endpoint, body);
    const response = await handler(req);
    expect(core).toHaveBeenCalledTimes(2);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ ...result.accounting, apiKey: "caller-key", connectionId: "account-b", usageEventId: `${getRequestId(req)}:/v1/${endpoint}` });
    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toBe(endpoint === "fetch" ? JSON.stringify(result.data) : '{"untouched":true}');
  });

  it.each(cases.slice(0, 2))("%s estimates only evidenced operations at configured prices", async (endpoint, handler, core, body) => {
    core.mockImplementation(async () => success(accounting({ nativeUnits: { operations: 2 } })));
    await handler(request(endpoint, { ...body, provider: "unknown" }));
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ cost: null, costStatus: "unknown" });
    await handler(request(endpoint, body));
    expect(mocks.save.mock.calls[1][0]).toMatchObject({ cost: endpoint === "fetch" ? 0.06 : 0.04, costStatus: "estimated", costSource: "pricing" });
    await handler(request(endpoint, { ...body, provider: "free" }));
    expect(mocks.save.mock.calls[2][0]).toMatchObject({ connectionId: null, cost: 0, costStatus: "estimated", costSource: "pricing" });
    mocks.noAuth.mockResolvedValue({ connectionId: "saved-no-auth" });
    await handler(request(endpoint, { ...body, provider: "free" }));
    expect(mocks.save.mock.calls[3][0].connectionId).toBe("saved-no-auth");
  });

  it.each(cases.slice(0, 2))("%s keeps named/default combo identity on winning member", async (endpoint, handler, core, body, modality) => {
    const result = success(receipt());
    core.mockResolvedValueOnce(failure()).mockResolvedValueOnce(result);
    await handler(request(endpoint, { ...body, provider: "bundle" }));
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ ...result.accounting, provider: "paid", comboId: "combo-id", comboName: "bundle" });
    await handler(request(endpoint, { ...body, provider: undefined }));
    expect(mocks.save.mock.calls[1][0]).toMatchObject({ provider: "paid", comboId: null, comboName: `media-route:${modality}` });
  });

  it.each(cases.slice(2))("%s attributes model fallback only to its successful target", async (endpoint, handler, core, body) => {
    mocks.settings.mockResolvedValue({ modelFallbacks: { [body.model]: { fallback: "unknown/replacement" } } });
    const result = success(receipt());
    core.mockResolvedValueOnce(failure()).mockResolvedValueOnce(result);
    await handler(request(endpoint, body));
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ ...result.accounting, provider: "unknown", model: "replacement", connectionId: "account-b" });
  });

  it.each(cases)("%s preserves credential-free receipts without inventing a connection", async (endpoint, handler, core, body) => {
    mocks.executor.mockReturnValue({ noAuth: true });
    const result = success(receipt(0));
    core.mockResolvedValueOnce(result);
    await handler(request(endpoint, { ...body, provider: "free" }));
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ ...result.accounting, connectionId: null });
  });

  it.each(cases)("%s preserves known zero and total-only unknown receipts without allocation", async (endpoint, handler, core, body) => {
    core.mockResolvedValueOnce(success(receipt(0)));
    await handler(request(endpoint, body));
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ cost: 0, costStatus: "known", costSource: "provider" });
    const totalOnly = accounting({ tokens: { total_tokens: 42 }, nativeUnits: { operations: 1 }, meta: { providerUsage: { path: "usage", value: { total_tokens: 42 } } } });
    core.mockResolvedValueOnce(success(totalOnly));
    await handler(request(endpoint, body));
    expect(mocks.save.mock.calls[1][0]).toMatchObject({ cost: null, costStatus: "unknown", costSource: "unavailable", meta: totalOnly.meta });
    expect(mocks.save.mock.calls[1][0].tokens).toEqual({ total_tokens: 42 });
  });
});
