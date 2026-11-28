/**
 * #2034 closed-network regression: real cookie import, SQLite account storage,
 * gateway chat construction and private image construction. Only outbound bytes,
 * proxy reachability and operator authorization are mocked. Synthetic values only;
 * no assertion establishes live browser storage, token renewal or vendor acceptance.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMaxaiImageAdapter, resolveMaxaiImageCredential } from "../../open-sse/services/providerParity/native-maxai-image/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
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

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "complete-maxai-image-tuple-"));
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

const IMAGE_PATH = "/gpt/get_image_generate_response";
const IMAGE_URL = `https://api.maxai.me${IMAGE_PATH}`;
const proof = (path, user) => computeMaxaiProof(path, FIXED_NOW, user, SIGNING.hmacKey, SIGNING.appVersion);

/** Exercise the private adapter directly: it remains absent from the public registry. */
async function image(credentials, answer = () => Response.json({ status: "OK", data: [{ png_url: "https://cdn.maxai.me/synthetic.png" }] })) {
  const calls = [];
  const adapter = createMaxaiImageAdapter({
    constants: SIGNING, now: () => FIXED_NOW,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return answer(); },
  });
  const result = await adapter.generate({ model: "gpt-image-1", body: { prompt: "synthetic gate" }, credentials,
    log: { debug: (...args) => logs.push(args.join(" ")) } });
  return { result, calls };
}

async function assertClean(result, accounts = [A, B, C]) {
  expectNoSecrets(await result.response.clone().text(), secretsOf(...accounts));
  expectNoSecrets(JSON.stringify({ error: result.error, acceptedJob: result.acceptedJob }), secretsOf(...accounts));
  expectNoSecrets(logs.join("\n"), secretsOf(...accounts));
}

it("constructs chat and images for two imported accounts despite stale PSD and uses each selected proxy", async () => {
  const ids = [];
  for (const [index, tuple] of [A, C].entries()) {
    const id = await createConnection(`Imported ${index}`, headerOf(B), staleFields(B));
    const imported = await importCookies({ action: "update", connectionId: id }, cookiesOf(tuple));
    expect(imported).toMatchObject({ status: 200, body: { ok: true } });
    expectNoSecrets(imported.body, secretsOf(A, B, C));
    await configureAccount(id, index === 0 ? PROXY_A : PROXY_B, index + 1);
    ids.push(id);
  }
  for (const [index, tuple] of [A, C].entries()) {
    const credentials = await row(ids[index]);
    expect(credentials.apiKey).toBe(headerOf(tuple));
    expect(credentials.providerSpecificData.maxaiAccessToken).toBe(B.access_token);
    sent.length = 0;
    const clock = vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
    let response;
    try { response = await chat(); } finally { clock.mockRestore(); }
    expect(response.status).toBe(200);
    expectNoSecrets(await response.text(), secretsOf(A, B, C));
    const chatCalls = apiCalls(CHAT_URL);
    expect(chatCalls).toHaveLength(1);
    const chatCall = chatCalls[0];
    expect(chatCall.init.headers.Authorization).toBe(`Bearer ${tuple.access_token}`);
    expect(openSignature(chatCall.init.headers)).toMatchObject({ d: tuple.device_id, p: proof(CHAT_PATH, tuple.user_id) });
    const { result, calls } = await image(credentials);
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(IMAGE_URL);
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${tuple.access_token}`);
    expect(openSignature(calls[0].init.headers)).toMatchObject({ d: tuple.device_id, p: proof(IMAGE_PATH, tuple.user_id) });
    expect(JSON.parse(calls[0].init.body)).toEqual({ prompt: "synthetic gate", style: "vivid", size: "1024x1024", n: 1, model_name: "gpt-image-1" });
    const proxy = index === 0 ? PROXY_A : PROXY_B;
    expect(chatCall.proxyOptions).toMatchObject({ connectionProxyUrl: proxy });
    expect(calls[0].init.proxyOptions).toMatchObject({ connectionProxyUrl: proxy });
    await assertClean(result);
    const disabled = await routes.provider.PUT(request(`/api/providers/${ids[index]}`, { method: "PUT", body: { isActive: false } }), params(ids[index]));
    expect(disabled.status).toBe(200);
  }
  expect(getImageAdapter("maxai")).toBeNull();
  expect(getImageAdapter("mx")).toBeNull();
});

it.each([
  ["missing device", `access_token=${A.access_token}; user_id=${A.user_id}`],
  ["missing user", `access_token=${A.access_token}; device_id=${A.device_id}`],
  ["conflicting tokens", `${headerOf(A)}; access_token=${C.access_token}`],
  ["unsafe token", `access_token=unsafe\r\nvalue; device_id=d; user_id=u`],
])("refuses %s before image discovery or sending despite a complete stale PSD", async (_label, apiKey) => {
  const credentials = { apiKey, providerSpecificData: staleFields(B) };
  expect(resolveMaxaiImageCredential(credentials)).toBeNull();
  const discover = vi.fn();
  const fetchImpl = vi.fn();
  const result = await createMaxaiImageAdapter({ discover, fetchImpl }).generate({ model: "gpt-image-1", body: { prompt: "gate" }, credentials });
  expect(result.status).toBe(401);
  expect(result.acceptedJob).toBeUndefined();
  expect(discover).not.toHaveBeenCalled();
  expect(fetchImpl).not.toHaveBeenCalled();
  await assertClean(result);
});

it.each([null, {}, { apiKey: 42 }, { providerSpecificData: [] }, { providerSpecificData: { maxaiAccessToken: {}, maxaiDeviceId: [], maxaiUserId: 9 } }])("refuses malformed credentials %j without sending", async (credentials) => {
  const { result, calls } = await image(credentials);
  expect(result.status).toBe(401);
  expect(calls).toEqual([]);
  await assertClean(result);
});

it("supports a complete legacy PSD-only tuple and preserves quoted device compatibility without mutation", async () => {
  const credentials = { providerSpecificData: { ...staleFields(B), maxaiDeviceId: `"${B.device_id}"` } };
  const original = structuredClone(credentials);
  const { result, calls } = await image(credentials);
  expect(result.success).toBe(true);
  expect(calls[0].init.headers.Authorization).toBe(`Bearer ${B.access_token}`);
  expect(openSignature(calls[0].init.headers)).toMatchObject({ d: B.device_id, p: proof(IMAGE_PATH, B.user_id) });
  expect(credentials).toEqual(original);
  await assertClean(result);
});

it.each([
  ["disconnect", () => { throw new Error(`socket closed ${A.access_token}`); }, "submit-unknown"],
  ["5xx", () => new Response(A.access_token, { status: 503 }), "submit-unknown"],
  ["unreadable success", () => new Response(A.access_token), "accepted"],
])("retains accepted-job accounting and sends once for %s with no secrets in response or logs", async (_label, answer, jobState) => {
  const { result, calls } = await image({ apiKey: headerOf(A), providerSpecificData: staleFields(B) }, answer);
  expect(result.status).toBe(502);
  expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", meta: { jobState } });
  expect(calls).toHaveLength(1);
  expect(calls[0].init.headers.Authorization).toBe(`Bearer ${A.access_token}`);
  await assertClean(result);
});

it("uses the integrated terminal chat outcome marker to prevent replay across two imported accounts", async () => {
  for (const [index, tuple] of [A, C].entries()) {
    const imported = await importCookies({ action: "create", name: `Unknown ${index}` }, cookiesOf(tuple));
    expect(imported.status).toBe(201);
    await configureAccount(imported.body.connection.id, index === 0 ? PROXY_A : PROXY_B, index + 1);
  }
  upstream = maxaiNetwork({ chat: () => { throw new Error("socket closed after write"); } });
  const response = await sendChat();
  expect(response.ok).toBe(false);
  const text = await response.text();
  expect(text).toContain("upstream_outcome_unknown");
  expect(apiCalls(CHAT_URL)).toHaveLength(1);
  expect(apiCalls(CHAT_URL)[0].init.headers.Authorization).toBe(`Bearer ${A.access_token}`);
  expectNoSecrets(text, secretsOf(A, B, C));
  expectNoSecrets(logs.join("\n"), secretsOf(A, B, C));
});

it("derives the cookie user only from that token and refuses a conflicting JWT subject", async () => {
  const token = jwtFor(A.user_id);
  const credentials = { apiKey: `access_token=${token}; device_id=${A.device_id}`, providerSpecificData: staleFields(B) };
  const { result, calls } = await image(credentials);
  expect(result.success).toBe(true);
  expect(calls[0].init.headers.Authorization).toBe(`Bearer ${token}`);
  expect(openSignature(calls[0].init.headers)).toMatchObject({ d: A.device_id, p: proof(IMAGE_PATH, A.user_id) });
  expect(resolveMaxaiImageCredential({ ...credentials, apiKey: `${credentials.apiKey}; user_id=${B.user_id}` })).toBeNull();
  expectNoSecrets(await result.response.text(), [token, ...secretsOf(A, B)]);
});

it.each([
  `access_token=${A.access_token}; user_id=${A.user_id}`,
  `access_token=${A.access_token}; device_id=${A.device_id}`,
])("also refuses an incomplete stored chat tuple without outbound setup or dispatch: %s", async (apiKey) => {
  await createConnection("Incomplete", apiKey, staleFields(B));
  const response = await sendChat();
  expect(response.ok).toBe(false);
  expect(sent).toEqual([]);
  expectNoSecrets(await response.text(), secretsOf(A, B));
  expectNoSecrets(logs.join("\n"), secretsOf(A, B));
});
