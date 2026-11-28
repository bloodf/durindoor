/**
 * Z.ai Web (`zai-web`) cookie flow, #2034: capture, import, storage and consumption.
 *
 * Real code: the registry entry, the extension's capture module, the dashboard import
 * parsers, the pairing and import routes, an isolated SQLite database, account and proxy
 * selection, the gateway chat handler and the zai-web executor.
 * Mocked: management guard authority, the `chrome` namespace and the outbound transport
 * (`proxyAwareFetch`). Every credential is synthetic and nothing leaves the process.
 *
 * The replies given by the mocked chat.z.ai are fixtures. They show how DurinDoor behaves,
 * not what the live site accepts. Tests named "NOT PARITY" pin gaps recorded in
 * internal/docs/port-reports/cookie-flows/zai-web-2034.md.
 */
import fs from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const boundary = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-flow-zai-web-"));
  const savedEnv = { ...process.env };
  fs.mkdirSync(path.join(root, "home"));
  Object.assign(process.env, { DATA_DIR: path.join(root, "data"), HOME: path.join(root, "home"), DURINDOOR_DATABASE_ENGINE: "sqlite" });
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) delete process.env[key];
  // proxyFetch keeps whatever global fetch it loads with as its direct transport.
  // Installing the refusal first means no code path in this file can reach a network.
  const realFetch = globalThis.fetch;
  const escaped = [];
  const refuse = async (url) => {
    escaped.push(String(url));
    throw new Error("closed boundary: unexpected network access");
  };
  globalThis.fetch = refuse;
  return {
    root, savedEnv, realFetch, refuse, escaped,
    send: vi.fn(),
    guard: { canAccessManagementApi: vi.fn(), isOperatorRequest: vi.fn(), hasExactRequestOrigin: vi.fn() },
  };
});

vi.mock("@/dashboardGuard", () => boundary.guard);
vi.mock("open-sse/utils/proxyFetch.js", async (importOriginal) => ({ ...(await importOriginal()), proxyAwareFetch: boundary.send }));
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/offline-fixture",
  updateKimchiUserAgent: vi.fn().mockResolvedValue("kimchi/offline-fixture"),
}));

const PROVIDER = "zai-web";
const ORIGIN = "https://chat.z.ai";
const NEW_CHAT = `${ORIGIN}/api/v1/chats/new`;
const COMPLETIONS_PATH = "/api/v2/chat/completions";
const DASHBOARD = "https://dashboard.example";
const IMPORT_URL = `${DASHBOARD}/api/providers/cookie-import`;
const MODEL = "zw/glm-5.3";

let api;
let db;
let logs;
/** Every synthetic secret minted by the running test. */
let secrets;
/** Outbound requests the mocked transport saw, in order. */
let wire;
/** Tokens the mocked chat.z.ai rejects. */
let rejected;
let completionReply;

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
/** Unsigned, synthetic JWT shape. The executor reads only the `id` claim. */
function token(label, header = b64({ alg: "none", typ: "JWT" })) {
  const value = `${header}.${b64({ id: `synthetic-user-${label}` })}.synthetic-signature-${label}`;
  secrets.add(value);
  return value;
}
/** Synthetic opaque CAPTCHA proof. It proves forwarding and isolation only, never provider validity. */
function proof(label) {
  const value = `synthetic-proof-${label}`;
  secrets.add(value);
  return value;
}
/** The proof reaches the completion JSON body only: not the setup call, not the URL. */
function expectProofInBodyOnly(value) {
  const completions = wire.filter((call) => call.target.pathname === COMPLETIONS_PATH);
  expect(completions).toHaveLength(1);
  expect(completions[0].body.captcha_verify_param).toBe(value);
  expect(completions[0].url).not.toContain(value);
  for (const call of wire.filter((entry) => entry.target.pathname !== COMPLETIONS_PATH)) expect(JSON.stringify(call.body)).not.toContain(value);
}
const inFuture = () => Math.floor(Date.now() / 1000) + 3600;
const tokenCookie = (value, extra = {}) => ({ name: "token", value, domain: "chat.z.ai", secure: true, ...extra });

const sse = (...frames) => new Response(
  `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}data: [DONE]\n\n`,
  { headers: { "Content-Type": "text/event-stream" } },
);
const answer = () => sse({ data: { phase: "thinking", delta_content: "synthetic reasoning" } }, { data: { phase: "answer", delta_content: "synthetic answer" } });

async function chatZai(url, init, proxyOptions) {
  const target = new URL(url);
  if (target.origin !== ORIGIN) throw new Error(`closed boundary: unexpected origin ${target.origin}`);
  const headers = new Headers(init.headers);
  const bearer = headers.get("authorization")?.replace(/^Bearer /, "");
  wire.push({ url: String(url), target, init, headers, bearer, proxyOptions, body: JSON.parse(init.body) });
  // A hostile rejection body that repeats the credential; it must never reach the client.
  if (rejected.has(bearer)) return new Response(`rejected session ${bearer}`, { status: 401 });
  if (String(url) === NEW_CHAT) return Response.json({ id: "synthetic-chat" });
  if (target.pathname === COMPLETIONS_PATH) return completionReply(url, init);
  throw new Error(`closed boundary: unexpected path ${target.pathname}`);
}

// ---------- dashboard routes ----------

const jsonRequest = (url, body, headers = {}) => new api.NextRequest(url, {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});

const requestPairing = (body, { url = `${DASHBOARD}/api/providers/cookie-import/pairing` } = {}) =>
  api.pair(jsonRequest(url, body, { origin: new URL(url).origin, "x-9r-cli-token": "synthetic-operator" }));

async function mintPairing(target) {
  const response = await requestPairing({ provider: PROVIDER, ...target });
  expect(response.status).toBe(201);
  const { pairing } = await response.json();
  secrets.add(pairing.token);
  return pairing;
}

const submit = (pairing, body, headers = {}) => api.importCookies(jsonRequest(IMPORT_URL, body, { [pairing.header]: pairing.token, ...headers }));

const targetFields = (target) => (target.action === "create" ? { name: target.name } : { connectionId: target.connectionId });

/** The request the dashboard dialog sends once a candidate is chosen (CookieImportModal importSelected). */
async function dashboardImport(candidate, target) {
  const pairing = await mintPairing(target);
  return submit(pairing, { provider: PROVIDER, origin: candidate.origin, cookies: candidate.cookies, ...targetFields(target) });
}

function candidateFrom(kind, parsed) {
  expect(parsed.ok).toBe(true);
  return api.buildImportCandidates({ kind, parsed }, api.contract);
}

// ---------- extension ----------

/** Chrome's `cookies.get` matching: a host cookie matches its host, a domain cookie also its subdomains. */
const domainApplies = (host, domain) => (domain.startsWith(".") ? `.${host}`.endsWith(domain) : host === domain);

function browser({ tabUrl = `${ORIGIN}/`, jar = [], otherStoreJar = [], pageStorage = {} } = {}) {
  const stores = { "store-tab": jar, "store-other": otherStoreJar };
  const tab = { id: 7, url: tabUrl };
  const granted = new Set();
  const asked = ({ permissions = [], origins = [] }) => [...permissions, ...origins];
  return {
    tabs: { query: vi.fn(async () => [tab]), get: vi.fn(async () => tab) },
    permissions: {
      contains: vi.fn(async (query) => asked(query).every((item) => granted.has(item))),
      request: vi.fn(async (query) => { for (const item of asked(query)) granted.add(item); return true; }),
      remove: vi.fn(async (query) => { for (const item of asked(query)) granted.delete(item); return true; }),
    },
    cookies: {
      getAllCookieStores: vi.fn(async () => [{ id: "store-other", tabIds: [99] }, { id: "store-tab", tabIds: [tab.id] }]),
      get: vi.fn(async ({ url, name, storeId }) =>
        stores[storeId].find((cookie) => cookie.name === name && domainApplies(new URL(url).hostname, cookie.domain)) ?? null),
      getAll: vi.fn(async () => { throw new Error("zai-web must not enumerate cookies"); }),
    },
    // Would answer with the page's storage if the extension ever injected a reader.
    scripting: { executeScript: vi.fn(async () => [{ frameId: 0, result: pageStorage }]) },
  };
}

/** The extension's one POST, delivered to the real import route. */
const extensionTransport = () => vi.fn((url, init) => api.importCookies(
  new api.NextRequest(url, { method: init.method, headers: { ...init.headers, origin: "chrome-extension://synthetic-extension" }, body: init.body }),
));

async function capture(pairing, chrome, send = extensionTransport()) {
  const prepared = await api.prepareCapture({ chrome, text: JSON.stringify({ pairing }) });
  if (!prepared.ok) return { prepared, send };
  const result = await api.runCapture({ chrome, fetch: send, plan: prepared.plan, confirmed: api.confirmationFor(prepared.plan) });
  return { prepared, result, send };
}

// ---------- gateway ----------

/** Synthetic proof the next chat() sends in its body; null sends none (reset before each test). */
let requestProof = null;
const chat = ({ connectionId, ...extra } = {}) => api.handleChat(new Request("http://gateway.invalid/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json", ...(connectionId ? { "x-connection-id": connectionId } : null) },
  body: JSON.stringify({ model: MODEL, stream: false, messages: [{ role: "user", content: "synthetic prompt" }], ...(requestProof ? { captcha_verify_param: requestProof } : null), ...extra }),
}));

const stored = (id) => api.localDb.getProviderConnectionById(id);
const allStored = () => api.localDb.getProviderConnections({ provider: PROVIDER });

/** A saved account created through the real import route. */
async function importAccount(name, value) {
  const response = await dashboardImport({ origin: ORIGIN, cookies: [tokenCookie(value)] }, { action: "create", name });
  expect(response.status).toBe(201);
  return (await response.json()).connection;
}

async function bindProxy(connectionId, label) {
  const proxyUrl = `http://proxy-${label}.invalid:8080`;
  const pool = await api.createProxyPool({ name: `synthetic-${label}-${connectionId}`, proxyUrl, strictProxy: true });
  const existing = await stored(connectionId);
  await api.localDb.updateProviderConnection(connectionId, { providerSpecificData: { ...existing.providerSpecificData, proxyPoolId: pool.id } });
  return { proxyUrl, poolId: pool.id };
}

const routes = () => wire.map((call) => [call.bearer, call.proxyOptions?.connectionProxyUrl]);

/** No secret in any console line or in any database table. Stored credentials are encrypted at rest. */
function expectNoSecretLeak() {
  const output = logs.map((spy) => spy.mock.calls.map((args) => args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : JSON.stringify(arg))).join(" ")).join("\n")).join("\n");
  const tables = db.all("SELECT name FROM sqlite_master WHERE type = 'table'");
  const dump = JSON.stringify(tables.map(({ name }) => db.all(`SELECT * FROM "${name}"`)));
  for (const secret of secrets) {
    expect(output).not.toContain(secret);
    expect(dump).not.toContain(secret);
  }
  return { output, dump };
}

beforeAll(async () => {
  const localDb = await import("@/lib/localDb");
  await (await import("@/lib/db/index.js")).initDb();
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  const handlers = await import("@/lib/providers/cookieImport/handlers.js");
  const providerHandlers = await import("@/lib/providerRouteHandlers");
  const extension = await import("../../extensions/provider-cookie-capture/capture.js");
  const parser = await import("@/shared/utils/cookieImportParser.js");
  const contracts = await import("@/lib/providers/cookieImport/contract.js");
  api = {
    ...extension,
    ...parser,
    localDb,
    handlers,
    contract: contracts.getCookieImportContract(PROVIDER),
    createProxyPool: (await import("@/lib/db/repos/proxyPoolsRepo.js")).createProxyPool,
    pair: (await import("@/app/api/providers/cookie-import/pairing/route.js")).POST,
    importCookies: (await import("@/app/api/providers/cookie-import/route.js")).POST,
    listProviders: providerHandlers.GET,
    addProvider: (await import("@/app/api/providers/route.js")).POST,
    pairings: await import("@/lib/providers/cookieImport/pairing.js"),
    NextRequest: (await import("next/server")).NextRequest,
    handleChat: (await import("@/sse/handlers/chat.js")).handleChat,
    ZaiWebExecutor: (await import("../../open-sse/executors/zai-web.js")).ZaiWebExecutor,
  };
  vi.stubGlobal("fetch", boundary.refuse);
}, 90_000);

beforeEach(async () => {
  for (const connection of await api.localDb.getProviderConnections()) await api.localDb.deleteProviderConnection(connection.id);
  api.pairings.clearPairings();
  vi.stubEnv("BASE_URL", DASHBOARD);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.example");
  for (const check of Object.values(boundary.guard)) check.mockReset().mockReturnValue(true);
  secrets = new Set();
  wire = [];
  rejected = new Set();
  completionReply = answer;
  requestProof = null;
  boundary.send.mockReset().mockImplementation(chatZai);
  boundary.escaped.length = 0;
  logs = ["log", "info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  return () => {
    for (const spy of logs) spy.mockRestore();
  };
});

afterAll(async () => {
  await disposeLoadedRequestDetailsRepo();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  globalThis.fetch = boundary.realFetch;
  for (const key of Object.keys(process.env)) if (!(key in boundary.savedEnv)) delete process.env[key];
  Object.assign(process.env, boundary.savedEnv);
  fs.rmSync(boundary.root, { recursive: true, force: true });
});

describe("zai-web extension capture through to the executor", () => {
  it("carries exactly the tab's chat.z.ai token cookie into encrypted storage, then dispatches it through the chosen proxy", async () => {
    const value = token("capture");
    const otherProfile = token("other-browser-profile");
    const chunk = token("chunk");
    const apiHost = token("api-host");
    const pairing = await mintPairing({ action: "create", name: "captured" });
    expect(pairing).toMatchObject({ provider: PROVIDER, importUrl: IMPORT_URL, ttlSeconds: 120 });
    // The whole contract of the real registry entry: one cookie, no chunks, optional cookies or storage keys.
    expect(pairing.contract).toEqual({ origin: ORIGIN, cookieNames: ["token"], cookiePrefixes: [] });

    const chrome = browser({
      jar: [
        { name: "cf_clearance", value: "synthetic-clearance", domain: ".z.ai", secure: true },
        { name: "token.0", value: chunk, domain: "chat.z.ai", secure: true },
        tokenCookie(apiHost, { domain: "api.z.ai" }),
        tokenCookie(value, { expirationDate: inFuture(), httpOnly: true, path: "/" }),
      ],
      otherStoreJar: [tokenCookie(otherProfile)],
      pageStorage: { token: otherProfile },
    });
    const { prepared, result, send } = await capture(pairing, chrome);

    expect(prepared.plan).toMatchObject({ cookieNames: ["token"], cookiePrefixes: [], optionalCookies: [], localStorageKeys: [] });
    expect(result).toEqual({ ok: true, action: "create", cookieCount: 1, connection: { id: expect.any(String), name: "captured" } });
    expect(chrome.cookies.get.mock.calls).toEqual([[{ url: `${ORIGIN}/`, name: "token", storeId: "store-tab" }]]);
    expect(chrome.cookies.getAll).not.toHaveBeenCalled();
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    const grant = { permissions: ["cookies"], origins: [`${ORIGIN}/*`, `${DASHBOARD}/*`] };
    expect(chrome.permissions.request.mock.calls).toEqual([[grant]]);
    expect(chrome.permissions.remove.mock.calls).toEqual([[grant]]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe(IMPORT_URL);
    expect(send.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "omit", redirect: "error" });
    expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({
      provider: PROVIDER, origin: ORIGIN,
      cookies: [{ name: "token", value, domain: "chat.z.ai", secure: true, expirationDate: expect.any(Number) }],
    });
    expect(wire).toEqual([]);

    const { id } = result.connection;
    expect(await stored(id)).toMatchObject({ provider: PROVIDER, authType: "cookie", apiKey: `token=${value}`, isActive: true });
    const listed = await (await api.listProviders(new Request(`${DASHBOARD}/api/providers`))).text();
    expect(listed).toContain(id);
    expect(listed).not.toContain(value);

    const { proxyUrl, poolId } = await bindProxy(id, "capture");
    requestProof = proof("capture");
    const response = await chat({ connectionId: id });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text).choices[0].message).toMatchObject({ content: "synthetic answer", reasoning_content: "synthetic reasoning" });
    expect(text).not.toContain(value);

    expect(wire.map((call) => `${call.target.origin}${call.target.pathname}`)).toEqual([NEW_CHAT, `${ORIGIN}${COMPLETIONS_PATH}`]);
    expect(routes()).toEqual([[value, proxyUrl], [value, proxyUrl]]);
    for (const call of wire) {
      expect(call.proxyOptions).toMatchObject({ connectionProxyEnabled: true, connectionProxyPoolId: poolId, strictProxy: true });
      expect(call.init.redirect).toBe("manual");
      // The stored `token=` pair becomes a bearer header; it is never replayed as a Cookie header.
      expect(call.headers.has("cookie")).toBe(false);
      expect(call.headers.get("origin")).toBe(ORIGIN);
    }
    const completion = wire[1];
    expect(completion.target.searchParams.get("token")).toBe(value);
    expect(completion.target.searchParams.get("user_id")).toBe("synthetic-user-capture");
    expect(completion.headers.get("x-signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(completion.body).toMatchObject({ chat_id: "synthetic-chat", model: "glm-5.3", signature_prompt: "synthetic prompt" });
    expectProofInBodyOnly(requestProof);
    expect(boundary.escaped).toEqual([]);
    // Positive controls: the scan really sees the gateway's log lines and the saved row.
    const scanned = expectNoSecretLeak();
    expect(scanned.output).toContain("proxy-capture.invalid");
    expect(scanned.dump).toContain(id);
  });

  it("refuses a wrong tab, signed-out store, insecure or foreign cookie without sending anything", async () => {
    const value = token("refused");
    for (const tabUrl of ["https://api.z.ai/", "https://z.ai/", "http://chat.z.ai/", "https://chat.z.ai.example/"]) {
      const chrome = browser({ tabUrl, jar: [tokenCookie(value)] });
      const { prepared, send } = await capture(await mintPairing({ action: "create", name: "wrong-tab" }), chrome);
      expect(prepared).toMatchObject({ ok: false, code: "wrong_tab", expectedOrigin: ORIGIN });
      expect(chrome.cookies.get).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      api.pairings.clearPairings();
    }
    for (const jar of [[], [tokenCookie(value, { secure: false })], [tokenCookie(value, { domain: "api.z.ai" })], [tokenCookie("")]]) {
      const chrome = browser({ jar, otherStoreJar: [tokenCookie(value)] });
      const { result, send } = await capture(await mintPairing({ action: "create", name: "no-cookie" }), chrome);
      expect(result).toMatchObject({ ok: false, code: "no_cookies" });
      expect(send).not.toHaveBeenCalled();
      expect(chrome.permissions.remove).toHaveBeenCalledTimes(1);
      api.pairings.clearPairings();
    }
    const widened = await mintPairing({ action: "create", name: "widened" });
    const foreign = await capture({ ...widened, contract: { ...widened.contract, origin: "https://z.ai" } }, browser());
    expect(foreign.prepared).toMatchObject({ ok: false, code: "origin_mismatch" });
    expect(await allStored()).toEqual([]);
    expectNoSecretLeak();
  });

  it("is refused by the server when the captured cookie has expired, and leaves the saved account untouched", async () => {
    const current = token("current");
    const connection = await importAccount("kept", current);
    const before = await stored(connection.id);
    const stale = token("stale");
    const chrome = browser({ jar: [tokenCookie(stale, { expirationDate: Math.floor(Date.now() / 1000) - 60 })] });
    const pairing = await mintPairing({ action: "update", connectionId: connection.id });
    const { result, send } = await capture(pairing, chrome);

    expect(result).toEqual({ ok: false, code: "rejected", message: api.MESSAGES.rejected });
    const reply = await send.mock.results[0].value;
    expect(reply.status).toBe(400);
    expect(await reply.json()).toEqual({ error: "Cookie is expired" });
    expect(await stored(connection.id)).toEqual(before);
    expect(wire).toEqual([]);
    expectNoSecretLeak();
  });

  it("NOT PARITY: a session held only in Local Storage is not captured, and nothing is read or sent in its place", async () => {
    const value = token("storage-only");
    const pairing = await mintPairing({ action: "create", name: "storage-only" });
    // Even a pairing edited to ask for the storage item is narrowed back to the built-in table.
    const asked = { ...pairing, contract: { ...pairing.contract, localStorageKeys: ["token"] } };
    const chrome = browser({ jar: [], pageStorage: { token: value } });
    const { prepared, result, send } = await capture(asked, chrome);

    expect(prepared.plan.localStorageKeys).toEqual([]);
    expect(result).toMatchObject({ ok: false, code: "no_cookies" });
    expect(chrome.permissions.request.mock.calls[0][0].permissions).toEqual(["cookies"]);
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(await allStored()).toEqual([]);
  });
});

describe("zai-web dashboard import inputs", () => {
  it.each([
    ["Cookie header", "header", (value) => api.parseCookieHeaderValue(`Cookie: theme=dark; token=${value}; cf_clearance=synthetic-clearance`)],
    ["cURL", "curl", (value) => api.parseCurlCommand(`curl '${ORIGIN}/api/models' \\\n  -H 'Cookie: theme=dark; token=${value}; cf_clearance=synthetic-clearance'`)],
    ["cURL -b", "curl", (value) => api.parseCurlCommand(`curl ${ORIGIN}/api/models -b 'token=${value}; cf_clearance=synthetic-clearance'`)],
    ["HAR", "har", (value) => api.parseHarDocument(JSON.stringify({ log: { entries: [
      { request: { url: "https://api.z.ai/api/paas/v4/models", headers: [{ name: "Cookie", value: "token=synthetic-foreign" }] } },
      { request: { url: "http://chat.z.ai/api/models", headers: [{ name: "Cookie", value: "token=synthetic-plain-http" }] } },
      { request: { url: "https://chat.z.ai.example/api/models", cookies: [{ name: "token", value: "synthetic-lookalike" }] } },
      { request: { url: `${ORIGIN}/api/models`, cookies: [{ name: "token", value }, { name: "cf_clearance", value: "synthetic-clearance" }] } },
    ] } }))],
  ])("stores only the token pair from a %s paste and the executor consumes it", async (_label, kind, parse) => {
    const value = token(`paste-${kind}`);
    const built = candidateFrom(kind, parse(value));
    expect(built.ok).toBe(true);
    expect(built.candidates).toHaveLength(1);
    expect(built.candidates[0]).toMatchObject({ origin: ORIGIN, originKnown: kind !== "header", cookies: [{ name: "token", value }] });

    const response = await dashboardImport(built.candidates[0], { action: "create", name: kind });
    expect(response.status).toBe(201);
    const text = await response.text();
    expect(text).not.toContain(value);
    const { connection } = JSON.parse(text);
    expect((await stored(connection.id)).apiKey).toBe(`token=${value}`);

    requestProof = proof(`paste-${kind}`);
    expect((await chat({ connectionId: connection.id })).status).toBe(200);
    expect(wire.map((call) => call.bearer)).toEqual([value, value]);
    expectProofInBodyOnly(requestProof);
    expectNoSecretLeak();
  });

  it("makes the operator choose between two Z.ai sessions in one HAR and imports only the chosen one", async () => {
    const first = token("har-first");
    const second = token("har-second");
    const entry = (value) => ({ request: { url: `${ORIGIN}/api/models`, headers: [{ name: "cookie", value: `token=${value}` }] } });
    const { candidates } = candidateFrom("har", api.parseHarDocument(JSON.stringify({ log: { entries: [entry(first), entry(second)] } })));
    expect(candidates).toHaveLength(2);
    expect(api.candidatesAreAmbiguous(candidates)).toBe(true);

    expect((await dashboardImport(candidates[1], { action: "create", name: "chosen" })).status).toBe(201);
    expect((await allStored()).map((row) => row.apiKey)).toEqual([`token=${second}`]);
    expectNoSecretLeak();
  });

  it("refuses foreign requests, chunked names and a bare Local Storage value with a reason and no secret in it", () => {
    const value = token("unsupported");
    for (const url of ["https://api.z.ai/api/models", "https://z.ai/", "http://chat.z.ai/api/models", "https://chat.z.ai.example/"]) {
      const built = candidateFrom("curl", api.parseCurlCommand(`curl ${url} -H 'Cookie: token=${value}'`));
      expect(built).toEqual({ ok: false, error: "The request origin is not approved for this provider." });
    }
    const chunked = candidateFrom("header", api.parseCookieHeaderValue(`token.0=${value}; token.1=${value}`));
    expect(chunked).toEqual({ ok: false, error: "The input has no token cookie." });
    // The import dialog needs a name=value pair; a bare value goes through Add Connection (below).
    expect(api.parseCookieHeaderValue(value)).toEqual({ ok: false, error: "No cookie name=value pair was found in the input." });
    const foreignHar = api.parseHarDocument(JSON.stringify({ log: { entries: [{ request: { url: "https://api.z.ai/", cookies: [{ name: "token", value }] } }] } }));
    expect(candidateFrom("har", foreignHar)).toEqual({ ok: false, error: `The HAR file has no request to ${ORIGIN}.` });
  });

  it.each([
    ["a Local Storage payload", (v) => ({ cookies: [tokenCookie(v)], localStorage: { token: v } }), "This provider takes no localStorage value"],
    ["a Local Storage payload instead of the cookie", (v) => ({ localStorage: { token: v } }), "cookies must be a non-empty array"],
    ["an expired cookie", (v) => ({ cookies: [tokenCookie(v, { expirationDate: 1 })] }), "Cookie is expired"],
    ["a chunked cookie", (v) => ({ cookies: [tokenCookie(v, { name: "token.0" })] }), "Cookie name is not approved for this provider"],
    ["an extra cookie", (v) => ({ cookies: [tokenCookie(v), { name: "cf_clearance", value: v }] }), "Cookie name is not approved for this provider"],
    ["an api.z.ai cookie", (v) => ({ cookies: [tokenCookie(v, { domain: "api.z.ai" })] }), "Cookie domain does not match the provider origin"],
    ["an insecure cookie", (v) => ({ cookies: [tokenCookie(v, { secure: false })] }), "Cookie must be a secure cookie"],
    ["two token cookies", (v) => ({ cookies: [tokenCookie(v), tokenCookie(v)] }), "Duplicate cookie name"],
    ["another origin", (v) => ({ origin: "https://api.z.ai", cookies: [tokenCookie(v)] }), "Origin is not approved for this provider"],
  ])("rejects %s at the import route, writes nothing and spends the pairing", async (_label, fields, error) => {
    const value = token("rejected-body");
    const pairing = await mintPairing({ action: "create", name: "rejected" });
    const body = { provider: PROVIDER, origin: ORIGIN, ...fields(value) };
    const response = await submit(pairing, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect((await submit(pairing, { provider: PROVIDER, origin: ORIGIN, cookies: [tokenCookie(value)] })).status).toBe(401);
    expect(await allStored()).toEqual([]);
    expectNoSecretLeak();
  });

  it("accepts a bare Local Storage value through Add Connection and sends it as the bearer token", async () => {
    const value = token("manual");
    const response = await api.addProvider(jsonRequest(`${DASHBOARD}/api/providers`, { provider: PROVIDER, name: "manual", apiKey: value }));
    expect(response.status).toBe(201);
    const text = await response.text();
    expect(text).not.toContain(value);
    const { connection } = JSON.parse(text);
    expect(connection.authType).toBe("cookie");
    requestProof = proof("manual");
    expect((await chat({ connectionId: connection.id })).status).toBe(200);
    expect(wire.map((call) => call.bearer)).toEqual([value, value]);
    expectProofInBodyOnly(requestProof);
    expectNoSecretLeak();
  });

  it("stores a token it cannot use, then refuses it locally at dispatch with no outbound request", async () => {
    const opaque = "synthetic-opaque-session-without-user-id";
    secrets.add(opaque);
    const connection = await importAccount("opaque", opaque);
    const response = await chat({ connectionId: connection.id });
    expect(response.status).toBe(401);
    const text = await response.text();
    expect(text).toContain("Re-import the chat.z.ai token cookie");
    expect(text).not.toContain(opaque);
    expect(wire).toEqual([]);
    expectNoSecretLeak();
  });
});

describe("zai-web pairing authority and ownership", () => {
  it("mints nothing without operator authority, a same-origin HTTPS request, or a valid one-use secret", async () => {
    const create = { provider: PROVIDER, action: "create", name: "authority" };
    for (const check of ["canAccessManagementApi", "isOperatorRequest", "hasExactRequestOrigin"]) {
      boundary.guard[check].mockReturnValueOnce(false);
      expect((await requestPairing(create)).status).toBe(403);
    }
    vi.stubEnv("BASE_URL", "http://dashboard.example");
    expect((await requestPairing(create, { url: "http://dashboard.example/api/providers/cookie-import/pairing" })).status).toBe(403);
    expect(api.pairings.pendingPairingCount()).toBe(0);
    vi.stubEnv("BASE_URL", DASHBOARD);

    const value = token("authority");
    const body = { provider: PROVIDER, origin: ORIGIN, cookies: [tokenCookie(value)] };
    const forged = { header: "x-durindoor-pairing-token", token: `ddpair_${"A".repeat(43)}` };
    expect((await submit(forged, body, { "x-9r-cli-token": "synthetic-operator" })).status).toBe(401);
    const pairing = await mintPairing({ action: "create", name: "authority" });
    const oversized = await submit(pairing, { ...body, padding: "x".repeat(api.handlers.MAX_IMPORT_BODY_BYTES) });
    expect(oversized.status).toBe(413);
    expect(await allStored()).toEqual([]);
    expectNoSecretLeak();
  });

  it("lets an update pairing write only the connection it was minted for", async () => {
    const tokenA = token("own-a");
    const tokenB = token("own-b");
    const a = await importAccount("a", tokenA);
    const b = await importAccount("b", tokenB);
    const nativeZai = await api.localDb.createProviderConnection({ provider: "zai", authType: "apikey", name: "native", apiKey: "synthetic-native-key" });
    const before = await Promise.all([a.id, b.id, nativeZai.id].map(stored));

    // The native api.z.ai provider is a different identity and cannot be targeted.
    expect((await requestPairing({ provider: PROVIDER, action: "update", connectionId: nativeZai.id })).status).toBe(409);
    expect((await requestPairing({ provider: PROVIDER, action: "update", connectionId: "synthetic-missing" })).status).toBe(404);

    const intruder = token("intruder");
    const body = { provider: PROVIDER, origin: ORIGIN, cookies: [tokenCookie(intruder)] };
    const pairing = await mintPairing({ action: "update", connectionId: a.id });
    expect((await submit(pairing, { ...body, connectionId: b.id })).status).toBe(409);
    expect((await submit(pairing, { ...body, connectionId: a.id })).status).toBe(401);
    const duplicate = await dashboardImport({ origin: ORIGIN, cookies: [tokenCookie(intruder)] }, { action: "create", name: "a" });
    expect(duplicate.status).toBe(409);

    expect(await Promise.all([a.id, b.id, nativeZai.id].map(stored))).toEqual(before);
    expect(await allStored()).toHaveLength(2);
    expectNoSecretLeak();
  });
});

describe("zai-web stored account consumption", () => {
  it("keeps each account on its own token and proxy, pinned in either order", async () => {
    const accounts = [];
    for (const label of ["a", "b"]) {
      const value = token(`iso-${label}`);
      const connection = await importAccount(label, value);
      accounts.push({ id: connection.id, value, ...(await bindProxy(connection.id, label)) });
    }
    const [a, b] = accounts;
    let turn = 0;
    for (const account of [b, a, b]) {
      wire = [];
      requestProof = proof(`iso-${turn++}`);
      expect((await chat({ connectionId: account.id })).status).toBe(200);
      expect(routes()).toEqual([[account.value, account.proxyUrl], [account.value, account.proxyUrl]]);
      expectProofInBodyOnly(requestProof);
    }
    expectNoSecretLeak();
  });

  it("returns a pinned account's rejection without rotating to the other account", async () => {
    const stale = token("pinned-stale");
    const neighbour = token("pinned-neighbour");
    const a = await importAccount("a", stale);
    await importAccount("b", neighbour);
    const { proxyUrl } = await bindProxy(a.id, "pinned");
    rejected.add(stale);

    requestProof = proof("pinned");
    const failed = await chat({ connectionId: a.id });
    expect(failed.status).toBe(401);
    const failure = await failed.text();
    expect(failure).toContain("Z.ai session expired or was rejected");
    expect(failure).not.toContain(stale);
    expect(routes()).toEqual([[stale, proxyUrl]]);
    expectNoSecretLeak();
  });

  it("falls back on its own proxy, then recovers the rejected account by extension re-capture", async () => {
    const stale = token("renew-stale");
    const neighbour = token("renew-neighbour");
    const a = await importAccount("a", stale);
    const b = await importAccount("b", neighbour);
    const bindingA = await bindProxy(a.id, "stale");
    const proxyB = (await bindProxy(b.id, "neighbour")).proxyUrl;
    await api.localDb.updateProviderConnection(a.id, { priority: 1 });
    expect((await stored(a.id)).priority).toBeLessThan((await stored(b.id)).priority);
    rejected.add(stale);

    requestProof = proof("fallback");
    const first = await chat();
    expect(first.status).toBe(200);
    expect(await first.text()).not.toContain(stale);
    expect(routes()).toEqual([[stale, bindingA.proxyUrl], [neighbour, proxyB], [neighbour, proxyB]]);
    expectProofInBodyOnly(requestProof);
    expect(await stored(a.id)).toMatchObject({ testStatus: "unavailable", errorCode: 401, apiKey: `token=${stale}` });
    const bBefore = await stored(b.id);

    const renewed = token("renew-fresh");
    const pairing = await mintPairing({ action: "update", connectionId: a.id });
    const { result, send } = await capture(pairing, browser({ jar: [tokenCookie(renewed, { expirationDate: inFuture() })] }));
    expect(result).toEqual({ ok: true, action: "update", cookieCount: 1, connection: { id: a.id, name: "a" } });
    expect(JSON.parse(send.mock.calls[0][1].body).connectionId).toBe(a.id);

    const updated = await stored(a.id);
    expect(updated).toMatchObject({ apiKey: `token=${renewed}`, testStatus: "active", errorCode: null });
    expect(updated.providerSpecificData.proxyPoolId).toBe(bindingA.poolId);
    expect(Object.keys(updated).filter((key) => key.startsWith("modelLock_") && updated[key])).toEqual([]);
    expect(await stored(b.id)).toEqual(bBefore);

    wire = [];
    requestProof = proof("renewed");
    expect((await chat({ connectionId: a.id })).status).toBe(200);
    expect(routes()).toEqual([[renewed, bindingA.proxyUrl], [renewed, bindingA.proxyUrl]]);
    expectProofInBodyOnly(requestProof);
    expectNoSecretLeak();
  });

  it("keeps the query-string token out of the response, logs and database when the transport error quotes the URL", async () => {
    // A header that is not `eyJ...`, so redaction cannot rest on recognising a JWT by shape.
    const value = token("transport-error", "synthetic-header");
    const connection = await importAccount("transport", value);
    completionReply = async (url) => { throw new Error(`synthetic socket failure for ${url}`); };

    requestProof = proof("transport");
    // Unpinned, so the failure is also written to the account's health state.
    const response = await chat();
    expect(response.status).toBe(502);
    const text = await response.text();
    // Stricter after the proof fix: the executor returns a fixed message, because the thrown text quotes
    // the token URL. The completion may have reached the provider, so the failure is terminal: no
    // replay, no cooldown and no copy of the thrown text in the account's health state.
    expect(text).toContain("Z.ai request failed; completion was not replayed");
    expect(text).not.toContain("synthetic socket failure");
    expect(text).not.toContain(value);
    expect(wire.at(-1).url).toContain(value);
    expect(wire.filter((call) => call.target.pathname === COMPLETIONS_PATH)).toHaveLength(1);
    expect((await stored(connection.id)).testStatus).not.toBe("unavailable");
    expect(String((await stored(connection.id)).lastError ?? "")).not.toContain("synthetic socket failure");
    await disposeLoadedRequestDetailsRepo();
    const scanned = expectNoSecretLeak();
    expect(scanned.output).not.toContain("synthetic socket failure");
    expect(scanned.dump).not.toContain("synthetic socket failure");
    // Positive control: the scan really sees the saved row.
    expect(scanned.dump).toContain(connection.id);
  });

  it.each([false, true])("reports a failure for a 200 reply that is not an event stream (stream: %s)", async (stream) => {
    const connection = await importAccount("not-sse", token("not-sse"));
    // The executor alone turns this into an empty completion; the gateway's empty-response check must stop it.
    completionReply = () => Response.json({ detail: "synthetic refusal: not an event stream" });

    // Stricter after the proof fix: the executor refuses the non-SSE 200 itself, before any client byte.
    requestProof = proof(`not-sse-${stream}`);
    const response = await chat({ stream });
    const text = await response.text();
    if (stream) {
      // Stricter: the failure is known before the stream starts, so it travels as a status, not a frame.
      expect(response.status).not.toBe(200);
      expect(text).not.toContain('"finish_reason":"stop"');
    } else {
      expect(response.status).toBe(502);
    }
    // Buffered and streamed alike end with a failure status, never a success stop.
    expect(response.status).toBe(502);
    expect(text).toContain("Z.ai request failed; completion was not replayed");
    expect(text).not.toContain("synthetic refusal");
    expect(wire.filter((call) => call.target.pathname === COMPLETIONS_PATH)).toHaveLength(1);
    // The completion was sent, so its outcome is uncertain: no replay and no account cooldown.
    expect((await stored(connection.id)).testStatus).not.toBe("unavailable");
    expectNoSecretLeak();
  });

  it("forwards the request's CAPTCHA proof in the completion body only, and a rejecting stream stays a redacted failure", async () => {
    const value = token("captcha");
    const connection = await importAccount("captcha", value);
    const existing = await stored(connection.id);
    await api.localDb.updateProviderConnection(connection.id, {
      providerSpecificData: { ...existing.providerSpecificData, captcha_verify_param: "synthetic-stored-proof" },
    });
    // Synthetic error frame; the live site's refusal shape is unverified.
    completionReply = () => sse({ data: { error: { detail: "synthetic refusal: proof missing" } } });

    const response = await chat({ connectionId: connection.id, captcha_verify_param: "synthetic-request-proof" });
    expect(response.ok).toBe(false);
    const text = await response.text();
    // Provider text is not echoed: it is unverified and could quote a token or proof.
    expect(text).toContain("Z.ai request failed; completion was not replayed");
    expect(text).not.toContain("synthetic refusal: proof missing");
    expect(text).not.toMatch(/synthetic-(stored|request)-proof/);
    expect(wire.filter((call) => call.target.pathname === COMPLETIONS_PATH)).toHaveLength(1);
    const completion = wire.find((call) => call.target.pathname === COMPLETIONS_PATH);
    // Source precedence: the request body proof wins over the stored one.
    expect(completion.body.captcha_verify_param).toBe("synthetic-request-proof");
    expect(JSON.stringify(completion.body)).not.toContain("synthetic-stored-proof");
    expect(completion.target.searchParams.has("captcha_verify_param")).toBe(false);
    expect(completion.url).not.toMatch(/synthetic-(stored|request)-proof/);
    expect(JSON.stringify(wire[0].body)).not.toMatch(/synthetic-(stored|request)-proof/);
    expectNoSecretLeak();
  });

  it("refuses a request with no CAPTCHA proof locally, before either POST, without cooling the account down", async () => {
    const value = token("no-proof");
    const connection = await importAccount("no-proof", value);
    await bindProxy(connection.id, "no-proof");
    const before = await stored(connection.id);

    const response = await chat({ connectionId: connection.id });
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain("zai_proof_required");
    expect(text).not.toContain(value);
    expect(wire).toEqual([]);
    expect(boundary.send).not.toHaveBeenCalled();
    expect((await stored(connection.id)).testStatus).toBe(before.testStatus);
    expectNoSecretLeak();
  });
});
