/**
 * #2034: Arena (lmarena) cookie capture and import against its real provider contract.
 *
 * Real: the lmarena registry entry, extension capture, dashboard paste parser, pairing and
 * import routes, sqlite repository, provider read routes, handleChat, account selection,
 * LmarenaExecutor and the TLS wrapper (proxy resolution and redirect guard).
 * Mocked: the three management guard decisions, `chrome.*`, the extension's network hop (bridged
 * to the import route), the native TLS client and global fetch. Every credential is synthetic.
 * Nothing here shows that arena.ai accepts a request or that sign-in works.
 * Report: internal/docs/port-reports/cookie-flows/lmarena-2034.md
 *
 * The provider under test is ported from OmniRoute (MIT, Copyright (c) 2026 Cheaper Inference),
 * open-sse/config/providers/registry/lmarena/index.ts and open-sse/executors/lmarena.ts.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prepareCapture, runCapture, confirmationFor, describePlan, MESSAGES } from "../../extensions/provider-cookie-capture/capture.js";
import { parseCookieHeaderValue, parseCurlCommand, parseHarDocument, buildImportCandidates, candidatesAreAmbiguous } from "../../src/shared/utils/cookieImportParser.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const guard = vi.hoisted(() => ({ canAccessManagementApi: vi.fn(), isOperatorRequest: vi.fn(), hasExactRequestOrigin: vi.fn() }));
vi.mock("@/dashboardGuard", async (importOriginal) => ({ ...(await importOriginal()), ...guard }));
vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-cookie-machine-id" }));

const DASHBOARD = "https://dashboard.example";
const ORIGIN = "https://arena.ai";
const CHAT_URL = `${ORIGIN}/nextjs-api/stream/create-evaluation`;
const AUTH = "arena-auth-prod-v1";
const MODEL = "lmarena/claude-haiku-4-5-20251001";
const MODEL_UUID = "0199e8e9-01ed-73e0-96ba-cf43b286bf10";
const PROXY = { a: "http://proxy-a.invalid:8080", b: "http://proxy-b.invalid:8080" };

// Synthetic values only. Chunks use the 3180 character Supabase SSR size with base64 padding,
// so a truncated or re-split value would be visible.
const chunk = (account, index) => `${index === 0 ? "base64-" : ""}SYNTH${account}${index}${"x".repeat(index === 0 ? 3160 : 900)}==`;
const parts = (account) => [chunk(account, 0), chunk(account, 1)];
const headerOf = (account) => parts(account).map((value, index) => `${AUTH}.${index}=${value}`).join("; ");
const STALE = "SYNTH-stale-unchunked";
const CLEARANCE = "SYNTH-cf-clearance";
// Any of these fragments in a response or a log is a leak.
const SECRET_RE = /SYNTH|ddpair_[A-Za-z0-9_-]{43}/;

let root;
let db;
let routes;
let handleChat;
let setTls;
let upstream;
let outbound;
let logs;

const params = (id) => ({ params: Promise.resolve({ id }) });
const lockFields = (row) => Object.entries(row).filter(([key, value]) => key.startsWith("modelLock_") && value).map(([key]) => key);
const rows = () => db.getProviderConnections({ provider: "lmarena" });
const row = (id) => db.getProviderConnectionById(id);
const jsonRequest = (url, body, headers = {}) => new NextRequest(url, {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});
const pairRequest = (target) => routes.pairing.POST(jsonRequest(`${DASHBOARD}/api/providers/cookie-import/pairing`, { provider: "lmarena", ...target }, { origin: DASHBOARD }));
async function pair(target) {
  const res = await pairRequest(target);
  expect(res.status).toBe(201);
  return (await res.json()).pairing;
}
const submit = (pairing, body) => routes.importCookies.POST(jsonRequest(pairing.importUrl, body, { [pairing.header]: pairing.token }));

/** The body CookieImportModal posts for the candidate the operator picked. */
async function importCandidate(candidate, target) {
  const pairing = await pair(target);
  const { name, connectionId } = target;
  const res = await submit(pairing, { provider: "lmarena", origin: candidate.origin, cookies: candidate.cookies, ...(connectionId ? { connectionId } : { name }) });
  const body = await res.text();
  expect(body).not.toMatch(SECRET_RE);
  return { status: res.status, body: JSON.parse(body) };
}

const contract = async () => (await import("../../src/lib/providers/cookieImport/contract.js")).getCookieImportContract("lmarena");

async function addByHeader(account) {
  const built = buildImportCandidates({ kind: "header", parsed: parseCookieHeaderValue(headerOf(account)) }, await contract());
  const result = await importCandidate(built.candidates[0], { action: "create", name: `arena-${account}` });
  expect(result.status).toBe(201);
  return result.body.connection.id;
}
/** Gives the account its own proxy and makes selection order explicit (`a` is tried first). */
async function bindProxy(id, account) {
  const current = await row(id);
  await db.updateProviderConnection(id, {
    priority: account === "a" ? 1 : 2,
    providerSpecificData: { ...current.providerSpecificData, connectionProxyEnabled: true, connectionProxyUrl: PROXY[account] },
  });
}

const arenaCookie = (name, value, extra = {}) => ({ name, value, domain: "arena.ai", secure: true, ...extra });

/** `chrome.*` over one cookie jar for the active tab's store. */
function browser({ jar, tabUrl = `${ORIGIN}/c/new` }) {
  const reads = [];
  const grants = { requested: [], removed: [] };
  const chrome = {
    tabs: { query: async () => [{ id: 7, url: tabUrl }], get: async (id) => ({ id, url: tabUrl }) },
    permissions: {
      contains: async () => grants.requested.length > grants.removed.length,
      request: async (q) => { grants.requested.push(structuredClone(q)); return true; },
      remove: async (q) => { grants.removed.push(structuredClone(q)); return true; },
    },
    cookies: {
      getAll: async () => { throw new Error("lmarena must never enumerate cookies"); },
      getAllCookieStores: async () => [{ id: "other-profile", tabIds: [99] }, { id: "tab-store", tabIds: [7] }],
      get: async (query) => { reads.push(query); return jar.find((c) => c.name === query.name) ?? null; },
    },
    scripting: { executeScript: async () => { throw new Error("lmarena must never read page storage"); } },
  };
  return { chrome, reads, grants };
}

/** The extension's one network hop, delivered to the real import route. */
const bridge = (sent) => vi.fn(async (url, init) => {
  sent.push({ url, init });
  return routes.importCookies.POST(new NextRequest(url, { method: init.method, headers: init.headers, body: init.body }));
});

async function captureInto(pairing, jar) {
  const harness = browser({ jar });
  const sent = [];
  const prepared = await prepareCapture({ chrome: harness.chrome, text: JSON.stringify({ pairing }) });
  expect(prepared.ok, prepared.code).toBe(true);
  const result = await runCapture({ chrome: harness.chrome, fetch: bridge(sent), plan: prepared.plan, confirmed: confirmationFor(prepared.plan) });
  return { ...harness, sent, result, plan: prepared.plan };
}

const wire = `data: ${JSON.stringify({ text: "pong" })}\n\n`;
const sse = () => new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(wire)); controller.close(); } });
/** Native TLS client stand-in. `status` picks an answer from the Cookie it was given. */
function arena(status = () => 200) {
  return async (url, options) => {
    upstream.push({ url, options });
    const code = status(options.headers.Cookie);
    if (code !== 200) return { status: code, headers: new Headers(), text: "fixture session rejection", body: null };
    return options.stream
      ? { status: 200, headers: new Headers(), text: null, body: sse() }
      : { status: 200, headers: new Headers(), text: wire, body: null };
  };
}
const chat = (connectionId, extra = {}) => handleChat(new Request("http://gateway.invalid/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(connectionId ? { "x-connection-id": connectionId } : null) },
  body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "hello" }], stream: false, ...extra }),
}));
const route = () => upstream.map(({ options }) => [options.headers.Cookie, options.proxyUrl]);

const loggedText = () => logs.flatMap((spy) => spy.mock.calls).flat()
  .map((value) => (value instanceof Error ? `${value.message} ${value.stack}` : typeof value === "string" ? value : JSON.stringify(value) ?? ""))
  .join("\n");

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-flow-lmarena-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  vi.stubEnv("BASE_URL", DASHBOARD);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.example");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  for (const guardFn of Object.values(guard)) guardFn.mockReset().mockReturnValue(true);
  delete global._dbAdapter;
  vi.resetModules();
  upstream = [];
  outbound = vi.fn((url) => { throw new Error(`unmocked outbound request ${String(url)}`); });
  vi.stubGlobal("fetch", outbound);
  logs = ["log", "info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  db = await import("@/lib/db/index.js");
  routes = {
    pairing: await import("../../src/app/api/providers/cookie-import/pairing/route.js"),
    importCookies: await import("../../src/app/api/providers/cookie-import/route.js"),
    providers: await import("../../src/app/api/providers/route.js"),
    provider: await import("../../src/app/api/providers/[id]/route.js"),
  };
  ({ __setTlsFetchOverrideForTesting: setTls } = await import("../../open-sse/services/lmarenaTlsClient.js"));
  setTls(arena());
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
}, 60_000);

afterEach(async () => {
  setTls?.(null);
  await disposeLoadedRequestDetailsRepo();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("Arena extension capture", () => {
  it("takes a dashboard pairing to a stored session that the executor sends", async () => {
    guard.canAccessManagementApi.mockReturnValueOnce(false);
    expect((await pairRequest({ action: "create", name: "arena-a" })).status).toBe(403);
    guard.isOperatorRequest.mockReturnValueOnce(false);
    expect((await pairRequest({ action: "create", name: "arena-a" })).status).toBe(403);
    // Arena binds no account email.
    expect((await pairRequest({ action: "create", name: "arena-a", accountEmail: "user@example.com" })).status).toBe(400);

    const pairing = await pair({ action: "create", name: "arena-a" });
    // The whole contract: one required name, its chunk prefix, nothing optional or from page storage.
    expect(pairing.contract).toEqual({ origin: ORIGIN, cookieNames: [AUTH], cookiePrefixes: [`${AUTH}.`] });

    const [zero, one] = parts("a");
    const jar = [
      arenaCookie(AUTH, STALE),
      arenaCookie(`${AUTH}.0`, zero, { domain: ".arena.ai" }),
      arenaCookie(`${AUTH}.1`, one),
      // Past a gap, and unapproved: neither may be read or sent.
      arenaCookie(`${AUTH}.3`, "SYNTH-orphan-chunk"),
      arenaCookie("cf_clearance", CLEARANCE),
    ];
    const captured = await captureInto(pairing, jar);
    expect(captured.result).toMatchObject({ ok: true, action: "create", cookieCount: 3 });
    expect(JSON.stringify([captured.result, describePlan(captured.plan)])).not.toMatch(SECRET_RE);
    expect(captured.reads.map((q) => q.name)).toEqual([AUTH, `${AUTH}.0`, `${AUTH}.1`, `${AUTH}.2`]);
    expect(captured.reads.every((q) => q.url === `${ORIGIN}/` && q.storeId === "tab-store")).toBe(true);
    const grant = { permissions: ["cookies"], origins: [`${ORIGIN}/*`, `${DASHBOARD}/*`] };
    expect(captured.grants).toEqual({ requested: [grant], removed: [grant] });
    expect(captured.sent).toHaveLength(1);
    expect(captured.sent[0].init).toMatchObject({ credentials: "omit", redirect: "error", cache: "no-store" });
    expect(captured.sent[0].init.body).not.toMatch(/cf-clearance|orphan/);

    const [saved, ...others] = await rows();
    expect(others).toEqual([]);
    // The stale unchunked copy is dropped; both chunks keep their names, order and every byte.
    expect(saved).toMatchObject({ name: "arena-a", authType: "cookie", apiKey: headerOf("a") });

    // The pairing is one-use, and operator authority alone does not authenticate an import.
    const replay = await routes.importCookies.POST(new NextRequest(pairing.importUrl, captured.sent[0].init));
    expect(replay.status).toBe(401);
    const noPairing = await routes.importCookies.POST(jsonRequest(pairing.importUrl, JSON.parse(captured.sent[0].init.body)));
    expect(noPairing.status).toBe(401);
    expect(await rows()).toHaveLength(1);

    const list = await (await routes.providers.GET(new NextRequest(`${DASHBOARD}/api/providers`))).text();
    const single = await (await routes.provider.GET(new NextRequest(`${DASHBOARD}/api/providers/${saved.id}`), params(saved.id))).text();
    expect(list).toContain("arena-a");
    expect(single).toContain("arena-a");
    for (const text of [list, single, await replay.text(), await noPairing.text()]) expect(text).not.toMatch(SECRET_RE);

    const reply = await chat(saved.id);
    expect(reply.status).toBe(200);
    expect((await reply.json()).choices[0].message.content).toBe("pong");
    expect(upstream).toHaveLength(1);
    const [{ url, options }] = upstream;
    expect(url).toBe(CHAT_URL);
    expect(options.headers).toEqual({
      "Content-Type": "application/json", Accept: "text/event-stream",
      Origin: ORIGIN, Referer: `${ORIGIN}/`, Cookie: headerOf("a"),
    });
    expect(options).toMatchObject({ method: "POST", sameOriginRedirects: true });
    const sentBody = JSON.parse(options.body);
    expect(sentBody).toMatchObject({ mode: "direct-battle", modelAId: MODEL_UUID, modality: "chat", userMessage: { content: "user: hello" } });
    // Cookie import has no way to supply a reCAPTCHA token.
    expect(sentBody).not.toHaveProperty("recaptchaV3Token");
    expect(options.body).not.toMatch(SECRET_RE);
    expect(outbound).not.toHaveBeenCalled();
    expect(loggedText()).not.toMatch(SECRET_RE);
  });

  it.each(["https://lmarena.ai/", "https://www.arena.ai/", "http://arena.ai/", "https://arena.ai.example/"])(
    "reads and sends nothing from %s", async (tabUrl) => {
      const pairing = await pair({ action: "create", name: "arena-a" });
      const harness = browser({ tabUrl, jar: [arenaCookie(AUTH, "SYNTH-session")] });
      const prepared = await prepareCapture({ chrome: harness.chrome, text: JSON.stringify({ pairing }) });
      expect(prepared).toEqual({ ok: false, code: "wrong_tab", message: MESSAGES.wrong_tab, expectedOrigin: ORIGIN });
      expect(harness.reads).toEqual([]);
      expect(harness.grants.requested).toEqual([]);
      expect(await rows()).toEqual([]);
    });
});

describe("Arena dashboard paste and HAR import", () => {
  const unchunked = `${AUTH}=SYNTH-single-session==`;
  const noisy = `cf_clearance=${CLEARANCE}; ${AUTH}.1=${chunk("a", 1)}; ${AUTH}=${STALE}; ${AUTH}.0=${chunk("a", 0)}`;
  const harEntry = (url, header) => ({ request: { url, headers: [{ name: "Cookie", value: header }], cookies: [] } });

  it.each([
    ["Cookie header, unchunked", "header", parseCookieHeaderValue, `Cookie: ${unchunked}`, unchunked, []],
    ["Cookie header, chunked", "header", parseCookieHeaderValue, `Cookie: ${noisy}`, headerOf("a"), ["cf_clearance"]],
    ["cURL -H", "curl", parseCurlCommand, `curl '${CHAT_URL}' -H 'Cookie: ${noisy}' --data-raw '{}'`, headerOf("a"), ["cf_clearance"]],
    ["cURL -b", "curl", parseCurlCommand, `curl '${CHAT_URL}' -b '${noisy}'`, headerOf("a"), ["cf_clearance"]],
    ["HAR", "har", parseHarDocument, JSON.stringify({ log: { entries: [
      harEntry("https://lmarena.ai/api", `${AUTH}=SYNTH-old-domain`), harEntry(CHAT_URL, noisy),
    ] } }), headerOf("a"), ["cf_clearance"]],
  ])("stores and dispatches the approved cookies from a %s", async (_label, kind, parse, text, expected, dropped) => {
    const built = buildImportCandidates({ kind, parsed: parse(text) }, await contract());
    expect(built.candidates).toHaveLength(1);
    expect(built.candidates[0].dropped).toEqual(dropped);
    const result = await importCandidate(built.candidates[0], { action: "create", name: "arena-a" });
    expect(result.status).toBe(201);
    const id = result.body.connection.id;
    expect((await row(id)).apiKey).toBe(expected);
    expect((await chat(id)).status).toBe(200);
    expect(upstream.map(({ options }) => options.headers.Cookie)).toEqual([expected]);
    expect(outbound).not.toHaveBeenCalled();
    expect(loggedText()).not.toMatch(SECRET_RE);
  });

  it("makes the operator choose between two Arena accounts in one HAR and stores only that one", async () => {
    const har = JSON.stringify({ log: { entries: [harEntry(CHAT_URL, headerOf("a")), harEntry(`${ORIGIN}/c/2`, headerOf("b"))] } });
    const built = buildImportCandidates({ kind: "har", parsed: parseHarDocument(har) }, await contract());
    expect(candidatesAreAmbiguous(built.candidates)).toBe(true);
    const result = await importCandidate(built.candidates[1], { action: "create", name: "arena-b" });
    expect(result.status).toBe(201);
    expect((await rows()).map((r) => r.apiKey)).toEqual([headerOf("b")]);
  });

  it.each([
    ["a header without the session cookie", "header", parseCookieHeaderValue, `cf_clearance=${CLEARANCE}`, `The input has no ${AUTH} cookie.`],
    ["a header that starts at chunk 1", "header", parseCookieHeaderValue, `${AUTH}.1=SYNTH-one`, `The chunked ${AUTH} cookie is incomplete: chunk 0 is missing.`],
    ["a cURL command for the old domain", "curl", parseCurlCommand, `curl 'https://lmarena.ai/api' -b '${AUTH}=SYNTH-s'`, "The request origin is not approved for this provider."],
    ["a plain-HTTP cURL command", "curl", parseCurlCommand, `curl 'http://arena.ai/api' -b '${AUTH}=SYNTH-s'`, "The request origin is not approved for this provider."],
    ["a HAR with only a subdomain", "har", parseHarDocument,
      JSON.stringify({ log: { entries: [harEntry("https://www.arena.ai/x", `${AUTH}=SYNTH-s`)] } }), `The HAR file has no request to ${ORIGIN}.`],
  ])("refuses %s in the browser with a value-free error", async (_label, kind, parse, text, error) => {
    expect(buildImportCandidates({ kind, parsed: parse(text) }, await contract())).toEqual({ ok: false, error });
  });

  const good = () => parts("a").map((value, index) => arenaCookie(`${AUTH}.${index}`, value));
  const second = (extra) => ({ cookies: [good()[0], { ...good()[1], ...extra }] });
  it.each([
    ["the old lmarena.ai origin", { origin: "https://lmarena.ai" }, "Origin is not approved for this provider"],
    ["a subdomain origin", { origin: "https://www.arena.ai" }, "Origin is not approved for this provider"],
    ["a foreign cookie domain", second({ domain: "lmarena.ai" }), "Cookie domain does not match the provider origin"],
    ["a subdomain cookie", second({ domain: "www.arena.ai" }), "Cookie domain does not match the provider origin"],
    ["an expired chunk", second({ expirationDate: 1 }), "Cookie is expired"],
    ["a non-secure chunk", second({ secure: false }), "Cookie must be a secure cookie"],
    ["an unapproved Cloudflare cookie", { cookies: [...good(), arenaCookie("cf_clearance", CLEARANCE)] }, "Cookie name is not approved for this provider"],
    ["a non-numeric chunk suffix", second({ name: `${AUTH}.x` }), "Cookie name is not approved for this provider"],
    ["a gap between chunks", second({ name: `${AUTH}.2` }), "Required session cookie is missing or incomplete"],
    ["a duplicated chunk", second({ name: `${AUTH}.0` }), "Duplicate cookie name"],
    ["a localStorage value", { localStorage: { [AUTH]: "SYNTH-storage" } }, "This provider takes no localStorage value"],
  ])("refuses %s at the server without writing or echoing it", async (_label, override, error) => {
    const pairing = await pair({ action: "create", name: "arena-a" });
    const res = await submit(pairing, { provider: "lmarena", origin: ORIGIN, cookies: good(), ...override });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(await rows()).toEqual([]);
    expect(upstream).toEqual([]);
    expect(loggedText()).not.toMatch(SECRET_RE);
  });
});

describe("Arena account ownership and routing", () => {
  it("keeps each stored session on its own proxy for JSON, streaming and 401 failover", async () => {
    const a = await addByHeader("a");
    const b = await addByHeader("b");
    await bindProxy(a, "a");
    await bindProxy(b, "b");

    const pinned = await chat(b);
    expect(pinned.status).toBe(200);
    expect((await pinned.json()).choices[0].message.content).toBe("pong");
    expect(route()).toEqual([[headerOf("b"), PROXY.b]]);

    upstream = [];
    const streamed = await (await chat(a, { stream: true })).text();
    expect(streamed).toContain('"content":"pong"');
    expect(streamed).toContain("data: [DONE]");
    expect(route()).toEqual([[headerOf("a"), PROXY.a]]);

    upstream = [];
    setTls(arena((cookie) => (cookie === headerOf("a") ? 401 : 200)));
    const failover = await chat(null);
    expect(failover.status).toBe(200);
    expect(await failover.text()).not.toMatch(SECRET_RE);
    expect(route()).toEqual([[headerOf("a"), PROXY.a], [headerOf("b"), PROXY.b]]);
    expect(lockFields(await row(a)).length).toBeGreaterThan(0);
    expect(lockFields(await row(b))).toEqual([]);
    expect([(await row(a)).apiKey, (await row(b)).apiKey]).toEqual([headerOf("a"), headerOf("b")]);
    expect(outbound).not.toHaveBeenCalled();
    expect(loggedText()).not.toMatch(SECRET_RE);
  });

  it("recovers an expired account by captured update, keeping its proxy and leaving the other alone", async () => {
    const a = await addByHeader("a");
    const b = await addByHeader("b");
    await bindProxy(a, "a");
    await bindProxy(b, "b");
    setTls(arena((cookie) => (cookie === headerOf("a") ? 401 : 200)));
    // A pinned request never borrows the other account's session.
    const expired = await chat(a);
    expect(expired.status).toBe(401);
    expect(await expired.text()).not.toMatch(SECRET_RE);
    expect(route()).toEqual([[headerOf("a"), PROXY.a]]);
    // An unpinned one cools the expired account down before using the other.
    expect((await chat(null)).status).toBe(200);
    expect(lockFields(await row(a)).length).toBeGreaterThan(0);

    // A reCAPTCHA token saved on the connection is not part of the cookie contract.
    const before = await row(a);
    await db.updateProviderConnection(a, { providerSpecificData: { ...before.providerSpecificData, recaptchaV3Token: "SYNTH-recaptcha" } });
    const untouched = await row(b);

    // A capture carrying an already expired chunk spends its pairing and changes nothing.
    const stale = await captureInto(await pair({ action: "update", connectionId: a }),
      parts("c").map((value, index) => arenaCookie(`${AUTH}.${index}`, value, index ? { expirationDate: 1 } : {})));
    expect(stale.result).toEqual({ ok: false, code: "rejected", message: MESSAGES.rejected });
    expect((await row(a)).apiKey).toBe(headerOf("a"));
    expect(lockFields(await row(a)).length).toBeGreaterThan(0);

    const fresh = await captureInto(await pair({ action: "update", connectionId: a }),
      [arenaCookie(AUTH, "SYNTH-renewed-session==", { expirationDate: Math.floor(Date.now() / 1000) + 3600 })]);
    expect(fresh.result).toMatchObject({ ok: true, action: "update", connection: { id: a, name: "arena-a" } });
    const renewed = await row(a);
    // The session went from two chunks to one cookie: no old chunk survives.
    expect(renewed.apiKey).toBe(`${AUTH}=SYNTH-renewed-session==`);
    expect(renewed.testStatus).toBe("active");
    expect(lockFields(renewed)).toEqual([]);
    expect(renewed.providerSpecificData).toMatchObject({ connectionProxyUrl: PROXY.a, recaptchaV3Token: "SYNTH-recaptcha" });
    expect(await row(b)).toEqual(untouched);

    upstream = [];
    setTls(arena());
    expect((await chat(a)).status).toBe(200);
    expect(route()).toEqual([[`${AUTH}=SYNTH-renewed-session==`, PROXY.a]]);
    expect(JSON.parse(upstream[0].options.body).recaptchaV3Token).toBe("SYNTH-recaptcha");
    const single = await (await routes.provider.GET(new NextRequest(`${DASHBOARD}/api/providers/${a}`), params(a))).text();
    expect(single).not.toMatch(SECRET_RE);
    expect(loggedText()).not.toMatch(SECRET_RE);
  });

  it("binds an update pairing to one Arena cookie connection", async () => {
    const a = await addByHeader("a");
    const b = await addByHeader("b");
    const grok = await db.createProviderConnection({ provider: "grok-web", authType: "cookie", name: "grok", apiKey: "sso=SYNTH-grok" });
    const keyed = await db.createProviderConnection({ provider: "lmarena", authType: "apikey", name: "keyed", apiKey: "SYNTH-key" });
    for (const connectionId of [grok.id, keyed.id]) expect((await pairRequest({ action: "update", connectionId })).status).toBe(409);

    const snapshot = async () => [await row(a), await row(b)];
    const before = await snapshot();
    const cookies = [arenaCookie(AUTH, "SYNTH-intruder")];
    const pairing = await pair({ action: "update", connectionId: a });
    const redirected = await submit(pairing, { provider: "lmarena", origin: ORIGIN, cookies, connectionId: b });
    expect(redirected.status).toBe(409);
    expect(await redirected.text()).not.toMatch(SECRET_RE);
    // The mismatch spent the secret, so the correct target cannot reuse it.
    expect((await submit(pairing, { provider: "lmarena", origin: ORIGIN, cookies, connectionId: a })).status).toBe(401);
    expect(await snapshot()).toEqual(before);
    expect(loggedText()).not.toMatch(SECRET_RE);
  });
});
