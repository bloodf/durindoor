import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProviderConnection: vi.fn(),
  ensureOutboundProxyInitialized: vi.fn(),
  exchangeTokens: vi.fn(),
  generateAuthData: vi.fn(),
  getProvider: vi.fn(),
  pollForToken: vi.fn(),
  requestDeviceCode: vi.fn(),
  getProxyPoolById: vi.fn(),
  clearCodexSession: vi.fn(),
  clearXaiSession: vi.fn(),
  getCodexSessionStatus: vi.fn(),
  getXaiSessionStatus: vi.fn(),
  startCodexProxy: vi.fn(),
  stopCodexProxy: vi.fn(),
  stopXaiProxy: vi.fn(),
  registerCodexSession: vi.fn(),
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({}));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    }),
  },
}));
vi.mock("@/lib/network/initOutboundProxy", () => ({
  ensureOutboundProxyInitialized: mocks.ensureOutboundProxyInitialized,
}));
vi.mock("@/lib/localDb", () => ({
  createProviderConnection: mocks.createProviderConnection,
  getProxyPoolById: mocks.getProxyPoolById,
}));
vi.mock("@/lib/oauth/providers.js", () => ({
  exchangeTokens: mocks.exchangeTokens,
  extractCodexAccountInfo: () => ({}),
  generateAuthData: mocks.generateAuthData,
  getProvider: mocks.getProvider,
  pollForToken: mocks.pollForToken,
  requestDeviceCode: mocks.requestDeviceCode,
}));
vi.mock("@/lib/oauth/utils/server", () => ({
  clearCodexSession: mocks.clearCodexSession,
  clearXaiSession: mocks.clearXaiSession,
  getCodexSessionStatus: mocks.getCodexSessionStatus,
  getXaiSessionStatus: mocks.getXaiSessionStatus,
  registerCodexSession: mocks.registerCodexSession,
  registerXaiSession: vi.fn(),
  startCodexProxy: mocks.startCodexProxy,
  startXaiProxy: vi.fn(),
  stopCodexProxy: mocks.stopCodexProxy,
  stopXaiProxy: mocks.stopXaiProxy,
}));

import {
  clearOAuthFlowsForTests,
  getOAuthFlow,
} from "@/lib/oauth/flowStore.js";

import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
const require = createRequire(import.meta.url);
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const { createCallbackSubmission, pollDeviceFlow } = require("../../cli/src/cli/utils/oauthFlow.js");
let menu, api, promptMock, statuses, requests, stateNumber, committed, responses;
let cacheEntries;

// CommonJS require uses its own cache, not vi.mock's ESM registry. Install
// explicit cache entries before loading the shipped menu, and intercept the
// actual http.request transport. No sockets, clipboard, browser or secret DB.
function cacheMock(path, exports) {
  const id = require.resolve(path);
  cacheEntries.push([id, require.cache[id]]);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
async function dispatch(method, path, body) {
  const { GET, POST } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
  const url = new URL(path, "http://fixture.test");
  const [, , , provider, action] = url.pathname.split("/");
  const context = { params: Promise.resolve({ provider, action }) };
  return method === "GET" ? GET({ url: url.href }, context) : POST({ json: async () => body }, context);
}
function callback(data, code = "fixture-code", state = data.state) {
  const redirect = new URL(data.authUrl).searchParams.get("redirect_uri");
  return `${redirect}?code=${code}&state=${encodeURIComponent(state)}`;
}
async function authorize(provider = "iflow") {
  const result = await api.getOAuthAuthUrl(provider);
  expect(result.success).toBe(true);
  return result.data;
}

beforeEach(() => {
  clearOAuthFlowsForTests();
  vi.clearAllMocks();
  requests = []; responses = []; statuses = []; committed = []; stateNumber = 0; cacheEntries = [];
  mocks.ensureOutboundProxyInitialized.mockResolvedValue();
  mocks.getProvider.mockImplementation((provider) => ({ flowType: ["github", "qwen", "kiro"].includes(provider) ? "device_code" : "authorization_code_pkce" }));
  mocks.generateAuthData.mockImplementation(async (_provider, redirect) => {
    const state = `fixture-state-${++stateNumber}`;
    return { authUrl: `https://provider.test/authorize?redirect_uri=${encodeURIComponent(redirect)}&state=${state}`, state, codeVerifier: `private-${state}`, codeChallenge: "challenge", flowType: "authorization_code_pkce" };
  });
  mocks.exchangeTokens.mockImplementation(async (_provider, code) => ({ accessToken: `private-token-${code}`, refreshToken: "private-refresh", expiresIn: 3600 }));
  mocks.createProviderConnection.mockImplementation(async (data, options = {}) => {
    if (options.shouldCommit && !options.shouldCommit()) throw new Error("OAuth flow was cancelled or superseded before commit");
    committed.push(data);
    return { id: `connection-${data.accessToken}`, ...data };
  });
  mocks.requestDeviceCode.mockResolvedValue({ device_code: "private-device", user_code: "PUBLIC", verification_uri: "https://provider.test/device", interval: 2, expires_in: 30 });
  mocks.pollForToken.mockResolvedValue({ success: true, tokens: { accessToken: "private-device-token", expiresIn: 3600 } });
  promptMock = vi.fn();
  cacheMock("../../cli/src/cli/utils/input.js", { prompt: promptMock, pause: vi.fn(), confirm: vi.fn() });
  cacheMock("../../cli/src/cli/utils/display.js", { clearScreen: vi.fn(), showHeader: vi.fn(), showStatus: (...args) => statuses.push(args) });
  cacheMock("../../cli/src/cli/utils/clipboard.js", { copyToClipboard: vi.fn(() => false) });
  cacheMock("../../cli/src/cli/appDataDir.js", { getAppDataDir: () => "/closed-network/cli-fixture" });
  const readFile = fs.readFileSync;
  vi.spyOn(fs, "readFileSync").mockImplementation((path, ...args) => String(path).startsWith("/closed-network/") ? "fixture-auth" : readFile(path, ...args));
  vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw new Error("No secret writes allowed"); });
  vi.spyOn(https, "request").mockImplementation(() => { throw new Error("Unexpected HTTPS network request"); });
  vi.spyOn(http, "request").mockImplementation((options, receive) => {
    const req = new EventEmitter(); let body = "";
    req.setTimeout = () => {}; req.destroy = () => {};
    req.write = (chunk) => { body += chunk; };
    req.end = () => {
      const parsed = body ? JSON.parse(body) : undefined;
      requests.push({ method: options.method, path: options.path, body: parsed });
      responses.push(Promise.resolve(dispatch(options.method, options.path, parsed)).then((result) => {
        const res = new EventEmitter(); res.statusCode = result.status;
        receive(res); res.emit("data", JSON.stringify(result.body)); res.emit("end");
        return result;
      }).catch((error) => req.emit("error", error)));
    };
    return req;
  });
  for (const path of ["../../cli/src/cli/api/client.js", "../../cli/src/cli/menus/providers.js"]) {
    const id = require.resolve(path); cacheEntries.push([id, require.cache[id]]); delete require.cache[id];
  }
  api = require("../../cli/src/cli/api/client.js");
  menu = require("../../cli/src/cli/menus/providers.js").__test__;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks(); clearOAuthFlowsForTests();
  for (const [id, entry] of cacheEntries.reverse()) {
    if (entry) require.cache[id] = entry; else delete require.cache[id];
  }
});

describe("shipped CLI and public server OAuth ownership", () => {
  it.each(["claude", "codex", "gemini-cli", "antigravity", "iflow"])("completes %s through the actual menu and API client", async (provider) => {
    promptMock.mockImplementation(async () => {
      const data = [...requests].reverse().find((r) => r.path.includes("/authorize"));
      const state = `fixture-state-${stateNumber}`;
      return provider === "claude" ? `fixture-code#${state}` : `${new URL(data.path, "http://fixture.test").searchParams.get("redirect_uri")}?code=fixture-code&state=${state}`;
    });
    await menu.handleAddOAuthConnection(provider);
    expect(mocks.exchangeTokens).toHaveBeenCalledTimes(1);
    expect(requests.find((r) => r.path.endsWith("/exchange")).body).toEqual({ code: "fixture-code", state: "fixture-state-1", flowId: expect.any(String) });
    expect(mocks.exchangeTokens.mock.calls[0][3]).toBe("private-fixture-state-1");
    expect(statuses.at(-1)[0]).toContain("successfully");
  });

  it.each(["github", "qwen", "kiro"])("completes %s device mode without exposing a device code", async (provider) => {
    vi.useFakeTimers();
    const run = menu.handleAddDeviceCodeConnection(provider);
    await vi.advanceTimersByTimeAsync(2000);
    await run;
    const polls = requests.filter((r) => r.path.endsWith("/poll"));
    expect(polls).toHaveLength(1);
    expect(polls[0].body).toEqual({ flowId: expect.any(String) });
    expect(mocks.pollForToken.mock.calls[0][1]).toBe("private-device");
    expect(statuses.at(-1)[0]).toContain("successfully");
    await vi.advanceTimersByTimeAsync(60000);
    expect(mocks.pollForToken).toHaveBeenCalledTimes(1);
  });

  it("keeps two account callbacks isolated and submits each once", async () => {
    const first = await authorize(); const second = await authorize();
    const one = createCallbackSubmission("iflow", first, api.exchangeOAuthCode);
    const two = createCallbackSubmission("iflow", second, api.exchangeOAuthCode);
    await expect(one(callback(second))).rejects.toThrow("state");
    expect((await two(callback(second, "account-two"))).success).toBe(true);
    expect((await one(callback(first, "account-one"))).success).toBe(true);
    await expect(one(callback(first))).rejects.toThrow("already submitted");
    expect(mocks.exchangeTokens.mock.calls.map((c) => [c[1], c[3], c[4]])).toEqual([
      ["account-two", "private-fixture-state-2", second.state], ["account-one", "private-fixture-state-1", first.state],
    ]);
  });

  it.each(["missing", "wrong", "duplicate", "foreign-url", "raw-token"])("rejects %s callback in the actual menu before exchange", async (kind) => {
    promptMock.mockImplementation(async () => {
      const base = "http://localhost:20128/callback?code=fixture-code";
      return { missing: base, wrong: `${base}&state=forged`, duplicate: `${base}&state=fixture-state-1&state=fixture-state-1`, "foreign-url": "https://attacker.test/callback?code=x&state=fixture-state-1", "raw-token": "eyJfixture.payload.signature" }[kind];
    });
    await menu.handleAddOAuthConnection("iflow");
    expect(mocks.exchangeTokens).not.toHaveBeenCalled();
    expect(requests.some((r) => r.path.endsWith("/exchange"))).toBe(false);
  });

  it("rejects missing flow at the client and wrong/missing state or flow at the server", async () => {
    const data = await authorize();
    expect(() => createCallbackSubmission("iflow", { ...data, flowId: undefined }, api.exchangeOAuthCode)).toThrow("flow ID");
    for (const body of [{ code: "x", state: data.state }, { code: "x", flowId: data.flowId }, { code: "x", state: "wrong", flowId: data.flowId }, { code: "x", state: data.state, flowId: "wrong" }]) {
      expect((await api.exchangeOAuthCode("iflow", body)).success).toBe(false);
    }
    expect(mocks.exchangeTokens).not.toHaveBeenCalled();
  });

  it("prevents simultaneous duplicate callback submission and server replay", async () => {
    const data = await authorize();
    const submit = createCallbackSubmission("iflow", data, api.exchangeOAuthCode);
    const first = submit(callback(data));
    await expect(submit(callback(data))).rejects.toThrow("already submitted");
    expect((await first).success).toBe(true);
    expect((await api.exchangeOAuthCode("iflow", { code: "fixture-code", state: data.state, flowId: data.flowId })).success).toBe(false);
    expect(mocks.exchangeTokens).toHaveBeenCalledTimes(1);
  });

  it("honors server interval and slow_down through real API response wrapping", async () => {
    vi.useFakeTimers();
    mocks.pollForToken.mockResolvedValueOnce({ success: false, error: "slow_down", pending: true }).mockResolvedValueOnce({ success: false, error: "authorization_pending", pending: true }).mockResolvedValueOnce({ success: true, tokens: { accessToken: "fixture-device-token", expiresIn: 3600 } });
    const run = menu.handleAddDeviceCodeConnection("github");
    await vi.advanceTimersByTimeAsync(1999); expect(mocks.pollForToken).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(mocks.pollForToken).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6999); expect(mocks.pollForToken).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(mocks.pollForToken).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(7000); await run;
    expect(mocks.pollForToken).toHaveBeenCalledTimes(3);
  });

  it("expires without a poll at or after the deadline", async () => {
    vi.useFakeTimers();
    mocks.requestDeviceCode.mockResolvedValue({ device_code: "private-device", verification_uri: "https://provider.test/device", interval: 2, expires_in: 3 });
    mocks.pollForToken.mockResolvedValue({ success: false, pending: true, error: "authorization_pending" });
    const run = menu.handleAddDeviceCodeConnection("github");
    await vi.advanceTimersByTimeAsync(3000); await run;
    expect(mocks.pollForToken).toHaveBeenCalledTimes(1);
    expect(requests.at(-1).path).toContain("/cancel");
    await vi.advanceTimersByTimeAsync(60000); expect(mocks.pollForToken).toHaveBeenCalledTimes(1);
  });

  it("cancels from the actual menu without subsequent polls or leftover listeners", async () => {
    vi.useFakeTimers();
    const count = process.stdin.listenerCount("keypress");
    const run = menu.handleAddDeviceCodeConnection("github");
    await vi.advanceTimersByTimeAsync(1);
    process.stdin.emit("keypress", "", { name: "escape" });
    await run;
    await vi.advanceTimersByTimeAsync(60000);
    expect(mocks.pollForToken).not.toHaveBeenCalled();
    expect(requests.at(-1).path).toContain("/cancel");
    expect(process.stdin.listenerCount("keypress")).toBe(count);
  });

  it("isolates simultaneous device sessions and rejects foreign/missing poll flow IDs", async () => {
    mocks.requestDeviceCode.mockResolvedValueOnce({ device_code: "private-one", interval: 1, expires_in: 30 }).mockResolvedValueOnce({ device_code: "private-two", interval: 1, expires_in: 30 });
    const one = (await api.getOAuthDeviceCode("github")).data;
    const two = (await api.getOAuthDeviceCode("github")).data;
    expect(one.flowId).not.toBe(two.flowId);
    expect((await api.pollOAuthToken("github", {})).success).toBe(false);
    expect((await api.pollOAuthToken("qwen", { flowId: one.flowId })).success).toBe(false);
    expect((await api.pollOAuthToken("github", { flowId: two.flowId })).success).toBe(true);
    expect((await api.pollOAuthToken("github", { flowId: one.flowId })).success).toBe(true);
    expect(mocks.pollForToken.mock.calls.map((c) => c[1])).toEqual(["private-two", "private-one"]);
  });

  it("fails unsupported modes before prompting and keeps upstream credentials out of errors", async () => {
    mocks.generateAuthData.mockResolvedValue({ flowType: "import_token", authUrl: "https://provider.test", state: "state" });
    await menu.handleAddOAuthConnection("iflow");
    expect(promptMock).not.toHaveBeenCalled();
    mocks.requestDeviceCode.mockRejectedValue(new Error("private-upstream-credential"));
    await menu.handleAddDeviceCodeConnection("github");
    expect(JSON.stringify(statuses)).not.toContain("private-upstream-credential");
  });

  it.each([0, -1, "NaN", Infinity])("rejects invalid interval %s without polling", async (interval) => {
    await expect(pollDeviceFlow("github", { flowId: "fixture", interval, expiresAt: Date.now() + 10000 }, api)).rejects.toThrow("Invalid");
    expect(mocks.pollForToken).not.toHaveBeenCalled();
  });
  it("reuses server-selected redirect and client context rather than CLI assumptions", async () => {
    const redirect = "http://localhost:51121/oauth-callback";
    mocks.generateAuthData.mockResolvedValue({
      authUrl: `https://provider.test/authorize?redirect_uri=${encodeURIComponent(redirect)}&state=desktop-state`,
      redirectUri: redirect, state: "desktop-state", codeVerifier: "private-desktop-verifier",
      meta: { clientId: "server-selected-client" }, flowType: "authorization_code_pkce",
    });
    promptMock.mockResolvedValue(`${redirect}?code=desktop-code&state=desktop-state`);
    await menu.handleAddOAuthConnection("antigravity");
    expect(mocks.exchangeTokens.mock.calls[0].slice(0, 6)).toEqual([
      "antigravity", "desktop-code", redirect, "private-desktop-verifier", "desktop-state", { clientId: "server-selected-client" },
    ]);
  });

  it("cancels an in-flight poll promptly and blocks its late server commit", async () => {
    let finishPoll, pollStarted;
    const started = new Promise((resolve) => { pollStarted = resolve; });
    mocks.pollForToken.mockImplementation(() => {
      pollStarted();
      return new Promise((resolve) => { finishPoll = resolve; });
    });
    const data = (await api.getOAuthDeviceCode("github")).data;
    const controller = new AbortController();
    const run = pollDeviceFlow("github", data, api, { signal: controller.signal, wait: async () => {} });
    await started;
    controller.abort();
    expect((await run).cancelled).toBe(true);
    expect(getOAuthFlow({ flowId: data.flowId })).toBeNull();
    finishPoll({ success: true, tokens: { accessToken: "private-late-token", expiresIn: 3600 } });
    // Wait for the actual route to reject the late commit through its DB guard.
    const completed = await Promise.all(responses);
    expect(completed.some((response) => response.status === 410)).toBe(true);
    expect(mocks.createProviderConnection).toHaveBeenCalledTimes(1);
    expect(mocks.createProviderConnection.mock.calls[0][1].shouldCommit()).toBe(false);
    expect(committed).toEqual([]);
    expect(mocks.pollForToken).toHaveBeenCalledTimes(1);
  });

  it("does not poll after a terminal denial and never displays raw error text", async () => {
    vi.useFakeTimers();
    mocks.pollForToken.mockResolvedValue({ success: false, error: "access_denied", errorDescription: "private-credential-text" });
    const run = menu.handleAddDeviceCodeConnection("github");
    await vi.advanceTimersByTimeAsync(2000); await run;
    await vi.advanceTimersByTimeAsync(60000);
    expect(mocks.pollForToken).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(statuses)).not.toContain("private-credential-text");
    expect(statuses.at(-1)[0]).toContain("declined");
  });

  it.each(["plain-code", "code#", "code#forged", "eyJfixture.payload.signature#fixture-state-1"])("rejects unsupported Claude credential input %s", async (input) => {
    promptMock.mockResolvedValue(input);
    await menu.handleAddOAuthConnection("claude");
    expect(mocks.exchangeTokens).not.toHaveBeenCalled();
  });

  it("rejects an expired browser flow before issuing an exchange", async () => {
    const data = await authorize();
    const submit = createCallbackSubmission("iflow", { ...data, expiresAt: Date.now() - 1 }, api.exchangeOAuthCode);
    await expect(submit(callback(data))).rejects.toThrow("expired");
    expect(mocks.exchangeTokens).not.toHaveBeenCalled();
  });

  it("keeps application pending distinct from HTTP success even without an error field", async () => {
    vi.useFakeTimers();
    mocks.pollForToken.mockResolvedValueOnce({ success: false, pending: true });
    const run = menu.handleAddDeviceCodeConnection("github");
    await vi.advanceTimersByTimeAsync(2000);
    expect(statuses.some(([message]) => message.includes("successfully"))).toBe(false);
    await vi.advanceTimersByTimeAsync(2000); await run;
    expect(mocks.pollForToken).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)[0]).toContain("successfully");
  });

});
