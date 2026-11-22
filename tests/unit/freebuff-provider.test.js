// Staged Freebuff session provider. Every HTTP call here is a closed mock:
// no Freebuff or Codebuff account, token, device login or network is involved.
// Tokens are synthetic placeholders.
//
// Port source: OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/freebuff/index.ts, open-sse/executors/freebuff.ts,
// src/lib/oauth/providers/freebuff.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const { fetchHolder, routed } = vi.hoisted(() => {
  const holder = { fetch: null };
  return { fetchHolder: holder, routed: (...args) => holder.fetch(...args) };
});

vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn() }));
vi.mock("../../open-sse/utils/requestLogger.js", async (original) => ({
  ...(await original()),
  createRequestLogger: vi.fn(async () => ({ logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(), logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn() })),
}));

import entry, {
  FREEBUFF_AGENT_BY_MODEL, FREEBUFF_MODELS, FREEBUFF_OAUTH, FREEBUFF_OPT_IN_KEY,
  freebuffConnectionOptIn, freebuffCookieProfile,
} from "../../open-sse/providers/registry/freebuff.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_OAUTH } from "../../open-sse/providers/index.js";
import { getProviderModels } from "../../open-sse/config/providerModels.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import {
  FREEBUFF_CHAT_URL, FREEBUFF_RUNS_URL, FREEBUFF_SESSION_URL, FreebuffExecutor, validateFreebuffToken,
} from "../../open-sse/executors/freebuff.js";
import freebuffOAuth, {
  decodeFreebuffLoginState, encodeFreebuffLoginState,
} from "../../src/lib/oauth/freebuffProvider.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const TOKEN_A = "fbt_synthetic_device_token_a";
const TOKEN_B = "fbt_synthetic_device_token_b";
const MODEL = "deepseek/deepseek-v4-flash";
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const completion = (text) => ({
  id: "chatcmpl-fb-1", object: "chat.completion", created: 1, model: MODEL,
  choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
  usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
});
const sse = (text) => {
  const frame = (delta, finish = null) => `data: ${JSON.stringify({ id: "chatcmpl-fb-1", object: "chat.completion.chunk", created: 1, model: MODEL, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  return new Response(frame({ role: "assistant", content: text }) + frame({}, "stop") + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
};
const creds = (token, extra = {}) => ({ id: `fb-${token}`, apiKey: token, authType: "apikey", providerSpecificData: { [FREEBUFF_OPT_IN_KEY]: true, ...extra } });

// A fake Freebuff service keyed on the bearer token, recording every call.
function fakeService({ session = () => json({ instanceId: "inst-1" }), chat, runs = () => json({ runId: "run-1" }) } = {}) {
  const calls = [];
  fetchHolder.fetch = vi.fn(async (url, init = {}) => {
    const headers = init.headers || {};
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ url: String(url), headers, body });
    if (url === FREEBUFF_SESSION_URL) return session({ headers, body });
    if (url === FREEBUFF_RUNS_URL) return body.action === "START" ? runs({ headers, body }) : json({});
    if (url === FREEBUFF_CHAT_URL) return chat({ headers, body });
    throw new Error(`unexpected mocked URL ${url}`);
  });
  return calls;
}
const chatCall = (calls) => calls.find((call) => call.url === FREEBUFF_CHAT_URL);

beforeEach(() => { fetchHolder.fetch = vi.fn(async () => { throw new Error("no network in tests"); }); });
// The production executor map holds the shared instance; route its transport through the closed fetch.
beforeEach(() => { getExecutor("freebuff").fetchImpl = routed; });
afterEach(() => { vi.restoreAllMocks(); });

describe("Freebuff staged entry", () => {
  it("composes a separate session provider with the opt-in and an empty cookie profile", () => {
    expect(REGISTRY.find((x) => x.id === "freebuff")).toBe(entry);
    expect(PROVIDERS.freebuff).toMatchObject({ baseUrl: "https://www.codebuff.com/api/v1", format: "openai", executor: "freebuff" });
    expect(PROVIDER_OAUTH.freebuff).toMatchObject({ codeUrl: FREEBUFF_OAUTH.codeUrl, statusUrl: FREEBUFF_OAUTH.statusUrl });
    expect(freebuffConnectionOptIn).toEqual({ providerSpecificData: "enableSessionDispatch" });
    expect(freebuffCookieProfile).toMatchObject({ notApplicable: true, validationProbe: null });
    expect(freebuffCookieProfile.domains).toEqual([]);
    // Freebuff is not Codebuff: the paid Codebuff identity is untouched.
    expect(REGISTRY.filter((x) => x.id === "freebuff")).toHaveLength(1);
    expect(REGISTRY.find((x) => x.id === "codebuff" || x.alias === "cb")?.id ?? null).not.toBe("freebuff");
    expect(getExecutor("fb")).toBe(getExecutor("freebuff"));
  });

  it("lists the OmniRoute catalog, every model with an agent id", () => {
    const ids = getProviderModels("freebuff").map((m) => m.id);
    expect(ids).toEqual(FREEBUFF_MODELS.map((m) => m.id));
    expect(ids.length).toBeGreaterThanOrEqual(8);
    for (const id of ids) expect(FREEBUFF_AGENT_BY_MODEL[id]).toMatch(/^base2-free/);
    expect(FREEBUFF_MODELS.find((m) => m.id === "minimax/minimax-m3")).toMatchObject({ supportsVision: true });
  });
});

describe("Freebuff sign-in and refresh", () => {
  const EXPIRES = new Date(Date.now() + 5 * 60_000).toISOString();

  it("requests a login URL and carries the three poll values as one device code", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ loginUrl: "https://freebuff.com/login?x=1", fingerprintHash: "hash-1", expiresAt: EXPIRES }));
    const start = await freebuffOAuth.requestDeviceCode(freebuffOAuth.config);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe(FREEBUFF_OAUTH.codeUrl);
    const sent = JSON.parse(init.body);
    expect(sent.fingerprintId).toMatch(/^codebuff-cli-[A-Za-z0-9_-]{8}$/);
    expect(start).toMatchObject({ verification_uri: "https://freebuff.com/login?x=1", interval: 5 });
    expect(start.expires_in).toBeGreaterThan(200);
    expect(decodeFreebuffLoginState(start.device_code)).toEqual({ fingerprintId: sent.fingerprintId, fingerprintHash: "hash-1", expiresAt: EXPIRES });
  });

  it("rejects an incomplete login response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ loginUrl: "https://freebuff.com/l" }));
    await expect(freebuffOAuth.requestDeviceCode(freebuffOAuth.config)).rejects.toThrow(/missing required fields/);
  });

  it("polls pending (401) and then returns the device-session token", async () => {
    const deviceCode = encodeFreebuffLoginState({ fingerprintId: "codebuff-cli-abcd1234", fingerprintHash: "hash-1", expiresAt: EXPIRES });
    const spy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ error: "pending" }, 401))
      .mockResolvedValueOnce(json({ error: "busy" }, 429))
      .mockResolvedValueOnce(json({ user: { id: "u1", email: "a@example.test", name: "Ada", authToken: TOKEN_A } }));
    expect(await freebuffOAuth.pollToken(freebuffOAuth.config, deviceCode)).toEqual({ ok: false, data: { error: "authorization_pending" } });
    expect(await freebuffOAuth.pollToken(freebuffOAuth.config, deviceCode)).toEqual({ ok: false, data: { error: "slow_down" } });
    const done = await freebuffOAuth.pollToken(freebuffOAuth.config, deviceCode);
    const polled = new URL(spy.mock.calls[2][0]);
    expect(polled.origin + polled.pathname).toBe(FREEBUFF_OAUTH.statusUrl);
    expect(Object.fromEntries(polled.searchParams)).toEqual({ fingerprintId: "codebuff-cli-abcd1234", fingerprintHash: "hash-1", expiresAt: EXPIRES });
    expect(done.ok).toBe(true);
    const mapped = freebuffOAuth.mapTokens(done.data);
    expect(mapped).toMatchObject({ accessToken: TOKEN_A, refreshToken: null, expiresIn: null, email: "a@example.test", displayName: "Ada" });
    expect(mapped.providerSpecificData).toMatchObject({ userId: "u1", fingerprintId: "codebuff-cli-abcd1234" });
    // Signing in never turns dispatch on: that stays an explicit opt-in.
    expect(mapped.providerSpecificData[FREEBUFF_OPT_IN_KEY]).toBeUndefined();
  });

  it("reports an expired login and a malformed device code", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({}, 401));
    const expired = await freebuffOAuth.pollToken(freebuffOAuth.config, encodeFreebuffLoginState({ fingerprintId: "f", fingerprintHash: "h", expiresAt: past }));
    expect(expired.data.error).toBe("expired_token");
    expect((await freebuffOAuth.pollToken(freebuffOAuth.config, "not-a-code")).data.error).toBe("invalid_request");
  });

  it("has no refresh grant: refresh is a no-op and a rejected token asks for a new login", async () => {
    const executor = new FreebuffExecutor({ fetch: routed });
    expect(await executor.refreshCredentials(creds(TOKEN_A), log)).toBeNull();
    expect(executor.needsRefresh(creds(TOKEN_A))).toBe(false);
    fakeService({ session: () => json({ error: "expired" }, 401), chat: () => json({}) });
    const res = await executor.execute({ model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials: creds(TOKEN_A) });
    expect(res.response.status).toBe(401);
    expect((await res.response.json()).error.message).toMatch(/sign in to Freebuff again/);
  });

  it("validates a pasted token with the session probe (409 means a session exists)", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ instanceId: "i" })).mockResolvedValueOnce(json({}, 409))
      .mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({ error: "boom" }, 500));
    expect(await validateFreebuffToken({ apiKey: TOKEN_A }, { fetch: fetcher })).toMatchObject({ valid: true });
    expect(await validateFreebuffToken({ apiKey: TOKEN_A }, { fetch: fetcher })).toMatchObject({ valid: true });
    expect(await validateFreebuffToken({ apiKey: TOKEN_A }, { fetch: fetcher })).toMatchObject({ valid: false, error: "Invalid or expired Freebuff Auth Token" });
    expect((await validateFreebuffToken({ apiKey: TOKEN_A }, { fetch: fetcher })).error).toMatch(/returned 500/);
    expect(fetcher.mock.calls[0][0]).toBe(FREEBUFF_SESSION_URL);
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN_A}`);
    expect(await validateFreebuffToken({ apiKey: "" }, { fetch: fetcher })).toMatchObject({ valid: false, error: "Freebuff Auth Token required" });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});

describe("Freebuff opt-in", () => {
  it.each([[undefined], [{}], [{ [FREEBUFF_OPT_IN_KEY]: "true" }], [{ [FREEBUFF_OPT_IN_KEY]: 1 }], [{ [FREEBUFF_OPT_IN_KEY]: false }]])(
    "refuses to dispatch without enableSessionDispatch === true (%j)", async (providerSpecificData) => {
      const executor = new FreebuffExecutor({ fetch: routed });
      const res = await executor.execute({ model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials: { apiKey: TOKEN_A, providerSpecificData } });
      const body = await res.response.json();
      expect(res.response.status).toBe(403);
      expect(body.error.code).toBe("freebuff_dispatch_disabled");
      expect(body.error.message).toContain("providerSpecificData.enableSessionDispatch");
      expect(fetchHolder.fetch).not.toHaveBeenCalled();
    });

  it("returns the clear error through the OpenAI chat route too", async () => {
    const body = { model: `freebuff/${MODEL}`, messages: [{ role: "user", content: "hi" }], stream: false };
    const result = await handleChatCore({ body, modelInfo: { provider: "freebuff", model: MODEL }, credentials: creds(TOKEN_A, { [FREEBUFF_OPT_IN_KEY]: false }), clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} }, sourceFormatOverride: FORMATS.OPENAI, connectionId: "fb-off", log, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
    expect(result.response.status).toBe(403);
    expect(JSON.stringify(await result.response.json())).toContain("enableSessionDispatch");
    expect(fetchHolder.fetch).not.toHaveBeenCalled();
  });

  it("reports a missing token when opted in", async () => {
    const executor = new FreebuffExecutor({ fetch: routed });
    const res = await executor.execute({ model: MODEL, body: { messages: [] }, stream: false, credentials: { apiKey: "", providerSpecificData: { [FREEBUFF_OPT_IN_KEY]: true } } });
    expect(res.response.status).toBe(401);
    expect((await res.response.json()).error.message).toMatch(/Freebuff Auth Token required/);
  });
});

describe("Freebuff chat dispatch", () => {
  it.each([["/v1/chat/completions", FORMATS.OPENAI], ["/v1/messages", FORMATS.CLAUDE]])(
    "routes JSON and streamed turns through %s", async (endpoint, format) => {
      const calls = fakeService({ chat: ({ body }) => (body.stream ? sse("Freebuff says hello") : json(completion("Freebuff says hello"))) });
      for (const stream of [false, true]) {
        const messages = [{ role: "user", content: "hi" }];
        const body = endpoint === "/v1/messages" ? { model: `freebuff/${MODEL}`, max_tokens: 40, messages, stream } : { model: `freebuff/${MODEL}`, messages, stream };
        const result = await handleChatCore({ body, modelInfo: { provider: "freebuff", model: MODEL }, credentials: creds(TOKEN_A), clientRawRequest: { endpoint, body, headers: {} }, sourceFormatOverride: format, connectionId: "fb-a", log, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
        expect(result.response.status).toBe(200);
        expect(await result.response.text()).toContain("Freebuff says hello");
      }
      const chats = calls.filter((c) => c.url === FREEBUFF_CHAT_URL);
      expect(chats.map((c) => c.body.stream)).toEqual([false, true]);
      for (const chat of chats) {
        expect(chat.headers.Authorization).toBe(`Bearer ${TOKEN_A}`);
        expect(chat.headers["x-freebuff-instance-id"]).toBe("inst-1");
        expect(chat.headers["x-codebuff-run-id"]).toBe("run-1");
        expect(chat.headers["x-codebuff-agent-id"]).toBe("base2-free-deepseek-flash");
        expect(chat.body).toMatchObject({ model: MODEL, codebuff_metadata: { run_id: "run-1", cost_mode: "free", freebuff_instance_id: "inst-1" } });
        expect(chat.body.messages[0]).toEqual({ role: "system", content: "You are Buffy, the strategic coding assistant." });
        expect(chat.body.messages.at(-1)).toMatchObject({ role: "user" });
      }
      // The run is finished in the background after each chat.
      await vi.waitFor(() => expect(calls.filter((c) => c.body.action === "FINISH")).toHaveLength(2));
      expect(calls.filter((c) => c.body.action === "FINISH")[0].body).toMatchObject({ runId: "run-1", status: "completed" });
    });

  it("keeps an existing Buffy prompt and still dispatches when the run start fails", async () => {
    const calls = fakeService({ runs: () => json({ error: "no" }, 500), chat: () => json(completion("ok")) });
    const executor = new FreebuffExecutor({ fetch: routed });
    const res = await executor.execute({ model: "freebuff/minimax/minimax-m3", body: { messages: [{ role: "system", content: "You are Buffy, custom." }, { role: "user", content: "hi" }] }, stream: false, credentials: creds(TOKEN_A) });
    expect(res.response.status).toBe(200);
    const chat = chatCall(calls);
    expect(chat.body.messages.filter((m) => m.role === "system")).toHaveLength(1);
    expect(chat.headers["x-codebuff-run-id"]).toBeUndefined();
    expect(chat.headers["x-codebuff-agent-id"]).toBe("base2-free-minimax-m3");
    expect(calls.some((c) => c.body.action === "FINISH")).toBe(false);
  });

  it("maps 401 at session and chat to a re-login authentication error", async () => {
    const executor = new FreebuffExecutor({ fetch: routed });
    const input = { model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials: creds(TOKEN_A) };
    fakeService({ session: () => json({ error: "bad token" }, 401), chat: () => json({}) });
    const atSession = await executor.execute(input);
    expect(atSession.response.status).toBe(401);
    expect((await atSession.response.json()).error).toMatchObject({ type: "authentication_error", code: "freebuff_auth_invalid" });

    const calls = fakeService({ chat: () => json({ error: "expired" }, 403) });
    const atChat = await executor.execute(input);
    expect(atChat.response.status).toBe(401);
    expect((await atChat.response.json()).error.message).toMatch(/rejected the auth token at chat/);
    await vi.waitFor(() => expect(calls.find((c) => c.body.action === "FINISH")?.body.status).toBe("failed"));
  });

  it("maps 429 at session and chat to a rate limit and keeps Retry-After", async () => {
    const executor = new FreebuffExecutor({ fetch: routed });
    const input = { model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials: creds(TOKEN_A) };
    fakeService({ session: () => json({ error: "queue full" }, 429, { "retry-after": "30" }), chat: () => json({}) });
    const atSession = await executor.execute(input);
    expect(atSession.response.status).toBe(429);
    expect(atSession.response.headers.get("retry-after")).toBe("30");
    expect((await atSession.response.json()).error).toMatchObject({ type: "rate_limit_error", code: "freebuff_rate_limited" });

    fakeService({ chat: () => json({ error: "daily limit" }, 429) });
    const atChat = await executor.execute(input);
    expect(atChat.response.status).toBe(429);
    expect((await atChat.response.json()).error.message).toMatch(/limit reached at chat/);
  });

  it("surfaces other upstream failures and network errors as upstream errors", async () => {
    const executor = new FreebuffExecutor({ fetch: routed });
    const input = { model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials: creds(TOKEN_A) };
    fakeService({ chat: () => json({ error: "overloaded" }, 503) });
    const res = await executor.execute(input);
    expect(res.response.status).toBe(503);
    expect((await res.response.json()).error.message).toMatch(/chat failed \(503\)/);

    fetchHolder.fetch = vi.fn(async () => { throw new Error("socket hang up"); });
    const net = await executor.execute(input);
    expect(net.response.status).toBe(502);
    expect((await net.response.json()).error.message).toMatch(/session network error: socket hang up/);
  });

  it("treats a 409 session conflict as usable only when it carries an instance id", async () => {
    const executor = new FreebuffExecutor({ fetch: routed });
    const input = { model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials: creds(TOKEN_A) };
    const calls = fakeService({ session: () => json({ instanceId: "inst-existing" }, 409), chat: () => json(completion("ok")) });
    expect((await executor.execute(input)).response.status).toBe(200);
    expect(chatCall(calls).headers["x-freebuff-instance-id"]).toBe("inst-existing");
    fakeService({ session: () => json({ error: "exists" }, 409), chat: () => json(completion("ok")) });
    expect((await executor.execute(input)).response.status).toBe(409);
  });

  it("keeps two connections' tokens, sessions and runs isolated", async () => {
    const calls = fakeService({
      session: ({ headers }) => json({ instanceId: `inst-${headers.Authorization.slice(-1)}` }),
      runs: ({ headers }) => json({ runId: `run-${headers.Authorization.slice(-1)}` }),
      chat: ({ headers }) => json(completion(`reply for ${headers.Authorization.slice(-1)}`)),
    });
    const executor = getExecutor("freebuff");
    const input = (credentials) => ({ model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials });
    const [a, b] = await Promise.all([
      executor.execute(input(creds(TOKEN_A))),
      executor.execute(input(creds(TOKEN_B.replace(/b$/, "B"), { fingerprintId: "other" }))),
    ]);
    expect((await a.response.json()).choices[0].message.content).toBe("reply for a");
    expect((await b.response.json()).choices[0].message.content).toBe("reply for B");
    const chats = calls.filter((c) => c.url === FREEBUFF_CHAT_URL);
    const byToken = Object.fromEntries(chats.map((c) => [c.headers.Authorization.slice(-1), c]));
    expect(byToken.a.headers).toMatchObject({ "x-freebuff-instance-id": "inst-a", "x-codebuff-run-id": "run-a" });
    expect(byToken.B.headers).toMatchObject({ "x-freebuff-instance-id": "inst-B", "x-codebuff-run-id": "run-B" });
    expect(byToken.a.body.codebuff_metadata.client_id).not.toBe(byToken.B.body.codebuff_metadata.client_id);
    // No call ever carried the other connection's token.
    for (const call of calls) expect(call.headers.Authorization).toMatch(/(_a|_B)$/);
  });

  it("reads an OAuth connection's accessToken when no API key is stored", async () => {
    const calls = fakeService({ chat: () => json(completion("ok")) });
    const executor = new FreebuffExecutor({ fetch: routed });
    const res = await executor.execute({ model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials: { accessToken: TOKEN_A, providerSpecificData: { [FREEBUFF_OPT_IN_KEY]: true } } });
    expect(res.response.status).toBe(200);
    expect(chatCall(calls).headers.Authorization).toBe(`Bearer ${TOKEN_A}`);
  });
});
