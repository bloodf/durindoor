import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// GapGPT sign-in parity (#2034).
//
// Source: decolua/9router PR #3350 head 1f45c0e7b29bede1693ca0df613da957d67826bf
// (MIT). Closed network: the token transport, the listener and the credential
// write are substituted. The flow store and PKCE helpers are the real modules.

import {
  beginOAuthFlowIntent,
  clearOAuthFlowsForTests,
  createOAuthFlow,
  getOAuthFlow,
  isOAuthFlowClaimActive
} from "@/lib/oauth/flowStore.js";
import { generatePKCE } from "@/lib/oauth/utils/pkce.js";
import {
  GAPGPT_LOOPBACK_MESSAGES,
  GAPGPT_LOOPBACK_REDIRECT_URI,
  GAPGPT_OAUTH_CONFIG,
  buildGapgptRefreshRequest,
  createGapgptLoopback,
  createNodeLoopbackListener,
  gapgptProvider,
  refreshGapgptCredential
} from "@/lib/oauth/providerParity/gapgpt/index.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SECRET_BODY = "PRIVATE-UPSTREAM-BODY sk-gg-leak-0000";
const HOST = { host: "localhost:1455" };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Mirror what the shared authorize route stores for a provider that returns a record. */
function startFlow({ ownerId = null, proxySelection = { mode: "direct" }, redirectUri = null, clientId = null, ttlMs } = {}) {
  const pkce = generatePKCE();
  const built = gapgptProvider.buildAuthUrl(GAPGPT_OAUTH_CONFIG, "http://attacker.test/cb", pkce.state, pkce.codeChallenge);
  const intent = ownerId ? beginOAuthFlowIntent("gapgpt", ownerId) : null;
  const flow = createOAuthFlow({
    provider: "gapgpt",
    state: pkce.state,
    kind: "authorization",
    payload: {
      codeVerifier: pkce.codeVerifier,
      redirectUri: redirectUri || built.redirectUri,
      meta: { clientId: clientId || built.clientId },
      proxySelection
    },
    ...(ttlMs ? { ttlMs } : null),
    intent
  });
  return { ...pkce, built, flow };
}

function fakeListen() {
  const calls = [];
  let handle = null;
  const close = vi.fn(async () => {});
  const listen = vi.fn(async (args) => {
    calls.push(args);
    handle = args.handle;
    return { close };
  });
  return { listen, calls, close, get handle() { return handle; } };
}

function fakeTimers() {
  const timers = [];
  return {
    setTimer: vi.fn((fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; }),
    clearTimer: vi.fn((t) => { if (t) t.cleared = true; }),
    fireLatest() { const live = timers.filter((t) => !t.cleared); live.at(-1)?.fn(); },
    timers
  };
}

function callback(loopback, params, headers = HOST, method = "GET") {
  const qs = new URLSearchParams(params).toString();
  return loopback.handle({ method, url: `/auth/callback?${qs}`, headers });
}

beforeEach(() => clearOAuthFlowsForTests());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("staged configuration", () => {
  it("pins the source registry OAuth block", () => {
    expect(GAPGPT_OAUTH_CONFIG).toMatchObject({
      clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
      authorizeUrl: "https://gapgpt.app/oauth/cli",
      tokenUrl: "https://gapgpt.app/api/v1/oauth/cli/token",
      scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
      codeChallengeMethod: "S256",
      fixedPort: 1455,
      callbackPath: "/auth/callback",
      extraParams: { id_token_add_organizations: "true", codex_cli_simplified_flow: "true", originator: "codex_cli_rs" }
    });
    expect(GAPGPT_LOOPBACK_REDIRECT_URI).toBe("http://localhost:1455/auth/callback");
  });

  it("manifest names every central wiring slot and stays unregistered", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "src/lib/oauth/providerParity/gapgpt/registration.json"), "utf8"));
    expect(manifest.registered).toBe(false);
    expect(manifest.source.repository[0].commit).toBe("1f45c0e7b29bede1693ca0df613da957d67826bf");
    expect(Object.keys(manifest.integration)).toEqual(expect.arrayContaining([
      "registry", "oauthConstants", "providerTable", "redirectUri", "fixedPortRoute",
      "portSerialization", "dashboardModal", "flowCompletion", "tokenRefresh"
    ]));
    for (const mode of ["deviceCode", "tokenImport"]) expect(manifest.modes[mode]).toMatch(/^inapplicable/);
  });

  // Staging-only block: remove when the upstream provider port and auth06 land.
  it("is not wired into production yet", () => {
    const providers = fs.readFileSync(path.join(ROOT, "src/lib/oauth/providers.js"), "utf8");
    expect(providers).not.toMatch(/providerParity\/gapgpt/);
    const registry = path.join(ROOT, "open-sse/providers/registry/gapgpt.js");
    if (fs.existsSync(registry)) {
      // Upstream lane landed first: its OAuth row must equal the staged one.
      const text = fs.readFileSync(registry, "utf8");
      expect(text).toContain(GAPGPT_OAUTH_CONFIG.tokenUrl);
      expect(text).toContain(GAPGPT_OAUTH_CONFIG.clientId);
    }
  });
});

describe("authorize URL", () => {
  it("sends S256 PKCE, scopes and extra params, and forces the fixed redirect", () => {
    const pkce = generatePKCE();
    const result = gapgptProvider.buildAuthUrl(GAPGPT_OAUTH_CONFIG, "https://dashboard.example/callback", pkce.state, pkce.codeChallenge);
    expect(result.redirectUri).toBe(GAPGPT_LOOPBACK_REDIRECT_URI);
    expect(result.clientId).toBe(GAPGPT_OAUTH_CONFIG.clientId);
    const url = new URL(result.authUrl);
    expect(url.origin + url.pathname).toBe("https://gapgpt.app/oauth/cli");
    const q = Object.fromEntries(url.searchParams);
    expect(q).toMatchObject({
      response_type: "code",
      client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
      redirect_uri: GAPGPT_LOOPBACK_REDIRECT_URI,
      scope: GAPGPT_OAUTH_CONFIG.scope,
      code_challenge_method: "S256",
      originator: "codex_cli_rs",
      state: pkce.state
    });
    expect(q.code_challenge).toBe(createHash("sha256").update(pkce.codeVerifier).digest("base64url"));
    expect(url.searchParams.has("code_verifier")).toBe(false);
  });

  it("refuses a missing state, a plain challenge or a non-S256 config", () => {
    const { codeChallenge, state, codeVerifier } = generatePKCE();
    expect(() => gapgptProvider.buildAuthUrl(GAPGPT_OAUTH_CONFIG, null, "", codeChallenge)).toThrow(/state/);
    expect(() => gapgptProvider.buildAuthUrl(GAPGPT_OAUTH_CONFIG, null, state, "short")).toThrow(/S256/);
    expect(() => gapgptProvider.buildAuthUrl(GAPGPT_OAUTH_CONFIG, null, state, `${codeVerifier}!`)).toThrow(/S256/);
    expect(() => gapgptProvider.buildAuthUrl({ ...GAPGPT_OAUTH_CONFIG, codeChallengeMethod: "plain" }, null, state, codeChallenge)).toThrow(/S256/);
  });
});

describe("token exchange", () => {
  const meta = { clientId: GAPGPT_OAUTH_CONFIG.clientId };

  it("posts the bound form body through the flow's proxy", async () => {
    const fetchMock = vi.fn(async () => json({ data: { api_key: "sk-gg-synthetic" } }));
    vi.stubGlobal("fetch", fetchMock);
    const proxyOptions = { proxyUrl: "http://pool-a.invalid:8080", strictProxy: true };
    const body = await gapgptProvider.exchangeToken(GAPGPT_OAUTH_CONFIG, "code-1", GAPGPT_LOOPBACK_REDIRECT_URI, "verifier-1", "s", meta, proxyOptions);
    expect(body).toEqual({ data: { api_key: "sk-gg-synthetic" } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gapgpt.app/api/v1/oauth/cli/token");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(init.body)).toEqual({
      grant_type: "authorization_code",
      client_id: GAPGPT_OAUTH_CONFIG.clientId,
      code: "code-1",
      redirect_uri: GAPGPT_LOOPBACK_REDIRECT_URI,
      code_verifier: "verifier-1"
    });
    expect(init.proxyOptions).toBe(proxyOptions);
  });

  it.each([
    ["redirect", ["http://localhost:1455/callback", "v", meta], /fixed loopback redirect/],
    ["redirect host", ["http://evil.test:1455/auth/callback", "v", meta], /fixed loopback redirect/],
    ["client", [GAPGPT_LOOPBACK_REDIRECT_URI, "v", { clientId: "other-client" }], /different client/],
    ["client missing", [GAPGPT_LOOPBACK_REDIRECT_URI, "v", {}], /different client/],
    ["verifier", [GAPGPT_LOOPBACK_REDIRECT_URI, "", meta], /PKCE verifier/]
  ])("refuses a %s mismatch before any request", async (_label, [redirectUri, verifier, m], message) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(gapgptProvider.exchangeToken(GAPGPT_OAUTH_CONFIG, "c", redirectUri, verifier, "s", m, null)).rejects.toThrow(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a token URL outside the pinned origin", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(gapgptProvider.exchangeToken({ ...GAPGPT_OAUTH_CONFIG, tokenUrl: "https://gapgpt.app.evil.test/token" }, "c", GAPGPT_LOOPBACK_REDIRECT_URI, "v", "s", meta, null)).rejects.toThrow(/pinned/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never echoes an error or non-JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(SECRET_BODY, { status: 400 })));
    const err1 = await gapgptProvider.exchangeToken(GAPGPT_OAUTH_CONFIG, "c", GAPGPT_LOOPBACK_REDIRECT_URI, "v", "s", meta, null).catch((e) => e);
    expect(err1.message).toBe("GapGPT token exchange failed (400)");
    expect(err1.code).toBe("OAUTH_UPSTREAM_FAILURE");

    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "invalid_grant", error_description: SECRET_BODY }, 403)));
    const err2 = await gapgptProvider.exchangeToken(GAPGPT_OAUTH_CONFIG, "c", GAPGPT_LOOPBACK_REDIRECT_URI, "v", "s", meta, null).catch((e) => e);
    expect(err2.message).toBe("GapGPT token exchange failed (403: invalid_grant)");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(`<html>${SECRET_BODY}</html>`, { status: 200 })));
    const err3 = await gapgptProvider.exchangeToken(GAPGPT_OAUTH_CONFIG, "c", GAPGPT_LOOPBACK_REDIRECT_URI, "v", "s", meta, null).catch((e) => e);
    expect(err3.message).toBe("GapGPT token exchange returned an unreadable response (200)");
    for (const err of [err1, err2, err3]) {
      expect(err.message).not.toContain("PRIVATE");
      expect(JSON.stringify(err)).not.toContain("sk-gg-leak");
    }
  });
});

describe("token envelope mapping", () => {
  it.each([
    ["flat api_key", { api_key: "k1" }, "k1", "api_key"],
    ["data-wrapped api_key", { data: { api_key: "k2" } }, "k2", "api_key"],
    ["apiKey", { data: { apiKey: "k3" } }, "k3", "apiKey"],
    ["access_token fallback", { access_token: "k4" }, "k4", "access_token"],
    ["api_key wins over access_token", { api_key: "k5", access_token: "other" }, "k5", "api_key"],
    ["blank api_key falls through", { api_key: "  ", access_token: "k6" }, "k6", "access_token"]
  ])("%s becomes the gateway credential", (_label, tokens, key, field) => {
    const mapped = gapgptProvider.mapTokens(tokens);
    expect(mapped.accessToken).toBe(key);
    expect(mapped.apiKey).toBe(key);
    expect(mapped.providerSpecificData).toEqual({ authMethod: "pkce", credentialField: field });
    expect(mapped).not.toHaveProperty("refreshToken");
    expect(mapped).not.toHaveProperty("expiresIn");
  });

  it("keeps refresh token and expiry only when the source sends them", () => {
    expect(gapgptProvider.mapTokens({ data: { api_key: "k", refresh_token: "r", expires_in: 3600 } })).toMatchObject({ refreshToken: "r", expiresIn: 3600 });
    const ignored = gapgptProvider.mapTokens({ api_key: "k", refresh_token: "", expires_in: "soon" });
    expect(ignored).not.toHaveProperty("refreshToken");
    expect(ignored).not.toHaveProperty("expiresIn");
    expect(gapgptProvider.mapTokens({ api_key: "k", expires_in: -5 })).not.toHaveProperty("expiresIn");
  });

  it("refuses a response without any credential", () => {
    for (const tokens of [{}, { data: {} }, { data: { api_key: 7 } }, null]) {
      expect(() => gapgptProvider.mapTokens(tokens)).toThrow("GapGPT returned no credential");
    }
  });
});

describe("refresh", () => {
  it("does nothing for a long-lived key without a refresh token", async () => {
    const fetchImpl = vi.fn();
    expect(await refreshGapgptCredential(null, { fetchImpl })).toBeNull();
    expect(await refreshGapgptCredential("  ", { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("builds a form refresh grant with the client id and proxy", () => {
    const { url, init } = buildGapgptRefreshRequest("r-1", { proxyOptions: { proxyUrl: "http://p.invalid" } });
    expect(url).toBe(GAPGPT_OAUTH_CONFIG.tokenUrl);
    expect(Object.fromEntries(init.body)).toEqual({ client_id: GAPGPT_OAUTH_CONFIG.clientId, grant_type: "refresh_token", refresh_token: "r-1" });
    expect(init.proxyOptions).toEqual({ proxyUrl: "http://p.invalid" });
  });

  it("maps a wrapped response and keeps the old refresh token when none is returned", async () => {
    const fetchImpl = vi.fn(async () => json({ data: { api_key: "new-key", expires_in: 60 } }));
    expect(await refreshGapgptCredential("r-1", { fetchImpl })).toEqual({ accessToken: "new-key", apiKey: "new-key", refreshToken: "r-1", expiresIn: 60 });
    const rotating = vi.fn(async () => json({ access_token: "a2", refresh_token: "r-2" }));
    expect(await refreshGapgptCredential("r-1", { fetchImpl: rotating })).toEqual({ accessToken: "a2", apiKey: "a2", refreshToken: "r-2" });
  });

  it("classifies failures without leaking the body", async () => {
    const log = { error: vi.fn() };
    const cases = [
      [json({ error: "invalid_grant", error_description: SECRET_BODY }, 400), { error: "unrecoverable_refresh_error", code: "invalid_grant" }],
      [new Response(SECRET_BODY, { status: 401 }), { error: "unrecoverable_refresh_error", code: "http_401" }],
      [new Response(SECRET_BODY, { status: 503 }), null],
      [json({ data: {} }), null],
      [new Response(SECRET_BODY, { status: 200 }), null]
    ];
    for (const [response, expected] of cases) {
      expect(await refreshGapgptCredential("r-secret", { fetchImpl: async () => response, log })).toEqual(expected);
    }
    expect(await refreshGapgptCredential("r-secret", { fetchImpl: async () => { throw new Error(SECRET_BODY); }, log })).toBeNull();
    const logged = JSON.stringify(log.error.mock.calls);
    expect(logged).not.toContain("PRIVATE");
    expect(logged).not.toContain("r-secret");
  });
});

describe("owned loopback callback", () => {
  let listener;
  let timers;
  let complete;
  let loopback;

  beforeEach(() => {
    listener = fakeListen();
    timers = fakeTimers();
    complete = vi.fn(async (_provider, code) => ({ connection: { id: `conn-${code}` } }));
    loopback = createGapgptLoopback({ listen: listener.listen, complete, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  });

  it("binds loopback 1455 once and reports a busy port", async () => {
    const [a, b] = await Promise.all([loopback.start(), loopback.start()]);
    expect(a.success && b.success).toBe(true);
    expect(listener.listen).toHaveBeenCalledTimes(1);
    expect(listener.calls[0]).toMatchObject({ host: "127.0.0.1", port: 1455 });
    expect(await loopback.start()).toEqual({ success: true, reused: true });

    const busy = createGapgptLoopback({ listen: async () => { throw Object.assign(new Error("in use"), { code: "EADDRINUSE" }); }, complete });
    expect(await busy.start()).toEqual({ success: false, reason: "port_busy" });
    expect(busy.listening).toBe(false);
    const other = createGapgptLoopback({ listen: async () => { throw new Error("EACCES /secret/path"); }, complete });
    expect(await other.start()).toEqual({ success: false, reason: "listen_failed" });
  });

  it("refuses to register before listening, for unknown flows, other providers or duplicates", async () => {
    const { flow, state } = startFlow();
    expect(loopback.register({ flowId: flow.flowId, state })).toBe(false);
    await loopback.start();
    expect(loopback.register({ flowId: "nope", state })).toBe(false);
    const codex = createOAuthFlow({ provider: "codex", state: "codex-state", payload: {} });
    expect(loopback.register({ flowId: codex.flowId, state: "codex-state" })).toBe(false);
    expect(loopback.register({ flowId: flow.flowId, state })).toBe(true);
    expect(loopback.register({ flowId: flow.flowId, state })).toBe(false);
  });

  it("exchanges once, through the flow's own claim, and reports success only after persistence", async () => {
    await loopback.start();
    const { flow, state } = startFlow({ proxySelection: { mode: "strict-pool", poolId: "pool-a" } });
    loopback.register({ flowId: flow.flowId, state });

    let release;
    complete.mockImplementationOnce((_p, _code, _state, claim) => new Promise((resolve) => {
      release = () => resolve({ connection: { id: "conn-saved" } });
      expect(isOAuthFlowClaimActive(claim)).toBe(true);
    }));
    const pending = callback(loopback, { code: "abc", state });
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    expect(loopback.status({ flowId: flow.flowId, state })).toEqual({ status: "processing" });
    let settled = false;
    pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    const [provider, code, cbState, claim] = complete.mock.calls[0];
    expect([provider, code, cbState]).toEqual(["gapgpt", "abc", state]);
    expect(claim.payload.proxySelection).toEqual({ mode: "strict-pool", poolId: "pool-a" });
    expect(claim.payload.redirectUri).toBe(GAPGPT_LOOPBACK_REDIRECT_URI);

    release();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.body).toContain(GAPGPT_LOOPBACK_MESSAGES.success);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(loopback.status({ flowId: flow.flowId, state })).toEqual({ status: "done", connectionId: "conn-saved" });
    expect(getOAuthFlow({ flowId: flow.flowId, provider: "gapgpt" })).toBeNull();
    expect(listener.close).toHaveBeenCalledTimes(1);
  });

  it("does not report success when the save produced no connection", async () => {
    await loopback.start();
    const { flow, state } = startFlow();
    loopback.register({ flowId: flow.flowId, state });
    complete.mockResolvedValueOnce({ connection: null });
    const res = await callback(loopback, { code: "c", state });
    expect(res.status).toBe(500);
    expect(res.body).not.toContain("Successful");
    expect(loopback.status({ flowId: flow.flowId, state })).toEqual({ status: "error", error: GAPGPT_LOOPBACK_MESSAGES.saveFailed });
  });

  it("hides completion error text from the browser and the poll", async () => {
    await loopback.start();
    const { flow, state } = startFlow();
    loopback.register({ flowId: flow.flowId, state });
    complete.mockRejectedValueOnce(new Error(`Token exchange failed: ${SECRET_BODY}`));
    const res = await callback(loopback, { code: "c", state });
    expect(res.status).toBe(502);
    expect(res.body).not.toContain("PRIVATE");
    const status = loopback.status({ flowId: flow.flowId, state });
    expect(JSON.stringify(status)).not.toContain("PRIVATE");
    expect(status.error).toBe(GAPGPT_LOOPBACK_MESSAGES.exchangeFailed);
  });

  it("rejects unknown, missing and replayed state without an exchange", async () => {
    await loopback.start();
    const { flow, state } = startFlow();
    loopback.register({ flowId: flow.flowId, state });
    expect((await callback(loopback, { code: "c", state: "forged" })).status).toBe(400);
    expect((await callback(loopback, { code: "c" })).status).toBe(400);
    expect(complete).not.toHaveBeenCalled();

    expect((await callback(loopback, { code: "c", state })).status).toBe(200);
    // Listener stopped; a replay through the same handler is still refused.
    const replay = await callback(loopback, { code: "c", state });
    expect(replay.status).toBe(409);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("a cancelled sign-in cannot be completed by a later callback", async () => {
    await loopback.start();
    const { flow, state } = startFlow({ ownerId: "owner-a" });
    loopback.register({ flowId: flow.flowId, state, ownerId: "owner-a" });
    expect(await loopback.cancel({ flowId: flow.flowId, state, ownerId: "owner-b" })).toEqual({ success: true, cancelled: false });
    expect(await loopback.cancel({ flowId: flow.flowId, state, ownerId: "owner-a" })).toEqual({ success: true, cancelled: true });
    expect(getOAuthFlow({ flowId: flow.flowId, provider: "gapgpt" })).toBeNull();
    expect(listener.close).toHaveBeenCalled();
    const res = await callback(loopback, { code: "c", state });
    expect(res.status).toBe(409);
    expect(res.body).toContain(GAPGPT_LOOPBACK_MESSAGES.cancelled);
    expect(complete).not.toHaveBeenCalled();
  });

  it("a cancel during the exchange revokes the claim and wins", async () => {
    await loopback.start();
    const { flow, state } = startFlow();
    loopback.register({ flowId: flow.flowId, state });
    let claimSeen;
    let release;
    complete.mockImplementationOnce((_p, _c, _s, claim) => new Promise((resolve) => {
      claimSeen = claim;
      release = () => resolve({ connection: { id: "late" } });
    }));
    const pending = callback(loopback, { code: "c", state });
    await vi.waitFor(() => expect(claimSeen).toBeDefined());
    await loopback.cancel({ flowId: flow.flowId, state });
    // flowCompletion commits only while this is true.
    expect(isOAuthFlowClaimActive(claimSeen)).toBe(false);
    release();
    const res = await pending;
    expect(res.status).toBe(409);
    expect(loopback.status({ flowId: flow.flowId, state }).status).toBe("cancelled");
  });

  it("an expired flow cannot be exchanged", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await loopback.start();
    const { flow, state } = startFlow({ ttlMs: 1000 });
    loopback.register({ flowId: flow.flowId, state });
    vi.setSystemTime(Date.now() + 2000);
    const res = await callback(loopback, { code: "c", state });
    expect(res.status).toBe(410);
    expect(complete).not.toHaveBeenCalled();
  });

  it.each([
    ["redirect", { redirectUri: "http://localhost:1455/callback" }],
    ["client", { clientId: "app_other" }]
  ])("a flow with a mismatched %s is refused", async (_label, overrides) => {
    await loopback.start();
    const { flow, state } = startFlow(overrides);
    loopback.register({ flowId: flow.flowId, state });
    const res = await callback(loopback, { code: "c", state });
    expect(res.status).toBe(400);
    expect(res.body).toContain(GAPGPT_LOOPBACK_MESSAGES.mismatch);
    expect(complete).not.toHaveBeenCalled();
    expect(getOAuthFlow({ flowId: flow.flowId, provider: "gapgpt" })).toBeNull();
  });

  it("provider errors and missing codes consume the flow without an exchange", async () => {
    await loopback.start();
    const denied = startFlow();
    const hostile = startFlow();
    const noCode = startFlow();
    for (const f of [denied, hostile, noCode]) loopback.register({ flowId: f.flow.flowId, state: f.state });

    const r1 = await callback(loopback, { error: "access_denied", error_description: SECRET_BODY, state: denied.state });
    expect(r1.body).toContain("(access_denied)");
    expect(r1.body).not.toContain("PRIVATE");
    const r2 = await callback(loopback, { error: "<script>x</script>", state: hostile.state });
    expect(r2.body).toContain(GAPGPT_LOOPBACK_MESSAGES.exchangeFailed);
    expect(r2.body).not.toContain("<script>x");
    const r3 = await callback(loopback, { state: noCode.state });
    expect(r3.body).toContain(GAPGPT_LOOPBACK_MESSAGES.noCode);
    expect(complete).not.toHaveBeenCalled();
    for (const f of [denied, hostile, noCode]) {
      expect(getOAuthFlow({ flowId: f.flow.flowId, provider: "gapgpt" })).toBeNull();
    }
  });

  it("accepts only GET /auth/callback from a loopback host and origin", async () => {
    await loopback.start();
    const { flow, state } = startFlow();
    loopback.register({ flowId: flow.flowId, state });
    const qs = `code=c&state=${encodeURIComponent(state)}`;
    expect((await loopback.handle({ method: "GET", url: `/callback?${qs}`, headers: HOST })).status).toBe(404);
    expect((await loopback.handle({ method: "POST", url: `/auth/callback?${qs}`, headers: HOST })).status).toBe(405);
    expect((await loopback.handle({ method: "GET", url: `/auth/callback?${qs}`, headers: { ...HOST, origin: "https://attacker.test" } })).status).toBe(403);
    expect((await loopback.handle({ method: "GET", url: `/auth/callback?${qs}`, headers: { host: "evil.test:1455" } })).status).toBe(403);
    expect((await loopback.handle({ method: "GET", url: `/auth/callback?${qs}`, headers: { host: "localhost:20128" } })).status).toBe(403);
    expect(complete).not.toHaveBeenCalled();
    expect((await loopback.handle({ method: "GET", url: `/auth/callback?${qs}`, headers: { host: "127.0.0.1:1455", origin: "http://localhost:1455" } })).status).toBe(200);
  });

  it("keeps concurrent accounts on the fixed port separate", async () => {
    await loopback.start();
    const a = startFlow({ ownerId: "owner-a", proxySelection: { mode: "strict-pool", poolId: "pool-a" } });
    const b = startFlow({ ownerId: "owner-b", proxySelection: { mode: "direct" } });
    expect(loopback.register({ flowId: a.flow.flowId, state: a.state, ownerId: "owner-a" })).toBe(true);
    expect(loopback.register({ flowId: b.flow.flowId, state: b.state, ownerId: "owner-b" })).toBe(true);

    // Neither owner sees the other's status.
    expect(loopback.status({ flowId: a.flow.flowId, state: a.state, ownerId: "owner-b" })).toEqual({ status: "unknown" });
    expect(loopback.status({ flowId: b.flow.flowId, state: a.state, ownerId: "owner-a" })).toEqual({ status: "unknown" });

    await callback(loopback, { code: "code-b", state: b.state });
    expect(listener.close).not.toHaveBeenCalled();
    await callback(loopback, { code: "code-a", state: a.state });
    expect(listener.close).toHaveBeenCalledTimes(1);

    const byCode = Object.fromEntries(complete.mock.calls.map(([, code, state, claim]) => [code, { state, claim }]));
    expect(byCode["code-a"].state).toBe(a.state);
    expect(byCode["code-a"].claim.flowId).toBe(a.flow.flowId);
    expect(byCode["code-a"].claim.payload.proxySelection).toEqual({ mode: "strict-pool", poolId: "pool-a" });
    expect(byCode["code-b"].claim.flowId).toBe(b.flow.flowId);
    expect(byCode["code-b"].claim.payload.proxySelection).toEqual({ mode: "direct" });
    expect(loopback.status({ flowId: a.flow.flowId, state: a.state, ownerId: "owner-a" })).toEqual({ status: "done", connectionId: "conn-code-a" });
    expect(loopback.status({ flowId: b.flow.flowId, state: b.state, ownerId: "owner-b" })).toEqual({ status: "done", connectionId: "conn-code-b" });
  });

  it("a new attempt by the same owner replaces only that owner's session", async () => {
    await loopback.start();
    const other = startFlow({ ownerId: "owner-b" });
    loopback.register({ flowId: other.flow.flowId, state: other.state, ownerId: "owner-b" });
    const first = startFlow({ ownerId: "owner-a" });
    loopback.register({ flowId: first.flow.flowId, state: first.state, ownerId: "owner-a" });
    const second = startFlow({ ownerId: "owner-a" });
    expect(loopback.register({ flowId: second.flow.flowId, state: second.state, ownerId: "owner-a" })).toBe(true);

    expect((await callback(loopback, { code: "old", state: first.state })).status).toBe(400);
    expect(complete).not.toHaveBeenCalled();
    expect(getOAuthFlow({ flowId: other.flow.flowId, provider: "gapgpt" })).not.toBeNull();
    expect(loopback.sessionCount).toBe(2);
  });

  it("times out pending sign-ins, cancels their flows and frees the port", async () => {
    await loopback.start();
    expect(timers.timers.at(-1).ms).toBe(300000);
    const { flow, state } = startFlow();
    loopback.register({ flowId: flow.flowId, state });
    timers.fireLatest();
    await vi.waitFor(() => expect(listener.close).toHaveBeenCalled());
    expect(getOAuthFlow({ flowId: flow.flowId, provider: "gapgpt" })).toBeNull();
    expect(loopback.status({ flowId: flow.flowId, state })).toEqual({ status: "error", error: GAPGPT_LOOPBACK_MESSAGES.timeout });
    expect((await callback(loopback, { code: "c", state })).status).toBe(400);
    expect(complete).not.toHaveBeenCalled();
  });

  it("caps the listener lifetime at the shared OAuth timeout", async () => {
    const capped = createGapgptLoopback({ listen: listener.listen, complete, setTimer: timers.setTimer, clearTimer: timers.clearTimer, timeoutMs: 24 * 3600 * 1000 });
    await capped.start();
    expect(timers.timers.at(-1).ms).toBe(300000);
  });
});

describe("node listener adapter (fake server, no socket)", () => {
  function fakeCreateServer({ failWith = null } = {}) {
    const servers = [];
    const createServer = vi.fn((handler) => {
      const server = new EventEmitter();
      server.handler = handler;
      server.listening = false;
      server.listen = vi.fn((port, host, cb) => {
        server.bound = { port, host };
        queueMicrotask(() => {
          if (failWith) server.emit("error", failWith);
          else { server.listening = true; cb(); }
        });
      });
      server.close = vi.fn((cb) => { server.listening = false; cb(); });
      servers.push(server);
      return server;
    });
    return { createServer, servers };
  }

  it("binds through the adapter and serves the handler result", async () => {
    const { createServer, servers } = fakeCreateServer();
    const loopback = createGapgptLoopback({ listen: createNodeLoopbackListener(createServer), complete: vi.fn() });
    expect(await loopback.start()).toEqual({ success: true, reused: false });
    expect(servers[0].bound).toEqual({ port: 1455, host: "127.0.0.1" });
    const res = { writeHead: vi.fn(), end: vi.fn() };
    await servers[0].handler({ method: "GET", url: "/auth/callback?state=x&code=y", headers: HOST }, res);
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.objectContaining({ "Content-Type": "text/html; charset=utf-8" }));
    await loopback.stop();
    expect(servers[0].close).toHaveBeenCalled();
  });

  it("maps EADDRINUSE to port_busy", async () => {
    const { createServer } = fakeCreateServer({ failWith: Object.assign(new Error("busy"), { code: "EADDRINUSE" }) });
    const loopback = createGapgptLoopback({ listen: createNodeLoopbackListener(createServer), complete: vi.fn() });
    expect(await loopback.start()).toEqual({ success: false, reason: "port_busy" });
  });
});
