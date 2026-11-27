// RenderHour subscription sign-in (staged). Every network call goes to a closed
// mock; global fetch throws. These tests show what DurinDoor sends and how it
// reads answers shaped like the pinned source's tests
// (cheaper-inference/OmniRoute 9671192011beb2d7f83979f40be488c5da8772b9,
// tests/unit/renderhour-oauth-provider.test.ts). They do not show that
// RenderHour accepts a DurinDoor client.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RENDERHOUR_OAUTH_ENDPOINTS,
  RENDERHOUR_REFRESH_LEAD_MS,
  RenderHourOAuthError,
  buildRenderHourAuthorizeUrl,
  createRenderHourRefreshHooks,
  exchangeRenderHourCode,
  needsRenderHourRefresh,
  refreshRenderHourToken,
  renderHourOAuthAuthorization,
  resolveRenderHourClientId,
} from "../../open-sse/services/renderhour/oauth.js";
import {
  beginRenderHourSignIn,
  completeRenderHourSignIn,
  renderHourAccountKey,
  renderhourOAuthProvider,
  selectRenderHourConnection,
} from "../../src/lib/oauth/services/renderhour.js";
import renderhourProvider, { RENDERHOUR_STAGED_OAUTH } from "../../open-sse/providers/private/renderhour.js";
import { renderHourAuthorization } from "../../open-sse/services/renderhour/media.js";
import { __clearRefreshDedupCacheForTesting } from "../../open-sse/services/tokenRefresh/dedup.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLIENT_ID = "rhc_durindoortest";
const ENV = { RENDERHOUR_OAUTH_CLIENT_ID: CLIENT_ID };
const REDIRECT = "http://localhost:20128/callback";
const VERIFIER = "v".repeat(43);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const STATE = "s".repeat(32);

const tokenBody = (n = 1, extra = {}) => ({
  access_token: `rhat_access_${n}`,
  token_type: "Bearer",
  expires_in: 3600,
  refresh_token: `rhrt_refresh_${n}`,
  ...extra,
});

/** A closed mock: only the listed URLs answer; every call is recorded. */
function closedFetch(routes) {
  const calls = [];
  const fn = vi.fn(async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init, body: init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init.body });
    const route = routes[url];
    if (!route) throw new Error(`closed mock: unexpected ${url}`);
    return route({ url, init, body: calls.at(-1).body, count: calls.filter((c) => c.url === url).length });
  });
  fn.calls = calls;
  return fn;
}

const originalFetch = globalThis.fetch;
const originalClientEnv = process.env.RENDERHOUR_OAUTH_CLIENT_ID;

beforeEach(() => {
  __clearRefreshDedupCacheForTesting();
  globalThis.fetch = vi.fn(async () => {
    throw new Error("global fetch is closed in this suite");
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalClientEnv === undefined) delete process.env.RENDERHOUR_OAUTH_CLIENT_ID;
  else process.env.RENDERHOUR_OAUTH_CLIENT_ID = originalClientEnv;
});

describe("RenderHour OAuth authorize request", () => {
  it("builds the source's PKCE parameters for the configured public client and no scope", () => {
    const url = new URL(buildRenderHourAuthorizeUrl({ clientId: CLIENT_ID, redirectUri: REDIRECT, state: STATE, codeChallenge: CHALLENGE }));
    expect(url.origin + url.pathname).toBe("https://renderhour.com/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      state: STATE,
    });
  });

  it("has no embedded client id and ignores a malformed one", () => {
    expect(resolveRenderHourClientId({})).toBeNull();
    expect(resolveRenderHourClientId({ RENDERHOUR_OAUTH_CLIENT_ID: "not-a-client" })).toBeNull();
    expect(resolveRenderHourClientId({ RENDERHOUR_OAUTH_CLIENT_ID: ` ${CLIENT_ID} ` })).toBe(CLIENT_ID);
    expect(() => beginRenderHourSignIn({ redirectUri: REDIRECT, env: {} })).toThrow(
      expect.objectContaining({ code: "not_configured", status: 400 })
    );
    // The source's OmniRoute-named client id is not shipped in either module.
    for (const file of ["open-sse/services/renderhour/oauth.js", "src/lib/oauth/services/renderhour.js"]) {
      expect(fs.readFileSync(path.join(ROOT, file), "utf8")).not.toMatch(/rhc_omniroute|renderhour_id/);
    }
  });

  it.each([
    "javascript:alert(1)",
    "http://user:pass@localhost:20128/callback",
    "http://localhost:20128/callback#frag",
    "not a url",
  ])("refuses redirect URI %s", (redirectUri) => {
    expect(() => buildRenderHourAuthorizeUrl({ clientId: CLIENT_ID, redirectUri, state: STATE, codeChallenge: CHALLENGE })).toThrow(
      expect.objectContaining({ code: "invalid_redirect_uri" })
    );
  });

  it("refuses a missing state or a non-S256 challenge", () => {
    expect(() => buildRenderHourAuthorizeUrl({ clientId: CLIENT_ID, redirectUri: REDIRECT, state: "", codeChallenge: CHALLENGE })).toThrow(
      expect.objectContaining({ code: "invalid_state" })
    );
    expect(() => buildRenderHourAuthorizeUrl({ clientId: CLIENT_ID, redirectUri: REDIRECT, state: STATE, codeChallenge: VERIFIER.slice(0, 10) })).toThrow(
      expect.objectContaining({ code: "invalid_pkce" })
    );
  });
});

describe("RenderHour generic-flow handler", () => {
  it("reads the client id per flow and runs exchange, userinfo and mapping like the source", async () => {
    process.env.RENDERHOUR_OAUTH_CLIENT_ID = CLIENT_ID;
    const config = await renderhourOAuthProvider.prepareConfig(renderhourOAuthProvider.config);
    expect(config.clientId).toBe(CLIENT_ID);
    expect(renderhourOAuthProvider.config.clientId).toBeNull();
    expect(renderhourOAuthProvider.flowType).toBe("authorization_code_pkce");
    expect(new URL(renderhourOAuthProvider.buildAuthUrl(config, REDIRECT, STATE, CHALLENGE)).searchParams.get("client_id")).toBe(CLIENT_ID);

    const fetchImpl = closedFetch({
      [RENDERHOUR_OAUTH_ENDPOINTS.token]: ({ init, body }) => {
        expect(init.method).toBe("POST");
        expect(init.redirect).toBe("error");
        expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
        expect(body).toEqual({ grant_type: "authorization_code", client_id: CLIENT_ID, code: "the-code", redirect_uri: REDIRECT, code_verifier: VERIFIER });
        return Response.json(tokenBody());
      },
      [RENDERHOUR_OAUTH_ENDPOINTS.userinfo]: ({ init }) => {
        expect(init.headers.Authorization).toBe("Bearer rhat_access_1");
        expect(init.redirect).toBe("error");
        return Response.json({ sub: "acc-1", email: "smm@example.com", name: "SMM Studio" });
      },
    });
    globalThis.fetch = fetchImpl;
    const tokens = await renderhourOAuthProvider.exchangeToken(config, "the-code", REDIRECT, VERIFIER, STATE, {}, null);
    const mapped = renderhourOAuthProvider.mapTokens(tokens, await renderhourOAuthProvider.postExchange(tokens, null));
    expect(mapped).toEqual({
      accessToken: "rhat_access_1",
      refreshToken: "rhrt_refresh_1",
      expiresIn: 3600,
      email: "smm@example.com",
      name: "SMM Studio",
      providerSpecificData: { tokenType: "Bearer", authMode: "oauth", accountId: "acc-1" },
    });
    expect(() => renderhourOAuthProvider.mapTokens({}, null)).not.toThrow();
  });

  it("keeps the sign-in when userinfo fails, redirects or is unreachable", async () => {
    for (const answer of [() => new Response("no", { status: 500 }), () => new Response(null, { status: 302, headers: { Location: "https://evil.example/" } })]) {
      const fetchImpl = closedFetch({ [RENDERHOUR_OAUTH_ENDPOINTS.userinfo]: answer });
      globalThis.fetch = fetchImpl;
      await expect(renderhourOAuthProvider.postExchange(tokenBody(), null)).resolves.toEqual({ userInfo: {} });
      expect(fetchImpl.calls).toHaveLength(1);
    }
    await expect(renderhourOAuthProvider.postExchange(tokenBody(), null)).resolves.toEqual({ userInfo: {} });
  });
});

describe("RenderHour sign-in session binding", () => {
  const signIn = (opts = {}) => beginRenderHourSignIn({ redirectUri: REDIRECT, env: ENV, ...opts });
  const callback = (session, extra = {}) => {
    const url = new URL(REDIRECT);
    url.searchParams.set("code", "code-1");
    url.searchParams.set("state", session.state);
    for (const [k, v] of Object.entries(extra)) v === null ? url.searchParams.delete(k) : url.searchParams.set(k, v);
    return url.toString();
  };
  const happyFetch = () =>
    closedFetch({
      [RENDERHOUR_OAUTH_ENDPOINTS.token]: () => Response.json(tokenBody(2)),
      [RENDERHOUR_OAUTH_ENDPOINTS.userinfo]: () => Response.json({ sub: "acc-2", email: "two@example.com" }),
    });

  it("binds a fresh S256 pair and state to the authorize URL", () => {
    const { authUrl, session } = signIn();
    const params = new URL(authUrl).searchParams;
    expect(params.get("state")).toBe(session.state);
    expect(params.get("redirect_uri")).toBe(REDIRECT);
    expect(params.get("code_challenge")).toBe(createHash("sha256").update(session.codeVerifier).digest("base64url"));
    expect(signIn().session.state).not.toBe(session.state);
  });

  it("exchanges with the session's own verifier and redirect URI, once", async () => {
    const { session } = signIn();
    const fetchImpl = happyFetch();
    const mapped = await completeRenderHourSignIn(session, callback(session), { fetchImpl });
    expect(mapped).toMatchObject({ accessToken: "rhat_access_2", refreshToken: "rhrt_refresh_2", email: "two@example.com" });
    expect(fetchImpl.calls[0].body).toMatchObject({ code: "code-1", code_verifier: session.codeVerifier, redirect_uri: REDIRECT, client_id: CLIENT_ID });
    await expect(completeRenderHourSignIn(session, callback(session), { fetchImpl })).rejects.toMatchObject({ code: "session_used" });
    expect(fetchImpl.calls.filter((c) => c.url === RENDERHOUR_OAUTH_ENDPOINTS.token)).toHaveLength(1);
  });

  it("spends the code once when two callbacks race", async () => {
    const { session } = signIn();
    const fetchImpl = happyFetch();
    const results = await Promise.allSettled([
      completeRenderHourSignIn(session, callback(session), { fetchImpl }),
      completeRenderHourSignIn(session, callback(session), { fetchImpl }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(fetchImpl.calls.filter((c) => c.url === RENDERHOUR_OAUTH_ENDPOINTS.token)).toHaveLength(1);
  });

  it("refuses a forged state without burning the real session", async () => {
    const { session } = signIn();
    const fetchImpl = happyFetch();
    await expect(completeRenderHourSignIn(session, callback(session, { state: "x".repeat(43) }), { fetchImpl })).rejects.toMatchObject({ code: "invalid_state" });
    await expect(completeRenderHourSignIn(session, callback(session, { state: null }), { fetchImpl })).rejects.toMatchObject({ code: "invalid_state" });
    expect(session.used).toBe(false);
    expect(fetchImpl.calls).toHaveLength(0);
    await expect(completeRenderHourSignIn(session, callback(session), { fetchImpl })).resolves.toMatchObject({ accessToken: "rhat_access_2" });
  });

  it.each([
    ["another origin", "http://127.0.0.1:20128/callback"],
    ["another path", "http://localhost:20128/other"],
    ["another scheme", "https://localhost:20128/callback"],
  ])("refuses a callback on %s", async (_label, base) => {
    const { session } = signIn();
    const fetchImpl = happyFetch();
    const url = new URL(base);
    url.searchParams.set("code", "code-1");
    url.searchParams.set("state", session.state);
    await expect(completeRenderHourSignIn(session, url.toString(), { fetchImpl })).rejects.toMatchObject({ code: "redirect_mismatch" });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("refuses an expired session and authorize errors, without repeating their text", async () => {
    let clock = 1_000;
    const { session } = signIn({ now: () => clock, ttlMs: 100 });
    clock = 1_100;
    await expect(completeRenderHourSignIn(session, callback(session), { now: () => clock, fetchImpl: happyFetch() })).rejects.toMatchObject({ code: "session_expired" });

    const denied = signIn().session;
    const error = await completeRenderHourSignIn(denied, callback(denied, { error: "access_denied", error_description: "<script>x</script>" }), { fetchImpl: happyFetch() }).catch((e) => e);
    expect(error).toMatchObject({ code: "access_denied", status: 403 });
    expect(error.message).not.toContain("script");

    const odd = signIn().session;
    await expect(completeRenderHourSignIn(odd, callback(odd, { error: "made_up" }), { fetchImpl: happyFetch() })).rejects.toMatchObject({ code: "unknown" });
    const noCode = signIn().session;
    await expect(completeRenderHourSignIn(noCode, callback(noCode, { code: null }), { fetchImpl: happyFetch() })).rejects.toMatchObject({ code: "invalid_request" });
  });
});

describe("RenderHour code exchange failures", () => {
  const exchange = (fetchImpl) => exchangeRenderHourCode({ clientId: CLIENT_ID, code: "secret-code", redirectUri: REDIRECT, codeVerifier: VERIFIER }, { fetchImpl });

  it("names only the OAuth error code, never the echoed body", async () => {
    const error = await exchange(closedFetch({
      [RENDERHOUR_OAUTH_ENDPOINTS.token]: () => Response.json({ error: "invalid_grant", error_description: `bad secret-code ${VERIFIER}` }, { status: 400 }),
    })).catch((e) => e);
    expect(error).toBeInstanceOf(RenderHourOAuthError);
    expect(error).toMatchObject({ code: "invalid_grant", status: 401 });
    expect(error.message).not.toContain("secret-code");
    expect(error.message).not.toContain(VERIFIER);
  });

  it.each([
    ["a 500", () => new Response("upstream rhat_leak", { status: 500 }), { code: "unknown", status: 502 }],
    ["a malformed body", () => Response.json({ token: "x" }), { code: "malformed_response" }],
    ["a bad token type", () => Response.json(tokenBody(1, { token_type: "mac" })), { code: "malformed_response" }],
    ["a bad expiry", () => Response.json(tokenBody(1, { expires_in: -1 })), { code: "malformed_response" }],
    ["a redirect", () => new Response(null, { status: 307, headers: { Location: "https://evil.example/token" } }), { code: "redirect_refused" }],
  ])("maps %s", async (_label, answer, expected) => {
    const fetchImpl = closedFetch({ [RENDERHOUR_OAUTH_ENDPOINTS.token]: answer });
    const error = await exchange(fetchImpl).catch((e) => e);
    expect(error).toMatchObject(expected);
    expect(error.message).not.toMatch(/rhat_leak|evil/);
    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0].init.redirect).toBe("error");
  });

  it("does not repeat transport error text", async () => {
    const error = await exchange(vi.fn(async () => { throw new Error(`socket said ${VERIFIER}`); })).catch((e) => e);
    expect(error).toMatchObject({ code: "network", status: 502 });
    expect(error.message).not.toContain(VERIFIER);
  });

  it("refuses a malformed verifier before sending anything", async () => {
    const fetchImpl = closedFetch({});
    await expect(exchangeRenderHourCode({ clientId: CLIENT_ID, code: "c", redirectUri: REDIRECT, codeVerifier: "short" }, { fetchImpl })).rejects.toMatchObject({ code: "invalid_pkce" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("RenderHour refresh", () => {
  const refreshRoute = (answer) => closedFetch({ [RENDERHOUR_OAUTH_ENDPOINTS.token]: answer });

  it("rotates the pair with the source's form body", async () => {
    const fetchImpl = refreshRoute(({ body, init }) => {
      expect(body).toEqual({ grant_type: "refresh_token", refresh_token: "rhrt_old_token", client_id: CLIENT_ID });
      expect(init.redirect).toBe("error");
      return Response.json(tokenBody(3));
    });
    await expect(refreshRenderHourToken("rhrt_old_token", null, { clientId: CLIENT_ID, fetchImpl })).resolves.toEqual({
      accessToken: "rhat_access_3",
      refreshToken: "rhrt_refresh_3",
      expiresIn: 3600,
    });
  });

  it("omits the refresh token when RenderHour sends none, so the stored one is kept", async () => {
    const fetchImpl = refreshRoute(() => Response.json({ access_token: "rhat_only_access", expires_in: 3600 }));
    await expect(refreshRenderHourToken("rhrt_keep_token", null, { clientId: CLIENT_ID, fetchImpl })).resolves.toEqual({ accessToken: "rhat_only_access", expiresIn: 3600 });
  });

  it.each([
    ["invalid_grant", 400, { error: "invalid_grant" }, "invalid_grant"],
    ["invalid_token", 400, { error: { code: "invalid_token" } }, "invalid_token"],
    ["token_expired", 400, { error: "token_expired" }, "token_expired"],
    ["a bare 401", 401, {}, "unauthorized"],
  ])("asks to sign in again on %s", async (_label, status, body, code) => {
    const fetchImpl = refreshRoute(() => Response.json(body, { status }));
    await expect(refreshRenderHourToken(`rhrt_spent_${code}`, null, { clientId: CLIENT_ID, fetchImpl })).resolves.toEqual({ error: "unrecoverable_refresh_error", code });
  });

  it.each([
    ["a 500", () => new Response("x", { status: 500 })],
    ["a 429", () => new Response("x", { status: 429 })],
    ["invalid_client", () => Response.json({ error: "invalid_client" }, { status: 400 })],
    ["a malformed body", () => Response.json({ refresh_token: "rhrt_lonely_token" })],
    ["a redirect", () => new Response(null, { status: 302, headers: { Location: "https://evil.example/" } })],
    ["a network error", () => { throw new Error("boom"); }],
  ])("keeps the stored credentials on %s", async (label, answer) => {
    const fetchImpl = refreshRoute(answer);
    await expect(refreshRenderHourToken(`rhrt_transient_${label.replace(/\W/g, "")}`, null, { clientId: CLIENT_ID, fetchImpl })).resolves.toBeNull();
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("sends nothing without a client id or a usable refresh token", async () => {
    const fetchImpl = refreshRoute(() => Response.json(tokenBody()));
    await expect(refreshRenderHourToken("rhrt_no_client", null, { clientId: null, fetchImpl })).resolves.toBeNull();
    await expect(refreshRenderHourToken("", null, { clientId: CLIENT_ID, fetchImpl })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("presents a single-use refresh token once when refreshes race", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const fetchImpl = refreshRoute(async () => { await gate; return Response.json(tokenBody(4)); });
    const a = refreshRenderHourToken("rhrt_race_token", null, { clientId: CLIENT_ID, fetchImpl });
    const b = refreshRenderHourToken("rhrt_race_token", null, { clientId: CLIENT_ID, fetchImpl });
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toEqual(rb);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("decides expiry with the five-minute lead", () => {
    const now = 1_700_000_000_000;
    const creds = (expiresAt, extra = {}) => ({ accessToken: "rhat_access_x", refreshToken: "rhrt_refresh_x", expiresAt, ...extra });
    expect(needsRenderHourRefresh(creds(new Date(now + 3600_000).toISOString()), now)).toBe(false);
    expect(needsRenderHourRefresh(creds(new Date(now + RENDERHOUR_REFRESH_LEAD_MS - 1).toISOString()), now)).toBe(true);
    expect(needsRenderHourRefresh(creds(new Date(now - 1).toISOString()), now)).toBe(true);
    expect(needsRenderHourRefresh(creds(undefined), now)).toBe(true);
    expect(needsRenderHourRefresh(creds(new Date(now + 3600_000).toISOString(), { accessToken: "" }), now)).toBe(true);
    expect(needsRenderHourRefresh(creds(new Date(now - 1).toISOString(), { refreshToken: "" }), now)).toBe(false);
  });
});

describe("RenderHour refresh through the shared persistence model", () => {
  const originalDataDir = process.env.DATA_DIR;
  let tempDir, db, providerCredentials, sequence = 0;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-renderhour-oauth-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
    db = await import("../../src/lib/db/index.js");
    await db.initDb();
    providerCredentials = await import("../../src/shared/services/providerCredentials.js");
  });

  afterAll(() => {
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function connect(overrides = {}) {
    sequence += 1;
    return db.createProviderConnection({
      provider: "renderhour",
      authType: "oauth",
      name: `rh-${sequence}`,
      email: `rh-${sequence}@example.test`,
      accessToken: `rhat_stored_${sequence}`,
      refreshToken: `rhrt_stored_${sequence}`,
      isActive: true,
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
      providerSpecificData: { tokenType: "Bearer", authMode: "oauth", accountId: `acc-${sequence}` },
      ...overrides,
    });
  }

  const run = (connection, fetchImpl, extra = {}) =>
    providerCredentials.refreshAndUpdateCredentials(connection, false, null, {
      getExecutorImpl: () => createRenderHourRefreshHooks({ clientId: CLIENT_ID, fetchImpl }),
      reconcileDelays: [0],
      wait: async () => {},
      log: null,
      ...extra,
    });

  it("persists the rotated pair and expiry on the selected account", async () => {
    const connection = await connect();
    const fetchImpl = closedFetch({ [RENDERHOUR_OAUTH_ENDPOINTS.token]: () => Response.json(tokenBody(`p${sequence}`)) });
    const result = await run(connection, fetchImpl);
    expect(result.refreshed).toBe(true);
    const stored = await db.getProviderConnectionById(connection.id);
    expect(stored).toMatchObject({ accessToken: `rhat_access_p${sequence}`, refreshToken: `rhrt_refresh_p${sequence}` });
    expect(new Date(stored.expiresAt).getTime()).toBeGreaterThan(Date.now() + 3000_000);
    expect(stored.providerSpecificData.accountId).toBe(`acc-${sequence}`);
  });

  it("does not refresh a token that is still valid", async () => {
    const connection = await connect({ expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    const fetchImpl = closedFetch({});
    await expect(run(connection, fetchImpl)).resolves.toMatchObject({ refreshed: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("shares one POST when two requests refresh the same connection", async () => {
    const connection = await connect();
    let release;
    const gate = new Promise((r) => { release = r; });
    const fetchImpl = closedFetch({ [RENDERHOUR_OAUTH_ENDPOINTS.token]: async () => { await gate; return Response.json(tokenBody(`c${sequence}`)); } });
    const both = Promise.all([run(connection, fetchImpl), run(connection, fetchImpl)]);
    release();
    await both;
    expect(fetchImpl.calls).toHaveLength(1);
    expect(await db.getProviderConnectionById(connection.id)).toMatchObject({ refreshToken: `rhrt_refresh_c${sequence}` });
  });

  it("does not overwrite a newer pair written by a concurrent winner", async () => {
    const connection = await connect();
    const winner = { accessToken: "rhat_winner_access", refreshToken: "rhrt_winner_refresh" };
    const fetchImpl = closedFetch({
      [RENDERHOUR_OAUTH_ENDPOINTS.token]: async () => {
        await db.updateProviderConnection(connection.id, winner);
        return Response.json(tokenBody(`late${sequence}`));
      },
    });
    const result = await run(connection, fetchImpl);
    expect(result.refreshed).toBe(false);
    expect(await db.getProviderConnectionById(connection.id)).toMatchObject(winner);
  });

  it("adopts a concurrent winner when its own single-use token was already spent", async () => {
    const connection = await connect();
    const winner = { accessToken: "rhat_winner2_access", refreshToken: "rhrt_winner2_refresh" };
    const fetchImpl = closedFetch({
      [RENDERHOUR_OAUTH_ENDPOINTS.token]: async () => {
        await db.updateProviderConnection(connection.id, winner);
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      },
    });
    const result = await run(connection, fetchImpl);
    expect(result).toMatchObject({ refreshed: false, connection: winner });
    const stored = await db.getProviderConnectionById(connection.id);
    expect(stored).toMatchObject(winner);
    expect(stored.testStatus).not.toBe("reauth_required");
  });

  it("marks reauth_required without erasing tokens when the refresh token is spent", async () => {
    const connection = await connect();
    const fetchImpl = closedFetch({ [RENDERHOUR_OAUTH_ENDPOINTS.token]: () => Response.json({ error: "invalid_grant" }, { status: 400 }) });
    await expect(run(connection, fetchImpl)).rejects.toMatchObject({ code: "PROVIDER_REAUTH_REQUIRED" });
    const stored = await db.getProviderConnectionById(connection.id);
    expect(stored).toMatchObject({ testStatus: "reauth_required", errorCode: "REAUTH", refreshToken: connection.refreshToken });
  });

  it("keeps the stored pair on a transient failure", async () => {
    const connection = await connect();
    const fetchImpl = closedFetch({ [RENDERHOUR_OAUTH_ENDPOINTS.token]: () => new Response("busy", { status: 503 }) });
    await expect(run(connection, fetchImpl)).resolves.toMatchObject({ refreshed: false });
    expect(await db.getProviderConnectionById(connection.id)).toMatchObject({ accessToken: connection.accessToken, refreshToken: connection.refreshToken });
  });

  it("selects the stored account a repeat sign-in belongs to", async () => {
    const a = await connect();
    const b = await connect();
    const mapped = { email: "other@example.test", providerSpecificData: { accountId: b.providerSpecificData.accountId } };
    expect(renderHourAccountKey(mapped)).toBe(`sub:${b.providerSpecificData.accountId}`);
    expect(selectRenderHourConnection([a, b], mapped)?.id).toBe(b.id);
    expect(selectRenderHourConnection([a, b], { email: a.email.toUpperCase(), providerSpecificData: {} })?.id).toBe(a.id);
    expect(selectRenderHourConnection([a, b], { email: a.email, providerSpecificData: { accountId: "acc-someone-else" } })).toBeNull();
    expect(selectRenderHourConnection([a, b], { providerSpecificData: {} })).toBeNull();
    expect(selectRenderHourConnection([{ ...a, authType: "apikey" }], { email: a.email })).toBeNull();
  });
});

describe("RenderHour staging boundaries", () => {
  it("keeps rh_ API-key mode and the image-only default export unchanged", () => {
    expect(renderhourProvider).toMatchObject({ authType: "apikey", category: "apikey", serviceKinds: ["image"] });
    expect(renderhourProvider).not.toHaveProperty("oauth");
    expect(renderHourAuthorization({ apiKey: "rh_live_key" })).toBe("Bearer rh_live_key");
    expect(() => renderHourAuthorization({ apiKey: "rhat_access_1" })).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => renderHourAuthorization({ accessToken: "rhat_access_1" })).toThrow(expect.objectContaining({ status: 401 }));
    expect(renderHourOAuthAuthorization({ accessToken: "rhat_access_1" })).toBe("Bearer rhat_access_1");
    expect(() => renderHourOAuthAuthorization({ accessToken: "rh_live_key" })).toThrow(expect.objectContaining({ code: "reauth_required" }));
    expect(() => renderHourOAuthAuthorization({})).toThrow(expect.objectContaining({ status: 401 }));
  });

  it("describes the staged sign-in without registering it anywhere shared", () => {
    expect(RENDERHOUR_STAGED_OAUTH).toMatchObject({ authType: "oauth", flowType: "authorization_code_pkce", clientIdEnv: "RENDERHOUR_OAUTH_CLIENT_ID" });
    for (const file of [
      "src/lib/oauth/providers.js",
      "src/lib/oauth/services/index.js",
      "open-sse/services/tokenRefresh.js",
      "open-sse/services/tokenRefresh/capabilities.js",
      "open-sse/providers/registry/index.js",
      "open-sse/executors/index.js",
    ]) {
      expect(fs.readFileSync(path.join(ROOT, file), "utf8"), file).not.toMatch(/renderhour/i);
    }
  });
});
