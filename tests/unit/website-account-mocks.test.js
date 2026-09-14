import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the browser demo's real router, persistence and response conversion.
// No production route, user database or provider network endpoint is imported.
async function loadDemo() {
  const [storage, routing, http, fixtures, connections, quota, models, oauth] = await Promise.all([
    import("../../website/src/mock/store.js"),
    import("../../website/src/mock/router.js"),
    import("../../website/src/mock/http.js"),
    import("../../website/src/mock/fixtures/providers/connections.js"),
    import("../../website/src/mock/handlers/providers/connections.js"),
    import("../../website/src/mock/handlers/providers/quota.js"),
    import("../../website/src/mock/handlers/providers/models.js"),
    import("../../website/src/mock/handlers/providers/oauth.js"),
  ]);
  const { store } = storage;
  store.define("providers.connections", fixtures.seedConnections);
  store.define("providers.nodes", fixtures.seedProviderNodes);
  const router = routing.createRouter();
  for (const handler of [connections, quota, models, oauth]) handler.default(router, { store });
  return {
    reset: storage.resetDemoData,
    async request(method, path, body) {
      const url = new URL(path, "https://demo.example");
      const matched = router.match(method, url.pathname);
      if (!matched) throw new Error(`Unregistered demo route: ${method} ${path}`);
      const result = await matched.route.handler({
        params: matched.params, query: Object.fromEntries(url.searchParams), searchParams: url.searchParams, url, body,
      });
      const response = http.toResponse(result);
      return { status: response.status, data: await response.json() };
    },
  };
}

const SEEDED_PROVIDERS = [
  "claude", "anthropic", "codex", "gemini-cli", "github", "antigravity", "kiro", "cursor", "groq",
  "openrouter", "deepseek", "ollama-local", "openai-compatible-ravenhill", "openai", "elevenlabs", "tavily", "firecrawl", "custom-embedding-forge",
];
const QUOTA_KEYS = {
  claude: "session (5h)", codex: "session", "gemini-cli": "gemini-3.1-pro-preview", github: "premium_interactions",
  antigravity: "gemini-3.8-flash-high", kiro: "credit", cursor: "Included spend", deepseek: "Balance (USD)",
};

let persisted;
let demo;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-13T12:00:00Z"));
  persisted = new Map();
  vi.stubGlobal("localStorage", {
    get length() { return persisted.size; },
    key(index) { return [...persisted.keys()][index] ?? null; },
    getItem(key) { return persisted.get(key) ?? null; },
    setItem(key, value) { persisted.set(key, String(value)); },
    removeItem(key) { persisted.delete(key); },
  });
  demo = await loadDemo();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("website account mock contracts", () => {
  it("offers distinct fallback accounts for every seeded provider, including media, without invented universal quotas", async () => {
    const { data } = await demo.request("GET", "/api/providers");
    expect([...new Set(data.connections.map((account) => account.provider))].sort()).toEqual([...SEEDED_PROVIDERS].sort());
    for (const provider of SEEDED_PROVIDERS) {
      const accounts = data.connections.filter((account) => account.provider === provider);
      expect(accounts.length, provider).toBeGreaterThanOrEqual(2);
      expect(new Set(accounts.map((account) => account.name)).size, provider).toBe(accounts.length);
      expect(new Set(accounts.map((account) => account.priority)).size, provider).toBe(accounts.length);
      expect(new Set(accounts.map((account) => `${account.isActive}:${account.testStatus}`)).size, provider).toBeGreaterThan(1);
      for (const account of accounts) {
        expect(account).not.toHaveProperty("demoQuota");
        const quota = await demo.request("GET", `/api/usage/${account.id}`);
        expect(quota.status).toBe(200);
        if (QUOTA_KEYS[provider]) {
          expect(Object.keys(quota.data.quotas)).toContain(QUOTA_KEYS[provider]);
        } else {
          expect(quota.data).not.toHaveProperty("quotas");
          expect(quota.data.message).toEqual(expect.any(String));
        }
      }
    }
  });

  it("redeems the exhausted backup account atomically and restores its quota, credits and availability after module reload", async () => {
    const before = (await demo.request("GET", "/api/usage/conn-codex-backup")).data;
    const siblingBefore = (await demo.request("GET", "/api/usage/conn-codex-main")).data;
    expect(before.limitReached).toBe(true);
    expect(before.quotas.session.remaining).toBe(0);
    const redeemed = await demo.request("POST", "/api/usage/conn-codex-backup/codex-reset-credits");
    expect(redeemed).toMatchObject({ status: 200, data: { code: "ok", reset: true, windows_reset: 2 } });
    expect(redeemed.data.credit.id).toBe(before.resetCredits.credits[0].id);
    const after = (await demo.request("GET", "/api/usage/conn-codex-backup")).data;
    expect(after).toMatchObject({ limitReached: false, reviewLimitReached: false, sparkLimitReached: false, resetCredits: { availableCount: 0 } });
    for (const [name, window] of Object.entries(after.quotas)) {
      expect(window.used).toBe(0);
      expect(window.remaining).toBe(window.total);
      expect(window.total).toBe(before.quotas[name].total);
    }
    expect((await demo.request("GET", "/api/usage/conn-codex-main")).data).toEqual(siblingBefore);
    vi.resetModules();
    demo = await loadDemo();
    expect((await demo.request("GET", "/api/usage/conn-codex-backup")).data).toEqual(after);
    expect((await demo.request("GET", "/api/usage/conn-codex-main")).data).toEqual(siblingBefore);
    expect((await demo.request("GET", "/api/usage/conn-codex-backup/codex-reset-credits")).data).toEqual(after.resetCredits);
    const connection = (await demo.request("GET", "/api/providers/conn-codex-backup")).data.connection;
    expect(connection).toMatchObject({ testStatus: "active", lastError: null, lastErrorType: null, errorCode: null, rateLimitedUntil: null, "modelLock_gpt-5.5": null });
    expect((await demo.request("GET", "/api/models/availability")).data.models.some((item) => item.connectionId === connection.id)).toBe(false);
    const health = (await demo.request("GET", "/api/health/providers")).data.providers;
    expect(health.find((item) => item.id === connection.id)).toMatchObject({ state: "healthy", statusCode: 200, error: null });
  });

  it("consumes distinct credit identities and rejects insufficient balance without changing any persisted account", async () => {
    const first = await demo.request("POST", "/api/usage/conn-codex-main/codex-reset-credits");
    const second = await demo.request("POST", "/api/usage/conn-codex-main/codex-reset-credits");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.data.credit.id).not.toBe(second.data.credit.id);
    const quotaBefore = (await demo.request("GET", "/api/usage/conn-codex-main")).data;
    const accountsBefore = (await demo.request("GET", "/api/providers")).data;
    const storageBefore = [...persisted];
    const rejected = await demo.request("POST", "/api/usage/conn-codex-main/codex-reset-credits");
    expect(rejected).toMatchObject({ status: 409, data: { code: "no_credit", reset: false, windows_reset: 0 } });
    expect([...persisted]).toEqual(storageBefore);
    expect((await demo.request("GET", "/api/usage/conn-codex-main")).data).toEqual(quotaBefore);
    expect((await demo.request("GET", "/api/providers")).data).toEqual(accountsBefore);
  });

  it("keeps newly connected provider quotas specific, persists edits and removes deleted account quota access", async () => {
    const created = await demo.request("POST", "/api/oauth/github/import-token", "demo-token");
    expect(created.status).toBe(200);
    const { id } = created.data.connection;
    const before = (await demo.request("GET", `/api/usage/${id}`)).data;
    expect(before.quotas.premium_interactions).toMatchObject({ total: 300, used: 72, remaining: 228 });
    expect(before.quotas).not.toHaveProperty("session");
    await demo.request("PATCH", `/api/providers/${id}`, { name: "Dale reviewer", isActive: false });
    vi.resetModules();
    demo = await loadDemo();
    expect((await demo.request("GET", `/api/providers/${id}`)).data.connection).toMatchObject({ name: "Dale reviewer", isActive: false });
    expect((await demo.request("GET", `/api/usage/${id}`)).data).toEqual(before);
    expect((await demo.request("DELETE", `/api/providers/${id}`)).status).toBe(200);
    expect((await demo.request("GET", `/api/usage/${id}`)).status).toBe(404);
  });

  it("rejects non-Codex redemption without writes and resets edited demo accounts without touching unrelated storage", async () => {
    const before = [...persisted];
    expect((await demo.request("POST", "/api/usage/conn-copilot/codex-reset-credits")).status).toBe(400);
    expect([...persisted]).toEqual(before);
    await demo.request("POST", "/api/usage/conn-codex-backup/codex-reset-credits");
    persisted.set("unrelated-setting", "keep");
    demo.reset();
    const quota = (await demo.request("GET", "/api/usage/conn-codex-backup")).data;
    expect(quota).toMatchObject({ limitReached: true, quotas: { session: { used: 100, remaining: 0 } }, resetCredits: { availableCount: 1 } });
    expect(persisted.get("unrelated-setting")).toBe("keep");
  });
});
