/**
 * #2034: bounded chunk capture and durable HAR expiry, end to end and offline.
 *
 * Runs the shipped extension capture, the dashboard parser, the real pairing and import
 * route handlers and an isolated SQLite data directory. Every value is synthetic. Outbound
 * `fetch` throws, so no case can reach a provider; the extension's single POST goes straight
 * into the import route handler.
 *
 * Offline limit: a missing final chunk with no higher index present cannot be told apart from a
 * complete set, by the extension or by the server.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MESSAGES, confirmationFor, prepareCapture, runCapture } from "../../extensions/provider-cookie-capture/capture.js";
import { MAX_COOKIES } from "../../extensions/provider-cookie-capture/providers.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("@/dashboardGuard", async (original) => ({
  ...(await original()), canAccessManagementApi: async () => true,
  canManageAccessConfig: async () => true, isOperatorRequest: async () => true,
}));
vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-complete-integrity-machine" }));

const DASHBOARD = "https://dashboard.example";
const ENDPOINT = `${DASHBOARD}/api/providers/cookie-import`;
const BASE = "__Secure-next-auth.session-token";
const PROVIDER = "chatgpt-web-codex";
const SECRET = "synthetic-complete-secret";
const SECRET_B = "synthetic-complete-other";
const chunk = (index) => `${BASE}.${index}`;
const chunkNames = (count) => Array.from({ length: count }, (_, index) => chunk(index));

let root, db, pairingRoute, importRoute, parser, contractModule, clearPairings, logs;
let secrets = [];

const request = (url, body, headers = {}) => new NextRequest(url, {
  method: "POST", headers: { "content-type": "application/json", host: new URL(url).host, origin: DASHBOARD, ...headers }, body: JSON.stringify(body),
});
async function mint(provider, target) {
  const response = await pairingRoute.POST(request(`${ENDPOINT}/pairing`, { provider, ...target }));
  const payload = await response.json();
  expect(response.status, payload.error).toBe(201);
  secrets.push(payload.pairing.token);
  return payload.pairing;
}
const submit = (pairing, cookies) => importRoute.POST(request(ENDPOINT, {
  provider: pairing.provider, origin: pairing.contract.origin, cookies,
  ...(pairing.action === "update" ? { connectionId: pairing.connectionId } : {}),
}, { [pairing.header]: pairing.token }));
const jarCookie = (name, value = SECRET, extra = {}) => ({ name, value, domain: "chatgpt.com", secure: true, storeId: "tab-store", ...extra });
const rows = (provider = PROVIDER) => db.getProviderConnections({ provider });

/** Real capture against a fake browser profile; records every exact-name read. */
async function capture(pairing, jar) {
  const held = new Set();
  const reads = [];
  const keys = (q) => [...(q.permissions ?? []), ...(q.origins ?? [])];
  const chrome = {
    tabs: { query: async () => [{ id: 7, url: pairing.contract.origin }], get: async () => ({ id: 7, url: pairing.contract.origin }) },
    permissions: {
      contains: async (q) => keys(q).every((k) => held.has(k)),
      request: async (q) => { keys(q).forEach((k) => held.add(k)); return true; },
      remove: async (q) => { keys(q).forEach((k) => held.delete(k)); return true; },
    },
    cookies: {
      getAllCookieStores: async () => [{ id: "other-store", tabIds: [9] }, { id: "tab-store", tabIds: [7] }],
      get: async ({ name, storeId, url }) => {
        expect(storeId).toBe("tab-store");
        expect(url).toBe(`${pairing.contract.origin}/`);
        reads.push(name);
        return jar.find((c) => c.name === name) ?? null;
      },
      getAll: async () => { throw new Error("chunked families use exact-name reads only"); },
    },
  };
  const fetch = vi.fn(async (url, init) => importRoute.POST(new NextRequest(url, init)));
  const prepared = await prepareCapture({ chrome, text: JSON.stringify(pairing) });
  expect(prepared.ok).toBe(true);
  const result = await runCapture({ chrome, fetch, plan: prepared.plan, confirmed: confirmationFor(prepared.plan) });
  expect(held.size).toBe(0);
  for (const value of [SECRET, SECRET_B, pairing.token, ...jar.map((c) => c.value)]) expect(JSON.stringify(result)).not.toContain(value);
  return { result, fetch, reads };
}
const harText = (...requests) => JSON.stringify({ log: { entries: requests.map(({ url = "https://chatgpt.com/backend-api/me", cookies = [], headers = [] }) => ({ request: { url, cookies, headers } })) } });
const offer = (parsed, provider = PROVIDER) => parser.buildImportCandidates({ kind: "har", parsed }, contractModule.getCookieImportContract(provider));
const copies = (value) => [value, JSON.parse(JSON.stringify(value)), structuredClone(value)];

beforeEach(async () => {
  secrets = [];
  logs = ["log", "info", "warn", "error", "debug"].map((name) => vi.spyOn(console, name).mockImplementation(() => {}));
  root = fs.mkdtempSync(path.join(os.tmpdir(), "complete-chunk-har-"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  vi.stubEnv("BASE_URL", DASHBOARD);
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.example");
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  pairingRoute = await import("../../src/app/api/providers/cookie-import/pairing/route.js");
  importRoute = await import("../../src/app/api/providers/cookie-import/route.js");
  parser = await import("../../src/shared/utils/cookieImportParser.js");
  contractModule = await import("../../src/lib/providers/cookieImport/contract.js");
  ({ clearPairings } = await import("../../src/lib/providers/cookieImport/pairing.js"));
  clearPairings();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("unexpected outbound network"); }));
});
afterEach(async () => {
  vi.useRealTimers();
  clearPairings?.();
  await disposeLoadedRequestDetailsRepo();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  // Redaction: no session value or pairing secret ever reaches a log line.
  const output = JSON.stringify(logs.flatMap((spy) => spy.mock.calls));
  for (const value of [SECRET, SECRET_B, ...secrets]) expect(output).not.toContain(value);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("capture with the whole cookie missing: exact-name reads of .0..15 plus the .16 sentinel", () => {
  it.each([
    ["a hole at .1", [jarCookie(chunk(0)), jarCookie(chunk(2))], chunkNames(3)],
    ["a hole at .0", [jarCookie(chunk(1))], chunkNames(2)],
    ["a late chunk after a long hole", [jarCookie(chunk(0)), jarCookie(chunk(15))], chunkNames(16)],
    ["the .16 overflow sentinel alone", [jarCookie(chunk(16))], chunkNames(17)],
    ["seventeen contiguous chunks", chunkNames(17).map((name, index) => jarCookie(name, `synthetic-piece-${index}`)), chunkNames(17)],
  ])("refuses %s before any POST or storage write", async (_label, jar, chunkReads) => {
    const pairing = await mint(PROVIDER, { action: "create", name: "refused" });
    const { result, fetch, reads } = await capture(pairing, jar);
    expect(result).toEqual({ ok: false, code: "incomplete_cookies", message: MESSAGES.incomplete_cookies });
    expect(fetch).not.toHaveBeenCalled();
    // Bounded: the whole name, then canonical chunk names only, stopping at the first anomaly.
    expect(reads).toEqual([BASE, ...chunkReads]);
    expect(reads.length).toBeLessThanOrEqual(MAX_COOKIES + 2);
    expect(await rows()).toEqual([]);
    // The pairing stays unspent, so the operator can retry after signing in again.
    expect((await submit(pairing, [{ name: BASE, value: SECRET }])).status).toBe(201);
  });

  it("imports a contiguous chunk set and the full sixteen-chunk set, reading exactly seventeen chunk names", async () => {
    const two = await capture(await mint(PROVIDER, { action: "create", name: "two" }), [jarCookie(chunk(1), "tail"), jarCookie(chunk(0), "head"), jarCookie("noise", "ignored")]);
    expect(two.result).toMatchObject({ ok: true, action: "create", cookieCount: 2 });
    expect(two.reads).toEqual([BASE, ...chunkNames(MAX_COOKIES + 1)]);
    expect(JSON.parse(two.fetch.mock.calls[0][1].body).cookies.map((c) => c.name)).toEqual(chunkNames(2));
    expect((await db.getProviderConnectionById(two.result.connection.id)).apiKey).toBe(`${chunk(0)}=head; ${chunk(1)}=tail`);

    const sixteen = await capture(await mint(PROVIDER, { action: "create", name: "sixteen" }), chunkNames(16).map((name, index) => jarCookie(name, `p${index}`)));
    expect(sixteen.result).toMatchObject({ ok: true, cookieCount: 16 });
    expect((await db.getProviderConnectionById(sixteen.result.connection.id)).apiKey)
      .toBe(chunkNames(16).map((name, index) => `${name}=p${index}`).join("; "));
  });

  it("keeps the 32 KiB body ceiling: sixteen large chunks never leave the browser", async () => {
    const { result, fetch } = await capture(await mint(PROVIDER, { action: "create", name: "large" }), chunkNames(16).map((name) => jarCookie(name, "x".repeat(2100))));
    expect(result.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(await rows()).toEqual([]);
  });

  it("treats a chunk that is not a secure cookie of the host as absent", async () => {
    const insecure = await capture(await mint(PROVIDER, { action: "create", name: "insecure" }), [jarCookie(chunk(0), SECRET, { secure: false })]);
    expect(insecure.result).toMatchObject({ ok: false, code: "no_cookies" });
    const foreignHole = await capture(await mint(PROVIDER, { action: "create", name: "foreign" }), [jarCookie(chunk(0)), jarCookie(chunk(1), SECRET, { domain: "auth.openai.com" }), jarCookie(chunk(2))]);
    expect(foreignHole.result).toMatchObject({ ok: false, code: "incomplete_cookies" });
    expect(foreignHole.fetch).not.toHaveBeenCalled();
    expect(await rows()).toEqual([]);
  });
});

describe("capture with the whole cookie present", () => {
  it("keeps the contiguous probe after the whole cookie and lets complete chunks supersede it", async () => {
    const whole = await capture(await mint(PROVIDER, { action: "create", name: "whole" }), [jarCookie(BASE, SECRET)]);
    expect(whole.result).toMatchObject({ ok: true, cookieCount: 1 });
    expect(whole.reads).toEqual([BASE, chunk(0)]);
    expect((await db.getProviderConnectionById(whole.result.connection.id)).apiKey).toBe(`${BASE}=${SECRET}`);

    const both = await capture(await mint(PROVIDER, { action: "create", name: "both" }), [jarCookie(BASE, "stale"), jarCookie(chunk(0), "head"), jarCookie(chunk(1), "tail")]);
    expect(both.result).toMatchObject({ ok: true, cookieCount: 3 });
    expect(both.reads).toEqual([BASE, ...chunkNames(3)]);
    expect((await db.getProviderConnectionById(both.result.connection.id)).apiKey).toBe(`${chunk(0)}=head; ${chunk(1)}=tail`);
  });
});

describe("server chunk names: canonical .0..15 only, consistent with capture", () => {
  it.each([".00", ".01", ".016", ".16", ".99", ".-1", ".+1", ". 1"])("refuses the %s chunk name without storing anything", async (suffix) => {
    const contract = contractModule.getCookieImportContract(PROVIDER);
    expect(contractModule.buildImportedCookieHeader(contract, [{ name: `${BASE}${suffix}`, value: SECRET }]).ok).toBe(false);
    const response = await submit(await mint(PROVIDER, { action: "create", name: "noncanonical" }), [{ name: `${BASE}${suffix}`, value: SECRET }]);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(SECRET);
    expect(await rows()).toEqual([]);
  });

  it("refuses `.0` beside its `.00` alias, and still imports canonical chunks", async () => {
    const alias = await submit(await mint(PROVIDER, { action: "create", name: "alias" }), [{ name: chunk(0), value: "head" }, { name: `${BASE}.00`, value: "other" }]);
    expect(alias.status).toBe(400);
    const canonical = await submit(await mint(PROVIDER, { action: "create", name: "canonical" }), chunkNames(16).map((name) => ({ name, value: "v" })));
    expect(canonical.status).toBe(201);
    expect(await rows()).toHaveLength(1);
  });
});

describe("HAR expiry, domain and path survive JSON and structuredClone copies", () => {
  const grok = (cookies, headers = []) => harText({ url: "https://grok.com/rest/app-chat", cookies, headers });

  it.each([
    ["expired", { expires: "2001-01-01T00:00:00.000Z" }],
    ["expired epoch", { expirationDate: 1 }],
    ["malformed expiry", { expires: "not-a-date" }],
    ["null expiry", { expiry: null }],
    ["foreign domain", { domain: "evil.example" }],
    ["public suffix domain", { domain: "com" }],
    ["out-of-scope path", { path: "/private" }],
    ["relative path", { path: "rest" }],
    ["non-boolean secure flag", { secure: "yes" }],
  ])("refuses %s metadata at parse time, so no copy can offer it", (_label, metadata) => {
    const parsed = parser.parseHarDocument(grok([{ name: "sso", value: SECRET, ...metadata }], [{ name: "Cookie", value: `sso=${SECRET}` }]));
    expect(parsed).toEqual({ ok: false, error: "The HAR file's cookies have expired or carry invalid domain, path or expiry metadata." });
    expect(JSON.stringify(parsed)).not.toContain(SECRET);
  });

  it("drops only the invalid request; copies offer the fresh one with its expiry intact", () => {
    const fresh = Math.floor(Date.now() / 1000) + 3600;
    const parsed = parser.parseHarDocument(harText(
      { url: "https://grok.com/rest/a", cookies: [{ name: "sso", value: SECRET_B, expires: "2001-01-01T00:00:00Z" }] },
      { url: "https://grok.com/rest/b", cookies: [{ name: "sso", value: SECRET, domain: ".grok.com", path: "/rest", expirationDate: fresh }] },
    ));
    expect(parsed.entries).toHaveLength(1);
    for (const copy of copies(parsed)) {
      const built = offer(copy, "grok-web");
      expect(built.candidates).toHaveLength(1);
      expect(built.candidates[0].cookies).toEqual([{ name: "sso", value: SECRET, expirationDate: fresh }]);
      expect(JSON.stringify(built)).not.toContain(SECRET_B);
    }
  });

  it("refuses a copied candidate once its carried expiry lapses", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2030, 0, 1));
    const expiry = Date.UTC(2030, 0, 1, 1) / 1000;
    const parsed = parser.parseHarDocument(grok([{ name: "sso", value: SECRET, expirationDate: expiry }]));
    const saved = JSON.parse(JSON.stringify(parsed));
    expect(offer(saved, "grok-web").ok).toBe(true);
    vi.setSystemTime(Date.UTC(2030, 0, 1, 2));
    for (const copy of copies(saved)) expect(offer(copy, "grok-web").ok).toBe(false);
  });

  it("imports session-cookie HARs and pasted headers without inventing an expiry, preserving the other account", async () => {
    const created = await submit(await mint("grok-web", { action: "create", name: "A" }), [{ name: "sso", value: "synthetic-a" }]);
    const id = (await created.json()).connection.id;
    expect((await submit(await mint("grok-web", { action: "create", name: "B" }), [{ name: "sso", value: SECRET_B }])).status).toBe(201);

    // An expired HAR never reaches the update; account A keeps its session.
    expect(parser.parseHarDocument(grok([{ name: "sso", value: "synthetic-stale", expires: "2001-01-01T00:00:00Z" }])).ok).toBe(false);

    const session = offer(structuredClone(parser.parseHarDocument(grok([{ name: "sso", value: SECRET }]))), "grok-web");
    expect(session.candidates[0].cookies).toEqual([{ name: "sso", value: SECRET }]);
    const header = parser.buildImportCandidates({ kind: "header", parsed: parser.parseCookieHeaderValue(`sso=${SECRET}; noise=x`) }, contractModule.getCookieImportContract("grok-web"));
    expect(header.candidates[0].cookies).toEqual([{ name: "sso", value: SECRET }]);

    const response = await submit(await mint("grok-web", { action: "update", connectionId: id }), session.candidates[0].cookies);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(SECRET);
    const stored = await rows("grok-web");
    expect(stored.find((row) => row.id === id).apiKey).toBe(`sso=${SECRET}`);
    expect(stored.find((row) => row.id !== id).apiKey).toBe(`sso=${SECRET_B}`);
  });
});
