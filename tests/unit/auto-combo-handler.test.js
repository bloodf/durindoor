import { beforeEach, describe, expect, it, vi } from "vitest";

// Handler-level coverage for the auto-combo wiring in handleSearch + handleFetch.
// We stub every downstream collaborator so the test exercises ONLY the dispatch
// seam: getComboResolution → (auto-empty 503 | named-combo handleComboChat |
// allowlist 403). No real provider/core calls.

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getApiKeyByKey: vi.fn(),
  extractApiKey: vi.fn(),
  evaluateApiKeyAuth: vi.fn(),
  getComboResolution: vi.fn(),
  getModelInfo: vi.fn(),
  handleComboChat: vi.fn(),
  handleSearchCore: vi.fn(),
  handleFetchCore: vi.fn(),
  enforceApiKeyModelPolicy: vi.fn(),
  assertPublicUrl: vi.fn(),
  getProviderCredentials: vi.fn(),
  checkAndRefreshToken: vi.fn(async (_p, c) => c),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getApiKeyByKey: mocks.getApiKeyByKey,
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  extractApiKey: mocks.extractApiKey,
  evaluateApiKeyAuth: mocks.evaluateApiKeyAuth,
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
}));

vi.mock("../../src/sse/services/model.js", () => ({
  getComboResolution: mocks.getComboResolution,
  getModelInfo: mocks.getModelInfo,
}));

vi.mock("open-sse/services/combo.js", () => ({
  handleComboChat: mocks.handleComboChat,
}));

vi.mock("open-sse/handlers/search/index.js", () => ({
  handleSearchCore: mocks.handleSearchCore,
}));

vi.mock("open-sse/handlers/fetch/index.js", () => ({
  handleFetchCore: mocks.handleFetchCore,
}));

vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: mocks.enforceApiKeyModelPolicy,
  recordApiKeyUsageForResponse: vi.fn(),
  recordApiKeyUsage: vi.fn(),
  isModelAllowed: vi.fn(() => true),
}));

vi.mock("@/shared/utils/ssrfGuard.js", () => ({
  assertPublicUrl: mocks.assertPublicUrl,
}));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.checkAndRefreshToken,
  updateProviderCredentials: vi.fn(),
}));

const API_KEY = "sk-test";

function searchRequest(providerOrModel, { key = API_KEY, query = "hello" } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  return new Request("http://localhost/v1/search", {
    method: "POST",
    headers,
    body: JSON.stringify({ provider: providerOrModel, query }),
  });
}

function fetchRequest(providerOrModel, { key = API_KEY, url = "https://example.com/article" } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  return new Request("http://localhost/v1/fetch", {
    method: "POST",
    headers,
    body: JSON.stringify({ provider: providerOrModel, url }),
  });
}

describe.each([
  ["search", () => import("../../src/sse/handlers/search.js"), "handleSearch", searchRequest],
  ["fetch", () => import("../../src/sse/handlers/fetch.js"), "handleFetch", fetchRequest],
])("%s handler auto-combo wiring", (_label, load, exportName, makeReq) => {
  let handler;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.extractApiKey.mockReturnValue(API_KEY);
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.evaluateApiKeyAuth.mockResolvedValue({ ok: true });
    mocks.getApiKeyByKey.mockResolvedValue({ name: "k", allowedCombos: [] });
    mocks.enforceApiKeyModelPolicy.mockResolvedValue(null);
    mocks.assertPublicUrl.mockReturnValue(undefined);
    mocks.handleComboChat.mockResolvedValue(new Response("combo-ok", { status: 200 }));
    mocks.handleSearchCore.mockResolvedValue(new Response("core-ok", { status: 200 }));
    mocks.handleFetchCore.mockResolvedValue(new Response("core-ok", { status: 200 }));
    const mod = await load();
    handler = mod[exportName];
  });

  it("auto-empty → 503 and never dispatches the combo engine", async () => {
    mocks.getComboResolution.mockResolvedValue({
      kind: "auto-empty",
      family: "glm",
      reason: 'auto-combo "glm" has no installed providers',
    });
    const res = await handler(makeReq("auto/glm"));
    expect(res.status).toBe(503);
    expect(mocks.handleComboChat).not.toHaveBeenCalled();
    expect(mocks.handleSearchCore).not.toHaveBeenCalled();
    expect(mocks.handleFetchCore).not.toHaveBeenCalled();
  });

  it("resolved auto-combo → handleComboChat receives the resolved models", async () => {
    mocks.getComboResolution.mockResolvedValue({ kind: "combo", models: ["glm/glm-5.2", "zai/glm-5.2"] });
    const res = await handler(makeReq("auto/glm"));
    expect(res.status).toBe(200);
    expect(mocks.handleComboChat).toHaveBeenCalledTimes(1);
    expect(mocks.handleComboChat.mock.calls[0][0].models).toEqual(["glm/glm-5.2", "zai/glm-5.2"]);
    expect(mocks.handleComboChat.mock.calls[0][0].comboName).toBe("auto/glm");
  });

  it("named combo → handleComboChat receives the resolved models", async () => {
    mocks.getComboResolution.mockResolvedValue({ kind: "combo", models: ["prov/a", "prov/b"] });
    const res = await handler(makeReq("my-combo"));
    expect(res.status).toBe(200);
    expect(mocks.handleComboChat).toHaveBeenCalledTimes(1);
    expect(mocks.handleComboChat.mock.calls[0][0].models).toEqual(["prov/a", "prov/b"]);
    expect(mocks.handleComboChat.mock.calls[0][0].comboName).toBe("my-combo");
  });

  it("threads getSettings() into getComboResolution (settings.autoCombo applies)", async () => {
    const settings = { requireApiKey: false, autoCombo: { enabled: false } };
    mocks.getSettings.mockResolvedValue(settings);
    mocks.getComboResolution.mockResolvedValue({
      kind: "auto-empty",
      family: "glm",
      reason: "auto-combo disabled",
    });
    await handler(makeReq("auto/glm"));
    expect(mocks.getComboResolution).toHaveBeenCalledWith("auto/glm", settings);
  });

  it("allowlist denies combo → 403 before any dispatch", async () => {
    mocks.getComboResolution.mockResolvedValue({ kind: "combo", models: ["glm/glm-5.2"] });
    mocks.getApiKeyByKey.mockResolvedValue({ name: "limited", allowedCombos: ["other-combo"] });
    const res = await handler(makeReq("auto/glm"));
    expect(res.status).toBe(403);
    expect(mocks.handleComboChat).not.toHaveBeenCalled();
  });

  it("auth runs before resolution: invalid key → 401, resolution never consulted", async () => {
    mocks.evaluateApiKeyAuth.mockResolvedValue({ ok: false, reason: "invalid" });
    const res = await handler(makeReq("auto/glm"));
    expect(res.status).toBe(401);
    expect(mocks.getComboResolution).not.toHaveBeenCalled();
  });
});
