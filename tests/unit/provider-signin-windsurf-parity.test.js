import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ createProviderConnection: mocks.create, getProxyPoolById: vi.fn() }));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.fetch }));

async function post(action, body) {
  const { POST } = await import("@/app/api/oauth/[provider]/[action]/route.js");
  return POST({ json: async () => body }, { params: Promise.resolve({ provider: "windsurf", action }) });
}

describe("Windsurf production import and request contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockImplementation(async (data) => ({ id: "fixture-connection", ...data }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("imports a token through the real route without returning credentials", async () => {
    const response = await post("import-token", { accessToken: "fixture-token-a" });
    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ provider: "windsurf", accessToken: "fixture-token-a", refreshToken: null, expiresAt: null });
    expect(await response.text()).not.toContain("fixture-token-a");
  });

  it("rejects empty imports and unsupported device and exchange requests without transport", async () => {
    vi.stubGlobal("fetch", mocks.fetch);
    for (const [action, body] of [["import-token", { accessToken: "" }], ["device-code", {}], ["exchange", { code: "fixture-code" }]]) {
      expect((await post(action, body)).status).toBeGreaterThanOrEqual(400);
    }
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("keeps concurrent credential and proxy identity and dispatches once per request", async () => {
    mocks.fetch.mockImplementation(async () => new Response("fixture rejection", { status: 401 }));
    const { WindsurfExecutor } = await import("../../open-sse/executors/windsurf.js");
    const executor = new WindsurfExecutor();
    const responses = await Promise.all(["a", "b"].map((id) => executor.execute({
      model: "swe-1.6-fast", body: { messages: [{ role: "user", content: "hello" }] },
      credentials: { accessToken: `fixture-token-${id}` }, proxyOptions: { proxyUrl: `proxy-${id}` }
    })));
    expect(responses.map(({ response }) => response.status)).toEqual([401, 401]);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    for (const [url, init, proxy] of mocks.fetch.mock.calls) {
      const id = proxy.proxyUrl.slice(-1);
      expect(url).toContain("GetChatMessage");
      expect(init.headers.Authorization).toBe(`Bearer fixture-token-${id}`);
      expect(new TextDecoder().decode(init.body)).toContain(`fixture-token-${id}`);
      expect(new TextDecoder().decode(init.body)).not.toContain(`fixture-token-${id === "a" ? "b" : "a"}`);
    }
  });
});
