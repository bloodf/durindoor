import { beforeEach, describe, expect, it, vi } from "vitest";

// Model auto-sync service: real fetchConnectionModels + modelsConfig paths,
// with the provider HTTP call (proxyAwareFetch) mocked per provider URL and
// the kv store kept in memory.

const db = vi.hoisted(() => ({
  connections: [],
  settings: {},
  catalogs: {},
  combos: [],
  aliases: {},
  customModels: []
}));
const routedFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async (filter = {}) => db.connections.filter((c) =>
  (!filter.provider || c.provider === filter.provider) && (filter.isActive === undefined || c.isActive === filter.isActive))),
  getSettings: vi.fn(async () => db.settings),
  getCombos: vi.fn(async () => db.combos),
  getModelAliases: vi.fn(async () => db.aliases),
  getCustomModels: vi.fn(async () => db.customModels),
  getSyncedModelCatalog: vi.fn(async (id) => db.catalogs[id] || null),
  getSyncedModelCatalogs: vi.fn(async () => ({ ...db.catalogs })),
  saveSyncedModelCatalog: vi.fn(async (id, entry) => {db.catalogs[id] = entry;})
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => null) }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: routedFetch }));
vi.mock("@/sse/services/tokenRefresh", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, creds) => creds),
  refreshGoogleToken: vi.fn(),
  updateProviderCredentials: vi.fn()
}));

import { runModelAutoSync, syncProviderModels } from "../../src/lib/modelAutoSync/runner.js";
import { modelAutoSyncTick } from "../../src/lib/modelAutoSync/scheduler.js";

const NOW = Date.parse("2026-09-23T12:00:00Z");

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: "",
  json: async () => body,
  text: async () => JSON.stringify(body)
});

/** Route mocked provider responses by URL substring. */
function respond(routes) {
  routedFetch.mockImplementation(async (url) => {
    const match = Object.keys(routes).find((key) => String(url).includes(key));
    if (!match) throw new Error(`unexpected fetch ${url}`);
    const value = routes[match];
    return typeof value === "function" ? value(url) : value;
  });
}

function connect(provider, extra = {}) {
  db.connections.push({ id: `${provider}-1`, provider, isActive: true, apiKey: `${provider}-key`, ...extra });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.connections = [];
  db.settings = {};
  db.catalogs = {};
  db.combos = [];
  db.aliases = {};
  db.customModels = [];
});

describe("syncProviderModels per provider", () => {
  it("openai: GET /v1/models with Bearer, filters non-chat models, stores the catalog", async () => {
    connect("openai");
    respond({
      "api.openai.com/v1/models": json({ data: [
        { id: "gpt-7" }, { id: "text-embedding-3-large" }, { id: "omni-moderation-latest" }, { id: "whisper-1" }
      ] })
    });
    const result = await syncProviderModels("openai", { now: NOW });
    expect(result.status).toBe("synced");
    expect(routedFetch).toHaveBeenCalledWith("https://api.openai.com/v1/models",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer openai-key" }) }), null);
    expect(db.catalogs.openai.models.map((m) => [m.id, m.kind])).toEqual([
      ["gpt-7", "llm"], ["text-embedding-3-large", "embedding"], ["whisper-1", "stt"]
    ]);
    expect(db.catalogs.openai.newModelIds).toContain("gpt-7");
    // Registry defaults the API did not return are reported as removed.
    expect(db.catalogs.openai.removedModelIds.length).toBeGreaterThan(0);
  });

  it("anthropic: x-api-key header and API-reported limits", async () => {
    connect("anthropic", { apiKey: "sk-ant-api03-x" });
    respond({
      "api.anthropic.com/v1/models": json({ data: [{ id: "claude-opus-6", display_name: "Claude Opus 6", max_input_tokens: 1_000_000, max_tokens: 128_000 }] })
    });
    await syncProviderModels("anthropic", { now: NOW });
    const [, init] = routedFetch.mock.calls[0];
    expect(init.headers["x-api-key"]).toBe("sk-ant-api03-x");
    expect(db.catalogs.anthropic.models[0]).toMatchObject({
      id: "claude-opus-6",
      name: "Claude Opus 6",
      capabilities: { contextWindow: 1_000_000, maxOutput: 128_000 }
    });
  });

  it("claude OAuth: Bearer token plus the oauth beta header", async () => {
    connect("claude", { apiKey: undefined, accessToken: "oauth-token" });
    respond({ "api.anthropic.com/v1/models": json({ data: [{ id: "claude-opus-6" }] }) });
    const result = await syncProviderModels("claude", { now: NOW });
    expect(result.status).toBe("synced");
    const [, init] = routedFetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer oauth-token");
    expect(init.headers["Anthropic-Beta"]).toBe("oauth-2025-04-20");
  });

  it("xai: grok list, image models routed to the image kind", async () => {
    connect("xai");
    respond({ "api.x.ai/v1/models": json({ data: [{ id: "grok-5" }, { id: "grok-2-image-1212" }] }) });
    await syncProviderModels("xai", { now: NOW });
    expect(db.catalogs.xai.models.map((m) => [m.id, m.kind])).toEqual([["grok-5", "llm"], ["grok-2-image-1212", "image"]]);
  });

  it("gemini: key query param, models/ prefix stripped, embed-only kept as embedding", async () => {
    connect("gemini");
    respond({
      "generativelanguage.googleapis.com": json({ models: [
        { name: "models/gemini-3.9-pro", supportedGenerationMethods: ["generateContent"], inputTokenLimit: 2_000_000 },
        { name: "models/gemini-embedding-002", supportedGenerationMethods: ["embedContent"] },
        { name: "models/aqa", supportedGenerationMethods: ["generateAnswer"] }
      ] })
    });
    await syncProviderModels("gemini", { now: NOW });
    expect(String(routedFetch.mock.calls[0][0])).toContain("?key=gemini-key");
    expect(db.catalogs.gemini.models.map((m) => [m.id, m.kind])).toEqual([
      ["gemini-3.9-pro", "llm"], ["gemini-embedding-002", "embedding"]
    ]);
  });

  it("codex: models endpoint, minimal_client_version gate, no synthesized review rows", async () => {
    connect("codex", { apiKey: undefined, accessToken: "codex-token" });
    respond({ "chatgpt.com/backend-api/codex/models": json({ models: [
      { slug: "gpt-6-sol", context_window: 272_000 },
      { slug: "gpt-future", minimal_client_version: "999.0.0" }
    ] }) });
    await syncProviderModels("codex", { now: NOW });
    expect(db.catalogs.codex.models.map((m) => m.id)).toEqual(["gpt-6-sol"]);
    expect(db.catalogs.codex.models[0].capabilities).toEqual({ contextWindow: 272_000 });
  });
});

describe("syncProviderModels: github copilot", () => {
  it("syncs the Copilot chat catalog with its limits", async () => {
    connect("github", {
      apiKey: undefined,
      accessToken: "gh-token",
      providerSpecificData: { copilotToken: "cp-token", copilotTokenExpiresAt: Math.floor(NOW / 1000) + 3600 }
    });
    respond({ "api.githubcopilot.com/models": json({ data: [
      { id: "gpt-7", name: "GPT 7", capabilities: { type: "chat", limits: { max_context_window_tokens: 400_000 }, supports: { vision: true } } },
      { id: "text-embedding-3-small", capabilities: { type: "embeddings" } }
    ] }) });
    const result = await syncProviderModels("github", { now: NOW });
    expect(result.status).toBe("synced");
    expect(db.catalogs.github.models).toEqual([
      { id: "gpt-7", name: "GPT 7", kind: "llm", capabilities: { contextWindow: 400_000, vision: true } }
    ]);
  });
});

describe("syncProviderModels safety rules", () => {
  const good = () => ({
    syncedAt: "2026-09-22T12:00:00.000Z",
    lastAttemptAt: "2026-09-22T12:00:00.000Z",
    error: null,
    newModelIds: [],
    removedModelIds: [],
    models: [{ id: "gpt-7", name: "gpt-7", kind: "llm" }]
  });

  it.each([
    ["an HTTP error", () => json({ error: "bad key" }, 401)],
    ["an empty list", () => json({ data: [] })],
    ["a list with no routable models", () => json({ data: [{ id: "omni-moderation-latest" }] })],
    ["a network error", () => {throw new Error("ECONNRESET");}]
  ])("keeps the previous list on %s", async (_label, reply) => {
    connect("openai");
    db.catalogs.openai = good();
    respond({ "api.openai.com": reply });
    const result = await syncProviderModels("openai", { now: NOW });
    expect(result.status).toBe("failed");
    expect(db.catalogs.openai.models).toEqual(good().models);
    expect(db.catalogs.openai.syncedAt).toBe(good().syncedAt);
    expect(db.catalogs.openai.error).toBeTruthy();
  });

  it("keeps the previous list on a timeout", async () => {
    connect("openai");
    db.catalogs.openai = good();
    const result = await syncProviderModels("openai", {
      now: NOW,
      timeoutMs: 10,
      fetchModels: () => new Promise(() => {})
    });
    expect(result).toMatchObject({ status: "failed", error: expect.stringContaining("Timed out") });
    expect(db.catalogs.openai.models).toEqual(good().models);
  });

  it("skips providers without an active connection or list-models API", async () => {
    expect((await syncProviderModels("openai")).status).toBe("skipped");
    expect((await syncProviderModels("openrouter")).status).toBe("skipped");
    expect(routedFetch).not.toHaveBeenCalled();
  });
});

describe("runModelAutoSync", () => {
  it("one provider failing does not stop the others", async () => {
    connect("openai");
    connect("xai");
    respond({
      "api.openai.com": () => {throw new Error("down");},
      "api.x.ai": json({ data: [{ id: "grok-5" }] })
    });
    const results = await runModelAutoSync({ now: NOW });
    expect(results.map((r) => [r.providerId, r.status])).toEqual([["openai", "failed"], ["xai", "synced"]]);
  });

  it("scheduled runs skip providers that are toggled off or not due", async () => {
    connect("openai");
    connect("xai");
    connect("groq");
    db.settings = { modelAutoSyncProviders: { xai: false } };
    db.catalogs.openai = { lastAttemptAt: new Date(NOW - 60 * 1000).toISOString(), models: [] };
    respond({});
    const results = await runModelAutoSync({ now: NOW });
    expect(results).toEqual([]);
    expect(routedFetch).not.toHaveBeenCalled();
  });

  it("a manual provider run ignores the interval and the toggle", async () => {
    connect("xai");
    db.settings = { modelAutoSyncProviders: { xai: false } };
    db.catalogs.xai = { lastAttemptAt: new Date(NOW).toISOString(), models: [] };
    respond({ "api.x.ai": json({ data: [{ id: "grok-5" }] }) });
    const results = await runModelAutoSync({ providerIds: ["xai"], force: true, now: NOW });
    expect(results).toEqual([expect.objectContaining({ providerId: "xai", status: "synced" })]);
  });

  it("logs combos and aliases that reference a pruned model, without rewriting them", async () => {
    connect("openai");
    db.combos = [{ name: "daily", models: ["openai/gpt-5", "openai/gpt-7", "openai/my-tune"] }];
    db.aliases = { old: "openai/gpt-5" };
    db.customModels = [{ id: "my-tune", providerAlias: "openai" }];
    respond({ "api.openai.com": json({ data: [{ id: "gpt-7" }] }) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runModelAutoSync({ now: NOW });
    const lines = warn.mock.calls.map((c) => c[0]).join("\n");
    warn.mockRestore();
    expect(lines).toContain(`combo "daily" references models no longer listed: openai/gpt-5`);
    expect(lines).toContain(`alias "old" points at a model no longer listed: openai/gpt-5`);
    expect(lines).not.toContain("my-tune");
    expect(db.combos[0].models).toEqual(["openai/gpt-5", "openai/gpt-7", "openai/my-tune"]);
  });

  it("the scheduler tick does nothing when the interval is 0", async () => {
    connect("openai");
    db.settings = { modelAutoSyncIntervalHours: 0 };
    respond({});
    expect(await modelAutoSyncTick()).toEqual([]);
    expect(routedFetch).not.toHaveBeenCalled();
  });
});
