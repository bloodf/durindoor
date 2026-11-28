/** Synthetic offline regression: actual capture, parser, pairing/import handlers and private SQLite. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { confirmationFor, prepareCapture, runCapture } from "../../extensions/provider-cookie-capture/capture.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("@/dashboardGuard", async (original) => ({
  ...(await original()), canAccessManagementApi: async () => true,
  canManageAccessConfig: async () => true, isOperatorRequest: async () => true,
}));
vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-integrity-machine" }));
const dashboard = "https://dashboard.example";
const endpoint = `${dashboard}/api/providers/cookie-import`;
const base = "__Secure-next-auth.session-token";
const secret = "synthetic-integrity-secret";
let root, db, pairingRoute, importRoute, parser, clearPairings, logs;
let pairingSecrets = [];
const request = (url, body, headers = {}) => new NextRequest(url, {
  method: "POST", headers: { "content-type": "application/json", host: new URL(url).host, origin: dashboard, ...headers }, body: JSON.stringify(body),
});
async function mint(provider, target) {
  const response = await pairingRoute.POST(request(`${endpoint}/pairing`, { provider, ...target }));
  const payload = await response.json();
  expect(response.status, payload.error).toBe(201);
  pairingSecrets.push(payload.pairing.token);
  return payload.pairing;
}
const submit = (pairing, cookies) => importRoute.POST(request(endpoint, {
  provider: pairing.provider, origin: pairing.contract.origin, cookies,
  ...(pairing.action === "update" ? { connectionId: pairing.connectionId } : {}),
}, { [pairing.header]: pairing.token }));
const cookie = (name, value = secret, extra = {}) => ({ name, value, domain: "chatgpt.com", secure: true, storeId: "tab-store", ...extra });
async function capture(pairing, jar) {
  const held = new Set();
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
      get: async ({ name, storeId, url }) => { expect(storeId).toBe("tab-store"); expect(url).toBe(`${pairing.contract.origin}/`); return jar.find((c) => c.name === name) ?? null; },
      getAll: async () => { throw new Error("chunked families use exact-name reads only"); },
    },
  };
  const fetch = vi.fn(async (url, init) => importRoute.POST(new NextRequest(url, init)));
  const prepared = await prepareCapture({ chrome, text: JSON.stringify(pairing) });
  expect(prepared.ok).toBe(true);
  const result = await runCapture({ chrome, fetch, plan: prepared.plan, confirmed: confirmationFor(prepared.plan) });
  expect(held.size).toBe(0);
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(JSON.stringify(result)).not.toContain(pairing.token);
  return { result, fetch };
}
function har(cookies, headers = [], url = "https://grok.com/rest/chat") {
  return parser.parseHarDocument(JSON.stringify({ log: { entries: [{ request: { url, cookies, headers } }] } }));
}
function candidates(parsed) {
  return parser.buildImportCandidates({ kind: "har", parsed }, { origin: "https://grok.com", cookieNames: ["sso"], cookiePrefixes: [] });
}
beforeEach(async () => {
  pairingSecrets = [];
  logs = ["log", "info", "warn", "error", "debug"].map((name) => vi.spyOn(console, name).mockImplementation(() => {}));
  root = fs.mkdtempSync(path.join(os.tmpdir(), "chunk-har-integrity-"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  vi.stubEnv("BASE_URL", dashboard);
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.example");
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  pairingRoute = await import("../../src/app/api/providers/cookie-import/pairing/route.js");
  importRoute = await import("../../src/app/api/providers/cookie-import/route.js");
  parser = await import("../../src/shared/utils/cookieImportParser.js");
  ({ clearPairings } = await import("../../src/lib/providers/cookieImport/pairing.js"));
  clearPairings();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("unexpected outbound network"); }));
});
afterEach(async () => {
  clearPairings?.();
  await disposeLoadedRequestDetailsRepo();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  const output = JSON.stringify(logs.flatMap((spy) => spy.mock.calls));
  for (const value of [secret, ...pairingSecrets]) expect(output).not.toContain(value);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

it.each([
  [cookie(`${base}.00`)], [cookie(`${base}.-1`)], [cookie(`${base}.16`)],
  [cookie(`${base}.9007199254740993`)], [cookie(`${base}.0`, "x".repeat(8193))],
  [cookie(`${base}.0`, "bad;value")],
  Array.from({ length: 4 }, (_, i) => cookie(`${base}.${i}`, "x".repeat(8192))),
])("refuses noncanonical, malformed or oversized chunk jar %# before network or storage", async (...jar) => {
  const pairing = await mint("chatgpt-web-codex", { action: "create", name: "refused" });
  const { result, fetch } = await capture(pairing, jar);
  expect(result.ok).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  expect(await db.getProviderConnections({ provider: pairing.provider })).toHaveLength(0);
});

it("documents the exact-name limit: a chunk after a gap is never read, so only the contiguous prefix travels", async () => {
  // Reproduction from cookie-flow-chatgpt-web-codex-2034.md: `.0` + `.2` without `.1`.
  // The shared capture contract forbids jar enumeration for chunked families, so `.2` is
  // invisible to the extension. Rejecting this hole needs a server-side contract change.
  const pairing = await mint("chatgpt-web-codex", { action: "create", name: "prefix" });
  const { result, fetch } = await capture(pairing, [cookie(`${base}.0`, "head"), cookie(`${base}.2`, "hidden")]);
  expect(result.ok).toBe(true);
  expect(JSON.parse(fetch.mock.calls[0][1].body).cookies.map((c) => c.name)).toEqual([`${base}.0`]);
  expect(fetch.mock.calls[0][1].body).not.toContain("hidden");
});

it("imports whole and canonical contiguous chunks without crossing account updates", async () => {
  const first = await capture(await mint("chatgpt-web-codex", { action: "create", name: "first" }), [cookie(base)]);
  const second = await capture(await mint("chatgpt-web-codex", { action: "create", name: "second" }), [cookie(base, "synthetic-second")]);
  expect(first.result.ok).toBe(true);
  expect(second.result.ok).toBe(true);
  const id = first.result.connection.id;
  const update = await mint("chatgpt-web-codex", { action: "update", connectionId: id });
  const updated = await capture(update, [cookie(`${base}.1`, "tail"), cookie(base, "stale"), cookie(`${base}.0`, "head"), cookie("noise", "ignored")]);
  expect(updated.result.ok).toBe(true);
  expect((await db.getProviderConnectionById(id)).apiKey).toBe(`${base}.0=head; ${base}.1=tail`);
  expect((await db.getProviderConnectionById(second.result.connection.id)).apiKey).toBe(`${base}=synthetic-second`);
  const refused = await capture(await mint("chatgpt-web-codex", { action: "update", connectionId: id }), [cookie(`${base}.0`, "x".repeat(8193))]);
  expect(refused.fetch).not.toHaveBeenCalled();
  expect((await db.getProviderConnectionById(id)).apiKey).toBe(`${base}.0=head; ${base}.1=tail`);
});

it("rejects stale HAR updates and imports fresh and session HAR without overwriting another account", async () => {
  const first = await submit(await mint("grok-web", { action: "create", name: "working" }), [{ name: "sso", value: secret }]);
  expect(first.status).toBe(201);
  const id = (await first.json()).connection.id;
  const other = await submit(await mint("grok-web", { action: "create", name: "other" }), [{ name: "sso", value: "synthetic-other" }]);
  const otherId = (await other.json()).connection.id;
  const stale = candidates(har([{ name: "sso", value: "synthetic-stale", expires: "2001-01-01T00:00:00.000Z" }], [{ name: "Cookie", value: "sso=synthetic-stale" }]));
  expect(stale.ok).toBe(false);
  expect((await db.getProviderConnectionById(id)).apiKey).toBe(`sso=${secret}`);
  for (const expiry of [{ expires: "2099-01-01T00:00:00.000Z" }, {}]) {
    const parsed = candidates(har([{ name: "sso", value: "synthetic-new", ...expiry }], [{ name: "Cookie", value: "sso=synthetic-new" }]));
    expect(parsed.ok).toBe(true);
    const response = await submit(await mint("grok-web", { action: "update", connectionId: id }), parsed.candidates[0].cookies);
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain("synthetic-new");
  }
  expect((await db.getProviderConnectionById(otherId)).apiKey).toBe("sso=synthetic-other");
});

it.each([{ expires: "invalid" }, { expirationDate: null }, { expiry: 1 }, { domain: "evil.example" }, { path: "/private" }, { path: "bad" }])("refuses explicit invalid HAR metadata %#", (metadata) => {
  expect(candidates(har([{ name: "sso", value: secret, ...metadata }])).ok).toBe(false);
});

it("preserves header/cURL formats, parent-domain HAR scope and fresh expiry", () => {
  const contract = { origin: "https://grok.com", cookieNames: ["sso"], cookiePrefixes: [] };
  for (const raw of ["sso=synthetic==; noise=ignored", "Cookie: sso=synthetic=="]) {
    expect(parser.buildImportCandidates({ kind: "header", parsed: parser.parseCookieHeaderValue(raw) }, contract).candidates[0].cookies).toEqual([{ name: "sso", value: "synthetic==" }]);
  }
  for (const flag of ["-H 'Cookie: sso=synthetic=='", "-b 'sso=synthetic=='"]) {
    expect(parser.buildImportCandidates({ kind: "curl", parsed: parser.parseCurlCommand(`curl 'https://grok.com/rest/chat' ${flag}`) }, contract).ok).toBe(true);
  }
  const fresh = candidates(har([{ name: "sso", value: secret, domain: ".grok.com", path: "/rest", expires: "2099-01-01T00:00:00Z" }]));
  expect(fresh.candidates[0].cookies[0].expirationDate).toBe(Date.parse("2099-01-01T00:00:00Z") / 1000);
  expect(candidates(har([{ name: "sso", value: secret }], [], "https://evil.example/")).ok).toBe(false);
});


it("requires a valid pairing and refuses replay without changing the stored account", async () => {
  const pairing = await mint("grok-web", { action: "create", name: "paired" });
  const body = { provider: "grok-web", origin: "https://grok.com", cookies: [{ name: "sso", value: secret }] };
  expect((await importRoute.POST(request(endpoint, body))).status).toBe(401);
  expect(await db.getProviderConnections({ provider: "grok-web" })).toHaveLength(0);
  expect((await submit(pairing, body.cookies)).status).toBe(201);
  expect((await submit(pairing, [{ name: "sso", value: "synthetic-replay" }])).status).toBe(401);
  const rows = await db.getProviderConnections({ provider: "grok-web" });
  expect(rows).toHaveLength(1);
  expect(rows[0].apiKey).toBe(`sso=${secret}`);
});
