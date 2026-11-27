import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";
import { MIGRATIONS } from "../../src/lib/db/migrations/index.js";
import { applyVersionedMigrations } from "../../src/lib/db/migrate.js";
import { prepareCapture, runCapture, confirmationFor } from "../../extensions/provider-cookie-capture/capture.js";
import { getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { parseCookieHeaderValue, parseCurlCommand, parseHarDocument, buildImportCandidates, candidatesAreAmbiguous } from "../../src/shared/utils/cookieImportParser.js";
import { PromptQlExecutor } from "../../open-sse/executors/promptql.js";

const state = vi.hoisted(() => ({ getAdapter: vi.fn(), getAdapterSync: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.getAdapter, getAdapterSync: state.getAdapterSync }));
vi.mock("@/dashboardGuard", () => ({ canAccessManagementApi: state.access, isOperatorRequest: async () => true, hasExactRequestOrigin: () => true }));
vi.mock("@/lib/localDb", async () => ({ ...(await import("../../src/lib/db/repos/connectionsRepo.js")), getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn() }));
import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as submit } from "../../src/app/api/providers/cookie-import/route.js";
import { clearPairings } from "../../src/lib/providers/cookieImport/pairing.js";
import { getProviderConnectionById, createProviderConnection } from "../../src/lib/db/repos/connectionsRepo.js";

const origin = "https://prompt.ql.app";
const dashboard = "https://dashboard.example";
const names = ["__Host-next-auth.csrf-token", "next-auth.session-token"];
const cookies = (who) => names.map((name, i) => ({ name, value: `synthetic-${who}-${i}`, domain: "prompt.ql.app", secure: true }));
const header = (who) => cookies(who).map(({ name, value }) => `${name}=${value}`).join("; ");
const request = (url, body, headers = {}) => new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
let db;
beforeEach(() => {
  clearPairings();
  vi.stubEnv("BASE_URL", dashboard);
  db = createBetterSqliteAdapter(":memory:");
  db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  applyVersionedMigrations(db, MIGRATIONS);
  state.getAdapter.mockResolvedValue(db); state.getAdapterSync.mockReturnValue(db); state.access.mockResolvedValue(true);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function pairing(target) {
  const response = await pair(request(`${dashboard}/api/providers/cookie-import/pairing`, { provider: "promptql", ...target }, { origin: dashboard, "x-9r-cli-token": "synthetic-operator" }));
  expect(response.status).toBe(201);
  return (await response.json()).pairing;
}
async function send(p, body) {
  return submit(request(p.importUrl, body, { [p.header]: p.token }));
}
function browser(items, tabUrl = origin + "/") {
  const reads = [];
  const chrome = {
    tabs: { query: async () => [{ id: 7, url: tabUrl }], get: async () => ({ id: 7, url: tabUrl }) },
    permissions: { contains: async () => true, request: vi.fn(), remove: vi.fn() },
    cookies: { getAllCookieStores: async () => [{ id: "other", tabIds: [8] }, { id: "chosen", tabIds: [7] }], get: async (q) => { reads.push(q); return items.find((c) => c.name === q.name) ?? null; }, getAll: vi.fn() },
    scripting: { executeScript: vi.fn() },
  };
  return { chrome, reads };
}

it("captures the real PromptQL contract into the paired account and consumes that stored session", async () => {
  const logs = ["log", "info", "warn", "error", "debug"].map((key) => vi.spyOn(console, key).mockImplementation(() => {}));
  const p = await pairing({ action: "create", name: "Alice" });
  expect(p.contract).toMatchObject({ origin, cookieNames: names, cookiePrefixes: [] });
  const b = browser(cookies("alice"));
  const prepared = await prepareCapture({ chrome: b.chrome, text: JSON.stringify(p) });
  expect(prepared.ok).toBe(true);
  const fetchImport = vi.fn((url, init) => submit(new NextRequest(url, init)));
  const captured = await runCapture({ chrome: b.chrome, fetch: fetchImport, plan: prepared.plan, confirmed: confirmationFor(prepared.plan) });
  expect(captured.ok).toBe(true);
  expect(b.reads.map((r) => [r.name, r.storeId])).toEqual(names.map((n) => [n, "chosen"]));
  expect(b.chrome.cookies.getAll).not.toHaveBeenCalled();
  expect(b.chrome.scripting.executeScript).not.toHaveBeenCalled();
  const stored = await getProviderConnectionById(captured.connection.id);
  expect(stored.apiKey).toBe(header("alice"));
  const token = `e.${Buffer.from(JSON.stringify({ iss: "enrich-token", exp: 4102444800, "https://promptql.hasura.io": { "x-hasura-project-id": "synthetic-project" } })).toString("base64url")}.s`;
  const upstream = vi.fn(async (url, init) => {
    if (String(url).includes("/ddn/project/token")) { expect(new Headers(init.headers).get("cookie")).toBe(header("alice")); return Response.json({ token }); }
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${token}`);
    return Response.json({ data: { llm_config: [] } });
  });
  expect(await new PromptQlExecutor({ fetch: upstream }).execute({ credentials: stored, action: "models", body: {} })).toEqual({ models: [] });
  expect(upstream).toHaveBeenCalledTimes(2);
  const visible = JSON.stringify([captured, logs.flatMap((s) => s.mock.calls)]);
  for (const secret of [p.token, ...cookies("alice").map((c) => c.value), token]) expect(visible).not.toContain(secret);
});

it("parses and selects PromptQL Cookie, cURL and HAR candidates without merging accounts", () => {
  const contract = getCookieImportContract("promptql");
  const parsed = [
    ["header", parseCookieHeaderValue(`Cookie: ${header("alice")}; tracking=noise`)],
    ["curl", parseCurlCommand(`curl '${origin}/' -H 'Cookie: ${header("alice")}'`)],
    ["har", parseHarDocument(JSON.stringify({ log: { entries: ["alice", "bob"].map((who) => ({ request: { url: origin + "/", headers: [{ name: "Cookie", value: header(who) }] } })) } }))],
  ];
  for (const [kind, input] of parsed) {
    expect(input.ok).toBe(true);
    const result = buildImportCandidates({ kind, parsed: input }, contract);
    expect(result.ok).toBe(true);
    expect(result.candidates[0].cookies).toEqual(cookies("alice").map(({ name, value }) => ({ name, value })));
    if (kind === "har") expect(candidatesAreAmbiguous(result.candidates)).toBe(true);
  }
  expect(buildImportCandidates({ kind: "curl", parsed: parseCurlCommand(`curl 'https://evil.example/' -H 'Cookie: ${header("alice")}'`) }, contract).ok).toBe(false);
  expect(buildImportCandidates({ kind: "header", parsed: parseCookieHeaderValue(`${names[0]}=synthetic; ${names[1]}.0=synthetic`) }, contract).ok).toBe(false);
});

it("binds updates to the chosen PromptQL connection and refuses foreign origins and expired cookies", async () => {
  const alice = await createProviderConnection({ provider: "promptql", authType: "cookie", name: "Alice", apiKey: header("alice"), isActive: true }, { createOnly: true });
  const bob = await createProviderConnection({ provider: "promptql", authType: "cookie", name: "Bob", apiKey: header("bob"), isActive: true }, { createOnly: true });
  const p = await pairing({ action: "update", connectionId: alice.id });
  expect((await send(p, { provider: "promptql", connectionId: bob.id, origin, cookies: cookies("new") })).status).toBe(409);
  const update = await pairing({ action: "update", connectionId: alice.id });
  const response = await send(update, { provider: "promptql", connectionId: alice.id, origin, cookies: cookies("new") });
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain("synthetic-new");
  expect((await getProviderConnectionById(alice.id)).apiKey).toBe(header("new"));
  expect((await getProviderConnectionById(bob.id)).apiKey).toBe(header("bob"));
  for (const body of [{ origin: "https://prompt.ql.app.evil.example", cookies: cookies("x") }, { origin, cookies: cookies("x").map((c) => ({ ...c, expirationDate: 1 })) }]) {
    const fresh = await pairing({ action: "create", name: "Refused" });
    expect((await send(fresh, { provider: "promptql", ...body })).status).toBe(400);
  }
  const wrongTab = browser(cookies("x"), "https://evil.example/");
  const fresh = await pairing({ action: "create", name: "Tab" });
  expect((await prepareCapture({ chrome: wrongTab.chrome, text: JSON.stringify(fresh) })).code).toBe("wrong_tab");
  state.access.mockResolvedValue(false);
  expect((await pair(request(`${dashboard}/api/providers/cookie-import/pairing`, { provider: "promptql", action: "create", name: "Denied" }, { origin: dashboard }))).status).toBe(403);
});
