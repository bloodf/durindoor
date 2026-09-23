// port(upstream): #4245 - Xiaomi MiMo credential import for API keys and browser sessions.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createProviderConnection = vi.hoisted(() => vi.fn());
const getProviderConnections = vi.hoisted(() => vi.fn());
const updateProviderConnection = vi.hoisted(() => vi.fn());
vi.mock("@/models", () => ({ createProviderConnection, getProviderConnections, updateProviderConnection }));
vi.mock("next/server", () => ({
  NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200 }) },
}));

import { POST } from "../../src/app/api/oauth/xiaomi-mimo/api-key/route.js";

const post = (body) => POST(new Request("http://localhost/api/oauth/xiaomi-mimo/api-key", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
}));

describe("POST /api/oauth/xiaomi-mimo/api-key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProviderConnections.mockResolvedValue([]);
    createProviderConnection.mockImplementation(async (data) => ({ id: "c1", ...data }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{}, {}] }), { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("rejects a request with neither key nor session", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ apiKey: "tp-123" })).status).toBe(400);
  });

  it("refuses to send the key to a non-Xiaomi baseUrl", async () => {
    const res = await post({ apiKey: "sk-abc", baseUrl: "https://evil.example/v1" });
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stores an sk- key as an apikey connection after validating it", async () => {
    const res = await post({ apiKey: "sk-abc", uid: "7", mimoPassToken: "pt", mimoUserId: "7" });
    expect(res.status).toBe(200);
    const data = createProviderConnection.mock.calls[0][0];
    expect(data).toMatchObject({ provider: "xiaomi-mimo", authType: "apikey", apiKey: "sk-abc", email: "7@xiaomi", testStatus: "active" });
    expect(data.providerSpecificData).toMatchObject({ mimoPassToken: "pt", modelCount: 2, region: "cn", authMethod: "api_key" });
  });

  it("stores a browser login as a session-only oauth connection on its cluster", async () => {
    const res = await post({ apiKey: "", mimoPassToken: "pt", mimoUserId: "9", region: "ams" });
    expect(res.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    const data = createProviderConnection.mock.calls[0][0];
    expect(data).toMatchObject({ authType: "oauth", accessToken: null, testStatus: "active" });
    expect(data.apiKey).toBeUndefined();
    expect(data.providerSpecificData).toMatchObject({ region: "ams", authMethod: "session", mimoUserId: "9" });
  });

  it("updates the same session user+cluster instead of duplicating it, keeping the stored key", async () => {
    getProviderConnections.mockResolvedValue([
      { id: "old", provider: "xiaomi-mimo", apiKey: "sk-keep", providerSpecificData: { mimoUserId: "9", region: "sgp", mimoPassToken: "stale" } },
    ]);
    const body = await (await post({ mimoPassToken: "fresh", mimoUserId: "9", region: "sgp" })).json();
    expect(body.updated).toBe(true);
    expect(createProviderConnection).not.toHaveBeenCalled();
    const [id, update] = updateProviderConnection.mock.calls[0];
    expect(id).toBe("old");
    expect(update.apiKey).toBeUndefined();
    expect(update.providerSpecificData).toMatchObject({ mimoPassToken: "fresh", region: "sgp" });
  });
});
