/**
 * #2034: MaxAI chat signs with one account tuple, never a mix of the stored cookie and stale
 * providerSpecificData fields.
 *
 * Real: the provider, pairing and cookie-import routes, isolated SQLite, account selection,
 * handleChat, the MaxAI chat executor and its credential resolver
 * (open-sse/executors/maxaiCredentials.js), and the staged image adapter's signer, used here only
 * to recompute the expected proof independently of the chat executor. Mocked: the management guard
 * decision, the proxy reachability check and outbound bytes (`proxyAwareFetch` and global fetch).
 * Every credential and signing value is synthetic. Nothing here shows that MaxAI accepts the request.
 *
 * The image adapter's own credential precedence is not changed here; see
 * internal/docs/port-reports/fix-maxai-credential-tuple-2034.md.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveMaxaiCredential } from "../../open-sse/executors/maxaiCredentials.js";
import { computeMaxaiProof } from "../../open-sse/services/providerParity/native-maxai-image/signing.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const network = vi.hoisted(() => ({ fetch: null, proxyChecks: [] }));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: async ({ proxyUrl }) => { network.proxyChecks.push(proxyUrl); return { ok: true, status: 200 }; },
}));
vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-tuple-machine-id" }));
vi.mock("open-sse/utils/proxyFetch.js", async (original) => ({
  ...(await original()),
  proxyAwareFetch: (...args) => network.fetch(...args),
}));
vi.mock("@/dashboardGuard", async (original) => {
  const isMarked = async (request) => request.headers.get("x-test-operator") === "yes";
  return { ...(await original()), canAccessManagementApi: isMarked, canManageAccessConfig: isMarked, isOperatorRequest: isMarked };
});

const DASHBOARD = "https://dashboard.example.invalid";
const ORIGIN = "https://www.maxai.co";
const CHAT_PATH = "/gpt/cwc/chat";
const CHAT_URL = `https://api.maxai.me${CHAT_PATH}`;
const CONFIG_URL = "https://api.maxai.me/models/get_config";
const NAMES = ["access_token", "device_id", "user_id"];
const APP_CHUNK = "/_next/static/chunks/pages/_app-0a1b2c.js";
const SIGNER_CHUNK = "/_next/static/chunks/4242-0a1b2c.js";
const SIGNING = { hmacKey: "1a".repeat(32), aesKey: "2b".repeat(32), appVersion: "webpage_9.8.7", ctxKey: "3c".repeat(20) };
const PROXY_A = "http://proxy-alpha.invalid:8080";
const PROXY_B = "http://proxy-bravo.invalid:8080";
const FIXED_NOW = 1_795_000_000_000;

const account = (tag) => ({
  access_token: `synthetic.maxai-tuple-${tag}.signature`,
  device_id: `synthetic-tuple-device-${tag}`,
  user_id: `synthetic-tuple-user-${tag}`,
});
const A = account("alpha");
const B = account("bravo");
const C = account("charlie");
const secretsOf = (...accounts) => accounts.flatMap((entry) => Object.values(entry));
const headerOf = (entry) => NAMES.map((name) => `${name}=${entry[name]}`).join("; ");
const staleFields = (entry) => ({ maxaiAccessToken: entry.access_token, maxaiDeviceId: entry.device_id, maxaiUserId: entry.user_id });
const soon = () => Math.floor(Date.now() / 1000) + 3600;
const cookiesOf = (entry) => NAMES.map((name) => ({ name, value: entry[name], domain: "www.maxai.co", secure: true, expirationDate: soon() }));
const jwtFor = (userId) => `x.${Buffer.from(JSON.stringify({ subject: { user_id: userId } })).toString("base64url")}.y`;

let root;
let db;
let routes;
let handleChat;
let sent;
let upstream;
let outbound;
let logs;

const request = (url, { method = "POST", body, headers = {}, operator = true } = {}) =>
  new Request(`${DASHBOARD}${url}`, {
    method,
    headers: { "content-type": "application/json", ...(operator ? { "x-test-operator": "yes" } : null), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = (id) => ({ params: Promise.resolve({ id }) });
const row = (id) => db.getProviderConnectionById(id);

const expectNoSecrets = (value, secrets) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of secrets) expect(text).not.toContain(secret);
};

async function importCookies(target, cookies) {
  const minted = await routes.pairing.POST(request("/api/providers/cookie-import/pairing", { body: { provider: "maxai", ...target } }));
  expect(minted.status).toBe(201);
  const { pairing } = await minted.json();
  const body = { provider: "maxai", origin: ORIGIN, cookies, ...(target.action === "update" ? { connectionId: target.connectionId } : null) };
  const response = await routes.import.POST(request("/api/providers/cookie-import", {
    body, operator: false, headers: { [pairing.header]: pairing.token },
  }));
  return { status: response.status, body: await response.json() };
}

/** The operator's provider create route, which accepts saved providerSpecificData fields. */
async function createConnection(name, apiKey, providerSpecificData) {
  const response = await routes.providers.POST(request("/api/providers", {
    body: { provider: "maxai", name, ...(apiKey === undefined ? null : { apiKey }), providerSpecificData },
  }));
  expect(response.status).toBe(201);
  return (await response.json()).connection.id;
}

async function configureAccount(id, proxyUrl, priority) {
  const response = await routes.provider.PUT(request(`/api/providers/${id}`, {
    method: "PUT", body: { priority, connectionProxyEnabled: true, connectionProxyUrl: proxyUrl },
  }), params(id));
  expect(response.status).toBe(200);
}

/** Synthetic MaxAI web app and API. Any other URL fails the test. */
function maxaiNetwork({ chat = () => new Response(`data: ${JSON.stringify({ text: "synthetic answer" })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } }) } = {}) {
  return async (url, init) => {
    if (url === `${ORIGIN}/app/`) return new Response(`<script src="${APP_CHUNK}"></script><script src="${SIGNER_CHUNK}"></script>`);
    if (url === `${ORIGIN}${APP_CHUNK}`) {
      return new Response(`x.d({Mn:function(){return hk},Rl:function(){return ak}});var hk="${SIGNING.hmacKey}",ak="${SIGNING.aesKey}",v="${SIGNING.appVersion}";`);
    }
    if (url === `${ORIGIN}${SIGNER_CHUNK}`) return new Response(`n=(0,r.nj)("582d52616e646f6d");p={"${SIGNING.ctxKey}":{a:c}}`);
    if (url === CONFIG_URL) return new Response("{}", { status: 200 });
    if (url === CHAT_URL) return chat(init);
    throw new Error(`unmocked MaxAI request: ${url}`);
  };
}

const apiCalls = (url) => sent.filter((call) => call.url === url);

/** Open the CryptoJS "Salted__" envelope with OpenSSL itself. */
const openSignature = (headers) => JSON.parse(execFileSync(
  "openssl",
  ["enc", "-d", "-aes-256-cbc", "-md", "md5", "-base64", "-A", "-pass", `pass:${SIGNING.aesKey}`],
  { input: headers["X-Authorization"], stdio: ["pipe", "pipe", "ignore"] },
).toString("utf8"));

const sendChat = () => handleChat(new Request("http://gateway.invalid/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "maxai/gpt-5.6", stream: false, messages: [{ role: "user", content: "hello maxai" }] }),
}));

const usageAccounts = async () => (await db.getUsageHistory({ provider: "maxai" })).map((entry) => entry.connectionId).sort();

async function chat() {
  const before = (await usageAccounts()).length;
  const response = await sendChat();
  if (response.ok) await vi.waitFor(async () => expect(await usageAccounts()).toHaveLength(before + 1));
  return response;
}

/** Chat once with the clock fixed; return what the single chat send carried. */
async function signedChat() {
  sent.length = 0;
  const now = vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
  let response;
  try {
    response = await chat();
  } finally {
    now.mockRestore();
  }
  expect(response.status).toBe(200);
  const calls = apiCalls(CHAT_URL);
  expect(calls).toHaveLength(1);
  const { headers } = calls[0].init;
  return { call: calls[0], bearer: headers.Authorization, signature: openSignature(headers) };
}

/** The proof the staged image signer computes for this identity, independent of the chat executor. */
const proofFor = (userId) => computeMaxaiProof(CHAT_PATH, FIXED_NOW, userId, SIGNING.hmacKey, SIGNING.appVersion);

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fix-maxai-tuple-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON", "BASE_URL", "NEXT_PUBLIC_BASE_URL"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules(); // also drops the executor's cached signing constants
  logs = [];
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    vi.spyOn(console, level).mockImplementation((...args) => { logs.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : JSON.stringify(arg) ?? String(arg))).join(" ")); });
  }
  sent = [];
  network.proxyChecks.length = 0;
  upstream = maxaiNetwork();
  network.fetch = async (url, init, proxyOptions) => {
    sent.push({ url: String(url), init, proxyOptions });
    return upstream(String(url), init);
  };
  db = await import("@/lib/db/index.js");
  routes = {
    pairing: await import("../../src/app/api/providers/cookie-import/pairing/route.js"),
    import: await import("../../src/app/api/providers/cookie-import/route.js"),
    providers: await import("../../src/app/api/providers/route.js"),
    provider: await import("../../src/app/api/providers/[id]/route.js"),
    test: await import("../../src/app/api/providers/[id]/test/route.js"),
  };
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
  outbound = vi.fn(() => { throw new Error("unmocked outbound request"); });
  vi.stubGlobal("fetch", outbound);
});

afterEach(async () => {
  expect(outbound).not.toHaveBeenCalled();
  await disposeLoadedRequestDetailsRepo();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("resolveMaxaiCredential", () => {
  it("takes all three members from a cookie header that carries access_token, ignoring saved fields", () => {
    expect(resolveMaxaiCredential({ apiKey: headerOf(C), providerSpecificData: staleFields(B) }))
      .toEqual({ ok: true, source: "cookie", token: C.access_token, deviceId: C.device_id, userId: C.user_id });
    // `cookie` is read before `apiKey`, as before; one partial saved field changes nothing.
    expect(resolveMaxaiCredential({ cookie: headerOf(C), providerSpecificData: { maxaiAccessToken: B.access_token, accessToken: B.access_token } }))
      .toMatchObject({ ok: true, source: "cookie", token: C.access_token });
    // The user ID may come from the same cookie token's JWT subject, never from saved fields.
    const jwt = jwtFor("jwt-user-c");
    expect(resolveMaxaiCredential({ apiKey: `access_token=${jwt}; device_id=${C.device_id}`, providerSpecificData: { maxaiUserId: B.user_id } }))
      .toEqual({ ok: true, source: "cookie", token: jwt, deviceId: C.device_id, userId: "jwt-user-c" });
  });

  it("refuses a cookie tuple with a missing member instead of filling it from saved fields", () => {
    expect(resolveMaxaiCredential({ apiKey: `access_token=${C.access_token}; user_id=${C.user_id}`, providerSpecificData: staleFields(B) }))
      .toEqual({ ok: false, reason: "incomplete" });
    expect(resolveMaxaiCredential({ apiKey: `access_token=${C.access_token}; device_id=${C.device_id}`, providerSpecificData: staleFields(B) }))
      .toEqual({ ok: false, reason: "incomplete" });
  });

  it("refuses malformed or conflicting cookie material", () => {
    expect(resolveMaxaiCredential({ apiKey: `${headerOf(C)}; access_token=${B.access_token}` })).toEqual({ ok: false, reason: "conflict" });
    expect(resolveMaxaiCredential({ cookie: headerOf(C), apiKey: headerOf(B) })).toEqual({ ok: false, reason: "conflict" });
    expect(resolveMaxaiCredential({ apiKey: `access_token=${jwtFor("jwt-user")}; device_id=d; user_id=other-user` })).toEqual({ ok: false, reason: "conflict" });
    expect(resolveMaxaiCredential({ apiKey: `access_token=t\r\nX: y; device_id=d; user_id=u` })).toEqual({ ok: false, reason: "unsafe" });
    expect(resolveMaxaiCredential({ apiKey: `access_token=${"t".repeat(8193)}; device_id=d; user_id=u` })).toEqual({ ok: false, reason: "unsafe" });
    // The same name repeated with the same value is not a conflict.
    expect(resolveMaxaiCredential({ apiKey: `${headerOf(C)}; access_token=${C.access_token}` })).toMatchObject({ ok: true, token: C.access_token });
  });

  it("keeps a complete legacy providerSpecificData tuple and refuses an incomplete or mixed one", () => {
    expect(resolveMaxaiCredential({ providerSpecificData: staleFields(B) }))
      .toEqual({ ok: true, source: "providerSpecificData", token: B.access_token, deviceId: B.device_id, userId: B.user_id });
    expect(resolveMaxaiCredential({ apiKey: "device_id=ignored-without-token", providerSpecificData: staleFields(B) }))
      .toMatchObject({ ok: true, source: "providerSpecificData", deviceId: B.device_id });
    expect(resolveMaxaiCredential({ accessToken: B.access_token, providerSpecificData: { deviceId: B.device_id, userId: B.user_id } }))
      .toMatchObject({ ok: true, token: B.access_token, deviceId: B.device_id });
    // The maxai* family is not completed from the plain family or the top-level token.
    expect(resolveMaxaiCredential({ accessToken: A.access_token, providerSpecificData: { maxaiDeviceId: B.device_id, maxaiUserId: B.user_id, accessToken: A.access_token } }))
      .toEqual({ ok: false, reason: "incomplete" });
    expect(resolveMaxaiCredential({ providerSpecificData: { maxaiAccessToken: B.access_token, deviceId: A.device_id, userId: A.user_id } }))
      .toEqual({ ok: false, reason: "incomplete" });
    expect(resolveMaxaiCredential({ accessToken: A.access_token, providerSpecificData: { accessToken: B.access_token, deviceId: B.device_id, userId: B.user_id } }))
      .toEqual({ ok: false, reason: "conflict" });
    expect(resolveMaxaiCredential({})).toEqual({ ok: false, reason: "missing" });
    expect(resolveMaxaiCredential(undefined)).toEqual({ ok: false, reason: "missing" });
  });

  it("carries no secret in a refusal", () => {
    const refusal = resolveMaxaiCredential({ apiKey: `access_token=${C.access_token}`, providerSpecificData: staleFields(B) });
    expectNoSecrets(refusal, secretsOf(B, C));
  });
});

describe("gateway chat with saved fields and a cookie update (former SHADOW-REPRO)", () => {
  it("signs with the newly imported account, not the stale saved one, through the account's own proxy", async () => {
    const idA = await createConnection("Token style", headerOf(A), staleFields(B));
    const update = await importCookies({ action: "update", connectionId: idA }, cookiesOf(C));
    expect(update).toMatchObject({ status: 200, body: { ok: true } });
    const stored = await row(idA);
    expect(stored.apiKey).toBe(headerOf(C));
    expect(stored.providerSpecificData.maxaiAccessToken).toBe(B.access_token); // the stale fields stay stored
    await configureAccount(idA, PROXY_A, 1);

    const { call, bearer, signature } = await signedChat();
    expect(bearer).toBe(`Bearer ${C.access_token}`);
    expect(signature.d).toBe(C.device_id);
    expect(signature.p).toBe(proofFor(C.user_id));
    expect(signature.p).not.toBe(proofFor(B.user_id));
    expect(call.proxyOptions).toMatchObject({ connectionProxyUrl: PROXY_A });
    expectNoSecrets(JSON.stringify([call.init.headers, signature, call.init.body]), secretsOf(A, B));
    expect(await usageAccounts()).toEqual([idA]);
    expectNoSecrets(logs.join("\n"), secretsOf(A, B, C));
  });

  it("keeps two accounts and their proxies apart when one carries stale saved fields of the other", async () => {
    const idA = await createConnection("Alpha with stale bravo", headerOf(A), staleFields(B));
    const imported = await importCookies({ action: "create", name: "Bravo" }, cookiesOf(B));
    expect(imported.status).toBe(201);
    const idB = imported.body.connection.id;
    await configureAccount(idA, PROXY_A, 1);
    await configureAccount(idB, PROXY_B, 2);

    const first = await signedChat();
    expect(first.bearer).toBe(`Bearer ${A.access_token}`);
    expect(first.signature).toMatchObject({ d: A.device_id, p: proofFor(A.user_id) });
    for (const entry of sent) expect(entry.proxyOptions).toMatchObject({ connectionProxyUrl: PROXY_A });
    expectNoSecrets(JSON.stringify([first.call.init.headers, first.signature]), secretsOf(B));

    const disabled = await routes.provider.PUT(request(`/api/providers/${idA}`, { method: "PUT", body: { isActive: false } }), params(idA));
    expect(disabled.status).toBe(200);
    const second = await signedChat();
    expect(second.bearer).toBe(`Bearer ${B.access_token}`);
    expect(second.signature).toMatchObject({ d: B.device_id, p: proofFor(B.user_id) });
    expect(second.call.proxyOptions).toMatchObject({ connectionProxyUrl: PROXY_B });
    expectNoSecrets(JSON.stringify([second.call.init.headers, second.signature]), secretsOf(A));
    expect(await usageAccounts()).toEqual([idA, idB].sort());
    expectNoSecrets(logs.join("\n"), secretsOf(A, B));
  });

  it("validates the stored cookie account, not the saved fields, through the connection test route", async () => {
    const idA = await createConnection("Probe", headerOf(C), staleFields(B));
    const response = await routes.test.POST(request(`/api/providers/${idA}/test`, { body: {} }), params(idA));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ valid: true });
    expectNoSecrets(text, secretsOf(B, C));
    const [probe] = apiCalls(CONFIG_URL);
    expect(probe.init.headers.Authorization).toBe(`Bearer ${C.access_token}`);
    expect(openSignature(probe.init.headers).d).toBe(C.device_id);
  });

  it("still serves a complete legacy providerSpecificData-only connection", async () => {
    const id = await createConnection("Legacy fields", "legacy-no-cookie-header", staleFields(B));
    const { bearer, signature } = await signedChat();
    expect(bearer).toBe(`Bearer ${B.access_token}`);
    expect(signature).toMatchObject({ d: B.device_id, p: proofFor(B.user_id) });
    expect(await usageAccounts()).toEqual([id]);
  });
});

describe("refusal before any send", () => {
  it.each([
    ["a cookie missing device_id, with stale saved fields", `access_token=${C.access_token}; user_id=${C.user_id}`, staleFields(B)],
    ["a cookie missing user_id, with stale saved fields", `access_token=${C.access_token}; device_id=${C.device_id}`, staleFields(B)],
    ["a cookie naming two access tokens", `${headerOf(C)}; access_token=${B.access_token}`, {}],
    ["incomplete saved fields and no cookie token", "legacy-no-cookie-header", { maxaiAccessToken: B.access_token, maxaiDeviceId: B.device_id }],
  ])("refuses %s without billing or contacting MaxAI", async (_label, apiKey, providerSpecificData) => {
    const id = await createConnection("Refused", apiKey, providerSpecificData);
    const response = await sendChat();
    expect(response.ok).toBe(false);
    const text = await response.text();
    expectNoSecrets(text, secretsOf(B, C));
    expect(sent).toEqual([]);
    expect(await usageAccounts()).toEqual([]);
    expect((await row(id)).apiKey).toBe(apiKey);
    expectNoSecrets(logs.join("\n"), secretsOf(B, C));
  });
});

describe("unknown outcome after dispatch", () => {
  it("sends the chat once on a single account and does not replay it", async () => {
    const id = await createConnection("Alpha", headerOf(A), staleFields(B));
    await configureAccount(id, PROXY_A, 1);
    upstream = maxaiNetwork({ chat: () => { throw new Error("socket closed after write"); } });

    const response = await sendChat();
    expect(response.ok).toBe(false);
    expectNoSecrets(await response.text(), secretsOf(A, B));
    const calls = apiCalls(CHAT_URL);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${A.access_token}`);
    expect(openSignature(calls[0].init.headers).d).toBe(A.device_id);
    expect(calls[0].proxyOptions).toMatchObject({ connectionProxyUrl: PROXY_A });
    expect(await usageAccounts()).toEqual([]);
    expectNoSecrets(logs.join("\n"), secretsOf(A, B));
  });

  it("never resends on the same account, and any gateway fallback carries the other account's whole tuple", async () => {
    // Observed, not changed here: after a transport error the gateway's account fallback tries the
    // next connection. This fix only guarantees that no attempt mixes two accounts.
    const idA = await createConnection("Alpha", headerOf(A), staleFields(B));
    const imported = await importCookies({ action: "create", name: "Bravo" }, cookiesOf(B));
    await configureAccount(idA, PROXY_A, 1);
    await configureAccount(imported.body.connection.id, PROXY_B, 2);
    upstream = maxaiNetwork({ chat: () => { throw new Error("socket closed after write"); } });

    const response = await sendChat();
    expect(response.ok).toBe(false);
    expectNoSecrets(await response.text(), secretsOf(A, B));
    const attempts = apiCalls(CHAT_URL).map((call) => [call.init.headers.Authorization, openSignature(call.init.headers).d, call.proxyOptions?.connectionProxyUrl]);
    expect(attempts[0]).toEqual([`Bearer ${A.access_token}`, A.device_id, PROXY_A]);
    expect(attempts.filter(([bearer]) => bearer === `Bearer ${A.access_token}`)).toHaveLength(1);
    expect(attempts.filter(([bearer]) => bearer === `Bearer ${B.access_token}`).length).toBeLessThanOrEqual(1);
    for (const attempt of attempts.slice(1)) expect(attempt).toEqual([`Bearer ${B.access_token}`, B.device_id, PROXY_B]);
    expectNoSecrets(logs.join("\n"), secretsOf(A, B));
  });
});
