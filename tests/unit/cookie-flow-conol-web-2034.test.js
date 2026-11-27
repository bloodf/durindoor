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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conol-2034-"));
  process.env.DATA_DIR = dir;
  return { original, dir, getAdapter: vi.fn(), getAdapterSync: vi.fn(), access: vi.fn(), operator: vi.fn(), origin: vi.fn() };
});
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.getAdapter, getAdapterSync: state.getAdapterSync }));
vi.mock("@/dashboardGuard", () => ({ canAccessManagementApi: state.access, isOperatorRequest: state.operator, hasExactRequestOrigin: state.origin }));
vi.mock("@/lib/localDb", async () => ({
  ...(await import("../../src/lib/db/repos/connectionsRepo.js")),
  getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn(),
}));

import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as importCookies } from "../../src/app/api/providers/cookie-import/route.js";
import { clearPairings } from "../../src/lib/providers/cookieImport/pairing.js";
import { getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { createProviderConnection, getProviderConnectionById } from "../../src/lib/db/repos/connectionsRepo.js";
import { prepareCapture, runCapture, confirmationFor } from "../../extensions/provider-cookie-capture/capture.js";
import { parseCookieHeaderValue, parseCurlCommand, parseHarDocument, buildImportCandidates } from "../../src/shared/utils/cookieImportParser.js";
import { ConolWebExecutor } from "../../open-sse/executors/conol-web.js";

const DASH = "https://dashboard.example";
const ORIGIN = "https://conol.ai";
const NAME = "__Secure-better-auth.session_token";
const A = "synthetic-conol-account-a";
const B = "synthetic-conol-account-b";
let db, logs;
const request = (url, body, headers = {}) => new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const issue = async (target) => pair(request(`${DASH}/api/providers/cookie-import/pairing`, { provider: "conol-web", ...target }, { origin: DASH, "x-9r-cli-token": "synthetic-operator" }));
const submit = (p, body, token = p.token) => importCookies(request(p.importUrl, body, { [p.header]: token }));
const cookie = (value, extra = {}) => ({ name: NAME, value, domain: "conol.ai", secure: true, ...extra });
const body = (cookies, extra = {}) => ({ provider: "conol-web", origin: ORIGIN, cookies, ...extra });
const issued = async (target) => { const res = await issue(target); expect(res.status).toBe(201); return (await res.json()).pairing; };

beforeEach(() => {
  clearPairings();
  vi.stubEnv("BASE_URL", DASH);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.example");
  db = createBetterSqliteAdapter(":memory:");
  db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  applyVersionedMigrations(db, MIGRATIONS);
  state.getAdapter.mockReset().mockResolvedValue(db);
  state.getAdapterSync.mockReset().mockReturnValue(db);
  state.access.mockReset().mockResolvedValue(true);
  state.operator.mockReset().mockResolvedValue(true);
  state.origin.mockReset().mockReturnValue(true);
  logs = ["log", "info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
});
afterEach(() => { db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(() => { if (state.original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = state.original; fs.rmSync(state.dir, { recursive: true, force: true }); });

function browser(value = A, tabUrl = `${ORIGIN}/`) {
  const get = vi.fn(async () => cookie(value));
  const granted = new Set();
  const names = (q) => [...(q.permissions ?? []), ...(q.origins ?? [])];
  return { get, chrome: {
    tabs: { query: vi.fn(async () => [{ id: 7, url: tabUrl }]), get: vi.fn(async () => ({ id: 7, url: tabUrl })) },
    permissions: { contains: vi.fn(async (q) => names(q).every((n) => granted.has(n))), request: vi.fn(async (q) => { names(q).forEach((n) => granted.add(n)); return true; }), remove: vi.fn(async (q) => { names(q).forEach((n) => granted.delete(n)); return true; }) },
    cookies: { get, getAll: vi.fn(), getAllCookieStores: vi.fn(async () => [{ id: "selected", tabIds: [7] }, { id: "other", tabIds: [8] }]) },
    scripting: { executeScript: vi.fn() },
  } };
}

describe("conol-web real cookie flow (#2034)", () => {
  it("captures the paired tab's exact cookie, stores it and sends the selected account to the executor", async () => {
    const p = await issued({ action: "create", name: "Account A" });
    expect(p.contract).toMatchObject({ origin: ORIGIN, cookieNames: [NAME], cookiePrefixes: [] });
    expect(p.contract.optionalCookies ?? []).toEqual([]);
    expect(p.contract.localStorageKeys ?? []).toEqual([]);
    const b = browser();
    const prepared = await prepareCapture({ chrome: b.chrome, text: JSON.stringify(p) });
    expect(prepared.ok).toBe(true);
    const fetch = vi.fn(async (url, init) => importCookies(new NextRequest(url, init)));
    const result = await runCapture({ chrome: b.chrome, fetch, plan: prepared.plan, confirmed: confirmationFor(prepared.plan) });
    expect(result.ok).toBe(true);
    expect(b.get).toHaveBeenCalledTimes(1);
    expect(b.get).toHaveBeenCalledWith({ url: `${ORIGIN}/`, name: NAME, storeId: "selected" });
    expect(b.chrome.cookies.getAll).not.toHaveBeenCalled();
    expect(b.chrome.scripting.executeScript).not.toHaveBeenCalled();
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.cookies).toEqual([cookie(A)]);
    const rows = db.all("SELECT * FROM providerConnections");
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(A);
    const accountA = await getProviderConnectionById(rows[0].id);
    expect(accountA.apiKey).toBe(`${NAME}=${A}`);
    const accountB = await createProviderConnection({ provider: "conol-web", authType: "cookie", name: "Account B", apiKey: `${NAME}=${B}`, isActive: true }, { createOnly: true });
    const seen = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      seen.push([String(url), init.headers.Cookie]);
      if (String(url).endsWith("/api/sessions")) return Response.json({ sessionId: "synthetic-session" }, { status: 201 });
      if (String(url).endsWith("/model")) return Response.json({});
      if (String(url).endsWith("?logDeltas=1")) return new Response(`${JSON.stringify({ type: "assistant", text: "synthetic reply" })}\n${JSON.stringify({ type: "done" })}\n`);
      if (String(url).endsWith("/messages")) return new Response(null, { status: 202 });
      throw new Error("unexpected request");
    }));
    const execution = await new ConolWebExecutor().execute({ model: "claude-fable-5", body: { messages: [{ role: "user", content: "hello" }] }, credentials: accountA });
    expect(execution.response.status).toBe(200);
    expect(await execution.response.text()).toContain("synthetic reply");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(([, header]) => header === `${NAME}=${A}`)).toBe(true);
    expect((await getProviderConnectionById(accountB.id)).apiKey).toBe(`${NAME}=${B}`);
    const output = JSON.stringify({ result, execution: { headers: execution.headers, body: execution.transformedBody }, logs: logs.flatMap((s) => s.mock.calls) });
    for (const secret of [A, B, p.token]) expect(output).not.toContain(secret);
    vi.unstubAllGlobals();
  });

  it("parses and imports a selected header, cURL and HAR candidate under the real contract", async () => {
    const contract = getCookieImportContract("conol-web");
    const header = `${NAME}=${A}`;
    const inputs = [
      { kind: "header", parsed: parseCookieHeaderValue(header) },
      { kind: "curl", parsed: parseCurlCommand(`curl '${ORIGIN}/api/agent-servers' -H 'Cookie: ${header}'`) },
      { kind: "har", parsed: parseHarDocument(JSON.stringify({ log: { entries: [{ request: { url: `${ORIGIN}/api/agent-servers`, headers: [{ name: "Cookie", value: header }], cookies: [] } }] } })) },
    ];
    for (const [index, input] of inputs.entries()) {
      expect(input.parsed.ok).toBe(true);
      const selected = buildImportCandidates(input, contract);
      expect(selected.ok).toBe(true);
      const p = await issued({ action: "create", name: `Parsed ${index}` });
      const res = await submit(p, body(selected.candidates[0].cookies));
      expect(res.status).toBe(201);
      expect(JSON.stringify(await res.json())).not.toContain(A);
    }
    const foreign = parseCurlCommand(`curl 'https://evil.example/' -H 'Cookie: ${header}'`);
    expect(buildImportCandidates({ kind: "curl", parsed: foreign }, contract)).toMatchObject({ ok: false });
  });

  it("binds updates to the selected provider and refuses foreign, expired and unsupported credentials", async () => {
    state.access.mockResolvedValueOnce(false);
    expect((await issue({ action: "create", name: "Denied" })).status).toBe(403);
    const other = await createProviderConnection({ provider: "grok-web", authType: "cookie", name: "Other", apiKey: "sso=synthetic-other", isActive: true }, { createOnly: true });
    expect((await issue({ action: "update", connectionId: other.id })).status).toBe(409);
    const existing = await createProviderConnection({ provider: "conol-web", authType: "cookie", name: "Existing", apiKey: `${NAME}=${A}`, isActive: true }, { createOnly: true });
    for (const bad of [body([cookie(B)], { origin: "https://conol.ai.evil.example" }), body([cookie(B, { expirationDate: 1 })]), body([cookie(B, { name: `${NAME}.0` })]), body([cookie(B)], { localStorage: { token: B } })]) {
      const p = await issued({ action: "update", connectionId: existing.id });
      const res = await submit(p, { ...bad, connectionId: existing.id });
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).not.toContain(B);
    }
    expect((await getProviderConnectionById(existing.id)).apiKey).toBe(`${NAME}=${A}`);
    const p = await issued({ action: "update", connectionId: existing.id });
    expect((await submit(p, body([cookie(B)], { connectionId: existing.id }), "ddpair_" + "A".repeat(43))).status).toBe(401);
    const updated = await submit(p, body([cookie(B)], { connectionId: existing.id }));
    expect(updated.status).toBe(200);
    expect(JSON.stringify(await updated.json())).not.toContain(B);
    expect((await getProviderConnectionById(existing.id)).apiKey).toBe(`${NAME}=${B}`);
    expect((await getProviderConnectionById(other.id)).apiKey).toBe("sso=synthetic-other");
    const wrongTab = browser(A, "https://conol.ai.evil.example/");
    const next = await issued({ action: "create", name: "Wrong tab" });
    expect((await prepareCapture({ chrome: wrongTab.chrome, text: JSON.stringify(next) })).code).toBe("wrong_tab");
    expect(wrongTab.get).not.toHaveBeenCalled();
    const logged = JSON.stringify(logs.flatMap((s) => s.mock.calls));
    for (const secret of [A, B, p.token, next.token]) expect(logged).not.toContain(secret);
  });
});
