import fs from "node:fs";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";
import { MIGRATIONS } from "../../src/lib/db/migrations/index.js";
import { applyVersionedMigrations } from "../../src/lib/db/migrate.js";

const state = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const original = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tencent-cookie-2034-"));
  process.env.DATA_DIR = dir;
  return { dir, original, getAdapter: vi.fn(), getAdapterSync: vi.fn(), access: vi.fn(), operator: vi.fn(), origin: vi.fn() };
});
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.getAdapter, getAdapterSync: state.getAdapterSync }));
vi.mock("@/dashboardGuard", () => ({ canAccessManagementApi: state.access, isOperatorRequest: state.operator, hasExactRequestOrigin: state.origin }));
vi.mock("@/lib/localDb", async () => ({ ...(await import("../../src/lib/db/repos/connectionsRepo.js")), getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn() }));

import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as ingest } from "../../src/app/api/providers/cookie-import/route.js";
import { getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { clearPairings } from "../../src/lib/providers/cookieImport/pairing.js";
import { getProviderConnectionById, createProviderConnection } from "../../src/lib/db/repos/connectionsRepo.js";
import { parseCookieHeaderValue, parseCurlCommand, parseHarDocument, buildImportCandidates } from "../../src/shared/utils/cookieImportParser.js";
import { prepareCapture, runCapture, confirmationFor, describePlan } from "../../extensions/provider-cookie-capture/capture.js";
import { TencentAIStudioWebExecutor } from "../../open-sse/executors/tencent-aistudio-web.js";

const provider = "tencent-aistudio-web", origin = "https://aistudio.tencent.ai", dashboard = "https://dashboard.example";
const secret = "synthetic-tencent-session", other = "synthetic-other-session";
let db, logs;
const req = (path, body, headers = {}) => new NextRequest(dashboard + path, { method: "POST", headers: { "content-type": "application/json", origin: dashboard, "x-9r-cli-token": "operator-one", ...headers }, body: JSON.stringify(body) });
async function issue(target) {
  const res = await pair(req("/api/providers/cookie-import/pairing", { provider, ...target }));
  expect(res.status).toBe(201);
  return (await res.json()).pairing;
}
const body = (extra = {}) => ({ provider, origin, cookies: [{ name: "sessionid", value: secret, domain: "aistudio.tencent.ai", secure: true }], ...extra });
const submit = (token, payload) => ingest(req("/api/providers/cookie-import", payload, { "x-durindoor-pairing-token": token }));

beforeEach(() => {
  clearPairings();
  vi.stubEnv("BASE_URL", dashboard); vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  db = createBetterSqliteAdapter(":memory:");
  db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  applyVersionedMigrations(db, MIGRATIONS);
  state.getAdapter.mockResolvedValue(db); state.getAdapterSync.mockReturnValue(db);
  state.access.mockResolvedValue(true); state.operator.mockResolvedValue(true); state.origin.mockReturnValue(true);
  logs = ["log", "info", "warn", "error", "debug"].map((name) => vi.spyOn(console, name).mockImplementation(() => {}));
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
afterAll(() => { if (state.original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = state.original; fs.rmSync(state.dir, { recursive: true, force: true }); });

it("captures the real pairing in the tab's cookie store, imports it, and sends only that stored account to the executor", async () => {
  const pairing = await issue({ action: "create", name: "Captured" });
  expect(pairing.contract).toMatchObject({ origin, cookieNames: ["sessionid"], cookiePrefixes: [] });
  const held = new Set(), reads = [];
  const names = (q) => [...(q.permissions || []), ...(q.origins || [])];
  const chrome = {
    tabs: { query: async () => [{ id: 7, url: origin + "/chat" }], get: async () => ({ id: 7, url: origin + "/chat" }) },
    permissions: { contains: async (q) => names(q).every((n) => held.has(n)), request: async (q) => { names(q).forEach((n) => held.add(n)); return true; }, remove: async (q) => { names(q).forEach((n) => held.delete(n)); return true; } },
    cookies: { getAllCookieStores: async () => [{ id: "other", tabIds: [8] }, { id: "selected", tabIds: [7] }], get: async (q) => { reads.push(q); return { name: "sessionid", value: secret, domain: "aistudio.tencent.ai", secure: true }; }, getAll: async () => { throw Error("unexpected enumeration"); } },
    scripting: { executeScript: async () => { throw Error("unexpected localStorage read"); } },
  };
  const prepared = await prepareCapture({ chrome, text: JSON.stringify({ pairing }) });
  expect(prepared.ok).toBe(true);
  expect(describePlan(prepared.plan)).toMatchObject({ cookieNames: ["sessionid"], optionalCookies: [], localStorageKeys: [] });
  const send = vi.fn(async (url, init) => ingest(new NextRequest(url, init)));
  expect((await runCapture({ chrome, fetch: send, plan: prepared.plan, confirmed: {}, now: Date.now })).code).toBe("not_confirmed");
  expect(reads).toHaveLength(0);
  const captured = await runCapture({ chrome, fetch: send, plan: prepared.plan, confirmed: confirmationFor(prepared.plan), now: Date.now });
  expect(captured.ok).toBe(true);
  expect(reads).toEqual([{ url: origin + "/", name: "sessionid", storeId: "selected" }]);
  expect(held.size).toBe(0); expect(send).toHaveBeenCalledTimes(1);
  const rows = db.all("SELECT * FROM providerConnections");
  expect(rows).toHaveLength(1); expect(rows[0].data).not.toContain(secret);
  const selected = await getProviderConnectionById(rows[0].id);
  const second = await createProviderConnection({ provider, authType: "cookie", name: "Other", apiKey: `sessionid=${other}`, isActive: true }, { createOnly: true });
  expect(selected.apiKey).toBe(`sessionid=${secret}`);
  const calls = [];
  const result = await new TencentAIStudioWebExecutor().runSession({ model: "hy3-g", body: { messages: [{ role: "user", content: "ping" }] }, credentials: selected, stream: false }, { sendBillable: async (url, init) => { calls.push({ url, init }); return Response.json({ choices: [] }); } });
  expect(calls).toHaveLength(1); expect(calls[0].url).toBe(origin + "/api/chat/HunyuanDefault");
  expect(calls[0].init.headers.cookie).toBe(`sessionid=${secret}`); expect(calls[0].init.headers.cookie).not.toContain(other);
  expect((await getProviderConnectionById(second.id)).apiKey).toBe(`sessionid=${other}`);
  expect(result.headers.cookie).toBe("[REDACTED]");
  expect(JSON.stringify(captured)).not.toContain(secret); expect(JSON.stringify(captured)).not.toContain(pairing.token);
  expect(JSON.stringify(logs.flatMap((s) => s.mock.calls))).not.toContain(secret);
});

it("parses header, cURL and HAR with the real contract and refuses foreign origins and chunks", () => {
  const contract = getCookieImportContract(provider);
  const har = JSON.stringify({ log: { entries: [{ request: { url: origin + "/api/chat", headers: [{ name: "Cookie", value: `sessionid=${secret}; noise=x` }], cookies: [] } }] } });
  for (const [kind, parsed] of [["header", parseCookieHeaderValue(`Cookie: sessionid=${secret}; noise=x`)], ["curl", parseCurlCommand(`curl '${origin}/api/chat' -H 'Cookie: sessionid=${secret}; noise=x'`)], ["har", parseHarDocument(har)]]) {
    expect(parsed.ok).toBe(true);
    const built = buildImportCandidates({ kind, parsed }, contract);
    expect(built.ok).toBe(true); expect(built.candidates[0].cookies).toEqual([{ name: "sessionid", value: secret }]);
  }
  const foreign = buildImportCandidates({ kind: "curl", parsed: parseCurlCommand(`curl 'https://foreign.example/' -H 'Cookie: sessionid=${secret}'`) }, contract);
  expect(foreign.ok).toBe(false); expect(foreign.error).toMatch(/origin/i);
  const chunks = buildImportCandidates({ kind: "header", parsed: parseCookieHeaderValue(`sessionid.0=${secret}`) }, contract);
  expect(chunks.ok).toBe(false); expect(chunks.error).toMatch(/sessionid/i);
});

it("binds updates to the selected provider and rejects invalid origin, expiry and unapproved fields", async () => {
  state.access.mockResolvedValueOnce(false);
  expect((await pair(req("/api/providers/cookie-import/pairing", { provider, action: "create", name: "Denied" }))).status).toBe(403);
  const existing = await createProviderConnection({ provider, authType: "cookie", name: "Existing", apiKey: `sessionid=${other}`, isActive: true }, { createOnly: true });
  const wrong = await createProviderConnection({ provider: "grok-web", authType: "cookie", name: "Wrong", apiKey: "sso=synthetic", isActive: true }, { createOnly: true });
  expect((await pair(req("/api/providers/cookie-import/pairing", { provider, action: "update", connectionId: wrong.id }))).status).toBe(409);
  for (const invalid of [body({ origin: "https://foreign.example" }), body({ cookies: [{ name: "sessionid", value: secret, expirationDate: 1 }] }), body({ cookies: [{ name: "sessionid.0", value: secret }] }), body({ localStorage: { token: secret } })]) {
    const p = await issue({ action: "create", name: "Invalid" });
    const res = await submit(p.token, invalid);
    expect(res.status).toBe(400); expect(await res.text()).not.toContain(secret);
  }
  const p = await issue({ action: "update", connectionId: existing.id });
  const res = await submit(p.token, body({ connectionId: existing.id }));
  expect(res.status).toBe(200); expect(await res.text()).not.toContain(secret);
  expect((await getProviderConnectionById(existing.id)).apiKey).toBe(`sessionid=${secret}`);
  expect((await getProviderConnectionById(wrong.id)).apiKey).toBe("sso=synthetic");
  expect(JSON.stringify(logs.flatMap((s) => s.mock.calls))).not.toContain(secret);
});
