import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollForToken, requestDeviceCode } from "../../src/lib/oauth/providers.js";
import { getAccessToken } from "../../open-sse/services/tokenRefresh.js";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import codebuddyCn from "../../open-sse/providers/registry/codebuddy-cn.js";
import { getCodeBuddyCnUsage } from "../../open-sse/services/usage/codebuddy-cn.js";
import { codebuddyStateBody, codebuddyStateFailure, codebuddyPollFailure, codebuddyUsageFailure } from "../../src/lib/oauth/providerParity/codebuddy/state.js";

const storage = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ createProviderConnection: storage.create, getProviderConnectionById: vi.fn(), updateProviderConnection: vi.fn(), getProxyPoolById: vi.fn() }));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: vi.fn() }));
vi.mock("@/lib/oauth/utils/server", () => ({ clearCodexSession: vi.fn(), clearXaiSession: vi.fn(), getCodexSessionStatus: vi.fn(), getXaiSessionStatus: vi.fn(), registerCodexSession: vi.fn(), registerXaiSession: vi.fn(), startCodexProxy: vi.fn(), startXaiProxy: vi.fn(), stopCodexProxy: vi.fn(), stopXaiProxy: vi.fn() }));
vi.mock("open", () => ({ default: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", async (original) => ({
  ...await original(), proxyAwareFetch: (url, options, proxy) => fetch(url, { ...options, proxy }),
}));
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); })));
afterEach(() => vi.unstubAllGlobals());

describe("CodeBuddy CN production contracts", () => {
  it("keeps two issued states and proxy selections separate through pending and success", async () => {
    fetch.mockImplementation(async (url, options) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/state")) return reply({ code: 0, data: { state: options.proxyOptions.id, authUrl: "https://example.test/authorize" } });
      const state = parsed.searchParams.get("state");
      expect(options.proxyOptions.id).toBe(state);
      return state === "a" ? reply({ code: 11217 }) : reply({ code: 0, data: { accessToken: "token-b", refreshToken: "refresh-b" } });
    });
    const [a, b] = await Promise.all(["a", "b"].map((id) => requestDeviceCode("codebuddy-cn", undefined, {}, { id })));
    const [pending, success] = await Promise.all([a, b].map((flow) => pollForToken("codebuddy-cn", flow.device_code, undefined, undefined, { id: flow.device_code })));
    expect(pending).toMatchObject({ success: false, pending: true });
    expect(success).toMatchObject({ success: true, tokens: { accessToken: "token-b", refreshToken: "refresh-b" } });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("rejects unknown device providers before making a request", async () => {
    await expect(requestDeviceCode("codebuddy-intl")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not retry a rejected refresh and retains the original refresh token when omitted", async () => {
    fetch.mockImplementation(async (_url, options) => options.headers["X-Refresh-Token"] === "bad" ? reply({}, 401) : reply({ code: 0, data: { accessToken: "new" } }));
    const [bad, good] = await Promise.all(["bad", "good"].map((refreshToken) => getAccessToken("codebuddy-cn", { refreshToken })));
    expect(bad).toBeFalsy();
    expect(good).toMatchObject({ accessToken: "new", refreshToken: "good" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sends each chat account's credential and forces upstream streaming", async () => {
    fetch.mockResolvedValue(reply({}, 401));
    const executor = new CodeBuddyExecutor();
    const results = await Promise.all(["a", "b"].map((token) => executor.execute({ model: "glm-5.2", body: { messages: [{ role: "user", content: "hello" }] }, stream: false, credentials: { accessToken: token } })));
    expect(results.map((result) => result.response.status)).toEqual([401, 401]);
    expect(fetch.mock.calls.map(([, options]) => options.headers.Authorization)).toEqual(["Bearer a", "Bearer b"]);
    expect(fetch.mock.calls.every(([, options]) => JSON.parse(options.body).stream)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses the local model catalog without a discovery request", () => {
    expect(codebuddyCn.models.map((model) => model.id)).toContain("glm-5.2");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects account model discovery without sending its credential", async () => {
    const { fetchConnectionModels } = await import("../../src/app/api/providers/[id]/models/fetchConnectionModels.js");
    const result = await fetchConnectionModels({ id: "one", provider: "codebuddy-cn", accessToken: "synthetic-token" });
    expect(result).toMatchObject({ status: 400, error: "Provider codebuddy-cn does not support models listing" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("normalizes streamed chunks and forwards usage once", async () => {
    const frame = { id: "synthetic", model: "glm-5.2", choices: [{ index: 0, delta: { content: "hello" }, finish_reason: "" }] };
    const usage = { prompt_tokens: 2, completion_tokens: 1 };
    const stream = `data: ${JSON.stringify(frame)}\n\ndata: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`;
    fetch.mockResolvedValue(new Response(stream, { headers: { "content-type": "text/event-stream" } }));
    const result = await new CodeBuddyExecutor().execute({ model: "glm-5.2", body: { messages: [{ role: "user", content: "hi" }] }, stream: true, credentials: { accessToken: "fake" } });
    const output = await result.response.text();
    expect(output).toContain("hello");
    expect(output.match(/\[DONE\]/g)).toHaveLength(1);
    expect(output.match(/prompt_tokens/g)).toHaveLength(1);
    expect(output).toContain('"finish_reason":"stop"');
  });

  it("reports an expired usage credential without returning the upstream body", async () => {
    fetch.mockResolvedValue(reply({ secret: "synthetic-secret" }, 401));
    expect(await getCodeBuddyCnUsage("fake-token")).toEqual({ message: "CodeBuddy CN credential invalid or expired." });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("staged state integration", () => {
  it("uses the pinned request body and a fixed failure message", () => {
    expect(codebuddyStateBody()).toBe("{}");
    expect(codebuddyStateFailure().message).toBe("CodeBuddy state request failed");
    expect(codebuddyPollFailure()).toEqual({ ok: false, data: { error: "codebuddy_authorization_failed" } });
    expect(codebuddyUsageFailure()).toEqual({ message: "CodeBuddy CN quota request failed." });
  });
});


describe("CodeBuddy CN bound device route", () => {
  async function post(action, body, provider = "codebuddy-cn") {
    const { POST } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
    const response = await POST({ json: async () => body }, { params: Promise.resolve({ provider, action }) });
    return { status: response.status, body: await response.json() };
  }

  beforeEach(async () => {
    const { clearOAuthFlowsForTests } = await import("../../src/lib/oauth/flowStore.js");
    clearOAuthFlowsForTests();
    storage.create.mockReset();
    storage.create.mockImplementation(async (data, options) => {
      if (!options.shouldCommit()) throw new Error("OAuth flow was cancelled or superseded before commit");
      return { id: "connection", ...data };
    });
  });
  afterEach(() => vi.useRealTimers());

  it("keeps the issued state private, rejects concurrent polls and consumes success once", async () => {
    let release;
    fetch.mockImplementation(async (url) => {
      if (new URL(url).pathname.endsWith("/state")) return reply({ code: 0, data: { state: "private-state", url: "https://example.test/login" } });
      return await new Promise((resolve) => { release = () => resolve(reply({ code: 0, data: { accessToken: "private-access" } })); });
    });
    const start = await post("device-code", { proxyMode: "direct" });
    expect(start.status).toBe(200);
    expect(JSON.stringify(start.body)).not.toContain("private-state");
    const first = post("poll", { flowId: start.body.flowId });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect((await post("poll", { flowId: start.body.flowId })).status).toBe(409);
    release();
    const completed = await first;
    expect(completed.body.success).toBe(true);
    expect(JSON.stringify(completed.body)).not.toContain("private-access");
    expect(storage.create).toHaveBeenCalledTimes(1);
    expect((await post("poll", { flowId: start.body.flowId })).status).toBe(410);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not save a token returned after the flow is cancelled", async () => {
    let release;
    fetch.mockImplementation(async (url) => {
      if (new URL(url).pathname.endsWith("/state")) return reply({ code: 0, data: { state: "cancel-state", url: "https://example.test/login" } });
      return await new Promise((resolve) => { release = () => resolve(reply({ code: 0, data: { accessToken: "late-token" } })); });
    });
    const start = await post("device-code", { proxyMode: "direct" });
    const poll = post("poll", { flowId: start.body.flowId });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect((await post("cancel", { flowId: start.body.flowId })).status).toBe(200);
    release();
    const result = await poll;
    expect(result.body.success).not.toBe(true);
    expect(JSON.stringify(result.body)).not.toContain("late-token");
    expect(storage.create).toHaveBeenCalledTimes(1);
    expect(storage.create.mock.calls[0][1].shouldCommit()).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("expires the server flow before another poll can reach the provider", async () => {
    vi.useFakeTimers();
    fetch.mockResolvedValue(reply({ code: 0, data: { state: "private-state", url: "https://example.test/login" } }));
    const start = await post("device-code", { proxyMode: "direct" });
    vi.setSystemTime(new Date(start.body.expiresAt + 1));
    expect((await post("poll", { flowId: start.body.flowId })).status).toBe(410);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported token import and code exchange without network access", async () => {
    expect((await post("import-token", { accessToken: "synthetic" })).status).toBe(400);
    expect((await post("exchange", { code: "synthetic" })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(storage.create).not.toHaveBeenCalled();
  });

  it("rejects a flow claimed through another provider before polling", async () => {
    fetch.mockResolvedValue(reply({ code: 0, data: { state: "private-state", url: "https://example.test/login" } }));
    const start = await post("device-code", { proxyMode: "direct" });
    expect((await post("poll", { flowId: start.body.flowId }, "github")).status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
