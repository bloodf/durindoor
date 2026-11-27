import fs from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";
import { MIGRATIONS } from "../../src/lib/db/migrations/index.js";
import { applyVersionedMigrations } from "../../src/lib/db/migrate.js";

const state = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const original = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blackbox-2034-"));
  process.env.DATA_DIR = dir;
  return { original, dir, getAdapter: vi.fn(), getAdapterSync: vi.fn(), access: vi.fn(), operator: vi.fn(), origin: vi.fn() };
});
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.getAdapter, getAdapterSync: state.getAdapterSync }));
vi.mock("@/dashboardGuard", () => ({ canAccessManagementApi: state.access, isOperatorRequest: state.operator, hasExactRequestOrigin: state.origin }));
vi.mock("@/lib/localDb", async () => ({ ...(await import("../../src/lib/db/repos/connectionsRepo.js")), getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn() }));

import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as importCredentials } from "../../src/app/api/providers/cookie-import/route.js";
import { clearPairings } from "../../src/lib/providers/cookieImport/pairing.js";
import { PAIRING_HEADER } from "../../src/lib/providers/cookieImport/handlers.js";
import { getProviderConnectionById, createProviderConnection } from "../../src/lib/db/repos/connectionsRepo.js";
import { getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { parseCookieHeaderValue, parseCurlCommand, parseHarDocument, buildImportCandidates, candidatesAreAmbiguous } from "../../src/shared/utils/cookieImportParser.js";
import { prepareCapture, runCapture, confirmationFor, describePlan } from "../../extensions/provider-cookie-capture/capture.js";
import { BlackboxWebExecutor } from "../../open-sse/executors/blackbox-web.js";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";

const DASH = "https://dashboard.example", ORIGIN = "https://app.blackbox.ai", NAME = "next-auth.session-token";
const A = "synthetic-account-a", B = "synthetic-account-b";
let db, logs;
const req = (url, body, headers = {}) => new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
async function issue(body) {
  const response = await pair(req(`${DASH}/api/providers/cookie-import/pairing`, body, { origin: DASH, "x-9r-cli-token": "operator" }));
  expect(response.status).toBe(201);
  return (await response.json()).pairing;
}
const submit = (token, body) => importCredentials(req(`${DASH}/api/providers/cookie-import`, body, { origin: "chrome-extension://synthetic", [PAIRING_HEADER]: token }));
const cookie = (value, extra = {}) => ({ name: NAME, value, domain: "app.blackbox.ai", secure: true, ...extra });
function browser(value) {
  const get = vi.fn(async () => cookie(value));
  const chrome = { tabs: { query: vi.fn(async () => [{ id: 7, url: ORIGIN }]), get: vi.fn(async () => ({ id: 7, url: ORIGIN })) }, permissions: { contains: vi.fn(async () => true), request: vi.fn(), remove: vi.fn() }, cookies: { getAllCookieStores: vi.fn(async () => [{ id: "other", tabIds: [8] }, { id: "chosen", tabIds: [7] }]), get, getAll: vi.fn() }, scripting: { executeScript: vi.fn() } };
  return { chrome, get };
}
beforeEach(() => {
  clearPairings();
  vi.stubEnv("BASE_URL", DASH); vi.stubEnv("NEXT_PUBLIC_BASE_URL", ""); vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.example");
  db = createBetterSqliteAdapter(":memory:"); db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"); applyVersionedMigrations(db, MIGRATIONS);
  state.getAdapter.mockResolvedValue(db); state.getAdapterSync.mockReturnValue(db);
  state.access.mockResolvedValue(true); state.operator.mockResolvedValue(true); state.origin.mockReturnValue(true);
  logs = ["log", "info", "warn", "error", "debug"].map((key) => vi.spyOn(console, key).mockImplementation(() => {}));
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(() => { if (state.original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = state.original; fs.rmSync(state.dir, { recursive: true, force: true }); });

describe("blackbox-web real cookie flow", () => {
  it("captures the selected browser store into an authenticated connection and sends its stored credential through the executor", async () => {
    const other = await createProviderConnection({ provider: "blackbox-web", authType: "cookie", name: "Other", apiKey: `${NAME}=${B}`, isActive: true }, { createOnly: true });
    const pairing = await issue({ provider: "blackbox-web", action: "create", name: "Chosen" });
    expect(pairing.contract).toEqual({ origin: ORIGIN, cookieNames: [NAME], cookiePrefixes: [] });
    const { chrome, get } = browser(A);
    const prepared = await prepareCapture({ chrome, text: JSON.stringify(pairing) });
    expect(prepared.ok).toBe(true);
    expect(JSON.stringify(describePlan(prepared.plan))).not.toContain(pairing.token);
    const network = vi.fn(async (_url, init) => submit(init.headers[PAIRING_HEADER], JSON.parse(init.body)));
    expect((await runCapture({ chrome, fetch: network, plan: prepared.plan, confirmed: {} })).code).toBe("not_confirmed");
    const result = await runCapture({ chrome, fetch: network, plan: prepared.plan, confirmed: confirmationFor(prepared.plan) });
    expect(result.ok).toBe(true);
    expect(get).toHaveBeenCalledOnce(); expect(get).toHaveBeenCalledWith({ url: `${ORIGIN}/`, name: NAME, storeId: "chosen" });
    expect(chrome.cookies.getAll).not.toHaveBeenCalled(); expect(chrome.scripting.executeScript).not.toHaveBeenCalled(); expect(network).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain(A);
    const storedRows = db.all("SELECT id FROM providerConnections");
    const chosenId = storedRows.find((row) => row.id !== other.id).id;
    const stored = await getProviderConnectionById(chosenId);
    expect(stored.apiKey).toBe(`${NAME}=${A}`);
    expect((await getProviderConnectionById(other.id)).apiKey).toBe(`${NAME}=${B}`);
    const calls = [];
    const restore = __setOriginalFetchForTesting(async (url, init) => { calls.push({ url: String(url), init }); return String(url).endsWith("/api/auth/session") ? Response.json({}) : new Response("synthetic answer"); });
    try {
      const result = await new BlackboxWebExecutor().execute({ model: "gpt-4", body: { messages: [{ role: "user", content: "hello" }] }, credentials: stored, proxyOptions: { connectionProxyEnabled: true, connectionProxyUrl: "http://127.0.0.1:9", strictProxy: true } });
      expect(result.response.status).toBe(200);
      expect(calls.map((call) => call.url)).toEqual([`${ORIGIN}/api/auth/session`, `${ORIGIN}/api/chat`]);
      for (const call of calls) { expect(call.init.headers.Cookie).toBe(`${NAME}=${A}`); expect(call.init.dispatcher).toBeTruthy(); }
      expect(JSON.stringify(result.headers)).not.toContain(A);
    } finally { restore(); }
    expect(JSON.stringify(logs.flatMap((spy) => spy.mock.calls))).not.toContain(A);
  });

  it("imports selected real-contract header, cURL and HAR candidates and rejects foreign origins and unsupported chunks", async () => {
    const contract = getCookieImportContract("blackbox-web");
    const header = parseCookieHeaderValue(`Cookie: ${NAME}=${A}; unrelated=noise`);
    const curl = parseCurlCommand(`curl '${ORIGIN}/api/chat' -H 'Cookie: ${NAME}=${A}'`);
    const har = parseHarDocument(JSON.stringify({ log: { entries: [A, B].map((value) => ({ request: { url: `${ORIGIN}/api/chat`, cookies: [{ name: NAME, value }] } })) } }));
    for (const [kind, parsed] of [["header", header], ["curl", curl], ["har", har]]) {
      expect(parsed.ok).toBe(true);
      const selected = buildImportCandidates({ kind, parsed }, contract);
      expect(selected.ok).toBe(true); expect(selected.candidates[0].cookies).toEqual([{ name: NAME, value: A }]);
      if (kind === "har") expect(candidatesAreAmbiguous(selected.candidates)).toBe(true);
      const pairing = await issue({ provider: "blackbox-web", action: "create", name: `Imported ${kind}` });
      const response = await submit(pairing.token, { provider: "blackbox-web", origin: ORIGIN, cookies: selected.candidates[0].cookies });
      expect(response.status).toBe(201);
      const payload = await response.json(); expect(JSON.stringify(payload)).not.toContain(A);
      expect((await getProviderConnectionById(payload.connection.id)).apiKey).toBe(`${NAME}=${A}`);
    }
    expect(buildImportCandidates({ kind: "curl", parsed: parseCurlCommand(`curl 'https://evil.example/' -H 'Cookie: ${NAME}=${A}'`) }, contract).ok).toBe(false);
    expect(buildImportCandidates({ kind: "header", parsed: parseCookieHeaderValue(`${NAME}.0=${A}`) }, contract).ok).toBe(false);
  });

  it("updates only the paired account and refuses wrong provider, origin, expiry and localStorage", async () => {
    const first = await createProviderConnection({ provider: "blackbox-web", authType: "cookie", name: "First", apiKey: `${NAME}=${A}`, isActive: true }, { createOnly: true });
    const second = await createProviderConnection({ provider: "blackbox-web", authType: "cookie", name: "Second", apiKey: `${NAME}=${B}`, isActive: true }, { createOnly: true });
    const wrong = await createProviderConnection({ provider: "grok-web", authType: "cookie", name: "Wrong", apiKey: "sso=synthetic", isActive: true }, { createOnly: true });
    state.access.mockResolvedValueOnce(false);
    expect((await pair(req(`${DASH}/api/providers/cookie-import/pairing`, { provider: "blackbox-web", action: "create", name: "Denied" }, { origin: DASH }))).status).toBe(403);
    const denied = await pair(req(`${DASH}/api/providers/cookie-import/pairing`, { provider: "blackbox-web", action: "update", connectionId: wrong.id }, { origin: DASH }));
    expect(denied.status).toBe(409);
    for (const extra of [{ origin: "https://evil.example", cookies: [cookie(B)] }, { origin: ORIGIN, cookies: [cookie(B, { expirationDate: 1 })] }, { origin: ORIGIN, cookies: [cookie(B)], localStorage: { token: B } }, { origin: ORIGIN, connectionId: second.id, cookies: [cookie(B)] }]) {
      const p = await issue({ provider: "blackbox-web", action: "update", connectionId: first.id });
      const response = await submit(p.token, { provider: "blackbox-web", connectionId: first.id, ...extra });
      expect(response.status).toBeGreaterThanOrEqual(400); expect(JSON.stringify(await response.json())).not.toContain(B);
    }
    const p = await issue({ provider: "blackbox-web", action: "update", connectionId: first.id });
    const response = await submit(p.token, { provider: "blackbox-web", origin: ORIGIN, connectionId: first.id, cookies: [cookie(B)] });
    expect(response.status).toBe(200); expect(JSON.stringify(await response.json())).not.toContain(B);
    expect((await getProviderConnectionById(first.id)).apiKey).toBe(`${NAME}=${B}`);
    expect((await getProviderConnectionById(second.id)).apiKey).toBe(`${NAME}=${B}`);
  });
});
