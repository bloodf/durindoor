/**
 * Codex and ChatGPT sign-in/request parity (#2034).
 *
 * Pinned sources (MIT):
 * - router-for-me/CLIProxyAPI @ dbe641f286a489ecb39e3c041c554371e6add864
 *   internal/auth/codex/{openai_auth.go,siwc_auth.go,jwt_parser.go,token.go},
 *   sdk/auth/codex_device.go
 * - router-for-me/EasyCLIProxyAPI @ 29567ead8164a00724dfdc2087f02a23895636ee
 *   (GUI over bundled CLIProxyAPI core 8.1.3; no Codex wire contract of its own)
 * - cheaper-inference/OmniRoute @ b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523
 *   src/lib/oauth/{providers/codex.ts,constants/oauth.ts,utils/codexAuthImport.ts},
 *   open-sse/services/tokenRefresh/providers/codex.ts
 *
 * Real route handlers, provider services, refresh, executor and translator run
 * against closed mocked transports. Tokens are synthetic. The staging-only
 * block is the last describe in this file.
 */
import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import jwkFixture from "../fixtures/chatgpt-plan-synthetic-jwk.json";

const mocks = vi.hoisted(() => ({
  createProviderConnection: vi.fn(),
  ensureOutboundProxyInitialized: vi.fn(),
  fetch: vi.fn(),
  open: vi.fn(),
  proxyAwareFetch: vi.fn(),
}));

vi.mock("open", () => ({ default: mocks.open }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
  default: vi.fn(),
}));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => ({ status: init?.status || 200, body, json: async () => body }),
  },
}));
vi.mock("@/lib/network/initOutboundProxy", () => ({
  ensureOutboundProxyInitialized: mocks.ensureOutboundProxyInitialized,
}));
vi.mock("@/lib/localDb", () => ({
  createProviderConnection: mocks.createProviderConnection,
  getProviderConnectionById: vi.fn(),
  getProxyPoolById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/oauth/utils/server", () => ({
  clearCodexSession: vi.fn(),
  clearXaiSession: vi.fn(),
  getCodexSessionStatus: vi.fn(),
  getXaiSessionStatus: vi.fn(),
  registerCodexSession: vi.fn(),
  registerXaiSession: vi.fn(),
  startCodexProxy: vi.fn(),
  startXaiProxy: vi.fn(),
  stopCodexProxy: vi.fn(),
  stopXaiProxy: vi.fn(),
}));

import { CODEX_CONFIG } from "../../src/lib/oauth/constants/oauth.js";
import { clearOAuthFlowsForTests } from "../../src/lib/oauth/flowStore.js";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEVICE_USER_CODE_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const DEVICE_TOKEN_URL = "https://auth.openai.com/api/accounts/deviceauth/token";
const UPSTREAM_SECRET = "upstream-body-must-not-leak";
const originalFetch = global.fetch;

function jwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.sig`;
}

function idToken(accountId, { email = `${accountId}@example.test`, plan = "plus" } = {}) {
  return jwt({
    email,
    "https://api.openai.com/auth": { chatgpt_account_id: accountId, chatgpt_plan_type: plan },
  });
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
  };
}

/** Closed mock: an unexpected URL fails the request instead of leaving the box. */
function routeUpstream(handlers) {
  mocks.fetch.mockImplementation(async (url, init) => {
    const handler = handlers[String(url)];
    if (!handler) throw new Error(`Unexpected outbound request: ${url}`);
    return typeof handler === "function" ? handler(init) : handler;
  });
}

async function postRoute(provider, action, body) {
  const { POST } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
  return POST({ json: async () => body }, { params: Promise.resolve({ provider, action }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  clearOAuthFlowsForTests();
  global.fetch = mocks.fetch;
  mocks.fetch.mockImplementation(async (url) => {
    throw new Error(`Unexpected outbound request: ${url}`);
  });
  mocks.ensureOutboundProxyInitialized.mockResolvedValue();
  let next = 0;
  mocks.createProviderConnection.mockImplementation(async (data) => ({ id: `codex-${++next}`, ...data }));
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.useRealTimers();
});

describe("Codex browser PKCE (production)", () => {
  it("issues an S256 challenge and a fresh state and verifier per concurrent flow", async () => {
    const { generateAuthData } = await import("../../src/lib/oauth/providers.js");
    const redirect = "http://localhost:1455/auth/callback";
    const [a, b] = await Promise.all([
      generateAuthData("codex", redirect, null, null),
      generateAuthData("codex", redirect, null, null),
    ]);
    for (const data of [a, b]) {
      const url = new URL(data.authUrl);
      expect(url.searchParams.get("code_challenge")).toBe(
        createHash("sha256").update(data.codeVerifier).digest("base64url"),
      );
      expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
      expect(url.searchParams.get("scope")).toBe("openid profile email offline_access");
    }
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("binds a selected workspace and rejects a token for another account before saving", async () => {
    routeUpstream({
      [CODEX_CONFIG.tokenUrl]: jsonResponse({
        access_token: "at-wrong", refresh_token: "rt-wrong", id_token: idToken("acct-other"), expires_in: 3600,
      }),
    });
    const started = await postRoute("codex", "authorize", { proxyMode: "direct", meta: { workspace_id: "acct-team" } });
    expect(started.status).toBe(200);
    expect(new URL(started.body.authUrl).searchParams.get("allowed_workspace_id")).toBe("acct-team");

    const done = await postRoute("codex", "exchange", { code: "code-1", state: started.body.state, flowId: started.body.flowId });
    expect(done.status).toBeGreaterThanOrEqual(400);
    expect(mocks.createProviderConnection).not.toHaveBeenCalled();
    expect(JSON.stringify(done.body)).not.toMatch(/at-wrong|rt-wrong/);
  });

  it("rejects conflicting or malformed workspace selections before any network call", async () => {
    for (const meta of [
      { workspace_id: "acct-a", allowed_workspace_id: "acct-b" },
      { workspace_id: "bad\nvalue" },
    ]) {
      const res = await postRoute("codex", "authorize", { proxyMode: "direct", meta });
      expect(res.status).toBe(400);
    }
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects a wrong state before exchanging and never submits an accepted flow twice", async () => {
    let exchanges = 0;
    routeUpstream({
      [CODEX_CONFIG.tokenUrl]: () => {
        exchanges += 1;
        return jsonResponse({ access_token: "at-a", refresh_token: "rt-a", id_token: idToken("acct-a"), expires_in: 3600 });
      },
    });
    const started = await postRoute("codex", "authorize", { proxyMode: "direct" });

    const forged = await postRoute("codex", "exchange", { code: "c", state: "forged", flowId: started.body.flowId });
    expect(forged.status).toBeGreaterThanOrEqual(400);
    expect(exchanges).toBe(0);

    const input = { code: "c", state: started.body.state, flowId: started.body.flowId };
    const [first, second] = await Promise.all([postRoute("codex", "exchange", input), postRoute("codex", "exchange", input)]);
    expect([first.status, second.status].filter((status) => status === 200)).toHaveLength(1);
    const replay = await postRoute("codex", "exchange", input);
    expect(replay.status).toBeGreaterThanOrEqual(400);
    expect(exchanges).toBe(1);
    expect(mocks.createProviderConnection).toHaveBeenCalledTimes(1);

    const saved = mocks.createProviderConnection.mock.calls[0][0];
    expect(saved).toMatchObject({ provider: "codex", authType: "oauth", accessToken: "at-a", refreshToken: "rt-a" });
    expect(saved.providerSpecificData).toMatchObject({ chatgptAccountId: "acct-a", chatgptPlanType: "plus" });
  });
});

describe("Codex device sign-in (production)", () => {
  it("accepts the alternate `usercode` field and a string interval like the source", async () => {
    routeUpstream({ [DEVICE_USER_CODE_URL]: jsonResponse({ device_auth_id: "dev-1", usercode: "ABCD-EFGH", interval: "7" }) });
    const started = await postRoute("codex", "device-code", { proxyMode: "direct" });
    expect(started.status).toBe(200);
    expect(started.body.user_code).toBe("ABCD-EFGH");
    expect(started.body.interval).toBe(7);
    expect(JSON.stringify(started.body)).not.toContain("dev-1");
  });

  it("keeps two concurrent accounts on their own device handle and proxy route", async () => {
    let issued = 0;
    routeUpstream({
      [DEVICE_USER_CODE_URL]: () => jsonResponse({ device_auth_id: `dev-${++issued}`, user_code: `CODE-${issued}` }),
      [DEVICE_TOKEN_URL]: (init) => {
        const { device_auth_id: id } = JSON.parse(init.body);
        return jsonResponse({ authorization_code: `ac-${id}`, code_verifier: `cv-${id}`, code_challenge: "cc" });
      },
      [CODEX_CONFIG.tokenUrl]: (init) => {
        const code = new URLSearchParams(init.body).get("code");
        const account = code === "ac-dev-1" ? "acct-one" : "acct-two";
        return jsonResponse({ access_token: `at-${account}`, refresh_token: `rt-${account}`, id_token: idToken(account), expires_in: 3600 });
      },
    });
    const one = await postRoute("codex", "device-code", { proxyMode: "direct" });
    const two = await postRoute("codex", "device-code", { proxyMode: "legacy" });
    mocks.fetch.mockClear();

    const [polledTwo, polledOne] = await Promise.all([
      postRoute("codex", "poll", { flowId: two.body.flowId }),
      postRoute("codex", "poll", { flowId: one.body.flowId }),
    ]);
    expect(polledOne.body.success).toBe(true);
    expect(polledTwo.body.success).toBe(true);

    const polls = mocks.fetch.mock.calls.filter(([url]) => url === DEVICE_TOKEN_URL);
    const byHandle = Object.fromEntries(polls.map(([, init]) => [JSON.parse(init.body).device_auth_id, init]));
    expect(JSON.parse(byHandle["dev-1"].body).user_code).toBe("CODE-1");
    expect(JSON.parse(byHandle["dev-2"].body).user_code).toBe("CODE-2");
    expect(byHandle["dev-1"].proxyOptions).toMatchObject({ disableEnvProxy: true });
    expect(byHandle["dev-2"].proxyOptions).toMatchObject({ disableEnvProxy: false });

    const saved = mocks.createProviderConnection.mock.calls.map(([row]) => row);
    expect(saved.map((row) => [row.accessToken, row.providerSpecificData.chatgptAccountId]).sort()).toEqual([
      ["at-acct-one", "acct-one"],
      ["at-acct-two", "acct-two"],
    ]);

    const again = await postRoute("codex", "poll", { flowId: one.body.flowId });
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(mocks.createProviderConnection).toHaveBeenCalledTimes(2);
  });

  it("treats 404 as pending and reports other poll failures without the upstream body", async () => {
    let status = 404;
    routeUpstream({
      [DEVICE_USER_CODE_URL]: jsonResponse({ device_auth_id: "dev-x", user_code: "X" }),
      [DEVICE_TOKEN_URL]: () => jsonResponse(status === 404 ? "" : `boom ${UPSTREAM_SECRET}`, status),
    });
    const started = await postRoute("codex", "device-code", { proxyMode: "direct" });
    const pending = await postRoute("codex", "poll", { flowId: started.body.flowId });
    expect(pending.body).toMatchObject({ success: false, pending: true });

    status = 500;
    const failed = await postRoute("codex", "poll", { flowId: started.body.flowId });
    expect(failed.body.success).toBe(false);
    expect(failed.body.pending).toBe(false);
    expect(mocks.createProviderConnection).not.toHaveBeenCalled();
    expect(failed.body.error).toBe("device_token_failed");
  });
});

describe("Codex refresh ownership (production)", () => {
  async function refresh(...args) {
    const { refreshCodexToken } = await import("../../open-sse/services/tokenRefresh/providers.js");
    return refreshCodexToken(...args);
  }
  const log = () => {
    const entries = [];
    const push = (level) => (...parts) => entries.push([level, JSON.stringify(parts)]);
    return { entries, info: push("info"), warn: push("warn"), error: push("error") };
  };

  it("refreshes two accounts concurrently on their own token and proxy and shares one in-flight call", async () => {
    let calls = 0;
    mocks.proxyAwareFetch.mockImplementation(async (url, init, proxy) => {
      calls += 1;
      const { refresh_token: token } = Object.fromEntries(new URLSearchParams(init.body));
      expect(url).toBe(CODEX_CONFIG.tokenUrl);
      return jsonResponse({
        access_token: `new-at-${token}`, refresh_token: `next-${token}`, expires_in: 3600,
        id_token: idToken(token === "rt-par-a" ? "acct-a" : "acct-b"), proxy: proxy.tag,
      });
    });
    const proxyA = { tag: "a" };
    const proxyB = { tag: "b" };
    const [a1, a2, b] = await Promise.all([
      refresh("rt-par-a", null, proxyA, null, "acct-a"),
      refresh("rt-par-a", null, proxyA, null, "acct-a"),
      refresh("rt-par-b", null, proxyB, null, "acct-b"),
    ]);
    expect(calls).toBe(2);
    expect(a1).toEqual(a2);
    expect(a1).toMatchObject({ accessToken: "new-at-rt-par-a", refreshToken: "next-rt-par-a" });
    expect(b).toMatchObject({ accessToken: "new-at-rt-par-b", refreshToken: "next-rt-par-b" });
    const sent = mocks.proxyAwareFetch.mock.calls.map(([, init, proxy]) => [Object.fromEntries(new URLSearchParams(init.body)).refresh_token, proxy.tag]);
    expect(sent.sort()).toEqual([["rt-par-a", "a"], ["rt-par-b", "b"]]);
    for (const [, init] of mocks.proxyAwareFetch.mock.calls) {
      expect(Object.fromEntries(new URLSearchParams(init.body))).toMatchObject({ client_id: CLIENT_ID, grant_type: "refresh_token" });
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("marks a rejected refresh token unrecoverable without logging the upstream body", async () => {
    const logger = log();
    mocks.proxyAwareFetch.mockResolvedValue(
      jsonResponse({ error: { code: "refresh_token_reused", message: UPSTREAM_SECRET } }, 401),
    );
    const result = await refresh("rt-rejected", logger, null);
    expect(result).toMatchObject({ error: "unrecoverable_refresh_error", code: "refresh_token_reused" });
    expect(JSON.stringify(logger.entries)).not.toContain(UPSTREAM_SECRET);
    expect(JSON.stringify(logger.entries)).not.toContain("rt-rejected");
  });

  it("keeps a transient failure retryable and rejects a refreshed token for another workspace", async () => {
    mocks.proxyAwareFetch.mockResolvedValueOnce(jsonResponse("bad gateway", 502));
    expect(await refresh("rt-transient", null, null)).toBeNull();

    mocks.proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      access_token: "at-x", refresh_token: "rt-x2", id_token: idToken("acct-intruder"), expires_in: 3600,
    }));
    expect(await refresh("rt-moved", null, null, null, "acct-home")).toEqual({
      error: "unrecoverable_refresh_error", code: "workspace_mismatch",
    });
  });

  it("returns a retryable null when the refresh deadline aborts the request", async () => {
    const logger = log();
    mocks.proxyAwareFetch.mockImplementation(async (_url, init) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    expect(await refresh("rt-hung", logger, null)).toBeNull();
    expect(JSON.stringify(logger.entries)).not.toContain("rt-hung");
  });
});

describe("Codex selected account on model discovery and requests (production)", () => {
  const accounts = [
    { id: "conn-a", provider: "codex", accessToken: "at-a", idToken: idToken("acct-a"), providerSpecificData: {} },
    { id: "conn-b", provider: "codex", accessToken: "at-b", idToken: idToken("acct-b"), providerSpecificData: { chatgptAccountId: "acct-b-explicit" } },
  ];

  it("discovers models per account without crossing bearer or account headers", async () => {
    const { fetchConnectionModels } = await import("../../src/app/api/providers/[id]/models/fetchConnectionModels.js");
    mocks.proxyAwareFetch.mockImplementation(async () => jsonResponse({ models: [{ slug: "gpt-6.1-sol" }] }));
    await Promise.all(accounts.map((connection) => fetchConnectionModels(connection)));
    const headers = mocks.proxyAwareFetch.mock.calls.map(([, init]) => [init.headers.Authorization, init.headers["ChatGPT-Account-ID"]]);
    expect(headers.sort()).toEqual([["Bearer at-a", "acct-a"], ["Bearer at-b", "acct-b-explicit"]]);
  });

  it("sends each account's own bearer, account header and session on executor requests", async () => {
    const { CodexExecutor } = await import("../../open-sse/executors/codex.js");
    const executor = new CodexExecutor();
    const [a, b] = accounts.map((account) => executor.buildHeaders({ ...account, connectionId: account.id }, true));
    expect(a.Authorization).toBe("Bearer at-a");
    expect(a["ChatGPT-Account-ID"]).toBe("acct-a");
    expect(a.session_id).toBe("conn-a");
    expect(b.Authorization).toBe("Bearer at-b");
    expect(b["ChatGPT-Account-ID"]).toBe("acct-b-explicit");
    expect(b.session_id).toBe("conn-b");
    expect(a.originator).toBe("codex_cli_rs");
  });

  it("translates a chat request to Responses and a Responses stream event back to chat", async () => {
    await import("../translator/registerAll.js");
    const { translateRequest, translateResponse, initState } = await import("../../open-sse/translator/index.js");
    const { FORMATS } = await import("../../open-sse/translator/formats.js");
    const body = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "gpt-6.1-sol", {
      model: "gpt-6.1-sol", stream: true, messages: [{ role: "user", content: "hi" }],
    }, true, null, "codex");
    expect(body.input).toEqual([expect.objectContaining({ role: "user" })]);
    expect(body.messages).toBeUndefined();

    const state = initState(FORMATS.OPENAI);
    const chunks = translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI,
      { type: "response.output_text.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: "hello" }, state);
    expect(JSON.stringify(chunks)).toContain("hello");
  });
});

describe("Codex CLI token import (production)", () => {
  async function importAccounts(accounts) {
    const { POST } = await import("../../src/app/api/oauth/codex/bulk-import/route.js");
    const res = await POST({ json: async () => accounts });
    return res.body;
  }

  it("imports a CLIProxyAPI codex storage file without its envelope fields", async () => {
    const result = await importAccounts([{
      type: "codex", id_token: idToken("acct-cpa", { plan: "pro" }), access_token: "at-cpa", refresh_token: "rt-cpa",
      account_id: "acct-cpa", email: "cpa@example.test", expired: "2030-01-01T00:00:00Z",
      last_refresh: "2029-12-31T00:00:00Z", plan_type: "free",
    }]);
    expect(result).toMatchObject({ success: 1, failed: 0 });
    expect(JSON.stringify(result)).not.toMatch(/at-cpa|rt-cpa/);
    const saved = mocks.createProviderConnection.mock.calls[0][0];
    expect(saved).toMatchObject({
      provider: "codex", accessToken: "at-cpa", refreshToken: "rt-cpa", expiresAt: "2030-01-01T00:00:00.000Z",
      providerSpecificData: expect.objectContaining({ chatgptAccountId: "acct-cpa", chatgptPlanType: "pro" }),
    });
    for (const key of ["type", "plan_type", "last_refresh", "expired", "account_id", "id_token"]) {
      expect(saved).not.toHaveProperty(key);
    }
  });

  it("takes the expiry from the access token so an import does not refresh at once", async () => {
    const exp = 1_900_000_000;
    await importAccounts([{ tokens: { access_token: jwt({ exp }), refresh_token: "rt-jwt", id_token: idToken("acct-j") } }]);
    expect(mocks.createProviderConnection.mock.calls[0][0].expiresAt).toBe(new Date(exp * 1000).toISOString());
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects API-key auth files and Sign in with ChatGPT records before saving", async () => {
    const result = await importAccounts([
      { auth_mode: "apikey", OPENAI_API_KEY: "sk-test-not-real", tokens: { access_token: "at-k" } },
      { type: "codex", use_siwc: true, access_token: "at-s", siwc: { client_id: "oaiapp_x" } },
      { access_token: "at-o", refresh_token: "rt-o", client_id: "oaiapp_issued" },
    ]);
    expect(result).toMatchObject({ success: 0, failed: 3 });
    expect(mocks.createProviderConnection).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/sk-test-not-real|at-[kso]\b/);
  });
});

describe("ChatGPT plan (Sign in with ChatGPT) against CLIProxyAPI SIWC (production)", () => {
  const issuer = "https://auth.openai.com";
  const resource = "https://api.openai.com/v1";
  const hostId = "urn:uuid:00000000-0000-4000-8000-000000000002";
  const redirectUri = "http://127.0.0.1:1455/auth/callback";
  const now = 1_800_000_000_000;
  const privateKey = createPrivateKey({ key: jwkFixture, format: "jwk" });
  const jwks = { keys: [{ kty: "RSA", n: jwkFixture.n, e: jwkFixture.e, kid: "fixture", alg: "RS256" }] };

  function signedIdentity(attempt, clientId) {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const input = [
      encode({ alg: "RS256", kid: "fixture" }),
      encode({ iss: issuer, sub: "subject-1", aud: clientId, nonce: attempt.nonce, iat: now / 1000, exp: now / 1000 + 3600 }),
    ].join(".");
    return `${input}.${sign("sha256", Buffer.from(input), privateKey).toString("base64url")}`;
  }

  it("uses the SIWC authorize parameter set and reauthorizes with the issued client", async () => {
    const { startChatGptPlanAuthorization } = await import("../../src/lib/oauth/chatgptPlanProtocol.js");
    const first = new URL(startChatGptPlanAuthorization({ redirectUri, hostId }, now).authorizationUrl);
    // CLIProxyAPI GenerateSIWCAuthURL parameter names; only agent_name_hint's value differs.
    expect([...first.searchParams.keys()].sort()).toEqual([
      "agent_name_hint", "client_id", "code_challenge", "code_challenge_method", "ext_agent_host_id",
      "nonce", "redirect_uri", "resource", "response_type", "scope", "state",
    ]);
    expect(first.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(first.searchParams.get("scope")).toBe("openid profile email offline_access resource.invoke chatgpt.tokens.use.direct");
    expect(first.searchParams.get("resource")).toBe(resource);

    const again = new URL(startChatGptPlanAuthorization({
      redirectUri, hostId, registration: { issuer, clientId: "oaiapp_issued", subject: "subject-1" },
    }, now).authorizationUrl);
    expect(again.searchParams.get("client_id")).toBe("oaiapp_issued");
    expect(again.searchParams.has("agent_name_hint")).toBe(false);
  });

  it("exchanges with the issued client and resource and keeps sign-in without the plan scope", async () => {
    const { createChatGptPlanProtocol, startChatGptPlanAuthorization } = await import("../../src/lib/oauth/chatgptPlanProtocol.js");
    const { attempt } = startChatGptPlanAuthorization({ redirectUri, hostId }, now);
    const sent = [];
    const fetchAdapter = vi.fn(async (url, init) => {
      sent.push([url, init.body && Object.fromEntries(init.body)]);
      if (url === `${issuer}/.well-known/jwks.json`) return Response.json(jwks);
      return Response.json({
        access_token: "plan-at", refresh_token: "plan-rt", token_type: "bearer", expires_in: 3600,
        scope: "openid profile email offline_access", id_token: signedIdentity(attempt, "oaiapp_new"),
      });
    });
    const protocol = createChatGptPlanProtocol({ fetchAdapter, clock: () => now });
    const record = await protocol.exchangeCode(attempt, `${redirectUri}?code=c1&state=${attempt.state}&client_id=oaiapp_new`);
    expect(sent[0]).toEqual([`${issuer}/api/accounts/oauth/token`, {
      grant_type: "authorization_code", client_id: "oaiapp_new", code: "c1",
      code_verifier: attempt.codeVerifier, redirect_uri: redirectUri, resource,
    }]);
    // CLIProxyAPI rejects a grant without chatgpt.tokens.use.direct; DurinDoor
    // keeps the verified sign-in and marks plan inference unavailable.
    expect(record).toMatchObject({ clientId: "oaiapp_new", subject: "subject-1", planEnabled: false });
  });

  it("rejects a callback with a forged state and redacts provider error bodies", async () => {
    const { createChatGptPlanProtocol, startChatGptPlanAuthorization } = await import("../../src/lib/oauth/chatgptPlanProtocol.js");
    const { attempt } = startChatGptPlanAuthorization({ redirectUri, hostId }, now);
    const fetchAdapter = vi.fn(async () => Response.json({ error: "server_error", detail: UPSTREAM_SECRET }, { status: 500 }));
    const protocol = createChatGptPlanProtocol({ fetchAdapter, clock: () => now });
    await expect(protocol.exchangeCode(attempt, `${redirectUri}?code=c&state=forged&client_id=oaiapp_x`))
      .rejects.toMatchObject({ code: "invalid_callback" });
    expect(fetchAdapter).not.toHaveBeenCalled();
    const error = await protocol.exchangeCode(attempt, `${redirectUri}?code=c&state=${attempt.state}&client_id=oaiapp_x`).catch((e) => e);
    expect(error).toMatchObject({ code: "request_failed", status: 500 });
    expect(String(error.message)).not.toContain(UPSTREAM_SECRET);
  });

  it("cancels the loopback at its deadline without finishing the authorization", async () => {
    const { startChatGptPlanLoopback } = await import("../../src/lib/oauth/chatgptPlanLoopback.js");
    const accounts = {
      beginAuthorization: vi.fn(async () => ({ handle: {}, authorizationUrl: "https://auth.openai.com/api/accounts/authorize?x=1" })),
      finishAuthorization: vi.fn(),
    };
    await expect(startChatGptPlanLoopback(accounts, { timeoutMs: 600_001 })).rejects.toThrow("Invalid authorization timeout");
    expect(accounts.beginAuthorization).not.toHaveBeenCalled();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const flow = await startChatGptPlanLoopback(accounts, { timeoutMs: 1_000 });
    vi.advanceTimersByTime(1_000);
    await expect(flow.result).rejects.toThrow("Authorization cancelled");
    expect(accounts.finishAuthorization).not.toHaveBeenCalled();
  });
});

describe("dead Codex CLI service path", () => {
  it("cannot load: its server-credential module and save route are absent", async () => {
    await expect(import("../../src/lib/oauth/services/codex.js")).rejects.toThrow();
    expect(mocks.open).not.toHaveBeenCalled();
  });
});

// Staging only. Everything below describes the unregistered helper and the
// production slots it closes; the frozen manifest retains its staging label.
describe("Codex parity exports and registered web slots", () => {
  it("lists exactly the exports the module provides", async () => {
    const helper = await import("../../src/lib/oauth/providerParity/codex/index.js");
    const registration = JSON.parse(readFileSync(new URL("../../src/lib/oauth/providerParity/codex/registration.json", import.meta.url), "utf8"));
    expect(Object.keys(helper).sort()).toEqual([...registration.exports].sort());
    expect(registration.status).toBe("staged");
  });

  it("adds prompt=login, on production authorize URLs", async () => {
    const { withCodexAuthorizeDelta } = await import("../../src/lib/oauth/providerParity/codex/index.js");
    const { generateAuthData } = await import("../../src/lib/oauth/providers.js");
    const { authUrl } = await generateAuthData("codex", "http://localhost:1455/auth/callback", null, null);
    expect(new URL(authUrl).searchParams.get("prompt")).toBe("login");
    const staged = new URL(withCodexAuthorizeDelta(authUrl));
    expect(staged.searchParams.get("prompt")).toBe("login");
    expect(staged.searchParams.get("state")).toBe(new URL(authUrl).searchParams.get("state"));
    expect(new URL(withCodexAuthorizeDelta(staged.href)).searchParams.getAll("prompt")).toEqual(["login"]);
  });

  it("builds the form refresh both sources send, through production refresh", async () => {
    const { buildCodexRefreshRequest } = await import("../../src/lib/oauth/providerParity/codex/index.js");
    const omni = buildCodexRefreshRequest({ refreshToken: "rt", clientId: CLIENT_ID });
    expect(omni.url).toBe("https://auth.openai.com/oauth/token");
    expect(omni.init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(omni.init.body))).toEqual({
      client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: "rt",
    });
    const cpa = buildCodexRefreshRequest({ refreshToken: "rt", clientId: CLIENT_ID, scope: "openid profile email" });
    expect(new URLSearchParams(cpa.init.body).get("scope")).toBe("openid profile email");
    expect(() => buildCodexRefreshRequest({ clientId: CLIENT_ID })).toThrow();

    mocks.proxyAwareFetch.mockResolvedValue(jsonResponse({ access_token: "a", refresh_token: "b", expires_in: 1 }));
    const { refreshCodexToken } = await import("../../open-sse/services/tokenRefresh/providers.js");
    await refreshCodexToken("rt-staging-probe", null, null);
    const [url, init] = mocks.proxyAwareFetch.mock.calls[0];
    expect(url).toBe(CODEX_CONFIG.tokenUrl);
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("reduces device poll failures to a fixed message, on the public route", async () => {
    const { codexDevicePollError } = await import("../../src/lib/oauth/providerParity/codex/index.js");
    expect(codexDevicePollError(500)).toEqual({
      error: "device_token_failed", error_description: "Codex device authorization failed (HTTP 500)",
    });
    expect(codexDevicePollError("x").error_description).toContain("HTTP 0");

    routeUpstream({
      [DEVICE_USER_CODE_URL]: jsonResponse({ device_auth_id: "dev-leak", user_code: "L" }),
      [DEVICE_TOKEN_URL]: jsonResponse(`boom ${UPSTREAM_SECRET}`, 500),
    });
    const started = await postRoute("codex", "device-code", { proxyMode: "direct" });
    const failed = await postRoute("codex", "poll", { flowId: started.body.flowId });
    expect(failed.body.errorDescription).toBe("Codex device authorization failed (HTTP 500)");
    expect(JSON.stringify(failed.body)).not.toContain(UPSTREAM_SECRET);
  });

  it("fails unsupported login modes before any network call", async () => {
    const { assertCodexLoginMode } = await import("../../src/lib/oauth/providerParity/codex/index.js");
    expect(assertCodexLoginMode()).toBe("browser");
    expect(assertCodexLoginMode("device")).toBe("device");
    for (const mode of ["siwc", "api_key", 1]) expect(() => assertCodexLoginMode(mode)).toThrow(/Unsupported/);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
