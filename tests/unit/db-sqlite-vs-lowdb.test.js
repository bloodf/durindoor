// Compare new SQLite-backed DB layer vs legacy lowdb behavior.
// Verifies: same public API signatures + equivalent results for core operations.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let sqliteDb;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-db-compare-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  sqliteDb = await import("@/lib/db/index.js");
  await sqliteDb.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("DB SQLite layer — public API parity", () => {
  it("settings: get → defaults; update → merge", async () => {
    const s = await sqliteDb.getSettings();
    expect(s).toBeDefined();
    expect(s.cloudEnabled).toBe(false);
    expect(s.requireLogin).toBe(true);

    const updated = await sqliteDb.updateSettings({ cloudEnabled: true, customField: "x" });
    expect(updated.cloudEnabled).toBe(true);
    expect(updated.customField).toBe("x");
    expect(updated.requireLogin).toBe(true); // default preserved

    const re = await sqliteDb.getSettings();
    expect(re.cloudEnabled).toBe(true);
    expect(re.customField).toBe("x");
  });

  it("isCloudEnabled reflects settings", async () => {
    await sqliteDb.updateSettings({ cloudEnabled: true });
    expect(await sqliteDb.isCloudEnabled()).toBe(true);
    await sqliteDb.updateSettings({ cloudEnabled: false });
    expect(await sqliteDb.isCloudEnabled()).toBe(false);
  });

  it("apiKeys: create/get/validate/delete", async () => {
    const k = await sqliteDb.createApiKey("test-key", "machine-abc");
    expect(k.id).toBeDefined();
    expect(k.key).toMatch(/^sk-/);
    expect(k.machineId).toBe("machine-abc");
    expect(k.isActive).toBe(true);
    expect(k.expiresAt).toBeNull();

    const all = await sqliteDb.getApiKeys();
    expect(all.find((x) => x.id === k.id)).toBeDefined();

    expect(await sqliteDb.validateApiKey(k.key)).toBeTruthy();
    expect(await sqliteDb.validateApiKey("invalid")).toBeFalsy();

    const deleted = await sqliteDb.deleteApiKey(k.id);
    expect(deleted).toBe(true);
    expect(await sqliteDb.getApiKeyById(k.id)).toBeNull();
  });

  it("apiKeys: expiry is persisted and validated", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const k = await sqliteDb.createApiKey("expiring-key", "machine-abc", [], null, future);
    expect(k.expiresAt).toBe(future);

    expect(await sqliteDb.validateApiKey(k.key)).toBe(true);

    const retrieved = await sqliteDb.getApiKeyById(k.id);
    expect(retrieved.expiresAt).toBe(future);

    await sqliteDb.updateApiKey(k.id, { expiresAt: null });
    const updated = await sqliteDb.getApiKeyById(k.id);
    expect(updated.expiresAt).toBeNull();
    expect(await sqliteDb.validateApiKey(k.key)).toBe(true);

    await sqliteDb.deleteApiKey(k.id);
  });

  it("apiKeys: expired keys fail validation", async () => {
    const k = await sqliteDb.createApiKey("expired-key", "machine-abc", [], null);
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const past = new Date(Date.now() - 60_000).toISOString();
    db.run(`UPDATE apiKeys SET expiresAt = ? WHERE id = ?`, [past, k.id]);
    expect(await sqliteDb.validateApiKey(k.key)).toBe(false);
    await sqliteDb.deleteApiKey(k.id);
  });

  it("apiKeys: daily usage limit status uses today's API-key tokens", async () => {
    const k = await sqliteDb.createApiKey("limited-key", "machine-abc", [], 90);
    let status = await sqliteDb.getApiKeyUsageLimitStatus(k.key);
    expect(status.enforced).toBe(true);
    expect(status.exceeded).toBe(false);

    await sqliteDb.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      apiKey: k.key,
      tokens: { prompt_tokens: 60, completion_tokens: 30, reasoning_tokens: 20, cost_usd: 0.2 },
    });

    status = await sqliteDb.getApiKeyUsageLimitStatus(k.key);
    expect(status.usedTokens).toBe(90);
    expect(status.exceeded).toBe(true);

    await sqliteDb.updateApiKey(k.id, { dailyLimitTokens: null });
    status = await sqliteDb.getApiKeyUsageLimitStatus(k.key);
    expect(status.enforced).toBe(false);
    await sqliteDb.deleteApiKey(k.id);
  });

  it("providerConnections: CRUD + reorder by priority", async () => {
    const c1 = await sqliteDb.createProviderConnection({ provider: "test", authType: "apikey", name: "a", apiKey: "k1" });
    const c2 = await sqliteDb.createProviderConnection({ provider: "test", authType: "apikey", name: "b", apiKey: "k2" });
    const c3 = await sqliteDb.createProviderConnection({ provider: "test", authType: "apikey", name: "c", apiKey: "k3" });

    const list = await sqliteDb.getProviderConnections({ provider: "test" });
    expect(list).toHaveLength(3);
    expect(list[0].priority).toBe(1);
    expect(list[1].priority).toBe(2);
    expect(list[2].priority).toBe(3);

    // Update priority and reorder
    await sqliteDb.updateProviderConnection(c3.id, { priority: 1 });
    const reordered = await sqliteDb.getProviderConnections({ provider: "test" });
    expect(reordered[0].name).toBe("c");

    // Delete reorders remaining
    await sqliteDb.deleteProviderConnection(c1.id);
    const after = await sqliteDb.getProviderConnections({ provider: "test" });
    expect(after).toHaveLength(2);
    expect(after.every((c) => [1, 2].includes(c.priority))).toBe(true);
  });

  it("providerConnections: Codex OAuth with same email but different account IDs creates distinct rows", async () => {
    const first = await sqliteDb.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "shared@example.com",
      accessToken: "first-token",
      refreshToken: "first-rt",
      providerSpecificData: { chatgptAccountId: "account-a" },
    });

    const second = await sqliteDb.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "shared@example.com",
      accessToken: "second-token",
      refreshToken: "second-rt",
      providerSpecificData: { chatgptAccountId: "account-b" },
    });

    // Different ChatGPT account IDs should not collapse into a single row.
    expect(first.id).not.toBe(second.id);
    const codexConnections = await sqliteDb.getProviderConnections({ provider: "codex" });
    expect(codexConnections).toHaveLength(2);

    const bareEmail = await sqliteDb.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "shared@example.com",
      accessToken: "bare-token",
      refreshToken: "bare-rt",
      providerSpecificData: {},
    });

    // A bare-email login must not overwrite an existing account-scoped row.
    expect(bareEmail.id).not.toBe(first.id);
    expect(bareEmail.id).not.toBe(second.id);
  });

  it("providerConnections: Codex OAuth alias-normalized dedup updates the same account across aliases", async () => {
    // First login stores the account as chatgptAccountId (OAuth import).
    const first = await sqliteDb.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "alias@example.com",
      accessToken: "first-token",
      refreshToken: "first-rt",
      idToken: "first-id",
      providerSpecificData: {
        chatgptAccountId: "account-123",
        chatgptPlanType: "pro",
        proxy: { host: "proxy.example", auth: { username: "user" } },
      },
    });

    // A later login stores the same account as workspaceId (custom/manual entry).
    // The resolved account id is the same, so it should update the existing row.
    const second = await sqliteDb.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "alias@example.com",
      accessToken: "second-token",
      refreshToken: null,
      idToken: "",
      providerSpecificData: { workspaceId: "account-123", proxy: { auth: { password: "pass" } } },
    });

    expect(first.id).toBe(second.id);

    const updated = await sqliteDb.getProviderConnectionById(second.id);
    expect(updated.accessToken).toBe("second-token");
    expect(updated.refreshToken).toBe("first-rt");
    expect(updated.idToken).toBe("first-id");
    expect(updated.providerSpecificData).toEqual({
      chatgptAccountId: "account-123",
      workspaceId: "account-123",
      chatgptPlanType: "pro",
      proxy: { host: "proxy.example", auth: { username: "user", password: "pass" } },
    });
  });

  it("providerConnections: concurrent Codex callbacks converge only for the same identity", async () => {
    const create = (accountId, token) => sqliteDb.createProviderConnection({
      provider: "codex", authType: "oauth", email: "concurrent@example.com",
      accessToken: token, providerSpecificData: { chatgptAccountId: accountId },
    });

    const same = await Promise.all([create("same-account", "one"), create("same-account", "two")]);
    const distinct = await Promise.all([create("other-a", "three"), create("other-b", "four")]);

    expect(new Set(same.map((row) => row.id)).size).toBe(1);
    expect(distinct[0].id).not.toBe(distinct[1].id);
  });

  it("providerConnections: Codex OAuth bare-email rows with the same email stay distinct", async () => {
    const first = await sqliteDb.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "bare-only@example.com",
      accessToken: "first-token",
      refreshToken: "first-rt",
      providerSpecificData: {},
    });

    const second = await sqliteDb.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "bare-only@example.com",
      accessToken: "second-token",
      refreshToken: "second-rt",
      providerSpecificData: {},
    });

    // Bare-email rows used to collapse and overwrite each other; they should now remain distinct.
    expect(first.id).not.toBe(second.id);
  });

  // Regression port of OmniRoute #6706 (avoid bare-email dedup of Codex OAuth
  // logins). Same-account merge, different-account isolation, and bare-email
  // isolation are covered by the Codex tests above; this adds the missing
  // cross-provider control: a same-email row under another provider must
  // never merge into or be overwritten by codex logins (the dedup lookup is
  // scoped by provider).
  it("providerConnections: same-email row under a different provider stays isolated from Codex OAuth dedup", async () => {
    const codexLogin = await sqliteDb.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "xprov@example.com",
      accessToken: "token-codex",
      refreshToken: "refresh-codex",
      providerSpecificData: { chatgptAccountId: "user-a" },
    });

    const other = await sqliteDb.createProviderConnection({
      provider: "gemini",
      authType: "oauth",
      email: "xprov@example.com",
      accessToken: "token-gemini",
      refreshToken: "refresh-gemini",
      providerSpecificData: {},
    });
    expect(other.id).not.toBe(codexLogin.id);

    // A second codex login for a DIFFERENT account sharing the email inserts
    // a new row — it must not collapse onto either existing row.
    const codexLoginB = await sqliteDb.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "xprov@example.com",
      accessToken: "token-codex-b",
      refreshToken: "refresh-codex-b",
      providerSpecificData: { chatgptAccountId: "user-b" },
    });
    expect(codexLoginB.id).not.toBe(codexLogin.id);
    expect(codexLoginB.id).not.toBe(other.id);

    const codexRows = (await sqliteDb.getProviderConnections({ provider: "codex" }))
      .filter((row) => row.email === "xprov@example.com");
    expect(codexRows).toHaveLength(2);

    // Original token pairs on both pre-existing rows are untouched.
    const rowCodex = await sqliteDb.getProviderConnectionById(codexLogin.id);
    expect(rowCodex.accessToken).toBe("token-codex");
    expect(rowCodex.refreshToken).toBe("refresh-codex");
    const rowOther = await sqliteDb.getProviderConnectionById(other.id);
    expect(rowOther.accessToken).toBe("token-gemini");
    expect(rowOther.refreshToken).toBe("refresh-gemini");
  });

  it("providerConnections: optional fields persisted via JSON column", async () => {
    const c = await sqliteDb.createProviderConnection({
      provider: "p2", authType: "oauth", email: "x@y.com",
      accessToken: "tok", refreshToken: "rtok", expiresAt: 12345,
      providerSpecificData: { foo: "bar" },
    });
    const back = await sqliteDb.getProviderConnectionById(c.id);
    expect(back.accessToken).toBe("tok");
    expect(back.refreshToken).toBe("rtok");
    expect(back.expiresAt).toBe(12345);
    expect(back.providerSpecificData).toEqual({ foo: "bar" });
  });

  it("providerConnections: GitHub OAuth uses account identity as fallback name", async () => {
    const c = await sqliteDb.createProviderConnection({
      provider: "github",
      authType: "oauth",
      accessToken: "tok",
      providerSpecificData: { githubLogin: "octocat" },
    });

    expect(c.name).toBe("octocat");
    const back = await sqliteDb.getProviderConnectionById(c.id);
    expect(back.name).toBe("octocat");
  });

  it("providerNodes: CRUD", async () => {
    const n = await sqliteDb.createProviderNode({ type: "openai", name: "Test", baseUrl: "https://api.test", apiType: "openai" });
    expect(n.id).toBeDefined();
    expect(n.baseUrl).toBe("https://api.test");

    const all = await sqliteDb.getProviderNodes({ type: "openai" });
    expect(all.find((x) => x.id === n.id)).toBeDefined();

    await sqliteDb.updateProviderNode(n.id, { name: "Test2" });
    const updated = await sqliteDb.getProviderNodeById(n.id);
    expect(updated.name).toBe("Test2");

    await sqliteDb.deleteProviderNode(n.id);
    expect(await sqliteDb.getProviderNodeById(n.id)).toBeNull();
  });

  it("proxyPools: CRUD with sort by updatedAt desc", async () => {
    const p1 = await sqliteDb.createProxyPool({ name: "p1", proxyUrl: "http://a", type: "http" });
    await new Promise((r) => setTimeout(r, 10));
    const p2 = await sqliteDb.createProxyPool({ name: "p2", proxyUrl: "http://b", type: "http" });
    const list = await sqliteDb.getProxyPools();
    expect(list[0].id).toBe(p2.id); // newest first
    await sqliteDb.deleteProxyPool(p1.id);
    await sqliteDb.deleteProxyPool(p2.id);
  });

  it("combos: CRUD", async () => {
    const c = await sqliteDb.createCombo({ name: "combo1", models: ["m1", "m2"], kind: "fallback" });
    expect(c.id).toBeDefined();
    expect(c.models).toEqual(["m1", "m2"]);
    const byName = await sqliteDb.getComboByName("combo1");
    expect(byName.id).toBe(c.id);
    await sqliteDb.updateCombo(c.id, { models: ["m3"] });
    const updated = await sqliteDb.getComboById(c.id);
    expect(updated.models).toEqual(["m3"]);
    expect(await sqliteDb.deleteCombo(c.id)).toBe(true);
  });

  it("modelAliases: KV ops", async () => {
    await sqliteDb.setModelAlias("alias1", "real-model-1");
    await sqliteDb.setModelAlias("alias2", "real-model-2");
    const all = await sqliteDb.getModelAliases();
    expect(all.alias1).toBe("real-model-1");
    expect(all.alias2).toBe("real-model-2");
    await sqliteDb.deleteModelAlias("alias1");
    expect((await sqliteDb.getModelAliases()).alias1).toBeUndefined();
  });

  it("customModels: add/list/delete with dedupe", async () => {
    const ok1 = await sqliteDb.addCustomModel({ providerAlias: "p1", id: "m1", type: "llm", name: "Model 1" });
    const dup = await sqliteDb.addCustomModel({ providerAlias: "p1", id: "m1", type: "llm" });
    expect(ok1).toBe(true);
    expect(dup).toBe(false);
    const list = await sqliteDb.getCustomModels();
    expect(list.find((m) => m.id === "m1")).toBeDefined();
    await sqliteDb.deleteCustomModel({ providerAlias: "p1", id: "m1" });
    const after = await sqliteDb.getCustomModels();
    expect(after.find((m) => m.id === "m1")).toBeUndefined();
  });

  it("mitmAlias: get/set per tool", async () => {
    await sqliteDb.setMitmAliasAll("cursor", { "gpt-5": "claude-3" });
    const a = await sqliteDb.getMitmAlias("cursor");
    expect(a["gpt-5"]).toBe("claude-3");
    const all = await sqliteDb.getMitmAlias();
    expect(all.cursor).toEqual({ "gpt-5": "claude-3" });
  });

  it("disabledModels: add/remove per provider", async () => {
    await sqliteDb.disableModels("openai", ["gpt-3", "gpt-4"]);
    expect(await sqliteDb.getDisabledByProvider("openai")).toEqual(expect.arrayContaining(["gpt-3", "gpt-4"]));
    await sqliteDb.enableModels("openai", ["gpt-3"]);
    expect(await sqliteDb.getDisabledByProvider("openai")).toEqual(["gpt-4"]);
    await sqliteDb.enableModels("openai", []);
    expect(await sqliteDb.getDisabledByProvider("openai")).toEqual([]);
  });

  it("usage: saveRequestUsage + getUsageHistory + getUsageStats", async () => {
    await sqliteDb.saveRequestUsage({
      provider: "openai", model: "gpt-4", connectionId: "c1",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
      endpoint: "/v1/chat/completions", status: "ok",
    });
    await sqliteDb.saveRequestUsage({
      provider: "openai", model: "gpt-4", connectionId: "c1",
      tokens: { prompt_tokens: 200, completion_tokens: 100 },
      endpoint: "/v1/chat/completions", status: "ok",
    });

    const hist = await sqliteDb.getUsageHistory({ provider: "openai" });
    expect(hist.length).toBeGreaterThanOrEqual(2);
    expect(hist[0].tokens.prompt_tokens).toBeDefined();

    const stats = await sqliteDb.getUsageStats("24h");
    expect(stats.totalRequests).toBeGreaterThanOrEqual(2);
    expect(stats.byProvider.openai).toBeDefined();
    expect(stats.byProvider.openai.requests).toBeGreaterThanOrEqual(2);
    expect(stats.byProvider.openai.promptTokens).toBeGreaterThanOrEqual(300);
  });

  it("usage: 24h and today byApiKey keep keys with the same masked prefix separate", async () => {
    await sqliteDb.importDb({
      settings: {},
      apiKeys: [
        { id: "ak-collision-1", key: "sk-c84eb11fa877e0e9-aaaaaa-11111111", name: "collision-one", machineId: "m1", isActive: true },
        { id: "ak-collision-2", key: "sk-c84eb11fa877e0e9-bbbbbb-22222222", name: "collision-two", machineId: "m2", isActive: true },
      ],
    });

    await sqliteDb.saveRequestUsage({
      provider: "codex", model: "gpt-5.5", connectionId: "c1",
      apiKey: "sk-c84eb11fa877e0e9-aaaaaa-11111111",
      tokens: { prompt_tokens: 11, completion_tokens: 5 },
      endpoint: "/v1/chat/completions", status: "ok",
    });
    await sqliteDb.saveRequestUsage({
      provider: "codex", model: "gpt-5.5", connectionId: "c1",
      apiKey: "sk-c84eb11fa877e0e9-bbbbbb-22222222",
      tokens: { prompt_tokens: 17, completion_tokens: 7 },
      endpoint: "/v1/chat/completions", status: "ok",
    });

    for (const period of ["24h", "today"]) {
      const stats = await sqliteDb.getUsageStats(period);
      const entries = Object.values(stats.byApiKey).filter((entry) => entry.rawModel === "gpt-5.5" && entry.provider === "codex");

      expect(entries).toHaveLength(2);
      expect(entries.map((entry) => entry.keyName).sort()).toEqual(["collision-one", "collision-two"]);
      expect(entries.map((entry) => entry.requests).sort()).toEqual([1, 1]);
      expect(entries.every((entry) => entry.apiKeyMasked === "***")).toBe(true);
      // Registered keys use their non-secret database IDs. The response never
      // exposes a raw prefix or an offline-verifiable digest.
      expect(new Set(entries.map((entry) => entry.apiKeyKey)).size).toBe(2);
      expect(entries.every((entry) => entry.apiKeyKey !== entry.apiKeyMasked)).toBe(true);
      expect(entries.map((entry) => entry.apiKeyKey).sort()).toEqual([
        "api-key:ak-collision-1",
        "api-key:ak-collision-2",
      ]);
      expect(Object.keys(stats.byApiKey).some((key) => key.includes("sk-c84eb11fa877e0e9"))).toBe(false);
    }
  });

  it("never exposes legacy key material or an offline-verifiable digest", async () => {
    const legacySecret = "sk-deadbeef";
    await sqliteDb.importDb({
      settings: {},
      apiKeys: [{ id: "legacy-key-id", key: legacySecret, name: "Legacy key", machineId: "m1", isActive: true }],
    });
    await sqliteDb.saveRequestUsage({
      provider: "openai", model: "gpt-4o", apiKey: legacySecret,
      tokens: { prompt_tokens: 7, completion_tokens: 3 },
      endpoint: "/v1/chat/completions", status: "ok",
    });

    const expectedHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(legacySecret));
    const hexHash = Array.from(new Uint8Array(expectedHash), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const payloads = [
      await sqliteDb.getUsageHistory({ provider: "openai" }),
      await sqliteDb.getUsageStats("24h"),
      await sqliteDb.getUsageStats("7d"),
    ];

    for (const payload of payloads) {
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain(legacySecret);
      expect(serialized).not.toContain("sk-dead");
      expect(serialized).not.toContain(hexHash);
    }
    expect(payloads[0].some((row) => row.apiKeyMasked === "***")).toBe(true);
    for (const stats of payloads.slice(1)) {
      const entry = Object.values(stats.byApiKey).find((row) => row.apiKeyKey === "api-key:legacy-key-id");
      expect(entry).toMatchObject({
        apiKeyMasked: "***",
        apiKeyKey: "api-key:legacy-key-id",
        keyName: "Legacy key",
      });
    }
  });

  it("usage: pending tracking in-memory", () => {
    sqliteDb.trackPendingRequest("gpt-4", "openai", "c1", true);
    expect(global._pendingRequests.byModel["gpt-4 (openai)"]).toBe(1);
    sqliteDb.trackPendingRequest("gpt-4", "openai", "c1", false);
    expect(global._pendingRequests.byModel["gpt-4 (openai)"]).toBeUndefined();
  });

  /** Regression contract: oversized observable request bodies retain tool definitions up to the dedicated 64 KiB tools budget. */
  it("requestDetails: save → query with paging", async () => {
    // Enable observability first; force tiny JSON budget so request/providerRequest
    // bodies truncate while their `tools` arrays are preserved under the dedicated
    // tools budget (upstream #2281).
    await sqliteDb.updateSettings({ enableObservability: true, observabilityBatchSize: 1, observabilityMaxJsonSize: 1 });

    const bigTools = [{ type: "function", function: { name: "lookup_weather", description: "x".repeat(200) } }];
    await sqliteDb.saveRequestDetail({
      id: "d1", provider: "openai", model: "gpt-4", connectionId: "c1",
      status: "ok", tokens: { prompt_tokens: 10 },
      request: { method: "POST", messages: "m".repeat(5000), tools: bigTools },
      providerRequest: { url: "/v1/chat", body: "b".repeat(5000), tools: bigTools },
      response: { status: 200 },
    });

    // Wait for buffer flush
    await new Promise((r) => setTimeout(r, 200));

    const got = await sqliteDb.getRequestDetailById("d1");
    expect(got).toBeDefined();
    expect(got.id).toBe("d1");

    // Bodies truncated but tools retained under separate 64 KiB budget.
    expect(got.request?._truncated).toBe(true);
    expect(got.request?.tools).toEqual(bigTools);
    expect(got.providerRequest?._truncated).toBe(true);
    expect(got.providerRequest?.tools).toEqual(bigTools);

    const list = await sqliteDb.getRequestDetails({ provider: "openai" });
    expect(list.details.length).toBeGreaterThanOrEqual(1);
    expect(list.pagination.totalItems).toBeGreaterThanOrEqual(1);
  });

  it("exportDb / importDb roundtrip", async () => {
    const exported = await sqliteDb.exportDb();
    expect(exported.settings).toBeDefined();
    expect(Array.isArray(exported.providerConnections)).toBe(true);
    expect(typeof exported.modelAliases).toBe("object");
    expect(exported.apiKeys.every((k) => k.expiresAt !== undefined)).toBe(true);

    // Add marker, export a key with an expiry, import a different payload, verify reset
    await sqliteDb.setModelAlias("marker", "before");
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await sqliteDb.createApiKey("roundtrip-key", "machine-abc", [], null, future);
    const snap = await sqliteDb.exportDb();

    await sqliteDb.setModelAlias("marker", "after");
    expect((await sqliteDb.getModelAliases()).marker).toBe("after");

    await sqliteDb.importDb(snap);
    expect((await sqliteDb.getModelAliases()).marker).toBe("before");
    const roundtripKey = (await sqliteDb.getApiKeys()).find((k) => k.name === "roundtrip-key");
    expect(roundtripKey).toBeDefined();
    expect(roundtripKey.expiresAt).toBe(future);
    if (roundtripKey) await sqliteDb.deleteApiKey(roundtripKey.id);
  });

  it("pricing: user pricing merged with constants", async () => {
    await sqliteDb.updatePricing({ openai: { "gpt-test": { input: 1, output: 2 } } });
    const p = await sqliteDb.getPricing();
    expect(p.openai["gpt-test"]).toEqual({ input: 1, output: 2 });

    const single = await sqliteDb.getPricingForModel("openai", "gpt-test");
    expect(single).toEqual({ input: 1, output: 2 });

    await sqliteDb.resetPricing("openai", "gpt-test");
    expect((await sqliteDb.getPricing()).openai?.["gpt-test"]).toBeUndefined();
  });

  it("getChartData: 24h buckets", async () => {
    const data = await sqliteDb.getChartData("24h");
    expect(data).toHaveLength(24);
    expect(data[0]).toHaveProperty("label");
    expect(data[0]).toHaveProperty("tokens");
    expect(data[0]).toHaveProperty("cost");
  });

  it("getChartData: 7d buckets", async () => {
    const data = await sqliteDb.getChartData("7d");
    expect(data).toHaveLength(7);
  });

  it("getChartData: 90d buckets", async () => {
    const data = await sqliteDb.getChartData("90d");
    expect(data).toHaveLength(90);
  });

  it("getChartData: all-time returns sorted daily series", async () => {
    const data = await sqliteDb.getChartData("all");
    expect(Array.isArray(data)).toBe(true);
    for (const point of data) {
      expect(point).toHaveProperty("label");
      expect(point).toHaveProperty("tokens");
      expect(point).toHaveProperty("cost");
    }
  });
});
