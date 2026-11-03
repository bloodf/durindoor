import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Account-backed voice lists read through the caller's provider-account scope;
// the public list calls the configured server address, never the request Host.
const state = vi.hoisted(() => ({ keys: new Map(), scopes: new Map(), connections: [] }));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: true, requireLogin: true }),
  getApiKeyByKey: async (secret) => state.keys.get(secret) ?? null,
  validateApiKey: async (secret) => !!state.keys.get(secret)?.isActive,
  validateGatewayKey: async () => false,
  getApiKeyProviderConnectionIds: async (id) => state.scopes.get(id) ?? [],
  getProviderConnections: async (query = {}) => state.connections.filter((row) => !query.provider || row.provider === query.provider),
}));
// The real helper caches per secret; route through the stubbed fetch instead.
vi.mock("open-sse/handlers/ttsCore.js", () => ({
  fetchElevenLabsVoices: async (apiKey) => (await fetch("https://elevenlabs.test/v1/voices", { headers: { "xi-api-key": apiKey } })).json().then((data) => data.voices),
}));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: async () => "cli-token" }));

const routes = {
  minimax: await import("@/app/api/media-providers/tts/minimax/voices/route.js"),
  elevenlabs: await import("@/app/api/media-providers/tts/elevenlabs/voices/route.js"),
  deepgram: await import("@/app/api/media-providers/tts/deepgram/voices/route.js"),
  inworld: await import("@/app/api/media-providers/tts/inworld/voices/route.js"),
};
const publicVoices = await import("@/app/api/v1/audio/voices/route.js");
const upstream = {
  minimax: () => ({ system_voice: [], base_resp: { status_code: 0 } }),
  elevenlabs: () => ({ voices: [] }),
  deepgram: () => ({ models: { tts: [] } }),
  inworld: () => ({ voices: [] }),
};
const headers = {
  scoped: { authorization: "Bearer key-scoped" },
  unscoped: { authorization: "Bearer key-unscoped" },
  admin: { authorization: "Bearer key-admin" },
  cli: { "x-9r-cli-token": "cli-token" },
  none: {},
};
const used = (fetchMock) => JSON.stringify(fetchMock.mock.calls.map(([url, init]) => [String(url), init?.headers]));

let fetchMock;
beforeEach(() => {
  state.keys.clear(); state.scopes.clear();
  for (const id of ["scoped", "unscoped", "admin"]) state.keys.set(`key-${id}`, { id, key: `key-${id}`, isActive: true, isAdmin: id === "admin" });
  state.scopes.set("scoped", ["second"]);
  state.scopes.set("admin", ["second"]);
  state.connections = [];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe.each(Object.keys(routes))("%s voice list", (provider) => {
  beforeEach(() => {
    state.connections = [
      { id: "first", provider, isActive: true, apiKey: "secret-first" },
      { id: "second", provider, isActive: true, apiKey: "secret-second" },
    ];
    fetchMock.mockImplementation(async () => Response.json(upstream[provider]()));
  });
  const get = (caller) => routes[provider].GET(new Request(`http://localhost/api/media-providers/tts/${provider}/voices`, { headers: headers[caller] }));

  it.each([["scoped", "secret-second"], ["unscoped", "secret-first"], ["admin", "secret-first"], ["cli", "secret-first"], ["none", "secret-first"]])("reads as %s with %s", async (caller, secret) => {
    expect((await get(caller)).status).toBe(200);
    expect(used(fetchMock)).toContain(secret);
    expect(used(fetchMock)).not.toContain(secret === "secret-first" ? "secret-second" : "secret-first");
  });

  it("returns no account outside a scoped key's accounts", async () => {
    state.scopes.set("scoped", ["elsewhere"]);
    expect((await get("scoped")).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("public voice list", () => {
  it.each([["20999", "http://127.0.0.1:20999"], [undefined, "http://127.0.0.1:20128"]])("calls the configured server address (PORT=%s)", async (port, origin) => {
    if (port) vi.stubEnv("PORT", port); else vi.stubEnv("PORT", "");
    fetchMock.mockImplementation(async () => Response.json({ byLang: {} }));
    const response = await publicVoices.GET(new Request("http://attacker.example/v1/audio/voices?provider=minimax", { headers: { host: "attacker.example", ...headers.scoped } }));
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).origin).toBe(origin);
    expect(new URL(url).pathname).toBe("/api/media-providers/tts/minimax/voices");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer key-scoped");
  });

  it("forwards a query key as a query key so scope still applies", async () => {
    fetchMock.mockImplementation(async () => Response.json({ voices: [] }));
    await publicVoices.GET(new Request("http://localhost/v1/audio/voices?provider=minimax&lang=en&key=key-scoped"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).searchParams.get("key")).toBe("key-scoped");
    expect(new URL(url).searchParams.get("lang")).toBe("en");
    expect(new Headers(init.headers).get("x-goog-api-key")).toBeNull();
  });

  it("does not count the admin scope for a query key", async () => {
    state.connections = [
      { id: "first", provider: "deepgram", isActive: true, apiKey: "secret-first" },
      { id: "second", provider: "deepgram", isActive: true, apiKey: "secret-second" },
    ];
    fetchMock.mockImplementation(async () => Response.json({ models: { tts: [] } }));
    await routes.deepgram.GET(new Request("http://localhost/api/media-providers/tts/deepgram/voices?key=key-admin"));
    expect(used(fetchMock)).toContain("secret-second");
    expect(used(fetchMock)).not.toContain("secret-first");
  });
});
