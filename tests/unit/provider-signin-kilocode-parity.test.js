// MIT source: OmniRoute b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523, src/lib/oauth/providers/kilocode.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("open", () => ({ default: vi.fn() }));
const { createProviderConnection } = vi.hoisted(() => ({ createProviderConnection: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ createProviderConnection, updateProviderConnection: vi.fn() }));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: async () => {} }));
import { POST } from "@/app/api/oauth/[provider]/[action]/route.js";
import { clearOAuthFlowsForTests } from "@/lib/oauth/flowStore.js";
import { fetchConnectionModels } from "@/app/api/providers/[id]/models/fetchConnectionModels.js";
import { refreshAccessToken } from "../../open-sse/services/tokenRefresh/providers.js";
import { pollForToken, requestDeviceCode, exchangeTokens } from "../../src/lib/oauth/providers.js";
import { translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { kilocodeDeviceInitiationError } from "../../src/lib/oauth/providerParity/kilocode/errors.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => { clearOAuthFlowsForTests(); createProviderConnection.mockReset(); });
afterEach(() => { clearOAuthFlowsForTests(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function post(provider, action, body) {
  return POST(new Request(`http://localhost/api/oauth/${provider}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ provider, action }) });
}

describe("Kilo production device and request contracts", () => {
  it("keeps concurrent account tokens, organizations, and proxy options separate", async () => {
    const proxies = [{ id: "proxy-a" }, { id: "proxy-b" }];
    const fetch = vi.fn(async (url, options = {}) => {
      const account = options.proxyOptions === proxies[0] ? "a" : "b";
      if (url.endsWith("/codes") && options.method === "POST") return json({ code: `code-${account}`, verificationUrl: `https://example.test/${account}`, expiresIn: 60 });
      if (url.endsWith(`/codes/code-${account}`)) return json({ status: "approved", token: `token-${account}`, userEmail: `${account}@example.test` });
      if (url.endsWith("/api/profile")) {
        expect(options.headers.Authorization).toBe(`Bearer token-${account}`);
        return json({ organizations: [{ id: `org-${account}` }] });
      }
      throw new Error("Unexpected request");
    });
    vi.stubGlobal("fetch", fetch);
    const codes = await Promise.all(proxies.map((proxy) => requestDeviceCode("kilocode", undefined, {}, proxy)));
    const results = await Promise.all(codes.map((code, i) => pollForToken("kilocode", code.device_code, undefined, undefined, proxies[i])));
    for (const [i, account] of ["a", "b"].entries()) {
      expect(results[i].tokens).toMatchObject({ accessToken: `token-${account}`, refreshToken: null, expiresIn: null, email: `${account}@example.test`, providerSpecificData: { orgId: `org-${account}` } });
      expect(getExecutor("kilocode").buildHeaders(results[i].tokens, true)).toMatchObject({ Authorization: `Bearer token-${account}`, "X-Kilocode-OrganizationID": `org-${account}` });
    }
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(getExecutor("kilo-gateway").buildHeaders({ apiKey: "gateway-key" }, false)).not.toHaveProperty("X-Kilocode-OrganizationID");
  });

  it.each([[202, "authorization_pending"], [403, "access_denied"], [410, "expired_token"], [500, "poll_failed"]])("maps status %i without exposing the response body", async (status, error) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("synthetic-secret", { status })));
    const result = await pollForToken("kilocode", "code");
    expect(result.error).toBe(error);
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
  });

  it("does not retry an approved exchange if profile lookup fails", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ status: "approved", token: "synthetic-token" })).mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    expect(await pollForToken("kilocode", "code")).toMatchObject({ success: true, tokens: { accessToken: "synthetic-token" } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("staged web integration", () => {
  it("sanitizes initiation failures", () => {
    expect(kilocodeDeviceInitiationError(500).message).toBe("Device auth initiation failed (HTTP 500).");
    expect(kilocodeDeviceInitiationError(429).message).toContain("Too many pending");
  });
});

describe("Kilo shared route and discovery", () => {
  it("binds a device flow, consumes approval once and expires another without polling", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1780000000000);
    const fetch = vi.fn(async (url, options = {}) => {
      if (options.method === "POST") return json({ code: "private-code", verificationUrl: "https://example.test/verify", expiresIn: 60 });
      if (url.endsWith("/private-code")) return json({ status: "approved", token: "private-token", userEmail: "a@example.test" });
      if (url.endsWith("/api/profile")) return json({ organizations: [{ id: "org-a" }] });
      throw new Error("Unexpected request");
    });
    vi.stubGlobal("fetch", fetch);
    createProviderConnection.mockImplementation(async (record, options) => {
      expect(options.shouldCommit()).toBe(true);
      return { ...record, id: "connection-a" };
    });
    const started = await (await post("kilocode", "device-code", { ownerId: "owner-a", proxyMode: "direct" })).json();
    expect(started).toMatchObject({ expires_in: 60, interval: 3 });
    expect(started).not.toHaveProperty("device_code");
    expect(started.user_code).toBe("private-code");
    expect((await post("kilo-gateway", "poll", { flowId: started.flowId })).status).toBe(400);
    const result = await (await post("kilocode", "poll", { flowId: started.flowId, deviceCode: "attacker-code" })).json();
    expect(result).toMatchObject({ success: true, connection: { id: "connection-a" } });
    expect(JSON.stringify(result)).not.toContain("private-token");
    expect(createProviderConnection.mock.calls[0][0]).toMatchObject({ accessToken: "private-token", providerSpecificData: { orgId: "org-a", oauthProxy: { mode: "direct" } } });
    expect((await post("kilocode", "poll", { flowId: started.flowId })).status).toBe(410);
    const expiring = await (await post("kilocode", "device-code", { ownerId: "owner-b", proxyMode: "direct" })).json();
    vi.mocked(Date.now).mockReturnValue(expiring.expiresAt + 1);
    expect((await post("kilocode", "poll", { flowId: expiring.flowId })).status).toBe(410);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(createProviderConnection).toHaveBeenCalledTimes(1);
  });

  it("releases pending polls and prevents concurrent duplicate submissions", async () => {
    let releasePoll;
    let notifyPoll;
    let pollStarted = new Promise((resolve) => { notifyPoll = resolve; });
    const fetch = vi.fn(async (url, options = {}) => {
      if (options.method === "POST") return json({ code: "device", verificationUrl: "https://example.test", expiresIn: 60 });
      if (url.endsWith("/device")) return await new Promise((resolve) => { releasePoll = resolve; notifyPoll(); });
      if (url.endsWith("/api/profile")) return json({});
      throw new Error("Unexpected request");
    });
    vi.stubGlobal("fetch", fetch);
    createProviderConnection.mockImplementation(async (record) => ({ ...record, id: "saved" }));
    const flow = await (await post("kilocode", "device-code", { ownerId: "a", proxyMode: "direct" })).json();
    const first = post("kilocode", "poll", { flowId: flow.flowId });
    await pollStarted;
    expect((await post("kilocode", "poll", { flowId: flow.flowId })).status).toBe(409);
    releasePoll(new Response(null, { status: 202 }));
    expect(await (await first).json()).toMatchObject({ pending: true, error: "authorization_pending" });
    pollStarted = new Promise((resolve) => { notifyPoll = resolve; });
    const approved = post("kilocode", "poll", { flowId: flow.flowId });
    await pollStarted;
    releasePoll(json({ status: "approved", token: "synthetic-token" }));
    expect(await (await approved).json()).toMatchObject({ success: true });
    expect(createProviderConnection).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("supersedes only the same owner and cancels without contacting upstream", async () => {
    const fetch = vi.fn(async (_url, options) => options.method === "POST"
      ? json({ code: "device", verificationUrl: "https://example.test", expiresIn: 60 })
      : new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetch);
    const start = async (ownerId) => (await (await post("kilocode", "device-code", { ownerId, proxyMode: "direct" })).json()).flowId;
    const first = await start("a");
    const other = await start("b");
    const newer = await start("a");
    expect((await post("kilocode", "poll", { flowId: first })).status).toBe(410);
    expect(await (await post("kilocode", "cancel", { flowId: newer })).json()).toMatchObject({ cancelled: true });
    expect((await post("kilocode", "poll", { flowId: newer })).status).toBe(410);
    expect(await (await post("kilocode", "poll", { flowId: other })).json()).toMatchObject({ pending: true });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("fails unsupported authorization-code and refresh modes before network", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(exchangeTokens("kilocode", "code", "redirect", "verifier", "state")).rejects.toThrow();
    expect(await refreshAccessToken("kilocode", "synthetic-refresh", {}, null)).toBeNull();
    expect((await post("kilocode", "import-token", { token: "synthetic" })).status).toBeGreaterThanOrEqual(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("discovers a fixed public catalog without forwarding credentials or redirects", async () => {
    const fetch = vi.fn(async () => json({ data: [{ id: "example/model", name: "Example" }, { name: "invalid" }] }));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchConnectionModels({ provider: "kilocode", accessToken: "private-token", providerSpecificData: { baseUrl: "http://127.0.0.1" } })).toEqual({ models: [{ id: "example/model", name: "Example" }] });
    expect(fetch.mock.calls[0][0]).toBe("https://api.kilo.ai/api/gateway/models");
    expect(fetch.mock.calls[0][1]).toMatchObject({ headers: { Accept: "application/json" }, redirect: "manual" });
    expect(JSON.stringify(fetch.mock.calls[0][1])).not.toContain("private-token");
  });

  it("keeps OpenAI-compatible messages and stream settings on the Kilo executor", () => {
    const executor = getExecutor("kilocode");
    const body = { model: "example/model", messages: [{ role: "user", content: "hello" }], stream: true };
    expect(executor.buildUrl("example/model", true)).toBe("https://api.kilo.ai/api/openrouter/chat/completions");
    expect(executor.transformRequest("example/model", structuredClone(body), true, { accessToken: "synthetic" })).toMatchObject(body);
    const chunk = { id: "completion", choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }] };
    expect(translateResponse(FORMATS.OPENAI, FORMATS.OPENAI, chunk, {})).toEqual([chunk]);
  });
});
