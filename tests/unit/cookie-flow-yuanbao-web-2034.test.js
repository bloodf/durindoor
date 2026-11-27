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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuanbao-flow-"));
  process.env.DATA_DIR = dir;
  return { dir, original, adapter: vi.fn(), sync: vi.fn(), access: vi.fn(), operator: vi.fn(), origin: vi.fn() };
});
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.adapter, getAdapterSync: state.sync }));
vi.mock("@/dashboardGuard", () => ({ canAccessManagementApi: state.access, isOperatorRequest: state.operator, hasExactRequestOrigin: state.origin }));
vi.mock("@/lib/localDb", async () => ({
  ...(await import("../../src/lib/db/repos/connectionsRepo.js")),
  getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn(),
}));
vi.mock("open-sse/utils/proxyFetch.js", async (original) => ({ ...await original(), proxyAwareFetch: (url, options) => globalThis.fetch(url, options) }));

import registry from "open-sse/providers/registry/yuanbao-web.js";
import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as importCookies } from "../../src/app/api/providers/cookie-import/route.js";
import { getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { clearPairings } from "../../src/lib/providers/cookieImport/pairing.js";
import { getProviderConnectionById, createProviderConnection } from "../../src/lib/db/repos/connectionsRepo.js";
import { prepareCapture, runCapture, confirmationFor } from "../../extensions/provider-cookie-capture/capture.js";
import { parseCookieHeaderValue, parseCurlCommand, parseHarDocument, buildImportCandidates, candidatesAreAmbiguous } from "../../src/shared/utils/cookieImportParser.js";
import { getExecutor } from "open-sse/executors/index.js";

const dashboard = "https://dashboard.example";
const origin = "https://yuanbao.tencent.com";
const values = { hy_user: "synthetic-user-a", hy_token: "synthetic-token-a" };
const cookies = (v = values) => Object.entries(v).map(([name, value]) => ({ name, value, domain: "yuanbao.tencent.com", secure: true }));
const request = (url, body, headers = {}) => new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const pairRequest = (body) => request(`${dashboard}/api/providers/cookie-import/pairing`, body, { origin: dashboard, "x-9r-cli-token": "operator-one" });
const send = (token, body) => importCookies(request(`${dashboard}/api/providers/cookie-import`, body, { "x-durindoor-pairing-token": token }));
const body = (extra = {}) => ({ provider: "yuanbao-web", origin, cookies: cookies(), ...extra });
let db, logs;
async function issue(target) {
  const response = await pair(pairRequest({ provider: "yuanbao-web", ...target }));
  expect(response.status).toBe(201);
  return (await response.json()).pairing;
}
function browser(jar = values, tabUrl = `${origin}/chat`) {
  const reads = [];
  return { reads, chrome: {
    tabs: { query: async () => [{ id: 7, url: tabUrl }], get: async () => ({ id: 7, url: tabUrl }) },
    permissions: { contains: async () => true, request: vi.fn(), remove: vi.fn() },
    cookies: { getAllCookieStores: async () => [{ id: "other", tabIds: [8] }, { id: "chosen", tabIds: [7] }], get: async (q) => { reads.push(q); return jar[q.name] ? { name: q.name, value: jar[q.name], domain: "yuanbao.tencent.com", secure: true } : null; }, getAll: vi.fn() },
    scripting: { executeScript: vi.fn() },
  } };
}
beforeEach(() => {
  clearPairings();
  vi.stubEnv("BASE_URL", dashboard);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  db = createBetterSqliteAdapter(":memory:");
  db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  applyVersionedMigrations(db, MIGRATIONS);
  state.adapter.mockReset().mockResolvedValue(db); state.sync.mockReset().mockReturnValue(db);
  state.access.mockReset().mockResolvedValue(true); state.operator.mockReset().mockResolvedValue(true); state.origin.mockReset().mockReturnValue(true);
  logs = ["log", "info", "warn", "error", "debug"].map((key) => vi.spyOn(console, key).mockImplementation(() => {}));
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
afterAll(() => { if (state.original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = state.original; fs.rmSync(state.dir, { recursive: true, force: true }); });

describe("real Yuanbao capture and import", () => {
  it("captures the tab's two named cookies through a real pairing, stores them, and dispatches the selected account", async () => {
    expect(registry.cookieImport).toEqual({ origin, cookieNames: ["hy_user", "hy_token"] });
    state.access.mockResolvedValueOnce(false);
    expect((await pair(pairRequest({ provider: "yuanbao-web", action: "create", name: "A" }))).status).toBe(403);
    const pairing = await issue({ action: "create", name: "A" });
    expect(pairing.contract).toEqual({ origin, cookieNames: ["hy_user", "hy_token"], cookiePrefixes: [] });
    const b = browser();
    const prepared = await prepareCapture({ chrome: b.chrome, text: JSON.stringify({ pairing }) });
    expect(prepared.ok).toBe(true);
    const transport = vi.fn((url, init) => importCookies(new NextRequest(url, init)));
    expect((await runCapture({ chrome: b.chrome, fetch: transport, plan: prepared.plan, confirmed: confirmationFor(prepared.plan) })).ok).toBe(true);
    expect(b.reads.map((r) => [r.name, r.storeId])).toEqual([["hy_user", "chosen"], ["hy_token", "chosen"]]);
    expect(b.chrome.cookies.getAll).not.toHaveBeenCalled();
    expect(b.chrome.scripting.executeScript).not.toHaveBeenCalled();
    const rows = db.all("SELECT id FROM providerConnections");
    expect(rows).toHaveLength(1);
    const selected = await getProviderConnectionById(rows[0].id);
    const other = await createProviderConnection({ provider: "yuanbao-web", authType: "cookie", name: "B", apiKey: "hy_user=synthetic-user-b; hy_token=synthetic-token-b", isActive: true }, { createOnly: true });
    expect(selected.apiKey).toContain(values.hy_user);
    const outbound = vi.fn(async (url) => String(url).endsWith("/create") ? Response.json({ id: "synthetic-conversation" }) : new Response('data: {"type":"text","msg":"ok"}\n\n'));
    vi.stubGlobal("fetch", outbound);
    const result = await getExecutor("yuanbao-web").execute({ model: "deepseek-v3", body: { messages: [{ role: "user", content: "hello" }] }, stream: false, credentials: selected });
    expect(result.response.status).toBe(200);
    expect(outbound).toHaveBeenCalledTimes(2);
    for (const [, options] of outbound.mock.calls) expect(options.headers.Cookie).toBe(`hy_source=web; hy_user=${values.hy_user}; hy_token=${values.hy_token}`);
    expect((await getProviderConnectionById(other.id)).apiKey).toContain("synthetic-token-b");
    const exposed = JSON.stringify([await result.response.json(), logs.flatMap((spy) => spy.mock.calls)]);
    for (const secret of [...Object.values(values), pairing.token]) expect(exposed).not.toContain(secret);
  });

  it("binds replacement to its connection, rejects foreign ownership and unsafe cookies", async () => {
    const a = await createProviderConnection({ provider: "yuanbao-web", authType: "cookie", name: "A", apiKey: "hy_user=old; hy_token=old", isActive: true }, { createOnly: true });
    const b = await createProviderConnection({ provider: "yuanbao-web", authType: "cookie", name: "B", apiKey: "hy_user=b; hy_token=b", isActive: true }, { createOnly: true });
    const foreign = await createProviderConnection({ provider: "tencent", authType: "apikey", name: "C", apiKey: "synthetic", isActive: true }, { createOnly: true });
    expect((await pair(pairRequest({ provider: "yuanbao-web", action: "update", connectionId: foreign.id }))).status).toBe(409);
    let p = await issue({ action: "update", connectionId: a.id });
    expect((await send(p.token, body({ connectionId: b.id }))).status).toBe(409);
    for (const bad of [body({ origin: "https://yuanbao.tencent.com.evil.example" }), body({ cookies: cookies().map((c) => ({ ...c, expirationDate: 1 })) }), body({ cookies: [{ name: "hy_token", value: "synthetic" }] }), body({ cookies: [...cookies(), { name: "hy_token.0", value: "synthetic" }] }), body({ localStorage: { token: "synthetic" } })]) {
      p = await issue({ action: "create", name: "Rejected" });
      const response = await send(p.token, bad);
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).not.toContain("synthetic");
    }
    p = await issue({ action: "update", connectionId: a.id });
    const response = await send(p.token, body({ connectionId: a.id }));
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain(values.hy_token);
    expect((await getProviderConnectionById(a.id)).apiKey).toContain(values.hy_token);
    expect((await getProviderConnectionById(b.id)).apiKey).toBe("hy_user=b; hy_token=b");
    expect((await send(p.token, body({ connectionId: a.id }))).status).toBe(401);
  });

  it("selects only Yuanbao candidates from Cookie, cURL and HAR input", () => {
    const contract = getCookieImportContract("yuanbao-web");
    const header = `hy_user=${values.hy_user}; hy_token=${values.hy_token}; tracking=synthetic-noise`;
    const inputs = [
      ["header", parseCookieHeaderValue(header)],
      ["curl", parseCurlCommand(`curl '${origin}/api/chat' -H 'Cookie: ${header}'`)],
      ["har", parseHarDocument(JSON.stringify({ log: { entries: [{ request: { url: `${origin}/api/chat`, headers: [{ name: "Cookie", value: header }], cookies: [] } }, { request: { url: "https://evil.example/", headers: [{ name: "Cookie", value: header }], cookies: [] } }] } }))],
    ];
    for (const [kind, parsed] of inputs) {
      expect(parsed.ok).toBe(true);
      const result = buildImportCandidates({ kind, parsed }, contract);
      expect(result.ok).toBe(true);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].cookies.map((c) => c.name)).toEqual(["hy_user", "hy_token"]);
      expect(candidatesAreAmbiguous(result.candidates)).toBe(false);
    }
    const foreign = parseCurlCommand(`curl 'https://evil.example/' -H 'Cookie: ${header}'`);
    expect(buildImportCandidates({ kind: "curl", parsed: foreign }, contract)).toMatchObject({ ok: false });
    expect(buildImportCandidates({ kind: "header", parsed: parseCookieHeaderValue("hy_user.0=a; hy_token=b") }, contract)).toMatchObject({ ok: false });
  });
});
