/**
 * #2034: Gemini Web capture and import against its real provider contract, offline.
 * Evidence and limits: internal/docs/port-reports/cookie-flows/gemini-web-2034.md.
 *
 * Real: the production gemini-web registry entry, the extension capture module,
 * the dashboard input parsers, the pairing/import routes, an isolated SQLite
 * database, the provider routes, the chat route, account selection and the
 * gemini-web executor and session validator.
 * Mocked: management guard authority, the browser (`chrome.*` and Playwright)
 * and every outbound request. No browser, Google account or network is used and
 * every cookie is a synthetic placeholder, so nothing here shows a live sign-in.
 *
 * The StreamGenerate frame shape follows the executor, ported from OmniRoute
 * open-sse/executors/gemini-web.ts (MIT).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

// The scripted browser. Each context records what the executor gave it.
const world = vi.hoisted(() => ({
  contexts: [],
  /** Cookies the browser holds when the turn ends; null keeps the seeded jar. */
  jarAfterTurn: null,
  /** Runs after the prompt is submitted and before the page answers. */
  duringTurn: null,
  /** __Secure-1PSID values Google redirects to its sign-in page. */
  signedOutPsids: new Set(),
}));

vi.mock("playwright", () => {
  const streamUrl = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=x";
  const frame = (text) => `)]}'\n\n10\n${JSON.stringify([["wrb.fr", null, JSON.stringify([null, null, null, null, [["c_1", [text]]]])]])}\n`;
  const launch = async () => ({
    isConnected: () => true,
    close: async () => {},
    newContext: async (options) => {
      const context = { options, seeded: [], prompts: [], visited: [], closed: false };
      world.contexts.push(context);
      return {
        addCookies: async (cookies) => { context.seeded.push(...cookies); },
        cookies: async () => world.jarAfterTurn ?? context.seeded,
        close: async () => { context.closed = true; },
        newPage: async () => {
          let onResponse = null;
          let url = "about:blank";
          return {
            on: (event, handler) => { if (event === "response") onResponse = handler; },
            url: () => url,
            goto: async (target) => {
              context.visited.push(target);
              const signedOut = context.seeded.some((cookie) => world.signedOutPsids.has(cookie.value));
              url = signedOut ? "https://accounts.google.com/v3/signin/identifier" : target;
            },
            waitForSelector: async () => ({ click: async () => {} }),
            keyboard: {
              insertText: async (text) => { context.prompts.push(text); },
              press: async (key) => {
                if (key !== "Enter") return;
                await world.duringTurn?.();
                await onResponse?.({ url: () => streamUrl, status: () => 200, text: async () => frame("pong from gemini") });
              },
            },
            waitForTimeout: (ms) => new Promise((resolve) => setTimeout(resolve, ms >= 1000 ? 60 : 0)),
          };
        },
      };
    },
  });
  return { chromium: { launch }, default: { chromium: { launch } } };
});

// Only the authority decision is scripted. The origin check and the rest of the guard are real.
const OPERATOR_HEADER = "x-synthetic-operator";
vi.mock("@/dashboardGuard", async (original) => {
  const isSyntheticOperator = async (request) => request?.headers?.get(OPERATOR_HEADER) === "yes";
  return { ...(await original()), canAccessManagementApi: isSyntheticOperator, isOperatorRequest: isSyntheticOperator };
});
// The proxy reachability check opens a real socket.
const proxyProbes = vi.hoisted(() => []);
vi.mock("@/lib/network/proxyTest", async (original) => ({
  ...(await original()),
  testProxyUrl: async ({ proxyUrl }) => { proxyProbes.push(proxyUrl); return { ok: true, status: 200 }; },
}));
vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-cookie-machine-id" }));

const DASHBOARD = "https://dashboard.example";
const ORIGIN = "https://gemini.google.com";
const MODEL = "gemini-web/gemini-3.1-pro";
const PSID = "__Secure-1PSID";
const PSIDTS = "__Secure-1PSIDTS";
const PSIDCC = "__Secure-1PSIDCC";

// Synthetic only: none of these was issued by Google. `SECRET_RE` matches every one of them.
const SECRET_RE = /synthval-|ddpair_[A-Za-z0-9_-]{43}|synthproxy-password/;
const session = (tag) => ({ [PSID]: `synthval-psid-${tag}`, [PSIDTS]: `synthval-ts-${tag}` });
const headerFor = (tag) => `${PSID}=synthval-psid-${tag}; ${PSIDTS}=synthval-ts-${tag}`;
/** Other cookies a signed-in Google profile holds; none may be captured or stored. */
const BYSTANDERS = {
  [PSIDCC]: "synthval-cc-bystander",
  NID: "synthval-nid-bystander",
  SAPISID: "synthval-sapisid-bystander",
  "__Secure-3PSID": "synthval-3psid-bystander",
};
const PROXY_B = "http://synthproxy-user:synthproxy-password@proxy-b.invalid:8080";

let root;
let db;
let routes;
let app;
let outbound;
let consoleSpies;

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-flow-gemini-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  vi.stubEnv("BASE_URL", DASHBOARD);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
    vi.stubEnv(key, undefined);
  }
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  Object.assign(world, { jarAfterTurn: null, duringTurn: null });
  world.signedOutPsids.clear();
  world.contexts.length = 0;
  proxyProbes.length = 0;
  consoleSpies = ["log", "info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  outbound = vi.fn(async () => { throw new Error("unmocked outbound request"); });
  vi.stubGlobal("fetch", outbound);

  db = await import("@/lib/db/index.js");
  routes = {
    pairing: await import("../../src/app/api/providers/cookie-import/pairing/route.js"),
    import: await import("../../src/app/api/providers/cookie-import/route.js"),
    providers: await import("../../src/app/api/providers/route.js"),
    test: await import("../../src/app/api/providers/[id]/test/route.js"),
    testUtils: await import("../../src/app/api/providers/[id]/test/testUtils.js"),
    chat: await import("../../src/app/api/v1/chat/completions/route.js"),
  };
  app = {
    capture: await import("../../extensions/provider-cookie-capture/capture.js"),
    extension: await import("../../extensions/provider-cookie-capture/providers.js"),
    parser: await import("../../src/shared/utils/cookieImportParser.js"),
    contract: await import("../../src/lib/providers/cookieImport/contract.js"),
    registry: (await import("../../open-sse/providers/registry/index.js")).default,
    pairingStore: await import("../../src/lib/providers/cookieImport/pairing.js"),
  };
  app.pairingStore.clearPairings();
});

afterEach(async () => {
  const { resetGeminiBrowserLeaseForTests } = await import("../../open-sse/executors/gemini-web.js");
  await resetGeminiBrowserLeaseForTests();
  routes.testUtils.__setProviderTestFetchForTesting(null);
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await disposeLoadedRequestDetailsRepo();
  fs.rmSync(root, { recursive: true, force: true });
});

const logged = () => consoleSpies.flatMap((spy) => spy.mock.calls)
  .map((call) => call.map((part) => (part instanceof Error ? part.stack : JSON.stringify(part))).join(" "))
  .join("\n");

const jsonRequest = (url, body, headers = {}, method = "POST") => new Request(new URL(url, DASHBOARD), {
  method,
  headers: { "content-type": "application/json", ...headers },
  ...(method === "GET" ? null : { body: JSON.stringify(body) }),
});
/** What a browser on the dashboard sends: the real exact-origin check compares Origin with Host. */
const sameOrigin = { host: new URL(DASHBOARD).host, origin: DASHBOARD };
const operator = { ...sameOrigin, [OPERATOR_HEADER]: "yes" };

const requestPairing = (target, headers = operator) =>
  routes.pairing.POST(jsonRequest("/api/providers/cookie-import/pairing", { provider: "gemini-web", ...target }, headers));

async function pairingFor(target) {
  const response = await requestPairing(target);
  expect(response.status).toBe(201);
  return (await response.json()).pairing;
}

/** Post an import body with a pairing secret, as the extension and the dashboard dialog do. */
async function submit(pairing, body) {
  const response = await routes.import.POST(jsonRequest("/api/providers/cookie-import", body, { [pairing.header]: pairing.token }));
  const text = await response.text();
  // Neither a stored cookie nor the pairing secret is ever echoed.
  expect(text).not.toMatch(SECRET_RE);
  return { status: response.status, body: JSON.parse(text) };
}

const rows = () => db.getProviderConnections({ provider: "gemini-web" });
const row = (id) => db.getProviderConnectionById(id);

// ─── Fake browser for the extension ─────────────────────────────────────────

const browserCookie = (name, value, extra = {}) => ({ name, value, domain: ".google.com", path: "/", secure: true, storeId: "store-tab", ...extra });
const signedInJar = (tag, extra = {}) => Object.entries({ ...session(tag), ...BYSTANDERS }).map(([name, value]) => browserCookie(name, value, extra));

/** Does the browser send a cookie of `domain` to `host`? */
const domainApplies = (host, domain) => (domain.startsWith(".")
  ? host === domain.slice(1) || host.endsWith(domain)
  : host === domain);

/**
 * `chrome.*` over a cookie jar. This mock's `cookies.get` answers by exact name,
 * for cookies whose domain the URL receives, in one store. It does not model
 * Chrome's host-permission checks. Enumeration and page scripting are not part
 * of this provider and throw.
 */
function fakeChrome(jar, { tabUrl = `${ORIGIN}/app`, onPermissionRequest } = {}) {
  const calls = { get: [], requested: [], removed: [], scripted: 0, enumerated: 0 };
  const tab = { id: 11, url: tabUrl };
  const held = new Set();
  const named = (query) => [...(query.permissions ?? []), ...(query.origins ?? [])];
  const chrome = {
    tabs: { query: async () => [{ ...tab }], get: async () => ({ ...tab }) },
    permissions: {
      contains: async (query) => named(query).every((item) => held.has(item)),
      request: async (query) => {
        calls.requested.push(structuredClone(query));
        named(query).forEach((item) => held.add(item));
        onPermissionRequest?.(tab);
        return true;
      },
      remove: async (query) => { calls.removed.push(structuredClone(query)); named(query).forEach((item) => held.delete(item)); return true; },
    },
    cookies: {
      getAllCookieStores: async () => [{ id: "store-other", tabIds: [99] }, { id: "store-tab", tabIds: [tab.id] }],
      getAll: async () => { calls.enumerated += 1; throw new Error("enumeration is not allowed for gemini-web"); },
      get: async ({ url, name, storeId }) => {
        calls.get.push({ url, name, storeId });
        const host = new URL(url).hostname;
        return jar.find((item) => item.name === name && item.storeId === storeId && domainApplies(host, item.domain)) ?? null;
      },
    },
    scripting: { executeScript: async () => { calls.scripted += 1; throw new Error("scripting is not allowed for gemini-web"); } },
  };
  return { chrome, calls };
}

/** The extension's only request, delivered to the real import route. */
function extensionTransport() {
  const sent = [];
  const replies = [];
  const send = vi.fn(async (url, init) => {
    sent.push({ url, init });
    const response = await routes.import.POST(new Request(url, { method: init.method, headers: init.headers, body: init.body }));
    replies.push(await response.clone().text());
    return response;
  });
  return { send, sent, replies };
}

/** Review then Send: the calls popup.js makes into the capture module. */
async function captureWithExtension(target, jar, chromeOptions) {
  const pairing = await pairingFor(target);
  const browser = fakeChrome(jar, chromeOptions);
  const transport = extensionTransport();
  const prepared = await app.capture.prepareCapture({ chrome: browser.chrome, text: JSON.stringify({ pairing }) });
  if (!prepared.ok) return { pairing, browser, transport, prepared, result: prepared };
  const view = app.capture.describePlan(prepared.plan);
  const confirmed = app.capture.confirmationFor(prepared.plan);
  const result = await app.capture.runCapture({ chrome: browser.chrome, fetch: transport.send, plan: prepared.plan, confirmed });
  return { pairing, browser, transport, prepared, view, result };
}

/** Parse local input as the dashboard dialog does and import the chosen candidate. */
async function importParsed(target, kind, parsed, pick = 0) {
  expect(parsed.ok, parsed.error).toBe(true);
  const built = app.parser.buildImportCandidates({ kind, parsed }, app.contract.getCookieImportContract("gemini-web"));
  expect(built.ok, built.error).toBe(true);
  const chosen = built.candidates[pick];
  const pairing = await pairingFor(target);
  const reply = await submit(pairing, {
    provider: "gemini-web",
    origin: chosen.origin,
    cookies: chosen.cookies,
    ...(target.action === "create" ? { name: target.name } : { connectionId: target.connectionId }),
  });
  return { built, reply };
}

const create = (name) => ({ action: "create", name });
const update = (connectionId) => ({ action: "update", connectionId });

async function importHeader(target, header) {
  const { reply } = await importParsed(target, "header", app.parser.parseCookieHeaderValue(header));
  expect(reply.status).toBe(target.action === "create" ? 201 : 200);
  return reply.body.connection;
}

/** With a connection id the request is pinned to it; without one, account selection decides. */
const chat = (connectionId) => routes.chat.POST(jsonRequest(
  "/v1/chat/completions",
  { model: MODEL, stream: false, messages: [{ role: "user", content: "ping" }] },
  connectionId ? { "x-connection-id": connectionId } : {},
));

/**
 * The gateway records usage after it answers. Waiting for one row per served
 * turn proves each was billed to the account that ran it, and keeps that write
 * from racing the database close.
 */
const usageRecordedFor = (...connectionIds) => vi.waitFor(async () => {
  const history = await db.getUsageHistory({ provider: "gemini-web" });
  expect(history.map((item) => item.connectionId).sort()).toEqual([...connectionIds].sort());
});

const seededValues = (context) => Object.fromEntries(context.seeded.map(({ name, value }) => [name, value]));

// ─── Contract ───────────────────────────────────────────────────────────────

describe("gemini-web real descriptor", () => {
  it("resolves one contract for the registry, the pairing route and the extension", async () => {
    const entry = app.registry.find((candidate) => candidate.id === "gemini-web");
    const contract = app.contract.getCookieImportContract("gemini-web");
    // No separate import profile: the in-page sign-in block is the import contract.
    expect(entry.cookieImport).toBeUndefined();
    expect(contract.config).toBe(entry.webLogin);
    expect(contract).toMatchObject({ authType: "cookie", origin: ORIGIN, host: "gemini.google.com", extensionCapture: true });

    const pairing = await pairingFor(create("Contract"));
    expect(pairing.contract).toEqual({ origin: ORIGIN, cookieNames: [PSID, PSIDTS], cookiePrefixes: [] });
    expect(app.extension.PROVIDERS["gemini-web"]).toEqual({ label: "Gemini Web", origin: ORIGIN, cookieNames: [PSID, PSIDTS], cookiePrefixes: [] });
    for (const key of ["optionalCookies", "localStorageKeys", "hashedCookiePrefixes", "accountEmail", "credentialPattern"]) {
      expect(contract[key], key).toBeUndefined();
    }
  });

  it("takes no localStorage value and no account email", async () => {
    expect((await requestPairing({ ...create("Mail"), accountEmail: "someone@example.com" })).status).toBe(400);
    const pairing = await pairingFor(create("Storage"));
    const reply = await submit(pairing, {
      provider: "gemini-web", origin: ORIGIN, name: "Storage",
      cookies: Object.entries(session("a")).map(([name, value]) => ({ name, value })),
      localStorage: { SNlM0e: "synthval-local" },
    });
    expect(reply).toMatchObject({ status: 400, body: { error: "This provider takes no localStorage value" } });
    expect(await rows()).toEqual([]);
  });

  it("issues no pairing without operator authority or from a foreign origin", async () => {
    expect((await requestPairing(create("Anonymous"), sameOrigin)).status).toBe(403);
    expect((await requestPairing(create("Foreign"), { ...operator, origin: "https://evil.example" })).status).toBe(403);
    expect(app.pairingStore.pendingPairingCount()).toBe(0);
    const unpaired = await routes.import.POST(jsonRequest("/api/providers/cookie-import", { provider: "gemini-web", origin: ORIGIN, cookies: [] }, operator));
    expect(unpaired.status).toBe(401);
  });
});

// ─── Extension capture into the real import route ───────────────────────────

describe("gemini-web extension capture", () => {
  it("creates a connection from exactly the two .google.com cookies of the confirmed tab", async () => {
    const jar = [
      // Another signed-in profile in another cookie store, listed first.
      ...signedInJar("otherstore", { storeId: "store-other" }),
      // Same names on the Google sign-in host, which gemini.google.com never receives.
      ...signedInJar("signinhost", { domain: "accounts.google.com" }),
      ...signedInJar("a"),
    ];
    const run = await captureWithExtension(create("Account A"), jar);

    expect(run.result).toMatchObject({ ok: true, action: "create", cookieCount: 2, connection: { name: "Account A" } });
    expect(run.view).toMatchObject({ providerOrigin: ORIGIN, dashboardOrigin: DASHBOARD, cookieNames: [PSID, PSIDTS], optionalCookies: [], localStorageKeys: [] });
    expect(run.browser.calls.get).toEqual([PSID, PSIDTS].map((name) => ({ url: `${ORIGIN}/`, name, storeId: "store-tab" })));
    expect(run.browser.calls).toMatchObject({ enumerated: 0, scripted: 0 });
    expect(run.browser.calls.requested).toEqual([{ permissions: ["cookies"], origins: [`${ORIGIN}/*`, `${DASHBOARD}/*`] }]);
    expect(run.browser.calls.removed).toEqual(run.browser.calls.requested);

    expect(run.transport.sent).toHaveLength(1);
    const [{ url, init }] = run.transport.sent;
    expect(url).toBe(`${DASHBOARD}/api/providers/cookie-import`);
    expect(init).toMatchObject({ method: "POST", credentials: "omit", redirect: "error" });
    expect(JSON.parse(init.body)).toEqual({
      provider: "gemini-web",
      origin: ORIGIN,
      cookies: Object.entries(session("a")).map(([name, value]) => ({ name, value, domain: "google.com", secure: true })),
    });

    const [saved] = await rows();
    expect(saved).toMatchObject({ id: run.result.connection.id, authType: "cookie", apiKey: headerFor("a"), isActive: true });

    // Encrypted at rest, and redacted from every read the dashboard makes.
    const adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    const raw = adapter.all("SELECT * FROM providerConnections");
    expect(raw).toHaveLength(1);
    expect(JSON.stringify(raw)).not.toContain("synthval-");
    for (const headers of [operator, {}]) {
      const listed = await (await routes.providers.GET(jsonRequest("/api/providers", null, headers, "GET"))).text();
      expect(listed).toContain("Account A");
      expect(listed).not.toMatch(SECRET_RE);
    }
    expect(JSON.stringify([run.result, run.view, run.transport.replies])).not.toMatch(SECRET_RE);
    expect(logged()).not.toMatch(SECRET_RE);
    expect(outbound).not.toHaveBeenCalled();
  });

  it("replaces only the paired connection and keeps its identity, priority and proxy", async () => {
    const a = (await captureWithExtension(create("Account A"), signedInJar("a"))).result.connection;
    const b = (await captureWithExtension(create("Account B"), signedInJar("b"))).result.connection;
    await db.updateProviderConnection(b.id, { providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: PROXY_B } });
    const [beforeA, beforeB] = [await row(a.id), await row(b.id)];

    const run = await captureWithExtension(update(b.id), signedInJar("b2"));

    expect(run.result).toMatchObject({ ok: true, action: "update", cookieCount: 2, connection: { id: b.id, name: "Account B" } });
    expect(await rows()).toHaveLength(2);
    expect(await row(a.id)).toEqual(beforeA);
    expect(await row(b.id)).toMatchObject({
      apiKey: headerFor("b2"), testStatus: "active", priority: beforeB.priority,
      providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: PROXY_B },
    });
    expect(logged()).not.toMatch(SECRET_RE);
  });

  it.each([
    ["the Google sign-in page", "https://accounts.google.com/v3/signin/identifier"],
    ["the parent domain", "https://google.com/"],
    ["a lookalike host", "https://gemini.google.com.evil.example/app"],
    ["plain HTTP", "http://gemini.google.com/app"],
  ])("reads and sends nothing from %s", async (_label, tabUrl) => {
    const run = await captureWithExtension(create("Wrong tab"), signedInJar("a"), { tabUrl });
    expect(run.result).toMatchObject({ ok: false, code: "wrong_tab" });
    expect(run.browser.calls).toMatchObject({ get: [], requested: [] });
    expect(run.transport.send).not.toHaveBeenCalled();
    expect(await rows()).toEqual([]);
  });

  it("reads nothing when the tab leaves Gemini while the permission prompt is open", async () => {
    const run = await captureWithExtension(create("Moved"), signedInJar("a"), {
      onPermissionRequest: (tab) => { tab.url = "https://accounts.google.com/ServiceLogin"; },
    });
    expect(run.result).toMatchObject({ ok: false, code: "wrong_tab" });
    expect(run.browser.calls.get).toEqual([]);
    expect(run.browser.calls.removed).toHaveLength(1);
    expect(run.transport.send).not.toHaveBeenCalled();
  });

  it.each([
    ["only another cookie store is signed in", () => signedInJar("a", { storeId: "store-other" })],
    ["only the sign-in host holds the cookies", () => signedInJar("a", { domain: "accounts.google.com" })],
    ["the cookies are not Secure", () => signedInJar("a", { secure: false })],
    ["only unapproved Google cookies exist", () => signedInJar("a").filter((item) => item.name in BYSTANDERS)],
  ])("sends nothing when %s", async (_label, jar) => {
    const run = await captureWithExtension(create("Empty"), jar());
    expect(run.result).toMatchObject({ ok: false, code: "no_cookies" });
    expect(run.transport.send).not.toHaveBeenCalled();
    expect(await rows()).toEqual([]);
  });

  it.each([
    ["is expired", () => signedInJar("new", { expirationDate: Math.floor(Date.now() / 1000) - 60 })],
    ["lacks __Secure-1PSIDTS", () => signedInJar("new").filter((item) => item.name !== PSIDTS)],
    ["lacks __Secure-1PSID", () => signedInJar("new").filter((item) => item.name !== PSID)],
  ])("keeps the stored credential when the captured session %s", async (_label, jar) => {
    const original = (await captureWithExtension(create("Account A"), signedInJar("a"))).result.connection;
    const before = await row(original.id);

    const run = await captureWithExtension(update(original.id), jar());

    expect(run.result).toMatchObject({ ok: false, code: "rejected" });
    expect(run.transport.sent).toHaveLength(1);
    expect(await row(original.id)).toEqual(before);
    expect(JSON.stringify([run.result, run.transport.replies])).not.toMatch(SECRET_RE);
    expect(logged()).not.toMatch(SECRET_RE);
  });

  it("refuses a pairing that names another origin or drops a required cookie", async () => {
    const pairing = await pairingFor(create("Tampered"));
    const check = (contract) => app.capture.parsePairing(JSON.stringify({ pairing: { ...pairing, contract } }));
    expect(check({ ...pairing.contract, origin: "https://accounts.google.com" })).toMatchObject({ ok: false, code: "origin_mismatch" });
    expect(check({ ...pairing.contract, cookieNames: [PSID] })).toMatchObject({ ok: false, code: "invalid_pairing" });
    // A widened pairing is narrowed back to the built-in allowlist.
    expect(check({ ...pairing.contract, cookieNames: [PSID, PSIDTS, "SAPISID"] }).plan.cookieNames).toEqual([PSID, PSIDTS]);
  });
});

// ─── Import route refusals under the real contract ──────────────────────────

describe("gemini-web import route refusals", () => {
  const cookies = (extra = {}) => Object.entries(session("new")).map(([name, value]) => ({ name, value, domain: ".google.com", secure: true, ...extra }));
  const body = (connectionId, extra = {}) => ({ provider: "gemini-web", origin: ORIGIN, connectionId, cookies: cookies(), ...extra });

  it.each([
    ["the sign-in origin", { origin: "https://accounts.google.com" }, 400],
    ["the parent origin", { origin: "https://google.com" }, 400],
    ["a trailing slash", { origin: `${ORIGIN}/` }, 400],
    ["a sign-in host cookie", { cookies: cookies({ domain: "accounts.google.com" }) }, 400],
    ["a public-suffix cookie", { cookies: cookies({ domain: ".com" }) }, 400],
    ["an insecure cookie", { cookies: cookies({ secure: false }) }, 400],
    ["an expired cookie", { cookies: cookies({ expirationDate: 1 }) }, 400],
    ["the unapproved __Secure-1PSIDCC", { cookies: [...cookies(), { name: PSIDCC, value: "synthval-cc-new" }] }, 400],
    ["a duplicate name", { cookies: [...cookies(), cookies()[0]] }, 400],
    ["a header-injecting value", { cookies: [cookies()[0], { name: PSIDTS, value: "synthval-ts; NID=synthval-x" }] }, 400],
    ["an oversized value", { cookies: [cookies()[0], { name: PSIDTS, value: `synthval-${"x".repeat(8200)}` }] }, 400],
    ["another provider", { provider: "claude-web" }, 409],
  ])("refuses %s, spends the pairing and keeps the stored credential", async (_label, change, status) => {
    const original = await importHeader(create("Account A"), headerFor("a"));
    const before = await row(original.id);
    const pairing = await pairingFor(update(original.id));

    expect((await submit(pairing, body(original.id, change))).status).toBe(status);
    expect((await submit(pairing, body(original.id))).status).toBe(401);
    expect(await row(original.id)).toEqual(before);
    expect(logged()).not.toMatch(SECRET_RE);
  });

  it("lets an update pairing write only its own gemini-web connection", async () => {
    const a = await importHeader(create("Account A"), headerFor("a"));
    const b = await importHeader(create("Account B"), headerFor("b"));
    const foreign = await db.createProviderConnection({ provider: "claude-web", authType: "cookie", name: "Claude", apiKey: "sessionKey=synthval-claude" });

    expect((await requestPairing(update(foreign.id))).status).toBe(409);
    expect((await requestPairing(update("missing"))).status).toBe(404);
    expect((await submit(await pairingFor(update(a.id)), body(b.id))).status).toBe(409);
    expect([(await row(a.id)).apiKey, (await row(b.id)).apiKey, (await row(foreign.id)).apiKey])
      .toEqual([headerFor("a"), headerFor("b"), "sessionKey=synthval-claude"]);
  });

  it("refuses an expired pairing and a second create under the same name", async () => {
    await importHeader(create("Account A"), headerFor("a"));
    const duplicate = await submit(await pairingFor(create("Account A")), { provider: "gemini-web", origin: ORIGIN, cookies: cookies() });
    expect(duplicate.status).toBe(409);

    const stale = await pairingFor(create("Late"));
    const later = Date.parse(stale.expiresAt) + 1;
    vi.spyOn(Date, "now").mockReturnValue(later);
    expect((await submit(stale, { provider: "gemini-web", origin: ORIGIN, cookies: cookies() })).status).toBe(401);
    expect((await rows()).map((item) => item.apiKey)).toEqual([headerFor("a")]);
  });
});

// ─── Dashboard local input ──────────────────────────────────────────────────

describe("gemini-web dashboard input", () => {
  const noisy = (tag) => `NID=synthval-nid; ${headerFor(tag)}; ${PSIDCC}=synthval-cc-${tag}; SAPISID=synthval-sapisid`;

  it.each([
    ["a Cookie header", "header", () => `Cookie: ${noisy("h")}`, "h"],
    ["a cURL -H header", "curl", () => `curl '${ORIGIN}/app' -H 'cookie: ${noisy("c")}' --compressed`, "c"],
    ["a cURL -b argument", "curl", () => `curl "${ORIGIN}/app" -b "${noisy("j")}"`, "j"],
  ])("imports %s and keeps only the two approved cookies", async (_label, kind, input, tag) => {
    const parse = kind === "curl" ? app.parser.parseCurlCommand : app.parser.parseCookieHeaderValue;
    const { built, reply } = await importParsed(create(`Local ${tag}`), kind, parse(input()));

    expect(built.candidates).toHaveLength(1);
    expect(built.candidates[0].originKnown).toBe(kind === "curl");
    expect(built.candidates[0].dropped.sort()).toEqual(["NID", "SAPISID", PSIDCC].sort());
    expect(reply.status).toBe(201);
    expect((await row(reply.body.connection.id)).apiKey).toBe(headerFor(tag));
    expect(outbound).not.toHaveBeenCalled();
  });

  const harEntry = (url, header) => ({ request: { url, headers: [{ name: "Cookie", value: header }], cookies: [] } });
  const har = (...entries) => JSON.stringify({ log: { entries } });

  it("offers each Gemini account in a HAR file, ignores other origins and replaces with the chosen one", async () => {
    const original = await importHeader(create("Account A"), headerFor("a"));
    const file = har(
      harEntry("https://accounts.google.com/ListAccounts", headerFor("signinhost")),
      harEntry("https://google.com/", headerFor("parent")),
      harEntry(`${ORIGIN}/app`, noisy("har1")),
      harEntry(`${ORIGIN}/u/1/app`, noisy("har2")),
    );

    const { built, reply } = await importParsed(update(original.id), "har", app.parser.parseHarDocument(file), 1);

    expect(built.candidates.map((candidate) => candidate.url)).toEqual([`${ORIGIN}/app`, `${ORIGIN}/u/1/app`]);
    expect(app.parser.candidatesAreAmbiguous(built.candidates)).toBe(true);
    expect(app.parser.candidatesAreAmbiguous([built.candidates[0], built.candidates[0]])).toBe(false);
    expect(reply.status).toBe(200);
    expect((await row(original.id)).apiKey).toBe(headerFor("har2"));
  });

  it("refuses unsupported or incomplete input with a message that carries no value", () => {
    const contract = app.contract.getCookieImportContract("gemini-web");
    const parser = app.parser;
    const build = (kind, parsed) => (parsed.ok ? parser.buildImportCandidates({ kind, parsed }, contract) : parsed);
    const exportList = Object.entries(session("json")).map(([name, value]) => ({ name, value, domain: ".google.com" }));
    const refusals = [
      // A bare PSID value is accepted by manual add only.
      build("header", parser.parseCookieHeaderValue("synthval-psid-bare")),
      build("header", parser.parseCookieHeaderValue(`${PSID}=synthval-psid-only`)),
      build("header", parser.parseCookieHeaderValue(`${PSIDTS}=synthval-ts-only`)),
      // Browser-export JSON is accepted by manual add only. The import dialog reads `{` as HAR.
      build("har", parser.parseHarDocument(JSON.stringify({ cookies: session("json") }))),
      build("header", parser.parseCookieHeaderValue(JSON.stringify(exportList))),
      build("curl", parser.parseCurlCommand(`curl 'https://accounts.google.com/' -H 'cookie: ${headerFor("x")}'`)),
      build("curl", parser.parseCurlCommand(`curl 'https://google.com/' -H 'cookie: ${headerFor("x")}'`)),
      build("curl", parser.parseCurlCommand(`curl 'http://gemini.google.com/app' -H 'cookie: ${headerFor("x")}'`)),
      build("curl", parser.parseCurlCommand(`curl '${ORIGIN}/app' -b cookies.txt`)),
      build("har", parser.parseHarDocument(har(harEntry("https://google.com/", headerFor("x"))))),
      build("har", parser.parseHarDocument(har(harEntry(`${ORIGIN}/app`, `${PSID}=synthval-psid-only`)))),
    ];
    for (const refusal of refusals) {
      expect(refusal.ok).toBe(false);
      expect(refusal.error).toEqual(expect.any(String));
    }
    expect(JSON.stringify(refusals)).not.toContain("synthval-");
    expect(outbound).not.toHaveBeenCalled();
  });
});

// ─── Stored credential consumption ──────────────────────────────────────────

describe("gemini-web imported credential consumption", () => {
  /** Account A through the extension (direct), account B through a HAR file (own proxy). */
  async function twoAccounts() {
    const a = (await captureWithExtension(create("Account A"), signedInJar("a"))).result.connection;
    const file = JSON.stringify({ log: { entries: [{ request: { url: `${ORIGIN}/app`, headers: [{ name: "Cookie", value: headerFor("b") }] } }] } });
    const { reply } = await importParsed(create("Account B"), "har", app.parser.parseHarDocument(file));
    expect(reply.status).toBe(201);
    const b = reply.body.connection;
    await db.updateProviderConnection(b.id, { providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: PROXY_B } });
    return { a, b };
  }

  it("gives the chat route only the chosen account's cookies and proxy", async () => {
    const { a, b } = await twoAccounts();

    const second = await chat(b.id);
    const secondText = await second.text();
    expect(second.status, secondText).toBe(200);
    expect(JSON.parse(secondText).choices[0].message.content).toBe("pong from gemini");
    const first = await chat(a.id);
    expect(first.status).toBe(200);

    expect(world.contexts).toHaveLength(2);
    const [viaB, viaA] = world.contexts;
    expect(viaB.options.proxy).toEqual({ server: "http://proxy-b.invalid:8080", username: "synthproxy-user", password: "synthproxy-password" });
    expect(viaA.options).not.toHaveProperty("proxy");
    for (const [context, tag] of [[viaB, "b"], [viaA, "a"]]) {
      expect(seededValues(context)).toEqual(session(tag));
      expect(context.seeded.map(({ domain, path: cookiePath, secure }) => [domain, cookiePath, secure])).toEqual([[".google.com", "/", true], [".google.com", "/", true]]);
      expect(context).toMatchObject({ visited: [`${ORIGIN}/app`], prompts: ["ping"], closed: true });
    }
    expect(secondText + (await first.text())).not.toMatch(SECRET_RE);
    // The scan sees the gateway's own account and proxy log lines.
    expect(logged()).toContain("url=http://proxy-b.invalid:8080");
    expect(logged()).not.toMatch(SECRET_RE);
    await usageRecordedFor(b.id, a.id);
    expect(outbound).not.toHaveBeenCalled();
  });

  it("tests a stored import with its own cookie and proxy, and reports a signed-out page", async () => {
    const { a, b } = await twoAccounts();
    const untouched = await row(a.id);
    const probes = [];
    let page = '<script>{"SNlM0e":"synthetic-page-token"}</script>';
    routes.testUtils.__setProviderTestFetchForTesting(async (url, init, proxy) => {
      probes.push({ url, init, proxy });
      return new Response(page, { status: 200 });
    });
    const run = async () => {
      const response = await routes.test.POST(jsonRequest(`/api/providers/${b.id}/test`, {}), { params: Promise.resolve({ id: b.id }) });
      const text = await response.text();
      expect(text).not.toMatch(SECRET_RE);
      return JSON.parse(text);
    };

    expect(await run()).toMatchObject({ valid: true });
    expect((await row(b.id)).testStatus).toBe("active");
    page = "<html>Sign in</html>";
    expect(await run()).toMatchObject({ valid: false, error: expect.stringMatching(/not signed in/i) });

    expect(probes).toHaveLength(2);
    for (const { url, init, proxy } of probes) {
      expect(url).toBe(`${ORIGIN}/app`);
      expect(init).toMatchObject({ method: "GET", redirect: "manual", headers: { Cookie: headerFor("b") } });
      expect(proxy).toMatchObject({ connectionProxyEnabled: true, connectionProxyUrl: PROXY_B });
    }
    expect(proxyProbes).toEqual([PROXY_B, PROXY_B]);
    expect(await row(b.id)).toMatchObject({ testStatus: "error", apiKey: headerFor("b") });
    expect(await row(a.id)).toEqual(untouched);
    expect(logged()).not.toMatch(SECRET_RE);
  });

  // The import dialog refuses these two forms (see "unsupported or incomplete input"); manual add stores them as pasted.
  it.each([
    ["a bare __Secure-1PSID value", () => "synthval-psid-bare", { [PSID]: "synthval-psid-bare" }],
    ["a Cookie-Editor export", () => JSON.stringify(Object.entries(session("export")).map(([name, value]) => ({ name, value, domain: ".google.com" }))), session("export")],
  ])("serves %s saved through manual add", async (_label, paste, expected) => {
    const saved = await routes.providers.POST(jsonRequest("/api/providers", { provider: "gemini-web", name: "Manual", apiKey: paste() }, operator));
    const savedText = await saved.text();
    expect(saved.status, savedText).toBe(201);
    expect(savedText).not.toMatch(SECRET_RE);
    const { connection } = JSON.parse(savedText);

    expect((await chat(connection.id)).status).toBe(200);

    expect(world.contexts.map(seededValues)).toEqual([expected]);
    await usageRecordedFor(connection.id);
    expect(logged()).not.toMatch(SECRET_RE);
  });

  const rotatedJar = (tag) => [
    { name: PSID, value: `synthval-psid-${tag}` },
    { name: PSIDTS, value: `synthval-ts-${tag}-rotated` },
    { name: PSIDCC, value: `synthval-cc-${tag}-rotated` },
    { name: "NID", value: "synthval-nid-live" },
  ];

  it("stores a rotation on the account that ran the turn and sends it next time", async () => {
    const { a, b } = await twoAccounts();
    const untouched = await row(a.id);
    world.jarAfterTurn = rotatedJar("b");

    expect((await chat(b.id)).status).toBe(200);

    const rotated = `${PSID}=synthval-psid-b; ${PSIDTS}=synthval-ts-b-rotated; ${PSIDCC}=synthval-cc-b-rotated`;
    expect((await row(b.id)).apiKey).toBe(rotated);
    expect((await row(a.id)).apiKey).toBe(untouched.apiKey);

    expect((await chat(b.id)).status).toBe(200);
    expect(seededValues(world.contexts[1])).toEqual({
      [PSID]: "synthval-psid-b", [PSIDTS]: "synthval-ts-b-rotated", [PSIDCC]: "synthval-cc-b-rotated",
    });
    await usageRecordedFor(b.id, b.id);
    expect(logged()).not.toMatch(SECRET_RE);
  });

  it("does not let an in-flight turn's rotation overwrite a newer import", async () => {
    const { b } = await twoAccounts();
    world.jarAfterTurn = rotatedJar("b");
    world.duringTurn = async () => {
      const run = await captureWithExtension(update(b.id), signedInJar("reimported"));
      expect(run.result.ok).toBe(true);
    };

    expect((await chat(b.id)).status).toBe(200);

    expect(seededValues(world.contexts[0])).toEqual(session("b"));
    expect((await row(b.id)).apiKey).toBe(headerFor("reimported"));
    await usageRecordedFor(b.id);
  });

  it("keeps a pinned dead session on its own account and never borrows another", async () => {
    const { a, b } = await twoAccounts();
    const untouched = await row(a.id);
    world.signedOutPsids.add("synthval-psid-b");

    const dead = await chat(b.id);
    const deadText = await dead.text();

    expect(dead.status, deadText).toBe(401);
    expect(deadText).not.toMatch(SECRET_RE);
    expect(world.contexts.map(seededValues)).toEqual([session("b")]);
    expect(world.contexts[0]).toMatchObject({ prompts: [], closed: true });
    expect(await row(a.id)).toEqual(untouched);
    expect(logged()).not.toMatch(SECRET_RE);
  });

  it("fails over from a dead session and returns to the account after it is re-imported", async () => {
    const { a, b } = await twoAccounts();
    await db.updateProviderConnection(b.id, { priority: 1 });
    await db.updateProviderConnection(a.id, { priority: 2 });
    world.signedOutPsids.add("synthval-psid-b");

    const failedOver = await chat();
    expect(failedOver.status, await failedOver.text()).toBe(200);
    expect(world.contexts.map(seededValues)).toEqual([session("b"), session("a")]);
    expect(world.contexts[0].prompts).toEqual([]);
    expect(Number((await row(b.id)).errorCode)).toBe(401);

    world.contexts.length = 0;
    expect((await chat()).status).toBe(200);
    expect(world.contexts.map(seededValues)).toEqual([session("a")]);

    expect((await captureWithExtension(update(b.id), signedInJar("fresh"))).result.ok).toBe(true);
    expect(await row(b.id)).toMatchObject({ testStatus: "active", errorCode: null, apiKey: headerFor("fresh") });

    world.contexts.length = 0;
    expect((await chat()).status).toBe(200);
    expect(world.contexts.map(seededValues)).toEqual([session("fresh")]);
    expect(world.contexts[0].options.proxy).toMatchObject({ server: "http://proxy-b.invalid:8080" });
    await usageRecordedFor(a.id, a.id, b.id);
    expect(logged()).not.toMatch(SECRET_RE);
  });
});
