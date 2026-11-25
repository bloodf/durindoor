import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ connections: [], jobs: new Map(), caller: "caller-a", receipts: [] }));
vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: async () => true }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => state.connections,
  getProviderNodes: async () => [], getProviderNodeById: async () => null, getProxyPoolById: async () => null,
  createProviderConnection: async (data) => { const c = { id: `account-${state.connections.length + 1}`, ...data }; state.connections.push(c); return c; },
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({}),
  getProviderConnectionById: async (id) => state.connections.find((c) => c.id === id),
  getApiKeyProviderConnectionIds: async () => [],
}));
vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: async () => ({ apiKey: state.caller, auth: { ok: true, apiKeyId: state.caller } }),
  getProviderCredentialsWithQuotaPreflight: async (_provider, _excluded, _model, opts) => {
    const c = state.connections.find((item) => item.id === (opts.strictConnectionId || opts.preferredConnectionId)) || state.connections[0];
    return c && { apiKey: c.apiKey, connectionId: c.id };
  },
  markAccountUnavailable: async () => ({ shouldFallback: false }),
}));
vi.mock("@/sse/services/model.js", () => ({ getModelInfo: async () => ({ provider: "suno", model: "chirp-v4" }) }));
vi.mock("@/sse/services/mediaRoutes.js", () => ({ wantsDefaultRoute: () => false }));
vi.mock("@/sse/handlers/modelKind.js", () => ({ modelKindError: async () => null }));
vi.mock("@/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: async () => null,
  recordAcceptedJobUsage: async (_key, value) => { state.receipts.push({ status: "accepted", ...value }); },
  recordApiKeyUsage: async (_key, value) => { state.receipts.push({ status: "complete", ...value }); },
  recordApiKeyUsageForResponse: async (_key, response) => response,
}));
vi.mock("@/lib/db/repos/usageRepo.js", () => ({ retractAcceptedUsage: async () => {} }));
vi.mock("@/lib/db/repos/mediaJobsRepo.js", () => ({
  createMediaJob: async (job) => { state.jobs.set(`${job.apiKeyId}:${job.connectionId}:${job.resourceId}`, job); return job; },
  getMediaJob: async (identity, caller) => state.jobs.get(`${caller}:${identity.connectionId}:${identity.resourceId}`),
  finishMediaJob: async (job, _caller, terminal) => { job.terminal = terminal; return job; },
}));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetch(...args) }));

const { POST: createProvider } = await import("@/app/api/providers/route.js");
const { handleMusicGeneration, handleMusicGet } = await import("@/sse/handlers/music.js");
const post = (url, body, headers = {}) => new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
const connect = (name, apiKey) => createProvider(post("http://local/api/providers", { provider: "suno", name, apiKey }));
const submit = (connection = "account-1") => handleMusicGeneration(post("http://local/v1/music/generations", { model: "suno/chirp-v4", prompt: "fixture", instrumental: true }, { "x-connection-id": connection }));
const poll = (connection = "account-1") => handleMusicGet(new Request("http://local/v1/music/generations/clip-1", { headers: { "x-9router-connection-id": connection } }), "clip-1");
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  state.connections = []; state.jobs = new Map(); state.caller = "caller-a"; state.receipts = [];
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("unexpected outbound request"); }));
});

afterEach(() => vi.unstubAllGlobals());

describe("Suno existing session and music job", () => {
  it("accepts separate cookie sessions without returning the secrets or inventing expiry", async () => {
    expect((await connect("A", "Cookie: sid=fake-a")).status).toBe(201);
    const second = await connect("B", "sid=fake-b");
    expect(await second.json()).not.toHaveProperty("connection.apiKey");
    expect(state.connections.map(({ authType, apiKey, expiresAt }) => ({ authType, apiKey, expiresAt }))).toEqual([
      { authType: "cookie", apiKey: "Cookie: sid=fake-a", expiresAt: undefined },
      { authType: "cookie", apiKey: "sid=fake-b", expiresAt: undefined },
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("binds asynchronous jobs and their receipts to the submitting account and caller", async () => {
    await connect("A", "Cookie: sid=fake-a"); await connect("B", "sid=fake-b");
    fetch.mockResolvedValueOnce(response({ clips: [{ id: "clip-1", status: "submitted" }] }))
      .mockResolvedValueOnce(response({ clips: [{ id: "clip-1", status: "streaming", audio_url: "https://cdn.invalid/a" }] }))
      .mockResolvedValueOnce(response({ clips: [{ id: "clip-1", status: "complete", audio_url: "https://cdn.invalid/a", metadata: { duration: 2 } }] }));
    const submitted = await submit();
    expect(await submitted.json()).toMatchObject({ request_id: "clip-1", status: "submitted" });
    expect(fetch.mock.calls[0][0]).toBe("https://studio-api.suno.ai/api/generate/v2/");
    expect(fetch.mock.calls[0][1].headers.Cookie).toBe("sid=fake-a");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ prompt: "fixture", model: "chirp-v4", make_instrumental: true });
    state.caller = "caller-b"; expect((await poll()).status).toBe(404);
    state.caller = "caller-a"; expect((await poll("account-2")).status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await (await poll()).json()).toMatchObject({ status: "submitted" });
    expect(state.receipts.map((item) => item.status)).toEqual(["accepted"]);
    expect(await (await poll()).json()).toMatchObject({ status: "completed" });
    expect(fetch.mock.calls[2][1].headers.Cookie).toBe("sid=fake-a");
    expect(new URL(fetch.mock.calls[2][0]).searchParams.get("ids")).toBe("clip-1");
    expect(state.receipts.map((item) => item.status)).toEqual(["accepted", "complete"]);
    expect(state.receipts[1]).toMatchObject({ connectionId: "account-1", nativeUnits: { audioSeconds: 2 } });
  });

  it("returns an expired session failure when account policy declines fallback", async () => {
    await connect("A", "sid=fake-a"); await connect("B", "sid=fake-b");
    fetch.mockResolvedValueOnce(response({ message: "session expired" }, 401));
    expect((await submit()).status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].headers.Cookie).toBe("sid=fake-a");
    expect(state.receipts).toEqual([]);
  });
});
