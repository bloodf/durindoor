import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ connections: vi.fn(), key: vi.fn(), ids: vi.fn(), read: vi.fn(), registered: { value: {} } }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: m.connections, getApiKeyByKey: m.key, getApiKeyProviderConnectionIds: m.ids,
  getCombos: vi.fn(async () => []), getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})), getProviderNodes: vi.fn(async () => []),
}));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn() }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("@/lib/oauth/chatgptPlanAccounts.js", () => ({ createChatGptPlanAccounts: () => ({ readAccount: m.read }) }));
vi.mock("open-sse/config/providers.js", async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, PROVIDERS: new Proxy(original.PROVIDERS, { get: (target, key) => key === "chatgpt-plan" ? m.registered.value : target[key] }) };
});

import { GET } from "../../src/app/api/v1/models/route.js";

const clientId = "oaiapp_synthetic";
const selection = { id: createHash("sha256").update(clientId).digest("hex"), issuer: "https://auth.openai.com", subject: "synthetic", clientId };
const connection = { id: "a", provider: "chatgpt-plan", authType: "oauth", isActive: true, providerSpecificData: { chatgptPlanAccount: selection } };
const request = (key = "right") => new Request("http://localhost/v1/models", { headers: { authorization: `Bearer ${key}` } });
const catalog = async (key) => (await (await GET(request(key))).json()).data.filter((row) => row.id.startsWith("chatgpt-plan/"));

describe("private ChatGPT plan model listing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DURINDOOR_CHATGPT_PLAN_ENROLLMENT = "1";
    m.registered.value = {};
    m.connections.mockResolvedValue([connection]);
    m.key.mockImplementation(async (key) => key === "right" ? { id: "key", isActive: true } : null);
    m.ids.mockResolvedValue(["a"]);
    m.read.mockResolvedValue({ ...selection, planEnabled: true, expiresAt: Date.now() + 60000, accessToken: "synthetic-token" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ models: [{ slug: "private", display_name: "Private", visibility: "list" }] }) })));
  });
  afterEach(() => { delete process.env.DURINDOOR_CHATGPT_PLAN_ENROLLMENT; vi.unstubAllGlobals(); });

  it("lists only for the verified scoped key and fetches afresh on repeat", async () => {
    expect((await catalog("right")).map((row) => row.id)).toEqual(["chatgpt-plan/private"]);
    expect(await catalog("wrong")).toEqual([]);
    expect((await catalog("right"))).toHaveLength(1);
    expect(fetch.mock.calls.filter(([url]) => url === "https://api.openai.com/v1/models")).toHaveLength(2);
    expect(JSON.stringify(await catalog("right"))).not.toContain("synthetic-token");
  });
  it.each(["empty", "mismatch", "disabled", "unregistered", "selection"])("denies %s before private reads", async (reason) => {
    if (reason === "empty") m.ids.mockResolvedValue([]);
    if (reason === "mismatch") m.ids.mockResolvedValue(["other"]);
    if (reason === "disabled") delete process.env.DURINDOOR_CHATGPT_PLAN_ENROLLMENT;
    if (reason === "unregistered") m.registered.value = undefined;
    if (reason === "selection") m.connections.mockResolvedValue([{ ...connection, providerSpecificData: {} }]);
    expect(await catalog("right")).toEqual([]);
    expect(m.read).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not choose between multiple scoped plan connections", async () => {
    m.connections.mockResolvedValue([connection, { ...connection, id: "b" }]);
    m.ids.mockResolvedValue(["a", "b"]);
    expect(await catalog()).toEqual([]);
    expect(m.read).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("fails closed for missing credentials and upstream errors", async () => {
    m.read.mockResolvedValueOnce(null);
    expect(await catalog("right")).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRejectedValueOnce(new Error("synthetic failure"));
    expect(await catalog("right")).toEqual([]);
  });
  it("isolates concurrent keys bound to different saved identities", async () => {
    const otherClient = "oaiapp_other";
    const other = { ...selection, id: createHash("sha256").update(otherClient).digest("hex"), clientId: otherClient, subject: "other" };
    m.connections.mockResolvedValue([connection, { ...connection, id: "b", providerSpecificData: { chatgptPlanAccount: other } }]);
    m.key.mockImplementation(async (key) => ({ id: key, isActive: true }));
    m.ids.mockImplementation(async (key) => [key === "right" ? "a" : "b"]);
    m.read.mockImplementation(async (identity) => ({ ...identity, planEnabled: true, expiresAt: Date.now() + 60000, accessToken: identity.subject }));
    fetch.mockImplementation(async (_url, init) => ({ ok: true, json: async () => ({ models: [{ slug: init.headers.Authorization.endsWith("other") ? "second" : "first", visibility: "list" }] }) }));
    const [first, second] = await Promise.all([catalog("right"), catalog("other")]);
    expect(first.map((row) => row.id)).toEqual(["chatgpt-plan/first"]);
    expect(second.map((row) => row.id)).toEqual(["chatgpt-plan/second"]);
  });
});
