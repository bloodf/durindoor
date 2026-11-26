import { afterEach, describe, expect, it, vi } from "vitest";
import { getExecutor } from "open-sse/executors/index.js";
import { runWithProviderAttemptContext, settleProviderAttemptDispatch } from "open-sse/services/providerAttemptContext.js";
import { QuotaDispatchUnavailableError } from "open-sse/services/quota/dispatch.js";
import { __clearProxyDispatchersForTesting, __setOriginalFetchForTesting, __setProxyDispatcherForTesting } from "open-sse/utils/proxyFetch.js";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => []), getProviderConnectionById: vi.fn(),
  getProviderNodes: vi.fn(() => []), getProxyPoolById: vi.fn(), getProviderNodeById: vi.fn(),
  createProviderConnection: vi.fn(async (data) => ({ id: "connection-1", ...data })),
  updateProviderConnection: vi.fn(), deleteProviderConnection: vi.fn(),
}));
vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: vi.fn(async () => true) }));

const originalFetch = globalThis.fetch;
let restoreTransport;
afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreTransport?.();
  restoreTransport = undefined;
  __clearProxyDispatchersForTesting();
  vi.useRealTimers();
});

const jwt = (name, exp) => `eyJ.${Buffer.from(JSON.stringify({ name, exp })).toString("base64url")}.sig`;
const input = (key) => ({ model: "adapta-one", stream: false, proxyOptions: { disableEnvProxy: true }, credentials: { apiKey: key }, body: { messages: [{ role: "user", content: "hello" }] } });

describe("Adapta operator session", () => {
  it("exchanges each complete credential separately and uses its bearer for chat", async () => {
    const prefix = "same-prefix-".repeat(4);
    const cookies = [prefix + "a", prefix + "b"];
    const tokens = cookies.map((_, i) => jwt(String(i), Math.floor(Date.now() / 1000) + 300));
    const seen = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      if (String(url).endsWith("/v1/client")) {
        const i = cookies.indexOf(init.headers.Cookie.slice("__client=".length));
        expect(i).toBeGreaterThanOrEqual(0);
        return Response.json({ response: { sessions: [{ id: `session-${i}`, status: "active" }] } });
      }
      if (String(url).includes("/tokens")) {
        const i = Number(String(url).match(/session-(\d)/)[1]);
        expect(init.headers.Cookie).toBe(`__client=${cookies[i]}`);
        return Response.json({ jwt: tokens[i] });
      }
      expect(String(url)).toBe("https://agent.adapta.one/api/chat/stream/v1");
      seen.push(init.headers.Authorization);
      expect(JSON.parse(init.body)).toMatchObject({ messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }], modelAi: "ONE" });
      return new Response('data: {"type":"text-delta","delta":"ok"}\n\ndata: {"type":"done"}\n\n');
    });
    for (const cookie of cookies) {
      const result = await getExecutor("adapta-web").execute(input(cookie));
      expect(result.response.status).toBe(200);
      expect((await result.response.json()).choices[0].message.content).toBe("ok");
      expect(JSON.stringify(result.headers)).not.toContain(tokens[cookies.indexOf(cookie)]);
    }
    expect(seen).toEqual(tokens.map((token) => `Bearer ${token}`));
  });
});

describe("expiry and errors", () => {
  it("refreshes at the expiry buffer and evicts a rejected token", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    let issued = 0; let chats = 0;
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).endsWith("/v1/client")) return Response.json({ response: { sessions: [{ id: "active", status: "active" }] } });
      if (String(url).endsWith("/tokens")) { issued++; return Response.json({ jwt: jwt(String(issued), Math.floor(Date.now() / 1000) + 60) }); }
      chats++; return chats === 2 ? new Response("secret diagnostic", { status: 401 }) : new Response('data: {"type":"done"}\n\n');
    });
    const executor = getExecutor("adapta-web"); const request = input("expiry-cookie");
    expect((await executor.execute(request)).response.status).toBe(200);
    vi.advanceTimersByTime(31000);
    const rejected = await executor.execute(request);
    expect(rejected.response.status).toBe(401);
    expect(await rejected.response.text()).not.toContain("secret diagnostic");
    expect((await executor.execute(request)).response.status).toBe(200);
    expect(issued).toBe(3);
  });

  it("redacts authentication errors and never sends the cookie to chat on failure", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("fake-secret diagnostic"); });
    const result = await getExecutor("adapta-web").execute(input("fake-secret"));
    expect(result.response.status).toBe(401);
    expect(await result.response.text()).not.toContain("fake-secret");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("redacts stream error events", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).endsWith("/v1/client")) return Response.json({ response: { sessions: [{ id: "stream", status: "active" }] } });
      if (String(url).endsWith("/tokens")) return Response.json({ jwt: jwt("stream", Math.floor(Date.now() / 1000) + 300) });
      return new Response('data: {"type":"error","message":"private diagnostic"}\n\n');
    });
    const result = await getExecutor("adapta-web").execute({ ...input("stream-cookie"), stream: true });
    const text = await result.response.text();
    expect(text).toContain("Adapta upstream error");
    expect(text).not.toContain("private diagnostic");
    expect(text).toContain("[DONE]");
  });
});

it("saves an operator-supplied session through the provider entry point without returning it", async () => {
  const { POST } = await import("../../src/app/api/providers/route.js");
  const models = await import("@/lib/localDb");
  const response = await POST(new Request("http://localhost/api/providers", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "adapta-web", name: "Adapta", apiKey: "__client=fake-cookie" }),
  }));
  expect(response.status).toBe(201);
  expect(models.createProviderConnection).toHaveBeenCalledWith(expect.objectContaining({ provider: "adapta-web", apiKey: "__client=fake-cookie" }), expect.any(Object));
  expect(await response.text()).not.toContain("fake-cookie");
});

describe("Adapta connection egress", () => {
  const proxyUrl = "http://proxy.invalid:8080";
  const spareUrl = "http://proxy.invalid:8081";
  const relayUrl = "https://relay.invalid/forward";
  const strict = (url = proxyUrl) => ({ enabled: true, url, strictProxy: true, disableEnvProxy: true });
  const paths = ["/v1/client", "/v1/client/sessions/review/tokens", "/api/chat/stream/v1"];

  function closedTransport() {
    const first = {}, second = {};
    __setProxyDispatcherForTesting(proxyUrl, first);
    __setProxyDispatcherForTesting(spareUrl, second);
    const calls = [];
    let issued = 0;
    const state = { calls, fail: false, reject: false, onLookup: null };
    const transport = vi.fn(async (url, init, route) => {
      const headers = new Headers(init.headers);
      const target = headers.get("x-relay-target") || new URL(url).origin;
      const path = headers.get("x-relay-path") || new URL(url).pathname;
      calls.push({ route, target, path, headers, signal: init.signal, redirect: init.redirect });
      if (state.fail && route !== "direct") throw new Error("private proxy diagnostic");
      if (path === paths[0]) {
        state.onLookup?.();
        return Response.json({ response: { sessions: [{ id: "review", status: "active" }] } });
      }
      if (path === paths[1]) {
        return Response.json({ jwt: jwt(String(++issued), Math.floor(Date.now() / 1000) + 300) });
      }
      if (path !== paths[2]) throw new Error("Unexpected fixture URL");
      if (state.reject) return new Response("private upstream diagnostic", { status: 403 });
      return new Response('data: {"type":"text-delta","delta":"ok"}\n\ndata: {"type":"done"}\n\n');
    });
    globalThis.fetch = vi.fn((url, init) => transport(url, init, "direct"));
    restoreTransport = __setOriginalFetchForTesting((url, init) => {
      if (url === relayUrl) return transport(url, init, "relay");
      if (init.dispatcher === first) return transport(url, init, "first");
      if (init.dispatcher === second) return transport(url, init, "second");
      throw new Error("Unexpected dispatcher");
    });
    return state;
  }

  it.each([
    ["strict connection proxy", strict(), "first", false],
    ["ordinary connection proxy", { ...strict(), strictProxy: false }, "first", true],
    ["relay", { ...strict(), vercelRelayUrl: relayUrl }, "relay", false],
  ])("routes all calls via %s with separate credentials and one chat quota ticket", async (_name, proxyOptions, route, stream) => {
    const { calls } = closedTransport();
    const controller = new AbortController();
    const { signal } = controller;
    const settle = vi.fn();
    const beginQuotaDispatch = vi.fn(async () => {
      expect(calls.map((call) => call.path)).toEqual(paths.slice(0, 2));
      return { tracked: true, settle };
    });
    const { response, headers } = await runWithProviderAttemptContext(null,
      () => getExecutor("adapta-web").execute({ ...input("routed-cookie"), proxyOptions, signal, stream }),
      { beginQuotaDispatch });
    expect(response.status).toBe(200);
    if (stream) {
      const output = await response.text();
      expect(output).toContain('"content":"ok"');
      expect(output).toContain("[DONE]");
    } else {
      expect((await response.json()).choices[0].message.content).toBe("ok");
    }
    expect(headers).toEqual({});
    expect(calls.map((call) => call.path)).toEqual(paths);
    expect(calls.map((call) => call.target)).toEqual([
      "https://clerk.agent.adapta.one", "https://clerk.agent.adapta.one", "https://agent.adapta.one",
    ]);
    for (const call of calls) {
      expect(call.route).toBe(route);
      expect(call.signal.aborted).toBe(false);
      expect(call.redirect).toBe("error");
    }
    for (const call of calls.slice(0, 2)) {
      expect(call.headers.get("cookie")).toBe("__client=routed-cookie");
      expect(call.headers.has("authorization")).toBe(false);
    }
    expect(calls[2].headers.has("cookie")).toBe(false);
    expect(calls[2].headers.get("authorization")).toMatch(/^Bearer eyJ/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(beginQuotaDispatch).toHaveBeenCalledTimes(1);
    await settleProviderAttemptDispatch(response.body, { success: true });
    expect(settle).toHaveBeenCalledWith({ success: true, reason: "success" });
    // The sender merges a header deadline into the signal; the caller's abort still reaches every send.
    controller.abort();
    for (const call of calls) expect(call.signal.aborted).toBe(true);
  });

  it("fails closed with an unavailable or failed strict proxy after a direct cache hit", async () => {
    const fixture = closedTransport();
    const execute = (proxyOptions) => getExecutor("adapta-web").execute({ ...input("warm-direct"), proxyOptions });
    const direct = { disableEnvProxy: true };
    expect((await execute(direct)).response.status).toBe(200);
    expect((await execute(direct)).response.status).toBe(200);
    expect(fixture.calls.map((call) => call.path)).toEqual([...paths, paths[2]]);
    globalThis.fetch.mockClear();
    fixture.calls.length = 0;

    expect((await execute({ strictProxy: true, disableEnvProxy: true })).response.status).toBe(401);
    expect(fixture.calls).toEqual([]);
    fixture.fail = true;
    const failed = await execute(strict());
    expect(failed.response.status).toBe(401);
    expect(await failed.response.text()).not.toContain("private proxy diagnostic");
    expect(fixture.calls.map(({ route, path }) => [route, path])).toEqual([["first", paths[0]]]);
    expect(globalThis.fetch).not.toHaveBeenCalled();

    fixture.fail = false;
    expect((await execute(strict())).response.status).toBe(200);
    fixture.calls.length = 0;
    fixture.fail = true;
    const failedChat = await execute(strict());
    expect(failedChat.response.status).toBe(502);
    expect(await failedChat.response.text()).not.toContain("private proxy diagnostic");
    expect(fixture.calls.map(({ route, path }) => [route, path])).toEqual([["first", paths[2]]]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("isolates cached JWTs by egress and account and evicts only the rejected token", async () => {
    const fixture = closedTransport();
    const execute = (cookie, proxyOptions) => getExecutor("adapta-web").execute({ ...input(cookie), proxyOptions });
    const bearer = () => fixture.calls.at(-1).headers.get("authorization");
    expect((await execute("account-a", strict())).response.status).toBe(200);
    const firstBearer = bearer();
    expect((await execute("account-a", strict(spareUrl))).response.status).toBe(200);
    const secondBearer = bearer();
    expect(secondBearer).not.toBe(firstBearer);
    expect((await execute("account-b", strict())).response.status).toBe(200);
    const otherBearer = bearer();
    expect(otherBearer).not.toBe(firstBearer);
    expect(fixture.calls.map((call) => call.path)).toEqual([...paths, ...paths, ...paths]);

    fixture.reject = true;
    const rejected = await execute("account-a", strict());
    expect(bearer()).toBe(firstBearer);
    expect(rejected.response.status).toBe(403);
    expect(await rejected.response.text()).not.toContain("private upstream diagnostic");
    fixture.reject = false;
    fixture.calls.length = 0;
    expect((await execute("account-a", strict(spareUrl))).response.status).toBe(200);
    expect(bearer()).toBe(secondBearer);
    expect((await execute("account-b", strict())).response.status).toBe(200);
    expect(bearer()).toBe(otherBearer);
    expect((await execute("account-a", strict())).response.status).toBe(200);
    expect(bearer()).not.toBe(firstBearer);
    expect(fixture.calls.map((call) => call.path)).toEqual([paths[2], paths[2], ...paths]);
  });

  it("exchanges again after an ordinary proxy falls back to direct", async () => {
    const fixture = closedTransport();
    const proxyOptions = { ...strict(), strictProxy: false };
    const execute = () => getExecutor("adapta-web").execute({ ...input("fallback-cookie"), proxyOptions });
    fixture.fail = true;
    expect((await execute()).response.status).toBe(200);
    expect(fixture.calls.map((call) => call.route)).toEqual(["first", "direct", "first", "direct", "first", "direct"]);
    const directBearer = fixture.calls.at(-1).headers.get("authorization");
    fixture.fail = false;
    fixture.calls.length = 0;
    expect((await execute()).response.status).toBe(200);
    expect(fixture.calls.map((call) => call.path)).toEqual(paths);
    expect(fixture.calls.every((call) => call.route === "first")).toBe(true);
    expect(fixture.calls.at(-1).headers.get("authorization")).not.toBe(directBearer);
  });

  it("propagates a gateway quota denial without sending chat", async () => {
    const { calls } = closedTransport();
    const unavailable = new QuotaDispatchUnavailableError();
    const beginQuotaDispatch = vi.fn(async () => { throw unavailable; });
    const request = { ...input("quota-cookie"), proxyOptions: strict() };
    await expect(runWithProviderAttemptContext(null, () => getExecutor("adapta-web").execute(request),
      { beginQuotaDispatch })).rejects.toBe(unavailable);
    expect(calls.map((call) => call.path)).toEqual(paths.slice(0, 2));
    expect(beginQuotaDispatch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("stops before token exchange when cancellation arrives during Clerk lookup", async () => {
    const fixture = closedTransport();
    const controller = new AbortController();
    fixture.onLookup = () => controller.abort();
    const { response } = await getExecutor("adapta-web").execute({
      ...input("canceled"), proxyOptions: strict(), signal: controller.signal,
    });
    expect(response.status).toBe(499);
    expect(fixture.calls.map(({ path }) => path)).toEqual([paths[0]]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
