import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Antigravity sign-in and request parity (#2034), closed network.
//
// Real OAuth route, provider object, flow store, local DB, credential refresh,
// models route and the OpenAI/Anthropic handlers run unchanged. Only the
// outbound transport (`proxyAwareFetch` and global fetch), the browser launcher
// and the CLI listener are replaced. Every token below is synthetic.
//
// Wire contract sources (MIT):
// - CLIProxyAPI dbe641f286a489ecb39e3c041c554371e6add864:
//   internal/auth/antigravity/{constants,auth}.go, sdk/auth/antigravity.go,
//   internal/runtime/executor/antigravity_executor_auth.go.
// - OmniRoute b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523:
//   src/lib/oauth/providers/antigravity.ts.
// EasyCLIProxyAPI 29567ead8164a00724dfdc2087f02a23895636ee holds no provider
// code; it manages a separately installed CLIProxyAPI core.
// The comparison is in internal/docs/port-reports/provider-signin-antigravity-parity.md.

const DESKTOP_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const DESKTOP_SECRET = "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";
const DESKTOP_REDIRECT = "http://localhost:51121/oauth-callback";
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/aicode",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs"
];
const LEAK = "synthetic-upstream-leak-marker";
const bindingOf = (id) => `v1:${createHash("sha256").update(id).digest("hex")}`;
const s256 = (verifier) => createHash("sha256").update(verifier).digest("base64url");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agy-signin-parity-"));
const previous = { ...process.env };
process.env.HOME = path.join(root, "home");
process.env.DATA_DIR = path.join(root, "data");
process.env.XDG_CACHE_HOME = path.join(root, "cache");
fs.mkdirSync(process.env.HOME, { recursive: true });
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
for (const key of Object.keys(process.env)) {
  if (/^(ANTIGRAVITY_|HTTPS?_PROXY|ALL_PROXY|NO_PROXY)/i.test(key)) delete process.env[key];
}
process.env.ANTIGRAVITY_ONBOARD_MAX_ATTEMPTS = "3";
process.env.ANTIGRAVITY_ONBOARD_RETRY_DELAY_MS = "1000";

vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => Response.json(body, init) } }));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: async () => {} }));
const cli = vi.hoisted(() => ({ authUrl: null, callback: null }));
// The browser launcher fails; the CLI must keep the printed URL usable.
vi.mock("open", () => ({ default: async (url) => { cli.authUrl = url; throw new Error("no browser in tests"); } }));
vi.mock("@/lib/oauth/utils/server.js", async (original) => ({
  ...(await original()),
  startLocalServer: async (onParams, port) => {
    cli.deliver = onParams;
    return { port: port || 0, close: () => {} };
  },
  waitForCallbackParams: async (read) => {
    cli.deliver(cli.callback(new URL(cli.authUrl).searchParams.get("state")));
    return read();
  }
}));
vi.mock("@/lib/oauth/utils/ui.js", () => {
  const spinner = { start: () => spinner, succeed: () => spinner, fail: () => spinner, text: "" };
  return { spinner: () => spinner };
});

// Mocked upstream: per-access-token account state so concurrent sign-ins stay apart.
const up = vi.hoisted(() => ({ calls: [], accounts: new Map(), codes: new Map(), next: {} }));
function account(token) {
  for (const value of up.accounts.values()) if (value.access === token || value.refreshed === token) return value;
  return null;
}
async function providerFetch(input, init = {}) {
  const url = String(input);
  const headers = new Headers(init.headers);
  up.calls.push({ url, init, headers });
  const bearer = (headers.get("authorization") || "").replace(/^Bearer /, "");
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    const body = new URLSearchParams(String(init.body));
    if (up.next.token) return up.next.token(body);
    if (body.get("grant_type") === "refresh_token") {
      const acct = [...up.accounts.values()].find((a) => a.refresh === body.get("refresh_token"));
      if (!acct) return Response.json({ error: "invalid_grant", error_description: LEAK }, { status: 400 });
      acct.refreshed = `${acct.access}-refreshed`;
      return Response.json({ access_token: acct.refreshed, expires_in: 3600 });
    }
    const acct = up.accounts.get(up.codes.get(body.get("code")));
    if (!acct) return Response.json({ error: "invalid_grant", error_description: LEAK }, { status: 400 });
    // Let a concurrent sign-in interleave between exchange and account lookup.
    await new Promise((resolve) => setImmediate(resolve));
    return Response.json({ access_token: acct.access, refresh_token: acct.refresh, expires_in: 3600, scope: SCOPES.join(" ") });
  }
  const acct = account(bearer);
  if (url.includes("/userinfo") && up.next.userinfo) return up.next.userinfo();
  if (url.includes("/userinfo")) return acct ? Response.json({ email: acct.email, id: `sub-${acct.email}` }) : new Response(LEAK, { status: 401 });
  if (url.includes(":loadCodeAssist")) return Response.json(acct?.load ?? {});
  if (url.includes(":onboardUser")) return Response.json(acct.onboard.length > 1 ? acct.onboard.shift() : acct.onboard[0]);
  if (url.includes(":fetchAvailableModels")) {
    return Response.json({ models: { "gemini-3-flash": { displayName: "Gemini 3 Flash" } } });
  }
  if (url.includes("GenerateContent") || url.includes("generateContent")) {
    if (up.next.generate) return up.next.generate();
    const candidate = { content: { role: "model", parts: [{ text: `Hello ${acct?.email}` }] }, finishReason: "STOP" };
    const payload = { response: { candidates: [candidate], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 } } };
    if (url.includes(":streamGenerateContent")) {
      return new Response(`data: ${JSON.stringify(payload)}\n\n`, { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json(payload);
  }
  throw new Error(`Unexpected outbound URL: ${url}`);
}
vi.mock("open-sse/utils/proxyFetch.js", async (original) => ({
  ...(await original()),
  proxyAwareFetch: (...args) => providerFetch(...args)
}));

function addAccount(email, overrides = {}) {
  const slug = email.split("@")[0];
  const value = {
    email,
    access: `synthetic-access-${slug}`,
    refresh: `synthetic-refresh-${slug}`,
    load: { cloudaicompanionProject: `project-${slug}`, allowedTiers: [{ id: "free-tier", isDefault: true }] },
    onboard: [{ done: true, response: { cloudaicompanionProject: { id: `project-${slug}` } } }],
    ...overrides
  };
  up.accounts.set(email, value);
  up.codes.set(`code-${slug}`, email);
  return value;
}

let route, db, chat, messages, models, providerModels, providers, creds;
beforeAll(async () => {
  vi.stubGlobal("fetch", providerFetch);
  route = await import("@/app/api/oauth/[provider]/[action]/route.js");
  db = await import("@/lib/localDb");
  providers = await import("@/lib/oauth/providers.js");
  creds = await import("@/shared/services/providerCredentials.js");
  chat = await import("@/app/api/v1/chat/completions/route.js");
  messages = await import("@/app/api/v1/messages/route.js");
  models = await import("@/app/api/v1/models/route.js");
  providerModels = await import("@/app/api/providers/[id]/models/route.js");
  vi.stubGlobal("fetch", providerFetch);
}, 120_000);
beforeEach(() => {
  up.calls.length = 0;
  up.next = {};
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  process.env = previous;
  fs.rmSync(root, { recursive: true, force: true });
});

async function post(action, body, provider = "antigravity") {
  return route.POST(new Request(`http://localhost/api/oauth/${provider}/${action}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  }), { params: Promise.resolve({ provider, action }) });
}
async function authorize(extra = {}) {
  const response = await post("authorize", { redirectUri: "https://gate.example.test/callback", proxyMode: "direct", ...extra });
  const text = await response.text();
  return { response, text, body: JSON.parse(text) };
}
async function signIn(slug, extra = {}) {
  const start = await authorize(extra);
  expect(start.response.status, start.text).toBe(200);
  const done = await post("exchange", { code: `code-${slug}`, state: start.body.state, flowId: start.body.flowId });
  const text = await done.text();
  return { start, done, text, body: JSON.parse(text) };
}
const callsTo = (part) => up.calls.filter((c) => c.url.includes(part));
const form = (call) => Object.fromEntries(new URLSearchParams(String(call.init.body)));
const leakFree = (text) => {
  for (const secret of [LEAK, DESKTOP_SECRET, "synthetic-refresh-"]) expect(text).not.toContain(secret);
};
async function completion(handler, endpoint, stream) {
  const response = await handler.POST(new Request(`http://localhost/v1/${endpoint}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "ag/gemini-3-flash", max_tokens: 64, stream, messages: [{ role: "user", content: "Hi" }] })
  }));
  return { response, text: await response.text() };
}

describe("dashboard sign-in (production web wiring)", () => {
  it("binds the desktop client, six scopes, S256 PKCE and state, then onboards nothing for an existing project", async () => {
    addAccount("alpha@example.test");
    const { start, done, text, body } = await signIn("alpha");
    expect(done.status, text).toBe(200);
    const auth = new URL(start.body.authUrl);
    expect(auth.origin + auth.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(auth.searchParams)).toMatchObject({
      client_id: DESKTOP_ID, redirect_uri: DESKTOP_REDIRECT, response_type: "code",
      access_type: "offline", prompt: "consent", state: start.body.state, code_challenge_method: "S256"
    });
    expect(auth.searchParams.get("scope").split(" ")).toEqual(SCOPES);
    leakFree(start.text);
    leakFree(text);

    const exchange = form(callsTo("oauth2.googleapis.com/token")[0]);
    expect(exchange).toMatchObject({
      grant_type: "authorization_code", client_id: DESKTOP_ID, client_secret: DESKTOP_SECRET,
      code: "code-alpha", redirect_uri: DESKTOP_REDIRECT
    });
    expect(s256(exchange.code_verifier)).toBe(auth.searchParams.get("code_challenge"));
    expect(callsTo(":onboardUser")).toHaveLength(0);

    const row = await db.getProviderConnectionById(body.connection.id);
    expect(row).toMatchObject({
      provider: "antigravity", email: "alpha@example.test", projectId: "project-alpha",
      accessToken: "synthetic-access-alpha", refreshToken: "synthetic-refresh-alpha"
    });
    expect(row.providerSpecificData.oauthClientBinding).toBe(bindingOf(DESKTOP_ID));
    expect(row.providerSpecificData.antigravitySubject).toBe("sub-alpha@example.test");
    leakFree(JSON.stringify(row).replace("synthetic-refresh-alpha", ""));
  });

  it("rejects a wrong state and a replayed exchange without a second token request", async () => {
    addAccount("replay@example.test");
    const start = await authorize();
    const bad = await post("exchange", { code: "code-replay", state: "forged", flowId: start.body.flowId });
    expect(bad.status).toBe(400);
    expect(callsTo("oauth2.googleapis.com/token")).toHaveLength(0);

    const accepted = await post("exchange", { code: "code-replay", state: start.body.state, flowId: start.body.flowId });
    expect(accepted.status).toBe(200);
    const replay = await post("exchange", { code: "code-replay", state: start.body.state, flowId: start.body.flowId });
    expect(replay.status).toBeGreaterThanOrEqual(400);
    expect(callsTo("oauth2.googleapis.com/token")).toHaveLength(1);
    expect((await db.getProviderConnections({ provider: "antigravity" })).filter((c) => c.email === "replay@example.test")).toHaveLength(1);
  });

  it("keeps token, client binding and proxy selection per account across concurrent sign-ins", async () => {
    addAccount("one@example.test");
    addAccount("two@example.test");
    const poolOne = await db.createProxyPool({ name: "pool-one", proxyUrl: "http://proxy-one.invalid:8080", isActive: true });
    const poolTwo = await db.createProxyPool({ name: "pool-two", proxyUrl: "http://proxy-two.invalid:8080", isActive: true });
    const [one, two] = await Promise.all([
      signIn("one", { proxyMode: "strict-pool", proxyPoolId: poolOne.id }),
      signIn("two", { proxyMode: "strict-pool", proxyPoolId: poolTwo.id })
    ]);
    expect(one.done.status, one.text).toBe(200);
    expect(two.done.status, two.text).toBe(200);

    for (const [slug, pool, result] of [["one", poolOne, one], ["two", poolTwo, two]]) {
      const row = await db.getProviderConnectionById(result.body.connection.id);
      expect(row).toMatchObject({
        email: `${slug}@example.test`, projectId: `project-${slug}`,
        accessToken: `synthetic-access-${slug}`, refreshToken: `synthetic-refresh-${slug}`
      });
      expect(row.providerSpecificData).toMatchObject({ proxyPoolId: pool.id, oauthClientBinding: bindingOf(DESKTOP_ID) });
      // Every sign-in request of this account went through this account's pool.
      const own = up.calls.filter((c) => c.headers.get("authorization") === `Bearer synthetic-access-${slug}` ||
        new URLSearchParams(String(c.init.body)).get("code") === `code-${slug}`);
      expect(own.length).toBeGreaterThanOrEqual(3);
      for (const call of own) expect(JSON.stringify(call.init.proxyOptions)).toContain(`proxy-${slug}.invalid`);
    }
  });

  it("fails unsupported modes before any network request", async () => {
    const device = await post("device-code", { proxyMode: "direct" });
    expect(device.status).toBeGreaterThanOrEqual(400);
    const imported = await post("import-token", { token: "synthetic-refresh-import" });
    expect(imported.status).toBeGreaterThanOrEqual(400);
    leakFree(await imported.text());
    await expect(providers.exchangeTokens("antigravity", "code", DESKTOP_REDIRECT, "", "state", {})).rejects.toThrow(/PKCE verifier/);
    await expect(providers.exchangeTokens("antigravity", "code", "https://gate.example.test/callback", "verifier", "state", {}))
      .rejects.toThrow(/desktop client callback/);
    expect(up.calls).toHaveLength(0);
  });

  it("does not echo a rejected exchange body and saves nothing", async () => {
    const before = (await db.getProviderConnections({ provider: "antigravity" })).length;
    const start = await authorize();
    const done = await post("exchange", { code: "code-unknown", state: start.body.state, flowId: start.body.flowId });
    expect(done.status).toBeGreaterThanOrEqual(400);
    leakFree(await done.text());
    expect(await db.getProviderConnections({ provider: "antigravity" })).toHaveLength(before);
  });

  it("fails a settled onboarding operation error and a missing project without saving", async () => {
    const before = (await db.getProviderConnections({ provider: "antigravity" })).length;
    addAccount("denied@example.test", { load: { allowedTiers: [{ id: "free-tier", isDefault: true }] }, onboard: [{ done: true, error: { code: 7, message: "denied" } }] });
    addAccount("empty@example.test", { load: {}, onboard: [{ done: true, response: {} }] });
    for (const slug of ["denied", "empty"]) {
      const result = await signIn(slug);
      expect(result.done.status).toBeGreaterThanOrEqual(400);
      leakFree(result.text);
    }
    expect(JSON.parse(callsTo(":onboardUser")[0].init.body)).toMatchObject({ tier_id: "free-tier", mode: 1 });
    expect(await db.getProviderConnections({ provider: "antigravity" })).toHaveLength(before);
  });
});

describe("onboarding poll deadline (fake clock)", () => {
  it("polls a pending operation on the configured delay and stops on abort", async () => {
    addAccount("pending@example.test", { load: {}, onboard: [{ done: false }] });
    const provider = providers.getProvider("antigravity");
    const controller = new AbortController();
    vi.useFakeTimers();
    try {
      const run = provider.postExchange({ access_token: "synthetic-access-pending" }, undefined, null, controller.signal);
      const settled = run.then(() => "resolved", (error) => error);
      await vi.advanceTimersByTimeAsync(0);
      expect(callsTo(":onboardUser")).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(999);
      expect(callsTo(":onboardUser")).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(callsTo(":onboardUser")).toHaveLength(2);
      controller.abort();
      const outcome = await settled;
      expect(outcome).toBeInstanceOf(Error);
      expect(outcome.name).toBe("OAuthCancelledError");
      await vi.advanceTimersByTimeAsync(10_000);
      expect(callsTo(":onboardUser")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up at the configured attempt bound", async () => {
    addAccount("slow@example.test", { load: {}, onboard: [{ done: false }] });
    vi.useFakeTimers();
    try {
      const run = providers.getProvider("antigravity").postExchange({ access_token: "synthetic-access-slow" }, undefined, null, undefined);
      const settled = run.then(() => null, (error) => error);
      await vi.advanceTimersByTimeAsync(5_000);
      expect((await settled).message).toMatch(/did not return a project/);
      expect(callsTo(":onboardUser")).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("refresh, model discovery and completions on the signed-in account", () => {
  let alpha;
  beforeAll(async () => {
    const rows = await db.getProviderConnections({ provider: "antigravity" });
    // Leave exactly one active account so routing is deterministic.
    for (const row of rows) {
      if (row.email === "alpha@example.test") alpha = row;
      else await db.updateProviderConnection(row.id, { isActive: false });
    }
  });

  it("discovers the account catalog with its own project and bearer", async () => {
    const response = await providerModels.GET(new Request(`http://localhost/api/providers/${alpha.id}/models`), { params: Promise.resolve({ id: alpha.id }) });
    const text = await response.text();
    expect(response.status, text).toBe(200);
    const probe = callsTo(":fetchAvailableModels").at(-1);
    expect(JSON.parse(probe.init.body)).toMatchObject({ project: "project-alpha" });
    expect(probe.headers.get("authorization")).toBe("Bearer synthetic-access-alpha");
    leakFree(text);
    const list = await models.GET(new Request("http://localhost/v1/models"));
    expect((await list.json()).data.some((model) => model.id === "ag/gemini-3-flash")).toBe(true);
  });

  it.each([
    ["chat/completions", false], ["chat/completions", true], ["messages", false], ["messages", true]
  ])("serves %s (stream=%s) with the account project and bearer", async (endpoint, stream) => {
    const { response, text } = await completion(endpoint === "messages" ? messages : chat, endpoint, stream);
    expect(response.status, text).toBe(200);
    expect(text).toContain("Hello alpha@example.test");
    if (endpoint === "messages") expect(text).toContain(stream ? "message_start" : '"type":"message"');
    else expect(text).toContain(stream ? "chat.completion.chunk" : '"chat.completion"');
    const sent = callsTo("enerateContent").at(-1);
    expect(sent.url).toContain(stream ? ":streamGenerateContent" : ":generateContent");
    expect(JSON.parse(sent.init.body).project).toBe("project-alpha");
    expect(sent.headers.get("authorization")).toBe("Bearer synthetic-access-alpha");
  });

  it("maps upstream quota exhaustion to 429 without leaking credentials", async () => {
    up.next.generate = () => Response.json({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota" } }, { status: 429 });
    const { response, text } = await completion(chat, "chat/completions", false);
    expect(response.status).toBe(429);
    leakFree(text);
    expect(text).not.toContain("synthetic-access-alpha");
  });

  it("refreshes an expired token with the bound desktop client and keeps the project", async () => {
    await db.updateProviderConnection(alpha.id, { expiresAt: new Date(Date.now() - 60_000).toISOString() });
    const { response, text } = await completion(chat, "chat/completions", false);
    expect(response.status, text).toBe(200);
    const refresh = callsTo("oauth2.googleapis.com/token").map(form).find((f) => f.grant_type === "refresh_token");
    expect(refresh).toMatchObject({ client_id: DESKTOP_ID, client_secret: DESKTOP_SECRET, refresh_token: "synthetic-refresh-alpha" });
    const row = await db.getProviderConnectionById(alpha.id);
    expect(row).toMatchObject({ accessToken: "synthetic-access-alpha-refreshed", refreshToken: "synthetic-refresh-alpha", projectId: "project-alpha" });
    expect(row.providerSpecificData.oauthClientBinding).toBe(bindingOf(DESKTOP_ID));
    expect(callsTo("enerateContent").at(-1).headers.get("authorization")).toBe("Bearer synthetic-access-alpha-refreshed");
  });

  it("keeps the stored credential when Google rejects the refresh token", async () => {
    await db.updateProviderConnection(alpha.id, { expiresAt: new Date(Date.now() - 60_000).toISOString() });
    up.next.token = () => Response.json({ error: "invalid_grant", error_description: LEAK }, { status: 400 });
    const result = await creds.refreshAndUpdateCredentials(await db.getProviderConnectionById(alpha.id), true).then((v) => v, (e) => e);
    leakFree(JSON.stringify(result ?? null) + String(result?.message ?? ""));
    expect(callsTo("oauth2.googleapis.com/token").map(form)).toEqual([
      expect.objectContaining({ grant_type: "refresh_token", client_id: DESKTOP_ID, refresh_token: "synthetic-refresh-alpha" })
    ]);
    const row = await db.getProviderConnectionById(alpha.id);
    expect(row).toMatchObject({
      accessToken: "synthetic-access-alpha-refreshed", refreshToken: "synthetic-refresh-alpha", projectId: "project-alpha"
    });
    leakFree(JSON.stringify(row).replace("synthetic-refresh-alpha", ""));
  });

  it("refuses a refresh under a different OAuth client before any request", async () => {
    await db.updateProviderConnection(alpha.id, {
      providerSpecificData: { ...alpha.providerSpecificData, oauthClientBinding: bindingOf("some-other-client") }
    });
    const result = await creds.refreshAndUpdateCredentials(await db.getProviderConnectionById(alpha.id), true).then((v) => v, (e) => e);
    expect(String(result?.code ?? result?.category ?? result?.message)).toMatch(/reauth/i);
    expect(callsTo("oauth2.googleapis.com/token")).toHaveLength(0);
  });
});

describe("CLI service (src/lib/oauth/services/antigravity.js)", () => {
  let service;
  beforeAll(async () => {
    const { AntigravityService } = await import("@/lib/oauth/services/antigravity.js");
    service = new AntigravityService();
  });

  it("rejects an exchange without an access token and user info without an email", async () => {
    up.next.token = () => Response.json({ refresh_token: "synthetic-refresh-x" });
    await expect(service.exchangeCode("code", DESKTOP_REDIRECT, "verifier")).rejects.toThrow(/access token/);
    up.next.token = () => new Response(LEAK, { status: 400 });
    const error = await service.exchangeCode("code", DESKTOP_REDIRECT, "verifier").catch((e) => e);
    expect(error.message).toMatch(/400/);
    expect(error.message).not.toContain(LEAK);
    await expect(service.getUserInfo("synthetic-unknown")).rejects.toThrow(/401/);
    up.next.userinfo = () => Response.json({ email: "  " });
    await expect(service.getUserInfo("synthetic-access-alpha")).rejects.toThrow(/email/);
  });

  it("reads project keys and tier fallback the same way as the dashboard", async () => {
    addAccount("keys@example.test", { load: { projectId: " project-keys ", currentTier: { id: "standard-tier" } } });
    await expect(service.loadCodeAssist("synthetic-access-keys")).resolves.toEqual({ projectId: "project-keys", tierId: "standard-tier" });
    addAccount("tierless@example.test", { load: {} });
    await expect(service.loadCodeAssist("synthetic-access-tierless")).resolves.toEqual({ projectId: "", tierId: "free-tier" });
    addAccount("minor@example.test", { load: { ineligibleTiers: [{ reasonCode: "RESTRICTED_AGE" }] } });
    await expect(service.loadCodeAssist("synthetic-access-minor")).rejects.toThrow(/RESTRICTED_AGE/);
  });

  it("fails onboarding on a settled operation error and does not sleep after the last poll", async () => {
    addAccount("cli-denied@example.test", { onboard: [{ done: true, error: { code: 8, message: "exhausted" } }] });
    await expect(service.completeOnboarding("synthetic-access-cli-denied", "", "free-tier", 1)).rejects.toMatchObject({ status: 429 });
    addAccount("cli-pending@example.test", { onboard: [{ done: false }] });
    vi.useFakeTimers();
    try {
      const settled = service.completeOnboarding("synthetic-access-cli-pending", "", "free-tier", 2).catch((e) => e);
      await vi.advanceTimersByTimeAsync(4_999);
      expect(callsTo(":onboardUser")).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(callsTo(":onboardUser")).toHaveLength(3);
      expect((await settled).message).toMatch(/timeout/);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("connects an existing project without onboarding and tolerates a failed browser launch", async () => {
    addAccount("cli@example.test");
    // saveTokens needs the CLI server config module, absent from this checkout (see report).
    const save = vi.spyOn(service, "saveTokens").mockResolvedValue({ success: true });
    try {
      cli.callback = (state) => ({ code: "code-cli", state });
      await expect(service.connect()).resolves.toBe(true);
      expect(new URL(cli.authUrl).searchParams.get("redirect_uri")).toBe(DESKTOP_REDIRECT);
      const exchange = form(callsTo("oauth2.googleapis.com/token")[0]);
      expect(s256(exchange.code_verifier)).toBe(new URL(cli.authUrl).searchParams.get("code_challenge"));
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ access_token: "synthetic-access-cli" }),
        expect.objectContaining({ email: "cli@example.test" }), "project-cli");
      expect(callsTo(":onboardUser")).toHaveLength(0);

      up.calls.length = 0;
      cli.callback = () => ({ code: "code-cli", state: "forged" });
      await expect(service.connect()).rejects.toThrow(/state/);
      expect(callsTo("oauth2.googleapis.com/token")).toHaveLength(0);
      expect(save).toHaveBeenCalledTimes(1);
    } finally {
      save.mockRestore();
    }
  });
});
