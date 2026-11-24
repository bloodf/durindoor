import { beforeEach, describe, expect, it, vi } from "vitest";

// OmniRoute c40aaac6: an `auto/<family>` chat pool stays inside the caller
// key's connection allowlist, and a failed read never widens it. Covers the
// scoping helper and the chat dispatch boundary. Synthetic keys and
// connection ids only; no stored secret is read.

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getComboForModel: vi.fn(),
  getComboByName: vi.fn(),
  getProviderConnections: vi.fn(),
  getQuotaReservationPressure: vi.fn(),
  getApiKeyProviderConnectionIds: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  handleComboChat: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getComboForModel: mocks.getComboForModel,
  getComboByName: mocks.getComboByName,
  getProviderConnections: mocks.getProviderConnections,
  getQuotaReservationPressure: mocks.getQuotaReservationPressure,
  getApiKeyProviderConnectionIds: mocks.getApiKeyProviderConnectionIds,
}));

vi.mock("../../src/sse/services/model.js", () => ({
  getComboModels: mocks.getComboModels,
  getModelInfo: mocks.getModelInfo,
  getComboCanonicalName: async (model) => model,
  loadCustomCapabilities: async () => null,
  parseModel: (model) => ({ providerAlias: model.split("/")[0], model: model.split("/").slice(1).join("/") }),
}));

vi.mock("../../open-sse/services/combo.js", async (importOriginal) => ({
  ...(await importOriginal()),
  handleComboChat: mocks.handleComboChat,
}));

const { dispatchChat, dispatchNestedCombo } = await import("../../src/sse/handlers/chat/combo.js");
const { scopeAutoComboModels } = await import("../../src/sse/services/autoComboScope.js");

const KEY_ID = "test-key-dispatch-0001";
const GLM_CONN = "conn-test-glm-a";
const GLM_CONN_OTHER = "conn-test-glm-b";
const OPENROUTER_CONN = "conn-test-openrouter-a";
const POOL = ["glm/glm-4.6", "openrouter/z-ai/glm-4.6"];

const ACTIVE_CONNECTIONS = [
  { id: GLM_CONN, provider: "glm", isActive: true },
  { id: GLM_CONN_OTHER, provider: "glm", isActive: true },
  { id: OPENROUTER_CONN, provider: "openrouter", isActive: true },
];

function resolveByPrefix(modelStr) {
  const [prefix, ...rest] = modelStr.split("/");
  return { provider: prefix, model: rest.join("/") };
}

function dispatch(modelStr, apiKeyId = KEY_ID) {
  return dispatchChat({
    body: { model: modelStr, messages: [{ role: "user", content: "hi" }] },
    modelStr,
    settings: { comboStrategy: "fallback" },
    request: new Request("http://localhost/v1/chat/completions", { method: "POST" }),
    apiKeyAuth: { apiKeyId },
    apiKey: null,
    clientRawRequest: { endpoint: "/v1/chat/completions", body: {} },
    planRequest: null,
    authenticatedKeyRecord: null,
    billingEpoch: null,
    finishChat: (result) => result,
  });
}

function poolPassedToComboLoop() {
  expect(mocks.handleComboChat).toHaveBeenCalledTimes(1);
  return mocks.handleComboChat.mock.calls[0][0].models;
}

describe("auto-combo key connection scope at chat dispatch (c40aaac6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ comboStrategy: "fallback" });
    mocks.getComboForModel.mockResolvedValue(null);
    mocks.getComboByName.mockResolvedValue(null);
    mocks.getQuotaReservationPressure.mockResolvedValue(new Map());
    mocks.getComboModels.mockImplementation(async (model) => (
      model === "auto/glm" || model === "saved-glm" ? [...POOL] : null
    ));
    mocks.getModelInfo.mockImplementation(async (modelStr) => resolveByPrefix(modelStr));
    mocks.getProviderConnections.mockResolvedValue([
      { id: GLM_CONN, provider: "glm", isActive: true },
      { id: OPENROUTER_CONN, provider: "openrouter", isActive: true },
    ]);
    mocks.handleComboChat.mockResolvedValue(new Response("ok", { status: 200 }));
  });

  it("allowed: only the permitted provider's model reaches the combo loop", async () => {
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue([GLM_CONN]);
    await dispatch("auto/glm");
    expect(poolPassedToComboLoop()).toEqual(["glm/glm-4.6"]);
  });

  it("denied: no permitted provider leaves an empty pool (combo loop answers 503)", async () => {
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue(["conn-test-unknown"]);
    await dispatch("auto/glm");
    expect(poolPassedToComboLoop()).toEqual([]);
  });

  it("empty scope: an unrestricted key keeps the full pool", async () => {
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue([]);
    await dispatch("auto/glm");
    expect(poolPassedToComboLoop()).toEqual(POOL);
  });

  it("scope read error: fails closed with an empty pool", async () => {
    mocks.getApiKeyProviderConnectionIds.mockRejectedValue(new Error("SQLITE_BUSY"));
    await dispatch("auto/glm");
    expect(poolPassedToComboLoop()).toEqual([]);
  });

  it("connection read error with a known scope keeps the pool for dispatch-time enforcement", async () => {
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue([GLM_CONN]);
    mocks.getProviderConnections.mockRejectedValue(new Error("no such table: provider_connections"));
    await dispatch("auto/glm");
    expect(poolPassedToComboLoop()).toEqual(POOL);
  });

  it("saved combos are not rescoped here", async () => {
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue([GLM_CONN]);
    await dispatch("saved-glm");
    expect(poolPassedToComboLoop()).toEqual(POOL);
    expect(mocks.getApiKeyProviderConnectionIds).not.toHaveBeenCalled();
  });

  it("nested auto combo is narrowed by the same key scope", async () => {
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue([OPENROUTER_CONN]);
    await dispatchNestedCombo({
      body: { model: "auto/glm", messages: [] },
      modelStr: "auto/glm",
      request: new Request("http://localhost/v1/chat/completions", { method: "POST" }),
      comboRouting: null,
      comboPrompts: [],
      comboVisited: new Set(["outer"]),
      apiKeyId: KEY_ID,
    });
    expect(poolPassedToComboLoop()).toEqual(["openrouter/z-ai/glm-4.6"]);
  });
});

function captureLog() {
  const warnings = [];
  return { warnings, log: { warn: (tag, message, data) => warnings.push({ tag, message, data }) } };
}

describe("scopeAutoComboModels (c40aaac6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getModelInfo.mockImplementation(async (modelStr) => resolveByPrefix(modelStr));
    mocks.getProviderConnections.mockResolvedValue(ACTIVE_CONNECTIONS);
  });

  it("allowed: keeps only models whose provider has a permitted active connection", async () => {
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue([GLM_CONN]);
    const pool = await scopeAutoComboModels("auto/glm", POOL, KEY_ID);
    expect(pool).toEqual(["glm/glm-4.6"]);
    expect(mocks.getApiKeyProviderConnectionIds).toHaveBeenCalledWith(KEY_ID);
  });

  it("denied: a scope with no matching active connection yields an empty pool", async () => {
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue(["conn-test-unknown"]);
    expect(await scopeAutoComboModels("auto/glm", POOL, KEY_ID)).toEqual([]);
  });

  it("denied: an inactive permitted connection does not admit its provider", async () => {
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue([OPENROUTER_CONN]);
    mocks.getProviderConnections.mockResolvedValue([
      { id: GLM_CONN, provider: "glm", isActive: true },
      { id: OPENROUTER_CONN, provider: "openrouter", isActive: false },
    ]);
    expect(await scopeAutoComboModels("auto/glm", POOL, KEY_ID)).toEqual([]);
  });

  it("empty scope: a key without relation rows stays unrestricted", async () => {
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue([]);
    expect(await scopeAutoComboModels("auto/glm", POOL, KEY_ID)).toEqual(POOL);
    expect(mocks.getProviderConnections).not.toHaveBeenCalled();
  });

  it("unscoped callers and saved combos are left untouched", async () => {
    expect(await scopeAutoComboModels("auto/glm", POOL, null)).toEqual(POOL);
    expect(await scopeAutoComboModels("my-saved-combo", POOL, KEY_ID)).toEqual(POOL);
    expect(await scopeAutoComboModels("auto/glm", null, KEY_ID)).toBeNull();
    expect(mocks.getApiKeyProviderConnectionIds).not.toHaveBeenCalled();
  });

  it("scope read error: fails closed with no candidates and a sanitized warning", async () => {
    mocks.getApiKeyProviderConnectionIds.mockRejectedValue(new Error("SQLITE_BUSY: database is locked"));
    const { warnings, log } = captureLog();
    const pool = await scopeAutoComboModels("auto/glm", POOL, KEY_ID, { log });
    expect(pool).toEqual([]);
    expect(mocks.getProviderConnections).not.toHaveBeenCalled();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].tag).toBe("COMBO_AUTO");
    expect(warnings[0].message).toMatch(/scope read failed/);
    expect(warnings[0].data.error).toContain("SQLITE_BUSY");
  });

  it("connection read error with a known scope: keeps the targets and logs a warning", async () => {
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue([GLM_CONN, OPENROUTER_CONN]);
    mocks.getProviderConnections.mockRejectedValue(new Error("no such table: provider_connections"));
    const { warnings, log } = captureLog();
    const pool = await scopeAutoComboModels("auto/glm", POOL, KEY_ID, { log });
    expect(pool).toEqual(POOL);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/active connection read failed; keeping targets/);
    expect(warnings[0].data.scopeSize).toBe(2);
  });

  it("does not log a credential carried in a read error", async () => {
    const fakeSecret = ["sk", "test", "0000000000000000000000000000"].join("-");
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue([GLM_CONN]);
    mocks.getProviderConnections.mockRejectedValue(new Error(`read failed Authorization: Bearer ${fakeSecret}`));
    const { warnings, log } = captureLog();
    await scopeAutoComboModels("auto/glm", POOL, KEY_ID, { log });
    expect(JSON.stringify(warnings)).not.toContain(fakeSecret);
  });
});
