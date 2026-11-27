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
  const original = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pplx-2034-"));
  process.env.DATA_DIR = dir;
  return { dir, original, getAdapter: vi.fn(), getAdapterSync: vi.fn(), canAccessManagementApi: vi.fn(), isOperatorRequest: vi.fn(), hasExactRequestOrigin: vi.fn() };
});
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.getAdapter, getAdapterSync: state.getAdapterSync }));
vi.mock("@/dashboardGuard", () => ({ canAccessManagementApi: state.canAccessManagementApi, isOperatorRequest: state.isOperatorRequest, hasExactRequestOrigin: state.hasExactRequestOrigin }));
vi.mock("@/lib/localDb", async () => ({ ...(await import("../../src/lib/db/repos/connectionsRepo.js")), getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn() }));

import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as importCookies } from "../../src/app/api/providers/cookie-import/route.js";
import { clearPairings } from "../../src/lib/providers/cookieImport/pairing.js";
import { PAIRING_HEADER } from "../../src/lib/providers/cookieImport/handlers.js";
import { getProviderConnectionById, createProviderConnection } from "../../src/lib/db/repos/connectionsRepo.js";
import { getCookieImportContract, describeCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { parseCookieHeaderValue, parseCurlCommand, parseHarDocument, buildImportCandidates } from "../../src/shared/utils/cookieImportParser.js";
import { parsePairing, preflightPermissions, runCapture, confirmationFor } from "../../extensions/provider-cookie-capture/capture.js";
import PerplexityWebExecutor from "../../open-sse/executors/perplexity-web.js";

const provider = "perplexity-web", origin = "https://www.perplexity.ai", dashboard = "https://dashboard.example";
const name = "__Secure-next-auth.session-token", secret = "synthetic-session-2034";
const cookie = (value = secret) => ({ name, value, domain: ".perplexity.ai", secure: true });
const req = (url, body, headers = {}) => new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const pairingRequest = (body) => req(`${dashboard}/api/providers/cookie-import/pairing`, body, { origin: dashboard, "x-9r-cli-token": "operator-one" });
const importRequest = (token, body) => req(`${dashboard}/api/providers/cookie-import`, body, { origin: "chrome-extension://synthetic", ...(token ? { [PAIRING_HEADER]: token } : {}) });
const body = (cookies = [cookie()], extra = {}) => ({ provider, origin, cookies, ...extra });
let db, logs;
async function issue(target = { action: "create", name: "PPLX" }) {
  const response = await pair(pairingRequest({ provider, ...target }));
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()).pairing;
}
beforeEach(() => {
  clearPairings(); vi.stubEnv("BASE_URL", dashboard); vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  db = createBetterSqliteAdapter(":memory:"); db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"); applyVersionedMigrations(db, MIGRATIONS);
  state.getAdapter.mockResolvedValue(db); state.getAdapterSync.mockReturnValue(db);
  state.canAccessManagementApi.mockResolvedValue(true); state.isOperatorRequest.mockResolvedValue(true); state.hasExactRequestOrigin.mockReturnValue(true);
  logs = ["log", "info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
});
afterEach(() => { db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(() => { if (state.original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = state.original; fs.rmSync(state.dir, { recursive: true, force: true }); });

describe("Perplexity real cookie contract", () => {
  it("parses actual header, cURL and HAR inputs and refuses the current named session family", () => {
    const contract = getCookieImportContract(provider);
    expect(describeCookieImportContract(contract)).toEqual({ origin, cookieNames: [name], cookiePrefixes: [`${name}.`] });
    const raw = `${name}=${secret}`;
    const samples = [
      ["header", parseCookieHeaderValue(raw)],
      ["curl", parseCurlCommand(`curl '${origin}/' -H 'Cookie: ${raw}'`)],
      ["har", parseHarDocument(JSON.stringify({ log: { entries: [{ request: { url: `${origin}/`, headers: [{ name: "Cookie", value: raw }], cookies: [] } }] } }))],
    ];
    for (const [kind, parsed] of samples) {
      expect(parsed.ok).toBe(true);
      expect(buildImportCandidates({ kind, parsed }, contract)).toMatchObject({ ok: true, candidates: [{ cookies: [{ name, value: secret }] }] });
    }
    const current = parseCookieHeaderValue("__Secure-pplx.session.synthetic=value; pplx.session-id=synthetic");
    expect(buildImportCandidates({ kind: "header", parsed: current }, contract).ok).toBe(false);
  });

  it("captures the paired tab's chunks, imports them, and sends the stored account to the executor", async () => {
    const pairing = await issue();
    const parsed = parsePairing(JSON.stringify(pairing)); expect(parsed.ok).toBe(true);
    const plan = { ...parsed.plan, tabId: 7 };
    const values = { [`${name}.0`]: cookie("synthetic-zero"), [`${name}.1`]: cookie("synthetic-one") };
    for (const [key, value] of Object.entries(values)) value.name = key;
    const held = new Set(); const names = (q) => [...(q.permissions ?? []), ...(q.origins ?? [])];
    const chrome = { tabs: { get: async (id) => ({ id, url: `${origin}/` }) }, permissions: {
      contains: async (q) => names(q).every((v) => held.has(v)), request: async (q) => { names(q).forEach((v) => held.add(v)); return true; }, remove: async (q) => { names(q).forEach((v) => held.delete(v)); return true; },
    }, cookies: { getAllCookieStores: async () => [{ id: "selected", tabIds: [7] }], get: vi.fn(async ({ name: n }) => values[n] ?? null), getAll: vi.fn() } };
    await preflightPermissions(chrome, plan);
    const fetch = vi.fn(async (url, init) => importCookies(new NextRequest(url, init)));
    const captured = await runCapture({ chrome, fetch, plan, confirmed: confirmationFor(plan) });
    expect(captured.ok).toBe(true); expect(fetch).toHaveBeenCalledTimes(1); expect(chrome.cookies.getAll).not.toHaveBeenCalled();
    const stored = await getProviderConnectionById(captured.connection.id);
    expect(stored.apiKey).toBe(`${name}.0=synthetic-zero; ${name}.1=synthetic-one`);
    const upstream = vi.fn(async () => new Response("", { status: 401 })); vi.stubGlobal("fetch", upstream);
    await new PerplexityWebExecutor().execute({ model: "pplx-auto", body: { messages: [{ role: "user", content: "hello" }] }, credentials: stored, stream: false });
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(upstream.mock.calls[0][0]).toBe(`${origin}/rest/sse/perplexity_ask`);
    expect(upstream.mock.calls[0][1].headers.Cookie).toBe(stored.apiKey);
    expect(JSON.stringify(captured)).not.toContain("synthetic-zero");
    expect(JSON.stringify(logs.map((s) => s.mock.calls))).not.toContain("synthetic-zero");
  });

  it("requires pairing authority, rejects wrong origins and expired cookies, and updates only the selected connection", async () => {
    state.canAccessManagementApi.mockResolvedValueOnce(false);
    expect((await pair(pairingRequest({ provider, action: "create", name: "Denied" }))).status).not.toBe(201);
    expect((await importCookies(importRequest(null, body()))).status).not.toBe(201);
    for (const bad of [body([cookie()], { origin: "https://attacker.example" }), body([{ ...cookie(), expirationDate: 1 }])]) {
      const p = await issue(); expect((await importCookies(importRequest(p.token, bad))).status).toBe(400);
    }
    const a = await createProviderConnection({ provider, authType: "cookie", name: "A", apiKey: "old-a", isActive: true }, { createOnly: true });
    const b = await createProviderConnection({ provider, authType: "cookie", name: "B", apiKey: "old-b", isActive: true }, { createOnly: true });
    const p = await issue({ action: "update", connectionId: a.id });
    expect((await importCookies(importRequest(p.token, body([cookie()], { connectionId: b.id })))).status).not.toBe(200);
    const p2 = await issue({ action: "update", connectionId: a.id });
    const result = await importCookies(importRequest(p2.token, body([cookie()], { connectionId: a.id })));
    expect(result.status).toBe(200); expect(JSON.stringify(await result.json())).not.toContain(secret);
    expect((await getProviderConnectionById(a.id)).apiKey).toContain(secret);
    expect((await getProviderConnectionById(b.id)).apiKey).toBe("old-b");
    expect(JSON.stringify(logs.map((s) => s.mock.calls))).not.toContain(secret);
  });
});
