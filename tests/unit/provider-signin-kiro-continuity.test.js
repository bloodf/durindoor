/**
 * Kiro sign-in and request parity (#2034).
 *
 * Closed network: every outbound call goes through one recording transport.
 * Real provider services, route handlers, refresh and catalog code run; only
 * the transport, the connection store and the outbound-proxy bootstrap are
 * replaced. All tokens are synthetic.
 *
 * Source: OmniRoute b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523 (MIT). CLIProxyAPI
 * dbe641f286a489ecb39e3c041c554371e6add864 and EasyCLIProxyAPI
 * 29567ead8164a00724dfdc2087f02a23895636ee carry no in-tree Kiro provider.
 */
import { crc32 } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({ calls: [], routes: [] }));
const db = vi.hoisted(() => ({ rows: [], pools: new Map() }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (url, init = {}, proxyOptions = null) => globalThis.fetch(url, { ...init, proxyOptions }),
}));
vi.mock("next/server", () => ({
  NextResponse: { json: (body, init) => ({ status: init?.status || 200, body, json: async () => body }) },
}));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: async () => {} }));
vi.mock("@/lib/localDb", () => ({
  createProviderConnection: async (data, options = {}) => {
    if (options.shouldCommit && !options.shouldCommit()) throw new Error("OAuth flow was cancelled or superseded before commit");
    const row = { id: `conn-${db.rows.length + 1}`, ...data };
    db.rows.push(row);
    return row;
  },
  getProviderConnectionById: async (id) => db.rows.find((row) => row.id === id) || null,
  updateProviderConnection: async () => { throw new Error("unexpected update"); },
  getProxyPoolById: async (id) => db.pools.get(id) || null,
}));
vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(async () => {}), trackPendingRequest: vi.fn() }));

import { KiroService } from "../../src/lib/oauth/services/kiro.js";
import { pollForToken, requestDeviceCode } from "../../src/lib/oauth/providers.js";
import { clearOAuthFlowsForTests } from "../../src/lib/oauth/flowStore.js";
import { refreshKiroToken } from "../../open-sse/services/tokenRefresh.js";
import { clearKiroModelCache, resolveKiroModels } from "../../open-sse/services/kiroModels.js";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";
import { claudeToKiroRequest } from "../../open-sse/translator/request/claude-to-kiro.js";

const SECRET_BODY = "UPSTREAM-SECRET-BODY-7f3a";
const ARN_A = "arn:aws:codewhisperer:us-east-1:111111111111:profile/ACCOUNTA";
const ARN_B = "arn:aws:codewhisperer:eu-central-1:222222222222:profile/ACCOUNTB";
const DIRECT = { disableEnvProxy: true, strictProxy: false };

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const req = (body) => ({ json: async () => body });
const bodyOf = (call) => (typeof call.init.body === "string" ? JSON.parse(call.init.body) : call.init.body);
const header = (call, name) => {
  const headers = call.init.headers || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
};

/** Route `[predicate, responder]`; an unmatched URL fails the test. */
function route(match, respond) {
  net.routes.push([match, respond]);
}

beforeEach(() => {
  net.calls.length = 0;
  net.routes.length = 0;
  db.rows.length = 0;
  db.pools.clear();
  clearOAuthFlowsForTests();
  clearKiroModelCache();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init = {}) => {
    const url = String(input);
    const call = { url, init };
    net.calls.push(call);
    const hit = net.routes.find(([match]) => (typeof match === "string" ? url === match : match(url, call)));
    if (!hit) throw new Error(`Unexpected outbound request: ${url}`);
    return hit[1](call);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Builder ID / IAM Identity Center device sign-in", () => {
  it("keeps client registration, region, egress and profile per concurrent account", async () => {
    const proxyA = { ...DIRECT };
    const proxyB = { connectionProxyEnabled: true, connectionProxyUrl: "http://pool-b.test:8080", strictProxy: true, disableEnvProxy: true };
    for (const [region, tag] of [["us-east-1", "a"], ["eu-central-1", "b"]]) {
      route(`https://oidc.${region}.amazonaws.com/client/register`, () => json({ clientId: `client-${tag}`, clientSecret: `secret-${tag}` }));
      route(`https://oidc.${region}.amazonaws.com/device_authorization`, () => json({ deviceCode: `device-${tag}`, userCode: `USER-${tag}`, verificationUriComplete: `https://verify.test/${tag}`, interval: 5 }));
    }
    const polls = { a: 0, b: 0 };
    route((url) => url.endsWith(".amazonaws.com/token"), (call) => {
      const { clientId, deviceCode, grantType } = bodyOf(call);
      const tag = clientId.slice(-1);
      expect(deviceCode).toBe(`device-${tag}`);
      expect(grantType).toBe("urn:ietf:params:oauth:grant-type:device_code");
      polls[tag] += 1;
      if (polls[tag] === 1) return json({ error: "authorization_pending" }, 400);
      if (polls[tag] === 2) return json({ error: "slow_down" }, 400);
      return json({ accessToken: `access-${tag}`, refreshToken: `aorAAAAAG-refresh-${tag}`, expiresIn: 3600 });
    });
    route("https://codewhisperer.us-east-1.amazonaws.com", () => json({ profiles: [{ arn: ARN_A }] }));
    route("https://q.eu-central-1.amazonaws.com", () => json({ profiles: [{ arn: ARN_B }] }));

    const [devA, devB] = await Promise.all([
      requestDeviceCode("kiro", null, {}, proxyA),
      requestDeviceCode("kiro", null, { authMethod: "idc", region: "eu-central-1", startUrl: "https://corp.awsapps.com/start" }, proxyB),
    ]);
    expect(devA).toMatchObject({ user_code: "USER-a", _clientId: "client-a", _region: "us-east-1", _authMethod: "builder-id" });
    expect(devB).toMatchObject({ user_code: "USER-b", _clientId: "client-b", _region: "eu-central-1", _authMethod: "idc" });

    const poll = (dev, proxy) => pollForToken("kiro", dev.device_code, null, dev, proxy);
    // The device poll route keeps polling on these two codes and slows down on slow_down.
    for (const error of ["authorization_pending", "slow_down"]) {
      const [a, b] = await Promise.all([poll(devA, proxyA), poll(devB, proxyB)]);
      expect(a).toMatchObject({ success: false, error });
      expect(b).toMatchObject({ success: false, error });
    }
    const [a, b] = await Promise.all([poll(devA, proxyA), poll(devB, proxyB)]);
    expect(a.tokens).toMatchObject({ accessToken: "access-a", providerSpecificData: { clientId: "client-a", clientSecret: "secret-a", region: "us-east-1", authMethod: "builder-id", profileArn: ARN_A } });
    expect(b.tokens).toMatchObject({ accessToken: "access-b", providerSpecificData: { clientId: "client-b", clientSecret: "secret-b", region: "eu-central-1", authMethod: "idc", startUrl: "https://corp.awsapps.com/start", profileArn: ARN_B } });

    // Every call of an account used that account's egress and, after sign-in, its bearer.
    for (const call of net.calls) {
      const isB = call.url.includes("eu-central-1");
      expect(call.init.proxyOptions).toBe(isB ? proxyB : proxyA);
      if (call.url.includes("codewhisperer") || call.url.startsWith("https://q.")) {
        expect(header(call, "Authorization")).toBe(`Bearer access-${isB ? "b" : "a"}`);
      }
    }
    expect(bodyOf(net.calls.find((c) => c.url === "https://oidc.eu-central-1.amazonaws.com/client/register"))).not.toHaveProperty("issuerUrl");
    expect(bodyOf(net.calls.find((c) => c.url === "https://oidc.us-east-1.amazonaws.com/client/register")).issuerUrl).toMatch(/^https:\/\/identitycenter\.amazonaws\.com\//);
  });

  it("rejects a malformed region before any network call", async () => {
    await expect(requestDeviceCode("kiro", null, { region: "us-east-1.evil.test" })).rejects.toThrow();
    await expect(new KiroService().registerClient("../169.254.169.254")).rejects.toThrow(/region/i);
    expect(net.calls).toHaveLength(0);
  });

  it("reports registration failure without the upstream body", async () => {
    route("https://oidc.us-east-1.amazonaws.com/client/register", () => json({ error: "invalid_client_metadata", detail: SECRET_BODY }, 400));
    const error = await new KiroService().registerClient("us-east-1").catch((e) => e);
    expect(error.message).toBe("Failed to register client: HTTP 400 (invalid_client_metadata)");
    expect(error.message).not.toContain(SECRET_BODY);
  });
});

describe("Google/GitHub social sign-in through the real routes", () => {
  const SOCIAL = "https://prod.us-east-1.auth.desktop.kiro.dev";

  async function routes() {
    const { POST: authorize } = await import("../../src/app/api/oauth/kiro/social-authorize/route.js");
    const { POST: exchange } = await import("../../src/app/api/oauth/kiro/social-exchange/route.js");
    return { authorize, exchange };
  }

  it("polls two device accounts with their own egress and saves each exactly once", async () => {
    db.pools.set("pool-b", { id: "pool-b", isActive: true, proxyUrl: "http://pool-b.test:8080" });
    route(`${SOCIAL}/oauth/device/authorization`, (call) => {
      const { clientId, loginProvider } = bodyOf(call);
      expect(clientId).toBe("kiro-cli");
      const tag = loginProvider === "Google" ? "g" : "h";
      return json({ deviceCode: `server-device-${tag}`, userCode: `CODE-${tag}`, verificationUriComplete: `https://verify.test/${tag}`, expiresInMilliseconds: 600000, intervalInMilliseconds: 5000 });
    });
    const seen = { g: 0, h: 0 };
    route(`${SOCIAL}/oauth/device/poll`, (call) => {
      const tag = bodyOf(call).deviceCode.slice(-1);
      seen[tag] += 1;
      if (seen[tag] === 1) return json({ status: "authorization_pending" });
      return json({ accessToken: jwt({ email: `${tag}@example.test` }), refreshToken: `social-refresh-${tag}`, profileArn: ARN_A, expiresIn: 3600 });
    });

    const { authorize, exchange } = await routes();
    const [g, h] = await Promise.all([
      authorize(req({ provider: "google", mode: "device", proxyMode: "direct" })),
      authorize(req({ provider: "github", mode: "device", proxyMode: "strict-pool", proxyPoolId: "pool-b" })),
    ]);
    expect(g.body).toMatchObject({ userCode: "CODE-g", interval: 5, provider: "google" });
    expect(h.body).toMatchObject({ userCode: "CODE-h", interval: 5, provider: "github" });
    expect(g.body).not.toHaveProperty("deviceCode");

    const sel = (r) => ({ flowId: r.body.flowId, state: r.body.state, deviceCode: "attacker-device" });
    const pending = await Promise.all([exchange(req(sel(g))), exchange(req(sel(h)))]);
    for (const r of pending) expect(r.body).toEqual({ success: false, pending: true, error: "authorization_pending" });
    expect(db.rows).toHaveLength(0);

    const done = await Promise.all([exchange(req(sel(g))), exchange(req(sel(h)))]);
    for (const r of done) expect(r.body.success).toBe(true);
    const callsAfterAccept = net.calls.length;
    const replays = await Promise.all([exchange(req(sel(g))), exchange(req(sel(h)))]);
    for (const r of replays) expect(r.status).toBe(400);
    expect(net.calls).toHaveLength(callsAfterAccept);
    expect(db.rows).toHaveLength(2);

    const rowG = db.rows.find((r) => r.email === "g@example.test");
    const rowH = db.rows.find((r) => r.email === "h@example.test");
    expect(rowG).toMatchObject({ refreshToken: "social-refresh-g", providerSpecificData: { authMethod: "google", oauthProxy: { mode: "direct", poolId: null } } });
    expect(rowH).toMatchObject({ refreshToken: "social-refresh-h", providerSpecificData: { authMethod: "github", proxyPoolId: "pool-b", oauthProxy: { mode: "strict-pool", poolId: "pool-b" } } });

    for (const call of net.calls) {
      const isG = call.url.endsWith("/poll") ? bodyOf(call).deviceCode.endsWith("g") : bodyOf(call).loginProvider === "Google";
      expect(call.init.proxyOptions).toMatchObject(isG ? DIRECT : { strictProxy: true, connectionProxyUrl: "http://pool-b.test:8080", proxyPoolId: "pool-b" });
      if (call.url.endsWith("/poll")) expect(bodyOf(call).deviceCode).not.toBe("attacker-device");
    }
  });

  it("supersedes only the same owner's flow and claims a poll once during concurrent exchange", async () => {
    route(`${SOCIAL}/oauth/device/authorization`, () => json({ deviceCode: "owned-device", verificationUriComplete: "https://verify.test", userCode: "U" }));
    let finishPoll;
    route(`${SOCIAL}/oauth/device/poll`, () => new Promise((resolve) => { finishPoll = resolve; }));
    const { authorize, exchange } = await routes();
    const start = (ownerId) => authorize(req({ ownerId, provider: "google", mode: "device", proxyMode: "direct" }));
    const oldA = await start("owner-a");
    const b = await start("owner-b");
    const a = await start("owner-a");
    const select = (response) => ({ flowId: response.body.flowId, state: response.body.state });
    expect((await exchange(req(select(oldA)))).status).toBe(400);
    const first = exchange(req(select(b)));
    await vi.waitFor(() => expect(finishPoll).toBeTypeOf("function"));
    expect((await exchange(req(select(b)))).status).toBe(400);
    finishPoll(json({ accessToken: jwt({ email: "owner-b@example.test" }), refreshToken: "owned-refresh", expiresIn: 60 }));
    expect((await first).body.success).toBe(true);
    expect(db.rows).toHaveLength(1);
    expect(net.calls.filter((call) => call.url.endsWith("/poll"))).toHaveLength(1);
    // The replacement remains active independently of owner B's completed flow.
    const second = exchange(req(select(a)));
    await vi.waitFor(() => expect(net.calls.filter((call) => call.url.endsWith("/poll"))).toHaveLength(2));
    finishPoll(json({ accessToken: jwt({ email: "owner-a@example.test" }), refreshToken: "owned-refresh-a", expiresIn: 60 }));
    expect((await second).body.success).toBe(true);
    expect(db.rows).toHaveLength(2);
  });

  it("expires a device flow on the server clock without polling upstream", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-27T00:00:00Z"));
    route(`${SOCIAL}/oauth/device/authorization`, () => json({ deviceCode: "server-device", verificationUriComplete: "https://verify.test", userCode: "U", expiresInMilliseconds: 60000, intervalInMilliseconds: 5000 }));
    const { authorize, exchange } = await routes();
    const started = await authorize(req({ provider: "github", mode: "device", proxyMode: "direct" }));
    vi.setSystemTime(new Date("2026-11-27T00:01:01Z"));
    const late = await exchange(req({ flowId: started.body.flowId, state: started.body.state }));
    expect(late.status).toBe(400);
    expect(net.calls.map((c) => c.url)).toEqual([`${SOCIAL}/oauth/device/authorization`]);
  });

  it("exchanges an authorization code with the server-held PKCE verifier only", async () => {
    route(`${SOCIAL}/oauth/token`, () => json({ accessToken: jwt({ email: "pkce@example.test" }), refreshToken: "social-refresh", profileArn: ARN_A, expiresIn: 1800 }));
    const { authorize, exchange } = await routes();
    const started = await authorize(req({ provider: "google", proxyMode: "direct" }));
    const auth = new URL(started.body.authUrl);
    expect(auth.origin + auth.pathname).toBe(`${SOCIAL}/login`);
    expect(auth.searchParams.get("redirect_uri")).toBe("kiro://kiro.kiroAgent/authenticate-success");
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.searchParams.get("state")).toBe(started.body.state);

    const wrongState = await exchange(req({ code: "c", state: "forged", flowId: started.body.flowId }));
    expect(wrongState.status).toBe(400);
    expect(net.calls).toHaveLength(0);

    const ok = await exchange(req({ code: "auth-code", state: started.body.state, flowId: started.body.flowId, codeVerifier: "attacker" }));
    expect(ok.body.success).toBe(true);
    const sent = bodyOf(net.calls[0]);
    expect(sent.code).toBe("auth-code");
    expect(sent.code_verifier).not.toBe("attacker");
    expect(sent.code_verifier.length).toBeGreaterThanOrEqual(43);
    expect(net.calls[0].init.proxyOptions).toEqual(DIRECT);
    expect(db.rows[0]).toMatchObject({ provider: "kiro", email: "pkce@example.test", providerSpecificData: { profileArn: ARN_A, authMethod: "google" } });
  });

  it("returns a rejected code as a code, never the upstream body", async () => {
    route(`${SOCIAL}/oauth/token`, () => json({ error: "invalid_grant", error_description: SECRET_BODY }, 400));
    const { authorize, exchange } = await routes();
    const started = await authorize(req({ provider: "github", proxyMode: "direct" }));
    const res = await exchange(req({ code: "bad", state: started.body.state, flowId: started.body.flowId }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain(SECRET_BODY);
    expect(res.body.error).toContain("invalid_grant");
    expect(db.rows).toHaveLength(0);
  });

  it("fails an unsupported social provider before network", async () => {
    await expect(new KiroService().startSocialDevice("gitlab")).rejects.toThrow(/Unsupported/);
    const { authorize } = await routes();
    expect((await authorize(req({ provider: "gitlab", mode: "device" }))).status).toBe(400);
    expect(net.calls).toHaveLength(0);
  });
});

describe("Refresh, expiry and rejection (service)", () => {
  const svc = new KiroService();

  it("refreshes each auth method at its own endpoint with its own client and egress", async () => {
    const proxy = { ...DIRECT };
    route("https://oidc.eu-central-1.amazonaws.com/token", () => json({ accessToken: "new-idc", expiresIn: 900 }));
    route("https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken", () => json({ accessToken: "new-social", refreshToken: "rotated", profileArn: ARN_A }));
    route("https://login.microsoftonline.com/tenant/oauth2/v2.0/token", () => json({ access_token: "new-entra", refresh_token: "entra-rotated", expires_in: 1200 }));

    const [idc, social, entra] = await Promise.all([
      svc.refreshToken("aorAAAAAG-idc", { authMethod: "idc", clientId: "client-b", clientSecret: "secret-b", region: "eu-central-1" }, proxy),
      svc.refreshToken("social-r", { authMethod: "imported", clientId: "unrelated", clientSecret: "unrelated" }, proxy),
      svc.refreshToken("entra-r", { authMethod: "external_idp", clientId: "app-id", tokenEndpoint: "https://login.microsoftonline.com/tenant/oauth2/v2.0/token", scope: ["api://app-id/codewhisperer:conversations", "offline_access"], profileArn: ARN_A, region: "us-east-1" }, proxy),
    ]);
    expect(idc).toMatchObject({ accessToken: "new-idc", refreshToken: "aorAAAAAG-idc", expiresIn: 900 });
    expect(social).toMatchObject({ accessToken: "new-social", refreshToken: "rotated", profileArn: ARN_A });
    expect(entra).toMatchObject({ accessToken: "new-entra", refreshToken: "entra-rotated", providerSpecificData: { authMethod: "external_idp", profileArn: ARN_A } });

    const byUrl = Object.fromEntries(net.calls.map((c) => [c.url, c]));
    expect(bodyOf(byUrl["https://oidc.eu-central-1.amazonaws.com/token"])).toEqual({ clientId: "client-b", clientSecret: "secret-b", refreshToken: "aorAAAAAG-idc", grantType: "refresh_token" });
    expect(bodyOf(byUrl["https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken"])).toEqual({ refreshToken: "social-r" });
    const form = byUrl["https://login.microsoftonline.com/tenant/oauth2/v2.0/token"].init.body;
    expect(Object.fromEntries(form)).toEqual({ grant_type: "refresh_token", client_id: "app-id", refresh_token: "entra-r", scope: "api://app-id/codewhisperer:conversations offline_access" });
    for (const call of net.calls) expect(call.init.proxyOptions).toBe(proxy);
  });

  it.each([
    ["AWS OIDC", { authMethod: "idc", clientId: "c", clientSecret: "s", region: "us-east-1" }, "https://oidc.us-east-1.amazonaws.com/token", { __type: "com.amazonaws.ssooidc#InvalidGrantException", message: SECRET_BODY }, "InvalidGrantException"],
    ["social", { authMethod: "google" }, "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken", { __type: "ExpiredTokenException", message: SECRET_BODY }, "ExpiredTokenException"],
    ["external_idp", { authMethod: "external_idp", clientId: "a", tokenEndpoint: "https://login.microsoftonline.com/t/oauth2/v2.0/token", scope: "x" }, "https://login.microsoftonline.com/t/oauth2/v2.0/token", { error: "invalid_grant", error_description: SECRET_BODY }, "invalid_grant"],
  ])("marks an expired %s grant unrecoverable without leaking the body", async (_label, psd, url, payload, upstreamCode) => {
    route(url, () => json(payload, 400));
    const error = await svc.refreshToken("dead-refresh", psd).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ status: 400, code: "unrecoverable_refresh_error", upstreamCode, unrecoverable: true });
    expect(error.message).not.toContain(SECRET_BODY);
    expect(error.message).not.toContain("dead-refresh");
  });

  it.each([SECRET_BODY, "<html>secret</html>"])("does not reflect an unrecognized upstream error identifier: %s", async (errorCode) => {
    route("https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken", () => json({ error: errorCode, error_description: SECRET_BODY }, 400));
    const error = await svc.refreshToken("synthetic-refresh", {}).catch((caught) => caught);
    expect(error).toMatchObject({ status: 400, code: null, upstreamCode: null, unrecoverable: false });
    expect(error.message).toBe("Token refresh failed");
    expect(error.message).not.toContain(SECRET_BODY);
  });

  it("keeps a transient failure recoverable and drops non-identifier codes", async () => {
    route("https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken", () => new Response(`<html>${SECRET_BODY}</html>`, { status: 503 }));
    const error = await svc.refreshToken("r", {}).catch((e) => e);
    expect(error).toMatchObject({ status: 503, code: null, unrecoverable: false });
    expect(error.message).toBe("Token refresh failed: HTTP 503");
  });

  it.each([
    ["api_key connection", "key", { authMethod: "api_key" }, /Unsupported/],
    ["empty token", "  ", {}, /refresh token is required/],
    ["bad OIDC region", "r", { authMethod: "idc", clientId: "c", clientSecret: "s", region: "evil.test/x" }, /region/i],
    ["non-allowlisted IdP", "r", { authMethod: "external_idp", clientId: "a", scope: "x", tokenEndpoint: "https://idp.evil.test/token" }, /Microsoft/],
  ])("fails %s before network", async (_label, token, psd, message) => {
    await expect(svc.refreshToken(token, psd)).rejects.toThrow(message);
    expect(net.calls).toHaveLength(0);
  });

  it("deduplicates concurrent runtime refreshes of one grant but not of two accounts", async () => {
    let n = 0;
    route("https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken", async (call) => {
      n += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return json({ accessToken: `fresh-${bodyOf(call).refreshToken}`, expiresIn: 3600, profileArn: ARN_A });
    });
    const psd = { authMethod: "google", profileArn: ARN_A };
    const proxyB = { strictProxy: true, connectionProxyUrl: "http://pool-b.test:8080" };
    const [a1, a2, b] = await Promise.all([
      refreshKiroToken("grant-a", psd, null, DIRECT),
      refreshKiroToken("grant-a", psd, null, DIRECT),
      refreshKiroToken("grant-b", psd, null, proxyB),
    ]);
    expect(n).toBe(2);
    expect(a1.accessToken).toBe("fresh-grant-a");
    expect(a2.accessToken).toBe("fresh-grant-a");
    expect(b.accessToken).toBe("fresh-grant-b");
    const callB = net.calls.find((c) => bodyOf(c).refreshToken === "grant-b");
    expect(callB.init.proxyOptions).toBe(proxyB);
  });
});

describe("Kiro CLI token import", () => {
  it("imports a CLIProxyAPI external_idp auth file without network and keeps its profile ARN", async () => {
    const { POST } = await import("../../src/app/api/oauth/kiro/import-cli-proxy/route.js");
    const res = await POST(req({
      auth_method: "external_idp",
      access_token: jwt({ upn: "user@corp.example", exp: 1893456000 }),
      refresh_token: "entra-refresh",
      client_id: "app-id",
      token_endpoint: "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
      scopes: ["api://app-id/codewhisperer:conversations"],
      profile_arn: ARN_B,
      region: "eu-central-1",
    }));
    expect(res.status).toBe(200);
    expect(net.calls).toHaveLength(0);
    expect(db.rows[0]).toMatchObject({ email: "user@corp.example", expiresAt: "2030-01-01T00:00:00.000Z", providerSpecificData: { authMethod: "external_idp", profileArn: ARN_B, region: "eu-central-1", clientId: "app-id" } });
  });

  it("rejects non-Microsoft, non-https and incomplete auth files before network", async () => {
    const { POST } = await import("../../src/app/api/oauth/kiro/import-cli-proxy/route.js");
    const base = { auth_method: "external_idp", access_token: "a", refresh_token: "r", client_id: "c", scopes: "s", profile_arn: ARN_A };
    for (const patch of [
      { token_endpoint: "https://idp.evil.test/token" },
      { token_endpoint: "http://login.microsoftonline.com/t/token" },
      { token_endpoint: "https://login.microsoftonline.com/t/token", profile_arn: "" },
      { token_endpoint: "https://login.microsoftonline.com/t/token", auth_method: "social" },
    ]) {
      expect((await POST(req({ ...base, ...patch }))).status).toBe(400);
    }
    expect(net.calls).toHaveLength(0);
    expect(db.rows).toHaveLength(0);
  });

  it("imports an IDC refresh token on its regional endpoint and never reflects a rejection body", async () => {
    route("https://oidc.eu-central-1.amazonaws.com/token", (call) => (bodyOf(call).refreshToken === "aorAAAAAG-good" ?
      json({ accessToken: "imported-access", expiresIn: 3600 }) :
      json({ error: "invalid_grant", detail: SECRET_BODY }, 400)));
    const { POST } = await import("../../src/app/api/oauth/kiro/import/route.js");
    const ok = await POST(req({ refreshToken: "aorAAAAAG-good", clientId: "c", clientSecret: "s", region: "eu-central-1", profileArn: ARN_B }));
    expect(ok.status).toBe(200);
    expect(db.rows[0]).toMatchObject({ accessToken: "imported-access", providerSpecificData: { authMethod: "idc", clientId: "c", region: "eu-central-1", profileArn: ARN_B } });
    const bad = await POST(req({ refreshToken: "aorAAAAAG-bad", clientId: "c", clientSecret: "s", region: "eu-central-1" }));
    expect(bad.status).toBe(500);
    expect(JSON.stringify(bad.body)).not.toContain(SECRET_BODY);
    expect(db.rows).toHaveLength(1);
  });
});

describe("API key sign-in", () => {
  const MODELS = (region) => `https://q.${region}.amazonaws.com/ListAvailableModels?origin=AI_EDITOR`;

  it("validates with the selected egress, stores it, and submits a double click once", async () => {
    db.pools.set("pool-k", { id: "pool-k", isActive: true, proxyUrl: "http://pool-k.test:8080" });
    route(MODELS("eu-central-1"), async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return json({ models: [] });
    });
    route("https://q.eu-central-1.amazonaws.com", () => json({}, 403));
    route("https://codewhisperer.us-east-1.amazonaws.com", () => json({}, 403));
    const { POST } = await import("../../src/app/api/oauth/kiro/api-key/route.js");
    const body = { apiKey: "ksk_synthetic_key", region: "eu-central-1", proxyMode: "strict-pool", proxyPoolId: "pool-k" };
    const [first, second] = await Promise.all([POST(req(body)), POST(req(body))]);
    expect(first.body).toEqual(second.body);
    expect(db.rows).toHaveLength(1);
    expect(net.calls.filter((c) => c.url.includes("ListAvailableModels"))).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ authType: "api_key", refreshToken: null, providerSpecificData: { authMethod: "api_key", region: "eu-central-1", profileArn: null, proxyPoolId: "pool-k", oauthProxy: { mode: "strict-pool", poolId: "pool-k" } } });
    for (const call of net.calls) {
      expect(call.init.proxyOptions).toMatchObject({ strictProxy: true, proxyPoolId: "pool-k" });
      expect(header(call, "tokentype")).toBe("API_KEY");
      expect(header(call, "Authorization")).toBe("Bearer ksk_synthetic_key");
    }
  });

  it("refuses an unknown proxy pool and a malformed region before network", async () => {
    const { POST } = await import("../../src/app/api/oauth/kiro/api-key/route.js");
    expect((await POST(req({ apiKey: "k", proxyMode: "strict-pool", proxyPoolId: "missing" }))).body).toEqual({ error: "Invalid proxy selection" });
    expect((await POST(req({ apiKey: "k", region: "us-east-1.evil.test" }))).status).toBe(400);
    expect((await POST(req({ apiKey: "k", region: "ap-south-1" }))).status).toBe(500);
    expect(net.calls).toHaveLength(0);
    expect(db.rows).toHaveLength(0);
  });

  it("reports a rejected key generically", async () => {
    route(MODELS("us-east-1"), () => json({ message: SECRET_BODY }, 403));
    route(MODELS("eu-central-1"), () => json({ message: SECRET_BODY }, 403));
    const { POST } = await import("../../src/app/api/oauth/kiro/api-key/route.js");
    const res = await POST(req({ apiKey: "rejected" }));
    expect(res).toMatchObject({ status: 500, body: { error: "API key validation failed" } });
    expect(db.rows).toHaveLength(0);
  });
});

describe("Model discovery and request/stream translation per account", () => {
  const accounts = {
    a: { accessToken: "bearer-a", refreshToken: "refresh-a", providerSpecificData: { authMethod: "idc", region: "us-east-1", profileArn: ARN_A } },
    b: { accessToken: "bearer-b", refreshToken: "refresh-b", providerSpecificData: { authMethod: "external_idp", region: "eu-central-1", profileArn: ARN_B } },
  };

  it("lists models with each account's bearer, profile and egress", async () => {
    route((url) => url.includes("/ListAvailableModels"), (call) => {
      const tag = header(call, "Authorization").slice(-1);
      return json({ models: [{ modelId: `claude-sonnet-4.${tag === "a" ? 5 : 6}`, modelName: "Claude", tokenLimits: { maxInputTokens: 200000 } }] });
    });
    const proxyB = { strictProxy: true, connectionProxyUrl: "http://pool-b.test:8080" };
    const [ma, mb] = await Promise.all([
      resolveKiroModels(accounts.a, { proxyOptions: DIRECT }),
      resolveKiroModels(accounts.b, { proxyOptions: proxyB }),
    ]);
    expect(ma.rawModels[0].modelId).toBe("claude-sonnet-4.5");
    expect(mb.rawModels[0].modelId).toBe("claude-sonnet-4.6");
    const [ca, cb] = ["a", "b"].map((t) => net.calls.find((c) => header(c, "Authorization") === `Bearer bearer-${t}`));
    expect(new URL(ca.url).searchParams.get("profileArn")).toBe(ARN_A);
    expect(new URL(cb.url).host).toBe("q.eu-central-1.amazonaws.com");
    expect(new URL(cb.url).searchParams.get("profileArn")).toBe(ARN_B);
    expect(ca.init.proxyOptions).toBe(DIRECT);
    expect(cb.init.proxyOptions).toBe(proxyB);
  });

  it("keeps direct Claude tools and thinking while binding each account's identity", () => {
    const body = {
      thinking: { type: "enabled", budget_tokens: 4096 },
      tools: [{ name: "read_file", description: "Read", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }],
      messages: [
        { role: "user", content: "read a" },
        { role: "assistant", content: [{ type: "thinking", thinking: "plan", signature: "sig" }, { type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "/a" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "A" }] },
      ],
    };
    const executor = new KiroExecutor("kiro");
    for (const [tag, creds] of Object.entries(accounts)) {
      const payload = claudeToKiroRequest("claude-sonnet-4.5", structuredClone(body), true, creds);
      const current = payload.conversationState.currentMessage.userInputMessage;
      expect(payload.profileArn).toBe(creds.providerSpecificData.profileArn);
      expect(current.userInputMessageContext.tools[0].toolSpecification).toMatchObject({ name: "read_file", inputSchema: { json: { required: ["path"] } } });
      expect(current.userInputMessageContext.toolResults).toEqual([{ toolUseId: "toolu_1", status: "success", content: [{ text: "A" }] }]);
      expect(payload.conversationState.history[1].assistantResponseMessage.toolUses[0]).toMatchObject({ toolUseId: "toolu_1", name: "read_file", input: { path: "/a" } });
      expect(JSON.stringify(payload)).toContain("<thinking_mode>enabled</thinking_mode>");
      const headers = executor.buildHeaders(creds);
      expect(headers.Authorization).toBe(`Bearer bearer-${tag}`);
      expect(headers.TokenType).toBe(tag === "b" ? "EXTERNAL_IDP" : undefined);
    }
    expect(executor.getOrderedBaseUrls(accounts.b)[0]).toBe("https://q.eu-central-1.amazonaws.com/generateAssistantResponse");
  });

  it("translates an EventStream reply with reasoning, text and a tool call", async () => {
    const frame = (eventType, payload) => {
      const enc = new TextEncoder();
      const name = enc.encode(":event-type");
      const value = enc.encode(eventType);
      const data = enc.encode(JSON.stringify(payload));
      const headerLength = 1 + name.length + 1 + 2 + value.length;
      const total = 12 + headerLength + data.length + 4;
      const out = new Uint8Array(total);
      const view = new DataView(out.buffer);
      view.setUint32(0, total);
      view.setUint32(4, headerLength);
      view.setUint32(8, crc32(out.subarray(0, 8)));
      let o = 12;
      out[o++] = name.length; out.set(name, o); o += name.length;
      out[o++] = 7; view.setUint16(o, value.length); o += 2;
      out.set(value, o); o += value.length;
      out.set(data, o);
      view.setUint32(total - 4, crc32(out.subarray(0, total - 4)));
      return out;
    };
    const frames = [
      frame("reasoningContentEvent", { text: "thinking about it" }),
      frame("assistantResponseEvent", { content: "Reading." }),
      frame("toolUseEvent", { toolUseId: "toolu_9", name: "read_file", input: { path: "/b" } }),
      frame("messageStopEvent", {}),
    ];
    const body = new ReadableStream({ start(c) { for (const f of frames) c.enqueue(f); c.close(); } });
    const sse = await new Response(new KiroExecutor("kiro").transformEventStreamToSSE({ body }, "claude-sonnet-4.5").body).text();
    const chunks = sse.split("\n").filter((l) => l.startsWith("data: {")).map((l) => JSON.parse(l.slice(6)));
    const deltas = chunks.map((c) => c.choices?.[0]?.delta || {});
    expect(deltas.map((d) => d.reasoning_content || "").join("")).toBe("thinking about it");
    expect(deltas.map((d) => d.content || "").join("")).toBe("Reading.");
    const call = deltas.flatMap((d) => d.tool_calls || []);
    expect(call[0]).toMatchObject({ id: "toolu_9", function: { name: "read_file" } });
    expect(JSON.parse(call.map((c) => c.function?.arguments || "").join(""))).toEqual({ path: "/b" });
    expect(chunks.at(-1).choices[0].finish_reason).toBe("tool_calls");
  });
});
