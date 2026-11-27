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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notrack-2034-"));
  process.env.DATA_DIR = dir;
  return { original, dir, adapter: vi.fn(), sync: vi.fn(), access: vi.fn(), operator: vi.fn(), origin: vi.fn() };
});
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.adapter, getAdapterSync: state.sync }));
vi.mock("@/dashboardGuard", () => ({ canAccessManagementApi: state.access, isOperatorRequest: state.operator, hasExactRequestOrigin: state.origin }));
vi.mock("@/lib/localDb", async () => ({
  ...(await import("../../src/lib/db/repos/connectionsRepo.js")),
  getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn(),
}));

import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as importCookies } from "../../src/app/api/providers/cookie-import/route.js";
import { clearPairings } from "../../src/lib/providers/cookieImport/pairing.js";
import { getProviderConnectionById, createProviderConnection } from "../../src/lib/db/repos/connectionsRepo.js";
import { parsePairing, preflightPermissions, runCapture, confirmationFor } from "../../extensions/provider-cookie-capture/capture.js";
import { getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { parseCookieHeaderValue, parseCurlCommand, parseHarDocument, buildImportCandidates } from "../../src/shared/utils/cookieImportParser.js";
import { NotrackWebExecutor } from "../../open-sse/executors/notrack-web.js";

const dashboard = "https://dashboard.example";
const origin = "https://notrack.ai";
const values = { uid: "synthetic-uid", si_usr_id: "synthetic-user", si_ses_id: "synthetic-session", nt_session: "synthetic-optional" };
const header = Object.entries(values).map(([k, v]) => `${k}=${v}`).join("; ");
let db, logs;
const req = (path, body, headers = {}) => new NextRequest(`${dashboard}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
async function issue(body) {
  const res = await pair(req("/api/providers/cookie-import/pairing", body, { origin: dashboard, "x-9r-cli-token": "synthetic-operator" }));
  expect(res.status).toBe(201);
  return (await res.json()).pairing;
}
const submit = (token, body) => importCookies(req("/api/providers/cookie-import", body, { "x-durindoor-pairing-token": token }));
const cookies = () => Object.entries(values).map(([name, value]) => ({ name, value, domain: "notrack.ai", secure: true }));
const body = (extra = {}) => ({ provider: "notrack-web", origin, cookies: cookies(), ...extra });

beforeEach(() => {
  clearPairings();
  vi.stubEnv("BASE_URL", dashboard);
  db = createBetterSqliteAdapter(":memory:");
  db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  applyVersionedMigrations(db, MIGRATIONS);
  state.adapter.mockReset().mockResolvedValue(db); state.sync.mockReset().mockReturnValue(db);
  state.access.mockReset().mockResolvedValue(true); state.operator.mockReset().mockResolvedValue(true); state.origin.mockReset().mockReturnValue(true);
  logs = ["log", "info", "warn", "error", "debug"].map((key) => vi.spyOn(console, key).mockImplementation(() => {}));
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(() => { if (state.original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = state.original; fs.rmSync(state.dir, { recursive: true, force: true }); });

describe("NoTrack real capture to stored dispatch", () => {
  it("captures only the paired names, imports the selected account, and dispatches its stored credential", async () => {
    const other = await createProviderConnection({ provider: "notrack-web", authType: "cookie", name: "Other", apiKey: "uid=other; si_usr_id=other; si_ses_id=other", isActive: true }, { createOnly: true });
    const p = await issue({ provider: "notrack-web", action: "create", name: "Captured" });
    expect(p.contract).toMatchObject({ origin, cookieNames: ["uid", "si_usr_id", "si_ses_id"], cookiePrefixes: [], optionalCookies: ["nt_session"] });
    expect(p.contract.localStorageKeys || []).toEqual([]);
    const parsed = parsePairing(JSON.stringify({ pairing: p }));
    expect(parsed.ok).toBe(true);
    const plan = parsed.plan; plan.tabId = 7;
    const held = new Set(); const reads = [];
    const names = (q) => [...(q.permissions || []), ...(q.origins || [])];
    const chrome = {
      tabs: { query: async () => [{ id: 7, url: `${origin}/` }], get: async (id) => ({ id, url: `${origin}/` }) },
      permissions: { contains: async (q) => names(q).every((n) => held.has(n)), request: async (q) => { names(q).forEach((n) => held.add(n)); return true; }, remove: async () => true },
      cookies: { getAllCookieStores: async () => [{ id: "chosen", tabIds: [7] }], get: async (q) => { reads.push(q); return { name: q.name, value: values[q.name], domain: "notrack.ai", secure: true }; } },
      scripting: { executeScript: vi.fn() },
    };
    await preflightPermissions(chrome, plan);
    let responseText = "";
    const fetchImport = vi.fn(async (url, options) => {
      const response = await importCookies(new NextRequest(url, options));
      responseText = await response.clone().text();
      return response;
    });
    const result = await runCapture({ chrome, fetch: fetchImport, plan, confirmed: confirmationFor(plan) });
    expect(result.ok).toBe(true);
    expect(reads.map((r) => r.name)).toEqual(Object.keys(values));
    expect(reads.every((r) => r.storeId === "chosen")).toBe(true);
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    const imported = JSON.parse(responseText).connection;
    const stored = await getProviderConnectionById(imported.id);
    expect(stored).toMatchObject({ provider: "notrack-web", name: "Captured", isActive: true, apiKey: header });
    expect((await getProviderConnectionById(other.id)).apiKey).toContain("uid=other");
    const fetcher = vi.fn(async () => new Response('data: {"type":"message","content":"ok"}\n\n'));
    const dispatched = await new NotrackWebExecutor(fetcher).execute({ body: { messages: [{ role: "user", content: "hello" }] }, credentials: stored, model: "notrack-c" });
    expect(dispatched.response.status).toBe(200);
    expect(fetcher.mock.calls[0][0]).toBe("https://notrack.ai/api/dispatch");
    expect(fetcher.mock.calls[0][1].headers.cookie).toBe(header);
    expect(dispatched.headers.cookie).toBe("[REDACTED]");
    const output = responseText + JSON.stringify(result) + JSON.stringify(logs.flatMap((s) => s.mock.calls));
    for (const secret of [...Object.values(values), p.token]) expect(output).not.toContain(secret);
    expect(db.all("SELECT * FROM providerConnections").find((row) => row.id === imported.id).data).not.toContain(values.uid);
  });

  it.each(["header", "curl", "har"])("imports the selected %s parser candidate through the real handler", async (kind) => {
    const inputs = {
      header: () => parseCookieHeaderValue(`Cookie: ${header}; unrelated=synthetic-noise`),
      curl: () => parseCurlCommand(`curl '${origin}/api/dispatch' -H 'Cookie: ${header}; unrelated=synthetic-noise'`),
      har: () => parseHarDocument(JSON.stringify({ log: { entries: [{ request: { url: `${origin}/api/dispatch`, headers: [{ name: "Cookie", value: `${header}; unrelated=synthetic-noise` }], cookies: [] } }] } })),
    };
    const parsed = inputs[kind]();
    expect(parsed.ok).toBe(true);
    const candidates = buildImportCandidates({ kind, parsed }, getCookieImportContract("notrack-web"));
    expect(candidates.ok).toBe(true);
    expect(candidates.candidates[0].dropped).toEqual(["unrelated"]);
    const p = await issue({ provider: "notrack-web", action: "create", name: kind });
    const res = await submit(p.token, body({ cookies: candidates.candidates[0].cookies }));
    expect(res.status).toBe(201);
    expect((await getProviderConnectionById((await res.json()).connection.id)).apiKey).toBe(header);
  });

  it("binds updates to the selected connection and refuses foreign origins and expired cookies", async () => {
    const a = await createProviderConnection({ provider: "notrack-web", authType: "cookie", name: "A", apiKey: "uid=old-a", isActive: true }, { createOnly: true });
    const b = await createProviderConnection({ provider: "notrack-web", authType: "cookie", name: "B", apiKey: "uid=old-b", isActive: true }, { createOnly: true });
    let p = await issue({ provider: "notrack-web", action: "update", connectionId: a.id });
    expect((await submit(p.token, body({ connectionId: b.id }))).status).toBe(409);
    p = await issue({ provider: "notrack-web", action: "update", connectionId: a.id });
    expect((await submit(p.token, body({ connectionId: a.id, origin: "https://notrack.ai.evil.example" }))).status).toBe(400);
    p = await issue({ provider: "notrack-web", action: "update", connectionId: a.id });
    const expired = cookies(); expired[0].expirationDate = 1;
    expect((await submit(p.token, body({ connectionId: a.id, cookies: expired }))).status).toBe(400);
    p = await issue({ provider: "notrack-web", action: "update", connectionId: a.id });
    expect((await submit(p.token, body({ connectionId: a.id }))).status).toBe(200);
    expect((await getProviderConnectionById(a.id)).apiKey).toBe(header);
    expect((await getProviderConnectionById(b.id)).apiKey).toBe("uid=old-b");
  });

  it("requires operator authority and rejects unapproved storage and chunk names", async () => {
    state.operator.mockResolvedValue(false);
    expect((await pair(req("/api/providers/cookie-import/pairing", { provider: "notrack-web", action: "create", name: "Denied" }, { origin: dashboard }))).status).toBe(403);
    state.operator.mockResolvedValue(true);
    let p = await issue({ provider: "notrack-web", action: "create", name: "Denied" });
    expect((await submit(p.token, body({ localStorage: { token: "synthetic-storage" } }))).status).toBe(400);
    p = await issue({ provider: "notrack-web", action: "create", name: "Denied" });
    expect((await submit(p.token, body({ cookies: [...cookies(), { name: "uid.0", value: "synthetic-chunk" }] }))).status).toBe(400);
    expect(db.all("SELECT * FROM providerConnections")).toHaveLength(0);
  });
});
