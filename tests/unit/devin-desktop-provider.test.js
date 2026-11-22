/**
 * #1175 / #2034: staged Devin Desktop provider, offline.
 *
 * Real: sqlite DB, provider routes, handleChat, account fallback, the Anthropic Messages route, the
 * staged executor and sign-in module. Synthetic: every token, JWT and outbound byte. Global fetch is a
 * closed mock of the pinned Connect contract (GetUserJwt, GetChatMessage, GetCliModelConfigs) and of
 * the api.devin.ai sign-in exchange. No live provider traffic.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-devin-desktop-machine-id" }));
vi.mock("@/lib/usageDb.js", async (importOriginal) => ({ ...(await importOriginal()), appendRequestLog: vi.fn(() => Promise.resolve()), trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), finishPendingRequest: vi.fn(), saveRequestDetail: vi.fn(() => Promise.resolve()), saveRequestUsage: vi.fn(() => Promise.resolve()) }));

const AUTH_URL = "https://server.codeium.com/exa.auth_pb.AuthService/GetUserJwt";
const CHAT_URL = "https://server.codeium.com/exa.api_server_pb.ApiServerService/GetChatMessage";
const MODELS_URL = "https://server.codeium.com/exa.api_server_pb.ApiServerService/GetCliModelConfigs";
const TOKEN_URL = "https://api.devin.ai/auth/cli/token";
const TOKEN_A = "devin-session-token$synthetic-account-a-0001";
const TOKEN_B = "devin-session-token$synthetic-account-b-0002";
const TOKEN_REVOKED = "devin-session-token$synthetic-revoked-0003";
const MODEL = "devin-desktop/swe-1-7";

let root, db, routes, handleChat, mod, oauth, provider, profile;
const wire = { calls: [], authStatus: null, chatStatus: null, trailerError: null, models: null };

// ---- synthetic wire (independent of the module under test) ----
const varint = (value) => { const out = []; let v = value; while (v >= 0x80) { out.push((v % 0x80) | 0x80); v = Math.floor(v / 0x80); } out.push(v); return Uint8Array.from(out); };
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
const lenField = (n, bytes) => cat(varint((n << 3) | 2), varint(bytes.length), bytes);
const strField = (n, value) => lenField(n, new TextEncoder().encode(value));
const intField = (n, value) => cat(varint(n << 3), varint(value));
const frame = (payload, flags = 0) => { const out = new Uint8Array(5 + payload.length); out[0] = flags; new DataView(out.buffer).setUint32(1, payload.length, false); out.set(payload, 5); return out; };
const chatPart = ({ text, stop, usage }) => cat(text ? strField(3, text) : new Uint8Array(0), stop ? intField(5, stop) : new Uint8Array(0), usage ? lenField(7, cat(intField(2, usage[0]), intField(3, usage[1]))) : new Uint8Array(0));
const endStream = (error) => frame(new TextEncoder().encode(JSON.stringify(error ? { error } : {})), 2);
const readFields = (bytes) => {
  const out = []; let at = 0;
  const rv = () => { let v = 0, m = 1; for (;;) { const b = bytes[at++]; v += (b & 0x7f) * m; if (!(b & 0x80)) return v; m *= 0x80; } };
  while (at < bytes.length) {
    const tag = rv(), n = tag >> 3, wire = tag & 7;
    if (wire === 0) out.push({ n, v: rv() });
    else { const len = rv(); out.push({ n, v: bytes.slice(at, at + len) }); at += len; }
  }
  return out;
};
const dec = (bytes) => new TextDecoder().decode(bytes);
const field = (fields, n) => fields.filter((f) => f.n === n);
const metadataOf = (payload) => { const m = readFields(field(readFields(payload), 1)[0].v); const get = (n) => (field(m, n)[0] ? dec(field(m, n)[0].v) : ""); return { ide: get(1), apiKey: get(3), version: get(7), session: get(10), jwt: get(21) }; };

const jwtFor = (token) => `jwt-for-${token}`;
const liveTokens = new Set([TOKEN_A, TOKEN_B]);
const httpError = (status, code, headers = {}) => new Response(JSON.stringify({ code, message: "synthetic secret-echo" }), { status, headers: { "content-type": "application/json", ...headers } });

const syntheticUpstream = async (url, init = {}) => {
  const target = String(url);
  const body = init.body ? new Uint8Array(init.body) : null;
  if (target === TOKEN_URL) {
    wire.calls.push({ url: target, json: JSON.parse(init.body) });
    return wire.tokenStatus ? new Response("nope", { status: wire.tokenStatus }) : Response.json(wire.tokenBody ?? { token: "synthetic-minted-session-0004" });
  }
  if (target === AUTH_URL) {
    const meta = metadataOf(body);
    wire.calls.push({ url: target, meta, headers: init.headers });
    if (wire.authStatus) return httpError(wire.authStatus, wire.authStatus === 401 ? "unauthenticated" : "resource_exhausted", wire.authStatus === 429 ? { "retry-after": "17" } : {});
    if (!liveTokens.has(meta.apiKey)) return httpError(401, "unauthenticated");
    return new Response(strField(1, jwtFor(meta.apiKey)), { headers: { "content-type": "application/proto" } });
  }
  if (target === CHAT_URL) {
    const payload = body.slice(5);
    const meta = metadataOf(payload);
    const fields = readFields(payload);
    wire.calls.push({ url: target, meta, headers: init.headers, model: dec(field(fields, 14)[0].v), prompts: field(fields, 3).map((p) => dec(field(readFields(p.v), 3)[0]?.v ?? new Uint8Array(0))), system: field(fields, 2)[0] ? dec(field(fields, 2)[0].v) : "" });
    if (wire.chatStatus) return httpError(wire.chatStatus, wire.chatStatus === 401 ? "unauthenticated" : "resource_exhausted", wire.chatStatus === 429 ? { "retry-after": "9" } : {});
    if (meta.jwt !== jwtFor(meta.apiKey)) return httpError(401, "unauthenticated");
    const frames = wire.trailerError
      ? [endStream(wire.trailerError)]
      : [frame(chatPart({ text: "hel" })), frame(chatPart({ text: "lo" })), frame(chatPart({ stop: 1, usage: [11, 3] })), endStream()];
    return new Response(new ReadableStream({ start(c) { for (const f of frames) c.enqueue(f); c.close(); } }), { headers: { "content-type": "application/connect+proto" } });
  }
  if (target === MODELS_URL) {
    const meta = metadataOf(body);
    wire.calls.push({ url: target, meta });
    if (!liveTokens.has(meta.apiKey)) return httpError(401, "unauthenticated");
    const model = (id, name, ctx, opts = {}) => lenField(1, cat(strField(1, name), opts.disabled ? intField(4, 1) : new Uint8Array(0), opts.vision ? intField(5, 1) : new Uint8Array(0), ctx ? intField(18, ctx) : new Uint8Array(0), strField(22, id)));
    return new Response(wire.models ?? cat(model("swe-1-7", "SWE-1.7 Max", 262000, { vision: true }), model("off-model", "Off", 1000, { disabled: true }), model("adaptive", "Adaptive", 0)));
  }
  throw new Error(`unexpected mocked URL ${target}`);
};

const request = (url, body, method = "POST") => new Request(`http://gateway.invalid${url}`, { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });
const chatCalls = () => wire.calls.filter((call) => call.url === CHAT_URL);
const authCalls = () => wire.calls.filter((call) => call.url === AUTH_URL);

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "devin-desktop-test-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data")); vi.stubEnv("HOME", path.join(root, "home")); vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON", "DEVIN_DESKTOP_VERSION", "DEVIN_DESKTOP_EXTENSION_VERSION"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true }); delete global._dbAdapter; vi.resetModules();
  Object.assign(wire, { calls: [], authStatus: null, chatStatus: null, trailerError: null, models: null, tokenStatus: null, tokenBody: null });
  liveTokens.clear(); liveTokens.add(TOKEN_A); liveTokens.add(TOKEN_B);
  vi.stubGlobal("fetch", vi.fn(syntheticUpstream));
  db = await import("@/lib/db/index.js");
  routes = { models: await import("../../src/app/api/v1/models/route.js"), messages: await import("../../src/app/api/v1/messages/route.js") };
  mod = await import("../../open-sse/executors/devin-desktop.js");
  oauth = await import("../../src/lib/oauth/services/devin-desktop.js");
  ({ default: provider, DEVIN_DESKTOP_CREDENTIAL_PROFILE: profile } = await import("../../open-sse/providers/registry/devin-desktop.js"));
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
}, 60000);

afterEach(async () => {
  await global._dbAdapter?.instance?.close?.(); delete global._dbAdapter;
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  await disposeLoadedRequestDetailsRepo();
  fs.rmSync(root, { recursive: true, force: true });
});

const addConnection = (name, accessToken, priority, optIn = true, extra = {}) => db.createProviderConnection({
  provider: "devin-desktop", authType: "oauth", name, accessToken, refreshToken: null, priority, isActive: true,
  providerSpecificData: optIn === undefined ? {} : { enableSessionDispatch: optIn, ...extra },
});
const openai = (extra = {}, model = MODEL) => handleChat(request("/v1/chat/completions", { model, messages: [{ role: "system", content: "be brief" }, { role: "user", content: "ping" }], ...extra }));
const anthropic = (extra = {}) => routes.messages.POST(request("/v1/messages", { model: MODEL, max_tokens: 64, messages: [{ role: "user", content: "ping" }], ...extra }));
const direct = (credentials, extra = {}) => new mod.DevinDesktopExecutor().execute({ model: "swe-1-7", stream: true, body: { model: "swe-1-7", messages: [{ role: "user", content: "ping" }], ...extra }, credentials });
const errorOf = async (result) => (await result.response.json()).error;

describe("Devin Desktop provider module", () => {
  it("composes the staged OAuth entry, executor binding, catalog and import profile", async () => {
    const { PROVIDERS, PROVIDER_MODELS, PROVIDER_OAUTH } = await import("../../open-sse/providers/index.js");
    expect(provider).toMatchObject({ id: "devin-desktop", category: "oauth", authType: "oauth" });
    expect(provider.transport).toMatchObject({ baseUrl: "https://server.codeium.com", executor: "devin-desktop", format: "openai", forceStream: true });
    expect(PROVIDERS["devin-desktop"]).toBeTruthy();
    expect(PROVIDER_MODELS["devin-desktop"].map((m) => m.id)).toEqual(expect.arrayContaining(["swe-1-7", "adaptive", "claude-opus-5-max", "gpt-5-6-sol-high", "MODEL_PRIVATE_11"]));
    expect(new Set(PROVIDER_MODELS["devin-desktop"].map((m) => m.id)).size).toBe(PROVIDER_MODELS["devin-desktop"].length);
    expect(PROVIDER_OAUTH["devin-desktop"]).toMatchObject({ flowType: "import_token", supportsBrowserPkce: true, tokenUrl: TOKEN_URL, fixedPort: 59653 });
    expect(profile).toMatchObject({ domains: ["app.devin.ai", "api.devin.ai", "server.codeium.com"], cookieNames: [], tokenPrefix: "devin-session-token$" });
    expect(profile.validationProbe).toMatchObject({ url: AUTH_URL, method: "POST", okStatus: [200] });
    expect(new RegExp(profile.credentialPattern).test(TOKEN_A)).toBe(true);
    expect(new RegExp(profile.credentialPattern).test("short")).toBe(false);
  });

  it("lists the catalog under the provider id once a connection exists", async () => {
    await addConnection("dd-a", TOKEN_A, 1);
    const catalog = await (await routes.models.GET(request("/v1/models", null, "GET"))).json();
    expect(catalog.data.map((m) => m.id)).toEqual(expect.arrayContaining(["devin-desktop/swe-1-7", "devin-desktop/adaptive"]));
  });
});

describe("Devin Desktop sign-in and refresh", () => {
  it("builds the CLI-login PKCE URL with a 96-byte verifier and the fixed loopback redirect", async () => {
    const { generatePKCE } = await import("../../src/lib/oauth/utils/pkce.js");
    const { codeVerifier, codeChallenge, state } = generatePKCE(oauth.devinDesktopOAuth.pkceVerifierBytes);
    expect(codeVerifier).toHaveLength(128);
    const redirect = `http://${oauth.DEVIN_DESKTOP_CONFIG.callbackHost}:${oauth.DEVIN_DESKTOP_CONFIG.callbackPort}${oauth.DEVIN_DESKTOP_CONFIG.callbackPath}`;
    const url = new URL(oauth.devinDesktopOAuth.buildAuthUrl(oauth.DEVIN_DESKTOP_CONFIG, redirect, state, codeChallenge));
    expect(`${url.origin}${url.pathname}`).toBe("https://app.devin.ai/auth/cli/continue");
    expect(Object.fromEntries(url.searchParams)).toEqual({ redirect_uri: "http://127.0.0.1:59653/callback", state, prompt: "select_account", code_challenge: codeChallenge, code_challenge_method: "S256" });
  });

  it("exchanges the code for one prefixed session token, tags the browser method and never invents a refresh token", async () => {
    const result = await oauth.devinDesktopOAuth.exchangeToken(oauth.DEVIN_DESKTOP_CONFIG, "code-123", "ignored", "verifier-xyz", "state-1");
    expect(wire.calls[0]).toMatchObject({ url: TOKEN_URL, json: { code: "code-123", code_verifier: "verifier-xyz" } });
    expect(result).toEqual({ accessToken: "devin-session-token$synthetic-minted-session-0004", authMethod: "browser" });
    expect(oauth.devinDesktopOAuth.mapTokens(result)).toEqual({ accessToken: result.accessToken, refreshToken: null, expiresIn: null, providerSpecificData: { authMethod: "browser" } });
    expect(oauth.devinDesktopOAuth.mapTokens({ accessToken: "pasted" })).not.toHaveProperty("providerSpecificData");

    wire.tokenBody = { token: "devin-session-token$already-prefixed-0005" };
    expect((await oauth.devinDesktopOAuth.exchangeToken(oauth.DEVIN_DESKTOP_CONFIG, "c", "", "v")).accessToken).toBe("devin-session-token$already-prefixed-0005");
  });

  it("accepts a pasted callback URL only when its state matches, and reports failures by status alone", async () => {
    const cfg = oauth.DEVIN_DESKTOP_CONFIG;
    await oauth.devinDesktopOAuth.exchangeToken(cfg, "http://127.0.0.1:59653/callback?code=from-url&state=s1", "", "v", "s1");
    expect(wire.calls.at(-1).json.code).toBe("from-url");
    await expect(oauth.devinDesktopOAuth.exchangeToken(cfg, "http://127.0.0.1:59653/callback?code=x&state=other", "", "v", "s1")).rejects.toThrow("state mismatch");
    await expect(oauth.devinDesktopOAuth.exchangeToken(cfg, "http://127.0.0.1:59653/callback?state=s1", "", "v", "s1")).rejects.toThrow("missing the authorization code");
    wire.tokenStatus = 400;
    await expect(oauth.devinDesktopOAuth.exchangeToken(cfg, "secret-code-value", "", "secret-verifier")).rejects.toThrow(/^Devin token exchange failed: 400$/);
    wire.tokenStatus = null; wire.tokenBody = {};
    await expect(oauth.devinDesktopOAuth.exchangeToken(cfg, "c", "", "v")).rejects.toThrow("returned no token");
  });

  it("validates an imported token and reports session tokens as non-refreshable", async () => {
    expect(oauth.validateImportToken("")).toMatchObject({ valid: false });
    expect(oauth.validateImportToken("short")).toMatchObject({ valid: false });
    expect(oauth.validateImportToken(TOKEN_A)).toEqual({ valid: true });
    expect(oauth.normalizeDevinSessionToken("abc")).toBe("devin-session-token$abc");
    expect(oauth.normalizeDevinSessionToken(" devin-session-token$abc ")).toBe("devin-session-token$abc");
    expect(await oauth.refreshDevinDesktopSession()).toBeNull();
    const executor = new mod.DevinDesktopExecutor();
    expect(await executor.refreshCredentials({ accessToken: TOKEN_A })).toBeNull();
    expect(executor.needsRefresh({ accessToken: TOKEN_A, expiresAt: "2000-01-01T00:00:00Z" })).toBe(false);
    expect(executor.shouldRefreshAfterAuthFailure()).toBe(false);
  });

  it("mints a fresh user JWT on every request and sends no refresh call for a revoked token", async () => {
    await addConnection("dd-a", TOKEN_A, 1);
    expect((await openai()).status).toBe(200);
    expect((await openai()).status).toBe(200);
    expect(authCalls()).toHaveLength(2);
    expect(authCalls()[0].meta.session).not.toBe(authCalls()[1].meta.session);
    expect(chatCalls().map((c) => c.meta.jwt)).toEqual([jwtFor(TOKEN_A), jwtFor(TOKEN_A)]);

    liveTokens.delete(TOKEN_A);
    const revoked = await openai();
    expect(revoked.status).toBe(401);
    expect(wire.calls.some((c) => c.url === TOKEN_URL)).toBe(false);
  });

  it("validates a session token through GetUserJwt and maps rejection and throttling", async () => {
    expect(await mod.validateDevinDesktopSession({ apiKey: TOKEN_A })).toEqual({ valid: true, status: 200 });
    expect(await mod.validateDevinDesktopSession({ apiKey: TOKEN_REVOKED })).toMatchObject({ valid: false, status: 401 });
    expect(await mod.validateDevinDesktopSession({ apiKey: "" })).toMatchObject({ valid: false, status: 401 });
    wire.authStatus = 429;
    expect(await mod.validateDevinDesktopSession({ apiKey: TOKEN_A })).toMatchObject({ valid: false, status: 429, error: expect.stringContaining("quota") });
  });
});

describe("Devin Desktop model discovery", () => {
  it("decodes enabled models, skips disabled ones and keeps limits and vision", async () => {
    const models = await mod.discoverDevinDesktopModels(TOKEN_A);
    expect(models).toEqual([
      { id: "swe-1-7", name: "SWE-1.7 Max", contextLength: 262000, maxOutputTokens: 64000, supportsVision: true },
      { id: "adaptive", name: "Adaptive", contextLength: 200000, maxOutputTokens: 64000 },
    ]);
    expect(wire.calls.at(-1).meta).toMatchObject({ apiKey: TOKEN_A, ide: "windsurf" });
  });

  it("reads a gzip reply and fails with a status-only error on rejection or garbage", async () => {
    const { gzipSync } = await import("node:zlib");
    wire.models = gzipSync(lenField(1, cat(strField(1, "Zipped"), strField(22, "zipped-model"))));
    expect((await mod.discoverDevinDesktopModels(TOKEN_A)).map((m) => m.id)).toEqual(["zipped-model"]);
    await expect(mod.discoverDevinDesktopModels(TOKEN_REVOKED)).rejects.toThrow(/^Devin model discovery returned HTTP 401$/);
    wire.models = Uint8Array.from([0x0a, 0xff, 0xff, 0xff, 0x7f]);
    await expect(mod.discoverDevinDesktopModels(TOKEN_A)).rejects.toThrow();
  });
});

describe("Devin Desktop opt-in guard", () => {
  it.each([["missing", undefined], ["false", false], ["string true", "true"], ["one", 1]])("refuses dispatch with a clear 403 and no outbound call when the flag is %s", async (_label, value) => {
    const credentials = { accessToken: TOKEN_A, providerSpecificData: value === undefined ? {} : { enableSessionDispatch: value } };
    const result = await direct(credentials);
    expect(result.response.status).toBe(403);
    expect(await errorOf(result)).toMatchObject({ type: "permission_error", code: "devin_desktop_dispatch_disabled", message: expect.stringContaining("enableSessionDispatch") });
    expect(wire.calls).toHaveLength(0);
    expect((await direct({ accessToken: TOKEN_A })).response.status).toBe(403);
  });

  it("refuses through the gateway routes and never sends the token upstream", async () => {
    await addConnection("dd-off", TOKEN_A, 1, false);
    const openaiResult = await openai();
    expect(openaiResult.status).toBe(403);
    expect(JSON.stringify(await openaiResult.json())).not.toContain(TOKEN_A);
    expect((await anthropic()).status).toBe(403);
    expect(wire.calls).toHaveLength(0);
  });
});

describe("Devin Desktop chat through the gateway routes", () => {
  it("answers JSON chat on the OpenAI route with the pinned wire identity and usage", async () => {
    await addConnection("dd-a", TOKEN_A, 1);
    const response = await openai();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.choices[0].message.content).toBe("hello");
    expect(payload.choices[0].finish_reason).toBe("stop");
    expect(payload.usage).toMatchObject({ prompt_tokens: 11, completion_tokens: 3 });

    const [auth] = authCalls();
    expect(auth.meta).toMatchObject({ ide: "windsurf", apiKey: TOKEN_A, jwt: "" });
    expect(auth.headers).toMatchObject({ "Content-Type": "application/proto", "Connect-Protocol-Version": "1" });
    const [chat] = chatCalls();
    expect(chat).toMatchObject({ model: "swe-1-7", system: "be brief", prompts: ["ping"] });
    expect(chat.meta).toMatchObject({ ide: "windsurf", apiKey: TOKEN_A, jwt: jwtFor(TOKEN_A), version: "3.6.27" });
    expect(chat.headers).toMatchObject({ "Content-Type": "application/connect+proto", "Connect-Protocol-Version": "1", "User-Agent": "windsurf/3.6.27" });
  });

  it("streams OpenAI chunks on the OpenAI route", async () => {
    await addConnection("dd-a", TOKEN_A, 1);
    const response = await openai({ stream: true });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"content":"hel"');
    expect(text).toContain('"content":"lo"');
    expect(text).toContain('"finish_reason":"stop"');
    expect(text).toContain("[DONE]");
  });

  it("serves JSON and streamed chat on the Anthropic Messages route", async () => {
    await addConnection("dd-a", TOKEN_A, 1);
    const json = await anthropic();
    expect(json.status).toBe(200);
    const message = await json.json();
    expect(message).toMatchObject({ type: "message", role: "assistant" });
    expect(JSON.stringify(message.content)).toContain("hello");

    const streamed = await anthropic({ stream: true });
    expect(streamed.status).toBe(200);
    const text = await streamed.text();
    expect(text).toContain("event: content_block_delta");
    expect(text).toContain("hel");
    expect(text).toContain("message_stop");
    expect(chatCalls().every((c) => c.meta.apiKey === TOKEN_A)).toBe(true);
  });

  it("forwards tool definitions and streams tool-call fragments as continuation deltas", async () => {
    const parts = [
      frame(cat(lenField(6, cat(strField(1, "call-1"), strField(2, "lookup"), strField(3, '{"q"'))))),
      frame(cat(lenField(6, strField(3, ':"x"}')))),
      frame(chatPart({ stop: 10 })),
      endStream(),
    ];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => (String(url) === CHAT_URL ? new Response(new ReadableStream({ start(c) { for (const f of parts) c.enqueue(f); c.close(); } })) : syntheticUpstream(url, init))));
    const result = await direct({ accessToken: TOKEN_A, providerSpecificData: { enableSessionDispatch: true } }, { tools: [{ type: "function", function: { name: "lookup", description: "d", parameters: { type: "object" } } }], tool_choice: "auto" });
    expect(result.response.status).toBe(200);
    const sse = await result.response.text();
    const chunks = sse.split("\n\n").filter((c) => c.startsWith("data: {")).map((c) => JSON.parse(c.slice(6)));
    const calls = chunks.flatMap((c) => c.choices[0].delta.tool_calls ?? []);
    expect(calls[0]).toMatchObject({ index: 0, id: "call-1", type: "function", function: { name: "lookup", arguments: '{"q"' } });
    expect(calls[1]).toMatchObject({ index: 0, function: { arguments: ':"x"}' } });
    expect(chunks.at(-1).choices[0].finish_reason).toBe("tool_calls");
  });
});

describe("Devin Desktop error mapping", () => {
  const creds = { accessToken: TOKEN_A, providerSpecificData: { enableSessionDispatch: true } };

  it("maps a rejected session token to 401 on every route without leaking it", async () => {
    await addConnection("dd-revoked", TOKEN_REVOKED, 1);
    const openaiResult = await openai();
    expect(openaiResult.status).toBe(401);
    const body = JSON.stringify(await openaiResult.json());
    expect(body).not.toContain(TOKEN_REVOKED);
    expect(body).not.toContain("secret-echo");
    expect((await anthropic()).status).toBe(401);
    expect(chatCalls()).toHaveLength(0);

    const result = await direct({ ...creds, accessToken: TOKEN_REVOKED });
    expect(result.response.status).toBe(401);
    expect(await errorOf(result)).toMatchObject({ type: "authentication_error", code: "invalid_session", message: expect.stringMatching(/sign in/i) });
  });

  it("maps a chat-endpoint 401 to 401 with an invalid_session code", async () => {
    wire.chatStatus = 401;
    const result = await direct(creds);
    expect(result.response.status).toBe(401);
    expect(await errorOf(result)).toMatchObject({ code: "invalid_session" });
  });

  it("maps 429 to a quota error and keeps Retry-After, on the preflight and the chat call", async () => {
    wire.authStatus = 429;
    const preflight = await direct(creds);
    expect(preflight.response.status).toBe(429);
    expect(preflight.response.headers.get("retry-after")).toBe("17");
    expect(await errorOf(preflight)).toMatchObject({ type: "rate_limit_error", code: "quota_exceeded" });

    wire.authStatus = null; wire.chatStatus = 429;
    const chat = await direct(creds);
    expect(chat.response.status).toBe(429);
    expect(chat.response.headers.get("retry-after")).toBe("9");
    await addConnection("dd-a", TOKEN_A, 1);
    const gateway = await openai();
    expect(gateway.status).toBe(429);
    expect(JSON.stringify(await gateway.json())).not.toContain(TOKEN_A);
  });

  it("maps a Connect error trailer that arrives before any content to a status", async () => {
    wire.trailerError = { code: "unauthenticated", message: "token revoked" };
    expect((await direct(creds)).response.status).toBe(401);
    wire.trailerError = { code: "resource_exhausted", message: "plan limit" };
    const quota = await direct(creds);
    expect(quota.response.status).toBe(429);
    expect(JSON.stringify(await errorOf(quota))).not.toContain("plan limit");
    wire.trailerError = { code: "permission_denied", message: "no access" };
    expect((await direct(creds)).response.status).toBe(403);
  });

  it("reports a mid-stream failure as an SSE error event and a malformed stream without hanging", async () => {
    const make = (frames) => vi.stubGlobal("fetch", vi.fn(async (url, init) => (String(url) === CHAT_URL ? new Response(new ReadableStream({ start(c) { for (const f of frames) c.enqueue(f); c.close(); } })) : syntheticUpstream(url, init))));
    make([frame(chatPart({ text: "partial" })), endStream({ code: "resource_exhausted", message: "mid-stream quota" })]);
    const mid = await (await direct(creds)).response.text();
    expect(mid).toContain('"content":"partial"');
    expect(mid).toContain('"code":"quota_exceeded"');
    expect(mid).toContain("[DONE]");
    make([frame(chatPart({ text: "cut" }))]);
    const cut = await (await direct(creds)).response.text();
    expect(cut).toContain("ended without trailers");
    expect(cut).toContain("[DONE]");
  });

  it("answers 502 when the upstream is unreachable and rethrows an abort", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket hang up"); }));
    const result = await direct(creds);
    expect(result.response.status).toBe(502);
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }));
    controller.abort();
    await expect(new mod.DevinDesktopExecutor().execute({ model: "swe-1-7", body: { messages: [] }, credentials: creds, signal: controller.signal })).rejects.toThrow();
  });
});

describe("Devin Desktop connection isolation", () => {
  it("authenticates each request with its own connection's token only", async () => {
    await addConnection("dd-a", TOKEN_A, 1);
    await addConnection("dd-b", TOKEN_B, 2);
    expect((await openai()).status).toBe(200);
    const all = wire.calls.filter((c) => c.meta);
    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all.map((c) => c.meta.apiKey))).toEqual(new Set([TOKEN_A]));
    for (const call of chatCalls()) expect(call.meta.jwt).toBe(jwtFor(TOKEN_A));
  });

  it("falls back to the second connection when the first is rejected, without crossing tokens", async () => {
    await addConnection("dd-revoked", TOKEN_REVOKED, 1);
    await addConnection("dd-b", TOKEN_B, 2);
    expect((await openai()).status).toBe(200);
    for (const call of chatCalls()) {
      expect(call.meta.apiKey).toBe(TOKEN_B);
      expect(call.meta.jwt).toBe(jwtFor(TOKEN_B));
    }
    expect(authCalls().map((c) => c.meta.apiKey)).toEqual([TOKEN_REVOKED, TOKEN_B]);
  });

  it("opts in per connection: a connection without the flag is never dispatched to", async () => {
    await addConnection("dd-off", TOKEN_A, 1, false);
    await addConnection("dd-on", TOKEN_B, 2, true);
    const response = await openai();
    expect(response.status).toBe(200);
    expect(new Set(wire.calls.filter((c) => c.meta).map((c) => c.meta.apiKey))).toEqual(new Set([TOKEN_B]));
  });

  it("keeps concurrent requests on different connections from sharing JWTs or sessions", async () => {
    const [a, b] = await Promise.all([
      direct({ accessToken: TOKEN_A, providerSpecificData: { enableSessionDispatch: true } }),
      direct({ accessToken: TOKEN_B, providerSpecificData: { enableSessionDispatch: true } }),
    ]);
    await Promise.all([a.response.text(), b.response.text()]);
    const chats = chatCalls();
    expect(chats).toHaveLength(2);
    for (const call of chats) expect(call.meta.jwt).toBe(jwtFor(call.meta.apiKey));
    expect(new Set(chats.map((c) => c.meta.apiKey))).toEqual(new Set([TOKEN_A, TOKEN_B]));
    expect(new Set(chats.map((c) => c.meta.session)).size).toBe(2);
  });
});
