// Staged Zed-hosted provider (opt-in). Every network call here is an in-memory fake of
// Zed's sign-in, LLM-token, model-catalog and completion endpoints: no Zed account,
// token, cookie or network is involved, and all credentials are synthetic.
//
// Sources: OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/shared/zedAuth.ts, open-sse/executors/zed-hosted.ts,
// src/lib/oauth/providers/zed-hosted.ts. The fake pins the contract those files
// implement; it does not prove Zed's live behavior.
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const routedFetch = vi.hoisted(() => vi.fn());
vi.mock("open-sse/utils/proxyFetch.js", async (original) => ({ ...(await original()), proxyAwareFetch: routedFetch }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn() }));

import entry, { zedHostedCookieProfile } from "../../open-sse/providers/registry/zed-hosted.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import zedIde from "../../open-sse/providers/registry/zed.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { ZedHostedExecutor } from "../../open-sse/executors/zed-hosted.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { clearZedCaches, ZED_HEADERS } from "../../open-sse/shared/zedHostedAuth.js";
import { zedHosted, resolveDashboardLoopbackPort } from "../../src/lib/oauth/zedHostedProvider.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";

const CLOUD = "https://cloud.zed.dev";
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const ndjson = (frames) => new Response(frames.map((frame) => JSON.stringify(frame)).join("\n") + "\n", { status: 200, headers: { "content-type": "application/x-ndjson" } });

// Two synthetic Zed accounts. They deliberately share a token tail so a cache keyed on
// the tail alone would leak one connection's LLM token to the other.
const ACCOUNT_A = { id: "zed-a", userId: "user-a", token: "synthetic-access-AAAA-shared-tail-0123456789", org: "org-a" };
const ACCOUNT_B = { id: "zed-b", userId: "user-a", token: "synthetic-access-BBBB-shared-tail-0123456789", org: "org-a" };
const connection = (account, extra = {}) => ({
  id: account.id, provider: "zed-hosted", accessToken: account.token,
  providerSpecificData: { userId: account.userId, organizationId: account.org, enableSessionDispatch: true, ...extra },
});

const CLAUDE_MODEL = "claude-synthetic-1";
const GROK_MODEL = "grok-synthetic-1";
const CATALOG = {
  default_model: CLAUDE_MODEL,
  models: [
    { id: CLAUDE_MODEL, display_name: "Synthetic Claude", provider: "anthropic", supports_tools: true },
    { id: GROK_MODEL, display_name: "Synthetic Grok", provider: "x_ai" },
    { id: "disabled-model", display_name: "Disabled", provider: "open_ai", is_disabled: true },
  ],
};

const claudeFrames = (text) => [
  { event: { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: CLAUDE_MODEL, content: [], usage: { input_tokens: 7, output_tokens: 0 } } } },
  { event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
  ...[...text].length ? [{ event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(0, 2) } } },
    { event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(2) } } }] : [],
  { event: { type: "content_block_stop", index: 0 } },
  { event: { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } } },
  { event: { type: "message_stop" } },
  { status: "stream_ended" },
];

// ── fake cloud.zed.dev ────────────────────────────────────────────────────────
const accounts = new Map([ACCOUNT_A, ACCOUNT_B].map((account) => [account.token, account]));
let calls;
let llmTokens;
let zed;
const headerOf = (init, name) => new Headers(init.headers).get(name);

function install(overrides = {}) {
  calls = [];
  llmTokens = new Map();
  zed = { llmTokenStatus: 200, completions: ({ body }) => ndjson(claudeFrames("Hello")), models: () => json(CATALOG), issued: 0, ...overrides };
  routedFetch.mockImplementation(async (url, init = {}) => {
    const target = String(url);
    const call = { url: target, method: init.method || "GET", headers: init.headers, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    const path = target.replace(CLOUD, "");
    if (path === "/client/users/me") {
      const [userId, token] = String(headerOf(init, "authorization")).split(" ");
      const account = accounts.get(token);
      return account && account.userId === userId ? json({ id: userId, email: `${account.id}@synthetic.invalid`, github_login: account.id, default_organization_id: account.org, organizations: [{ id: account.org, is_personal: true }] }) : json({ message: "unauthorized" }, 401);
    }
    if (path === "/client/llm_tokens") {
      if (zed.llmTokenStatus !== 200) return json({ message: zed.llmTokenStatus === 429 ? "rate limited" : "unauthorized" }, zed.llmTokenStatus);
      const [, token] = String(headerOf(init, "authorization")).split(" ");
      if (!accounts.has(token)) return json({ message: "unauthorized" }, 401);
      const llm = `llm-${token.slice(10, 15)}-${++zed.issued}`;
      llmTokens.set(llm, token);
      return json({ token: llm });
    }
    const bearer = String(headerOf(init, "authorization")).replace(/^Bearer /, "");
    if (!llmTokens.has(bearer)) return json({ message: "bad llm token" }, 401, { [ZED_HEADERS.expiredToken]: "true" });
    call.account = accounts.get(llmTokens.get(bearer));
    call.llmToken = bearer;
    if (path === "/models") return zed.models(call);
    if (path === "/completions") return zed.completions(call);
    throw new Error(`unexpected mocked URL ${target}`);
  });
}

const completionCalls = () => calls.filter((call) => call.url === `${CLOUD}/completions`);
beforeEach(() => { clearZedCaches(); install(); });
afterEach(() => { vi.clearAllMocks(); routedFetch.mockReset(); });

// ── routes ────────────────────────────────────────────────────────────────────
const call = (endpoint, credentials, { stream = false, model = CLAUDE_MODEL, anthropic = false } = {}) => {
  const body = anthropic
    ? { model, max_tokens: 64, stream, messages: [{ role: "user", content: "hi there" }] }
    : { model, stream, messages: [{ role: "user", content: "hi there" }] };
  return handleChatCore({
    body, modelInfo: { provider: "zed-hosted", model }, credentials, connectionId: credentials.id,
    clientRawRequest: { endpoint, body, headers: {} }, sourceFormatOverride: anthropic ? "claude" : undefined,
    log, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false,
  });
};
const openai = (credentials, options) => call("/v1/chat/completions", credentials, options);
const messages = (credentials, options) => call("/v1/messages", credentials, { ...options, anthropic: true });
const direct = (credentials, extra = {}) => getExecutor("zed-hosted").execute({
  model: CLAUDE_MODEL, stream: true, credentials, body: { model: CLAUDE_MODEL, messages: [{ role: "user", content: "hi" }] }, ...extra,
});

describe("Zed-hosted staged provider profile", () => {
  it("composes as its own oauth provider, separate from the Zed IDE key import", () => {
    expect(entry).toMatchObject({ id: "zed-hosted", category: "oauth", authType: "oauth", hasOAuth: true, passthroughModels: true, models: [] });
    expect(zedHostedCookieProfile).toMatchObject({ notApplicable: true, domains: [], cookieNames: [], validationProbe: null });
    expect(REGISTRY.some((provider) => provider.id === "zed-hosted")).toBe(true);
    expect(PROVIDERS["zed-hosted"]).toMatchObject({ baseUrl: `${CLOUD}/completions`, executor: "zed-hosted", forceStream: true });
    expect(getExecutor("zdh")).toBe(getExecutor("zed-hosted"));
    // The existing key-import entry is untouched.
    expect(zedIde).toMatchObject({ id: "zed", hidden: true, transport: null, models: [] });
    expect(REGISTRY.find((provider) => provider.id === "zed")).toBe(zedIde);
  });
});

describe("sign-in", () => {
  // Plays Zed's browser step: encrypt a token to the public key the sign-in URL carries.
  const completeInBrowser = (authUrl, accessToken, userId = ACCOUNT_A.userId) => {
    const params = new URL(authUrl).searchParams;
    const publicKey = crypto.createPublicKey({ key: Buffer.from(params.get("native_app_public_key"), "base64url"), format: "der", type: "pkcs1" });
    const encrypted = crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(accessToken));
    return `http://127.0.0.1:${params.get("native_app_port")}/?user_id=${userId}&access_token=${encrypted.toString("base64url")}`;
  };

  it("builds a native-app sign-in URL with a fresh keypair and no client secret", () => {
    const first = zedHosted.buildAuthUrl(zedHosted.config, "http://127.0.0.1:20128/callback");
    const second = zedHosted.buildAuthUrl(zedHosted.config, "https://dashboard.example.invalid/callback");
    const url = new URL(first.authUrl);
    expect(url.origin + url.pathname).toBe("https://zed.dev/native_app_signin");
    expect(url.searchParams.get("native_app_port")).toBe("20128");
    expect(first.redirectUri).toBe("http://127.0.0.1:20128/");
    expect([...url.searchParams.keys()].sort()).toEqual(["native_app_port", "native_app_public_key", "system_id"]);
    expect(first.codeVerifier).toMatch(/^zed-rsa-pkcs1:/);
    // Remote dashboards cannot be a loopback target: default port, manual paste.
    expect(new URL(second.authUrl).searchParams.get("native_app_port")).toBe("58443");
    expect(new URL(second.authUrl).searchParams.get("native_app_public_key")).not.toBe(url.searchParams.get("native_app_public_key"));
    expect(resolveDashboardLoopbackPort("http://localhost:443/x", { PORT: "20128" })).toBe(20128);
    expect(resolveDashboardLoopbackPort("https://lan.example.invalid/x", { PORT: "20128" })).toBeNull();
  });

  it("decrypts the callback token, resolves the account and maps tokens without a refresh grant", async () => {
    const auth = zedHosted.buildAuthUrl(zedHosted.config, "http://127.0.0.1:20128/callback");
    const callback = completeInBrowser(auth.authUrl, ACCOUNT_A.token);
    const tokens = await zedHosted.exchangeToken(zedHosted.config, callback, auth.redirectUri, auth.codeVerifier, null, { systemId: auth.systemId });
    const mapped = zedHosted.mapTokens(tokens);
    expect(mapped).toMatchObject({
      accessToken: ACCOUNT_A.token, email: "zed-a@synthetic.invalid",
      providerSpecificData: { userId: "user-a", organizationId: "org-a", systemId: auth.systemId },
    });
    expect(mapped.refreshToken).toBeUndefined();
    expect(mapped.expiresIn).toBeUndefined();
    const me = calls.find((entryCall) => entryCall.url === `${CLOUD}/client/users/me`);
    expect(headerOf(me, "authorization")).toBe(`user-a ${ACCOUNT_A.token}`);
    expect(headerOf(me, ZED_HEADERS.systemId)).toBe(auth.systemId);
  });

  it("accepts a pasted bare query string and rejects a token sealed for another keypair", async () => {
    const auth = zedHosted.buildAuthUrl(zedHosted.config, "http://127.0.0.1:20128/callback");
    const other = zedHosted.buildAuthUrl(zedHosted.config, "http://127.0.0.1:20128/callback");
    const query = completeInBrowser(auth.authUrl, ACCOUNT_B.token).split("/?")[1];
    const tokens = await zedHosted.exchangeToken(zedHosted.config, query, auth.redirectUri, auth.codeVerifier);
    expect(tokens.access_token).toBe(ACCOUNT_B.token);
    await expect(zedHosted.exchangeToken(zedHosted.config, completeInBrowser(auth.authUrl, ACCOUNT_A.token), other.redirectUri, other.codeVerifier)).rejects.toThrow("Failed to decrypt Zed access token");
    await expect(zedHosted.exchangeToken(zedHosted.config, "user_id=only", auth.redirectUri, auth.codeVerifier)).rejects.toThrow("user_id and access_token");
    await expect(zedHosted.exchangeToken(zedHosted.config, query, auth.redirectUri, "not-a-verifier")).rejects.toThrow("restart the login flow");
  });

  it("keeps the sign-in when the profile lookup fails", async () => {
    routedFetch.mockImplementation(async () => json({ message: "down" }, 503));
    const auth = zedHosted.buildAuthUrl(zedHosted.config, "http://127.0.0.1:20128/callback");
    const tokens = await zedHosted.exchangeToken(zedHosted.config, completeInBrowser(auth.authUrl, ACCOUNT_A.token), auth.redirectUri, auth.codeVerifier);
    expect(zedHosted.mapTokens(tokens)).toMatchObject({ accessToken: ACCOUNT_A.token, providerSpecificData: { userId: "user-a" } });
  });
});

describe("token refresh", () => {
  it("exchanges one LLM token per credential and reuses it across requests", async () => {
    await openai(connection(ACCOUNT_A));
    await openai(connection(ACCOUNT_A));
    expect(calls.filter((entryCall) => entryCall.url === `${CLOUD}/client/llm_tokens`)).toHaveLength(1);
    expect(calls.find((entryCall) => entryCall.url === `${CLOUD}/client/llm_tokens`).body).toEqual({ organization_id: "org-a" });
  });

  it("re-exchanges the LLM token once when Zed reports it expired, then succeeds", async () => {
    let first = true;
    zed.completions = (entryCall) => {
      if (first) { first = false; llmTokens.delete(entryCall.llmToken); return json({ message: "expired" }, 401, { [ZED_HEADERS.expiredToken]: "true" }); }
      return ndjson(claudeFrames("Hello"));
    };
    const result = await openai(connection(ACCOUNT_A));
    expect(result.success).toBe(true);
    expect((await result.response.json()).choices[0].message.content).toBe("Hello");
    expect(calls.filter((entryCall) => entryCall.url === `${CLOUD}/client/llm_tokens`)).toHaveLength(2);
    const [stale, fresh] = completionCalls();
    expect(stale.llmToken).not.toBe(fresh.llmToken);
  });

  it("does not loop when a fresh LLM token is also rejected", async () => {
    zed.completions = () => json({ message: "revoked" }, 401);
    const result = await openai(connection(ACCOUNT_A));
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(401);
    expect(completionCalls()).toHaveLength(2);
  });

  it("declares no gateway-side refresh for the long-lived Zed access token", async () => {
    const executor = getExecutor("zed-hosted");
    expect(executor.needsRefresh(connection(ACCOUNT_A))).toBe(false);
    expect(await executor.refreshCredentials(connection(ACCOUNT_A))).toBeNull();
  });
});

describe("opt-in guard", () => {
  it.each([
    ["missing providerSpecificData", { providerSpecificData: undefined }],
    ["flag false", { providerSpecificData: { userId: "user-a", organizationId: "org-a", enableSessionDispatch: false } }],
    ["truthy string is not an opt-in", { providerSpecificData: { userId: "user-a", organizationId: "org-a", enableSessionDispatch: "true" } }],
  ])("refuses with a clear error and makes no network call: %s", async (_label, override) => {
    const credentials = { ...connection(ACCOUNT_A), ...override };
    for (const stream of [false, true]) {
      for (const route of [openai, messages]) {
        const routed = await route(credentials, { stream });
        expect(routed.success).toBe(false);
        expect(routed.response.status).toBe(403);
        expect((await routed.response.json()).error.message).toContain("providerSpecificData.enableSessionDispatch");
      }
    }
    const own = await direct(credentials);
    expect(own.response.status).toBe(403);
    expect((await own.response.json()).error.code).toBe("zed_hosted_dispatch_disabled");
    expect(routedFetch).not.toHaveBeenCalled();
  });

  it("also keeps model discovery closed until the connection opts in", async () => {
    const closed = await fetchConnectionModels(connection(ACCOUNT_A, { enableSessionDispatch: false }));
    expect(closed).toMatchObject({ status: 403 });
    expect(closed.error).toContain("providerSpecificData.enableSessionDispatch");
    expect(routedFetch).not.toHaveBeenCalled();
  });
});

describe("model discovery", () => {
  it("lists the live catalog for the connection after the LLM-token exchange, without disabled models", async () => {
    const result = await fetchConnectionModels(connection(ACCOUNT_A));
    expect(result).toMatchObject({ provider: "zed-hosted", connectionId: "zed-a", source: "provider_api" });
    expect(result.models).toEqual([
      { id: CLAUDE_MODEL, name: "Synthetic Claude", owned_by: "zed-hosted" },
      { id: GROK_MODEL, name: "Synthetic Grok", owned_by: "zed-hosted" },
    ]);
    const modelsCall = calls.find((entryCall) => entryCall.url === `${CLOUD}/models`);
    expect(headerOf(modelsCall, "authorization")).toBe(`Bearer ${modelsCall.llmToken}`);
    expect(headerOf(modelsCall, ZED_HEADERS.clientSupportsXai)).toBe("true");
  });

  it("maps an invalid sign-in to 401", async () => {
    zed.llmTokenStatus = 401;
    expect(await fetchConnectionModels(connection(ACCOUNT_A))).toMatchObject({ status: 401 });
  });
});

describe("chat through the OpenAI and Anthropic routes", () => {
  it("returns OpenAI JSON and sends a Zed thread envelope with the vendor-shaped request", async () => {
    const result = await openai(connection(ACCOUNT_A));
    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.choices[0].message).toMatchObject({ role: "assistant", content: "Hello" });
    expect(body.choices[0].finish_reason).toBe("stop");
    const [completion] = completionCalls();
    expect(completion.body).toMatchObject({ provider: "anthropic", model: CLAUDE_MODEL });
    expect(completion.body.provider_request.messages[0].role).toBe("user");
    expect(completion.body.provider_request.stream).toBe(true);
    expect(headerOf(completion, "x-zed-version")).toMatch(/^\d+\.\d+\.\d+$/);
    expect(headerOf(completion, ZED_HEADERS.clientSupportsStatus)).toBe("true");
    expect(headerOf(completion, "authorization")).toBe(`Bearer ${completion.llmToken}`);
    expect(headerOf(completion, "authorization")).not.toContain(ACCOUNT_A.token);
  });

  it("streams OpenAI chunks", async () => {
    const result = await openai(connection(ACCOUNT_A), { stream: true });
    expect(result.success).toBe(true);
    expect(result.response.headers.get("content-type")).toContain("text/event-stream");
    const text = await result.response.text();
    expect([...text.matchAll(/"content":"([^"]*)"/g)].map((match) => match[1]).join("")).toBe("Hello");
    expect(text).toContain('"finish_reason":"stop"');
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
  });

  it("serves a Messages request as an Anthropic message", async () => {
    const result = await messages(connection(ACCOUNT_A));
    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.type).toBe("message");
    expect(body.content[0]).toMatchObject({ type: "text", text: "Hello" });
  });

  it("serves a streamed Messages request as Anthropic events", async () => {
    const result = await messages(connection(ACCOUNT_A), { stream: true });
    expect(result.success).toBe(true);
    const text = await result.response.text();
    expect(text).toContain("event: message_start");
    expect(text).toContain("content_block_delta");
    expect(text).toContain("event: message_stop");
  });

  it("passes xAI-shaped chunks through for models Zed fronts with an OpenAI-compatible vendor", async () => {
    zed.completions = () => ndjson([
      { event: { id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "Gro" } }] } },
      { event: { id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "k" }, finish_reason: "stop" }] } },
      { status: "stream_ended" },
    ]);
    const result = await openai(connection(ACCOUNT_A), { model: GROK_MODEL });
    expect((await result.response.json()).choices[0].message.content).toBe("Grok");
    expect(completionCalls()[0].body.provider).toBe("x_ai");
    expect(completionCalls()[0].body.provider_request).toMatchObject({ model: GROK_MODEL, stream: true });
  });

  it("returns a clear error and no partial answer when Zed fails the stream before any output", async () => {
    zed.completions = () => ndjson([{ status: { failed: { message: "model overloaded" } } }]);
    const result = await openai(connection(ACCOUNT_A), { stream: true });
    const text = await result.response.text();
    expect(text).toContain("ZED_STREAM_FAILED");
    expect(text).toContain("model overloaded");
  });

  it("infers the vendor from the model name when the catalog is unavailable", async () => {
    zed.models = () => json({ message: "down" }, 500);
    const result = await openai(connection(ACCOUNT_A));
    expect(result.success).toBe(true);
    expect(completionCalls()[0].body.provider).toBe("anthropic");
  });
});

describe("credential and quota error mapping", () => {
  it.each([
    ["the sign-in is rejected when exchanging an LLM token", { llmTokenStatus: 401 }, 401, "sign in to Zed again"],
    ["the sign-in is forbidden when exchanging an LLM token", { llmTokenStatus: 403 }, 401, "sign in to Zed again"],
    ["the LLM-token endpoint rate limits", { llmTokenStatus: 429 }, 429, "rate limit"],
  ])("maps %s", async (_label, overrides, status, text) => {
    Object.assign(zed, overrides);
    for (const route of [openai, messages]) {
      const result = await route(connection(ACCOUNT_A));
      expect(result.success).toBe(false);
      expect(result.response.status).toBe(status);
      expect((await result.response.json()).error.message.toLowerCase()).toContain(text.toLowerCase());
    }
    expect(completionCalls()).toHaveLength(0);
  });

  it("surfaces 401 from completions as a credential error", async () => {
    zed.completions = () => json({ message: "unauthorized" }, 401);
    const result = await openai(connection(ACCOUNT_A));
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(401);
  });

  it("surfaces 429 from completions as a quota error on both routes", async () => {
    zed.completions = () => json({ code: "rate_limit_exceeded", message: "Too many requests" }, 429, { "retry-after": "30" });
    for (const route of [openai, messages]) {
      const result = await route(connection(ACCOUNT_A));
      expect(result.success).toBe(false);
      expect(result.response.status).toBe(429);
    }
  });

  it("explains a blocked trial and refuses a connection that has no sign-in", async () => {
    const executor = new ZedHostedExecutor();
    expect(executor.parseError(new Response("", { status: 403 }), JSON.stringify({ code: "trial_blocked", message: "Billing required" })).message)
      .toContain("trial access is blocked");
    const missing = await direct({ id: "zed-none", provider: "zed-hosted", providerSpecificData: { enableSessionDispatch: true } });
    expect(missing.response.status).toBe(401);
    expect(routedFetch).not.toHaveBeenCalled();
  });
});

describe("connection isolation", () => {
  it("never shares an LLM token, catalog or session between two connections, even with colliding ids", async () => {
    const [a, b] = [await openai(connection(ACCOUNT_A)), await openai(connection(ACCOUNT_B))];
    expect(a.success && b.success).toBe(true);
    const exchanges = calls.filter((entryCall) => entryCall.url === `${CLOUD}/client/llm_tokens`);
    expect(exchanges).toHaveLength(2);
    expect(headerOf(exchanges[0], "authorization")).toBe(`user-a ${ACCOUNT_A.token}`);
    expect(headerOf(exchanges[1], "authorization")).toBe(`user-a ${ACCOUNT_B.token}`);
    const [first, second] = completionCalls();
    expect(first.account).toBe(ACCOUNT_A);
    expect(second.account).toBe(ACCOUNT_B);
    expect(first.llmToken).not.toBe(second.llmToken);
    // Each connection's own LLM token also served its own /models lookup.
    for (const modelsCall of calls.filter((entryCall) => entryCall.url === `${CLOUD}/models`)) {
      expect(modelsCall.account).toBe(modelsCall.llmToken === first.llmToken ? ACCOUNT_A : ACCOUNT_B);
    }
    // A repeat for A reuses A's token and never B's.
    await openai(connection(ACCOUNT_A));
    expect(completionCalls()[2].llmToken).toBe(first.llmToken);
  });

  it("enabling one connection does not open a sibling", async () => {
    const closed = connection(ACCOUNT_B, { enableSessionDispatch: false });
    expect((await openai(connection(ACCOUNT_A))).success).toBe(true);
    const refused = await openai(closed);
    expect(refused.response.status).toBe(403);
    expect(completionCalls().every((entryCall) => entryCall.account === ACCOUNT_A)).toBe(true);
  });
});
