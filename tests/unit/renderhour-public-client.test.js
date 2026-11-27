// RenderHour public PKCE client (#2034), driven through the real OAuth route,
// flow store, connection database and shared proactive refresh. The network is
// closed: only the listed RenderHour URLs answer and every credential is
// synthetic. Client id, redirect rule and wire shapes follow
// cheaper-inference/OmniRoute d3f06ea668109f8ac1feadfcae25f6ff9b873b5f. Passing
// here says nothing about the live service.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: vi.fn(async () => {}) }));

const PUBLIC_CLIENT = "rhc_omniroute";
const OVERRIDE_CLIENT = "rhc_synthetic_override";
const ENV = "RENDERHOUR_OAUTH_CLIENT_ID";
const AUTHORIZE_URL = "https://renderhour.com/oauth/authorize";
const TOKEN_URL = "https://renderhour.com/api/oauth/token";
const USERINFO_URL = "https://renderhour.com/api/oauth/userinfo";
const GENERATIONS_URL = "https://renderhour.com/v1/generations";
const API_KEY = "rh_synthetic_public_client_key";

const originalFetch = globalThis.fetch;
const originalDataDir = process.env.DATA_DIR;
let tempDir, db, route, redirectUri, tokenRefresh, media, dedup, calls, answers, sequence = 0;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-renderhour-public-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("../../src/lib/db/index.js");
  await db.initDb();
  route = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
  redirectUri = await import("../../src/lib/oauth/redirectUri.js");
  tokenRefresh = await import("../../src/sse/services/tokenRefresh.js");
  media = await import("../../open-sse/services/renderhour/media.js");
  dedup = await import("../../open-sse/services/tokenRefresh/dedup.js");
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  sequence += 1;
  calls = [];
  answers = {};
  dedup.__clearRefreshDedupCacheForTesting();
  vi.stubEnv(ENV, undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
  globalThis.fetch = vi.fn(async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (!answers[url]) throw new Error(`closed mock: unexpected ${url}`);
    return answers[url]();
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function post(action, body, provider = "renderhour") {
  const response = await route.POST(
    new Request(`http://localhost/api/oauth/${provider}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ provider, action }) }
  );
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) };
}

const remoteDashboard = { hostname: "gateway.example.invalid", port: "", protocol: "https:", origin: "https://gateway.example.invalid" };
const startSignIn = (extra = {}) =>
  post("authorize", { redirectUri: redirectUri.buildOAuthRedirectUri(remoteDashboard, "renderhour"), ownerId: `owner-${sequence}`, ...extra });
const formOf = (call) => Object.fromEntries(call.init.body);
const tokens = (tag) => ({ access_token: `rhat_access_${tag}`, refresh_token: `rhrt_refresh_${tag}`, token_type: "Bearer", expires_in: 3600 });

function answerSignIn(tag, userInfo) {
  answers[TOKEN_URL] = () => Response.json(tokens(tag));
  answers[USERINFO_URL] = () => Response.json(userInfo);
}

async function signIn(tag, userInfo) {
  const started = await startSignIn();
  expect(started.status).toBe(200);
  answerSignIn(tag, userInfo);
  const finished = await post("exchange", { flowId: started.body.flowId, state: started.body.state, code: `code-${tag}` });
  expect(finished.status).toBe(200);
  return finished;
}

function storedConnection(extra = {}) {
  return db.createProviderConnection({
    provider: "renderhour",
    authType: "oauth",
    name: `public-${sequence}`,
    email: `public-${sequence}@example.invalid`,
    accessToken: `rhat_stored_${sequence}`,
    refreshToken: `rhrt_stored_${sequence}`,
    expiresAt: new Date(Date.now() - 1_000).toISOString(),
    isActive: true,
    providerSpecificData: { accountId: `stored-${sequence}` },
    ...extra,
  });
}

describe("RenderHour redirect (loopback only, as the source states)", () => {
  it.each([
    ["a localhost dashboard", { hostname: "localhost", port: "20127", protocol: "http:" }, false, "http://localhost:20127/callback"],
    ["a 127.0.0.1 dashboard", { hostname: "127.0.0.1", port: "20128", protocol: "http:" }, false, "http://127.0.0.1:20128/callback"],
    ["an IPv6 loopback dashboard", { hostname: "[::1]", port: "20128", protocol: "http:" }, false, "http://localhost:20128/callback"],
    ["a localhost dashboard on port 80", { hostname: "localhost", port: "", protocol: "http:" }, false, "http://localhost:80/callback"],
    ["a LAN dashboard", { hostname: "10.0.0.5", port: "3000", protocol: "http:" }, false, "http://localhost:3000/callback"],
    ["a remote dashboard", remoteDashboard, false, "http://localhost:20128/callback"],
    ["a hosted dashboard", remoteDashboard, true, "http://localhost:20128/callback"],
  ])("uses a loopback /callback for %s", (_label, location, hosted, expected) => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://gateway.example.invalid");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/gateway");
    expect(redirectUri.buildOAuthRedirectUri(location, "renderhour", hosted)).toBe(expected);
  });
});

describe.each([
  ["the override is absent", undefined, PUBLIC_CLIENT],
  ["a valid override is set", ` ${OVERRIDE_CLIENT} `, OVERRIDE_CLIENT],
])("RenderHour sign-in when %s", (_label, override, clientId) => {
  beforeEach(() => vi.stubEnv(ENV, override));

  it("sends one client through authorize (S256, state, no scope), exchange and rotating refresh", async () => {
    // Caller metadata cannot choose the client.
    const started = await startSignIn({ meta: { clientId: "rhc_from_caller" } });
    expect(started.status).toBe(200);
    expect(started.body).not.toHaveProperty("codeVerifier");
    expect(calls).toHaveLength(0);
    const authorize = new URL(started.body.authUrl);
    const challenge = authorize.searchParams.get("code_challenge");
    expect(authorize.origin + authorize.pathname).toBe(AUTHORIZE_URL);
    expect(Object.fromEntries(authorize.searchParams)).toEqual({
      response_type: "code",
      client_id: clientId,
      redirect_uri: "http://localhost:20128/callback",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: started.body.state,
    });

    const forged = await post("exchange", { flowId: started.body.flowId, state: "x".repeat(43), code: "forged" });
    expect(forged.status).toBe(400);
    expect(calls).toHaveLength(0);

    const tag = `flow${sequence}`;
    answerSignIn(tag, { sub: `sub-${sequence}`, email: `flow-${sequence}@example.invalid`, name: "Synthetic" });
    const finished = await post("exchange", { flowId: started.body.flowId, state: started.body.state, code: "the-code" });
    expect(finished.status).toBe(200);
    expect(finished.text).not.toMatch(/rhat_|rhrt_/);
    expect(calls.map((call) => [call.url, call.init.redirect])).toEqual([[TOKEN_URL, "error"], [USERINFO_URL, "error"]]);
    const exchange = formOf(calls[0]);
    expect(exchange).toEqual({
      grant_type: "authorization_code",
      client_id: clientId,
      code: "the-code",
      redirect_uri: "http://localhost:20128/callback",
      code_verifier: expect.any(String),
    });
    expect(createHash("sha256").update(exchange.code_verifier).digest("base64url")).toBe(challenge);

    const id = finished.body.connection.id;
    await db.updateProviderConnection(id, { expiresAt: new Date(Date.now() + 60_000).toISOString() });
    calls.length = 0;
    answers = { [TOKEN_URL]: () => Response.json(tokens(`rotated${sequence}`)) };
    const refreshed = await tokenRefresh.checkAndRefreshToken("renderhour", { ...(await db.getProviderConnectionById(id)), connectionId: id });
    expect(calls.map((call) => [call.url, call.init.redirect])).toEqual([[TOKEN_URL, "error"]]);
    expect(formOf(calls[0])).toEqual({ grant_type: "refresh_token", refresh_token: `rhrt_refresh_${tag}`, client_id: clientId });
    expect(refreshed.accessToken).toBe(`rhat_access_rotated${sequence}`);
    expect(await db.getProviderConnectionById(id)).toMatchObject({
      accessToken: `rhat_access_rotated${sequence}`,
      refreshToken: `rhrt_refresh_rotated${sequence}`,
      providerSpecificData: { accountId: `sub-${sequence}` },
    });
  });

  it("still matches stored accounts by account id, not by a shared email", async () => {
    const email = `shared-${sequence}@example.invalid`;
    const first = await signIn(`a${sequence}`, { sub: `a-${sequence}`, email });
    const second = await signIn(`b${sequence}`, { sub: `b-${sequence}`, email });
    const repeat = await signIn(`c${sequence}`, { sub: `a-${sequence}`, email });
    expect(second.body.connection.id).not.toBe(first.body.connection.id);
    expect(repeat.body.connection.id).toBe(first.body.connection.id);
    expect(await db.getProviderConnectionById(first.body.connection.id)).toMatchObject({ refreshToken: `rhrt_refresh_c${sequence}` });
    expect(await db.getProviderConnectionById(second.body.connection.id)).toMatchObject({ refreshToken: `rhrt_refresh_b${sequence}` });
  });
});

describe.each([
  ["empty", ""],
  ["whitespace", "   "],
  ["not a client id", "synthetic-pasted-secret-value"],
  ["a prefix with no usable id", "rhc_!"],
  ["a client id with a space", "rhc_synthetic bad"],
])("RenderHour with an invalid client override (%s)", (_label, value) => {
  const expectSanitized = (text) => {
    expect(text).toContain(ENV);
    if (value.trim()) expect(text).not.toContain(value);
    expect(text).not.toContain(PUBLIC_CLIENT);
  };

  it("fails authorize locally with a sanitized configuration error", async () => {
    vi.stubEnv(ENV, value);
    const started = await startSignIn();
    expect(started.status).toBe(500);
    expect(started.body).toEqual({ error: expect.stringContaining("misconfigured") });
    expectSanitized(started.body.error);
    expect(calls).toHaveLength(0);
  });

  it("sends no exchange and stores no connection", async () => {
    const started = await startSignIn();
    const before = (await db.getProviderConnections({ provider: "renderhour" })).length;
    vi.stubEnv(ENV, value);
    const finished = await post("exchange", { flowId: started.body.flowId, state: started.body.state, code: "unsent-code" });
    expect(finished.status).toBeGreaterThanOrEqual(400);
    expectSanitized(finished.body.error);
    expect(finished.text).not.toContain("unsent-code");
    expect(calls).toHaveLength(0);
    expect(await db.getProviderConnections({ provider: "renderhour" })).toHaveLength(before);
  });

  it("sends no refresh and keeps the stored credentials", async () => {
    const connection = await storedConnection();
    vi.stubEnv(ENV, value);
    const result = await tokenRefresh.checkAndRefreshToken("renderhour", { ...connection, connectionId: connection.id });
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({ accessToken: connection.accessToken, refreshToken: connection.refreshToken });
    const stored = await db.getProviderConnectionById(connection.id);
    expect(stored).toMatchObject({ accessToken: connection.accessToken, refreshToken: connection.refreshToken });
    expect(stored.testStatus).not.toBe("reauth_required");
  });

  it("leaves rh_ API-key media, module loading and other providers working", async () => {
    vi.stubEnv(ENV, value);
    const credentials = { authType: "apikey", apiKey: API_KEY };
    await expect(tokenRefresh.checkAndRefreshToken("renderhour", credentials)).resolves.toMatchObject({ apiKey: API_KEY });
    expect(media.discoverRenderHourModels(credentials)).toMatchObject({ success: true });
    answers[GENERATIONS_URL] = () =>
      Response.json({ id: "job-1", status: "succeeded", outputs: [{ content_type: "video/mp4", url: "https://renderhour.com/files/a.mp4" }] }, { status: 201 });
    const job = await media.runRenderHourMediaJob({ task: "video", request: { model: "kling-3.0", prompt: "waves" }, credentials });
    expect(job).toMatchObject({ success: true });
    expect(calls.map((call) => call.url)).toEqual([GENERATIONS_URL]);
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${API_KEY}`);

    const other = await post("authorize", { redirectUri: "http://localhost:20128/callback", ownerId: `other-${sequence}` }, "claude");
    expect(other.status).toBe(200);
    expect(calls).toHaveLength(1);

    vi.resetModules();
    await expect(import("../../open-sse/providers/registry/index.js")).resolves.toHaveProperty("default");
    await expect(import("../../src/lib/oauth/providers.js")).resolves.toHaveProperty("getProvider");
  });
});

describe("RenderHour registry guidance", () => {
  it("describes sign-in as working by default, with an optional override and the pasted callback", async () => {
    const { default: provider } = await import("../../open-sse/providers/registry/renderhour.js");
    expect(provider.authHint).toContain("no setup needed");
    expect(provider.authHint).toContain(`${ENV} optionally`);
    expect(provider.display.notice.text).toContain("paste the callback URL back");
    expect(provider.display.notice.text).not.toContain("when the operator sets");
  });
});
