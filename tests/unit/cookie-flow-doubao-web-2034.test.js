/**
 * #2034: Doubao Web (Dola) cookie flow against the real provider contract, offline.
 *
 * Real: registry descriptor, import contract, extension capture, dashboard paste/cURL/HAR parsers,
 * pairing and import routes, same-origin check, provider routes, SQLite repository, handleChat,
 * account fallback, proxy routing and the Doubao executor.
 * Mocked: the three management-guard authority checks, the `chrome.*` API, and the network
 * transport under proxyAwareFetch. Every credential is synthetic.
 * Nothing here proves a live Dola sign-in or that dola.com accepts the request.
 *
 * Known defects are NOT covered by a passing assertion here (see
 * internal/docs/port-reports/cookie-flows/doubao-web-2034.md): the `fp` query value reaches the
 * error log, a bare cookie value echoed by Dola reaches the client, and STREAM_ERROR is ignored.
 * Provider contract origin: MIT OmniRoute open-sse/executors/doubao-web.ts (via the local port).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { ProxyAgent } from "undici";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const guard = vi.hoisted(() => ({ canAccessManagementApi: vi.fn(), canManageAccessConfig: vi.fn(), isOperatorRequest: vi.fn() }));
vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-cookie-machine-id" }));
vi.mock("@/dashboardGuard", async (importOriginal) => ({ ...(await importOriginal()), ...guard }));

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const DASHBOARD = "https://dashboard.example";
const DOLA = "https://www.dola.com";
const PROXY_URL = "http://127.0.0.1:9";
// Synthetic only: none of these is a real credential.
const account = (tag) => ({ sessionid: `synthetic-session-${tag}`, s_v_web_id: `verify_synthetic_${tag}` });
const headerOf = (value) => `sessionid=${value.sessionid}; s_v_web_id=${value.s_v_web_id}`;
const A = account("alpha");
const B = account("bravo");
const C = account("charlie");
const secretsOf = (...accounts) => accounts.flatMap((value) => [value.sessionid, value.s_v_web_id]);
const expectNoSecrets = (value, ...secrets) => {
  // JSON for every shape, so an object can never collapse to "[object Object]" and pass.
  const text = JSON.stringify(value ?? null);
  for (const secret of secrets) expect(text).not.toContain(secret);
};

let root;
let mods;
let wire;
let reply;
let logs;
let restoreTransport;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-flow-doubao-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  vi.stubEnv("BASE_URL", DASHBOARD);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.example");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("unmocked outbound request"); }));

  const proxyFetch = await import("../../open-sse/utils/proxyFetch.js");
  // The only network seam: the transport proxyAwareFetch dispatches through, with or without a proxy.
  restoreTransport = proxyFetch.__setOriginalFetchForTesting(async (url, init = {}) => {
    const call = { url: String(url), headers: new Headers(init.headers), method: init.method, body: init.body, proxied: init.dispatcher instanceof ProxyAgent };
    wire.push(call);
    return reply(call);
  });

  mods = {
    db: await import("@/lib/db/index.js"),
    providers: await import("../../src/app/api/providers/route.js"),
    provider: await import("../../src/app/api/providers/[id]/route.js"),
    pair: (await import("../../src/app/api/providers/cookie-import/pairing/route.js")).POST,
    importCookies: (await import("../../src/app/api/providers/cookie-import/route.js")).POST,
    pairings: await import("../../src/lib/providers/cookieImport/pairing.js"),
    contract: await import("../../src/lib/providers/cookieImport/contract.js"),
    parser: await import("../../src/shared/utils/cookieImportParser.js"),
    handleChat: (await import("../../src/sse/handlers/chat.js")).handleChat,
    registry: (await import("../../open-sse/providers/registry/index.js")).default,
    capture: await import("../../extensions/provider-cookie-capture/capture.js"),
    extension: await import("../../extensions/provider-cookie-capture/providers.js"),
  };
});

afterAll(async () => {
  restoreTransport?.();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await disposeLoadedRequestDetailsRepo();
  fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
  vi.restoreAllMocks();
  guard.canAccessManagementApi.mockReset().mockResolvedValue(true);
  guard.canManageAccessConfig.mockReset().mockResolvedValue(true);
  guard.isOperatorRequest.mockReset().mockResolvedValue(true);
  mods.pairings.clearPairings();
  for (const row of await mods.db.getProviderConnections({})) await mods.db.deleteProviderConnection(row.id);
  wire = [];
  reply = () => { throw new Error("unmocked provider request"); };
  logs = [];
  for (const method of ["log", "info", "warn", "error", "debug"]) {
    vi.spyOn(console, method).mockImplementation((...args) => { logs.push(args.map((arg) => (arg instanceof Error ? arg.stack : JSON.stringify(arg) ?? String(arg))).join(" ")); });
  }
});

const rows = () => mods.db.getProviderConnections({ provider: "doubao-web" });
const rowById = (id) => mods.db.getProviderConnectionById(id);

const pairingRequest = (body, headers = {}) => new NextRequest(`${DASHBOARD}/api/providers/cookie-import/pairing`, {
  method: "POST",
  headers: { "content-type": "application/json", host: new URL(DASHBOARD).host, origin: DASHBOARD, "x-9r-cli-token": "synthetic-operator", ...headers },
  body: JSON.stringify(body),
});
async function pairing(target = {}) {
  const res = await mods.pair(pairingRequest({ provider: "doubao-web", action: "create", name: "Dola", ...target }));
  expect(res.status).toBe(201);
  return (await res.json()).pairing;
}
const updatePairing = async (connectionId) => {
  const res = await mods.pair(pairingRequest({ provider: "doubao-web", action: "update", connectionId }));
  expect(res.status).toBe(201);
  return (await res.json()).pairing;
};
const importRequest = (token, body) => new NextRequest(`${DASHBOARD}/api/providers/cookie-import`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: "chrome-extension://synthetic-extension-id", ...(token ? { "x-durindoor-pairing-token": token } : null) },
  body: JSON.stringify(body),
});
async function submit(issued, body) {
  const res = await mods.importCookies(importRequest(issued.token, { provider: "doubao-web", origin: DOLA, ...body }));
  return { status: res.status, body: await res.json() };
}
const cookieList = (value) => Object.entries(value).map(([name, cookieValue]) => ({ name, value: cookieValue, domain: "www.dola.com", secure: true }));

/** A closed `chrome` namespace over one cookie jar. Enumeration and page scripting are forbidden. */
function browser(jar, tabUrl = `${DOLA}/chat/`) {
  const calls = { reads: [], requested: [], removed: [], forbidden: [] };
  const held = new Set();
  const names = (query) => [...(query.permissions ?? []), ...(query.origins ?? [])];
  const forbid = (name) => async () => { calls.forbidden.push(name); throw new Error(`${name} is forbidden for Doubao Web`); };
  return {
    calls,
    chrome: {
      tabs: { query: async () => [{ id: 7, url: tabUrl }], get: async () => ({ id: 7, url: tabUrl }) },
      permissions: {
        contains: async (query) => names(query).every((name) => held.has(name)),
        request: async (query) => { calls.requested.push(structuredClone(query)); names(query).forEach((name) => held.add(name)); return true; },
        remove: async (query) => { calls.removed.push(structuredClone(query)); names(query).forEach((name) => held.delete(name)); return true; },
      },
      cookies: {
        getAllCookieStores: async () => [{ id: "other-profile", tabIds: [99] }, { id: "tab-store", tabIds: [7] }],
        get: async (query) => { calls.reads.push({ ...query }); return jar[query.name] ?? null; },
        getAll: forbid("cookies.getAll"),
      },
      scripting: { executeScript: forbid("scripting.executeScript") },
    },
  };
}
const stored = (name, value, extra = {}) => ({ name, value, domain: ".dola.com", secure: true, ...extra });
const signedInJar = (value, extra = {}) => ({
  sessionid: stored("sessionid", value.sessionid),
  s_v_web_id: stored("s_v_web_id", value.s_v_web_id, { domain: "www.dola.com" }),
  ...extra,
});

/** Real pairing response -> real extension capture -> real import route. */
async function capture(issued, env) {
  const sent = [];
  const fetch = vi.fn(async (url, init) => {
    expect(url).toBe(`${DASHBOARD}/api/providers/cookie-import`);
    expect(init).toMatchObject({ method: "POST", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
    const headers = { ...init.headers, origin: "chrome-extension://synthetic-extension-id" };
    const res = await mods.importCookies(new NextRequest(url, { method: "POST", headers, body: init.body }));
    sent.push({ status: res.status, request: JSON.parse(init.body), response: await res.clone().json() });
    return res;
  });
  const prepared = await mods.capture.prepareCapture({ chrome: env.chrome, text: JSON.stringify({ pairing: issued }) });
  if (!prepared.ok) return { result: prepared, sent, fetch };
  const result = await mods.capture.runCapture({ chrome: env.chrome, fetch, plan: prepared.plan, confirmed: mods.capture.confirmationFor(prepared.plan) });
  return { result, sent, fetch };
}

const event = (text) => `event: STREAM_CHUNK\ndata: ${JSON.stringify({ content: { content_block: [{ content: { text_block: { text } } }] } })}\n\n`;
const answer = (text) => new Response(event(text), { headers: { "content-type": "text/event-stream" } });
async function chat({ model = "doubao-web/dola-speed", stream = false } = {}) {
  const res = await mods.handleChat(new Request("http://gateway.invalid/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream, messages: [{ role: "user", content: "synthetic question" }] }),
  }));
  return { status: res.status, text: await res.text() };
}
async function addAccount(name, value, priority) {
  const imported = await submit(await pairing({ name }), { cookies: cookieList(value) });
  expect(imported.status).toBe(201);
  const { id } = imported.body.connection;
  await mods.db.updateProviderConnection(id, { priority });
  return id;
}
const putProvider = (id, body) => mods.provider.PUT(new Request(`${DASHBOARD}/api/providers/${id}`, {
  method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}), { params: Promise.resolve({ id }) });
const lockKeys = (row) => Object.keys(row).filter((key) => key.startsWith("modelLock_") && row[key]);

describe("Doubao Web registry descriptor drives pairing", () => {
  it("issues a pairing with exactly the registry origin and the two required names, and the extension accepts it", async () => {
    const descriptor = mods.registry.find((entry) => entry.id === "doubao-web");
    expect(descriptor.cookieImport).toBeUndefined();
    expect(mods.contract.getCookieImportContract("doubao-web").config).toBe(descriptor.webLogin);

    const issued = await pairing();
    // No chunk prefix, optional cookie, hashed family, localStorage item or account email exists.
    expect(issued.contract).toEqual({ origin: DOLA, cookieNames: ["sessionid", "s_v_web_id"], cookiePrefixes: [] });
    expect(issued.contract.origin).toBe(descriptor.webLogin.origin);
    expect(issued.contract.cookieNames).toEqual(descriptor.webLogin.cookieNames);
    expect(mods.extension.PROVIDERS["doubao-web"]).toEqual({ label: "Doubao Web", origin: DOLA, cookieNames: descriptor.webLogin.cookieNames, cookiePrefixes: [] });
    const parsed = mods.capture.parsePairing(JSON.stringify({ pairing: issued }));
    expect(parsed).toMatchObject({ ok: true, plan: { providerOrigin: DOLA, cookieNames: ["sessionid", "s_v_web_id"], cookiePrefixes: [], optionalCookies: [], localStorageKeys: [], hashedCookiePrefixes: [] } });
    // A tampered pairing cannot narrow away a required cookie or move the origin.
    for (const [contract, code] of [
      [{ ...issued.contract, cookieNames: ["sessionid"] }, "invalid_pairing"],
      [{ ...issued.contract, origin: "https://www.doubao.com" }, "origin_mismatch"],
    ]) {
      expect(mods.capture.parsePairing(JSON.stringify({ ...issued, contract })).code).toBe(code);
    }
  });

  it("issues no pairing without management authority, operator authority or the dashboard origin", async () => {
    const body = { provider: "doubao-web", action: "create", name: "Denied" };
    guard.canAccessManagementApi.mockResolvedValueOnce(false);
    expect((await mods.pair(pairingRequest(body))).status).toBe(403);
    guard.isOperatorRequest.mockResolvedValueOnce(false);
    expect((await mods.pair(pairingRequest(body))).status).toBe(403);
    expect((await mods.pair(pairingRequest(body, { origin: DOLA }))).status).toBe(403);
    const email = await mods.pair(pairingRequest({ ...body, accountEmail: "synthetic@example.invalid" }));
    expect(await email.json()).toEqual({ error: "This provider takes no account email" });
    expect(mods.pairings.pendingPairingCount()).toBe(0);
    expect((await mods.importCookies(importRequest(null, { provider: "doubao-web", origin: DOLA, cookies: cookieList(A) }))).status).toBe(401);
    expect(await rows()).toEqual([]);
  });
});

describe("Doubao Web extension capture into the real import route", () => {
  it("reads only the two exact names from the tab's cookie store and stores only those", async () => {
    // Cookies a signed-in Dola page may also hold; none is approved, so none may be read or sent.
    const unapproved = ["ttwid", "fp", "sessionid_ss", "sid_guard", "sessionid.0", "sessionid.1"];
    const env = browser(signedInJar(A, Object.fromEntries(unapproved.map((name) => [name, stored(name, `synthetic-unapproved-${name}`)]))));
    const issued = await pairing();
    const { result, sent, fetch } = await capture(issued, env);

    expect(result).toMatchObject({ ok: true, action: "create", cookieCount: 2, connection: { name: "Dola" } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(env.calls.reads).toEqual(["sessionid", "s_v_web_id"].map((name) => ({ url: `${DOLA}/`, name, storeId: "tab-store" })));
    expect(env.calls.forbidden).toEqual([]);
    const grant = { permissions: ["cookies"], origins: [`${DOLA}/*`, `${DASHBOARD}/*`] };
    expect(env.calls.requested).toEqual([grant]);
    expect(env.calls.removed).toEqual([grant]);
    expect(sent[0].request.cookies.map((cookie) => cookie.name)).toEqual(["sessionid", "s_v_web_id"]);
    expect(sent[0].request).not.toHaveProperty("localStorage");

    const [row] = await rows();
    expect(row).toMatchObject({ id: result.connection.id, provider: "doubao-web", authType: "cookie", apiKey: headerOf(A) });
    const listed = await (await mods.providers.GET(new Request(`${DASHBOARD}/api/providers`))).text();
    expect(listed).toContain(row.id);
    expectNoSecrets(listed, ...secretsOf(A));
    expectNoSecrets([sent[0].response, result, logs], ...secretsOf(A), issued.token, "synthetic-unapproved");
  });

  it.each([
    ["only sessionid is present", () => { const jar = signedInJar(A); delete jar.s_v_web_id; return jar; }, "Required session cookie is missing or incomplete"],
    ["only sessionid and the fp fallback are present", () => ({ sessionid: stored("sessionid", A.sessionid), fp: stored("fp", A.s_v_web_id) }), "Required session cookie is missing or incomplete"],
    // The extension drops a cookie without the Secure flag before sending.
    ["s_v_web_id is not a Secure cookie", () => signedInJar(A, { s_v_web_id: stored("s_v_web_id", A.s_v_web_id, { secure: false }) }), "Required session cookie is missing or incomplete"],
    ["s_v_web_id belongs to another domain", () => signedInJar(A, { s_v_web_id: stored("s_v_web_id", A.s_v_web_id, { domain: ".doubao.com" }) }), "Required session cookie is missing or incomplete"],
    ["sessionid is expired", () => signedInJar(A, { sessionid: stored("sessionid", A.sessionid, { expirationDate: 1 }) }), "Cookie is expired"],
  ])("saves nothing when %s", async (_label, jar, error) => {
    const issued = await pairing();
    const { result, sent } = await capture(issued, browser(jar()));
    expect(result).toMatchObject({ ok: false, code: "rejected" });
    expect(sent).toMatchObject([{ status: 400, response: { error } }]);
    expect(await rows()).toEqual([]);
    expectNoSecrets([sent[0].response, result, logs], ...secretsOf(A), issued.token);
    // The pairing is spent by the refused attempt.
    expect((await submit(issued, { cookies: cookieList(A) })).status).toBe(401);
  });

  it.each(["https://dola.com/chat/", "https://www.doubao.com/chat/", "http://www.dola.com/chat/", "https://www.dola.com.example/"])(
    "reads no cookie and sends nothing from the tab %s", async (tabUrl) => {
      const env = browser(signedInJar(A), tabUrl);
      const { result, fetch } = await capture(await pairing(), env);
      expect(result).toMatchObject({ ok: false, code: "wrong_tab", expectedOrigin: DOLA });
      expect([env.calls.reads, env.calls.requested, fetch.mock.calls]).toEqual([[], [], []]);
      expect(await rows()).toEqual([]);
    });

  it.each([
    ["another origin", { origin: "https://www.doubao.com", cookies: cookieList(A) }, "Origin is not approved for this provider"],
    ["ttwid beside the required pair", { cookies: cookieList({ ...A, ttwid: "synthetic-ttwid" }) }, "Cookie name is not approved for this provider"],
    ["the fp fallback", { cookies: cookieList({ sessionid: A.sessionid, fp: A.s_v_web_id }) }, "Cookie name is not approved for this provider"],
    ["a chunked sessionid", { cookies: cookieList({ "sessionid.0": "synthetic-a", "sessionid.1": "synthetic-b", s_v_web_id: A.s_v_web_id }) }, "Cookie name is not approved for this provider"],
    ["a localStorage value", { cookies: cookieList(A), localStorage: { token: "synthetic" } }, "This provider takes no localStorage value"],
  ])("refuses a direct submission with %s", async (_label, body, error) => {
    const result = await submit(await pairing(), body);
    expect(result).toEqual({ status: 400, body: { error } });
    expect(await rows()).toEqual([]);
  });
});

describe("Doubao Web dashboard paste, cURL and HAR import", () => {
  const noisy = (value) => `ttwid=synthetic-ttwid; ${headerOf(value)}; fp=synthetic-fp`;
  const harEntry = (url, cookie) => ({ request: { url, headers: [{ name: "Cookie", value: cookie }] } });
  const har = (...entries) => JSON.stringify({ log: { entries } });
  const inputs = {
    header: () => mods.parser.parseCookieHeaderValue(`Cookie: ${noisy(A)}`),
    "curl -H": () => mods.parser.parseCurlCommand(`curl '${DOLA}/chat/completion?fp=synthetic' \\\n  -H 'Cookie: ${noisy(A)}' --data-raw '{}'`),
    "curl -b": () => mods.parser.parseCurlCommand(`curl ${DOLA}/chat/completion -b '${noisy(A)}'`),
    har: () => mods.parser.parseHarDocument(har(harEntry("https://www.doubao.com/chat", noisy(B)), harEntry(`${DOLA}/chat/completion`, noisy(A)))),
  };

  it.each(Object.keys(inputs))("imports a %s input as the two approved cookies", async (label) => {
    const contract = mods.contract.getCookieImportContract("doubao-web");
    const parsed = inputs[label]();
    expect(parsed.ok).toBe(true);
    const built = mods.parser.buildImportCandidates({ kind: label.split(" ")[0], parsed }, contract);
    expect(built.ok).toBe(true);
    expect(built.candidates).toHaveLength(1);
    expect(built.candidates[0].dropped.sort()).toEqual(["fp", "ttwid"]);
    // The same body shape the dashboard import dialog posts.
    const imported = await submit(await pairing(), { origin: built.candidates[0].origin, cookies: built.candidates[0].cookies, name: "Dola" });
    expect(imported.status).toBe(201);
    expect((await rows()).map((row) => row.apiKey)).toEqual([headerOf(A)]);
    expectNoSecrets([imported.body, logs], ...secretsOf(A, B));
  });

  it("makes the operator choose between two accounts in one HAR, and refuses unusable input without echoing it", async () => {
    const contract = mods.contract.getCookieImportContract("doubao-web");
    const two = mods.parser.buildImportCandidates({ kind: "har", parsed: mods.parser.parseHarDocument(har(harEntry(`${DOLA}/a`, headerOf(A)), harEntry(`${DOLA}/b`, headerOf(B)))) }, contract);
    expect(two.candidates).toHaveLength(2);
    expect(mods.parser.candidatesAreAmbiguous(two.candidates)).toBe(true);

    const refusals = [
      ["curl", mods.parser.parseCurlCommand(`curl https://www.doubao.com/chat -b '${headerOf(A)}'`), "The request origin is not approved for this provider."],
      ["har", mods.parser.parseHarDocument(har(harEntry("https://dola.com/chat", headerOf(A)))), `The HAR file has no request to ${DOLA}.`],
      ["header", mods.parser.parseCookieHeaderValue(`sessionid=${A.sessionid}; fp=${A.s_v_web_id}`), "The input has no s_v_web_id cookie."],
      ["header", mods.parser.parseCookieHeaderValue(`sessionid.0=${A.sessionid}; s_v_web_id=${A.s_v_web_id}`), "The input has no sessionid cookie."],
    ];
    for (const [kind, parsed, error] of refusals) {
      expect(mods.parser.buildImportCandidates({ kind, parsed }, contract)).toEqual({ ok: false, error });
    }
  });
});

describe("Doubao Web update ownership", () => {
  it("replaces only the paired account and keeps its proxy and its sibling", async () => {
    const a = await addAccount("alpha", A, 1);
    const b = await addAccount("bravo", B, 2);
    expect((await putProvider(a, { connectionProxyEnabled: true, connectionProxyUrl: PROXY_URL })).status).toBe(200);
    const before = { a: await rowById(a), b: await rowById(b) };

    // A pairing for account A cannot be redirected to account B, and the attempt spends it.
    const redirected = await updatePairing(a);
    expect(await submit(redirected, { connectionId: b, cookies: cookieList(C) })).toEqual({ status: 409, body: { error: "Pairing does not match this request" } });
    expect((await submit(redirected, { connectionId: a, cookies: cookieList(C) })).status).toBe(401);
    expect({ a: await rowById(a), b: await rowById(b) }).toEqual(before);

    const foreign = await mods.db.createProviderConnection({ provider: "grok-web", authType: "cookie", name: "foreign", apiKey: "sso=synthetic" });
    for (const [connectionId, status] of [[foreign.id, 409], ["missing-connection", 404]]) {
      expect((await mods.pair(pairingRequest({ provider: "doubao-web", action: "update", connectionId }))).status).toBe(status);
    }

    // The extension performs the replacement, with no connection name in its request.
    const { result, sent } = await capture(await updatePairing(a), browser(signedInJar(C)));
    expect(result).toMatchObject({ ok: true, action: "update", connection: { id: a } });
    expect(sent[0].request).toMatchObject({ connectionId: a });
    expect(sent[0].request).not.toHaveProperty("name");
    const after = await rowById(a);
    expect(after).toMatchObject({ apiKey: headerOf(C), name: "alpha", testStatus: "active" });
    expect(after.providerSpecificData).toEqual(before.a.providerSpecificData);
    expect(await rowById(b)).toEqual(before.b);
    expect(await rows()).toHaveLength(2);
    expectNoSecrets([sent[0].response, result, logs], ...secretsOf(A, B, C));
  });
});

describe("Doubao Web imported credentials reach the executor", () => {
  async function proxiedPair() {
    const direct = await addAccount("direct", A, 1);
    const proxied = await addAccount("proxied", B, 2);
    expect((await putProvider(proxied, { connectionProxyEnabled: true, connectionProxyUrl: PROXY_URL })).status).toBe(200);
    // The provider update re-ranks accounts, so pin the order: the direct account is tried first.
    await mods.db.updateProviderConnection(direct, { priority: 1 });
    expect((await rows()).map((row) => row.id)).toEqual([direct, proxied]);
    return { direct, proxied };
  }
  /** One POST to Dola carrying exactly one account's cookie, fingerprint and route. */
  function expectSend(call, own, other, proxied) {
    const url = new URL(call.url);
    expect([url.origin, url.pathname, call.method, call.proxied]).toEqual([DOLA, "/chat/completion", "POST", proxied]);
    expect(url.searchParams.get("fp")).toBe(own.s_v_web_id);
    expect(call.headers.get("cookie")).toBe(headerOf(own));
    expect(call.headers.get("origin")).toBe(DOLA);
    expect(call.headers.get("authorization")).toBeNull();
    expect(JSON.parse(call.body).ext.fp).toBe(own.s_v_web_id);
    expect(call.body).not.toContain(own.sessionid);
    expectNoSecrets([call.url, [...call.headers], call.body], ...secretsOf(other));
  }

  it.each([
    ["JSON", false, "dola-speed", 0],
    ["stream", true, "dola-pro", 3],
  ])("sends the chosen account through its own proxy (%s)", async (_label, stream, model, deepThink) => {
    const { direct } = await proxiedPair();
    await mods.db.updateProviderConnection(direct, { isActive: false });
    reply = () => answer("synthetic answer");
    const res = await chat({ model: `doubao-web/${model}`, stream });
    expect(res.status).toBe(200);
    if (stream) {
      expect(res.text).toContain('"content":"synthetic answer"');
      expect(res.text).toContain("data: [DONE]");
    } else {
      expect(JSON.parse(res.text).choices[0].message.content).toBe("synthetic answer");
    }
    expect(wire).toHaveLength(1);
    expectSend(wire[0], B, A, true);
    expect(JSON.parse(wire[0].body).option.need_deep_think).toBe(deepThink);
    expect(JSON.parse(wire[0].body).messages[0].content_block[0].content.text_block.text).toBe("user: synthetic question");
    expectNoSecrets(res.text, ...secretsOf(A, B));
    expectNoSecrets(logs, ...secretsOf(A, B));
  });

  it("falls back from a rejected session to the sibling's own cookie and proxy, then accepts a re-import", async () => {
    const { direct, proxied } = await proxiedPair();
    const siblingKey = (await rowById(proxied)).apiKey;
    reply = (call) => (call.headers.get("cookie") === headerOf(A) ? new Response("session expired", { status: 401 }) : answer("from sibling"));

    const res = await chat();
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text).choices[0].message.content).toBe("from sibling");
    expect(wire).toHaveLength(2);
    expectSend(wire[0], A, B, false);
    expectSend(wire[1], B, A, true);
    const rejected = await rowById(direct);
    expect(lockKeys(rejected).length).toBeGreaterThan(0);
    expectNoSecrets(rejected.lastError, ...secretsOf(A, B));
    expect((await rowById(proxied)).apiKey).toBe(siblingKey);
    // Only the session cookie is asserted for logs: the fingerprint leak is a recorded defect.
    expect(logs.length).toBeGreaterThan(0);
    expectNoSecrets(logs, A.sessionid, B.sessionid, headerOf(A), headerOf(B));

    const replaced = await submit(await updatePairing(direct), { connectionId: direct, cookies: cookieList(C) });
    expect(replaced.status).toBe(200);
    expect(lockKeys(await rowById(direct))).toEqual([]);
    await mods.db.updateProviderConnection(proxied, { isActive: false });
    wire = [];
    reply = () => answer("fresh");
    expect((await chat()).status).toBe(200);
    expect(wire).toHaveLength(1);
    expectSend(wire[0], C, A, false);
  });

  it("redacts a whole echoed Cookie header from the client error and the saved account error", async () => {
    const id = await addAccount("only", A, 1);
    reply = () => new Response(`rejected ${headerOf(A)}`, { status: 401 });
    const res = await chat();
    expect(res.status).toBe(401);
    expectNoSecrets(res.text, ...secretsOf(A));
    expectNoSecrets((await rowById(id)).lastError, ...secretsOf(A));
  });

  it.each([
    ["an HTML sign-in page", () => new Response("<html>sign in</html>", { headers: { "content-type": "text/html" } })],
    ["a JSON error body", () => Response.json({ code: 1, message: "synthetic login expired" })],
  ])("never reports HTTP 200 with %s as a completion", async (_label, upstream) => {
    for (const stream of [false, true]) {
      for (const row of await rows()) await mods.db.deleteProviderConnection(row.id);
      const id = await addAccount(`only-${stream}`, A, 1);
      reply = upstream;
      const res = await chat({ stream });
      if (stream) {
        expect(res.text).toContain('"error"');
        expect(res.text).not.toContain('"content"');
      } else {
        expect(res.status).toBe(502);
        expect(JSON.parse(res.text)).toHaveProperty("error");
      }
      expectNoSecrets(res.text, ...secretsOf(A));
      await vi.waitFor(async () => expect((await rowById(id)).lastError).toMatch(/empty/i));
    }
  });

  it.each([
    ["sessionid without any fingerprint", `sessionid=${A.sessionid}`],
    ["a fingerprint without sessionid", `s_v_web_id=${A.s_v_web_id}`],
  ])("refuses a saved cookie holding %s before any request", async (_label, apiKey) => {
    await mods.db.createProviderConnection({ provider: "doubao-web", authType: "cookie", name: "partial", apiKey });
    const res = await chat();
    expect(res.status).toBe(401);
    expect(wire).toEqual([]);
    expectNoSecrets(res.text, ...secretsOf(A));
  });
});
