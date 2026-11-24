import { beforeEach, describe, expect, it, vi } from "vitest";

// OmniRoute c40aaac6: an `auto/<family>` pool must stay inside the caller's
// API-key connection allowlist, and a failed read must never widen it.
// Keys and connection ids below are synthetic; no stored secret is read.

const mocks = vi.hoisted(() => ({
  getApiKeyProviderConnectionIds: vi.fn(),
  getProviderConnections: vi.fn(),
  getModelAliases: vi.fn(),
  getProviderNodes: vi.fn(),
  getComboByName: vi.fn(),
  getComboForModel: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeyProviderConnectionIds: mocks.getApiKeyProviderConnectionIds,
  getProviderConnections: mocks.getProviderConnections,
  getModelAliases: mocks.getModelAliases,
  getProviderNodes: mocks.getProviderNodes,
  getComboByName: mocks.getComboByName,
  getComboForModel: mocks.getComboForModel,
  getSettings: mocks.getSettings,
}));

const { scopeAutoComboModels } = await import("../../src/sse/services/autoComboScope.js");

const KEY_ID = "test-key-scope-0001";
const GLM_CONN = "conn-test-glm-a";
const GLM_CONN_OTHER = "conn-test-glm-b";
const OPENROUTER_CONN = "conn-test-openrouter-a";
const POOL = ["glm/glm-4.6", "openrouter/z-ai/glm-4.6"];

const ACTIVE_CONNECTIONS = [
  { id: GLM_CONN, provider: "glm", isActive: true },
  { id: GLM_CONN_OTHER, provider: "glm", isActive: true },
  { id: OPENROUTER_CONN, provider: "openrouter", isActive: true },
];

function captureLog() {
  const warnings = [];
  return { warnings, log: { warn: (tag, message, data) => warnings.push({ tag, message, data }) } };
}

describe("auto-combo API-key connection scope (c40aaac6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getProviderNodes.mockResolvedValue([]);
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
