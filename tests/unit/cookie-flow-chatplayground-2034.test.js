/**
 * #2034: ChatPlayground cookie capture, import and stored-credential use, offline.
 * Evidence and limits: internal/docs/port-reports/cookie-flows/chatplayground-2034.md.
 *
 * Real: the registry descriptor (never replaced), the extension capture module, the
 * dashboard parsers, the pairing, import, provider, discovery, test and validate routes,
 * a private SQLite database, handleChat, account fallback and ChatPlaygroundExecutor.
 * Mocked: operator authority, the browser's chrome.* API, every outbound byte
 * (proxyAwareFetch; global fetch is closed) and the proxy reachability ping.
 * Every credential is synthetic. No browser or provider is contacted.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { format } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const boundary = vi.hoisted(() => ({
  upstream: vi.fn(),
  operator: vi.fn(),
  proxyPing: vi.fn(),
}));
vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-cookie-machine-id" }));
vi.mock("@/dashboardGuard", async (importOriginal) => ({
  ...(await importOriginal()),
  canAccessManagementApi: boundary.operator,
  canManageAccessConfig: boundary.operator,
  isOperatorRequest: boundary.operator,
  hasExactRequestOrigin: () => true,
}));
vi.mock("open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: boundary.upstream,
}));
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl: boundary.proxyPing }));

const ID = "chatplayground";
const WEB = "https://web.chatplayground.ai";
const API = `${WEB}/api`;
const CLERK = "https://clerk.chatplayground.ai";
const DASHBOARD = "https://dashboard.example";
const MODEL = "gpt-6-luna";

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const sessionJwt = (tag) => `${encode({ alg: "none" })}.${encode({ sid: `sess_${tag}` })}.signature-${tag}`;
/** One synthetic account: the two cookies and the Bearer token the mocked Clerk mints for it. */
function account(tag) {
  const client = `synthetic-client-${tag}`;
  const session = sessionJwt(tag);
  const minted = `synthetic-minted-${tag}`;
  return { tag, client, session, minted, header: `__client=${client}; __session=${session}`, secrets: [client, session, minted] };
}
const A = account("alpha");
const B = account("bravo");
const C = account("charlie");
const DECOY = "synthetic-unapproved-value";
const SECRETS = [...A.secrets, ...B.secrets, ...C.secrets, DECOY];

let root;
let db;
let routes;
let extension;
let parser;
let contract;
let sent;
let expiredClients;
let closedFetch;
let logs;

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sse = (...events) => `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;

/**
 * The closed upstream. It follows DurinDoor's executor wire contract, which is a model
 * and not observed provider behaviour: Clerk mints from `__client` plus the session id,
 * and /api/me answers only to the minted Bearer token. Any other URL fails the test.
 */
async function wire(url, init = {}, proxyOptions = null) {
  const headers = new Headers(init.headers);
  sent.push({ url: String(url), method: init.method || "GET", headers, body: init.body, redirect: init.redirect, proxy: proxyOptions });
  const mint = String(url).match(/^https:\/\/clerk\.chatplayground\.ai\/v1\/client\/sessions\/sess_([a-z]+)\/tokens\?/);
  if (mint) {
    const owner = [A, B, C].find((candidate) => candidate.tag === mint[1]);
    const accepted = owner && headers.get("cookie") === `__client=${owner.client}` && !expiredClients.has(owner.client);
    return accepted ? reply({ jwt: owner.minted }) : reply({ error: "session expired" }, 401);
  }
  const bearer = [A, B, C].some((candidate) => headers.get("authorization") === `Bearer ${candidate.minted}`);
  if (url === `${API}/me`) return bearer ? reply({ user: {} }) : reply({ error: "unauthorized" }, 401);
  if (url === `${API}/models`) return reply([{ slug: MODEL, displayName: "Synthetic Luna", group: "chat" }]);
  if (url === `${API}/chat` && bearer) {
    return new Response(sse({ type: "text-delta", delta: "synthetic pong" }, { type: "finish", finishReason: "stop" }));
  }
  throw new Error(`closed mock: unexpected request ${init.method || "GET"} ${url}`);
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-flow-chatplayground-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) vi.stubEnv(key, undefined);
  vi.stubEnv("BASE_URL", DASHBOARD);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.example");
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  sent = [];
  expiredClients = new Set();
  boundary.upstream.mockReset().mockImplementation(wire);
  boundary.operator.mockReset().mockResolvedValue(true);
  boundary.proxyPing.mockReset().mockResolvedValue({ ok: true });
  logs = ["log", "info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  db = await import("@/lib/db/index.js");
  routes = {
    pair: await import("../../src/app/api/providers/cookie-import/pairing/route.js"),
    import: await import("../../src/app/api/providers/cookie-import/route.js"),
    providers: await import("../../src/app/api/providers/route.js"),
    provider: await import("../../src/app/api/providers/[id]/route.js"),
    discovery: await import("../../src/app/api/providers/[id]/models/route.js"),
    test: await import("../../src/app/api/providers/[id]/test/route.js"),
    validate: await import("../../src/app/api/providers/validate/route.js"),
    chat: await import("../../src/sse/handlers/chat.js"),
    models: await import("../../src/app/api/v1/models/route.js"),
  };
  extension = {
    ...(await import("../../extensions/provider-cookie-capture/capture.js")),
    ...(await import("../../extensions/provider-cookie-capture/providers.js")),
  };
  parser = await import("../../src/shared/utils/cookieImportParser.js");
  contract = (await import("../../src/lib/providers/cookieImport/contract.js")).getCookieImportContract(ID);
  // Closed after the imports: loading the proxy module patches global fetch.
  closedFetch = vi.fn((url) => { throw new Error(`closed mock: direct fetch ${String(url)}`); });
  vi.stubGlobal("fetch", closedFetch);
}, 60_000);

afterEach(async () => {
  await disposeLoadedRequestDetailsRepo();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

const request = (url, body, method = "POST", headers = {}) =>
  new NextRequest(`${DASHBOARD}${url}`, {
    method,
    headers: { "content-type": "application/json", origin: DASHBOARD, ...headers },
    ...(method === "GET" ? null : { body: JSON.stringify(body) }),
  });
const params = (id) => ({ params: Promise.resolve({ id }) });

const mintPairing = (body) => routes.pair.POST(request("/api/providers/cookie-import/pairing", { provider: ID, ...body }));
async function pairing(body) {
  const response = await mintPairing(body);
  expect(response.status).toBe(201);
  return (await response.json()).pairing;
}
const submit = (paired, body) =>
  routes.import.POST(request("/api/providers/cookie-import", body, "POST", { [paired.header]: paired.token }));

const stored = async () => (await db.getProviderConnections({ provider: ID })).sort((x, y) => x.name.localeCompare(y.name));
const byName = async (name) => (await stored()).find((row) => row.name === name);
const logged = () => logs.flatMap((spy) => spy.mock.calls).map((call) => format(...call)).join("\n");
function expectNoSecrets(text) {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

/**
 * A browser cookie jar behind chrome.cookies.get: a cookie is returned only for its own
 * store and only when the requested host is covered by its domain (host-only when the
 * domain has no leading dot). Whole-jar reads and script injection fail.
 */
function browser(jar, { tabUrl = `${WEB}/` } = {}) {
  const calls = [];
  const held = new Set();
  const names = (query) => [...(query.permissions ?? []), ...(query.origins ?? [])];
  const covers = (entry, host) => entry.domain === host || (entry.domain.startsWith(".") && `.${host}`.endsWith(entry.domain));
  const chrome = {
    tabs: {
      query: async () => [{ id: 7, url: tabUrl }],
      get: async (id) => ({ id, url: tabUrl }),
    },
    permissions: {
      contains: async (query) => names(query).every((name) => held.has(name)),
      request: async (query) => { calls.push(["request", structuredClone(query)]); names(query).forEach((name) => held.add(name)); return true; },
      remove: async (query) => { calls.push(["remove", structuredClone(query)]); names(query).forEach((name) => held.delete(name)); return true; },
    },
    cookies: {
      getAll: async () => { throw new Error("ChatPlayground capture must not enumerate cookies"); },
      getAllCookieStores: async () => [{ id: "other-profile", tabIds: [99] }, { id: "tab-store", tabIds: [7] }],
      get: async (details) => {
        calls.push(["get", { ...details }]);
        const host = new URL(details.url).hostname;
        return jar.find((entry) => entry.name === details.name && entry.storeId === details.storeId && covers(entry, host)) ?? null;
      },
    },
    scripting: { executeScript: async () => { throw new Error("ChatPlayground capture must not inject scripts"); } },
  };
  return { chrome, calls };
}
const browserCookie = (name, value, extra = {}) =>
  ({ name, value, domain: ".chatplayground.ai", secure: true, storeId: "tab-store", ...extra });
const signedIn = (who) => [
  browserCookie("__client", who.client),
  browserCookie("__session", who.session, { domain: "web.chatplayground.ai" }),
];

/** Dashboard pairing -> extension review -> one confirmed send into the real import route. */
async function captureWith(chrome, target) {
  const paired = await pairing(target);
  const prepared = await extension.prepareCapture({ chrome, text: JSON.stringify({ pairing: paired }) });
  expect(prepared.ok, prepared.code).toBe(true);
  const exchanges = [];
  const fetch = async (url, init) => {
    const response = await routes.import.POST(new NextRequest(url, {
      method: init.method, headers: { ...init.headers, origin: "chrome-extension://synthetic" }, body: init.body,
    }));
    exchanges.push({ url, body: JSON.parse(init.body), status: response.status, text: await response.clone().text() });
    return response;
  };
  const result = await extension.runCapture({
    chrome, fetch, plan: prepared.plan, confirmed: extension.confirmationFor(prepared.plan),
  });
  return { paired, plan: prepared.plan, result, exchanges };
}

/** Parse locally the way the dialog does, then post the chosen candidate through the same two routes. */
function readInput(text) {
  const kind = text.startsWith("curl ") ? "curl" : text.startsWith("{") ? "har" : "header";
  const parse = { curl: parser.parseCurlCommand, har: parser.parseHarDocument, header: parser.parseCookieHeaderValue }[kind];
  const parsed = parse(text);
  if (!parsed.ok) return parsed;
  return parser.buildImportCandidates({ kind, parsed }, contract);
}

async function dashboardImport(candidate, target) {
  const paired = await pairing(target);
  return submit(paired, {
    provider: ID, origin: candidate.origin, cookies: candidate.cookies,
    ...(target.action === "create" ? { name: target.name } : { connectionId: target.connectionId }),
  });
}

const har = (...requests) => JSON.stringify({ log: { entries: requests.map(([url, cookie]) =>
  ({ request: { url, headers: [{ name: "Cookie", value: cookie }] } })) } });

describe("ChatPlayground descriptor", () => {
  it("is the active registry entry that capture, import and dispatch all resolve", async () => {
    const { default: descriptor, chatplaygroundCookieProfile } = await import("../../open-sse/providers/registry/chatplayground.js");
    const { default: REGISTRY } = await import("../../open-sse/providers/registry/index.js");
    const { getExecutor } = await import("../../open-sse/executors/index.js");
    const { ChatPlaygroundExecutor } = await import("../../open-sse/executors/chatplayground.js");
    const { isHiddenProvider } = await import("@/shared/constants/providers");

    expect(REGISTRY.find((entry) => entry.id === ID)).toBe(descriptor);
    // The narrow import profile, not the web sign-in block, drives the import contract.
    expect(contract.config).toBe(chatplaygroundCookieProfile);
    expect(contract).toMatchObject({ authType: "cookie", origin: WEB, extensionCapture: true, cookiePrefixes: [] });
    expect(contract.optionalCookies).toBeUndefined();
    expect(contract.localStorageKeys).toBeUndefined();
    expect(getExecutor(ID)).toBeInstanceOf(ChatPlaygroundExecutor);
    expect(getExecutor("cpl")).toBeInstanceOf(ChatPlaygroundExecutor);
    expect(isHiddenProvider(ID)).toBe(false);
  });
});

describe("ChatPlayground extension capture into the real import routes", () => {
  it("reads two exact names from the tab's store, saves an encrypted cookie connection and leaks nothing", async () => {
    const jar = [
      ...signedIn(A),
      browserCookie("__client", B.client, { storeId: "other-profile" }),
      ...["__client_uat", "__session_SYNTH", "__session.0", "cf_clearance"].map((name) => browserCookie(name, DECOY)),
    ];
    const { chrome, calls } = browser(jar);
    const { paired, plan, result, exchanges } = await captureWith(chrome, { action: "create", name: "Captured" });

    expect(paired.contract).toEqual({ origin: WEB, cookieNames: ["__client", "__session"], cookiePrefixes: [] });
    expect(calls.filter(([kind]) => kind === "get").map(([, details]) => details)).toEqual(
      ["__client", "__session"].map((name) => ({ url: `${WEB}/`, name, storeId: "tab-store" })),
    );
    const grant = { permissions: ["cookies"], origins: [`${WEB}/*`, `${DASHBOARD}/*`] };
    expect(calls.filter(([kind]) => kind !== "get")).toEqual([["request", grant], ["remove", grant]]);

    expect(result).toMatchObject({ ok: true, action: "create", cookieCount: 2 });
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]).toMatchObject({ url: `${DASHBOARD}/api/providers/cookie-import`, status: 201 });
    expect(exchanges[0].body).toEqual({
      provider: ID, origin: WEB,
      cookies: [
        { name: "__client", value: A.client, domain: "chatplayground.ai", secure: true },
        { name: "__session", value: A.session, domain: "web.chatplayground.ai", secure: true },
      ],
    });
    expect(plan.token).toBe("");

    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: ID, authType: "cookie", name: "Captured", apiKey: A.header, isActive: true });
    const adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    expectNoSecrets(JSON.stringify(adapter.all("SELECT * FROM providerConnections")));

    const list = await (await routes.providers.GET(request("/api/providers", null, "GET"))).text();
    const detail = await (await routes.provider.GET(request(`/api/providers/${rows[0].id}`, null, "GET"), params(rows[0].id))).text();
    expect(list).toContain(rows[0].id);
    expect(detail).toContain(rows[0].id);
    for (const text of [JSON.stringify(result), exchanges[0].text, list, detail, logged()]) expectNoSecrets(text);
    // Import is structural: nothing leaves the gateway.
    expect(sent).toEqual([]);
    expect(closedFetch).not.toHaveBeenCalled();
  });

  it("cannot be widened to other cookies or localStorage by an edited pairing", async () => {
    const paired = await pairing({ action: "create", name: "Widened" });
    const edited = { ...paired, contract: {
      ...paired.contract,
      cookieNames: [...paired.contract.cookieNames, "__client_uat"],
      cookiePrefixes: ["__session."],
      optionalCookies: ["cf_clearance"],
      localStorageKeys: ["clerk-db-jwt"],
    } };
    const parsed = extension.parsePairing(JSON.stringify(edited));
    expect(parsed.plan).toMatchObject({
      cookieNames: ["__client", "__session"], cookiePrefixes: [], optionalCookies: [], localStorageKeys: [],
    });
  });

  it.each([`${CLERK}/`, "https://app.chatplayground.ai/", "http://web.chatplayground.ai/", "https://web.chatplayground.ai.evil.example/"])(
    "refuses a %s tab before any cookie read", async (tabUrl) => {
      const { chrome, calls } = browser(signedIn(A), { tabUrl });
      const paired = await pairing({ action: "create", name: "Wrong tab" });
      await expect(extension.prepareCapture({ chrome, text: JSON.stringify(paired) }))
        .resolves.toMatchObject({ ok: false, code: "wrong_tab", expectedOrigin: WEB });
      expect(calls).toEqual([]);
      expect(await stored()).toEqual([]);
    });

  it.each([
    ["an expired __session", [signedIn(A)[0], { ...signedIn(A)[1], expirationDate: 1 }]],
    // The live cookie scope is unproved. With this scope, a web-origin capture cannot succeed.
    ["__client held host-only by the Clerk host", [browserCookie("__client", A.client, { domain: "clerk.chatplayground.ai" }), signedIn(A)[1]]],
    ["a non-secure __client", [{ ...signedIn(A)[0], secure: false }, signedIn(A)[1]]],
    ["__client from another browser profile", [{ ...signedIn(A)[0], storeId: "other-profile" }, signedIn(A)[1]]],
  ])("keeps the stored session unchanged for %s", async (_label, jar) => {
    await dashboardImport(readInput(B.header).candidates[0], { action: "create", name: "Existing" });
    const before = await byName("Existing");

    const { paired, result, exchanges } = await captureWith(browser(jar).chrome, { action: "update", connectionId: before.id });

    expect(result).toMatchObject({ ok: false, code: "rejected" });
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].status).toBe(400);
    expect((await submit(paired, exchanges[0].body)).status).toBe(401);
    expect(await stored()).toEqual([before]);
    for (const text of [JSON.stringify(result), exchanges[0].text, logged()]) expectNoSecrets(text);
  });

  it("sends nothing when only chunk-style names exist", async () => {
    const jar = ["__client.0", "__session.0", "__session.1"].map((name) => browserCookie(name, DECOY));
    const { result, exchanges } = await captureWith(browser(jar).chrome, { action: "create", name: "Chunks" });
    expect(result).toMatchObject({ ok: false, code: "no_cookies" });
    expect(exchanges).toEqual([]);
    expect(await stored()).toEqual([]);
  });
});

describe("ChatPlayground dashboard input modes", () => {
  const noisy = `${A.header}; __client_uat=${DECOY}; cf_clearance=${DECOY}; __session.0=${DECOY}`;

  it.each([
    ["a pasted Cookie header", `Cookie: ${noisy}`],
    ["a cURL -H command", `curl '${API}/me' -H 'accept: */*' -H 'cookie: ${noisy}'`],
    ["a cURL -b command", `curl -b '${noisy}' '${API}/models'`],
    ["a HAR export", har([`${CLERK}/v1/client`, `__client=${DECOY}`], [`${API}/me`, noisy])],
  ])("stores only the two approved cookies from %s", async (_label, input) => {
    const built = readInput(input);
    expect(built.ok, built.error).toBe(true);
    expect(built.candidates).toHaveLength(1);
    const response = await dashboardImport(built.candidates[0], { action: "create", name: "Pasted" });
    expect(response.status).toBe(201);
    expectNoSecrets(await response.text());
    expect((await byName("Pasted")).apiKey).toBe(A.header);
    expect(sent).toEqual([]);
    expect(closedFetch).not.toHaveBeenCalled();
    expectNoSecrets(logged());
  });

  it.each([
    ["a Clerk-origin cURL command", `curl '${CLERK}/v1/client' -H 'cookie: ${A.header}'`, /origin is not approved/],
    ["a legacy app-origin cURL command", `curl 'https://app.chatplayground.ai/api/user' -b '${A.header}'`, /origin is not approved/],
    ["a HAR with no web-origin request", har([`${CLERK}/v1/client`, A.header]), /no request to https:\/\/web\.chatplayground\.ai/],
    ["cookies split across HAR requests", har([`${API}/me`, `__session=${A.session}`], [`${API}/models`, `__client=${B.client}`]), /no request to/],
    ["a header without __client", `__session=${A.session}`, /no __client cookie/],
    ["a header without __session", `__client=${A.client}`, /no __session cookie/],
    ["chunk-style session names", `__client=${A.client}; __session.0=${DECOY}; __session.1=${DECOY}`, /no __session cookie/],
    // The executor accepts a bare Clerk JWT on a manually added connection; cookie import does not.
    ["a bare Bearer JWT", `Bearer ${A.session}`, /No cookie name=value pair/],
  ])("refuses %s without echoing a value", (_label, input, message) => {
    const built = readInput(input);
    expect(built).toMatchObject({ ok: false, error: expect.stringMatching(message) });
    expectNoSecrets(built.error);
  });

  it("makes the operator choose between two accounts in one HAR and imports only the chosen one", async () => {
    const built = readInput(har([`${API}/me`, A.header], [`${API}/models`, B.header]));
    expect(built.candidates).toHaveLength(2);
    expect(parser.candidatesAreAmbiguous(built.candidates)).toBe(true);
    expect((await dashboardImport(built.candidates[1], { action: "create", name: "Chosen" })).status).toBe(201);
    expect((await stored()).map((row) => row.apiKey)).toEqual([B.header]);
  });
});

describe("ChatPlayground import API boundary", () => {
  const cookies = () => [{ name: "__client", value: C.client }, { name: "__session", value: C.session }];

  it("needs operator authority to pair, and the pairing secret to import", async () => {
    boundary.operator.mockResolvedValue(false);
    expect((await mintPairing({ action: "create", name: "Nope" })).status).toBe(403);
    boundary.operator.mockResolvedValue(true);
    const response = await routes.import.POST(request("/api/providers/cookie-import",
      { provider: ID, origin: WEB, cookies: cookies(), name: "Nope" }, "POST", { "x-9r-cli-token": "synthetic-operator" }));
    expect(response.status).toBe(401);
    expect(await stored()).toEqual([]);
  });

  it.each([
    ["the Clerk origin", { origin: CLERK }],
    ["the legacy app origin", { origin: "https://app.chatplayground.ai" }],
    ["a Clerk-host cookie domain", { cookies: [{ ...cookies()[0], domain: "clerk.chatplayground.ai" }, cookies()[1]] }],
    ["an expired cookie", { cookies: [{ ...cookies()[0], expirationDate: 1 }, cookies()[1]] }],
    ["an extra Clerk cookie", { cookies: [...cookies(), { name: "__client_uat", value: DECOY }] }],
    ["a session chunk", { cookies: [...cookies(), { name: "__session.0", value: DECOY }] }],
    ["a localStorage value", { localStorage: { "clerk-db-jwt": DECOY } }],
  ])("rejects %s, stores nothing and spends the pairing", async (_label, override) => {
    const paired = await pairing({ action: "create", name: "Rejected" });
    const body = { provider: ID, origin: WEB, cookies: cookies(), name: "Rejected", ...override };
    const response = await submit(paired, body);
    expect(response.status).toBe(400);
    expectNoSecrets(await response.text());
    expect((await submit(paired, { provider: ID, origin: WEB, cookies: cookies(), name: "Rejected" })).status).toBe(401);
    expect(await stored()).toEqual([]);
    expect(sent).toEqual([]);
    expectNoSecrets(logged());
  });

  it("binds an update to one ChatPlayground connection", async () => {
    for (const [name, who] of [["Alpha", A], ["Bravo", B]]) {
      await dashboardImport(readInput(who.header).candidates[0], { action: "create", name });
    }
    const foreign = await db.createProviderConnection({ provider: "grok-web", authType: "cookie", name: "Foreign", apiKey: `sso=${DECOY}` });
    expect((await mintPairing({ action: "update", connectionId: foreign.id })).status).toBe(409);

    const before = await stored();
    const [alpha, bravo] = before;
    const paired = await pairing({ action: "update", connectionId: bravo.id });
    const redirected = await submit(paired, { provider: ID, origin: WEB, cookies: cookies(), connectionId: alpha.id });
    expect(redirected.status).toBe(409);
    expectNoSecrets(await redirected.text());
    expect(await stored()).toEqual(before);
  });
});

/** Two accounts imported through the real routes, each bound to its own proxy; Bravo is preferred. */
async function importTwoProxiedAccounts() {
  const proxies = {};
  for (const [name, who, priority] of [["Alpha", A, 2], ["Bravo", B, 1]]) {
    expect((await captureWith(browser(signedIn(who)).chrome, { action: "create", name })).result.ok).toBe(true);
    const { id } = await byName(name);
    const proxyUrl = `http://proxy-${who.tag}.invalid:8080`;
    const pool = await db.createProxyPool({ name: `pool-${who.tag}`, proxyUrl, strictProxy: true });
    const updated = await routes.provider.PUT(
      request(`/api/providers/${id}`, { proxyPoolId: pool.id, priority }, "PUT"), params(id));
    expect(updated.status).toBe(200);
    expectNoSecrets(await updated.text());
    proxies[name] = { id, proxyUrl, poolId: pool.id };
  }
  return proxies;
}

const chat = () => routes.chat.handleChat(request("/v1/chat/completions",
  { model: `${ID}/${MODEL}`, stream: false, messages: [{ role: "user", content: "synthetic ping" }] }));

/**
 * Besides the executor, chat and /v1/models start a generic OpenAI-style catalog
 * lookup, the only /api/models request here that carries Authorization. Its header
 * is a product defect (port report, finding 1), so nothing below requires or
 * approves it. Only its containment is asserted, which also holds if a repair
 * removes the lookup.
 */
const isCatalogLookup = (call) => call.url === `${API}/models` && call.headers.has("authorization");
const executorCalls = () => sent.filter((call) => !isCatalogLookup(call));
function expectContainedLookups(...owners) {
  for (const call of sent.filter(isCatalogLookup)) {
    const carried = [A, B, C].filter((who) => who.secrets.some((secret) => call.headers.get("authorization").includes(secret)));
    expect(carried).toHaveLength(1);
    const owner = owners.find(([who]) => who === carried[0]);
    expect(owner, `unexpected account ${carried[0].tag}`).toBeDefined();
    expect(call).toMatchObject({ method: "GET", redirect: "manual", proxy: { connectionProxyUrl: owner[1].proxyUrl } });
  }
}

/** The four executor requests of one chat, all for one account through that account's proxy. */
function expectDispatch(calls, who, proxy) {
  expect(calls.map((call) => `${call.method} ${call.url.split("?")[0]}`)).toEqual([
    `POST ${CLERK}/v1/client/sessions/sess_${who.tag}/tokens`,
    `GET ${API}/me`, `GET ${API}/models`, `POST ${API}/chat`,
  ]);
  expect(calls.map((call) => call.headers.get("cookie"))).toEqual([`__client=${who.client}`, null, null, null]);
  expect(calls.map((call) => call.headers.get("authorization")))
    .toEqual([null, `Bearer ${who.minted}`, null, `Bearer ${who.minted}`]);
  for (const call of calls) {
    expect(call.proxy).toMatchObject({ connectionProxyEnabled: true, connectionProxyUrl: proxy.proxyUrl, strictProxy: true });
  }
  expect(JSON.parse(calls[3].body)).toMatchObject({ modelSlug: MODEL, message: { text: "synthetic ping" }, noSave: true });
}

describe("ChatPlayground stored credential consumption", () => {
  it("dispatches chat and discovery with one imported account through its own proxy", async () => {
    const proxies = await importTwoProxiedAccounts();

    const response = await chat();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text).choices[0].message.content).toBe("synthetic pong");
    expectDispatch(executorCalls(), B, proxies.Bravo);
    expectContainedLookups([B, proxies.Bravo]);

    sent.length = 0;
    const { id } = proxies.Bravo;
    const discovery = await routes.discovery.GET(request(`/api/providers/${id}/models`, null, "GET"), params(id));
    const catalog = await discovery.text();
    expect(JSON.parse(catalog).models).toEqual([{ id: MODEL, name: "Synthetic Luna" }]);
    expect(executorCalls().map((call) => [call.url, call.headers.get("cookie"), call.proxy?.connectionProxyUrl]))
      .toEqual([[`${API}/models`, B.header, proxies.Bravo.proxyUrl]]);
    expectContainedLookups([B, proxies.Bravo]);

    expect(closedFetch).not.toHaveBeenCalled();
    for (const output of [text, catalog, logged()]) expectNoSecrets(output);
  });

  it("lists the imported account's models without leaving its origin or proxy", async () => {
    const proxies = await importTwoProxiedAccounts();
    const listed = await routes.models.GET(request("/v1/models", null, "GET"));
    expect(listed.status).toBe(200);
    expectContainedLookups([B, proxies.Bravo], [A, proxies.Alpha]);
    expect(executorCalls()).toEqual([]);
    // Other providers' keyless catalogs may try global fetch (closed); nothing for ChatPlayground does.
    expect(closedFetch.mock.calls.filter(([url]) => String(url).includes("chatplayground"))).toEqual([]);
    for (const output of [await listed.text(), logged()]) expectNoSecrets(output);
  });

  it("falls back from an expired Clerk session without mixing accounts, then uses the re-imported one", async () => {
    const proxies = await importTwoProxiedAccounts();
    const alphaBefore = await byName("Alpha");
    expiredClients.add(B.client);

    const response = await chat();
    expect(response.status).toBe(200);
    const text = await response.text();
    // Bravo stops at the refused mint; Alpha then runs the whole flow on its own proxy.
    const [refused, ...fallback] = executorCalls();
    expect(refused.headers.get("cookie")).toBe(`__client=${B.client}`);
    expect(refused.proxy.connectionProxyUrl).toBe(proxies.Bravo.proxyUrl);
    expectDispatch(fallback, A, proxies.Alpha);
    expectContainedLookups([B, proxies.Bravo], [A, proxies.Alpha]);
    expect((await byName("Bravo")).testStatus).toBe("unavailable");

    // Re-capture into Bravo: a fresh Clerk session replaces only that row's credential.
    const recaptured = await captureWith(browser(signedIn(C)).chrome, { action: "update", connectionId: proxies.Bravo.id });
    expect(recaptured.result).toMatchObject({ ok: true, action: "update" });
    expect(recaptured.exchanges[0].status).toBe(200);
    const bravo = await byName("Bravo");
    expect(bravo).toMatchObject({ id: proxies.Bravo.id, apiKey: C.header, testStatus: "active", priority: 1 });
    expect(bravo.providerSpecificData.proxyPoolId).toBe(proxies.Bravo.poolId);
    const alpha = await byName("Alpha");
    expect([alpha.apiKey, alpha.providerSpecificData]).toEqual([alphaBefore.apiKey, alphaBefore.providerSpecificData]);

    sent.length = 0;
    // The model lock written by the failure must not outlive the replaced credential.
    const recovered = await chat();
    expect(recovered.status).toBe(200);
    expectDispatch(executorCalls(), C, proxies.Bravo);
    // A lookup for the earlier accounts may still be in flight; each must keep its own proxy.
    expectContainedLookups([C, proxies.Bravo], [B, proxies.Bravo], [A, proxies.Alpha]);

    for (const output of [text, await recovered.text(), recaptured.exchanges[0].text, logged()]) expectNoSecrets(output);
    expect(closedFetch).not.toHaveBeenCalled();
  });

  /**
   * NOT PARITY reproduction (see the port report). Connection test and key validation
   * use the generic registry probe: one raw-Cookie GET /api/me, with no Clerk mint.
   * The executor authorizes the same route with a minted Bearer token. Under that
   * contract a credential that chats successfully is reported invalid. A repair
   * must route both probes through the mint and update this case.
   */
  it("fails closed when connection test and validate skip the executor's Clerk mint", async () => {
    const proxies = await importTwoProxiedAccounts();
    const { id, proxyUrl } = proxies.Bravo;
    expect((await chat()).status).toBe(200);
    sent.length = 0;

    const tested = await routes.test.POST(request(`/api/providers/${id}/test`, {}), params(id));
    const testText = await tested.text();
    expect(JSON.parse(testText)).toMatchObject({ valid: false });
    expect((await byName("Bravo")).testStatus).toBe("error");
    expect(executorCalls().map((call) => [call.method, call.url, call.headers.get("cookie"), call.headers.get("authorization"), call.proxy?.connectionProxyUrl]))
      .toEqual([["GET", `${API}/me`, B.header, null, proxyUrl]]);

    sent.length = 0;
    // Validation has no saved connection, so it uses global fetch: same upstream model.
    vi.stubGlobal("fetch", vi.fn((url, init) => wire(url, init)));
    const validated = await routes.validate.POST(request("/api/providers/validate", { provider: ID, apiKey: B.header }));
    const validateText = await validated.text();
    expect(JSON.parse(validateText)).toMatchObject({ valid: false });
    expect(executorCalls().map((call) => [call.url, call.headers.get("cookie"), call.headers.get("authorization")]))
      .toEqual([[`${API}/me`, B.header, null]]);

    // Control: the mint-first validator that no route calls accepts the same credential.
    const { validateChatPlaygroundCookie } = await import("../../open-sse/executors/chatplayground.js");
    await expect(validateChatPlaygroundCookie(B.header, wire)).resolves.toEqual({ valid: true, status: 200 });

    for (const output of [testText, validateText, logged()]) expectNoSecrets(output);
    expect(closedFetch).not.toHaveBeenCalled();
  });
});
