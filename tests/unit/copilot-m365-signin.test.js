/**
 * Microsoft 365 Copilot native sign-in, refresh and conversation continuation (#2034).
 *
 * Everything here is closed: a temporary DATA_DIR, synthetic accounts and tokens, a fake `fetch` for the
 * Microsoft identity endpoint and the upload endpoint, and a fake Chathub WebSocket. No provider is
 * contacted, and no real token or cookie appears in this file. The flow follows the product: prepare a
 * sign-in through the OAuth route, exchange the pasted callback URL, refresh the stored tokens per
 * connection, then dispatch JSON and streamed chat through the OpenAI and Anthropic gateway routes.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let api;

const MODEL = "m365copilot/copilot-m365";
const NATIVE = "https://login.microsoftonline.com/common/oauth2/nativeclient";
const ACCOUNT_A = { oid: "11111111-1111-4111-8111-111111111111", tid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "ada@contoso.example", name: "Ada" };
const ACCOUNT_B = { oid: "22222222-2222-4222-8222-222222222222", tid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: "ada@contoso.example", name: "Ada B" };
const CONSUMER = { oid: "33333333-3333-4333-8333-333333333333", tid: "9188040d-6c67-4c5b-b112-36a304b66dad", email: "kid@outlook.example", name: "Kid" };
const pathOf = (account) => `${account.oid}@${account.tid}`;

/** Unsigned JWT-shaped token carrying the claims the code under test reads. */
function accessJwt(account, { exp = Math.floor(Date.now() / 1000) + 3600, tag = "t" } = {}) {
  const claims = { oid: account.oid, tid: account.tid, preferred_username: account.email, name: account.name, exp, jti: tag };
  return `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.synthetic`;
}

/** Fake Microsoft identity endpoint: records every token request and answers per `tokenHandler`. */
const tokenCalls = [];
let tokenHandler;
const otherCalls = [];
const fakeFetch = vi.fn(async (url, init = {}) => {
  const target = String(url);
  if (target.startsWith("https://login.microsoftonline.com/")) {
    const form = new URLSearchParams(String(init.body));
    tokenCalls.push({ url: target, redirect: init.redirect, form: Object.fromEntries(form) });
    return tokenHandler(target, Object.fromEntries(form));
  }
  otherCalls.push(target);
  throw new Error(`unexpected fetch ${target}`);
});
const tokenResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const grant = (account, extra = {}) => tokenResponse({
  token_type: "Bearer",
  expires_in: 4500,
  access_token: accessJwt(account, { tag: extra.tag ?? "grant" }),
  refresh_token: extra.refresh_token ?? "rt-issued",
  ...extra.body,
});

/** Fake upload endpoint (`/m365Copilot/UploadFile`). */
const uploads = [];
let uploadHandler;
const fakeUpload = vi.fn(async (url, init = {}) => {
  uploads.push({ url: String(url), redirect: init.redirect, headers: init.headers, form: new URLSearchParams(String(init.body)) });
  return uploadHandler(String(url), init);
});

/** Fake Chathub socket. Each chat invocation consumes the next queued reply. */
const sockets = [];
const replies = [];
const reply = (...snapshots) => replies.push(snapshots);
class FakeSocket {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.handlers = {};
    this.invocations = [];
    sockets.push(this);
    queueMicrotask(() => this.emit("open"));
  }
  on(name, fn) { this.handlers[name] = fn; }
  emit(name, value) { this.handlers[name]?.(value); }
  close() {}
  send(data) {
    let frame;
    try { frame = JSON.parse(String(data).replace(/\x1e$/, "")); } catch { return; }
    if (frame.protocol) queueMicrotask(() => this.emit("message", Buffer.from("{}\x1e")));
    if (frame.target === "chat") {
      this.invocations.push(frame.arguments[0]);
      const snapshots = replies.shift() ?? ["(no reply queued)"];
      queueMicrotask(() => {
        const updates = snapshots.map((text) => JSON.stringify({ type: 1, target: "update", arguments: [{ messages: [{ author: "bot", text }] }] }));
        this.emit("message", Buffer.from(`${updates.join("\x1e")}\x1e{"type":3}\x1e`));
      });
    }
  }
  get query() { return new URL(this.url).searchParams; }
  get turn() { return this.invocations[0]; }
}

const json = (url, method, body) => new Request(`https://durindoor.local${url}`, {
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const openai = (messages, extra = {}) => api.handleChat(json("/v1/chat/completions", "POST", { model: MODEL, messages, ...extra }));
const anthropic = (messages, extra = {}) => api.handleChat(json("/v1/messages", "POST", { model: MODEL, max_tokens: 256, messages, ...extra }));
const oauthPost = async (provider, action, body) => {
  const res = await api.oauth.POST(json(`/api/oauth/${provider}/${action}`, "POST", body), { params: Promise.resolve({ provider, action }) });
  return { status: res.status, body: await res.json() };
};

/** Prepare a sign-in and return what the dashboard would hold: the URL, state and flow id. */
async function prepareSignIn(extra = {}) {
  const prepared = await oauthPost("copilot-m365-web", "authorize", extra);
  expect(prepared.status).toBe(200);
  return prepared.body;
}
const callbackUrl = (state, code = "synthetic-code") => `${NATIVE}?code=${code}&state=${state}&session_state=synthetic`;
async function signIn(account, { tag = "grant", refresh_token = "rt-issued", extra = {} } = {}) {
  tokenHandler = () => grant(account, { tag, refresh_token });
  const prepared = await prepareSignIn(extra);
  const exchanged = await oauthPost("copilot-m365-web", "exchange", { code: callbackUrl(prepared.state), state: prepared.state, flowId: prepared.flowId });
  return { prepared, exchanged };
}

async function seedOAuthConnection(account, { accessToken, refreshToken = "rt-seed", expiresAt, name } = {}) {
  return api.createProviderConnection({
    provider: "copilot-m365-web",
    authType: "oauth",
    name: name || account.name,
    email: account.email,
    accessToken: accessToken ?? accessJwt(account, { tag: "seed" }),
    refreshToken,
    expiresAt: expiresAt ?? new Date(Date.now() + 3600_000).toISOString(),
    providerSpecificData: { authMethod: "oauth", oid: account.oid, tid: account.tid, chathubPath: pathOf(account) },
    testStatus: "active",
  });
}
async function clearConnections() {
  for (const connection of await api.getProviderConnections()) await api.deleteProviderConnection(connection.id);
}

const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]).toString("base64")}`;
const WEATHER = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Weather for a city",
    parameters: { type: "object", required: ["city"], properties: { city: { type: "string" } }, additionalProperties: false },
  },
};
const fence = (name, args) => `\`\`\`${name}\n${JSON.stringify(args)}\n\`\`\``;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-m365-signin-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  vi.doMock("next/server", () => ({
    NextResponse: {
      json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200, headers: { "Content-Type": "application/json" } }),
    },
  }));
  const models = await import("@/models/index.js");
  const dbIndex = await import("@/lib/db/index.js");
  await dbIndex.initDb();
  const m365 = await import("../../open-sse/executors/copilot-m365-web.js");
  const images = await import("../../open-sse/executors/copilot-m365-images.js");
  const conversations = await import("../../open-sse/executors/copilot-m365-conversations.js");
  const proxyFetch = await import("../../open-sse/utils/proxyFetch.js");
  const flows = await import("@/lib/oauth/flowStore.js");
  api = {
    ...models,
    oauth: await import("../../src/app/api/oauth/[provider]/[action]/route.js"),
    POST: (await import("@/app/api/providers/route.js")).POST,
    handleChat: (await import("../../src/sse/handlers/chat.js")).handleChat,
    testSingleConnection: (await import("../../src/app/api/providers/[id]/test/testUtils.js")).testSingleConnection,
    refreshM365Token: (await import("../../open-sse/services/tokenRefresh/copilotM365.js")).refreshM365Token,
    resetM365RefreshCircuit: (await import("../../open-sse/services/tokenRefresh/copilotM365.js")).resetM365RefreshCircuit,
    resetM365RefreshCircuits: (await import("../../open-sse/services/tokenRefresh/copilotM365.js")).__resetM365RefreshCircuitsForTesting,
    getAccessToken: (await import("../../open-sse/services/tokenRefresh.js")).getAccessToken,
    Executor: m365.CopilotM365WebExecutor,
    images,
    store: conversations,
    flows,
    restores: [
      proxyFetch.__setOriginalFetchForTesting(fakeFetch),
      m365.__setCopilotM365WebSocketForTesting(FakeSocket),
      images.__setM365UploadFetchForTesting(fakeUpload),
    ],
  };
}, 90_000);

afterAll(async () => {
  api?.restores?.forEach((restore) => restore());
  vi.doUnmock("next/server");
  await disposeLoadedRequestDetailsRepo();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

beforeEach(async () => {
  await clearConnections();
  api.flows.clearOAuthFlowsForTests();
  api.store.__resetM365ConversationsForTesting();
  sockets.length = 0;
  replies.length = 0;
  tokenCalls.length = 0;
  api.resetM365RefreshCircuits();
  otherCalls.length = 0;
  uploads.length = 0;
  fakeFetch.mockClear();
  fakeUpload.mockClear();
  tokenHandler = () => tokenResponse({ error: "unexpected" }, 500);
  uploadHandler = () => tokenResponse({ docId: "doc-1" });
});

describe("M365 PKCE sign-in service", () => {
  it("prepares a PKCE authorization URL on the fixed native redirect", async () => {
    const prepared = await prepareSignIn();
    const url = new URL(prepared.authUrl);
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      redirect_uri: NATIVE,
      code_challenge_method: "S256",
      state: prepared.state,
    });
    expect(url.searchParams.get("client_id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("scope")).toContain("https://substrate.office.com/sydney/M365Chat.Read");
    // The verifier stays on the server: the browser only receives the challenge.
    expect(JSON.stringify(prepared)).not.toMatch(/codeVerifier|code_verifier/);
  });

  it("exchanges the pasted callback with the issued verifier and saves a refreshable account", async () => {
    const { prepared, exchanged } = await signIn(ACCOUNT_A);
    expect(exchanged.status).toBe(200);
    expect(exchanged.body.connection).toMatchObject({ provider: "copilot-m365-web", email: ACCOUNT_A.email });
    expect(tokenCalls).toHaveLength(1);
    const [call] = tokenCalls;
    expect(call.url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    expect(call.redirect).toBe("manual");
    expect(call.form).toMatchObject({ grant_type: "authorization_code", code: "synthetic-code", redirect_uri: NATIVE });
    // PKCE: the verifier sent to Microsoft hashes to the challenge in the authorization URL.
    const challenge = new URL(prepared.authUrl).searchParams.get("code_challenge");
    expect(createHash("sha256").update(call.form.code_verifier).digest("base64url")).toBe(challenge);

    const saved = await api.getProviderConnectionById(exchanged.body.connection.id);
    expect(saved).toMatchObject({ authType: "oauth", refreshToken: "rt-issued", email: ACCOUNT_A.email });
    expect(saved.accessToken).toContain("eyJ");
    expect(Date.parse(saved.expiresAt)).toBeGreaterThan(Date.now() + 4000_000);
    expect(saved.providerSpecificData).toMatchObject({ oid: ACCOUNT_A.oid, tid: ACCOUNT_A.tid, chathubPath: pathOf(ACCOUNT_A) });
    expect(JSON.stringify(exchanged.body)).not.toContain(saved.accessToken);
  });

  it("makes an attempt single-use and checks the callback against the issued state", async () => {
    tokenHandler = () => grant(ACCOUNT_A);
    const prepared = await prepareSignIn();
    const wrongState = await oauthPost("copilot-m365-web", "exchange", { code: callbackUrl("someone-elses-state"), state: prepared.state, flowId: prepared.flowId });
    expect(wrongState.status).toBeGreaterThanOrEqual(400);
    expect(tokenCalls).toHaveLength(0);

    const denied = await prepareSignIn();
    const refused = await oauthPost("copilot-m365-web", "exchange", { code: `${NATIVE}?error=access_denied&state=${denied.state}`, state: denied.state, flowId: denied.flowId });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    const bareCode = await prepareSignIn();
    expect((await oauthPost("copilot-m365-web", "exchange", { code: "bare-code", state: bareCode.state, flowId: bareCode.flowId })).status).toBeGreaterThanOrEqual(400);
    const lookalike = await prepareSignIn();
    const alias = `https://login.microsoftonline.com.evil.example/common/oauth2/nativeclient?code=c&state=${lookalike.state}`;
    expect((await oauthPost("copilot-m365-web", "exchange", { code: alias, state: lookalike.state, flowId: lookalike.flowId })).status).toBeGreaterThanOrEqual(400);
    expect(tokenCalls).toHaveLength(0);

    const ok = await prepareSignIn();
    const first = await oauthPost("copilot-m365-web", "exchange", { code: callbackUrl(ok.state), state: ok.state, flowId: ok.flowId });
    expect(first.status).toBe(200);
    const replay = await oauthPost("copilot-m365-web", "exchange", { code: callbackUrl(ok.state), state: ok.state, flowId: ok.flowId });
    expect(replay.status).toBeGreaterThanOrEqual(400);
    expect(tokenCalls).toHaveLength(1);
  });

  it("refuses a consumer account and never follows a credentialed redirect off the Microsoft origin", async () => {
    const consumer = await signIn(CONSUMER);
    expect(consumer.exchanged.status).toBeGreaterThanOrEqual(400);
    expect(await api.getProviderConnections()).toHaveLength(0);

    tokenHandler = () => new Response(null, { status: 302, headers: { location: "https://attacker.example/steal" } });
    const prepared = await prepareSignIn();
    const redirected = await oauthPost("copilot-m365-web", "exchange", { code: callbackUrl(prepared.state), state: prepared.state, flowId: prepared.flowId });
    expect(redirected.status).toBeGreaterThanOrEqual(400);
    expect(tokenCalls.every((call) => call.url.startsWith("https://login.microsoftonline.com/"))).toBe(true);
    expect(otherCalls).toEqual([]);
    expect(await api.getProviderConnections()).toHaveLength(0);
  });

  it("keeps one row per tenant/object identity, even when two tenants share an email", async () => {
    await signIn(ACCOUNT_A, { tag: "one", refresh_token: "rt-1" });
    await signIn(ACCOUNT_A, { tag: "two", refresh_token: "rt-2" });
    await signIn(ACCOUNT_B, { tag: "three", refresh_token: "rt-3" });
    const rows = (await api.getProviderConnections()).filter((c) => c.provider === "copilot-m365-web");
    expect(rows).toHaveLength(2);
    expect(rows.find((c) => c.providerSpecificData.chathubPath === pathOf(ACCOUNT_A)).refreshToken).toBe("rt-2");
    expect(rows.find((c) => c.providerSpecificData.chathubPath === pathOf(ACCOUNT_B)).refreshToken).toBe("rt-3");
  });

  it("reconnects an existing row only with the same account", async () => {
    const a = await seedOAuthConnection(ACCOUNT_A, { refreshToken: "rt-old" });
    const other = await signIn(ACCOUNT_B, { extra: { connectionId: a.id } });
    expect(other.exchanged.status).toBeGreaterThanOrEqual(400);
    expect((await api.getProviderConnectionById(a.id)).refreshToken).toBe("rt-old");

    const same = await signIn(ACCOUNT_A, { tag: "again", refresh_token: "rt-new", extra: { connectionId: a.id } });
    expect(same.exchanged.status).toBe(200);
    expect((await api.getProviderConnectionById(a.id)).refreshToken).toBe("rt-new");
    expect((await api.getProviderConnections()).filter((c) => c.provider === "copilot-m365-web")).toHaveLength(1);
  });

  it("keeps manual session entry working beside a signed-in account", async () => {
    await signIn(ACCOUNT_A);
    const pasted = await api.POST(json("/api/providers", "POST", {
      provider: "copilot-m365-web",
      apiKey: "access_token=manual-token; chathubPath=manual-oid@manual-tenant",
      name: "pasted",
    }));
    expect(pasted.status).toBe(201);
    const rows = await api.getProviderConnections();
    expect(rows.map((c) => c.authType).sort()).toEqual(["cookie", "oauth"]);
    reply("manual ok");
    // The pasted session has the lower priority number only when added first; force it to serve.
    const cookie = rows.find((c) => c.authType === "cookie");
    const oauth = rows.find((c) => c.authType === "oauth");
    await api.updateProviderConnection(cookie.id, { priority: 1 });
    await api.updateProviderConnection(oauth.id, { priority: 2 });
    const res = await openai([{ role: "user", content: "hi" }], { stream: false });
    expect(res.status).toBe(200);
    expect(sockets[0].query.get("access_token")).toBe("manual-token");
    expect(decodeURIComponent(new URL(sockets[0].url).pathname)).toBe("/m365Copilot/Chathub/manual-oid@manual-tenant");
  });
});

describe("M365 refresh-token renewal", () => {
  it("renews an expiring token before dispatch, rotates the refresh token and persists both", async () => {
    const stale = accessJwt(ACCOUNT_A, { exp: Math.floor(Date.now() / 1000) - 60, tag: "stale" });
    const row = await seedOAuthConnection(ACCOUNT_A, { accessToken: stale, refreshToken: "rt-1", expiresAt: new Date(Date.now() - 60_000).toISOString() });
    tokenHandler = () => grant(ACCOUNT_A, { tag: "fresh", refresh_token: "rt-2" });
    reply("renewed");
    const res = await openai([{ role: "user", content: "hi" }], { stream: false });
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toBe("renewed");

    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0].url).toBe(`https://login.microsoftonline.com/${ACCOUNT_A.tid}/oauth2/v2.0/token`);
    expect(tokenCalls[0].redirect).toBe("manual");
    expect(tokenCalls[0].form).toMatchObject({ grant_type: "refresh_token", refresh_token: "rt-1" });
    expect(tokenCalls[0].form.scope).toContain("offline_access");
    // The socket carried the renewed token, not the stale one.
    expect(sockets).toHaveLength(1);
    expect(sockets[0].query.get("access_token")).not.toBe(stale);
    expect(sockets[0].query.get("access_token")).toContain("eyJ");

    const saved = await api.getProviderConnectionById(row.id);
    expect(saved.refreshToken).toBe("rt-2");
    expect(saved.accessToken).toBe(sockets[0].query.get("access_token"));
    expect(Date.parse(saved.expiresAt)).toBeGreaterThan(Date.now() + 4000_000);
  });

  it("does not refresh a token that is still fresh", async () => {
    await seedOAuthConnection(ACCOUNT_A);
    reply("no refresh");
    expect((await openai([{ role: "user", content: "hi" }], { stream: false })).status).toBe(200);
    expect(tokenCalls).toHaveLength(0);
  });

  it("keeps the old refresh token when Microsoft does not rotate it", async () => {
    const result = await (async () => {
      tokenHandler = () => tokenResponse({ token_type: "Bearer", expires_in: 3000, access_token: accessJwt(ACCOUNT_A, { tag: "same-rt" }) });
      return api.refreshM365Token({ refreshToken: "rt-keep", providerSpecificData: { chathubPath: pathOf(ACCOUNT_A) } });
    })();
    expect(result).toMatchObject({ refreshToken: "rt-keep", expiresIn: 3000 });
    expect(result.accessToken).toContain("eyJ");
  });

  it("refreshes each connection with its own token and tenant, never mixing them", async () => {
    tokenHandler = (url, form) => {
      const account = url.includes(ACCOUNT_A.tid) ? ACCOUNT_A : ACCOUNT_B;
      return grant(account, { tag: `fresh-${form.refresh_token}`, refresh_token: `${form.refresh_token}-rotated` });
    };
    const [a, b] = await Promise.all([
      api.refreshM365Token({ refreshToken: "rt-a", providerSpecificData: { chathubPath: pathOf(ACCOUNT_A) } }),
      api.refreshM365Token({ refreshToken: "rt-b", providerSpecificData: { chathubPath: pathOf(ACCOUNT_B) } }),
    ]);
    expect(a.refreshToken).toBe("rt-a-rotated");
    expect(b.refreshToken).toBe("rt-b-rotated");
    expect(tokenCalls.map((call) => [call.url, call.form.refresh_token]).sort()).toEqual([
      [`https://login.microsoftonline.com/${ACCOUNT_A.tid}/oauth2/v2.0/token`, "rt-a"],
      [`https://login.microsoftonline.com/${ACCOUNT_B.tid}/oauth2/v2.0/token`, "rt-b"],
    ].sort());
  });

  it("renews two stored connections independently through the gateway", async () => {
    const past = { exp: Math.floor(Date.now() / 1000) - 60 };
    const a = await seedOAuthConnection(ACCOUNT_A, { accessToken: accessJwt(ACCOUNT_A, { ...past, tag: "sa" }), refreshToken: "rt-a", expiresAt: new Date(Date.now() - 1000).toISOString(), name: "A" });
    const b = await seedOAuthConnection(ACCOUNT_B, { accessToken: accessJwt(ACCOUNT_B, { ...past, tag: "sb" }), refreshToken: "rt-b", expiresAt: new Date(Date.now() - 1000).toISOString(), name: "B" });
    tokenHandler = (url, form) => grant(url.includes(ACCOUNT_A.tid) ? ACCOUNT_A : ACCOUNT_B, { tag: `n-${form.refresh_token}`, refresh_token: `${form.refresh_token}2` });
    await api.updateProviderConnection(a.id, { priority: 1 });
    await api.updateProviderConnection(b.id, { priority: 2 });
    reply("from a");
    expect((await openai([{ role: "user", content: "hi" }], { stream: false })).status).toBe(200);
    // Only the connection that served the request was renewed; the other keeps its own tokens.
    expect((await api.getProviderConnectionById(a.id)).refreshToken).toBe("rt-a2");
    expect((await api.getProviderConnectionById(b.id)).refreshToken).toBe("rt-b");
    expect(sockets[0].query.get("access_token")).toBe((await api.getProviderConnectionById(a.id)).accessToken);
    expect(decodeURIComponent(new URL(sockets[0].url).pathname)).toContain(pathOf(ACCOUNT_A));
  });

  it("tests a native connection by its expiry and renews an expired one with its refresh token", async () => {
    const fresh = await seedOAuthConnection(ACCOUNT_A, { name: "fresh" });
    expect(await api.testSingleConnection(fresh.id)).toMatchObject({ valid: true });
    expect(tokenCalls).toHaveLength(0);

    const stale = await seedOAuthConnection(ACCOUNT_B, { refreshToken: "rt-test", expiresAt: new Date(Date.now() - 60_000).toISOString(), name: "stale" });
    tokenHandler = () => grant(ACCOUNT_B, { tag: "tested", refresh_token: "rt-test-2" });
    expect(await api.testSingleConnection(stale.id)).toMatchObject({ valid: true });
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0].url).toContain(ACCOUNT_B.tid);
    expect((await api.getProviderConnectionById(stale.id)).refreshToken).toBe("rt-test-2");
  });

  it("treats a dead grant as re-authentication, and a transient failure as retryable", async () => {
    tokenHandler = () => tokenResponse({ error: "invalid_grant", error_description: "secret detail" }, 400);
    expect(await api.refreshM365Token({ refreshToken: "rt-dead", providerSpecificData: { chathubPath: pathOf(ACCOUNT_A) } })).toMatchObject({ error: "unrecoverable_refresh_error", code: "invalid_grant" });
    tokenHandler = () => tokenResponse({ error: "temporarily_unavailable" }, 503);
    expect(await api.refreshM365Token({ refreshToken: "rt-flaky", providerSpecificData: { chathubPath: pathOf(ACCOUNT_A) } })).toBeNull();
    tokenHandler = () => new Response(null, { status: 307, headers: { location: "https://attacker.example/token" } });
    expect(await api.refreshM365Token({ refreshToken: "rt-redirect", providerSpecificData: { chathubPath: pathOf(ACCOUNT_A) } })).toBeNull();
    expect(otherCalls).toEqual([]);
    // A tenant that is not a GUID is refused rather than spliced into the token URL.
    expect(await api.refreshM365Token({ refreshToken: "rt-bad", providerSpecificData: { chathubPath: "oid@evil.example/../x" } })).toMatchObject({ error: "unrecoverable_refresh_error" });
  });

  it("opens the unauthorized_client refresh circuit after three failures and resets it on sign-in", async () => {
    const connection = await seedOAuthConnection(ACCOUNT_A, { refreshToken: "rt-client" });
    const credentials = { connectionId: connection.id, refreshToken: "rt-client", providerSpecificData: { chathubPath: pathOf(ACCOUNT_A) } };
    tokenHandler = () => tokenResponse({ error: "unauthorized_client" }, 400);
    expect(await api.refreshM365Token(credentials)).toBeNull();
    expect(await api.refreshM365Token(credentials)).toBeNull();
    expect(await api.refreshM365Token(credentials)).toMatchObject({ error: "unrecoverable_refresh_error", code: "unauthorized_client" });
    expect(tokenCalls).toHaveLength(3);
    expect(await api.refreshM365Token(credentials)).toMatchObject({ error: "unrecoverable_refresh_error", code: "unauthorized_client" });
    expect(tokenCalls).toHaveLength(3);

    tokenHandler = () => grant(ACCOUNT_A, { tag: "after-signin", refresh_token: "rt-after-signin" });
    await signIn(ACCOUNT_A, { tag: "after-signin", refresh_token: "rt-after-signin", extra: { connectionId: connection.id } });
    tokenHandler = () => tokenResponse({ error: "unauthorized_client" }, 400);
    expect(await api.refreshM365Token({ ...credentials, refreshToken: "rt-after-signin" })).toBeNull();
    expect(tokenCalls).toHaveLength(5);
  });
});

describe("M365 conversation continuation", () => {
  const credentials = (connectionId, account = ACCOUNT_A, tag = "c") => ({
    connectionId,
    accessToken: accessJwt(account, { tag: `${tag}-${connectionId}` }),
    providerSpecificData: { chathubPath: pathOf(account) },
  });
  const run = (connectionId, messages, extra = {}) => new api.Executor().execute({
    model: "copilot-m365",
    stream: false,
    body: { messages, ...extra.body },
    credentials: extra.credentials ?? credentials(connectionId),
  });
  const text = async (result) => (await result.response.json()).choices[0].message.content;

  it("continues the same upstream conversation and sends only the new messages", async () => {
    reply("first answer");
    expect(await text(await run("conn-a", [{ role: "user", content: "remember 42" }]))).toBe("first answer");
    reply("second answer");
    const second = await run("conn-a", [
      { role: "user", content: "remember 42" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "what number?" },
    ]);
    expect(await text(second)).toBe("second answer");

    const [one, two] = sockets;
    expect(two.query.get("ConversationId")).toBe(one.query.get("ConversationId"));
    expect(two.query.get("X-SessionId")).toBe(one.query.get("X-SessionId"));
    expect(one.turn).toMatchObject({ isStartOfSession: true, conversationId: one.query.get("ConversationId") });
    expect(two.turn).toMatchObject({ isStartOfSession: false, conversationId: two.query.get("ConversationId") });
    expect(one.turn.message.text).toContain("remember 42");
    expect(two.turn.message.text).toContain("what number?");
    expect(two.turn.message.text).not.toContain("remember 42");
    expect(two.turn.message.text).not.toContain("first answer");
  });

  it("starts a fresh conversation for an edited history, a different reply or a stateless caller", async () => {
    reply("answer");
    await run("conn-a", [{ role: "user", content: "hello" }]);
    const base = sockets[0].query.get("ConversationId");

    reply("x");
    await run("conn-a", [{ role: "user", content: "HELLO (edited)" }, { role: "assistant", content: "answer" }, { role: "user", content: "next" }]);
    reply("x");
    await run("conn-a", [{ role: "user", content: "hello" }, { role: "assistant", content: "a different reply" }, { role: "user", content: "next" }]);
    reply("x");
    await run(undefined, [{ role: "user", content: "hello" }, { role: "assistant", content: "answer" }, { role: "user", content: "next" }], { credentials: { ...credentials("x"), connectionId: undefined } });
    for (const socket of sockets.slice(1)) {
      expect(socket.query.get("ConversationId")).not.toBe(base);
      expect(socket.turn.isStartOfSession).toBe(true);
      expect(socket.turn.message.text).toMatch(/hello/i);
    }
    expect(new Set(sockets.map((socket) => socket.query.get("ConversationId"))).size).toBe(4);
  });

  it("never resumes a failed turn, a conversation idle past the window, or a claimed conversation twice", async () => {
    const clock = { now: 1_000_000 };
    api.store.__resetM365ConversationsForTesting(new api.store.M365ConversationStore({ now: () => clock.now, idleMs: 60_000 }));
    reply("answer");
    await run("conn-a", [{ role: "user", content: "hello" }]);
    const followUp = [{ role: "user", content: "hello" }, { role: "assistant", content: "answer" }, { role: "user", content: "next" }];
    clock.now += 61_000;
    reply("late");
    await run("conn-a", followUp);
    expect(sockets[1].turn.isStartOfSession).toBe(true);

    // A turn that fails is not committed: the next request starts fresh.
    reply("ok");
    await run("conn-b", [{ role: "user", content: "hello" }]);
    const claimedBefore = sockets.length;
    class DroppingSocket extends FakeSocket {
      send(data) {
        const frame = JSON.parse(String(data).replace(/\x1e$/, ""));
        if (frame.protocol) queueMicrotask(() => this.emit("message", Buffer.from("{}\x1e")));
        if (frame.target === "chat") queueMicrotask(() => this.emit("error", new Error("dropped")));
      }
    }
    const { __setCopilotM365WebSocketForTesting } = await import("../../open-sse/executors/copilot-m365-web.js");
    const restore = __setCopilotM365WebSocketForTesting(DroppingSocket);
    const failed = await run("conn-b", [{ role: "user", content: "hello" }, { role: "assistant", content: "ok" }, { role: "user", content: "more" }]);
    restore();
    expect(failed.response.status).toBe(502);
    reply("retry");
    await run("conn-b", [{ role: "user", content: "hello" }, { role: "assistant", content: "ok" }, { role: "user", content: "more" }]);
    expect(sockets.at(-1).turn.isStartOfSession).toBe(true);
    expect(sockets.length).toBeGreaterThan(claimedBefore);
  });

  it("keeps two connections isolated: neither can continue the other's conversation", async () => {
    reply("from a");
    await run("conn-a", [{ role: "user", content: "same opener" }], { credentials: credentials("conn-a", ACCOUNT_A) });
    reply("from b");
    await run("conn-b", [{ role: "user", content: "same opener" }], { credentials: credentials("conn-b", ACCOUNT_B) });
    const [a, b] = sockets;
    expect(a.query.get("ConversationId")).not.toBe(b.query.get("ConversationId"));
    expect(a.query.get("access_token")).not.toBe(b.query.get("access_token"));
    expect(decodeURIComponent(new URL(a.url).pathname)).toContain(pathOf(ACCOUNT_A));
    expect(decodeURIComponent(new URL(b.url).pathname)).toContain(pathOf(ACCOUNT_B));

    // B follows up on A's reply text: B owns no such conversation, so it opens its own.
    reply("b again");
    await run("conn-b", [{ role: "user", content: "same opener" }, { role: "assistant", content: "from a" }, { role: "user", content: "next" }], { credentials: credentials("conn-b", ACCOUNT_B) });
    expect(sockets[2].turn.isStartOfSession).toBe(true);
    expect(sockets[2].query.get("ConversationId")).not.toBe(a.query.get("ConversationId"));
    // A's own follow-up still continues A's conversation.
    reply("a again");
    await run("conn-a", [{ role: "user", content: "same opener" }, { role: "assistant", content: "from a" }, { role: "user", content: "next" }], { credentials: credentials("conn-a", ACCOUNT_A) });
    expect(sockets[3].query.get("ConversationId")).toBe(a.query.get("ConversationId"));
    expect(sockets[3].turn.isStartOfSession).toBe(false);
  });

  it("continues through the gateway for a streamed follow-up", async () => {
    await seedOAuthConnection(ACCOUNT_A);
    reply("hel", "hello there");
    const first = await openai([{ role: "user", content: "hi" }], { stream: true });
    expect(await first.text()).toContain("data: [DONE]");
    reply("ok", "ok then");
    const second = await openai([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello there" },
      { role: "user", content: "again" },
    ], { stream: true });
    expect(await second.text()).toContain('"content":"ok"');
    expect(sockets[1].query.get("ConversationId")).toBe(sockets[0].query.get("ConversationId"));
    expect(sockets[1].turn.isStartOfSession).toBe(false);
    expect(sockets[1].turn.message.text).not.toContain("hello there");
  });
});

describe("M365 image input", () => {
  const credentials = { connectionId: "conn-img", accessToken: accessJwt(ACCOUNT_A, { tag: "img" }), providerSpecificData: { chathubPath: pathOf(ACCOUNT_A) } };
  const run = (messages) => new api.Executor().execute({ model: "copilot-m365", stream: false, body: { messages }, credentials });

  it("uploads each image into the turn's conversation and attaches it by annotation", async () => {
    uploadHandler = () => tokenResponse({ docId: "doc-42" });
    reply("a pixel");
    const result = await run([{ role: "user", content: [{ type: "text", text: "what is this?" }, { type: "image_url", image_url: { url: PNG } }] }]);
    expect(result.response.status).toBe(200);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].url).toBe("https://substrate.office.com/m365Copilot/UploadFile");
    expect(uploads[0].redirect).toBe("manual");
    expect(uploads[0].headers.Authorization).toBe(`Bearer ${credentials.accessToken}`);
    expect(uploads[0].form.get("scenario")).toBe("UploadImage");
    expect(uploads[0].form.get("conversationId")).toBe(sockets[0].query.get("ConversationId"));
    expect(uploads[0].form.get("FileBase64")).toBe(PNG);

    const message = sockets[0].turn.message;
    expect(message.text).toContain("what is this?");
    expect(message.text).toContain("[image 1]");
    expect(message.text).not.toContain("base64");
    expect(message.messageAnnotations).toEqual([expect.objectContaining({ id: "doc-42", messageAnnotationType: "ImageFile" })]);
    expect(JSON.stringify(sockets[0].invocations)).not.toContain(PNG.slice(30));
  });

  it("fails the request, opening no socket, when the upload or the image is unusable", async () => {
    uploadHandler = () => tokenResponse({}, 500);
    const failed = await run([{ role: "user", content: [{ type: "image_url", image_url: { url: PNG } }] }]);
    expect(failed.response.status).toBe(502);
    expect((await failed.response.json()).error.code).toBe("m365_image_upload_failed");

    uploadHandler = () => new Response(null, { status: 302, headers: { location: "https://attacker.example/collect" } });
    const redirected = await run([{ role: "user", content: [{ type: "image_url", image_url: { url: PNG } }] }]);
    expect(redirected.response.status).toBe(502);
    expect(uploads.every((upload) => upload.url.startsWith("https://substrate.office.com/"))).toBe(true);
    expect(otherCalls).toEqual([]);

    uploadHandler = () => tokenResponse({ docId: "d" });
    const notAnImage = await run([{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from("not an image").toString("base64")}` } }] }]);
    expect(notAnImage.response.status).toBe(400);
    const plainHttp = await run([{ role: "user", content: [{ type: "image_url", image_url: { url: "http://example.test/a.png" } }] }]);
    expect(plainHttp.response.status).toBe(400);
    const audio = await run([{ role: "user", content: [{ type: "input_audio", input_audio: { data: "x", format: "wav" } }] }]);
    expect(audio.response.status).toBe(400);
    expect(sockets).toHaveLength(0);
  });

  it("fetches a public HTTPS image through the remote media guard and refuses one the guard blocks", async () => {
    const fetched = [];
    const restore = api.images.__setM365RemoteImageFetchForTesting(async (url, options) => {
      fetched.push({ url, options });
      if (url.includes("blocked")) throw new Error("Blocked private or local provider URL");
      return { buffer: Buffer.from(PNG.split(",")[1], "base64"), contentType: "image/png" };
    });
    try {
      reply("remote pixel");
      const ok = await run([{ role: "user", content: [{ type: "image_url", image_url: { url: "https://images.example/a.png" } }] }]);
      expect(ok.response.status).toBe(200);
      expect(fetched).toHaveLength(1);
      expect(fetched[0].options).toMatchObject({ maxBytes: 10 * 1024 * 1024 });
      expect(uploads).toHaveLength(1);
      expect(uploads[0].form.get("FileBase64")).toBe(PNG);

      const blocked = await run([{ role: "user", content: [{ type: "image_url", image_url: { url: "https://blocked.example/a.png" } }] }]);
      expect(blocked.response.status).toBe(400);
      expect((await blocked.response.json()).error.code).toBe("m365_image_invalid");
      expect(uploads).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("uploads only the new message's images when it continues a conversation", async () => {
    reply("a pixel");
    await run([{ role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: PNG } }] }]);
    reply("still a pixel");
    await run([
      { role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: PNG } }] },
      { role: "assistant", content: "a pixel" },
      { role: "user", content: "and now?" },
    ]);
    expect(uploads).toHaveLength(1);
    expect(sockets[1].turn.isStartOfSession).toBe(false);
    expect(sockets[1].turn.message.messageAnnotations).toBeUndefined();
  });
});

describe("M365 tool round", () => {
  const credentials = { connectionId: "conn-tool", accessToken: accessJwt(ACCOUNT_A, { tag: "tool" }), providerSpecificData: { chathubPath: pathOf(ACCOUNT_A) } };
  const run = (messages, extra = {}) => new api.Executor().execute({ model: "copilot-m365", stream: false, body: { messages, tools: [WEATHER], ...extra }, credentials });

  it("turns a fenced call into a tool_calls message, then continues with the tool result", async () => {
    reply(`Checking.\n${fence("get_weather", { city: "Oslo" })}`);
    const first = await (await run([{ role: "user", content: "weather in Oslo?" }])).response.json();
    const call = first.choices[0].message.tool_calls[0];
    expect(first.choices[0].finish_reason).toBe("tool_calls");
    expect(call).toMatchObject({ type: "function", function: { name: "get_weather", arguments: JSON.stringify({ city: "Oslo" }) } });
    expect(sockets[0].turn.plugins).toEqual([expect.objectContaining({ Id: "get_weather", Source: "API" })]);
    expect(sockets[0].turn.customInstructions).toContain("get_weather");

    reply("It is 4 degrees in Oslo.");
    const second = await (await run([
      { role: "user", content: "weather in Oslo?" },
      { role: "assistant", content: null, tool_calls: [call] },
      { role: "tool", tool_call_id: call.id, content: "4C, clear" },
    ])).response.json();
    expect(second.choices[0].message.content).toBe("It is 4 degrees in Oslo.");
    expect(sockets[1].query.get("ConversationId")).toBe(sockets[0].query.get("ConversationId"));
    expect(sockets[1].turn.message.text).toContain(`[Tool result id=${call.id}]`);
    expect(sockets[1].turn.message.text).toContain("4C, clear");
    expect(sockets[1].turn.message.text).not.toContain("weather in Oslo?");
  });

  it("streams a tool call as one buffered turn and honours tool_choice", async () => {
    reply(fence("get_weather", { city: "Rome" }));
    const streamed = await new api.Executor().execute({ model: "copilot-m365", stream: true, body: { messages: [{ role: "user", content: "Rome?" }], tools: [WEATHER] }, credentials });
    expect(streamed.response.status).toBe(200);
    expect(streamed.response.headers.get("content-type")).toContain("text/event-stream");
    const body = await streamed.response.text();
    expect(body).toContain('"tool_calls"');
    expect(body).toContain('"finish_reason":"tool_calls"');
    expect(body.trim().endsWith("data: [DONE]")).toBe(true);

    reply("plain answer, no call");
    const none = await (await run([{ role: "user", content: "hi" }], { tool_choice: "none" })).response.json();
    expect(none.choices[0].message.content).toBe("plain answer, no call");
    expect(sockets.at(-1).turn.plugins).toEqual([]);
  });

  it("rejects calls that are undeclared or violate the argument schema", async () => {
    reply(fence("get_weather", { town: "Oslo" }));
    const invalid = await run([{ role: "user", content: "weather?" }]);
    expect(invalid.response.status).toBe(502);
    expect((await invalid.response.json()).error.code).toBe("m365_tool_constraint");

    reply(`${fence("rm_rf", { path: "/" })} done`);
    const undeclared = await (await run([{ role: "user", content: "weather?" }])).response.json();
    expect(undeclared.choices[0].message.tool_calls).toBeUndefined();

    reply("no call although required");
    const required = await run([{ role: "user", content: "weather?" }], { tool_choice: "required" });
    expect(required.response.status).toBe(502);
  });
});

describe("M365 chat through the OpenAI and Anthropic routes", () => {
  beforeEach(async () => {
    await seedOAuthConnection(ACCOUNT_A);
  });

  it("answers OpenAI chat completions as JSON and as a stream", async () => {
    reply("pong ", "pong pong");
    const json = await openai([{ role: "user", content: "ping" }], { stream: false });
    expect(json.status).toBe(200);
    const body = await json.json();
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.content).toBe("pong pong");
    expect(sockets[0].query.get("access_token")).toContain("eyJ");

    reply("st", "stream");
    const streamed = await openai([{ role: "user", content: "ping" }], { stream: true });
    expect(streamed.headers.get("content-type")).toContain("text/event-stream");
    const text = await streamed.text();
    expect(text).toContain('"content":"st"');
    expect(text).toContain('"content":"ream"');
    expect(text).toContain('"finish_reason":"stop"');
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
  });

  it("answers Anthropic messages as JSON and as a stream", async () => {
    reply("pong");
    const json = await anthropic([{ role: "user", content: "ping" }], { stream: false });
    expect(json.status).toBe(200);
    const body = await json.json();
    expect(body).toMatchObject({ type: "message", role: "assistant" });
    expect(body.content[0]).toMatchObject({ type: "text", text: "pong" });

    reply("st", "stream");
    const streamed = await anthropic([{ role: "user", content: "ping" }], { stream: true });
    expect(streamed.status).toBe(200);
    const text = await streamed.text();
    expect(text).toContain("event: content_block_delta");
    expect(text).toContain('"text":"st"');
    expect(text).toContain('"text":"ream"');
    expect(text).toContain("event: message_stop");
  });

  it("serves a tool call and its follow-up on both routes, continuing one conversation", async () => {
    reply(fence("get_weather", { city: "Oslo" }));
    const first = await openai([{ role: "user", content: "weather in Oslo?" }], { stream: false, tools: [WEATHER] });
    const call = (await first.json()).choices[0].message.tool_calls[0];
    reply("Cold.");
    const second = await openai([
      { role: "user", content: "weather in Oslo?" },
      { role: "assistant", content: null, tool_calls: [call] },
      { role: "tool", tool_call_id: call.id, content: "4C" },
    ], { stream: false, tools: [WEATHER] });
    expect((await second.json()).choices[0].message.content).toBe("Cold.");
    expect(sockets[1].query.get("ConversationId")).toBe(sockets[0].query.get("ConversationId"));

    reply(fence("get_weather", { city: "Rome" }));
    const viaAnthropic = await anthropic([{ role: "user", content: "weather in Rome?" }], {
      stream: false,
      tools: [{ name: "get_weather", description: "Weather for a city", input_schema: WEATHER.function.parameters }],
    });
    const message = await viaAnthropic.json();
    expect(message.stop_reason).toBe("tool_use");
    expect(message.content.find((block) => block.type === "tool_use")).toMatchObject({ name: "get_weather", input: { city: "Rome" } });
  });
});
