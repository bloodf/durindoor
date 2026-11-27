// Veo AI Free optional WordPress session: dashboard Cookie/cURL/HAR import,
// the pairing import API and the browser-extension capture, against the real
// registry and a real in-memory connection repository. Closed mocks only: a
// fake `chrome`, a fake `fetch`, synthetic cookie values. The stored session
// then reaches the adapter's selected AJAX calls and nothing else.
import fs from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";
import { MIGRATIONS } from "../../src/lib/db/migrations/index.js";
import { applyVersionedMigrations } from "../../src/lib/db/migrate.js";

const state = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const originalDataDir = process.env.DATA_DIR;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "veo-session-capture-"));
  process.env.DATA_DIR = dataDir;
  return {
    getAdapter: vi.fn(),
    getAdapterSync: vi.fn(() => { throw new Error("Fixture adapter is not initialized"); }),
    canAccessManagementApi: vi.fn(), isOperatorRequest: vi.fn(), hasExactRequestOrigin: vi.fn(),
    dataDir, originalDataDir,
  };
});
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.getAdapter, getAdapterSync: state.getAdapterSync }));
vi.mock("@/dashboardGuard", () => ({
  canAccessManagementApi: state.canAccessManagementApi,
  isOperatorRequest: state.isOperatorRequest,
  hasExactRequestOrigin: state.hasExactRequestOrigin,
}));
// Only the adapter is a fixture: creation, update and encryption are the real repository.
vi.mock("@/lib/localDb", async () => ({
  ...(await import("../../src/lib/db/repos/connectionsRepo.js")),
  getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn(),
}));

import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as importCookies } from "../../src/app/api/providers/cookie-import/route.js";
import { buildImportedCookieHeader, describeCookieImportContract, getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { clearPairings } from "../../src/lib/providers/cookieImport/pairing.js";
import { PAIRING_HEADER } from "../../src/lib/providers/cookieImport/handlers.js";
import { buildImportCandidates, parseCookieHeaderValue, parseCurlCommand, parseHarDocument } from "../../src/shared/utils/cookieImportParser.js";
import { cookieImportConfig } from "../../src/shared/utils/cookieImportContract.js";
import { shouldShowProviderConnections } from "../../src/shared/utils/providerAuthMode.js";
import { FREE_PROVIDERS } from "../../src/shared/constants/providers.js";
import { getProviderConnectionById } from "../../src/lib/db/repos/connectionsRepo.js";
import { PROVIDERS as EXTENSION_PROVIDERS } from "../../extensions/provider-cookie-capture/providers.js";
import { parsePairing, preflightPermissions, runCapture, confirmationFor, describePlan } from "../../extensions/provider-cookie-capture/capture.js";
import veoRegistry from "../../open-sse/providers/registry/veoaifree-web.js";
import { createVeoAiFreeVideoAdapter } from "../../open-sse/services/providerParity/native-veoaifree-web-video/index.js";

const DASHBOARD = "https://dashboard.example";
const ORIGIN = "https://veoaifree.com";
// WordPress names its logged-in cookie after md5(site URL); this is the one for https://veoaifree.com.
const WP = "wordpress_logged_in_04e805bfa8c7064a04c2e480966a748b";
// Synthetic only: none of these is a real credential.
const VALUE = "synthetic-user%7C1900000000%7Ctoken%7Chmac";
const OTHER = "synthetic-other-session";
const NOISE = "synthetic-unapproved-value";
const TOKEN = `ddpair_${"A".repeat(43)}`;
const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);

let db;
const pairingRequest = (body) => new NextRequest(`${DASHBOARD}/api/providers/cookie-import/pairing`, {
  method: "POST", headers: { "content-type": "application/json", "x-9r-cli-token": "operator-one", origin: DASHBOARD }, body: JSON.stringify(body),
});
const importRequest = (token, body) => new NextRequest(`${DASHBOARD}/api/providers/cookie-import`, {
  method: "POST", headers: { "content-type": "application/json", origin: "chrome-extension://synthetic-extension-id", [PAIRING_HEADER]: token }, body: JSON.stringify(body),
});
async function issue(body) {
  const res = await pair(pairingRequest(body));
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return (await res.json()).pairing;
}
const wpCookie = (extra = {}) => ({ name: WP, value: VALUE, domain: "veoaifree.com", secure: true, ...extra });

beforeEach(() => {
  clearPairings();
  vi.stubEnv("BASE_URL", DASHBOARD);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.example");
  db = createBetterSqliteAdapter(":memory:");
  db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  applyVersionedMigrations(db, MIGRATIONS);
  state.getAdapter.mockReset().mockResolvedValue(db);
  state.getAdapterSync.mockReset().mockReturnValue(db);
  state.canAccessManagementApi.mockReset().mockResolvedValue(true);
  state.isOperatorRequest.mockReset().mockResolvedValue(true);
  state.hasExactRequestOrigin.mockReset().mockReturnValue(true);
  for (const method of ["log", "info", "warn", "error", "debug"]) vi.spyOn(console, method).mockImplementation(() => {});
});
afterEach(() => {
  db.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(() => {
  if (state.originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = state.originalDataDir;
  fs.rmSync(state.dataDir, { recursive: true, force: true });
});

describe("import contract", () => {
  it("is an optional session of the anonymous provider: exact origin, exact cookie name, no sign-in", () => {
    const contract = getCookieImportContract("veoaifree-web");
    expect(contract).toMatchObject({ provider: "veoaifree-web", authType: "apikey", origin: ORIGIN, host: "veoaifree.com", extensionCapture: true });
    expect([...contract.cookieNames]).toEqual([WP]);
    expect([...contract.cookiePrefixes]).toEqual([]);
    expect(describeCookieImportContract(contract)).toEqual({ origin: ORIGIN, cookieNames: [WP], cookiePrefixes: [] });
    expect(veoRegistry).toMatchObject({ noAuth: true, category: "free", serviceKinds: ["video"] });
    expect(veoRegistry.webLogin).toBeUndefined();
    expect(veoRegistry.authType).toBeUndefined();
    // The dashboard lists saved sessions next to the anonymous proxy card; the card stays.
    expect(FREE_PROVIDERS["veoaifree-web"].cookieImport).toMatchObject({ origin: ORIGIN, cookieNames: [WP] });
    expect(shouldShowProviderConnections(FREE_PROVIDERS["veoaifree-web"], { storedNoAuth: true })).toBe(true);
    // Only an explicit optional-session profile on a no-auth entry is importable.
    expect(cookieImportConfig({ ...veoRegistry, noAuth: false })).toBeNull();
    expect(cookieImportConfig({ ...veoRegistry, cookieImport: { ...veoRegistry.cookieImport, optionalSession: false } })).toBeNull();
  });

  it("accepts only the exact cookie on the exact host and composes the stored header", () => {
    const contract = getCookieImportContract("veoaifree-web");
    expect(buildImportedCookieHeader(contract, [wpCookie()])).toEqual({ ok: true, header: `${WP}=${VALUE}` });
    expect(buildImportedCookieHeader(contract, [wpCookie({ domain: ".veoaifree.com" })]).ok).toBe(true);
    for (const cookies of [
      [wpCookie({ name: "wordpress_logged_in_0123456789abcdef0123456789abcdef" })],
      [wpCookie({ name: "wordpress_logged_in" })],
      [wpCookie({ name: "wordpress_sec_04e805bfa8c7064a04c2e480966a748b" })],
      [wpCookie({ domain: "evil.example" })],
      [wpCookie({ domain: "veoaifree.com.evil.example" })],
      [wpCookie({ secure: false })],
      [wpCookie({ expirationDate: 1 })],
      [wpCookie({ value: "bad;value" })],
      [wpCookie(), { name: "cf_clearance", value: NOISE }],
      [],
    ]) expect(buildImportedCookieHeader(contract, cookies).ok, JSON.stringify(cookies)).toBe(false);
  });

  it("filters pasted headers, cURL commands and HAR files to the approved origin and name", () => {
    const contract = getCookieImportContract("veoaifree-web");
    const header = buildImportCandidates({ kind: "header", parsed: parseCookieHeaderValue(`${WP}=${VALUE}; cf_clearance=${NOISE}; wordpress_test_cookie=WP`) }, contract);
    expect(header).toMatchObject({ ok: true, candidates: [{ origin: ORIGIN, cookies: [{ name: WP, value: VALUE }], dropped: ["cf_clearance", "wordpress_test_cookie"] }] });

    const curl = parseCurlCommand(`curl 'https://veoaifree.com/wp-admin/admin-ajax.php' -H 'cookie: ${WP}=${VALUE}; other=${NOISE}'`);
    expect(buildImportCandidates({ kind: "curl", parsed: curl }, contract)).toMatchObject({ ok: true, candidates: [{ cookies: [{ name: WP, value: VALUE }] }] });
    const foreign = parseCurlCommand(`curl 'https://veoaifree.com.evil.example/' -H 'cookie: ${WP}=${VALUE}'`);
    expect(buildImportCandidates({ kind: "curl", parsed: foreign }, contract).ok).toBe(false);

    const har = parseHarDocument(JSON.stringify({ log: { entries: [
      { request: { url: "https://evil.example/", headers: [{ name: "cookie", value: `${WP}=${OTHER}` }] } },
      { request: { url: `${ORIGIN}/`, headers: [{ name: "cookie", value: `${WP}=${VALUE}; cf_clearance=${NOISE}` }] } },
    ] } }));
    const fromHar = buildImportCandidates({ kind: "har", parsed: har }, contract);
    expect(fromHar).toMatchObject({ ok: true, candidates: [{ origin: ORIGIN, cookies: [{ name: WP, value: VALUE }] }] });
    expect(JSON.stringify(fromHar)).not.toContain(OTHER);
    expect(JSON.stringify(fromHar)).not.toContain(NOISE);

    expect(buildImportCandidates({ kind: "header", parsed: parseCookieHeaderValue(`wordpress_logged_in_deadbeef=${VALUE}`) }, contract).ok).toBe(false);
  });
});

describe("pairing import API", () => {
  it("creates and replaces a selectable session connection through the existing pairing guards", async () => {
    const created = await issue({ provider: "veoaifree-web", action: "create", name: "Veo session A" });
    expect(created.contract).toEqual({ origin: ORIGIN, cookieNames: [WP], cookiePrefixes: [] });
    const res = await importCookies(importRequest(created.token, { provider: "veoaifree-web", origin: ORIGIN, cookies: [wpCookie()] }));
    expect(res.status).toBe(201);
    const { connection } = await res.json();
    const stored = await getProviderConnectionById(connection.id);
    expect(stored).toMatchObject({ provider: "veoaifree-web", authType: "apikey", apiKey: `${WP}=${VALUE}` });

    // The pairing is single-use, bound to its provider, and refuses another origin or cookie name.
    expect((await importCookies(importRequest(created.token, { provider: "veoaifree-web", origin: ORIGIN, cookies: [wpCookie()] }))).status).toBe(401);
    const wrongOrigin = await issue({ provider: "veoaifree-web", action: "create", name: "Veo session B" });
    expect((await importCookies(importRequest(wrongOrigin.token, { provider: "veoaifree-web", origin: "https://evil.example", cookies: [wpCookie()] }))).status).toBe(400);
    const wrongName = await issue({ provider: "veoaifree-web", action: "create", name: "Veo session C" });
    expect((await importCookies(importRequest(wrongName.token, { provider: "veoaifree-web", origin: ORIGIN, cookies: [wpCookie({ name: "wordpress_logged_in_x" })] }))).status).toBe(400);

    const update = await issue({ provider: "veoaifree-web", action: "update", connectionId: connection.id });
    const replaced = await importCookies(importRequest(update.token, { provider: "veoaifree-web", origin: ORIGIN, connectionId: connection.id, cookies: [wpCookie({ value: OTHER })] }));
    expect(replaced.status).toBe(200);
    expect((await getProviderConnectionById(connection.id)).apiKey).toBe(`${WP}=${OTHER}`);
  });

  it("refuses a pairing that targets another provider's connection", async () => {
    const created = await issue({ provider: "veoaifree-web", action: "create", name: "Veo session" });
    const res = await importCookies(importRequest(created.token, { provider: "grok-web", origin: "https://grok.com", cookies: [{ name: "sso", value: VALUE, secure: true }] }));
    expect(res.status).toBe(409);
  });

  it("hands the stored session to the adapter, which sends it only on its AJAX calls", async () => {
    const created = await issue({ provider: "veoaifree-web", action: "create", name: "Veo session" });
    const { connection } = await (await importCookies(importRequest(created.token, { provider: "veoaifree-web", origin: ORIGIN, cookies: [wpCookie()] }))).json();
    const stored = await getProviderConnectionById(connection.id);
    const answers = [new Response('{"nonce":"abcdef"}'), new Response("scene-1"), new Response("https://cdn.example.com/video.mp4")];
    const fetchImpl = vi.fn(async () => answers.shift());
    vi.stubGlobal("fetch", fetchImpl);
    const result = await createVeoAiFreeVideoAdapter({ pollIntervalMs: 0 }).generate({
      model: "veo", body: { prompt: "rain" }, credentials: { connectionId: stored.id, apiKey: stored.apiKey, providerSpecificData: stored.providerSpecificData },
    });
    expect(result.success).toBe(true);
    const [nonce, submit, poll] = fetchImpl.mock.calls;
    expect(nonce[0]).toBe(ORIGIN);
    expect(nonce[1].headers.Cookie).toBeUndefined();
    expect(submit[1].headers.Cookie).toBe(`${WP}=${VALUE}`);
    expect(poll[1].headers.Cookie).toBe(`${WP}=${VALUE}`);
    for (const [, init] of fetchImpl.mock.calls) expect(init.headers.Authorization).toBeUndefined();
  });
});

describe("browser extension capture", () => {
  const veoPairing = (overrides = {}) => ({
    token: TOKEN, expiresAt: new Date(NOW + 120_000).toISOString(), ttlSeconds: 120, header: PAIRING_HEADER,
    provider: "veoaifree-web", action: "create", name: "Veo session",
    importUrl: `${DASHBOARD}/api/providers/cookie-import`,
    contract: describeCookieImportContract(getCookieImportContract("veoaifree-web")),
    ...overrides,
  });
  function makeChrome({ tabUrl = `${ORIGIN}/`, jar = {} } = {}) {
    const held = new Set();
    const calls = [];
    const names = (q) => [...(q.permissions ?? []), ...(q.origins ?? [])];
    return {
      calls,
      chrome: {
        tabs: { query: async () => [{ id: 7, url: tabUrl }], get: async (id) => ({ id, url: tabUrl }) },
        permissions: {
          contains: async (q) => names(q).every((n) => held.has(n)),
          request: async (q) => { calls.push({ name: "permissions.request", arg: q }); names(q).forEach((n) => held.add(n)); return true; },
          remove: async (q) => { names(q).forEach((n) => held.delete(n)); return true; },
        },
        cookies: {
          getAllCookieStores: async () => [{ id: "store-1", tabIds: [7] }],
          get: async (details) => { calls.push({ name: "cookies.get", arg: details }); return jar[details.name] ?? null; },
        },
      },
    };
  }
  async function capture({ pairing = veoPairing(), jar } = {}) {
    const parsed = parsePairing(JSON.stringify({ pairing }), NOW);
    expect(parsed.ok, parsed.code).toBe(true);
    const harness = makeChrome({ jar });
    const plan = parsed.plan;
    plan.tabId = 7;
    await preflightPermissions(harness.chrome, plan);
    const fetchImpl = vi.fn(async () => ({ status: 201, ok: true, json: async () => ({ connection: { id: "conn-1", name: "Veo session" } }) }));
    const result = await runCapture({ chrome: harness.chrome, fetch: fetchImpl, plan, confirmed: confirmationFor(plan), now: () => NOW });
    return { result, calls: harness.calls, fetchImpl, plan };
  }

  it("ships the exact built-in Veo entry that matches the dashboard contract", () => {
    expect(EXTENSION_PROVIDERS["veoaifree-web"]).toEqual({ label: "Veo AI Free Web", origin: ORIGIN, cookieNames: [WP], cookiePrefixes: [] });
    const manifest = JSON.parse(fs.readFileSync(new URL("../../extensions/provider-cookie-capture/manifest.json", import.meta.url), "utf8"));
    expect(manifest.optional_host_permissions).toContain(`${ORIGIN}/*`);
    expect(manifest.host_permissions).toBeUndefined();
  });

  it("reads only the WordPress logged-in cookie of the provider origin and posts it once to the paired dashboard", async () => {
    const jar = { [WP]: wpCookie({ domain: ".veoaifree.com" }), wordpress_test_cookie: wpCookie({ name: "wordpress_test_cookie", value: NOISE }) };
    const { result, calls, fetchImpl, plan } = await capture({ jar });
    expect(result.ok).toBe(true);
    expect(describePlan(plan).cookieNames).toEqual([WP]);
    expect(calls.filter((c) => c.name === "cookies.get").map((c) => c.arg)).toEqual([{ url: `${ORIGIN}/`, name: WP, storeId: "store-1" }]);
    expect(calls.find((c) => c.name === "permissions.request").arg.origins).toEqual([`${ORIGIN}/*`, `${DASHBOARD}/*`]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${DASHBOARD}/api/providers/cookie-import`);
    expect(JSON.parse(init.body)).toEqual({ provider: "veoaifree-web", origin: ORIGIN, cookies: [{ name: WP, value: VALUE, domain: "veoaifree.com", secure: true }] });
    expect(init.body).not.toContain(NOISE);
  });

  it("sends nothing without a secure logged-in cookie", async () => {
    for (const jar of [{}, { [WP]: wpCookie({ secure: false }) }, { [WP]: wpCookie({ domain: "evil.example" }) }]) {
      const { result, fetchImpl } = await capture({ jar });
      expect(result.code).toBe("no_cookies");
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("refuses a pairing that widens or moves the built-in allowlist", () => {
    const contract = describeCookieImportContract(getCookieImportContract("veoaifree-web"));
    expect(parsePairing(JSON.stringify({ pairing: veoPairing({ contract: { ...contract, origin: "https://evil.example" } }) }), NOW)).toMatchObject({ ok: false, code: "origin_mismatch" });
    expect(parsePairing(JSON.stringify({ pairing: veoPairing({ contract: { ...contract, cookieNames: [] } }) }), NOW)).toMatchObject({ ok: false, code: "invalid_pairing" });
    const widened = parsePairing(JSON.stringify({ pairing: veoPairing({ contract: { ...contract, cookieNames: [WP, "wordpress_sec_x"] } }) }), NOW);
    expect(widened.ok).toBe(true);
    expect(widened.plan.cookieNames).toEqual([WP]);
    expect(parsePairing(JSON.stringify({ pairing: veoPairing({ importUrl: `${ORIGIN}/api/providers/cookie-import` }) }), NOW)).toMatchObject({ ok: false, code: "invalid_destination" });
  });
});
