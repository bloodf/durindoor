import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Antigravity OAuth client profiles driven through the real authorize/exchange
// route, flow completion and refresh entry points. Storage is a temporary
// local DB and every HTTP call is mocked: this proves the request contract,
// not that Google accepts it.
//
// The built-in pair is the public Antigravity desktop client from CLIProxyAPI
// internal/auth/antigravity/constants.go @ 47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e.
const DESKTOP_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const DESKTOP_SECRET = "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";
const DESKTOP_REDIRECT = "http://localhost:51121/oauth-callback";
const SIX_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/aicode",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs"
];
const CUSTOM_ID = "synthetic-custom.apps.example.test";
const CUSTOM_SECRET = "synthetic-custom-secret-value";
const REMOTE_CALLBACK = "https://gate.example.test/callback";
const LOCAL_CALLBACK = "http://localhost:20128/callback";
const bindingOf = (id) => `v1:${createHash("sha256").update(id).digest("hex")}`;
const s256 = (verifier) => createHash("sha256").update(verifier).digest("base64url");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-default-profile-"));
const previous = { ...process.env };
process.env.DATA_DIR = dir;
delete process.env.ANTIGRAVITY_OAUTH_CLIENT_ID;
delete process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET;
const expired = () => new Date(Date.now() - 60_000).toISOString();
fs.writeFileSync(path.join(dir, "db.json"), JSON.stringify({
  providerConnections: [{
    id: "legacy-ag", provider: "antigravity", authType: "oauth", email: "legacy@example.test",
    accessToken: "legacy-old", refreshToken: "legacy-refresh", projectId: "legacy-project",
    expiresAt: expired(), isActive: true
  }]
}));

vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => Response.json(body, init) } }));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: async () => {} }));
const outbound = vi.hoisted(() => ({ calls: [], email: "user@example.test", seq: 0 }));
async function providerFetch(input, init = {}) {
  const url = String(input);
  outbound.calls.push({ url, init });
  if (url.includes("oauth2.googleapis.com/token")) {
    outbound.seq += 1;
    return Response.json({ access_token: `access-${outbound.seq}`, refresh_token: `refresh-${outbound.seq}`, expires_in: 3600, scope: "granted" });
  }
  if (url.includes("userinfo")) return Response.json({ email: outbound.email, id: `sub-${outbound.email}` });
  if (url.includes(":loadCodeAssist")) return Response.json({ cloudaicompanionProject: "project-x", allowedTiers: [{ id: "free-tier", isDefault: true }] });
  throw new Error(`Unexpected outbound URL: ${url}`);
}
vi.mock("open-sse/utils/proxyFetch.js", async (original) => ({
  ...(await original()),
  proxyAwareFetch: (...args) => providerFetch(...args)
}));

let m;
async function useEnv(env) {
  vi.resetModules();
  delete process.env.ANTIGRAVITY_OAUTH_CLIENT_ID;
  delete process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET;
  Object.assign(process.env, env);
  vi.stubGlobal("fetch", providerFetch);
  m = {
    shared: await import("open-sse/providers/shared.js"),
    route: await import("@/app/api/oauth/[provider]/[action]/route.js"),
    db: await import("@/lib/localDb"),
    creds: await import("@/shared/services/providerCredentials.js"),
    flowStore: await import("@/lib/oauth/flowStore.js")
  };
  vi.stubGlobal("fetch", providerFetch);
}
beforeAll(() => useEnv({}), 120_000);
afterAll(() => { vi.unstubAllGlobals(); process.env = previous; fs.rmSync(dir, { recursive: true, force: true }); });

async function post(action, body) {
  return m.route.POST(new Request(`http://localhost/api/oauth/antigravity/${action}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  }), { params: Promise.resolve({ provider: "antigravity", action }) });
}
const tokenCalls = () => outbound.calls.filter((c) => c.url.includes("oauth2.googleapis.com/token"));
const form = (call) => Object.fromEntries(new URLSearchParams(String(call.init.body)));
const row = (id) => m.db.getProviderConnectionById(id);

async function authorize(redirectUri, extra = {}) {
  const response = await post("authorize", { redirectUri, proxyMode: "direct", ...extra });
  const text = await response.text();
  return { response, text, body: JSON.parse(text) };
}
async function signIn(redirectUri, email, extra = {}) {
  outbound.email = email;
  const start = await authorize(redirectUri, extra);
  expect(start.response.status, start.text).toBe(200);
  outbound.calls.length = 0;
  const done = await post("exchange", { code: `code-${email}`, state: start.body.state, flowId: start.body.flowId });
  const body = await done.json();
  expect(done.status, JSON.stringify(body)).toBe(200);
  return { start, connectionId: body.connection.id, exchange: form(tokenCalls()[0]) };
}

describe("profile resolution", () => {
  it("uses the desktop pair only when both overrides are absent", () => {
    const resolve = m.shared.resolveAntigravityOAuthClient;
    expect(resolve({})).toMatchObject({ profile: "desktop", clientId: DESKTOP_ID, clientSecret: DESKTOP_SECRET, configError: null });
    expect(resolve({ ANTIGRAVITY_OAUTH_CLIENT_ID: ` ${CUSTOM_ID} `, ANTIGRAVITY_OAUTH_CLIENT_SECRET: CUSTOM_SECRET }))
      .toMatchObject({ profile: "custom", clientId: CUSTOM_ID, clientSecret: CUSTOM_SECRET });
    for (const env of [
      { ANTIGRAVITY_OAUTH_CLIENT_ID: "", ANTIGRAVITY_OAUTH_CLIENT_SECRET: "" },
      { ANTIGRAVITY_OAUTH_CLIENT_ID: "  ", ANTIGRAVITY_OAUTH_CLIENT_SECRET: CUSTOM_SECRET },
      { ANTIGRAVITY_OAUTH_CLIENT_ID: CUSTOM_ID },
      { ANTIGRAVITY_OAUTH_CLIENT_SECRET: CUSTOM_SECRET },
      { ANTIGRAVITY_OAUTH_CLIENT_ID: "" },
      { ANTIGRAVITY_OAUTH_CLIENT_SECRET: "" },
      { ANTIGRAVITY_OAUTH_CLIENT_ID: CUSTOM_ID, ANTIGRAVITY_OAUTH_CLIENT_SECRET: " \t " },
      { ANTIGRAVITY_OAUTH_CLIENT_ID: 42, ANTIGRAVITY_OAUTH_CLIENT_SECRET: CUSTOM_SECRET },
      { ANTIGRAVITY_OAUTH_CLIENT_ID: CUSTOM_ID, ANTIGRAVITY_OAUTH_CLIENT_SECRET: { value: CUSTOM_SECRET } },
      { ANTIGRAVITY_OAUTH_CLIENT_ID: null, ANTIGRAVITY_OAUTH_CLIENT_SECRET: null }
    ]) {
      const result = resolve(env);
      expect(result).toMatchObject({ profile: "invalid", clientId: "", clientSecret: "" });
      expect(result.configError).toMatch(/ANTIGRAVITY_OAUTH_CLIENT_(ID|SECRET)/);
      expect(result.configError).toMatch(/unset both/);
      expect(result.configError).not.toContain(CUSTOM_SECRET);
    }
  });

  it("keeps the dashboard constant equal to the server desktop redirect", async () => {
    const { ANTIGRAVITY_DESKTOP_REDIRECT_URI } = await import("@/lib/oauth/redirectUri.js");
    expect(ANTIGRAVITY_DESKTOP_REDIRECT_URI).toBe(DESKTOP_REDIRECT);
    expect(m.shared.ANTIGRAVITY_DESKTOP_REDIRECT_URI).toBe(DESKTOP_REDIRECT);
    expect([...m.shared.ANTIGRAVITY_DESKTOP_SCOPES]).toEqual(SIX_SCOPES);
  });
});

let defaultRow;
describe("built-in desktop profile (overrides absent)", () => {
  it.each([["local", LOCAL_CALLBACK], ["remote hosted", REMOTE_CALLBACK]])(
    "%s dashboard: authorize and exchange both use the desktop loopback", async (_label, dashboardCallback) => {
      const { start, connectionId, exchange } = await signIn(dashboardCallback, `default-${_label.replace(" ", "-")}@example.test`);
      const auth = new URL(start.body.authUrl);
      expect(auth.origin + auth.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
      expect(auth.searchParams.get("client_id")).toBe(DESKTOP_ID);
      expect(auth.searchParams.get("redirect_uri")).toBe(DESKTOP_REDIRECT);
      expect(auth.searchParams.get("scope").split(" ")).toEqual(SIX_SCOPES);
      expect(auth.searchParams.get("prompt")).toBe("consent");
      expect(auth.searchParams.get("access_type")).toBe("offline");
      expect(auth.searchParams.get("state")).toBe(start.body.state);
      expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
      // Authorize response is what the dashboard sees: no secret, only the public ID in the URL.
      expect(start.text).not.toContain(DESKTOP_SECRET);
      expect(auth.searchParams.has("client_secret")).toBe(false);

      expect(exchange).toMatchObject({
        grant_type: "authorization_code", client_id: DESKTOP_ID, client_secret: DESKTOP_SECRET,
        redirect_uri: DESKTOP_REDIRECT
      });
      expect(s256(exchange.code_verifier)).toBe(auth.searchParams.get("code_challenge"));
      expect(exchange.code).toMatch(/^code-default/);
      const stored = await row(connectionId);
      expect(stored.providerSpecificData.oauthClientBinding).toBe(bindingOf(DESKTOP_ID));
      expect(JSON.stringify(stored)).not.toContain(DESKTOP_SECRET);
      defaultRow = connectionId;
    });

  it("rejects a callback with the wrong state before any token request", async () => {
    const start = await authorize(REMOTE_CALLBACK);
    outbound.calls.length = 0;
    const bad = await post("exchange", { code: "code", state: "not-the-state", flowId: start.body.flowId });
    expect(bad.status).toBe(400);
    expect(tokenCalls()).toHaveLength(0);
  });

  it("refuses a token exchange whose redirect differs from the desktop callback", async () => {
    const { exchangeTokens } = await import("@/lib/oauth/providers.js");
    outbound.calls.length = 0;
    await expect(exchangeTokens("antigravity", "code", REMOTE_CALLBACK, "verifier", "state", {})).rejects.toThrow(/desktop client callback/);
    expect(outbound.calls).toHaveLength(0);
  });

  it("refreshes a desktop-stamped row with the desktop pair and keeps the marker", async () => {
    await m.db.updateProviderConnection(defaultRow, { expiresAt: expired() });
    outbound.calls.length = 0;
    const result = await m.creds.refreshAndUpdateCredentials(await row(defaultRow), true);
    expect(result.refreshed).toBe(true);
    expect(tokenCalls()).toHaveLength(1);
    expect(form(tokenCalls()[0])).toMatchObject({ grant_type: "refresh_token", client_id: DESKTOP_ID, client_secret: DESKTOP_SECRET });
    expect((await row(defaultRow)).providerSpecificData.oauthClientBinding).toBe(bindingOf(DESKTOP_ID));
  });

  it("refreshes a legacy unmarked row with the desktop pair and never stamps it", async () => {
    outbound.calls.length = 0;
    const result = await m.creds.refreshAndUpdateCredentials(await row("legacy-ag"), true);
    expect(result.refreshed).toBe(true);
    expect(form(tokenCalls()[0])).toMatchObject({ client_id: DESKTOP_ID, refresh_token: "legacy-refresh" });
    expect((await row("legacy-ag")).providerSpecificData?.oauthClientBinding).toBeUndefined();
  });

  it("the CLI loopback listener accepts the desktop /oauth-callback path", async () => {
    const { startLocalServer } = await import("@/lib/oauth/utils/server.js");
    let callback;
    const listener = await startLocalServer((params) => { callback = params; });
    try {
      const get = (pathAndQuery, headers = {}) => new Promise((resolve, reject) => {
        http.get({ host: "localhost", port: listener.port, path: pathAndQuery, headers }, (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        }).on("error", reject);
      });
      expect(await get("/oauth-callback?code=evil&state=evil", { origin: "https://evil.example.test" })).toBe(403);
      expect(callback).toBeUndefined();
      expect(await get("/oauth-callback?code=local-code&state=local-state")).toBe(200);
      expect(callback).toEqual({ code: "local-code", state: "local-state" });
    } finally {
      listener.close();
    }
  });

  it("CLI service uses the same desktop loopback and scopes", async () => {
    const { AntigravityService } = await import("@/lib/oauth/services/antigravity.js");
    const service = new AntigravityService();
    // A caller-supplied callback is replaced by the single registered one on both legs.
    const auth = new URL(service.buildAuthUrl(LOCAL_CALLBACK, "s", "c"));
    expect(auth.searchParams.get("redirect_uri")).toBe(DESKTOP_REDIRECT);
    expect(auth.searchParams.get("scope").split(" ")).toEqual(SIX_SCOPES);
    outbound.calls.length = 0;
    await service.exchangeCode("cli-code", LOCAL_CALLBACK, "cli-verifier");
    expect(form(tokenCalls()[0])).toMatchObject({ client_id: DESKTOP_ID, redirect_uri: DESKTOP_REDIRECT, code_verifier: "cli-verifier" });
  });
});

let customRow;
describe("explicit custom client", () => {
  beforeAll(() => useEnv({ ANTIGRAVITY_OAUTH_CLIENT_ID: CUSTOM_ID, ANTIGRAVITY_OAUTH_CLIENT_SECRET: CUSTOM_SECRET }), 120_000);

  it("keeps the registered remote redirect and the existing scope set", async () => {
    const { start, connectionId, exchange } = await signIn(REMOTE_CALLBACK, "custom@example.test");
    const auth = new URL(start.body.authUrl);
    expect(auth.searchParams.get("client_id")).toBe(CUSTOM_ID);
    expect(auth.searchParams.get("redirect_uri")).toBe(REMOTE_CALLBACK);
    const scopes = auth.searchParams.get("scope").split(" ");
    expect(scopes).not.toContain("https://www.googleapis.com/auth/aicode");
    expect(scopes).toEqual(SIX_SCOPES.filter((scope) => !scope.endsWith("/aicode")));
    expect(start.text).not.toContain(CUSTOM_SECRET);
    expect(exchange).toMatchObject({ client_id: CUSTOM_ID, client_secret: CUSTOM_SECRET, redirect_uri: REMOTE_CALLBACK });
    expect(s256(exchange.code_verifier)).toBe(auth.searchParams.get("code_challenge"));
    const stored = await row(connectionId);
    expect(stored.providerSpecificData.oauthClientBinding).toBe(bindingOf(CUSTOM_ID));
    expect(JSON.stringify(stored)).not.toContain(CUSTOM_SECRET);
    customRow = connectionId;
  });

  it("refuses the desktop-stamped row before any lease or outbound request", async () => {
    await m.db.updateProviderConnection(defaultRow, { expiresAt: expired() });
    const before = await row(defaultRow);
    outbound.calls.length = 0;
    await expect(m.creds.refreshAndUpdateCredentials(before, true)).rejects.toMatchObject({ category: "reauth_required" });
    expect(outbound.calls).toHaveLength(0);
    const after = await row(defaultRow);
    expect({ a: after.accessToken, r: after.refreshToken, p: after.providerSpecificData })
      .toEqual({ a: before.accessToken, r: before.refreshToken, p: before.providerSpecificData });
  });

  it("reauthorization under the custom client restamps and refreshes with it", async () => {
    await signIn(REMOTE_CALLBACK, "default-local@example.test", { connectionId: defaultRow });
    expect((await row(defaultRow)).providerSpecificData.oauthClientBinding).toBe(bindingOf(CUSTOM_ID));
    await m.db.updateProviderConnection(defaultRow, { expiresAt: expired() });
    outbound.calls.length = 0;
    expect((await m.creds.refreshAndUpdateCredentials(await row(defaultRow), true)).refreshed).toBe(true);
    expect(form(tokenCalls()[0])).toMatchObject({ client_id: CUSTOM_ID, client_secret: CUSTOM_SECRET });
  });
});

describe.each([
  ["blank", { ANTIGRAVITY_OAUTH_CLIENT_ID: "", ANTIGRAVITY_OAUTH_CLIENT_SECRET: "" }, /ANTIGRAVITY_OAUTH_CLIENT_ID and ANTIGRAVITY_OAUTH_CLIENT_SECRET/],
  ["missing secret", { ANTIGRAVITY_OAUTH_CLIENT_ID: CUSTOM_ID }, /ANTIGRAVITY_OAUTH_CLIENT_SECRET is blank or unset/],
  ["whitespace id", { ANTIGRAVITY_OAUTH_CLIENT_ID: "   ", ANTIGRAVITY_OAUTH_CLIENT_SECRET: CUSTOM_SECRET }, /ANTIGRAVITY_OAUTH_CLIENT_ID is blank or unset/],
  ["blank id only", { ANTIGRAVITY_OAUTH_CLIENT_ID: "" }, /ANTIGRAVITY_OAUTH_CLIENT_ID and ANTIGRAVITY_OAUTH_CLIENT_SECRET/],
  ["blank secret only", { ANTIGRAVITY_OAUTH_CLIENT_SECRET: "" }, /ANTIGRAVITY_OAUTH_CLIENT_ID and ANTIGRAVITY_OAUTH_CLIENT_SECRET/],
  ["missing id", { ANTIGRAVITY_OAUTH_CLIENT_SECRET: CUSTOM_SECRET }, /ANTIGRAVITY_OAUTH_CLIENT_ID is blank or unset/]
])("invalid override (%s)", (_label, env, message) => {
  beforeAll(() => useEnv(env), 120_000);

  it("fails sign-in locally with config guidance and never falls back", async () => {
    outbound.calls.length = 0;
    const start = await authorize(LOCAL_CALLBACK);
    expect(start.response.status).toBe(400);
    expect(start.body.error).toMatch(message);
    expect(start.body.error).toMatch(/restart/);
    expect(start.text).not.toContain(DESKTOP_ID);
    expect(start.text).not.toContain(CUSTOM_SECRET);
    expect(outbound.calls).toHaveLength(0);
    expect(m.shared.ANTIGRAVITY_OAUTH_CLIENT).toEqual({ clientId: "", clientSecret: "" });
  });

  it("refuses marked rows before outbound and leaves them unchanged", async () => {
    await m.db.updateProviderConnection(customRow, { expiresAt: expired() });
    const before = await row(customRow);
    outbound.calls.length = 0;
    await expect(m.creds.refreshAndUpdateCredentials(before, true)).rejects.toMatchObject({ category: "reauth_required" });
    expect(outbound.calls).toHaveLength(0);
    expect((await row(customRow)).refreshToken).toBe(before.refreshToken);
  });

  it("refuses legacy unmarked rows before outbound and never stamps them", async () => {
    await m.db.updateProviderConnection("legacy-ag", { expiresAt: expired() });
    const before = await row("legacy-ag");
    outbound.calls.length = 0;
    await expect(m.creds.refreshAndUpdateCredentials(before, true)).rejects.toMatchObject({ category: "reauth_required" });
    expect(outbound.calls).toHaveLength(0);
    const after = await row("legacy-ag");
    expect({ a: after.accessToken, r: after.refreshToken, p: after.providerSpecificData })
      .toEqual({ a: before.accessToken, r: before.refreshToken, p: before.providerSpecificData });
    expect(after.providerSpecificData?.oauthClientBinding).toBeUndefined();
  });
});

describe("revert to the built-in profile", () => {
  beforeAll(() => useEnv({}), 120_000);

  it("refuses rows stamped by the custom client and refreshes desktop-stamped ones", async () => {
    await m.db.updateProviderConnection(customRow, { expiresAt: expired() });
    outbound.calls.length = 0;
    await expect(m.creds.refreshAndUpdateCredentials(await row(customRow), true)).rejects.toMatchObject({ category: "reauth_required" });
    expect(outbound.calls).toHaveLength(0);

    const { connectionId } = await signIn(LOCAL_CALLBACK, "custom@example.test", { connectionId: customRow });
    expect(connectionId).toBe(customRow);
    const stored = await row(customRow);
    expect(stored.providerSpecificData.oauthClientBinding).toBe(bindingOf(DESKTOP_ID));
    await m.db.updateProviderConnection(customRow, { expiresAt: expired() });
    outbound.calls.length = 0;
    expect((await m.creds.refreshAndUpdateCredentials(await row(customRow), true)).refreshed).toBe(true);
    expect(form(tokenCalls()[0])).toMatchObject({ client_id: DESKTOP_ID });
  });
});
